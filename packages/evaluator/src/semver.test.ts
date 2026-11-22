import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  isValidSemver,
  parseSemver,
  semverGte,
  semverLt,
} from './semver.js';

describe('parseSemver', () => {
  it('parses full versions', () => {
    expect(parseSemver('2.10.0')).toEqual({
      major: 2,
      minor: 10,
      patch: 0,
      prerelease: [],
    });
  });

  it('defaults missing parts to zero', () => {
    expect(parseSemver('2')).toMatchObject({ major: 2, minor: 0, patch: 0 });
    expect(parseSemver('2.4')).toMatchObject({ major: 2, minor: 4, patch: 0 });
    expect(parseSemver('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('=1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });

  it('parses pre-release and ignores build metadata', () => {
    expect(parseSemver('1.2.3-beta.1')).toMatchObject({
      prerelease: ['beta', 1],
    });
    expect(parseSemver('1.2.3+build.99')).toMatchObject({ prerelease: [] });
  });

  it('rejects malformed strings', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(isValidSemver('2.4.0')).toBe(true);
    expect(isValidSemver('2.x.0')).toBe(false);
  });
});

describe('compareSemver', () => {
  it('compares numerically, not lexicographically', () => {
    expect(compareSemver('2.10.0', '2.4.1')).toBe(1);
    expect(compareSemver('2.4.1', '2.10.0')).toBe(-1);
    expect(compareSemver('10.0.0', '9.9.9')).toBe(1);
  });

  it('treats equal versions as equal', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.1', '2.1.0')).toBe(0);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0+build', '1.0.0')).toBe(0);
  });

  it('orders pre-releases below their release', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBe(1);
  });

  it('orders pre-release identifiers per SemVer 2.0', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBe(-1); // numeric < alphanumeric
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1); // fewer fields = lower
  });

  it('throws on invalid input', () => {
    expect(() => compareSemver('nope', '1.0.0')).toThrow();
  });
});

describe('semverGte / semverLt', () => {
  it('implements inclusive >= and strict <', () => {
    expect(semverGte('2.4.0', '2.4.0')).toBe(true);
    expect(semverGte('2.4.1', '2.4.0')).toBe(true);
    expect(semverGte('2.3.9', '2.4.0')).toBe(false);
    expect(semverLt('2.0.0', '2.0.0')).toBe(false);
    expect(semverLt('1.9.9', '2.0.0')).toBe(true);
  });
});
