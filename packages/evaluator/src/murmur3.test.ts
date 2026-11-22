import { describe, expect, it } from 'vitest';
import { bucketFor, murmurhash3_32 } from './murmur3.js';

describe('murmurhash3_32', () => {
  it('matches the canonical published test vectors (seed 0)', () => {
    expect(murmurhash3_32('')).toBe(0);
    expect(murmurhash3_32('hello')).toBe(613153351);
    expect(murmurhash3_32('a')).toBe(1009084850);
    expect(murmurhash3_32('abc')).toBe(3017643002);
    expect(murmurhash3_32('abcd')).toBe(1139631978); // 0x43ED676A
    expect(murmurhash3_32('The quick brown fox jumps over the lazy dog')).toBe(
      776992547,
    );
  });

  it('honours the seed parameter', () => {
    expect(murmurhash3_32('hello', 0)).not.toBe(murmurhash3_32('hello', 42));
  });

  it('is deterministic', () => {
    for (let i = 0; i < 100; i++) {
      const key = `user_${i}:flag-${i}`;
      expect(murmurhash3_32(key)).toBe(murmurhash3_32(key));
    }
  });

  it('always returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 5000; i++) {
      const h = murmurhash3_32(`${i}-${i * 7}-é-🌍`);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('bucketFor', () => {
  it('returns a bucket in [0, 100)', () => {
    for (let i = 0; i < 10_000; i++) {
      const b = bucketFor('new-checkout-flow', `user_${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is sticky per (flagKey, userId)', () => {
    expect(bucketFor('flag-a', 'user_1')).toBe(bucketFor('flag-a', 'user_1'));
  });

  it('distributes 10,000 users uniformly across all 100 buckets (±40% of mean)', () => {
    const counts = new Array<number>(100).fill(0);
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      counts[bucketFor('distribution-test', `user_${i}`)]! += 1;
    }

    const expected = total / 100; // 100
    const tolerance = expected * 0.4; // 40 → generous ~4σ for n=100

    for (const count of counts) {
      expect(count).toBeGreaterThan(expected - tolerance);
      expect(count).toBeLessThan(expected + tolerance);
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('is independent across flags for the same user (salt = flag key)', () => {
    let correlated = 0;
    const n = 5_000;
    for (let i = 0; i < n; i++) {
      const user = `user_${i}`;
      const b1 = bucketFor('flag-one', user);
      const b2 = bucketFor('flag-two', user);
      if ((b1 < 50 && b2 < 50) || (b1 >= 50 && b2 >= 50)) correlated += 1;
    }
    // If independent, ~50% agreement; allow a wide band.
    const ratio = correlated / n;
    expect(ratio).toBeGreaterThan(0.42);
    expect(ratio).toBeLessThan(0.58);
  });
});
