import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NuxeoAce } from '../models/acl.model';
import type { AuditEntry } from '../models/audit.model';
import type { NuxeoDocument } from '../models/document.model';
import { auditActivityLabel, auditActivityLabelKey } from './audit-activity-label';
import {
  CLIPBOARD_STORAGE_KEY,
  canPasteClipboard,
  readClipboardDocs,
  writeClipboardDocs,
} from './clipboard.utils';
import { browseTreeContextPath } from './browse-path.utils';
import { normalizeDocumentAcls, resolveAcePrincipal } from './ace-principal';
import {
  findLocalAceForPrincipal,
  isMailSendError,
  mailSendFailureMessage,
  permissionNotificationAceNotFoundMessage,
} from './permission-notification';

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return { id: 1, eventId: 'view', eventDate: '2026-01-01T00:00:00Z', ...overrides } as AuditEntry;
}

function doc(overrides: Partial<NuxeoDocument> & { uid: string }): NuxeoDocument {
  return {
    title: overrides.uid,
    type: 'File',
    path: '/default-domain/file',
    lastModified: '2026-01-01T00:00:00Z',
    properties: {},
    ...overrides,
  } as NuxeoDocument;
}

/**
 * `username` and `creator` are widened because Nuxeo sends an enriched user entity there when
 * `fetch-acls` is set, which `NuxeoAce` declares as a plain string.
 */
type AceOverrides = Partial<Omit<NuxeoAce, 'username' | 'creator'>> & {
  username?: unknown;
  creator?: unknown;
};

function ace(overrides: AceOverrides): NuxeoAce {
  return {
    id: 'ace-1',
    username: 'jdoe',
    externalUser: false,
    permission: 'Read',
    granted: true,
    creator: null,
    begin: null,
    end: null,
    status: 'effective',
    ...overrides,
  } as NuxeoAce;
}

describe('auditActivityLabel', () => {
  it('prefers the clientReason our own download call records over the raw eventId', () => {
    expect(
      auditActivityLabelKey(entry({ eventId: 'download', extended: { clientReason: 'view' } })),
    ).toBe('view');
    expect(
      auditActivityLabel(entry({ eventId: 'download', extended: { clientReason: 'view' } })),
    ).toBe('viewed the document');
  });

  it('ignores an empty clientReason', () => {
    expect(
      auditActivityLabelKey(entry({ eventId: 'download', extended: { clientReason: '' } })),
    ).toBe('download');
  });

  it('ignores a non-string clientReason', () => {
    expect(
      auditActivityLabelKey(entry({ eventId: 'download', extended: { clientReason: 42 } })),
    ).toBe('download');
  });

  it('reads an unknown event from a directory Map', () => {
    const labels = new Map([['customEvent', 'did something custom']]);
    expect(auditActivityLabel(entry({ eventId: 'customEvent' }), labels)).toBe(
      'did something custom',
    );
  });

  it('reads an unknown event from a directory record', () => {
    expect(auditActivityLabel(entry({ eventId: 'customEvent' }), { customEvent: 'custom' })).toBe(
      'custom',
    );
  });

  it('humanises a camel-case event the directory does not know either', () => {
    expect(auditActivityLabel(entry({ eventId: 'someWeirdEvent' }), new Map())).toBe(
      'Some Weird Event',
    );
  });

  it('humanises an unknown event when no directory was supplied at all', () => {
    expect(auditActivityLabel(entry({ eventId: 'someWeirdEvent' }))).toBe('Some Weird Event');
  });

  it('never returns a prototype member for an event named after one', () => {
    expect(auditActivityLabel(entry({ eventId: 'constructor' }))).toBe('Constructor');
    expect(auditActivityLabel(entry({ eventId: 'toString' }), { other: 'x' })).toBe('To String');
  });
});

describe('clipboard storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips clipboard entries through storage', () => {
    writeClipboardDocs([{ uid: 'doc-1', title: 'A', type: 'File' }]);
    expect(readClipboardDocs()).toEqual([{ uid: 'doc-1', title: 'A', type: 'File' }]);
  });

  it('returns an empty list when nothing has been copied', () => {
    expect(readClipboardDocs()).toEqual([]);
  });

  it('discards entries missing a uid or title rather than handing them to a paste', () => {
    localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify([
        { uid: 'doc-1', title: 'A' },
        { uid: 'doc-2' },
        { title: 'B' },
        { uid: 'doc-3', title: 'C', type: 7 },
        null,
        'string',
      ]),
    );
    expect(readClipboardDocs()).toEqual([{ uid: 'doc-1', title: 'A' }]);
  });

  it('returns an empty list when the stored value is not an array', () => {
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ uid: 'doc-1' }));
    expect(readClipboardDocs()).toEqual([]);
  });

  it('returns an empty list when the stored value is not valid JSON', () => {
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, '{not json');
    expect(readClipboardDocs()).toEqual([]);
  });

  it('leaves the previous clipboard readable when storage refuses the write', () => {
    writeClipboardDocs([{ uid: 'doc-1', title: 'A' }]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeClipboardDocs([{ uid: 'doc-2', title: 'B' }])).not.toThrow();
    vi.restoreAllMocks();
    expect(readClipboardDocs()).toEqual([{ uid: 'doc-1', title: 'A' }]);
  });
});

