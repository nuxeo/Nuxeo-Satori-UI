import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NuxeoAce, NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  NXS_STANDARD_PERMISSIONS,
  dateToWrite,
  dayToDate,
  instantToDay,
  isInheritanceMarker,
  offeredPermissions,
  permissionCatalogue,
  readSnapshot,
  refusalsFor,
  toDay,
  unconfirmedChanges,
  type NxsAceRow,
  type NxsPermissionChange,
  type NxsPermissionsSnapshot,
} from './permissions-model';

/** The 33 permissions a stock 2025.26.16 server reports to an `Everything` holder. */
const SERVER_33 = [
  'Write',
  'WriteVersion',
  'ReadProperties',
  'ReadCanCollect',
  'ReadSecurity',
  'Remove',
  'ReadVersion',
  'Read',
  'WriteLifeCycle',
  'Everything',
  'Moderate',
  'Version',
  'ManageLegalHold',
  'MakeRecord',
  'WriteColdStorage',
  'ReadChildren',
  'AddChildren',
  'Comment',
  'ReadLifeCycle',
  'RemoveChildren',
  'DataVisualization',
  'ReviewParticipant',
  'UnsetRetention',
  'Unlock',
  'CanAskForPublishing',
  'RestrictedRead',
  'ReadWrite',
  'ReadRemove',
  'Browse',
  'SetRetention',
  'WriteProperties',
  'WriteSecurity',
  'ManageWorkflows',
];

function ace(overrides: Partial<NuxeoAce> = {}): NuxeoAce {
  const username = overrides.username ?? 'jdoe';
  const permission = overrides.permission ?? 'Read';
  return {
    id: `${username}:${permission}:true:Administrator::`,
    username,
    externalUser: false,
    permission,
    granted: true,
    creator: 'Administrator',
    begin: null,
    end: null,
    status: 'effective',
    ...overrides,
  };
}

function doc(
  acls: unknown,
  context: Record<string, unknown> = {},
  overrides: Partial<NuxeoDocument> = {},
): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'ACL beyond three levels',
    type: 'Folder',
    path: '/default-domain/workspaces/parity/acl',
    properties: {},
    contextParameters: {
      acls,
      permissions: SERVER_33,
      userVisiblePermissions: ['Read', 'ReadWrite', 'Everything'],
      ...context,
    },
    ...overrides,
  } as NuxeoDocument;
}

function row(overrides: Partial<NxsAceRow> = {}): NxsAceRow {
  const principal = overrides.principal ?? 'jdoe';
  const permission = overrides.permission ?? 'Read';
  return {
    id: `${principal}:${permission}:true:Administrator::`,
    principal,
    principalLabel: '',
    permission,
    granted: true,
    begin: null,
    end: null,
    status: 'effective',
    creator: 'Administrator',
    acl: 'local',
    ...overrides,
  };
}

function snapshot(
  local: NxsAceRow[],
  defined: readonly string[] | null = SERVER_33,
): NxsPermissionsSnapshot {
  return {
    uid: 'doc-1',
    title: 'Doc',
    canManage: true,
    local,
    inherited: [],
    otherAcls: [],
    inheritanceBlocked: false,
    catalogue: { suggested: ['Read', 'ReadWrite', 'Everything'], standard: [], other: [], defined },
  };
}

