import { describe, expect, it } from 'vitest';
import {
  deriveDisplayName,
  handleCandidates,
  slugifyHandle,
} from '../src/domain/profile.js';

describe('profile domain', () => {
  it('selects display name, full name, then deterministic fallback', () => {
    expect(
      deriveDisplayName('user_1', { displayName: '  Ada Online  ', firstName: 'Ada', lastName: 'Lovelace' })
    ).toBe('Ada Online');
    expect(deriveDisplayName('user_1', { firstName: ' Ada ', lastName: ' Lovelace ' })).toBe(
      'Ada Lovelace'
    );
    expect(deriveDisplayName('user_1', {})).toBe(deriveDisplayName('user_1', {}));
    expect(deriveDisplayName('user_1', {})).not.toBe(deriveDisplayName('user_2', {}));
    expect(deriveDisplayName('user_1', {}, () => '  Quiet   Heron ')).toBe('Quiet Heron');
  });

  it('preserves display-name casing and Unicode while rejecting empty ASCII slugs', () => {
    expect(deriveDisplayName('user_1', { displayName: '  李   小龍  ' })).toBe('李 小龍');
    expect(() => slugifyHandle('李小龍', 1, 30)).toThrow('cannot produce a valid handle');
  });

  it('normalizes unicode, separators, and configurable bounds', () => {
    expect(slugifyHandle('  Héllo___WÖRLD!! ', 1, 30)).toBe('hello-world');
    expect(slugifyHandle('abcdefgh', 1, 5)).toBe('abcde');
    expect(() => slugifyHandle('---', 1, 30)).toThrow('cannot produce a valid handle');
  });

  it('avoids reserved base handles and emits bounded collision candidates', () => {
    const suffixes = ['a1b2', 'c3d4'];
    expect([
      ...handleCandidates('Admin', {
        minLength: 1,
        maxLength: 12,
        reserved: new Set(['admin']),
        attempts: 2,
        nextSuffix: () => suffixes.shift() ?? 'ffff',
      }),
    ]).toEqual(['admin-a1b2', 'admin-c3d4']);

    expect([
      ...handleCandidates('x', {
        minLength: 1,
        maxLength: 3,
        reserved: new Set(['x']),
        attempts: 1,
        nextSuffix: () => 'abcdef',
      }),
    ]).toEqual(['abc']);
  });
});