describe('canPasteClipboard', () => {
  const folder = doc({
    uid: 'folder-1',
    type: 'Folder',
    facets: ['Folderish'],
    contextParameters: { subtypes: [{ type: 'File' }, { type: 'Note' }] },
  });

  it('allows a paste whose types the target accepts', () => {
    expect(canPasteClipboard([{ uid: 'd1', title: 'A', type: 'File' }], folder)).toBe(true);
  });

  it('refuses a paste containing a type the target does not accept', () => {
    expect(
      canPasteClipboard(
        [
          { uid: 'd1', title: 'A', type: 'File' },
          { uid: 'd2', title: 'B', type: 'Picture' },
        ],
        folder,
      ),
    ).toBe(false);
  });

  it('allows older clipboard entries that recorded no type', () => {
    expect(canPasteClipboard([{ uid: 'd1', title: 'A' }], folder)).toBe(true);
  });

  it('allows any type when the target declares no subtypes', () => {
    const unrestricted = doc({ uid: 'folder-2', type: 'Folder', facets: ['Folderish'] });
    expect(canPasteClipboard([{ uid: 'd1', title: 'A', type: 'Picture' }], unrestricted)).toBe(
      true,
    );
  });

  it('refuses an empty clipboard, a missing target and a non-folderish target', () => {
    expect(canPasteClipboard([], folder)).toBe(false);
    expect(canPasteClipboard([{ uid: 'd1', title: 'A' }], null)).toBe(false);
    expect(canPasteClipboard([{ uid: 'd1', title: 'A' }], undefined)).toBe(false);
    expect(canPasteClipboard([{ uid: 'd1', title: 'A' }], doc({ uid: 'file-1' }))).toBe(false);
  });
});

describe('browseTreeContextPath', () => {
  it('uses the root path for the synthetic repository root', () => {
    expect(browseTreeContextPath(doc({ uid: 'root', type: 'Root', path: '/' }))).toBe('/');
  });

  it('uses a folder its own path', () => {
    expect(
      browseTreeContextPath(
        doc({ uid: 'f1', type: 'Folder', facets: ['Folderish'], path: '/default-domain/ws/' }),
      ),
    ).toBe('/default-domain/ws');
  });

  it('highlights the containing folder for a leaf document', () => {
    expect(browseTreeContextPath(doc({ uid: 'd1', path: '/default-domain/ws/file.pdf' }))).toBe(
      '/default-domain/ws',
    );
  });

  it('highlights the containing folder for a Collection, which is folderish but not a tree node', () => {
    expect(
      browseTreeContextPath(
        doc({
          uid: 'c1',
          type: 'Collection',
          facets: ['Folderish'],
          path: '/default-domain/collections/c1',
        }),
      ),
    ).toBe('/default-domain/collections');
  });
});

describe('resolveAcePrincipal', () => {
  it('returns a plain principal string unchanged', () => {
    expect(resolveAcePrincipal('jdoe')).toBe('jdoe');
  });

  it('prefers the enriched username over every other candidate', () => {
    expect(resolveAcePrincipal({ id: 'ignored', properties: { username: 'jdoe' } })).toBe('jdoe');
  });

  it('falls back through groupname, id, name and grouplabel in that order', () => {
    expect(resolveAcePrincipal({ properties: { groupname: 'members' } })).toBe('members');
    expect(resolveAcePrincipal({ groupname: 'members' })).toBe('members');
    expect(resolveAcePrincipal({ id: 'members' })).toBe('members');
    expect(resolveAcePrincipal({ name: 'members' })).toBe('members');
    expect(resolveAcePrincipal({ grouplabel: 'Members' })).toBe('Members');
  });

  it('returns an empty string for a value it cannot resolve', () => {
    expect(resolveAcePrincipal(null)).toBe('');
    expect(resolveAcePrincipal(undefined)).toBe('');
    expect(resolveAcePrincipal(42)).toBe('');
    expect(resolveAcePrincipal({})).toBe('');
  });
});

