import { describe, expect, it } from 'vitest';
import {
  isPreviousKeyValid,
  previousKeyRemainingMs,
  rotationExpiry,
} from './rotation.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('rotationExpiry', () => {
  it('returns an expiry graceSeconds ahead', () => {
    expect(rotationExpiry(3600, NOW)?.toISOString()).toBe(
      '2026-01-01T01:00:00.000Z',
    );
    expect(rotationExpiry(86_400, NOW)?.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
  });

  it('disables the grace window for zero or negative values', () => {
    expect(rotationExpiry(0, NOW)).toBeNull();
    expect(rotationExpiry(-1, NOW)).toBeNull();
    expect(rotationExpiry(Number.NaN, NOW)).toBeNull();
    expect(rotationExpiry(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });

  it('floors fractional seconds rather than producing sub-millisecond dates', () => {
    expect(rotationExpiry(1.9, NOW)?.getTime()).toBe(NOW.getTime() + 1000);
  });
});

describe('isPreviousKeyValid', () => {
  it('treats a null expiry as still valid', () => {
    expect(isPreviousKeyValid(null, NOW)).toBe(true);
  });

  it('accepts a future expiry and rejects a past one', () => {
    expect(isPreviousKeyValid(new Date(NOW.getTime() + 1000), NOW)).toBe(true);
    expect(isPreviousKeyValid(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
  });

  it('rejects an expiry exactly at now (boundary is exclusive)', () => {
    expect(isPreviousKeyValid(new Date(NOW.getTime()), NOW)).toBe(false);
  });
});

describe('previousKeyRemainingMs', () => {
  it('reports the remaining window, floored at zero', () => {
    expect(previousKeyRemainingMs(new Date(NOW.getTime() + 5000), NOW)).toBe(5000);
    expect(previousKeyRemainingMs(new Date(NOW.getTime() - 5000), NOW)).toBe(0);
    expect(previousKeyRemainingMs(null, NOW)).toBeNull();
  });
});
