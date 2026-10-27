import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  CURRENT_USERNAME,
  DocumentDetailService,
  UserService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { ShareSavedSearchDialogComponent } from './share-saved-search-dialog.component';

const UID = 'saved-search-1';

function ace(username: string, permission: string, externalUser = false) {
  return {
    id: `${username}:${permission}:true:Administrator::`,
    username,
    permission,
    granted: true,
    creator: 'Administrator',
    externalUser,
    begin: null,
    end: null,
  };
}

/** A saved search as the server reads it: members holds two entries, as on the live fixture. */
const SAVED_SEARCH = {
  uid: UID,
  type: 'SavedSearch',
  title: 'NXSAT-300',
  properties: {},
  contextParameters: {
    acls: [
      {
        name: 'local',
        aces: [
          ace('members', 'Read'),
          ace('members', 'WriteVersion'),
          ace('guest@example.com', 'Read', true),
          ace('guest@example.com', 'ReadWrite', true),
        ],
      },
    ],
    userVisiblePermissions: ['Read', 'ReadWrite', 'Everything'],
  },
} as unknown as NuxeoDocument;

/** The saved search as the server holds it after `drop` were removed and `add` granted. */
function readAfter(drop: string[], add: ReturnType<typeof ace>[] = []): NuxeoDocument {
  const context = SAVED_SEARCH.contextParameters as { acls: { name: string; aces: unknown[] }[] };
  const local = (context.acls[0].aces as ReturnType<typeof ace>[])
    .filter((a) => !drop.includes(a.id))
    .concat(add);
  return {
    ...SAVED_SEARCH,
    contextParameters: { ...context, acls: [{ name: 'local', aces: local }] },
  } as unknown as NuxeoDocument;
}

