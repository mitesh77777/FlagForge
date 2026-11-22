import { describe, expect, it } from 'vitest';
import { conditionMatches, evaluateAll, evaluateFlag, ruleConditionsMatch } from './evaluate.js';
import type { FlagConfig, TargetingRule } from './types.js';

const baseFlag = (over: Partial<FlagConfig> = {}): FlagConfig => ({
  key: 'test-flag',
  enabled: true,
  defaultValue: false,
  rules: [],
  overrides: { allowlist: [], blocklist: [] },
  version: 1,
  ...over,
});

const rule = (over: Partial<TargetingRule> = {}): TargetingRule => ({
  id: 'r1',
  conditions: [],
  matchType: 'AND',
  rolloutPercentage: 100,
  serveValue: true,
  ...over,
});

describe('kill switch', () => {
  it('serves the default value when disabled, regardless of overrides/rules', () => {
    const flag = baseFlag({
      enabled: false,
      defaultValue: 'off',
      rules: [rule({ rolloutPercentage: 100 })],
      overrides: { allowlist: ['u1'], blocklist: [] },
    });
    const res = evaluateFlag(flag, { userId: 'u1' });
    expect(res).toEqual({ value: 'off', reason: 'KILL_SWITCH_OFF', version: 1 });
  });
});

describe('explicit overrides', () => {
  it('blocklist forces false and takes precedence over allowlist', () => {
    const flag = baseFlag({
      overrides: { allowlist: ['u1'], blocklist: ['u1'] },
    });
    expect(evaluateFlag(flag, { userId: 'u1' })).toMatchObject({
      value: false,
      reason: 'EXPLICIT_BLOCKLIST',
    });
  });

  it('allowlist forces true', () => {
    const flag = baseFlag({ overrides: { allowlist: ['vip'], blocklist: [] } });
    expect(evaluateFlag(flag, { userId: 'vip' })).toMatchObject({
      value: true,
      reason: 'EXPLICIT_ALLOWLIST',
    });
  });

  it('overrides beat targeting rules', () => {
    const flag = baseFlag({
      rules: [rule({ conditions: [{ attribute: 'plan', operator: 'eq', value: 'pro' }], serveValue: 'rule-value' })],
      overrides: { allowlist: [], blocklist: ['blocked'] },
    });
    expect(evaluateFlag(flag, { userId: 'blocked', attributes: { plan: 'pro' } })).toMatchObject({
      value: false,
      reason: 'EXPLICIT_BLOCKLIST',
    });
  });
});

describe('condition operators', () => {
  const ctx = {
    userId: 'u_42',
    attributes: { plan: 'pro', country: 'IN', appVersion: '2.4.1', betaOptIn: true, seats: 25 },
  };

  const cases: Array<[Parameters<typeof conditionMatches>[0], boolean]> = [
    [{ attribute: 'plan', operator: 'eq', value: 'pro' }, true],
    [{ attribute: 'plan', operator: 'eq', value: 'free' }, false],
    [{ attribute: 'plan', operator: 'neq', value: 'free' }, true],
    [{ attribute: 'country', operator: 'in', value: ['IN', 'US'] }, true],
    [{ attribute: 'country', operator: 'in', value: ['US', 'DE'] }, false],
    [{ attribute: 'country', operator: 'not_in', value: ['US', 'DE'] }, true],
    [{ attribute: 'seats', operator: 'gt', value: 10 }, true],
    [{ attribute: 'seats', operator: 'gte', value: 25 }, true],
    [{ attribute: 'seats', operator: 'lt', value: 100 }, true],
    [{ attribute: 'seats', operator: 'lte', value: 24 }, false],
    [{ attribute: 'appVersion', operator: 'semver_gte', value: '2.4.0' }, true],
    [{ attribute: 'appVersion', operator: 'semver_gte', value: '2.10.0' }, false],
    [{ attribute: 'appVersion', operator: 'semver_lt', value: '2.0.0' }, false],
    [{ attribute: 'appVersion', operator: 'semver_lt', value: '3.0.0' }, true],
    [{ attribute: 'betaOptIn', operator: 'eq', value: true }, true],
  ];

  it.each(cases)('%o => %s', (condition, expected) => {
    expect(conditionMatches(condition, ctx)).toBe(expected);
  });

  it('returns false for a missing attribute', () => {
    expect(conditionMatches({ attribute: 'nope', operator: 'eq', value: 1 }, ctx)).toBe(false);
  });

  it('returns false for an invalid semver attribute', () => {
    expect(
      conditionMatches(
        { attribute: 'plan', operator: 'semver_gte', value: '2.0.0' },
        ctx,
      ),
    ).toBe(false);
  });
});

