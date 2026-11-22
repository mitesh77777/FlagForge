/**
 * @flagforge/evaluator — shared type definitions.
 *
 * These types are the *single source of truth* for the flag AST shared across the
 * data plane, control plane, SDK and database schema. They are intentionally
 * dependency-free JSON-compatible shapes so they can be persisted as JSONB and
 * transported over HTTP/SSE without transformation.
 */

/** A JSON-serialisable value. Flags can serve booleans or arbitrary JSON variants. */
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Operators supported by the targeting-rule condition evaluator. */
export const OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'semver_gte',
  'semver_lt',
] as const;

export type Operator = (typeof OPERATORS)[number];

/** How the conditions within a single rule are combined. */
export type MatchType = 'AND' | 'OR';

/** A single attribute predicate inside a targeting rule. */
export interface Condition {
  /** Context attribute to read, e.g. `plan`, `country`, `appVersion`, `betaOptIn`. */
  attribute: string;
  /** Comparison operator. */
  operator: Operator;
  /** Literal to compare against. For `in`/`not_in` this is an array. */
  value: JsonValue;
}

/** A single ordered targeting rule. */
export interface TargetingRule {
  /** Stable identifier, surfaced in evaluation reasons for debugging. */
  id: string;
  /** Optional human description of the segment. */
  description?: string;
  /** Predicates evaluated against the context attributes. */
  conditions: Condition[];
  /** Boolean combinator for `conditions` (defaults to `AND` when omitted). */
  matchType: MatchType;
  /** Integer 0–100. Deterministic percentage of the matched cohort to serve. */
  rolloutPercentage: number;
  /** Value served to users who fall inside the rollout bucket. */
  serveValue: JsonValue;
}

/** Explicit per-user overrides. Evaluated before any rule. */
export interface FlagOverrides {
  /** User IDs forced to `true`. */
  allowlist: string[];
  /** User IDs forced to `false`. */
  blocklist: string[];
}

/**
 * The complete, self-contained configuration for one flag inside one environment.
 * This is exactly the object cached in L1/L2 and streamed over SSE.
 */
export interface FlagConfig {
  key: string;
  name?: string;
  enabled: boolean;
  defaultValue: JsonValue;
  rules: TargetingRule[];
  overrides: FlagOverrides;
  /** Monotonic version, incremented on every control-plane mutation. */
  version: number;
}

/** The evaluation context supplied by a caller. */
export interface EvaluationContext {
  userId: string;
  attributes?: Record<string, string | number | boolean>;
}

/** Why an evaluation resolved to a particular value. Exposed for debugging/telemetry. */
export type EvaluationReason =
  | 'KILL_SWITCH_OFF'
  | 'EXPLICIT_BLOCKLIST'
  | 'EXPLICIT_ALLOWLIST'
  | 'RULE_MATCH'
  | 'DEFAULT_FALLBACK';

/** Result of a single flag evaluation. */
export interface EvaluationResult {
  value: JsonValue;
  reason: EvaluationReason;
  /** Present when `reason === 'RULE_MATCH'`. */
  ruleId?: string;
  /** Deterministic hash bucket (0–99) when bucketing was performed. */
  bucket?: number;
  /** The flag version used to produce this result. */
  version: number;
}

/** A snapshot of all flags for one environment, used to bootstrap the SDK. */
export interface FlagSnapshot {
  environmentId: string;
  /** Monotonic config version of the snapshot (max flag version or explicit). */
  version: number;
  flags: Record<string, FlagConfig>;
}
