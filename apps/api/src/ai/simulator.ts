import { evaluateFlag, type FlagConfig, type TargetingRule } from '@flagforge/evaluator';
import {
  DATASET_TOTAL,
  SYNTHETIC_USERS,
  publicUser,
  toEvaluationContext,
  type SyntheticUser,
} from './synthetic-users.js';

export interface BreakdownEntry {
  key: string;
  total: number;
  matched: number;
}

export interface SimulationResult {
  totalUsers: number;
  matchedUsers: number;
  percentage: number;
  sampleMatchedUsers: ReturnType<typeof publicUser>[];
  sampleExcludedUsers: ReturnType<typeof publicUser>[];
  breakdown: {
    byPlan: BreakdownEntry[];
    byCountry: BreakdownEntry[];
  };
}

interface Bucket {
  total: number;
  matched: number;
}

function bump(map: Map<string, Bucket>, key: string, matched: boolean): void {
  const entry = map.get(key) ?? { total: 0, matched: 0 };
  entry.total += 1;
  if (matched) entry.matched += 1;
  map.set(key, entry);
}

function toBreakdown(map: Map<string, Bucket>): BreakdownEntry[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, total: v.total, matched: v.matched }))
    .sort((a, b) => b.matched - a.matched || a.key.localeCompare(b.key));
}

/**
 * Dry-run blast-radius simulator.
 *
 * Runs a candidate rule in memory across the seeded 1,000-user cohort using the
 * *same* evaluator the data plane uses. `RULE_MATCH` is the match signal (not the
 * served value), so rules that serve `false` are still counted accurately.
 */
export function simulateRule(
  flagKey: string,
  rule: TargetingRule,
  options: { users?: readonly SyntheticUser[]; sampleSize?: number } = {},
): SimulationResult {
  const users = options.users ?? SYNTHETIC_USERS;
  const sampleSize = options.sampleSize ?? 8;

  const flag: FlagConfig = {
    key: flagKey,
    enabled: true,
    defaultValue: false,
    rules: [rule],
    overrides: { allowlist: [], blocklist: [] },
    version: 1,
  };

  const matched: SyntheticUser[] = [];
  const excluded: SyntheticUser[] = [];
  const byPlan = new Map<string, Bucket>();
  const byCountry = new Map<string, Bucket>();

  for (const user of users) {
    const result = evaluateFlag(flag, toEvaluationContext(user));
    const isMatch = result.reason === 'RULE_MATCH';
    if (isMatch) matched.push(user);
    else excluded.push(user);
    bump(byPlan, user.plan, isMatch);
    bump(byCountry, user.country, isMatch);
  }

  const totalUsers = users.length;
  const percentage =
    totalUsers === 0 ? 0 : Math.round((matched.length / totalUsers) * 10000) / 100;

  return {
    totalUsers,
    matchedUsers: matched.length,
    percentage,
    sampleMatchedUsers: matched.slice(0, sampleSize).map(publicUser),
    sampleExcludedUsers: excluded.slice(0, sampleSize).map(publicUser),
    breakdown: {
      byPlan: toBreakdown(byPlan),
      byCountry: toBreakdown(byCountry),
    },
  };
}

export { DATASET_TOTAL };