import {
  Component,
  Injectable,
  LOCALE_ID,
  provideZonelessChangeDetection,
  signal,
  type Type,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter, NativeDateAdapter } from '@angular/material/core';
import { By } from '@angular/platform-browser';
import { Subject, map, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsPermissionsPanelComponent } from './permissions-panel.component';

/** The permissions a stock server reports to an `Everything` holder (2025.26.16, measured). */
const ALL = [
  'Read',
  'ReadWrite',
  'Everything',
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
  'Browse',
  'CanAskForPublishing',
];

interface Ace {
  username: string;
  label?: string;
  permission: string;
  granted?: boolean;
  id?: string;
  begin?: string | null;
  end?: string | null;
  status?: string;
  externalUser?: boolean;
}

function aceOf(a: Ace) {
  return {
    id:
      a.id ??
      `${a.username}:${a.permission}:${a.granted === false ? 'false' : 'true'}:Administrator::`,
    username: a.username,
    ...(a.label ? { usernameLabel: a.label } : {}),
    permission: a.permission,
    granted: a.granted ?? true,
    externalUser: a.externalUser ?? false,
    creator: 'Administrator',
    begin: a.begin ?? null,
    end: a.end ?? null,
    status: a.status ?? 'effective',
  };
}

function serverDoc(
  local: Ace[],
  options: { inherited?: Ace[] | null; permissions?: string[]; uid?: string; title?: string } = {},
): NuxeoDocument {
  const acls: unknown[] = [{ name: 'local', aces: local.map(aceOf) }];
  if (options.inherited !== null) {
    acls.push({ name: 'inherited', aces: (options.inherited ?? []).map(aceOf) });
  }
  return {
    uid: options.uid ?? 'doc-1',
    title: options.title ?? 'ACL beyond three levels',
    type: 'Folder',
    path: '/default-domain/workspaces/parity/acl',
    lastModified: '2026-10-01T00:00:00.000Z',
    properties: {},
    contextParameters: {
      acls,
      permissions: options.permissions ?? ALL,
      userVisiblePermissions: ['Read', 'ReadWrite', 'Everything'],
    },
  } as NuxeoDocument;
}

/** The parity fixture: parity-user holds AddChildren, members ReadWrite, both outside the old three only in part. */
const PARITY = serverDoc(
  [
    { username: 'parity-user', permission: 'AddChildren', label: 'Parity User' },
    { username: 'members', permission: 'ReadWrite', label: 'Members group' },
  ],
  {
    inherited: [
      { username: 'Administrator', permission: 'Everything' },
      { username: 'members', permission: 'Read' },
    ],
  },
);

function contextOf(doc: NuxeoDocument): Record<string, unknown> {
  if (!doc.contextParameters) throw new Error('fixture has no context parameters');
  return doc.contextParameters;
}

@Component({
  standalone: true,
  imports: [NxsPermissionsPanelComponent],
  template: `<nxs-permissions-panel [documentId]="uid()" [permissionsChanged]="changed" />`,
})
class HostComponent {
  readonly uid = signal('doc-1');
  readonly changed = vi.fn();
}

@Component({
  standalone: true,
  imports: [NxsPermissionsPanelComponent],
  template: `
    <nxs-permissions-panel documentId="doc-1" />
    <nxs-permissions-panel documentId="doc-2" />
  `,
})
class TwoPanelsHostComponent {}

