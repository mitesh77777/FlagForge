/**
 * A small, dependency-free Semantic Versioning comparator.
 *
 * Supports the subset our operators need:
 *   - `1.2.3`, `1.2`, `1` (missing parts default to 0)
 *   - optional leading `v` or `=`
 *   - pre-release tags (`1.2.3-beta.1`) where a pre-release sorts *before* its
 *     release (`1.2.3-beta < 1.2.3`)
 *   - build metadata (`1.2.3+build`) which is ignored for precedence
 *
 * Numeric identifiers compare numerically (`10 > 4`), so `2.10.0 > 2.4.1`.
 */

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const SEMVER_RE =
  /^[=v\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

/** Parse a loose semver string. Returns `null` when unparseable. */
export function parseSemver(input: string): ParsedSemver | null {
  if (typeof input !== 'string') return null;
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;

  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  const prerelease = (match[4] ?? '')
    .split('.')
    .filter((s) => s.length > 0)
    .map((id) => (/^\d+$/.test(id) ? Number(id) : id));

  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }

  return { major, minor, patch, prerelease };
}

/** True when `input` is a valid, parseable semver string. */
export function isValidSemver(input: string): boolean {
  return parseSemver(input) !== null;
}

/** Compare two pre-release identifier arrays per the SemVer 2.0 rule set. */
function comparePrerelease(
  a: Array<string | number>,
  b: Array<string | number>,
): number {
  // A version with a pre-release has lower precedence than one without.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNum = typeof left === 'number';
    const rightNum = typeof right === 'number';

    if (leftNum && rightNum) {
      if (left !== right) return left < right ? -1 : 1;
    } else if (leftNum !== rightNum) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return leftNum ? -1 : 1;
    } else {
      const l = String(left);
      const r = String(right);
      if (l !== r) return l < r ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two semver strings.
 * @returns `-1` if `a < b`, `0` if equal, `1` if `a > b`.
 * @throws when either version cannot be parsed.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    throw new Error(`invalid semver comparison: "${a}" vs "${b}"`);
  }

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** `actual >= target` (both semver strings). Throws on invalid input. */
export function semverGte(actual: string, target: string): boolean {
  return compareSemver(actual, target) >= 0;
}

/** `actual < target` (both semver strings). Throws on invalid input. */
export function semverLt(actual: string, target: string): boolean {
  return compareSemver(actual, target) < 0;
}