describe('readSnapshot', () => {
  it('splits local, inherited and other named ACLs, in server order', () => {
    const result = readSnapshot(
      doc([
        {
          name: 'local',
          aces: [
            ace({ username: 'parity-user', permission: 'AddChildren' }),
            ace({ username: 'members', permission: 'ReadWrite' }),
          ],
        },
        {
          name: 'inherited',
          aces: [ace({ username: 'Administrator', permission: 'Everything' })],
        },
        { name: 'workflow', aces: [ace({ username: 'reviewers', permission: 'Write' })] },
      ]),
    );
    expect(result.local.map((r) => `${r.principal}:${r.permission}`)).toEqual([
      'parity-user:AddChildren',
      'members:ReadWrite',
    ]);
    expect(result.inherited.map((r) => r.principal)).toEqual(['Administrator']);
    expect(result.otherAcls).toEqual([
      expect.objectContaining({ principal: 'reviewers', permission: 'Write', acl: 'workflow' }),
    ]);
    expect(result.title).toBe('ACL beyond three levels');
    expect(result.inheritanceBlocked).toBe(false);
  });

  it('reads blocked inheritance from the Everyone deny, not from a missing inherited ACL', () => {
    const blocked = readSnapshot(
      doc([
        {
          name: 'local',
          aces: [
            ace({ username: 'Administrator', permission: 'Everything' }),
            ace({ username: 'Everyone', permission: 'Everything', granted: false }),
          ],
        },
      ]),
    );
    expect(blocked.inheritanceBlocked).toBe(true);
    expect(blocked.local.map((r) => r.principal)).toEqual(['Administrator']);

    // The repository root carries a local ACL and no inherited one, and is not blocked.
    const root = readSnapshot(
      doc([{ name: 'local', aces: [ace({ username: 'administrators' })] }]),
    );
    expect(root.inheritanceBlocked).toBe(false);
    expect(root.inherited).toEqual([]);
  });

  it('leaves external users to the host and keeps other denies as rows', () => {
    const result = readSnapshot(
      doc([
        {
          name: 'local',
          aces: [
            ace({ username: 'transient/guest@example.com', externalUser: true }),
            ace({ username: 'jdoe', permission: 'Remove', granted: false }),
          ],
        },
      ]),
    );
    expect(result.local).toEqual([
      expect.objectContaining({ principal: 'jdoe', permission: 'Remove', granted: false }),
    ]);
  });

  it('leaves external users to the host in every ACL, not only the local one', () => {
    // The host tabs list external sharing from every ACL, so a row here would show it twice.
    const result = readSnapshot(
      doc([
        { name: 'local', aces: [ace({ username: 'jdoe' })] },
        {
          name: 'inherited',
          aces: [
            ace({ username: 'transient/guest@example.com', externalUser: true }),
            ace({ username: 'members' }),
          ],
        },
        {
          name: 'workflow',
          aces: [ace({ username: 'transient/reviewer@example.com', externalUser: true })],
        },
      ]),
    );
    expect(result.inherited.map((r) => r.principal)).toEqual(['members']);
    expect(result.otherAcls).toEqual([]);
  });

  it('resolves extended principals and reads the @acl adapter shape', () => {
    const result = readSnapshot(
      doc([
        {
          name: 'local',
          // The server's own shapes: `fetch-acls: extended` sends principals as objects.
          ace: [
            {
              ...ace({ begin: '2030-01-01T00:00:00.000Z' }),
              username: { id: 'probe-user', properties: { username: 'probe-user' } },
              creator: { id: 'Administrator' },
              status: 'surprising',
            },
          ],
        },
      ]),
    );
    expect(result.local[0]).toMatchObject({
      principal: 'probe-user',
      creator: 'Administrator',
      status: null,
      begin: '2030-01-01T00:00:00.000Z',
    });
  });

  it('carries the display name the read resolved, and none when there is none', () => {
    const result = readSnapshot(
      doc([
        {
          name: 'local',
          aces: [
            { ...ace({ username: 'parity-user' }), usernameLabel: 'Parity User' },
            ace({ username: 'members' }),
          ],
        },
      ]),
    );
    expect(result.local.map((r) => r.principalLabel)).toEqual(['Parity User', '']);
  });

  it('keeps an ACE the server sent without an id or permission, with empty fields', () => {
    const result = readSnapshot(
      doc([{ name: 'local', aces: [{ username: 'jdoe', granted: true }] }]),
    );
    expect(result.local[0]).toMatchObject({ id: '', permission: '', creator: null });
  });

  it('offers editing only when the read says the user manages permissions', () => {
    expect(readSnapshot(doc([])).canManage).toBe(true);
    expect(readSnapshot(doc([], { permissions: ['Read', 'Browse'] })).canManage).toBe(false);
  });

  it('never offers editing on a version, though its enricher repeats the live document', () => {
    expect(readSnapshot(doc([], {}, { isVersion: true })).canManage).toBe(false);
    expect(readSnapshot(doc([], {}, { isVersion: false })).canManage).toBe(true);
  });

  it('refuses a read that carried no ACLs rather than showing none', () => {
    expect(() => readSnapshot(doc(undefined))).toThrow(/carried no ACLs/);
  });

  it('tolerates a document without a title or ACL entries', () => {
    const result = readSnapshot(doc([{ name: 'local' }, null], {}, { title: undefined }));
    expect(result.title).toBe('');
    expect(result.local).toEqual([]);
  });
});

