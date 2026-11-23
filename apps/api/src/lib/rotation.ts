/**
 * Zero-downtime SDK key rotation.
 *
 * Rotating a key is a *cutover*: every client holding the old key starts failing
 * the moment the hash changes. On a rolling deploy that means a window in which
 * some instances serve traffic from processes that have not yet picked up the
 * new key — a self-inflicted outage.
 *
 * So a rotation keeps the outgoing key in a secondary slot with a bounded
 * expiry. Both keys authenticate during the window; the old one is dropped
 * automatically once it lapses.
 */

/**
 * Expiry for the outgoing key. `graceSeconds <= 0` disables the grace window
 * entirely (a hard cutover), which returns `null` — "no previous key".
 */
export function rotationExpiry(
  graceSeconds: number,
  now: Date = new Date(),
): Date | null {
  if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) return null;
  return new Date(now.getTime() + Math.floor(graceSeconds) * 1000);
}

/**
 * How long a previous key remains valid, or `null` when it never expires.
 *
 * A `null` expiry is only reachable when a row was written outside this helper
 * (e.g. hand-edited), and is deliberately treated as "valid" rather than
 * silently rejecting traffic.
 */
export function previousKeyRemainingMs(
  expiresAt: Date | null,
  now: Date = new Date(),
): number | null {
  if (!expiresAt) return null;
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

/** True when an outgoing key should still authenticate. */
export function isPreviousKeyValid(
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() > now.getTime();
}
