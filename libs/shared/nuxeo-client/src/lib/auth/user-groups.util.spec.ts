import { describe, expect, it } from 'vitest';

import { isPowerUserFromGroups, readAllGroupsFromMe, readGroupsFromMe } from './user-groups.util';

describe('readGroupsFromMe', () => {
  it('returns groups from properties', () => {
    expect(
      readGroupsFromMe({
        properties: { groups: ['members', 'powerusers'] },
      }),
    ).toEqual(['members', 'powerusers']);
  });

  it('returns empty array when groups are missing', () => {
    expect(readGroupsFromMe({ properties: {} })).toEqual([]);
    expect(readGroupsFromMe(null)).toEqual([]);
  });
});

/** What `app.rules.inGroup` reads: Nuxeo's own idea of membership, not the stored groups alone. */
describe('readAllGroupsFromMe', () => {
  it('adds the parent and virtual groups `extendedGroups` reports to the stored ones', () => {
    expect(
      readAllGroupsFromMe({
        properties: { groups: ['claims-team'] },
        extendedGroups: [
          { name: 'claims-team', label: 'Claims team' },
          { name: 'member-services', label: 'Member services' },
          { name: 'members', label: 'Members group' },
        ],
      }),
    ).toEqual(['claims-team', 'member-services', 'members']);
  });

  it('reads an entry written as a bare name, and skips what names no group', () => {
    expect(
      readAllGroupsFromMe({
        extendedGroups: ['members', { label: 'no name' }, { name: '' }, 7, null],
      }),
    ).toEqual(['members']);
  });

  it('is the stored groups when `extendedGroups` is absent, and none for no payload', () => {
    expect(readAllGroupsFromMe({ properties: { groups: ['members'] } })).toEqual(['members']);
    expect(readAllGroupsFromMe(null)).toEqual([]);
  });
});

describe('isPowerUserFromGroups', () => {
  it('detects powerusers membership case-insensitively', () => {
    expect(isPowerUserFromGroups(['members', 'powerusers'])).toBe(true);
    expect(isPowerUserFromGroups(['PowerUsers'])).toBe(true);
    expect(isPowerUserFromGroups(['members'])).toBe(false);
  });
});