describe('isInheritanceMarker', () => {
  it('is exactly the Everyone deny-Everything entry', () => {
    expect(
      isInheritanceMarker({ principal: 'Everyone', permission: 'Everything', granted: false }),
    ).toBe(true);
    expect(
      isInheritanceMarker({ principal: 'Everyone', permission: 'Everything', granted: true }),
    ).toBe(false);
    expect(isInheritanceMarker({ principal: 'Everyone', permission: 'Read', granted: false })).toBe(
      false,
    );
    expect(
      isInheritanceMarker({ principal: 'jdoe', permission: 'Everything', granted: false }),
    ).toBe(false);
  });
});

describe('permissionCatalogue', () => {
  it('offers the server suggestions, then the standard set, then everything else it defines', () => {
    const catalogue = permissionCatalogue(doc([]));
    expect(catalogue.suggested).toEqual(['Read', 'ReadWrite', 'Everything']);
    expect(catalogue.standard).toEqual([
      'Write',
      'ReadVersion',
      'WriteVersion',
      'AddChildren',
      'RemoveChildren',
      'Remove',
      'Version',
      'WriteSecurity',
      'Unlock',
      'SetRetention',
      'UnsetRetention',
    ]);
    expect(catalogue.other).toContain('Browse');
    expect(catalogue.other).toContain('CanAskForPublishing');
    expect(catalogue.other).toEqual([...catalogue.other].sort((a, b) => a.localeCompare(b)));
    expect(offeredPermissions(catalogue)).toHaveLength(33);
    expect(catalogue.defined).toEqual(SERVER_33);
  });

  it('covers every one of the fourteen grants NXSAT-300 asks for on a stock server', () => {
    const offered = offeredPermissions(permissionCatalogue(doc([])));
    for (const permission of NXS_STANDARD_PERMISSIONS) expect(offered).toContain(permission);
  });

  it('puts the section-root suggestion first, as the server orders it', () => {
    const catalogue = permissionCatalogue(
      doc([], {
        userVisiblePermissions: ['Read', 'ReadWrite', 'Everything', 'CanAskForPublishing'],
      }),
    );
    expect(catalogue.suggested).toEqual(['Read', 'ReadWrite', 'Everything', 'CanAskForPublishing']);
    expect(catalogue.other).not.toContain('CanAskForPublishing');
  });

  it('drops a standard permission the server does not define, when it can tell', () => {
    const withoutRetention = SERVER_33.filter((p) => !p.endsWith('Retention'));
    const catalogue = permissionCatalogue(doc([], { permissions: withoutRetention }));
    expect(catalogue.standard).not.toContain('SetRetention');
    expect(catalogue.standard).not.toContain('UnsetRetention');
  });

  it('offers the whole standard set and leaves the server to judge, when it cannot tell', () => {
    // A manager holding only WriteSecurity: the enricher lists what they hold, not what exists.
    const held = ['ReadProperties', 'ReadSecurity', 'Read', 'Browse', 'WriteSecurity'];
    const catalogue = permissionCatalogue(doc([], { permissions: held }));
    expect(catalogue.defined).toBeNull();
    expect(catalogue.standard).toContain('SetRetention');
    // Not held, so unverifiable — but still offered, and Nuxeo checks the grant.
    expect(offeredPermissions(catalogue)).toContain('Everything');
    expect(catalogue.other).toEqual(['Browse', 'ReadProperties', 'ReadSecurity']);
  });

  it('ignores missing or malformed lists', () => {
    const catalogue = permissionCatalogue(
      doc([], { permissions: 'Everything', userVisiblePermissions: [42, '', 'Read', 'Read'] }),
    );
    expect(catalogue.suggested).toEqual(['Read']);
    expect(catalogue.defined).toBeNull();
    expect(catalogue.other).toEqual([]);
  });
});

