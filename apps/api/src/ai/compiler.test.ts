import { describe, expect, it } from 'vitest';
import { targetingRuleSchema } from '../schemas.js';
import { loadConfig } from '../config.js';
import { compileRule, heuristicCompile } from './compiler.js';

const emptyConfig = loadConfig({} as NodeJS.ProcessEnv);

describe('heuristicCompile (offline fallback)', () => {
  it('compiles the canonical example: 25% of Pro users in India on app >= 2.4.0', () => {
    const { rule } = heuristicCompile(
      'Enable for 25% of Pro users in India on app version 2.4.0 or higher',
      'new-checkout-flow',
    );

    expect(rule.rolloutPercentage).toBe(25);
    expect(rule.matchType).toBe('AND');
    expect(rule.serveValue).toBe(true);
    expect(rule.conditions).toEqual(
      expect.arrayContaining([
        { attribute: 'plan', operator: 'eq', value: 'pro' },
        { attribute: 'country', operator: 'eq', value: 'IN' },
        { attribute: 'appVersion', operator: 'semver_gte', value: '2.4.0' },
      ]),
    );
    expect(targetingRuleSchema.parse(rule)).toEqual(rule);
  });

  it('detects negative intent and semver_lt', () => {
    const { rule } = heuristicCompile(
      'Turn off for free users below app version 2.0.0',
      'dark-mode-default',
    );
    expect(rule.serveValue).toBe(false);
    expect(rule.conditions).toEqual(
      expect.arrayContaining([
        { attribute: 'plan', operator: 'eq', value: 'free' },
        { attribute: 'appVersion', operator: 'semver_lt', value: '2.0.0' },
      ]),
    );
  });

  it('supports multi-country rollouts', () => {
    const { rule } = heuristicCompile(
      'Roll out to enterprise users in the US and Germany',
      'pricing-page-v2',
    );
    expect(rule.rolloutPercentage).toBe(100);
    const country = rule.conditions.find((c) => c.attribute === 'country');
    expect(country?.operator).toBe('in');
    expect(country?.value).toEqual(expect.arrayContaining(['US', 'DE']));
  });

  it('defaults to 100% when no percentage is given', () => {
    const { rule } = heuristicCompile('Enable for beta users', 'ai-search-beta');
    expect(rule.rolloutPercentage).toBe(100);
    expect(rule.conditions).toContainEqual({
      attribute: 'betaOptIn',
      operator: 'eq',
      value: true,
    });
  });

  it('warns when nothing specific can be parsed', () => {
    const { rule, warnings } = heuristicCompile('make it better somehow', 'x');
    expect(rule.rolloutPercentage).toBe(100);
    expect(rule.conditions).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('clamps out-of-range percentages', () => {
    const { rule } = heuristicCompile('enable for 250% of users', 'x');
    expect(rule.rolloutPercentage).toBe(100);
  });

  it('always produces a schema-valid rule with a stable id', () => {
    const { rule } = heuristicCompile('Enable for pro users in India', 'my-flag');
    expect(rule.id).toMatch(/^ai_/);
    expect(() => targetingRuleSchema.parse(rule)).not.toThrow();
  });
});

describe('compileRule without an LLM key', () => {
  it('falls back deterministically and reports why', async () => {
    const result = await compileRule(
      {
        prompt: 'Enable for 25% of Pro users in India on app version 2.4.0 or higher',
        flagKey: 'new-checkout-flow',
      },
      emptyConfig,
    );

    expect(result.source).toBe('fallback');
    expect(result.model).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/LLM_API_KEY is not set/i);
    expect(result.compiledRule.rolloutPercentage).toBe(25);
    expect(result.diff.before).toBeNull();
    expect(result.diff.after).toEqual(result.compiledRule);
    expect(() => targetingRuleSchema.parse(result.compiledRule)).not.toThrow();
  });

  it('includes the previous rule in the diff when provided', async () => {
    const currentRule = {
      id: 'old',
      conditions: [],
      matchType: 'AND' as const,
      rolloutPercentage: 10,
      serveValue: true,
    };
    const result = await compileRule(
      { prompt: 'everyone on pro', flagKey: 'f', currentRule },
      emptyConfig,
    );
    expect(result.diff.before).toEqual(currentRule);
  });
});