describe('NxsPermissionsPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let documents: {
    getDocumentPermissions: ReturnType<typeof vi.fn<(uid: string) => Observable<NuxeoDocument>>>;
    addPermission: ReturnType<typeof vi.fn>;
    replacePermission: ReturnType<typeof vi.fn>;
    removePermissionById: ReturnType<typeof vi.fn>;
    blockPermissionInheritance: ReturnType<typeof vi.fn>;
    unblockPermissionInheritance: ReturnType<typeof vi.fn>;
    searchUsersGroups: ReturnType<typeof vi.fn>;
  };

  const panel = () =>
    fixture.debugElement.children[0].componentInstance as NxsPermissionsPanelComponent;
  const el = (): HTMLElement => fixture.nativeElement;
  const text = () => (el().textContent ?? '').replace(/\s+/g, ' ');
  const all = (selector: string) => Array.from(el().querySelectorAll<HTMLElement>(selector));
  const rows = (section: number) =>
    all('section')[section]?.querySelectorAll<HTMLElement>(
      'tr[role="row"]:not(.mat-mdc-header-row)',
    ) ?? [];
  const addedItem = () => {
    const item = panel()
      ['localItems']()
      .find((i) => i.state === 'added');
    if (!item) throw new Error('no staged addition is shown');
    return item;
  };
  /** A button by its visible words, ignoring the ligature text of a decorative icon. */
  const buttonByText = (label: string) =>
    all('button').find((b) => {
      const clone = b.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
      return clone.textContent?.trim() === label;
    }) ?? null;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(...reads: (NuxeoDocument | Error | { status: number })[]): Promise<void> {
    for (const read of reads) {
      documents.getDocumentPermissions.mockReturnValueOnce(
        read && 'uid' in read ? of(read) : throwError(() => read),
      );
    }
    fixture = TestBed.createComponent(HostComponent);
    await render();
  }

  beforeEach(async () => {
    documents = {
      getDocumentPermissions: vi.fn(),
      addPermission: vi.fn(() => of({})),
      replacePermission: vi.fn(() => of({})),
      removePermissionById: vi.fn(() => of({})),
      blockPermissionInheritance: vi.fn(() => of({})),
      unblockPermissionInheritance: vi.fn(() => of({})),
      searchUsersGroups: vi.fn(() => of([])),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentDetailService, useValue: documents },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  describe('reading', () => {
    it('shows local and inherited entries, every permission by label and Nuxeo name', async () => {
      await mount(PARITY);
      expect(text()).toContain('ACL beyond three levels');
      const local = Array.from(rows(0)).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
      expect(local[0]).toMatch(/Parity User\s*parity-user/);
      expect(local[0]).toMatch(/Add Children\s*AddChildren/);
      expect(local[1]).toContain('members');
      expect(local[1]).toMatch(/Edit\s*ReadWrite/);
      const inherited = Array.from(rows(1)).map((r) => r.textContent ?? '');
      expect(inherited).toHaveLength(2);
      expect(inherited[1]).toContain('members');
      expect(inherited[1]).toContain('Read');
    });

    it('offers every standard permission in an entry select, grouped as the server orders them', async () => {
      await mount(PARITY);
      const trigger = el().querySelector<HTMLElement>('tr[role="row"] .mat-mdc-select-trigger');
      trigger?.click();
      await render();
      const overlay = document.querySelector('.cdk-overlay-container') as HTMLElement;
      const options = Array.from(overlay.querySelectorAll('mat-option')).map(
        (o) => o.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );
      for (const permission of ALL.slice(0, 14)) {
        expect(options.some((o) => o.endsWith(permission) || o === permission)).toBe(true);
      }
      expect(
        Array.from(overlay.querySelectorAll('.mat-mdc-optgroup-label')).map((g) =>
          g.textContent?.trim(),
        ),
      ).toEqual([
        'Suggested for this document type',
        'Standard permissions',
        'Other permissions on this server',
      ]);
    });

    it('shows a permission the server does not list, so its entry can still be kept', async () => {
      await mount(serverDoc([{ username: 'jdoe', permission: 'CustomFromMarketplace' }]));
      expect(text()).toContain('CustomFromMarketplace');
      panel()['openEdit'](panel()['localItems']()[0]);
      expect(panel()['editorExtraPermissions']()).toEqual(['CustomFromMarketplace']);
    });

    it('shows dated entries with their time frame and status', async () => {
      await mount(
        serverDoc([
          {
            username: 'jdoe',
            permission: 'Unlock',
            begin: '2030-01-01T00:00:00.000Z',
            end: '2031-01-01T00:00:00.000Z',
            status: 'pending',
          },
          {
            username: 'ann',
            permission: 'Read',
            end: '2020-01-01T00:00:00.000Z',
            status: 'archived',
          },
        ]),
      );
      const local = Array.from(rows(0)).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
      expect(local[0]).toContain('2030');
      expect(local[0]).toContain('Not yet active');
      expect(local[1]).toContain('Expired');
    });

    it('says when there is nothing set locally and when inheritance is blocked', async () => {
      await mount(
        serverDoc([{ username: 'Everyone', permission: 'Everything', granted: false }], {
          inherited: null,
        }),
      );
      expect(text()).toContain('No permissions are set on this document itself.');
      expect(text()).toContain('Inheritance is blocked');
      expect(buttonByText('Unblock inheritance')).not.toBeNull();
    });

    it('says when nothing is inherited', async () => {
      await mount(serverDoc([], { inherited: [] }));
      expect(text()).toContain('No permissions are inherited.');
      expect(buttonByText('Block inheritance')).not.toBeNull();
    });

    it('shows entries from other named access lists, read-only', async () => {
      const doc = serverDoc([]);
      (contextOf(doc)['acls'] as unknown[]).push({
        name: 'workflow-acl',
        aces: [aceOf({ username: 'reviewers', permission: 'Write' })],
      });
      await mount(doc);
      expect(text()).toContain('Set by other access lists');
      expect(text()).toContain('workflow-acl');
    });

    it('marks a deny as denied in the inherited and other-list tables, not as a grant', async () => {
      const doc = serverDoc([], {
        inherited: [
          { username: 'members', permission: 'Read' },
          { username: 'jdoe', permission: 'Write', granted: false },
        ],
      });
      (contextOf(doc)['acls'] as unknown[]).push({
        name: 'workflow-acl',
        aces: [
          aceOf({ username: 'reviewers', permission: 'Write' }),
          aceOf({ username: 'guests', permission: 'Read', granted: false }),
        ],
      });
      await mount(doc);
      const [inheritedGrant, inheritedDeny] = Array.from(rows(1));
      const [otherGrant, otherDeny] = Array.from(rows(2));
      expect(inheritedDeny.textContent).toContain('Denied');
      expect(otherDeny.textContent).toContain('Denied');
      expect(inheritedGrant.textContent).not.toContain('Denied');
      expect(otherGrant.textContent).not.toContain('Denied');
    });

    it('is read-only for a user who cannot manage permissions', async () => {
      await mount(
        serverDoc([{ username: 'members', permission: 'ReadWrite' }], {
          permissions: ['Read', 'Browse'],
        }),
      );
      expect(el().querySelector('mat-select')).toBeNull();
      expect(buttonByText('Add')).toBeNull();
      expect(buttonByText('Block inheritance')).toBeNull();
      expect(el().querySelector('[aria-label^="Remove"]')).toBeNull();
      expect(text()).toContain('Edit');
    });

    it('lets a deny be removed but not edited, and locks an entry with no id', async () => {
      await mount(
        serverDoc([
          { username: 'jdoe', permission: 'Remove', granted: false },
          { username: 'ann', permission: 'Write', id: '' },
        ]),
      );
      const [deny, noId] = Array.from(rows(0));
      expect(deny.textContent).toContain('Denied');
      expect(deny.querySelector('mat-select')).toBeNull();
      expect(deny.querySelector('[aria-label^="Remove"]')).not.toBeNull();
      expect(deny.textContent).toContain('A deny entry can be removed here, but not edited.');
      expect(noId.querySelector('mat-select')).toBeNull();
      expect(noId.querySelector('button')).toBeNull();
      expect(noId.textContent).toContain('the server sent no identifier');
    });
  });

  describe('load errors', () => {
    it('distinguishes a permission refusal, with no retry', async () => {
      await mount({ status: 403 });
      expect(el().querySelector('[role="alert"]')?.textContent).toContain(
        "You don't have access to this document's permissions.",
      );
      expect(buttonByText('Retry')).toBeNull();
    });

    it('distinguishes a missing document', async () => {
      await mount({ status: 404 });
      expect(text()).toContain('This document no longer exists.');
    });

    it('offers a retry after a server error, which recovers', async () => {
      await mount({ status: 500 }, PARITY);
      expect(text()).toContain('The permissions could not be loaded.');
      expect(panel()['loading']()).toBe(false);
      buttonByText('Retry')?.click();
      await render();
      expect(text()).toContain('parity-user');
      expect(el().querySelector('[role="alert"]')).toBeNull();
    });

    it('recovers on retry even when a load throws before returning', async () => {
      documents.getDocumentPermissions.mockImplementationOnce(() => {
        throw new Error('synchronous failure');
      });
      await mount(PARITY);
      expect(text()).toContain('The permissions could not be loaded.');
      buttonByText('Retry')?.click();
      await render();
      expect(text()).toContain('parity-user');
    });

    it('treats a read with no ACLs as a failure, not as an empty ACL', async () => {
      const doc = serverDoc([]);
      delete contextOf(doc)['acls'];
      await mount(doc);
      expect(text()).toContain('The permissions could not be loaded.');
      expect(text()).not.toContain('No permissions are set');
    });
  });

  describe('saving', () => {
    it('changes one entry in place and leaves the entry outside the old three untouched', async () => {
      const after = serverDoc([
        { username: 'parity-user', permission: 'AddChildren' },
        { username: 'members', permission: 'Everything' },
      ]);
      await mount(PARITY, PARITY, after);
      const members = panel()['localItems']()[1];
      panel()['setPermission'](members, 'Everything');
      await render();
      expect(text()).toContain('1 unsaved change');

      buttonByText('Save')?.click();
      await render();

      expect(documents.replacePermission).toHaveBeenCalledTimes(1);
      expect(documents.replacePermission).toHaveBeenCalledWith('doc-1', {
        id: 'members:ReadWrite:true:Administrator::',
        username: 'members',
        permission: 'Everything',
        begin: null,
        end: null,
        notify: false,
      });
      expect(documents.addPermission).not.toHaveBeenCalled();
      expect(documents.removePermissionById).not.toHaveBeenCalled();
      expect(el().querySelector('[role="status"]')?.textContent).toContain('Saved 1 change.');
      expect(panel()['pendingCount']()).toBe(0);
    });

    it('keeps a dated entry on its own dates when only its permission changes', async () => {
      // CET midnights, as Nuxeo Web UI writes them and Nuxeo reads them back (measured).
      const begin = '2029-12-31T23:00:00.000Z';
      const end = '2030-12-31T23:00:00.000Z';
      const inherited = [{ username: 'members', permission: 'Read', begin, end: null }];
      const dated = serverDoc([{ username: 'jdoe', permission: 'Read', begin, end }], {
        inherited,
      });
      const after = serverDoc([{ username: 'jdoe', permission: 'Write', begin, end }], {
        inherited,
      });
      await mount(dated, dated, after);
      expect(rows(0)[0].textContent).toContain('Jan 01, 2030');
      expect(rows(1)[0].textContent).toContain('Jan 01, 2030');

      panel()['setPermission'](panel()['localItems']()[0], 'Write');
      panel()['save']();
      await render();
      expect(documents.replacePermission).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ permission: 'Write', begin, end }),
      );
      expect(panel()['outcome']()?.kind).toBe('saved');
    });

    it('drops a change set back to its original value', async () => {
      await mount(PARITY);
      const members = panel()['localItems']()[1];
      panel()['setPermission'](members, 'Everything');
      panel()['setPermission'](panel()['localItems']()[1], 'ReadWrite');
      expect(panel()['pendingCount']()).toBe(0);
    });

    it('removes exactly one entry by id, and can undo before saving', async () => {
      const after = serverDoc([{ username: 'members', permission: 'ReadWrite' }]);
      await mount(PARITY, PARITY, after);
      const [parityUser] = panel()['localItems']();
      panel()['toggleRemove'](parityUser);
      await render();
      expect(text()).toContain('To remove');
      panel()['toggleRemove'](panel()['localItems']()[0]);
      expect(panel()['pendingCount']()).toBe(0);

      panel()['toggleRemove'](panel()['localItems']()[0]);
      buttonByText('Save')?.click();
      await render();
      expect(documents.removePermissionById).toHaveBeenCalledWith(
        'doc-1',
        'parity-user:AddChildren:true:Administrator::',
      );
      expect(panel()['outcome']()?.kind).toBe('saved');
    });

    it('adds a dated grant for a user found by search', async () => {
      vi.useFakeTimers();
      documents.searchUsersGroups.mockReturnValue(
        of([{ id: 'jdoe', displayLabel: 'John Doe', type: 'USER_TYPE', prefixed_id: 'user:jdoe' }]),
      );
      const after = serverDoc([
        { username: 'parity-user', permission: 'AddChildren' },
        { username: 'members', permission: 'ReadWrite' },
        {
          username: 'jdoe',
          permission: 'SetRetention',
          begin: '2030-03-01T00:00:00.000Z',
          end: '2030-04-01T00:00:00.000Z',
        },
      ]);
      await mount(PARITY, PARITY, after);
      buttonByText('Add')?.click();
      await render();
      expect(text()).toContain('Add a permission');

      panel()['onPrincipalInput']('jd');
      vi.advanceTimersByTime(350);
      expect(documents.searchUsersGroups).toHaveBeenCalledWith('jd');
      panel()['onPrincipalSelected'](panel()['suggestions']()[0]);
      panel()['editorPermission'].set('SetRetention');
      panel()['editorDated'].set(true);
      panel()['editorBegin'].set(new Date(2030, 2, 1));
      panel()['editorEnd'].set(new Date(2030, 3, 1));
      panel()['applyEditor']();
      vi.useRealTimers();
      await render();
      expect(text()).toContain('New');
      expect(text()).toMatch(/John Doe\s*jdoe/);

      panel()['save']();
      await render();
      expect(documents.addPermission).toHaveBeenCalledWith('doc-1', {
        username: 'jdoe',
        permission: 'SetRetention',
        begin: '2030-03-01',
        end: '2030-04-01',
        notify: false,
      });
      expect(panel()['outcome']()?.kind).toBe('saved');
    });

    it('edits an entry time frame through the editor, prefilled with its days', async () => {
      const dated = serverDoc([
        { username: 'jdoe', permission: 'Read', begin: '2030-01-01T00:00:00.000Z' },
      ]);
      await mount(dated);
      panel()['openEdit'](panel()['localItems']()[0]);
      await render();
      expect(text()).toContain('Edit the permission for jdoe');
      expect(panel()['editorDated']()).toBe(true);
      expect(panel()['editorBegin']()?.getDate()).toBe(1);
      panel()['editorEnd'].set(new Date(2030, 5, 30));
      panel()['applyEditor']();
      expect(panel()['staged']().get('jdoe:Read:true:Administrator::')).toMatchObject({
        kind: 'replace',
        begin: '2030-01-01',
        end: '2030-06-30',
      });
    });

    it('edits a staged addition, and cancels one', async () => {
      await mount(PARITY);
      panel()['openAdd']();
      panel()['onPrincipalSelected']({
        id: 'ann',
        displayLabel: 'Ann',
        type: 'USER_TYPE',
        prefixed_id: 'user:ann',
      });
      panel()['applyEditor']();
      const added = addedItem();
      panel()['setPermission'](added, 'Unlock');
      panel()['openEdit'](addedItem());
      panel()['editorPermission'].set('Version');
      panel()['applyEditor']();
      expect([...panel()['staged']().values()]).toEqual([
        expect.objectContaining({ kind: 'add', principal: 'ann', permission: 'Version' }),
      ]);
      panel()['toggleRemove'](addedItem());
      expect(panel()['pendingCount']()).toBe(0);
    });

    it('will not stage an addition without a principal, or with an end before its start', async () => {
      await mount(PARITY);
      panel()['openAdd']();
      panel()['applyEditor']();
      await render();
      expect(text()).toContain('Choose a user or group from the list.');
      panel()['onPrincipalSelected']({
        id: 'ann',
        displayLabel: 'Ann',
        type: 'USER_TYPE',
        prefixed_id: 'user:ann',
      });
      panel()['editorDated'].set(true);
      panel()['editorBegin'].set(new Date(2031, 0, 2));
      panel()['editorEnd'].set(new Date(2031, 0, 1));
      panel()['applyEditor']();
      await render();
      expect(text()).toContain('The end date is before the start date.');
      expect(panel()['pendingCount']()).toBe(0);
      buttonByText('Cancel')?.click();
      await render();
      expect(panel()['editor']()).toBeNull();
    });

    it('discards staged changes', async () => {
      await mount(PARITY);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      await render();
      buttonByText('Discard')?.click();
      await render();
      expect(panel()['pendingCount']()).toBe(0);
      expect(documents.replacePermission).not.toHaveBeenCalled();
    });

    it('refuses the save on screen, naming the entry and why, when it changed on the server', async () => {
      // Someone else replaced members' ReadWrite after the panel loaded. Nuxeo would answer the
      // stale replace with 200 and do nothing, so the panel must refuse it — and say so.
      const changedMeanwhile = serverDoc([
        { username: 'parity-user', permission: 'AddChildren' },
        { username: 'members', permission: 'Write' },
      ]);
      await mount(PARITY, changedMeanwhile);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      await render();
      buttonByText('Save')?.click();
      await render();

      const alert = el().querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(
        "Nothing was saved. These entries can't be saved from this panel:",
      );
      expect(alert?.textContent).toContain('members — Edit (ReadWrite)');
      expect(alert?.textContent).toContain('it changed on the server after this page loaded');
      expect(alert?.textContent).not.toContain('Error on updating permissions');
      expect(documents.replacePermission).not.toHaveBeenCalled();
      // Nothing was written, so the user's change is still there to adjust.
      expect(panel()['pendingCount']()).toBe(1);

      documents.getDocumentPermissions.mockReturnValueOnce(of(changedMeanwhile));
      buttonByText('Reload')?.click();
      await render();
      expect(panel()['pendingCount']()).toBe(0);
      expect(panel()['outcome']()).toBeNull();
      expect(panel()['localItems']()[1].permission).toBe('Write');
    });

    it('can dismiss a refusal and keep editing', async () => {
      const changedMeanwhile = serverDoc([{ username: 'parity-user', permission: 'AddChildren' }]);
      await mount(PARITY, changedMeanwhile);
      panel()['toggleRemove'](panel()['localItems']()[1]);
      panel()['save']();
      await render();
      expect(panel()['outcome']()?.kind).toBe('refused');
      buttonByText('Dismiss')?.click();
      await render();
      expect(panel()['outcome']()).toBeNull();
      expect(panel()['pendingCount']()).toBe(1);
    });

    it('reports a write the server refused, with its reason', async () => {
      await mount(PARITY, PARITY, PARITY);
      documents.replacePermission.mockReturnValueOnce(
        throwError(() => ({
          status: 403,
          error: { message: "Privilege 'WriteSecurity' is not granted to 'jdoe'" },
        })),
      );
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();
      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('Saved 0 of 1 changes. The server refused the next one:');
      expect(alert).toContain('members — Manage everything (Everything)');
      expect(alert).toContain("You don't have permission to change permissions on this document.");
      expect(alert).toContain("Privilege 'WriteSecurity' is not granted to 'jdoe'");
      expect(panel()['pendingCount']()).toBe(1);
      expect(panel()['localItems']()[1]).toMatchObject({
        state: 'changed',
        permission: 'Everything',
      });
    });

    it('names a new grant the server refused, keeps it staged as new, and sends it again on the next save', async () => {
      const withAnn = serverDoc([
        { username: 'parity-user', permission: 'AddChildren', label: 'Parity User' },
        { username: 'members', permission: 'ReadWrite', label: 'Members group' },
        { username: 'ann', permission: 'ReadWrite' },
      ]);
      await mount(PARITY, PARITY, PARITY, PARITY, withAnn);
      documents.addPermission.mockReturnValueOnce(
        throwError(() => ({ status: 400, error: { message: 'User ann does not exist' } })),
      );
      panel()['openAdd']();
      panel()['onPrincipalSelected']({
        id: 'ann',
        displayLabel: 'Ann Smith',
        type: 'USER_TYPE',
        prefixed_id: 'user:ann',
      });
      panel()['editorPermission'].set('ReadWrite');
      panel()['applyEditor']();
      await render();
      buttonByText('Save')?.click();
      await render();

      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('Saved 0 of 1 changes. The server refused the next one:');
      expect(alert).toContain('ann — Edit (ReadWrite)');
      expect(alert).toContain('User ann does not exist');
      expect(alert).not.toContain("You don't have permission");
      // Nothing was written, so the host has nothing to re-read.
      expect(fixture.componentInstance.changed).not.toHaveBeenCalled();
      expect(text()).toContain('1 unsaved change');
      const pendingRow = Array.from(rows(0)).at(-1)?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(pendingRow).toMatch(/Ann Smith\s*ann/);
      expect(pendingRow).toContain('New');
      expect(addedItem()).toMatchObject({ principal: 'ann', permission: 'ReadWrite' });

      buttonByText('Save')?.click();
      await render();
      expect(documents.addPermission).toHaveBeenCalledTimes(2);
      expect(documents.addPermission).toHaveBeenLastCalledWith(
        'doc-1',
        expect.objectContaining({ username: 'ann', permission: 'ReadWrite' }),
      );
      expect(panel()['outcome']()?.kind).toBe('saved');
      expect(panel()['pendingCount']()).toBe(0);
      expect(el().querySelector('[role="alert"]')).toBeNull();
    });

    it('keeps the refused change and every change after it, which were never sent, staged', async () => {
      const afterRemoval = serverDoc([{ username: 'members', permission: 'ReadWrite' }], {
        inherited: [{ username: 'Administrator', permission: 'Everything' }],
      });
      await mount(PARITY, PARITY, afterRemoval, afterRemoval, afterRemoval);
      documents.replacePermission.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['openAdd']();
      panel()['editorPrincipal'].set({
        id: 'ann',
        displayLabel: 'Ann Smith',
        type: 'USER_TYPE',
        prefixed_id: 'user:ann',
      });
      panel()['applyEditor']();
      panel()['save']();
      await render();

      expect(el().querySelector('[role="alert"]')?.textContent).toContain(
        'Saved 1 of 3 changes. The server refused the next one:',
      );
      expect(documents.addPermission).not.toHaveBeenCalled();
      expect(panel()['pendingCount']()).toBe(2);
      expect(
        panel()
          ['localItems']()
          .map((i) => [i.principal, i.state]),
      ).toEqual([
        ['members', 'changed'],
        ['ann', 'added'],
      ]);
      expect(addedItem().principalLabel).toBe('Ann Smith');
      expect(text()).toContain('2 unsaved changes');

      panel()['save']();
      await render();
      expect(documents.removePermissionById).toHaveBeenCalledTimes(1);
      expect(documents.replacePermission).toHaveBeenCalledTimes(2);
      expect(documents.addPermission).toHaveBeenCalledTimes(1);
      expect(documents.addPermission).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ username: 'ann' }),
      );
    });

    it('counts only the writes the re-read confirms when a later one is refused', async () => {
      // The removal is answered 200 and does nothing; the replacement after it is refused.
      await mount(PARITY, PARITY, PARITY);
      documents.replacePermission.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();
      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('Saved 0 of 2 changes. The server refused the next one:');
      expect(alert).toContain('The server did not apply every change');
      expect(alert).toContain('parity-user — Add Children (AddChildren)');
    });

    it('reports an unknown permission the server rejected', async () => {
      await mount(PARITY, PARITY, PARITY);
      documents.removePermissionById.mockReturnValueOnce(throwError(() => ({ status: 400 })));
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      await render();
      expect(el().querySelector('[role="alert"]')?.textContent).toContain('HTTP 400');
    });

    it('reports a change the server answered and did not apply', async () => {
      await mount(PARITY, PARITY, PARITY);
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      await render();
      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('The server did not apply every change');
      expect(alert).toContain('parity-user — Add Children (AddChildren)');
      expect(alert).toContain("the server accepted the change, but its permissions don't show it.");
    });

    it('says the changes are unconfirmed when they were sent but could not be read back', async () => {
      await mount(PARITY, PARITY, { status: 503 }, PARITY);
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      await render();
      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('The changes were sent, but reading the permissions back failed');
      expect(documents.removePermissionById).toHaveBeenCalledTimes(1);
      expect(panel()['pendingCount']()).toBe(0);
      buttonByText('Reload')?.click();
      await render();
      expect(panel()['outcome']()).toBeNull();
    });

    it('says nothing was sent when the read before saving fails, and keeps the change', async () => {
      await mount(PARITY, { status: 503 }, PARITY);
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      await render();
      const alert = el().querySelector('[role="alert"]')?.textContent ?? '';
      expect(alert).toContain('could not be read before saving, so no change was sent');
      expect(alert).toContain('HTTP 503');
      expect(alert).not.toContain('refused');
      expect(documents.removePermissionById).not.toHaveBeenCalled();
      expect(panel()['pendingCount']()).toBe(1);
      buttonByText('Reload')?.click();
      await render();
      expect(panel()['outcome']()).toBeNull();
    });

    it('reports an unexpected failure as an unknown state, not as a clean one', async () => {
      await mount(PARITY, PARITY);
      documents.removePermissionById.mockImplementation(() => {
        throw new Error('not an HTTP failure');
      });
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      await render();
      expect(panel()['outcome']()?.kind).toBe('unverified');
      expect(text()).toContain('cannot confirm them');
      expect(panel()['saving']()).toBe(false);
    });

    it('does nothing when there is nothing to save', async () => {
      await mount(PARITY);
      panel()['save']();
      expect(documents.getDocumentPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe('inheritance', () => {
    it('blocks inheritance and shows the server result', async () => {
      await mount(
        PARITY,
        serverDoc([{ username: 'Everyone', permission: 'Everything', granted: false }], {
          inherited: null,
        }),
      );
      buttonByText('Block inheritance')?.click();
      await render();
      expect(documents.blockPermissionInheritance).toHaveBeenCalledWith('doc-1');
      expect(text()).toContain('Inheritance is blocked');
    });

    it('unblocks inheritance', async () => {
      await mount(
        serverDoc([{ username: 'Everyone', permission: 'Everything', granted: false }], {
          inherited: null,
        }),
        PARITY,
      );
      panel()['toggleInheritance']();
      await render();
      expect(documents.unblockPermissionInheritance).toHaveBeenCalledWith('doc-1');
    });

    it('is unavailable while changes are unsaved', async () => {
      await mount(PARITY);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      await render();
      expect(buttonByText('Block inheritance')?.hasAttribute('disabled')).toBe(true);
      panel()['toggleInheritance']();
      expect(documents.blockPermissionInheritance).not.toHaveBeenCalled();
    });

    it('reloads, rather than reporting a failure, when only the re-read after a toggle failed', async () => {
      await mount(PARITY, { status: 503 }, PARITY);
      panel()['toggleInheritance']();
      await render();
      expect(documents.blockPermissionInheritance).toHaveBeenCalledTimes(1);
      expect(text()).not.toContain('Inheritance could not be changed.');
      expect(documents.getDocumentPermissions).toHaveBeenCalledTimes(3);
    });

    it('shows why the server refused the toggle', async () => {
      await mount(PARITY);
      documents.blockPermissionInheritance.mockReturnValueOnce(
        throwError(() => ({ status: 403, error: { message: 'Privilege denied' } })),
      );
      panel()['toggleInheritance']();
      await render();
      expect(text()).toContain('Inheritance could not be changed.');
      expect(text()).toContain('Privilege denied');
    });
  });

  describe('telling the host', () => {
    const told = () => fixture.componentInstance.changed;

    it('after a save and after an inheritance change, so it re-reads what it shows itself', async () => {
      await mount(PARITY, PARITY, PARITY, PARITY);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();
      expect(told()).toHaveBeenCalledTimes(1);
      panel()['toggleInheritance']();
      await render();
      expect(told()).toHaveBeenCalledTimes(2);
    });

    it('after a save that wrote some changes before one was refused', async () => {
      await mount(PARITY, PARITY, PARITY);
      documents.replacePermission.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();
      expect(told()).toHaveBeenCalledTimes(1);
    });

    it('not when nothing was written', async () => {
      await mount(PARITY, PARITY, PARITY);
      documents.replacePermission.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();
      expect(panel()['outcome']()?.kind).toBe('failed');
      documents.getDocumentPermissions.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      panel()['save']();
      await render();
      expect(panel()['outcome']()?.kind).toBe('unread');
      expect(told()).not.toHaveBeenCalled();
    });
  });

  describe('while a write is in flight', () => {
    const controls = () => ({
      add: buttonByText('Add'),
      selects: Array.from(all('section')[0]?.querySelectorAll<HTMLElement>('mat-select') ?? []),
      rowButtons: all('button[aria-label^="Remove"], button[aria-label^="Edit the permission"]'),
    });
    const locked = () => {
      const { add, selects, rowButtons } = controls();
      return {
        add: add?.hasAttribute('disabled'),
        selects:
          selects.length > 0 && selects.every((s) => s.getAttribute('aria-disabled') === 'true'),
        rowButtons: rowButtons.length > 0 && rowButtons.every((b) => b.hasAttribute('disabled')),
      };
    };
    const tryToStage = () => {
      const [first] = panel()['localItems']();
      panel()['setPermission'](first, 'Write');
      panel()['toggleRemove'](first);
      panel()['openAdd']();
    };

    it('locks every control that stages a change until the save answers, so none is lost', async () => {
      const after = serverDoc([
        { username: 'parity-user', permission: 'AddChildren' },
        { username: 'members', permission: 'Everything' },
      ]);
      await mount(PARITY, PARITY, after);
      const write = new Subject<unknown>();
      documents.replacePermission.mockReturnValue(write);
      panel()['setPermission'](panel()['localItems']()[1], 'Everything');
      panel()['save']();
      await render();

      expect(locked()).toEqual({ add: true, selects: true, rowButtons: true });
      tryToStage();
      expect(panel()['pendingCount']()).toBe(1);
      expect(panel()['editor']()).toBeNull();

      write.next({});
      write.complete();
      await render();
      expect(panel()['outcome']()?.kind).toBe('saved');
      expect(panel()['pendingCount']()).toBe(0);
      expect(locked()).toEqual({ add: false, selects: false, rowButtons: false });
    });

    it('locks them while an inheritance change is in flight too', async () => {
      await mount(PARITY, PARITY);
      const block = new Subject<unknown>();
      documents.blockPermissionInheritance.mockReturnValue(block);
      buttonByText('Block inheritance')?.click();
      await render();

      expect(locked()).toEqual({ add: true, selects: true, rowButtons: true });
      tryToStage();
      expect(panel()['pendingCount']()).toBe(0);
      expect(panel()['editor']()).toBeNull();

      block.next({});
      block.complete();
      await render();
      expect(locked()).toEqual({ add: false, selects: false, rowButtons: false });
    });
  });

  describe('principal search', () => {
    it('searches again for a term an earlier Add already searched', async () => {
      vi.useFakeTimers();
      await mount(PARITY);
      documents.searchUsersGroups.mockReturnValue(
        of([{ id: 'ann', displayLabel: 'Ann', type: 'USER_TYPE', prefixed_id: 'user:ann' }]),
      );
      panel()['openAdd']();
      panel()['onPrincipalInput']('an');
      vi.advanceTimersByTime(350);
      expect(panel()['suggestions']()).toHaveLength(1);
      panel()['closeEditor']();

      panel()['openAdd']();
      expect(panel()['suggestions']()).toEqual([]);
      panel()['onPrincipalInput']('an');
      vi.advanceTimersByTime(350);
      expect(documents.searchUsersGroups).toHaveBeenCalledTimes(2);
      expect(panel()['suggestions']()).toHaveLength(1);
    });

    it('keeps searching after a failed search', async () => {
      vi.useFakeTimers();
      await mount(PARITY);
      documents.searchUsersGroups
        .mockReturnValueOnce(throwError(() => ({ status: 500 })))
        .mockReturnValueOnce(
          of([{ id: 'ann', displayLabel: 'Ann', type: 'USER_TYPE', prefixed_id: 'user:ann' }]),
        );
      panel()['openAdd']();
      panel()['onPrincipalInput']('a');
      vi.advanceTimersByTime(350);
      expect(panel()['suggestions']()).toEqual([]);
      panel()['onPrincipalInput']('an');
      vi.advanceTimersByTime(350);
      expect(panel()['suggestions']()).toHaveLength(1);
      panel()['onPrincipalInput'](' ');
      vi.advanceTimersByTime(350);
      expect(panel()['suggestions']()).toEqual([]);
      expect(panel()['displaySuggestion'](null)).toBe('');
      expect(panel()['displaySuggestion']('raw')).toBe('raw');
    });

    describe('a search that answers late', () => {
      const ann = [{ id: 'ann', displayLabel: 'Ann', type: 'USER_TYPE', prefixed_id: 'user:ann' }];

      it('is not offered on an Add form opened after it was sent', async () => {
        vi.useFakeTimers();
        await mount(PARITY);
        const answer = new Subject<typeof ann>();
        documents.searchUsersGroups.mockReturnValue(answer);
        panel()['openAdd']();
        panel()['onPrincipalInput']('an');
        vi.advanceTimersByTime(350);
        panel()['closeEditor']();
        panel()['openAdd']();
        answer.next(ann);
        expect(panel()['suggestions']()).toEqual([]);
      });

      it('is not offered for a term the user has since changed', async () => {
        vi.useFakeTimers();
        await mount(PARITY);
        const answer = new Subject<typeof ann>();
        documents.searchUsersGroups.mockReturnValue(answer);
        panel()['openAdd']();
        panel()['onPrincipalInput']('an');
        vi.advanceTimersByTime(350);
        panel()['onPrincipalInput']('bob');
        answer.next(ann);
        expect(panel()['suggestions']()).toEqual([]);
      });

      it('is still offered while its form and term are unchanged', async () => {
        vi.useFakeTimers();
        await mount(PARITY);
        const answer = new Subject<typeof ann>();
        documents.searchUsersGroups.mockReturnValue(answer);
        panel()['openAdd']();
        panel()['onPrincipalInput']('an ');
        vi.advanceTimersByTime(350);
        answer.next(ann);
        expect(panel()['suggestions']()).toEqual(ann);
      });
    });
  });

  it('starts over when the document changes', async () => {
    await mount(PARITY, serverDoc([], { uid: 'doc-2', title: 'Other document' }));
    panel()['setPermission'](panel()['localItems']()[1], 'Everything');
    fixture.componentInstance.uid.set('doc-2');
    await render();
    expect(documents.getDocumentPermissions).toHaveBeenLastCalledWith('doc-2');
    expect(panel()['pendingCount']()).toBe(0);
    expect(text()).toContain('Other document');
  });

  describe('when the document changes mid-write', () => {
    const other = serverDoc([], { uid: 'doc-2', title: 'Other document' });

    beforeEach(() => {
      documents.getDocumentPermissions.mockImplementation((uid) =>
        of(uid === 'doc-2' ? other : PARITY),
      );
    });

    async function switchDocument(): Promise<void> {
      fixture.componentInstance.uid.set('doc-2');
      await render();
    }

    it('finishes the save on its own document but does not show its answer on the next', async () => {
      const write = new Subject<unknown>();
      documents.removePermissionById.mockReturnValue(write);
      fixture = TestBed.createComponent(HostComponent);
      await render();
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();
      expect(panel()['saving']()).toBe(true);

      await switchDocument();
      expect(panel()['saving']()).toBe(false);
      write.next({});
      write.complete();
      await render();

      expect(documents.removePermissionById).toHaveBeenCalledWith(
        'doc-1',
        expect.stringContaining('parity-user'),
      );
      expect(panel()['snapshot']()?.uid).toBe('doc-2');
      expect(panel()['outcome']()).toBeNull();
      expect(text()).toContain('Other document');
    });

    it('drops a late save failure for the previous document', async () => {
      // The read before the first write answers only after the switch; the write then throws.
      const preflight = new Subject<unknown>();
      documents.removePermissionById.mockImplementation(() => {
        throw new Error('late');
      });
      documents.getDocumentPermissions.mockImplementation((uid) =>
        uid === 'doc-2' ? of(other) : preflight.pipe(map(() => PARITY)),
      );
      documents.getDocumentPermissions.mockReturnValueOnce(of(PARITY));
      fixture = TestBed.createComponent(HostComponent);
      await render();
      panel()['toggleRemove'](panel()['localItems']()[0]);
      panel()['save']();

      await switchDocument();
      preflight.next({});
      await render();

      expect(documents.removePermissionById).toHaveBeenCalled();

      expect(panel()['outcome']()).toBeNull();
      expect(panel()['snapshot']()?.uid).toBe('doc-2');
    });

    it('does not show a late inheritance change, or its failure, on the next document', async () => {
      const block = new Subject<unknown>();
      documents.blockPermissionInheritance.mockReturnValue(block);
      fixture = TestBed.createComponent(HostComponent);
      await render();
      buttonByText('Block inheritance')?.click();
      expect(panel()['inheritanceBusy']()).toBe(true);

      await switchDocument();
      expect(panel()['inheritanceBusy']()).toBe(false);
      block.error({ status: 403 });
      await render();

      expect(panel()['inheritanceError']()).toBeNull();
      expect(panel()['snapshot']()?.uid).toBe('doc-2');
    });

    it('does not apply a late inheritance result to the next document', async () => {
      const block = new Subject<unknown>();
      documents.blockPermissionInheritance.mockReturnValue(block);
      fixture = TestBed.createComponent(HostComponent);
      await render();
      buttonByText('Block inheritance')?.click();
      expect(panel()['inheritanceBusy']()).toBe(true);

      await switchDocument();
      block.next({});
      block.complete();
      await render();

      expect(panel()['snapshot']()?.uid).toBe('doc-2');
      expect(text()).toContain('Other document');
    });
  });

  it('keeps its ids to itself when two panels share a page', async () => {
    const withOtherList = (uid: string) => {
      const doc = serverDoc([{ username: 'members', permission: 'ReadWrite' }], {
        uid,
        inherited: [{ username: 'Administrator', permission: 'Everything' }],
      });
      (contextOf(doc)['acls'] as unknown[]).push({
        name: 'workflow-acl',
        aces: [aceOf({ username: 'reviewers', permission: 'Write' })],
      });
      return doc;
    };
    documents.getDocumentPermissions.mockImplementation((uid) => of(withOtherList(uid)));
    const page = TestBed.createComponent(TwoPanelsHostComponent);
    page.detectChanges();
    await page.whenStable();
    const panels = page.debugElement.queryAll(By.directive(NxsPermissionsPanelComponent));
    expect(panels).toHaveLength(2);
    // With the Add form open, every id the template sets is on the page.
    for (const each of panels)
      (each.componentInstance as NxsPermissionsPanelComponent)['openAdd']();
    page.detectChanges();
    await page.whenStable();

    const ids = Array.from(
      (page.nativeElement as HTMLElement).querySelectorAll('[id]'),
      (node) => node.id,
    );
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    for (const each of panels) {
      const root = each.nativeElement as HTMLElement;
      const labelled = Array.from(root.querySelectorAll('[aria-labelledby], label[for]'));
      expect(root.querySelectorAll('section[aria-labelledby]')).toHaveLength(3);
      expect(root.querySelectorAll('table[aria-labelledby]')).toHaveLength(3);
      expect(root.querySelector('form[aria-labelledby]')).not.toBeNull();
      for (const node of labelled) {
        const refs = `${node.getAttribute('aria-labelledby') ?? ''} ${node.getAttribute('for') ?? ''}`;
        for (const id of refs.split(/\s+/).filter(Boolean)) {
          expect(root.contains(document.getElementById(id)), `#${id} inside its own panel`).toBe(
            true,
          );
        }
      }
    }
    page.destroy();
  });

  it('names an entry with no principal, and a failure with no reason', async () => {
    await mount(PARITY);
    expect(panel()['entryLabel']('', 'Read')).toBe('(no user or group) — Read (Read)');
    expect(panel()['serverMessage'](null)).toBe('The server gave no reason.');
    expect(panel()['serverMessage']({ error: { message: '  ' }, status: 0 })).toBe(
      'The server gave no reason.',
    );
  });
});

/** A date library's adapter, as a host might provide one: it reads any text as 1 January 2030. */
@Injectable()
class HostLibraryAdapter extends NativeDateAdapter {
  override parse(): Date | null {
    return new Date(2030, 0, 1);
  }
}

@Component({
  standalone: true,
  imports: [NxsPermissionsPanelComponent],
  template: `<nxs-permissions-panel documentId="doc-1" />`,
})
class DatesHostComponent {}

@Component({
  standalone: true,
  imports: [NxsPermissionsPanelComponent],
  providers: [{ provide: DateAdapter, useClass: HostLibraryAdapter }],
  template: `<nxs-permissions-panel documentId="doc-1" />`,
})
class DatesHostWithAdapterComponent {}

describe('NxsPermissionsPanelComponent, typed dates', () => {
  let fixture: ComponentFixture<unknown>;

  const panel = () =>
    fixture.debugElement.query(By.directive(NxsPermissionsPanelComponent))
      .componentInstance as NxsPermissionsPanelComponent;
  const fromBox = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '.nxs-permissions-panel__dates input',
    ) as HTMLInputElement;
  const day = (date: Date | null | undefined) =>
    date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : null;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The editor open on a dated entry, its From box showing. */
  async function editDated(locale: string, host: Type<unknown> = DatesHostComponent) {
    const dated = serverDoc([
      { username: 'jdoe', permission: 'Read', begin: '2030-01-01T00:00:00.000Z' },
    ]);
    await TestBed.configureTestingModule({
      imports: [host],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOCALE_ID, useValue: locale },
        {
          provide: DocumentDetailService,
          useValue: { getDocumentPermissions: () => of(dated), searchUsersGroups: () => of([]) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(host);
    await render();
    panel()['openEdit'](panel()['localItems']()[0]);
    await render();
  }

  async function typeFrom(text: string): Promise<Date | null> {
    fromBox().value = text;
    fromBox().dispatchEvent(new Event('input'));
    fromBox().dispatchEvent(new Event('change'));
    await render();
    return panel()['editorBegin']();
  }

  it('reads a typed date day first in French', async () => {
    await editDated('fr');
    expect(day(await typeFrom('03/04/2026'))).toBe('2026-4-3');
  });

  it('reads the same text month first in American English', async () => {
    await editDated('en-US');
    expect(day(await typeFrom('03/04/2026'))).toBe('2026-3-4');
  });

  it('uses a date adapter the host provides', async () => {
    await editDated('fr', DatesHostWithAdapterComponent);
    expect(day(await typeFrom('anything'))).toBe('2030-1-1');
  });
});
