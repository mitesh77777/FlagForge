import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('produces a verifiable scrypt hash and never stores the password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('uses a random salt so identical passwords hash differently', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('demo1234');
    expect(await verifyPassword('demo1235', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('rejects malformed or unknown hash formats without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$aa$bb')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$$')).toBe(false);
  });

  it('is case-sensitive', async () => {
    const stored = await hashPassword('CaseSensitive');
    expect(await verifyPassword('casesensitive', stored)).toBe(false);
  });
});