/**
 * @flagforge/evaluator — public surface.
 *
 * A pure, zero-I/O, dependency-free flag evaluation engine:
 *   - `murmurhash3_32` / `bucketFor`  — deterministic sticky bucketing
 *   - `compareSemver` / `semverGte`   — SemVer 2.0 precedence
 *   - `evaluateFlag` / `evaluateAll`  — the precedence-ordered rule engine
 */
export * from './types.js';
export { murmurhash3_32, bucketFor } from './murmur3.js';
export {
  parseSemver,
  isValidSemver,
  compareSemver,
  semverGte,
  semverLt,
  type ParsedSemver,
} from './semver.js';
export {
  evaluateFlag,
  evaluateAll,
  conditionMatches,
  ruleConditionsMatch,
} from './evaluate.js';
