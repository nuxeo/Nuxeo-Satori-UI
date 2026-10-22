import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
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

  async function mount(read: NuxeoDocument | Error) {
    documents = {
      getDocumentPermissions: vi.fn(() =>
        read instanceof Error ? throwError(() => read) : of(read),
      ),
      removePermission: vi.fn(() => of({})),
      removePermissionById: vi.fn(() => of({})),
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
              of({ id: 'Administrator', isAdministrator: true, properties: { groups: [] } }),
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

  it("hands the add and edit dialogs the saved search's own userVisiblePermissions", async () => {
    await mount(SAVED_SEARCH);

    component().openAddPermissionDialog();
    component().editRow(component().permissions()[0].id);

    const [add, edit] = dialog.open.mock.calls.map((call) => call[1].data);
    expect(add.permissions).toEqual(['Read', 'ReadWrite', 'Everything']);
    expect(edit.permissions).toEqual(['Read', 'ReadWrite', 'Everything']);
  });
});
