import { createHash, randomBytes } from 'node:crypto';

/**
 * SDK keys are secrets. We only ever persist their SHA-256 hash; the raw key is
 * returned exactly once at creation time and never recoverable afterwards.
 *
 * Key format: `ff_<live|test>_<32 hex chars>` — the prefix is stored in clear so
 * the UI can show which key is which without revealing the secret.
 */

export type KeyTier = 'live' | 'test';

export function hashSdkKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function generateSdkKey(tier: KeyTier): string {
  return `ff_${tier}_${randomBytes(16).toString('hex')}`;
}

/** A stable, non-secret display prefix, e.g. `ff_live_a1b2c3d4`. */
export function sdkKeyPrefix(rawKey: string, length = 16): string {
  return rawKey.slice(0, length);
}

/** Constant-time-ish comparison for admin bearer tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
