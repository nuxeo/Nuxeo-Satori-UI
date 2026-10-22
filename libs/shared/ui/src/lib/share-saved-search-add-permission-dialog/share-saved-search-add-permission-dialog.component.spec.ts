import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  ShareSavedSearchAddPermissionDialogComponent,
  type ShareSavedSearchAddPermissionDialogData,
} from './share-saved-search-add-permission-dialog.component';

const MEMBERS: UserGroupSuggestion = {
  id: 'members',
  displayLabel: 'members',
  type: 'GROUP_TYPE',
  prefixed_id: 'group:members',
};

/** A saved search's `userVisiblePermissions` on a stock server, measured on the local Nuxeo. */
const SAVED_SEARCH_VISIBLE = ['Read', 'ReadWrite', 'Everything'];

describe('ShareSavedSearchAddPermissionDialogComponent', () => {
  async function open(data: ShareSavedSearchAddPermissionDialogData) {
    await TestBed.configureTestingModule({
      imports: [ShareSavedSearchAddPermissionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: DocumentDetailService, useValue: { searchUsersGroups: vi.fn(() => of([])) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShareSavedSearchAddPermissionDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  const values = (dialog: ShareSavedSearchAddPermissionDialogComponent) =>
    dialog.rightOptions.map((o) => o.value);

  it("offers the saved search's own list, which has no Can collect", async () => {
    const dialog = await open({ permissions: SAVED_SEARCH_VISIBLE });
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything']);
    expect(dialog.rightOptions.map((o) => o.label)).toEqual(['Read', 'Edit', 'Manage everything']);
  });

  it('offers whatever the server lists for the type rather than a fixed list', async () => {
    const dialog = await open({
      permissions: ['Read', 'ReadCanCollect', 'ReadWrite', 'Everything'],
    });
    expect(values(dialog)).toEqual(['Read', 'ReadCanCollect', 'ReadWrite', 'Everything']);
  });

  describe('with a list that does not hold Read', () => {
    const NO_READ = ['ReadWrite', 'Everything'];

    it('starts a new entry on the first right offered', async () => {
      const dialog = await open({ permissions: NO_READ });
      expect(dialog.right).toBe('ReadWrite');
    });

    it('resets to the first right offered after Create And Add Another', async () => {
      const dialog = await open({ permissions: NO_READ });
      dialog.onSuggestionSelected(MEMBERS);
      dialog.right = 'Everything';

      dialog.create(true);

      expect(dialog.right).toBe('ReadWrite');
    });

    it('will not submit a right the list does not offer', async () => {
      const dialog = await open({ permissions: NO_READ });
      dialog.onSuggestionSelected(MEMBERS);
      expect(dialog.isSubmitDisabled()).toBe(false);

      dialog.right = 'Read';

      expect(dialog.isSubmitDisabled()).toBe(true);
    });

    it('no-ops when create() is called with a right the list does not offer', async () => {
      const dialog = await open({ permissions: NO_READ });
      const mockDialogRef = TestBed.inject(MatDialogRef);
      dialog.onSuggestionSelected(MEMBERS);
      dialog.right = 'Read';

      dialog.create(false);

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  it("falls back to Nuxeo's default three when the read carried no list", async () => {
    const dialog = await open({});
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything']);
  });

  it('keeps an edited entry’s permission in the list when the type does not offer it', async () => {
    const dialog = await open({
      permissions: SAVED_SEARCH_VISIBLE,
      initialData: { userGroup: 'members', right: 'ReadCanCollect', timeFrame: 'Permanent' },
    });
    expect(dialog.right).toBe('ReadCanCollect');
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything', 'ReadCanCollect']);
  });

  it('falls back to Read when an empty permissions list is provided', async () => {
    const dialog = await open({ permissions: [] });
    expect(dialog.right).toBe('Read');
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything']);
  });

  it('creates option labels by passing each right through permissionRightLabel', async () => {
    const dialog = await open({ permissions: ['Read', 'Everything'] });
    expect(dialog.rightOptions).toHaveLength(2);
    expect(dialog.rightOptions[0]).toEqual({ value: 'Read', label: 'Read' });
    expect(dialog.rightOptions[1]).toEqual({ value: 'Everything', label: 'Manage everything' });
  });
});