describe('rule condition combinators', () => {
  it('AND requires all conditions; empty AND matches everyone', () => {
    expect(ruleConditionsMatch(rule({ matchType: 'AND', conditions: [] }), { userId: 'u' })).toBe(true);
    expect(
      ruleConditionsMatch(
        rule({
          matchType: 'AND',
          conditions: [
            { attribute: 'plan', operator: 'eq', value: 'pro' },
            { attribute: 'country', operator: 'eq', value: 'US' },
          ],
        }),
        { userId: 'u', attributes: { plan: 'pro', country: 'IN' } },
      ),
    ).toBe(false);
  });

  it('OR requires at least one; empty OR matches no one', () => {
    expect(
      ruleConditionsMatch(
        rule({
          matchType: 'OR',
          conditions: [
            { attribute: 'plan', operator: 'eq', value: 'pro' },
            { attribute: 'country', operator: 'eq', value: 'US' },
          ],
        }),
        { userId: 'u', attributes: { plan: 'free', country: 'US' } },
      ),
    ).toBe(true);
    expect(ruleConditionsMatch(rule({ matchType: 'OR', conditions: [] }), { userId: 'u' })).toBe(false);
  });
});

describe('percentage rollout + fallback', () => {
  it('a 100% rule serves its value with rule metadata', () => {
    const flag = baseFlag({ rules: [rule({ serveValue: 'on', rolloutPercentage: 100 })] });
    const res = evaluateFlag(flag, { userId: 'u1' });
    expect(res).toMatchObject({ value: 'on', reason: 'RULE_MATCH', ruleId: 'r1' });
    expect(res.bucket).toBeGreaterThanOrEqual(0);
    expect(res.bucket).toBeLessThan(100);
  });

  it('a 0% rule never matches and falls through to default', () => {
    const flag = baseFlag({ rules: [rule({ rolloutPercentage: 0 })] });
    expect(evaluateFlag(flag, { userId: 'u1' })).toMatchObject({
      value: false,
      reason: 'DEFAULT_FALLBACK',
    });
  });

  it('rollout is deterministic for a given user', () => {
    const flag = baseFlag({ rules: [rule({ rolloutPercentage: 50 })] });
    const first = evaluateFlag(flag, { userId: 'stable-user' });
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag, { userId: 'stable-user' })).toEqual(first);
    }
  });

  it('a ~25% rollout lands near 25% of a large cohort', () => {
    const flag = baseFlag({ rules: [rule({ rolloutPercentage: 25, serveValue: true })] });
    let matched = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (evaluateFlag(flag, { userId: `user_${i}` }).value === true) matched += 1;
    }
    const pct = (matched / n) * 100;
    expect(pct).toBeGreaterThan(23);
    expect(pct).toBeLessThan(27);
  });

  it('a matched-but-outside-rollout rule falls through to the next rule', () => {
    const flag = baseFlag({
      rules: [
        rule({ id: 'narrow', conditions: [{ attribute: 'plan', operator: 'eq', value: 'pro' }], rolloutPercentage: 0 }),
        rule({ id: 'broad', conditions: [], rolloutPercentage: 100, serveValue: 'fallback-rule' }),
      ],
    });
    expect(evaluateFlag(flag, { userId: 'u1', attributes: { plan: 'pro' } })).toMatchObject({
      value: 'fallback-rule',
      ruleId: 'broad',
    });
  });
});

describe('evaluateAll', () => {
  it('evaluates every flag in a snapshot', () => {
    const flags: Record<string, FlagConfig> = {
      a: baseFlag({ key: 'a', defaultValue: 'x' }),
      b: baseFlag({ key: 'b', enabled: false, defaultValue: 'y' }),
    };
    const results = evaluateAll(flags, { userId: 'u1' });
    expect(results.a).toMatchObject({ value: 'x', reason: 'DEFAULT_FALLBACK' });
    expect(results.b).toMatchObject({ value: 'y', reason: 'KILL_SWITCH_OFF' });
  });
});
