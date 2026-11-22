import { describe, expect, it } from 'vitest';
import type { TargetingRule } from '@flagforge/evaluator';
import { simulateRule } from './simulator.js';
import { DATASET_TOTAL, SYNTHETIC_USERS } from './synthetic-users.js';

const ruleFor = (
  over: Partial<TargetingRule> = {},
): TargetingRule => ({
  id: 'sim',
  conditions: [],
  matchType: 'AND',
  rolloutPercentage: 100,
  serveValue: true,
  ...over,
});

describe('synthetic dataset', () => {
  it('is a deterministic cohort of exactly 1,000 users', () => {
    expect(DATASET_TOTAL).toBe(1000);
    expect(SYNTHETIC_USERS).toHaveLength(1000);
    expect(SYNTHETIC_USERS[0]?.userId).toBe('user_0001');
    // Deterministic across module loads is implied by the seeded PRNG; spot-check.
    expect(SYNTHETIC_USERS[999]?.userId).toBe('user_1000');
  });

  it('contains a realistic spread of plans, countries and versions', () => {
    const plans = new Set(SYNTHETIC_USERS.map((u) => u.plan));
    const countries = new Set(SYNTHETIC_USERS.map((u) => u.country));
    expect(plans.size).toBe(3);
    expect(countries.size).toBeGreaterThanOrEqual(8);
  });
});

describe('simulateRule', () => {
  it('counts every user for an empty 100% rule', () => {
    const sim = simulateRule('flag', ruleFor());
    expect(sim.totalUsers).toBe(1000);
    expect(sim.matchedUsers).toBe(1000);
    expect(sim.percentage).toBe(100);
  });

  it('counts zero for a 0% rule', () => {
    const sim = simulateRule('flag', ruleFor({ rolloutPercentage: 0 }));
    expect(sim.matchedUsers).toBe(0);
    expect(sim.percentage).toBe(0);
  });

  it('matches exactly the Pro cohort at 100%', () => {
    const proCount = SYNTHETIC_USERS.filter((u) => u.plan === 'pro').length;
    const sim = simulateRule(
      'flag',
      ruleFor({ conditions: [{ attribute: 'plan', operator: 'eq', value: 'pro' }] }),
    );
    expect(sim.matchedUsers).toBe(proCount);
    expect(sim.percentage).toBeCloseTo((proCount / 1000) * 100, 1);
  });

  it('counts RULE_MATCH even when the served value is false', () => {
    const sim = simulateRule(
      'flag',
      ruleFor({
        serveValue: false,
        conditions: [{ attribute: 'betaOptIn', operator: 'eq', value: true }],
      }),
    );
    const betaCount = SYNTHETIC_USERS.filter((u) => u.betaOptIn).length;
    expect(sim.matchedUsers).toBe(betaCount);
  });

  it('applies percentage rollout on top of attribute targeting', () => {
    const proCount = SYNTHETIC_USERS.filter((u) => u.plan === 'pro').length;
    const sim = simulateRule(
      'flag',
      ruleFor({
        rolloutPercentage: 25,
        conditions: [{ attribute: 'plan', operator: 'eq', value: 'pro' }],
      }),
    );
    // ~25% of ~350 pro users.
    expect(sim.matchedUsers).toBeGreaterThan(proCount * 0.18);
    expect(sim.matchedUsers).toBeLessThan(proCount * 0.32);
  });

  it('is deterministic across repeated runs', () => {
    const rule = ruleFor({
      rolloutPercentage: 37,
      conditions: [{ attribute: 'country', operator: 'in', value: ['IN', 'US'] }],
    });
    expect(simulateRule('flag', rule)).toEqual(simulateRule('flag', rule));
  });

  it('returns bounded samples and breakdowns that sum to the cohort', () => {
    const sim = simulateRule('flag', ruleFor({ rolloutPercentage: 50 }), {
      sampleSize: 5,
    });
    expect(sim.sampleMatchedUsers.length).toBeLessThanOrEqual(5);
    expect(sim.sampleExcludedUsers.length).toBeLessThanOrEqual(5);
    expect(sim.breakdown.byPlan.reduce((s, b) => s + b.total, 0)).toBe(1000);
    expect(sim.breakdown.byCountry.reduce((s, b) => s + b.total, 0)).toBe(1000);
  });

  it('holds the blast radius near the requested percentage', () => {
    const sim = simulateRule('flag', ruleFor({ rolloutPercentage: 30 }));
    expect(sim.percentage).toBeGreaterThan(27);
    expect(sim.percentage).toBeLessThan(33);
  });
});