/**
 * MurmurHash3 (x86, 32-bit) — a pure TypeScript implementation.
 *
 * Chosen for sticky bucketing because it is fast, has excellent avalanche /
 * uniformity, and is fully deterministic across languages and platforms. The
 * same `flagKey:userId` string always maps to the same bucket, so a user never
 * flip-flops as they move between API instances or SDK restarts.
 *
 * Reference: Austin Appleby's original algorithm (public domain).
 */

/** Encode a JS string to UTF-8 bytes. */
function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/**
 * Hash an arbitrary string to an unsigned 32-bit integer.
 * @param key   Input string.
 * @param seed  Optional seed (default 0).
 */
export function murmurhash3_32(key: string, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  const bytes = utf8Bytes(key);
  const len = bytes.length;
  const nblocks = len >>> 2;

  let h1 = seed >>> 0;
  let k1 = 0;

  // ── Body: process 4-byte blocks ────────────────────────────────────────────
  for (let i = 0; i < nblocks; i++) {
    const i4 = i << 2;
    k1 =
      (bytes[i4]! & 0xff) |
      ((bytes[i4 + 1]! & 0xff) << 8) |
      ((bytes[i4 + 2]! & 0xff) << 16) |
      ((bytes[i4 + 3]! & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  // ── Tail: remaining 1–3 bytes ──────────────────────────────────────────────
  k1 = 0;
  const tail = nblocks << 2;
  const remainder = len & 3;

  if (remainder === 3) {
    k1 ^= (bytes[tail + 2]! & 0xff) << 16;
  }
  if (remainder >= 2) {
    k1 ^= (bytes[tail + 1]! & 0xff) << 8;
  }
  if (remainder >= 1) {
    k1 ^= bytes[tail]! & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  // ── Finalization / avalanche ───────────────────────────────────────────────
  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Deterministic sticky bucket in `[0, 100)`.
 *
 * The salt is the flag key, so the same user lands in an independent position
 * for every flag — enabling a percentage rollout on one flag without
 * correlating it with another.
 */
export function bucketFor(flagKey: string, userId: string, seed = 0): number {
  return murmurhash3_32(`${flagKey}:${userId}`, seed) % 100;
}