describe('normalizeDocumentAcls', () => {
  it('flattens enriched username and creator entities down to strings', () => {
    const normalized = normalizeDocumentAcls(
      doc({
        uid: 'd1',
        contextParameters: {
          acls: [
            {
              name: 'local',
              aces: [
                ace({
                  username: { properties: { username: 'jdoe' } },
                  creator: { properties: { username: 'Administrator' } },
                }),
              ],
            },
          ],
        },
      }),
    );

    const normalizedAce = normalized.contextParameters?.['acls']?.[0].aces[0];
    expect(normalizedAce?.username).toBe('jdoe');
    expect(normalizedAce?.creator).toBe('Administrator');
  });

  it('normalises a missing creator to null rather than an empty string', () => {
    const normalized = normalizeDocumentAcls(
      doc({
        uid: 'd1',
        contextParameters: {
          acls: [{ name: 'local', aces: [ace({ id: 'a' })] }],
        },
      }),
    );
    expect(normalized.contextParameters?.['acls']?.[0].aces[0].creator).toBeNull();
  });

  it('returns the document untouched when it carries no ACLs', () => {
    const input = doc({ uid: 'd1' });
    expect(normalizeDocumentAcls(input)).toBe(input);
  });

  it('returns the document untouched when the ACL list is empty', () => {
    const input = doc({ uid: 'd1', contextParameters: { acls: [] } });
    expect(normalizeDocumentAcls(input)).toBe(input);
  });
});

describe('permission notification helpers', () => {
  it('recognises the Nuxeo SMTP failure wording in both error shapes', () => {
    expect(isMailSendError({ error: { message: 'Failed when sending a mail' } })).toBe(true);
    expect(isMailSendError({ message: 'Error while SENDING A MAIL' })).toBe(true);
  });

  it('does not mistake an unrelated failure for an SMTP failure', () => {
    expect(isMailSendError({ message: 'Permission denied' })).toBe(false);
    expect(isMailSendError(null)).toBe(false);
    expect(isMailSendError(undefined)).toBe(false);
  });

  const en = (key: string): string => TestBed.inject(TranslateService).instant(key) as string;

  it('names the operation that succeeded in each mail-failure message', () => {
    expect(mailSendFailureMessage('add', en)).toContain('Permission was added');
    expect(mailSendFailureMessage('update', en)).toContain('Permission was updated');
    expect(mailSendFailureMessage('send', en)).toContain('Notification email could not be sent.');
    for (const context of ['add', 'update', 'send'] as const) {
      expect(mailSendFailureMessage(context, en)).toContain('Configure outbound mail (SMTP)');
    }
  });

  it('tells the user the permission itself survived when the ACE could not be located', () => {
    expect(permissionNotificationAceNotFoundMessage('add', en)).toContain('Permission was added');
    expect(permissionNotificationAceNotFoundMessage('update', en)).toContain(
      'Permission was updated',
    );
  });

  it('returns the newest granted local ACE for the principal', () => {
    const found = findLocalAceForPrincipal(
      doc({
        uid: 'd1',
        contextParameters: {
          acls: [
            {
              name: 'local',
              aces: [
                ace({ id: 'old' }),
                ace({ id: 'denied', permission: 'Write', granted: false }),
                ace({ id: 'other', username: 'jsmith' }),
                ace({ id: 'new', permission: 'Write' }),
              ],
            },
          ],
        },
      }),
      'jdoe',
    );
    expect(found?.id).toBe('new');
  });

  it('returns undefined when there is no local ACL, no ACEs, or no match', () => {
    expect(findLocalAceForPrincipal(doc({ uid: 'd1' }), 'jdoe')).toBeUndefined();
    expect(
      findLocalAceForPrincipal(
        doc({ uid: 'd1', contextParameters: { acls: [{ name: 'inherited', aces: [] }] } }),
        'jdoe',
      ),
    ).toBeUndefined();
    expect(
      findLocalAceForPrincipal(
        doc({ uid: 'd1', contextParameters: { acls: [{ name: 'local', aces: [] }] } }),
        'jdoe',
      ),
    ).toBeUndefined();
    expect(
      findLocalAceForPrincipal(
        doc({
          uid: 'd1',
          contextParameters: {
            acls: [
              {
                name: 'local',
                aces: [ace({ id: 'a', username: 'jsmith' })],
              },
            ],
          },
        }),
        'jdoe',
      ),
    ).toBeUndefined();
  });
});
