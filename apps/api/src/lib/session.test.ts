import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  extractBearerToken,
  verifySessionToken,
} from './session.js';

const SECRET = 'test-secret-value';
const NOW = Date.UTC(2026, 0, 1);

describe('session tokens', () => {
  it('round-trips a user id', () => {
    const token = createSessionToken('user-123', SECRET, 3600, NOW);
    const payload = verifySessionToken(token, SECRET, NOW + 1000);
    expect(payload).toEqual({ sub: 'user-123', exp: Math.floor(NOW / 1000) + 3600 });
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken('user-123', SECRET, 3600, NOW);
    expect(verifySessionToken(token, 'other-secret', NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken('user-123', SECRET, 3600, NOW);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'attacker', exp: Math.floor(NOW / 1000) + 3600 }),
    ).toString('base64url');
    expect(verifySessionToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken('user-123', SECRET, 60, NOW);
    expect(verifySessionToken(token, SECRET, NOW + 61_000)).toBeNull();
    expect(verifySessionToken(token, SECRET, NOW + 59_000)).not.toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', '.', 'abc', 'abc.', '.def', 'a.b.c']) {
      expect(verifySessionToken(bad, SECRET, NOW)).toBeNull();
    }
  });
});

describe('extractBearerToken', () => {
  it('parses the bearer scheme case-insensitively', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('bearer   abc.def  ')).toBe('abc.def');
  });

  it('returns null for missing or non-bearer headers', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});