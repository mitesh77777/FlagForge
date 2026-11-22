import { bucketFor } from './murmur3.js';
import { isValidSemver, semverGte, semverLt } from './semver.js';
import type {
  Condition,
  EvaluationContext,
  EvaluationResult,
  FlagConfig,
  JsonValue,
  TargetingRule,
} from './types.js';

/**
 * The deterministic evaluation engine.
 *
 * Strict precedence (first match wins):
 *   1. Kill switch  — flag disabled ⇒ serve default.
 *   2. Blocklist    — force `false`.
 *   3. Allowlist    — force `true`.
 *   4. Ordered rules — evaluate conditions, then percentage bucketing.
 *   5. Fallback     — serve default.
 *
 * This module performs **zero I/O** and has no dependencies beyond the two pure
 * helpers imported above, so it can run in the API, in tests, in a browser SDK,
 * or in an edge worker.
 */

/** Resolve an attribute from the context (supports the reserved `userId`). */
function readAttribute(
  context: EvaluationContext,
  attribute: string,
): string | number | boolean | undefined {
  if (attribute === 'userId') return context.userId;
  return context.attributes?.[attribute];
}

/** Best-effort numeric coercion; returns `NaN` when impossible. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** Loose-but-predictable equality used by `eq`, `neq` and `in`/`not_in`. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aNum = typeof a === 'number';
  const bNum = typeof b === 'number';
  if (aNum && bNum) return a === b;
  // Allow numeric-string / number equivalence (e.g. "2" == 2).
  const na = toNumber(a);
  const nb = toNumber(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    const aPrimitive = typeof a === 'string' || typeof a === 'number';
    const bPrimitive = typeof b === 'string' || typeof b === 'number';
    if (aPrimitive && bPrimitive) return na === nb;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const ba = a === true || a === 'true';
    const bb = b === true || b === 'true';
    return ba === bb;
  }
  return false;
}

/** Evaluate a single condition against the context. */
export function conditionMatches(
  condition: Condition,
  context: EvaluationContext,
): boolean {
  const actual = readAttribute(context, condition.attribute);
  if (actual === undefined) return false;

  const { operator, value } = condition;

  switch (operator) {
    case 'eq':
      return valuesEqual(actual, value);
    case 'neq':
      return !valuesEqual(actual, value);
    case 'in':
      return Array.isArray(value) && value.some((v) => valuesEqual(actual, v));
    case 'not_in':
      return Array.isArray(value) && !value.some((v) => valuesEqual(actual, v));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(actual);
      const b = toNumber(value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (operator === 'gt') return a > b;
      if (operator === 'gte') return a >= b;
      if (operator === 'lt') return a < b;
      return a <= b; // lte
    }
    case 'semver_gte':
    case 'semver_lt': {
      const a = String(actual);
      const b = String(value);
      if (!isValidSemver(a) || !isValidSemver(b)) return false;
      return operator === 'semver_gte' ? semverGte(a, b) : semverLt(a, b);
    }
    default:
      return false;
  }
}

/**
 * Evaluate a rule's condition set. `AND` over an empty set is vacuously `true`
 * (matches everyone — used for pure-percentage rollouts); `OR` over an empty set
 * is `false`.
 */
export function ruleConditionsMatch(
  rule: TargetingRule,
  context: EvaluationContext,
): boolean {
  const matchType = rule.matchType ?? 'AND';
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) return matchType === 'AND';
  if (matchType === 'OR') {
    return conditions.some((c) => conditionMatches(c, context));
  }
  return conditions.every((c) => conditionMatches(c, context));
}

/** Clamp a rollout percentage into the legal `[0, 100]` integer range. */
function normalizeRollout(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(percentage)));
}

/**
 * Evaluate a single flag for a context.
 *
 * @example
 * const result = evaluateFlag(config, { userId: 'u_123', attributes: { plan: 'pro' } });
 */
export function evaluateFlag(
  flag: FlagConfig,
  context: EvaluationContext,
): EvaluationResult {
  // 1. Kill switch.
  if (!flag.enabled) {
    return { value: flag.defaultValue, reason: 'KILL_SWITCH_OFF', version: flag.version };
  }

  const overrides = flag.overrides ?? { allowlist: [], blocklist: [] };

  // 2. Explicit blocklist.
  if (overrides.blocklist?.includes(context.userId)) {
    return { value: false, reason: 'EXPLICIT_BLOCKLIST', version: flag.version };
  }

  // 3. Explicit allowlist.
  if (overrides.allowlist?.includes(context.userId)) {
    return { value: true, reason: 'EXPLICIT_ALLOWLIST', version: flag.version };
  }

  // 4. Ordered targeting rules.
  for (const rule of flag.rules ?? []) {
    if (!ruleConditionsMatch(rule, context)) continue;

    const rollout = normalizeRollout(rule.rolloutPercentage);
    if (rollout <= 0) continue;

    const bucket = bucketFor(flag.key, context.userId);
    if (bucket < rollout) {
      return {
        value: rule.serveValue as JsonValue,
        reason: 'RULE_MATCH',
        ruleId: rule.id,
        bucket,
        version: flag.version,
      };
    }
    // Conditions matched but the user fell outside the rollout — try the next rule.
  }

  // 5. Fallback.
  return { value: flag.defaultValue, reason: 'DEFAULT_FALLBACK', version: flag.version };
}

/** Evaluate every flag in a snapshot for one context. */
export function evaluateAll(
  flags: Record<string, FlagConfig>,
  context: EvaluationContext,
): Record<string, EvaluationResult> {
  const out: Record<string, EvaluationResult> = {};
  for (const [key, config] of Object.entries(flags)) {
    out[key] = evaluateFlag(config, context);
  }
  return out;
}
