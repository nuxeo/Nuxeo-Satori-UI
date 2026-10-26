import { describe, expect, it } from 'vitest';
import { avatarColor } from './avatar-colors';

describe('avatarColor', () => {
  it('gives the same colour for the same name', () => {
    expect(avatarColor('jdoe')).toBe(avatarColor('jdoe'));
  });

  it('falls back to blue for an empty name', () => {
    expect(avatarColor('')).toBe('blue');
  });

  it('spreads names across more than one colour', () => {
    const names = ['Administrator', 'jdoe', 'alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
    expect(new Set(names.map(avatarColor)).size).toBeGreaterThan(1);
  });
});