describe('offeredPermissions', () => {
  it('adds the current permission only when the server lists do not hold it', () => {
    const catalogue = { suggested: ['Read'], standard: ['Write'], other: [], defined: null };
    expect(offeredPermissions(catalogue, 'Write')).toEqual(['Read', 'Write']);
    expect(offeredPermissions(catalogue, 'CustomFromMarketplace')).toEqual([
      'Read',
      'Write',
      'CustomFromMarketplace',
    ]);
  });
});

describe('refusalsFor', () => {
  const addChildren = row({ principal: 'parity-user', permission: 'AddChildren' });
  const members = row({ principal: 'members', permission: 'ReadWrite' });

  it('refuses nothing for a change to one entry beside one outside the old three', () => {
    // The parity case the bridge could only refuse: members' ReadWrite becomes Everything, and
    // parity-user's AddChildren is untouched — so it is never written, and cannot be lost.
    const fresh = snapshot([addChildren, members]);
    const changes: NxsPermissionChange[] = [
      { kind: 'replace', target: members, permission: 'Everything', begin: null, end: null },
    ];
    expect(refusalsFor(fresh, changes)).toEqual([]);
  });

  it('accepts edits to the entry itself in any permission the server defines', () => {
    const fresh = snapshot([addChildren]);
    for (const permission of NXS_STANDARD_PERMISSIONS) {
      expect(
        refusalsFor(fresh, [
          { kind: 'replace', target: addChildren, permission, begin: null, end: null },
        ]),
      ).toEqual([]);
    }
    expect(refusalsFor(fresh, [{ kind: 'remove', target: addChildren }])).toEqual([]);
  });

  it('refuses a change whose target changed on the server since the panel loaded', () => {
    const fresh = snapshot([members]);
    expect(
      refusalsFor(fresh, [
        { kind: 'replace', target: addChildren, permission: 'Write', begin: null, end: null },
        { kind: 'remove', target: addChildren },
      ]),
    ).toEqual([
      { principal: 'parity-user', permission: 'AddChildren', reason: 'changed-on-server' },
      { principal: 'parity-user', permission: 'AddChildren', reason: 'changed-on-server' },
    ]);
  });

  it('refuses to edit a deny, which a replace would turn into a grant, but removes one', () => {
    const deny = row({
      principal: 'jdoe',
      permission: 'Remove',
      granted: false,
      id: 'jdoe:Remove:false:::',
    });
    const fresh = snapshot([deny]);
    expect(
      refusalsFor(fresh, [
        { kind: 'replace', target: deny, permission: 'Read', begin: null, end: null },
      ]),
    ).toEqual([{ principal: 'jdoe', permission: 'Remove', reason: 'deny-entry' }]);
    expect(refusalsFor(fresh, [{ kind: 'remove', target: deny }])).toEqual([]);
  });

  it('refuses an entry with no id or no principal', () => {
    const noId = row({ id: '' });
    const noPrincipal = row({ principal: '', id: ':Read:true:::' });
    const fresh = snapshot([noId, noPrincipal]);
    expect(
      refusalsFor(fresh, [
        { kind: 'remove', target: noId },
        { kind: 'remove', target: noPrincipal },
        { kind: 'add', key: 'a', principal: '  ', permission: 'Read', begin: null, end: null },
      ]),
    ).toEqual([
      { principal: 'jdoe', permission: 'Read', reason: 'no-id' },
      { principal: '', permission: 'Read', reason: 'no-principal' },
      { principal: '', permission: 'Read', reason: 'no-principal' },
    ]);
  });

  it('refuses a permission the server does not define, but only when it can tell', () => {
    const add: NxsPermissionChange = {
      kind: 'add',
      key: 'a',
      principal: 'jdoe',
      permission: 'NoSuchPermission308',
      begin: null,
      end: null,
    };
    const replace: NxsPermissionChange = {
      kind: 'replace',
      target: members,
      permission: 'NoSuchPermission308',
      begin: null,
      end: null,
    };
    expect(refusalsFor(snapshot([members]), [add, replace])).toEqual([
      { principal: 'jdoe', permission: 'NoSuchPermission308', reason: 'undefined-permission' },
      { principal: 'members', permission: 'NoSuchPermission308', reason: 'undefined-permission' },
    ]);
    expect(refusalsFor(snapshot([members], null), [add, replace])).toEqual([]);
  });

  it('refuses an end date before its start', () => {
    const fresh = snapshot([members]);
    expect(
      refusalsFor(fresh, [
        {
          kind: 'add',
          key: 'a',
          principal: 'jdoe',
          permission: 'Read',
          begin: '2031-01-02',
          end: '2031-01-01',
        },
        {
          kind: 'replace',
          target: members,
          permission: 'Read',
          begin: '2031-01-02',
          end: '2031-01-01',
        },
      ]).map((r) => r.reason),
    ).toEqual(['invalid-time-frame', 'invalid-time-frame']);
  });
});