describe('ShareSavedSearchDialogComponent', () => {
  let fixture: ComponentFixture<ShareSavedSearchDialogComponent>;
  let documents: Record<string, ReturnType<typeof vi.fn>>;
  let dialog: { open: ReturnType<typeof vi.fn> };

  async function mount(read: NuxeoDocument | Error, isAdministrator = true) {
    documents = {
      getDocumentPermissions: vi.fn(() =>
        read instanceof Error ? throwError(() => read) : of(read),
      ),
      removePermission: vi.fn(() => of({})),
      removePermissionById: vi.fn(() => of({})),
      replacePermission: vi.fn(() => of({})),
      addPermission: vi.fn(() => of({})),
    };
    dialog = { open: vi.fn(() => ({ afterClosed: () => of(null) })) };
    await TestBed.configureTestingModule({
      imports: [ShareSavedSearchDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { title: 'NXSAT-300', id: UID } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: DocumentDetailService, useValue: documents },
        { provide: CURRENT_USERNAME, useValue: () => 'Administrator' },
        {
          provide: UserService,
          useValue: {
            getUser: vi.fn(() =>
              of({ id: 'Administrator', isAdministrator, properties: { groups: [] } }),
            ),
          },
        },
      ],
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .compileComponents();
    fixture = TestBed.createComponent(ShareSavedSearchDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const component = () => fixture.componentInstance;

  describe('removing a local entry', () => {
    it('removes that one entry by its id, leaving the other entry its principal holds', async () => {
      await mount(SAVED_SEARCH);
      const read = component()
        .permissions()
        .find((r) => r.right === 'Read');
      if (!read) throw new Error('the members: Read row is not shown');
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(readAfter(['members:Read:true:Administrator::'])),
      );

      component().removeRow(read.id);

      expect(documents['removePermissionById']).toHaveBeenCalledExactlyOnceWith(
        UID,
        'members:Read:true:Administrator::',
      );
      // `Document.RemovePermission` by user removes every entry that user holds.
      expect(documents['removePermission']).not.toHaveBeenCalled();
      expect(
        component()
          .permissions()
          .map((r) => r.right),
      ).toEqual(['WriteVersion']);
    });

    it('shows the entry again when the server still holds it after a 200', async () => {
      // Another administrator changed members: Read meanwhile, so its id moved on. Nuxeo answers
      // 200 to removing the old id and changes nothing; only the re-read tells.
      await mount(SAVED_SEARCH);
      const read = component()
        .permissions()
        .find((r) => r.right === 'Read');
      if (!read) throw new Error('the members: Read row is not shown');
      const changed = { ...ace('members', 'Read'), id: 'members:Read:true:jdoe::' };
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(readAfter(['members:Read:true:Administrator::'], [changed])),
      );

      component().removeRow(read.id);

      const rows = component().permissions();
      expect(rows.map((r) => r.aceId)).toContain('members:Read:true:jdoe::');
      expect(rows.map((r) => r.right)).toEqual(['WriteVersion', 'Read']);
    });

    it('keeps an unsaved edit to another row when it re-reads after a removal', async () => {
      await mount(SAVED_SEARCH);
      const [read, writeVersion] = component().permissions();
      component().permissions.update((rows) =>
        rows.map((r) => (r.id === writeVersion.id ? { ...r, right: 'Everything' } : r)),
      );
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(readAfter(['members:Read:true:Administrator::'])),
      );

      component().removeRow(read.id);

      expect(component().permissions()).toEqual([
        expect.objectContaining({
          aceId: 'members:WriteVersion:true:Administrator::',
          right: 'Everything',
        }),
      ]);
    });

    it('applies an edit opened before the re-read to the row it was opened on', async () => {
      await mount(SAVED_SEARCH);
      const [read, writeVersion] = component().permissions();
      const reread = new Subject<NuxeoDocument>();
      documents['getDocumentPermissions'].mockReturnValueOnce(reread);
      const edited = new Subject<unknown>();
      dialog.open.mockReturnValueOnce({ afterClosed: () => edited });

      component().removeRow(read.id);
      component().editRow(writeVersion.id);
      // The re-read lands while the edit dialog is still open, then the edit is submitted.
      reread.next(readAfter(['members:Read:true:Administrator::']));
      reread.complete();
      edited.next([
        { userGroup: 'members', right: 'Everything', timeFrame: 'Permanent', grantedBy: 'Group' },
      ]);

      // Written against the ACE the dialog was opened on, not whichever row now sits at its index.
      expect(documents['replacePermission']).toHaveBeenCalledExactlyOnceWith(
        UID,
        expect.objectContaining({
          id: 'members:WriteVersion:true:Administrator::',
          permission: 'Everything',
        }),
      );
    });

    it('keeps row ids unique when the re-read brings in an entry the dialog had not shown', async () => {
      // Another administrator granted powerusers meanwhile. Keyed by position, the new row would
      // share an id with a kept one, and removing it would delete the kept entry instead.
      await mount(SAVED_SEARCH);
      const [read] = component().permissions();
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(readAfter(['members:Read:true:Administrator::'], [ace('powerusers', 'Remove')])),
      );
      component().removeRow(read.id);

      const rows = component().permissions();
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      const added = rows.find((r) => r.userGroup === 'powerusers');
      if (!added) throw new Error('the new powerusers row is not shown');
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(readAfter(['members:Read:true:Administrator::'])),
      );

      component().removeRow(added.id);

      expect(documents['removePermissionById']).toHaveBeenLastCalledWith(
        UID,
        'powerusers:Remove:true:Administrator::',
      );
    });

    it('takes one removal at a time, so an older re-read cannot restore a later removal', async () => {
      await mount(SAVED_SEARCH);
      const [read, writeVersion] = component().permissions();
      const reread = new Subject<NuxeoDocument>();
      documents['getDocumentPermissions'].mockReturnValueOnce(reread);

      component().removeRow(read.id);
      fixture.detectChanges();
      component().removeRow(writeVersion.id);

      expect(documents['removePermissionById']).toHaveBeenCalledTimes(1);
      const removes = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          'button.delete-btn',
        ),
      ).slice(0, component().permissions().length);
      expect(removes.every((b) => b.disabled)).toBe(true);

      reread.next(readAfter(['members:Read:true:Administrator::']));
      reread.complete();
      documents['getDocumentPermissions'].mockReturnValueOnce(
        of(
          readAfter([
            'members:Read:true:Administrator::',
            'members:WriteVersion:true:Administrator::',
          ]),
        ),
      );
      component().removeRow(writeVersion.id);

      expect(documents['removePermissionById']).toHaveBeenLastCalledWith(
        UID,
        'members:WriteVersion:true:Administrator::',
      );
      expect(component().permissions()).toEqual([]);
      expect(component().saving()).toBe(false);
    });

    it('writes nothing for a row that was not read from the ACL, and disables its button', async () => {
      await mount(new Error('read failed'));
      const synthetic = component().permissions()[0];
      expect(synthetic.aceId).toBeUndefined();

      component().removeRow(synthetic.id);

      expect(documents['removePermissionById']).not.toHaveBeenCalled();
      expect(documents['removePermission']).not.toHaveBeenCalled();
      const remove = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button.delete-btn',
      );
      expect(remove?.disabled).toBe(true);
    });
  });

  it('removes one external share by its id, not every share for that address', async () => {
    await mount(SAVED_SEARCH);
    const share = component()
      .externalPermissions()
      .find((r) => r.right === 'ReadWrite');
    if (!share) throw new Error('the external ReadWrite share is not shown');

    component().removeExternalPermission(share);

    expect(documents['removePermissionById']).toHaveBeenCalledExactlyOnceWith(
      UID,
      'guest@example.com:ReadWrite:true:Administrator::',
    );
    expect(documents['removePermission']).not.toHaveBeenCalled();
  });

  it('grants the server identifier the add dialog returned, without the display-label mapping', async () => {
    await mount(SAVED_SEARCH);
    documents['addPermission'] = vi.fn(() => of({}));
    dialog.open.mockReturnValueOnce({
      afterClosed: () =>
        of([{ userGroup: 'members', right: 'Write', timeFrame: 'Permanent', grantedBy: 'Group' }]),
    });

    component().openAddPermissionDialog();

    // The legacy map turns `Write` into the broader `ReadWrite`.
    expect(documents['addPermission']).toHaveBeenCalledExactlyOnceWith(
      UID,
      expect.objectContaining({ username: 'members', permission: 'Write' }),
    );
  });

  // NXSAT-334, on the path a user actually takes: Edit on a row, then Update in the dialog.
  // Before this, submitting an edit only updated the `permissions` signal and nothing wrote it, so
  // the edit was discarded when the dialog closed.
  describe('submitting an edit', () => {
    /** Opens the edit dialog on the first row and submits `result`. */
    async function submitEdit(result: Record<string, unknown>) {
      await mount(SAVED_SEARCH);
      const row = component().permissions()[0];
      dialog.open.mockReturnValueOnce({ afterClosed: () => of([{ ...result }]) });

      component().editRow(row.id);
      return row;
    }

    const GRANTABLE = [
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
    ];

    it.each(GRANTABLE)('writes %s to the server as it is', async (permission) => {
      const row = await submitEdit({
        userGroup: 'members',
        right: permission,
        timeFrame: 'Permanent',
        grantedBy: 'Group',
      });

      expect(documents['replacePermission']).toHaveBeenCalledExactlyOnceWith(
        UID,
        expect.objectContaining({ id: row.aceId, username: 'members', permission }),
      );
    });

    it('writes the edit by ACE id, so it cannot land on another entry', async () => {
      const row = await submitEdit({
        userGroup: 'members',
        right: 'Everything',
        timeFrame: 'Permanent',
        grantedBy: 'Group',
      });

      expect(row.aceId).toBe('members:Read:true:Administrator::');
      expect(documents['replacePermission']).toHaveBeenCalledWith(
        UID,
        expect.objectContaining({ id: 'members:Read:true:Administrator::' }),
      );
    });

    it('shows the server’s own row afterwards, not the staged edit', async () => {
      // Nuxeo answers 200 to replacing an id it no longer holds and changes nothing, so a staged
      // edit left on screen would claim a change that did not happen.
      await mount(SAVED_SEARCH);
      const row = component().permissions()[0];
      dialog.open.mockReturnValueOnce({
        afterClosed: () =>
          of([
            {
              userGroup: 'members',
              right: 'Everything',
              timeFrame: 'Permanent',
              grantedBy: 'Group',
            },
          ]),
      });

      component().editRow(row.id);

      // The re-read is the unchanged fixture: the write did not take.
      expect(
        component()
          .permissions()
          .map((r) => r.right),
      ).toEqual(['Read', 'WriteVersion']);
    });

    it('keeps the edit on screen when the write took but the re-read failed', async () => {
      // The write succeeded, so the staged row is the best information there is; clearing it would
      // claim the edit did not happen.
      await mount(SAVED_SEARCH);
      const row = component().permissions()[0];
      documents['getDocumentPermissions'].mockReturnValueOnce(
        throwError(() => new Error('re-read failed')),
      );
      dialog.open.mockReturnValueOnce({
        afterClosed: () =>
          of([
            {
              userGroup: 'members',
              right: 'Everything',
              timeFrame: 'Permanent',
              grantedBy: 'Group',
            },
          ]),
      });

      component().editRow(row.id);

      expect(documents['replacePermission']).toHaveBeenCalledOnce();
      expect(component().permissions()[0]).toEqual(
        expect.objectContaining({ aceId: row.aceId, right: 'Everything' }),
      );
      expect(component().saving()).toBe(false);
    });

    it('writes nothing for a row that was never read from the ACL', async () => {
      // The fallback row has no ACE id, so there is nothing for Nuxeo to replace.
      await mount(new Error('no read'));
      const row = component().permissions()[0];
      dialog.open.mockReturnValueOnce({
        afterClosed: () =>
          of([
            {
              userGroup: row.userGroup,
              right: 'Read',
              timeFrame: 'Permanent',
              grantedBy: 'System',
            },
          ]),
      });

      component().editRow(row.id);

      expect(row.aceId).toBeUndefined();
      expect(documents['replacePermission']).not.toHaveBeenCalled();
    });

    it('puts the row back when the write fails', async () => {
      await mount(SAVED_SEARCH);
      const row = component().permissions()[0];
      documents['replacePermission'] = vi.fn(() => throwError(() => new Error('403')));
      dialog.open.mockReturnValueOnce({
        afterClosed: () =>
          of([
            {
              userGroup: 'members',
              right: 'Everything',
              timeFrame: 'Permanent',
              grantedBy: 'Group',
            },
          ]),
      });

      component().editRow(row.id);

      expect(component().permissions()[0]).toEqual(row);
    });

    describe('dates', () => {
      const DATED = {
        ...ace('powerusers', 'Write'),
        begin: '2026-01-14T23:00:00.000Z',
        end: '2026-02-19T23:00:00.000Z',
      };
      const withDated = {
        ...SAVED_SEARCH,
        contextParameters: {
          ...(SAVED_SEARCH.contextParameters as object),
          acls: [{ name: 'local', aces: [DATED] }],
        },
      } as unknown as NuxeoDocument;

      it('writes the server’s own instants back when the time frame is untouched', async () => {
        // A day written at CET midnight is held as 23:00 UTC the day before. Writing the rendered
        // day back would re-anchor it at the server's midnight and move the entry.
        await mount(withDated);
        const row = component().permissions()[0];
        dialog.open.mockReturnValueOnce({
          afterClosed: () =>
            of([
              {
                userGroup: 'powerusers',
                right: 'Everything',
                timeFrame: row.timeFrame,
                grantedBy: 'Group',
              },
            ]),
        });

        component().editRow(row.id);

        expect(documents['replacePermission']).toHaveBeenCalledExactlyOnceWith(
          UID,
          expect.objectContaining({
            permission: 'Everything',
            begin: '2026-01-14T23:00:00.000Z',
            end: '2026-02-19T23:00:00.000Z',
          }),
        );
      });

      it('clears both dates when the user makes a dated entry permanent', async () => {
        await mount(withDated);
        const row = component().permissions()[0];
        dialog.open.mockReturnValueOnce({
          afterClosed: () =>
            of([
              {
                userGroup: 'powerusers',
                right: 'Write',
                timeFrame: 'Permanent',
                grantedBy: 'Group',
              },
            ]),
        });

        component().editRow(row.id);

        expect(documents['replacePermission']).toHaveBeenCalledExactlyOnceWith(
          UID,
          expect.objectContaining({ permission: 'Write', begin: null, end: null }),
        );
      });

      it('writes the new days when the user changed the time frame', async () => {
        await mount(withDated);
        const row = component().permissions()[0];
        dialog.open.mockReturnValueOnce({
          afterClosed: () =>
            of([
              {
                userGroup: 'powerusers',
                right: 'Write',
                timeFrame: '2026-03-01 - 2026-03-31',
                grantedBy: 'Group',
              },
            ]),
        });

        component().editRow(row.id);

        expect(documents['replacePermission']).toHaveBeenCalledExactlyOnceWith(
          UID,
          expect.objectContaining({ begin: '2026-03-01', end: '2026-03-31' }),
        );
      });
    });
  });

  // `save()` is a public member of this component and stays for API compatibility, but nothing in
  // the dialog calls it — the Update button persists one entry by id, as Web UI's does. These
  // cover the method itself; the live path is the `submitting an edit` block above.
  describe('save()', () => {
    it('writes an untouched entry on the permission it already holds', async () => {
      await mount(SAVED_SEARCH);
      documents['replacePermission'] = vi.fn(() => of({}));

      component().save();

      // The legacy map turned `Write` into the broader `ReadWrite`; `WriteVersion` and every other
      // permission outside its four keys fell through to `perm.right`, so only `Write` regressed.
      const written = documents['replacePermission'].mock.calls.map(
        (call) => (call[1] as { username: string; permission: string }).permission,
      );
      expect(written).toEqual(['Read', 'WriteVersion']);
    });

    // The map is kept only so a label left in state by an older build resolves to an identifier
    // rather than reaching the server verbatim. Asserted so that claim is in code, not just prose.
    it.each([
      ['Edit', 'ReadWrite'],
      ['Manage', 'Everything'],
      ['Manage everything', 'Everything'],
      ['Can collect', 'ReadCanCollect'],
    ])('resolves the legacy label %s to %s', async (label, permission) => {
      await mount(SAVED_SEARCH);
      documents['replacePermission'] = vi.fn(() => of({}));
      component().permissions.update((rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, right: label } : row)),
      );

      component().save();

      expect(documents['replacePermission']).toHaveBeenCalledWith(
        UID,
        expect.objectContaining({ username: 'members', permission }),
      );
    });

    // The guarantee above — "never rewrite a permission Nuxeo defines" — holds only while no key
    // of the legacy label map is itself a permission identifier. `Write` was, which is how it came
    // to be widened. This mirrors the panel's `NXS_STANDARD_PERMISSIONS`, which is internal to
    // `satori-components`; exporting it to share it here would add a customer-visible export.
    const GRANTABLE = [
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
    ];

    it.each(GRANTABLE)('writes %s to the server unchanged', async (permission) => {
      await mount(SAVED_SEARCH);
      documents['replacePermission'] = vi.fn(() => of({}));
      component().permissions.update((rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, right: permission } : row)),
      );

      component().save();

      expect(documents['replacePermission']).toHaveBeenCalledWith(
        UID,
        expect.objectContaining({ username: 'members', permission }),
      );
    });

    it('writes Write as Write rather than widening it to ReadWrite', async () => {
      await mount(SAVED_SEARCH);
      documents['replacePermission'] = vi.fn(() => of({}));
      component().permissions.update((rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, right: 'Write' } : row)),
      );

      component().save();

      expect(documents['replacePermission']).toHaveBeenCalledWith(
        UID,
        expect.objectContaining({ username: 'members', permission: 'Write' }),
      );
    });
  });

  describe('the permission column', () => {
    /** The rendered Right cell of every local row. */
    const rightCells = () => {
      const host: HTMLElement = fixture.nativeElement;
      const rows = host.querySelectorAll<HTMLTableRowElement>(
        'table.permissions-table:not(.readonly-table) tbody tr',
      );
      return Array.from(rows).map((row) => row.cells[1]?.textContent?.trim() ?? '');
    };

    it('reads a Nuxeo identifier as its label, in the active locale', async () => {
      await mount(SAVED_SEARCH);

      // This table rendered `row.right` raw, so it alone showed `WriteVersion` in every locale.
      expect(rightCells()).toEqual(['Read', 'Write versions']);
    });

    it('shows an unlabelled permission as its identifier, as Web UI does', async () => {
      await mount(SAVED_SEARCH);
      component().permissions.update((rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, right: 'CustomFromMarketplace' } : row)),
      );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rightCells()[0]).toBe('CustomFromMarketplace');
    });

    it('carries an identifier, not a label, on the row it falls back to without a read', async () => {
      // No ACL to read, so the dialog synthesises a row from the current user. It used to put the
      // English "Manage everything" in `right`, which an edit then could not tell from an id.
      await mount(new Error('no read'));

      expect(component().permissions()).toEqual([expect.objectContaining({ right: 'Everything' })]);
      // Still reads the same to a person, now through the translation.
      expect(rightCells()).toEqual(['Manage everything']);
    });

    it('falls back to Read for a user who is not an administrator', async () => {
      await mount(new Error('no read'), false);

      expect(component().permissions()).toEqual([expect.objectContaining({ right: 'Read' })]);
      expect(rightCells()).toEqual(['Read']);
    });
  });

  it("hands the add and edit dialogs the saved search's own userVisiblePermissions", async () => {
    await mount(SAVED_SEARCH);

    component().openAddPermissionDialog();
    component().editRow(component().permissions()[0].id);

    const [add, edit] = dialog.open.mock.calls.map((call) => call[1].data);
    expect(add.permissions).toEqual(['Read', 'ReadWrite', 'Everything']);
    expect(edit.permissions).toEqual(['Read', 'ReadWrite', 'Everything']);
  });
});
