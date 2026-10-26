import {
  mergeDocumentPermissionsContext,
  normalizeDocumentAcls,
  resolveAcePrincipal,
} from './ace-principal';
import type { NuxeoAce, NuxeoAcl } from '../models/acl.model';
import type { NuxeoDocument } from '../models/document.model';

describe('ace-principal', () => {
  it('resolveAcePrincipal returns string values unchanged', () => {
    expect(resolveAcePrincipal('members')).toBe('members');
    expect(resolveAcePrincipal('transient/guest@example.com')).toBe('transient/guest@example.com');
  });

  it('resolveAcePrincipal extracts username from enriched user entity', () => {
    expect(
      resolveAcePrincipal({
        'entity-type': 'user',
        id: 'Administrator',
        properties: { username: 'Administrator', firstName: 'Admin' },
      }),
    ).toBe('Administrator');
  });

  it('resolveAcePrincipal extracts groupname from enriched group entity', () => {
    expect(
      resolveAcePrincipal({
        'entity-type': 'group',
        id: 'members',
        groupname: 'members',
        grouplabel: 'Members',
      }),
    ).toBe('members');
  });

  it('normalizeDocumentAcls stringifies username and creator on all ACEs', () => {
    const enrichedAces = [
      {
        id: 'ace-1',
        username: {
          'entity-type': 'user',
          id: 'Administrator',
          properties: { username: 'Administrator' },
        },
        externalUser: false,
        permission: 'Everything',
        granted: true,
        creator: {
          'entity-type': 'user',
          id: 'Administrator',
          properties: { username: 'Administrator' },
        },
        begin: null,
        end: null,
        status: 'effective',
      },
    ] as unknown as NuxeoAce[];

    const doc: NuxeoDocument = {
      uid: 'root-uid',
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: {},
      contextParameters: {
        acls: [{ name: 'local', aces: enrichedAces } satisfies NuxeoAcl],
      },
    };

    const normalized = normalizeDocumentAcls(doc);
    const ace = normalized.contextParameters?.['acls']?.[0]?.aces?.[0];

    expect(ace?.username).toBe('Administrator');
    expect(ace?.creator).toBe('Administrator');
  });

  it('normalizeDocumentAcls keeps a user or group display name beside the id', () => {
    // The wire shape of `fetch-acls: extended`, which the declared type does not describe.
    const aces: NuxeoAce[] = JSON.parse(
      JSON.stringify([
        {
          id: 'a',
          username: {
            'entity-type': 'user',
            id: 'parity-user',
            properties: { username: 'parity-user', firstName: 'Parity', lastName: 'User' },
          },
        },
        {
          id: 'b',
          username: {
            'entity-type': 'group',
            id: 'members',
            groupname: 'members',
            grouplabel: 'Members group',
          },
        },
        { id: 'c', username: 'plain' },
        {
          id: 'd',
          username: {
            'entity-type': 'user',
            id: 'Administrator',
            properties: { username: 'Administrator', firstName: '', lastName: '  ' },
          },
        },
      ]),
    );
    const doc: NuxeoDocument = {
      uid: 'd',
      title: 'D',
      type: 'Folder',
      path: '/d',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: {},
      contextParameters: { acls: [{ name: 'local', aces }] },
    };

    const normalized = normalizeDocumentAcls(doc).contextParameters?.['acls']?.[0]?.aces ?? [];

    expect(normalized.map((ace) => [ace.username, ace.usernameLabel])).toEqual([
      ['parity-user', 'Parity User'],
      ['members', 'Members group'],
      ['plain', undefined],
      ['Administrator', undefined],
    ]);
  });

  it('mergeDocumentPermissionsContext replaces acls and permissions only', () => {
    const existing: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Doc',
      type: 'File',
      path: '/a/b',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: { 'dc:title': 'Doc' },
      contextParameters: {
        acls: [{ name: 'local', aces: [] }],
        permissions: ['Read'],
        favorites: { isFavorite: true },
      },
    };
    const updated: NuxeoDocument = {
      ...existing,
      contextParameters: {
        acls: [
          {
            name: 'local',
            aces: [
              {
                id: 'u1:Read',
                username: 'user-readonly01',
                permission: 'Read',
                granted: true,
                externalUser: false,
              },
              {
                id: 'u2:Read',
                username: 'poweruser01',
                permission: 'Read',
                granted: true,
                externalUser: false,
              },
            ],
          },
        ] as NuxeoAcl[],
        permissions: ['Read', 'ReadSecurity'],
      },
    };

    const merged = mergeDocumentPermissionsContext(existing, updated);
    const local = merged.contextParameters?.['acls']?.find((a) => a.name === 'local');

    expect(local?.aces).toHaveLength(2);
    expect(merged.contextParameters?.['permissions']).toEqual(['Read', 'ReadSecurity']);
    expect(merged.contextParameters?.['favorites']).toEqual({ isFavorite: true });
  });

  it('mergeDocumentPermissionsContext keeps existing permissions when updated returns empty array (NXSAT-196)', () => {
    const existing: NuxeoDocument = {
      uid: 'note-1',
      title: 'Note',
      type: 'Note',
      path: '/a/note',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: { 'note:note': '<p>hello</p>' },
      contextParameters: {
        permissions: ['Read', 'WriteProperties'],
        favorites: { isFavorite: false },
      },
    };
    const updated: NuxeoDocument = {
      ...existing,
      properties: { 'note:note': '<p>updated</p>', 'note:mime_type': 'text/html' },
      contextParameters: { permissions: [] },
    };

    const merged = mergeDocumentPermissionsContext(existing, updated, {
      treatEmptyEnricherAsAbsent: true,
    });

    expect(merged.properties['note:note']).toBe('<p>hello</p>');
    expect(merged.contextParameters?.['permissions']).toEqual(['Read', 'WriteProperties']);
    expect(merged.contextParameters?.['favorites']).toEqual({ isFavorite: false });
  });

  it('mergeDocumentPermissionsContext replaces permissions with empty array on permission refresh', () => {
    const existing: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Doc',
      type: 'File',
      path: '/a/b',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: {},
      contextParameters: {
        permissions: ['Read', 'WriteProperties'],
      },
    };
    const updated: NuxeoDocument = {
      ...existing,
      contextParameters: { permissions: [] },
    };

    const merged = mergeDocumentPermissionsContext(existing, updated);

    expect(merged.contextParameters?.['permissions']).toEqual([]);
  });

  it('mergeDocumentPermissionsContext preserves other enrichers from updated response', () => {
    const existing: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Doc',
      type: 'File',
      path: '/a/b',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: { 'dc:title': 'Old' },
      contextParameters: {
        permissions: ['Read'],
        favorites: { isFavorite: true },
      },
    };
    const updated: NuxeoDocument = {
      ...existing,
      properties: { 'dc:title': 'New' },
      contextParameters: {
        permissions: ['Read', 'WriteProperties'],
        thumbnail: { url: '/nuxeo/api/v1/id/doc-1/@rendition/thumbnail' },
      },
    };

    const merged = mergeDocumentPermissionsContext(existing, updated);

    expect(merged.properties['dc:title']).toBe('Old');
    expect(merged.contextParameters?.['permissions']).toEqual(['Read', 'WriteProperties']);
    expect(merged.contextParameters?.['thumbnail']).toEqual({
      url: '/nuxeo/api/v1/id/doc-1/@rendition/thumbnail',
    });
    expect(merged.contextParameters?.['favorites']).toEqual({ isFavorite: true });
  });
});