describe('unconfirmedChanges', () => {
  const members = row({ principal: 'members', permission: 'ReadWrite' });

  it('confirms an add, a replace and a remove the re-read shows', () => {
    const after = snapshot([
      row({ principal: 'members', permission: 'Everything' }),
      row({
        principal: 'jdoe',
        permission: 'Unlock',
        begin: '2030-01-01T00:00:00.000Z',
        end: null,
      }),
    ]);
    expect(
      unconfirmedChanges(after, [
        { kind: 'replace', target: members, permission: 'Everything', begin: null, end: null },
        {
          kind: 'add',
          key: 'a',
          principal: 'jdoe',
          permission: 'Unlock',
          begin: '2030-01-01',
          end: null,
        },
        { kind: 'remove', target: row({ principal: 'old', permission: 'Write' }) },
      ]),
    ).toEqual([]);
  });

  it('reports a write Nuxeo answered with 200 and did not apply', () => {
    // An unknown ACE id: RemovePermission and ReplacePermission both answer 200 and do nothing.
    const after = snapshot([members]);
    expect(
      unconfirmedChanges(after, [
        { kind: 'replace', target: members, permission: 'Everything', begin: null, end: null },
        { kind: 'remove', target: members },
        { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Write', begin: null, end: null },
      ]),
    ).toEqual([
      { principal: 'members', permission: 'Everything', reason: 'not-applied' },
      { principal: 'members', permission: 'ReadWrite', reason: 'not-applied' },
      { principal: 'jdoe', permission: 'Write', reason: 'not-applied' },
    ]);
  });

  it('accepts the day a server in another zone stored, and rejects a different day', () => {
    // A CET server stores 2030-01-01 as local midnight, which is 23:00 the day before in UTC.
    const cet = snapshot([
      row({ principal: 'jdoe', permission: 'Read', begin: '2029-12-31T23:00:00.000Z' }),
    ]);
    const add = (begin: string): NxsPermissionChange => ({
      kind: 'add',
      key: 'a',
      principal: 'jdoe',
      permission: 'Read',
      begin,
      end: null,
    });
    expect(unconfirmedChanges(cet, [add('2030-01-01')])).toEqual([]);
    expect(unconfirmedChanges(cet, [add('2030-01-03')])).toHaveLength(1);
    // 11:00Z is 11 hours from Jan 1 and 13 from Jan 2, and the table shows Jan 1.
    const userInUtc = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
    const eleven = snapshot([
      row({ principal: 'jdoe', permission: 'Read', begin: '2030-01-01T11:00:00.000Z' }),
    ]);
    expect(unconfirmedChanges(eleven, [add('2030-01-01')])).toEqual([]);
    expect(unconfirmedChanges(eleven, [add('2030-01-02')])).toHaveLength(1);
    userInUtc.mockRestore();
    // A permanent entry does not confirm a dated one, nor the reverse.
    expect(
      unconfirmedChanges(snapshot([row({ principal: 'jdoe' })]), [add('2030-01-01')]),
    ).toHaveLength(1);
  });
});

describe('calendar days', () => {
  afterEach(() => vi.restoreAllMocks());
  /** The user's zone, as `getTimezoneOffset` reports it: minutes behind UTC. */
  const userIn = (minutesBehindUtc: number) =>
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(minutesBehindUtc);

  it('formats the day the user picked in their own zone', () => {
    expect(toDay(new Date(2030, 0, 5))).toBe('2030-01-05');
    expect(toDay(null)).toBeNull();
    expect(toDay(new Date('not a date'))).toBeNull();
  });

  it('reads an ACE date as its calendar day, not as an instant in the user zone', () => {
    const date = dayToDate('2030-01-01T00:00:00.000Z');
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([2030, 0, 1]);
    expect(dayToDate(null)).toBeNull();
    expect(dayToDate('garbage')).toBeNull();
    expect(instantToDay('2030-01-01T00:00:00.000Z')).toBe('2030-01-01');
    expect(instantToDay(null)).toBeNull();
  });

  it('reads midnight in a zone east or west of UTC as that day', () => {
    userIn(0);
    // Measured on 2025.26.16: an ACE written as 2030-01-01T00:00:00+01:00, as Nuxeo Web UI sends
    // from a CET browser, is read back as 2029-12-31T23:00:00.000Z.
    expect(instantToDay('2029-12-31T23:00:00.000Z')).toBe('2030-01-01');
    expect(instantToDay('2029-12-31T12:00:00.000Z')).toBe('2030-01-01');
    expect(instantToDay('2030-01-01T05:00:00.000Z')).toBe('2030-01-01');
    expect(instantToDay('2030-01-01T11:00:00.000Z')).toBe('2030-01-01');
    expect(instantToDay('2030-01-01')).toBe('2030-01-01');
  });

  describe('for a user beyond UTC+12 or at UTC−12', () => {
    it.each([
      ['UTC+14', -840, '2029-12-31T10:00:00.000Z'],
      ['UTC+13', -780, '2029-12-31T11:00:00.000Z'],
      ['UTC−12', 720, '2030-01-01T12:00:00.000Z'],
    ])('reads a day picked at %s as that day', (_zone, offset, midnight) => {
      userIn(offset);
      expect(instantToDay(midnight)).toBe('2030-01-01');
      expect(dateToWrite('2030-01-01', midnight)).toBe(midnight);
    });

    it('still reads an entry from another zone by its nearest UTC midnight', () => {
      userIn(-840);
      expect(instantToDay('2029-12-31T23:00:00.000Z')).toBe('2030-01-01');
      expect(instantToDay('2030-01-01T05:00:00.000Z')).toBe('2030-01-01');
    });

    it("reads a midnight two zones 24 hours apart share as the user's own day", () => {
      // 11:00Z is midnight on Jan 1 at UTC−11 and on Jan 2 at UTC+13; the zone is not stored.
      userIn(-780);
      expect(instantToDay('2030-01-01T11:00:00.000Z')).toBe('2030-01-02');
    });
  });
});

describe('dateToWrite', () => {
  const cetMidnight = '2029-12-31T23:00:00.000Z';

  it("sends the server's own instant back when the day is unchanged", () => {
    // Sending the day instead moved this entry's start 23 hours earlier, measured.
    expect(dateToWrite('2030-01-01', cetMidnight)).toBe(cetMidnight);
  });

  it('sends the day the user picked when it changed, was added or was cleared', () => {
    expect(dateToWrite('2030-01-02', cetMidnight)).toBe('2030-01-02');
    expect(dateToWrite('2030-01-02', null)).toBe('2030-01-02');
    expect(dateToWrite(null, cetMidnight)).toBeNull();
    expect(dateToWrite(null, null)).toBeNull();
  });
});
