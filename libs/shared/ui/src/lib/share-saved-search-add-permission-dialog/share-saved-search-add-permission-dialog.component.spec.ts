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

    it('does not queue an unoffered right through Create And Add Another', async () => {
      const dialog = await open({ permissions: NO_READ });
      const mockDialogRef = TestBed.inject(MatDialogRef);
      dialog.onSuggestionSelected(MEMBERS);
      dialog.right = 'Read';

      dialog.create(true);

      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(dialog.selectedPrincipal).toEqual(MEMBERS);
      dialog.right = 'ReadWrite';
      dialog.create(false);

      expect(mockDialogRef.close).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ right: 'ReadWrite' }),
      ]);
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

  it.each([
    ['Until 2030-01-31', null, new Date(2030, 0, 31)],
    ['From 01/02/2030', new Date(2030, 0, 2), null],
    ['2030-01-02 - 2030-01-31', new Date(2030, 0, 2), new Date(2030, 0, 31)],
    ['Until January 31, 2030', null, new Date(2030, 0, 31)],
    ['Until not-a-date', null, null],
    ['Until ', null, null],
  ])('restores an edited date range %s', async (timeFrame, begin, end) => {
    const dialog = await open({
      initialData: { userGroup: 'members', right: 'Edit', timeFrame, grantedBy: 'Group' },
    });
    expect(dialog.timeFrameMode).toBe('date-based');
    expect(dialog.beginDate).toEqual(begin);
    expect(dialog.endDate).toEqual(end);
    expect(dialog.right).toBe('ReadWrite');
    expect(dialog.selectedPrincipal?.type).toBe('GROUP_TYPE');
    expect(dialog.sendNotify).toBe(false);
  });

  it.each([
    [new Date(2030, 0, 2), new Date(2030, 0, 31), '2030-01-02 - 2030-01-31'],
    [new Date(2030, 0, 2), null, 'From 2030-01-02'],
    [null, new Date(2030, 0, 31), 'Until 2030-01-31'],
    [null, null, 'Permanent'],
  ])('serializes date-based entries with begin %s and end %s', async (begin, end, timeFrame) => {
    const dialog = await open({});
    dialog.onSuggestionSelected(MEMBERS);
    dialog.timeFrameMode = 'date-based';
    dialog.beginDate = begin;
    dialog.endDate = end;

    dialog.create(false);

    expect(TestBed.inject(MatDialogRef).close).toHaveBeenCalledExactlyOnceWith([
      { userGroup: 'members', right: 'Read', timeFrame, grantedBy: 'Group' },
    ]);
    expect(dialog.saving()).toBe(false);
  });

  it('resets date and notification state after adding another, retaining queued entries', async () => {
    const dialog = await open({});
    dialog.onSuggestionSelected(MEMBERS);
    dialog.timeFrameMode = 'date-based';
    dialog.beginDate = new Date(2030, 0, 2);
    dialog.endDate = new Date(2030, 0, 31);
    dialog.sendNotify = false;
    dialog.notifyComment = 'Notify the team';
    dialog.suggestions.set([MEMBERS]);

    dialog.create(true);

    expect(dialog.searchText).toBe('');
    expect(dialog.selectedPrincipal).toBeNull();
    expect(dialog.beginDate).toBeNull();
    expect(dialog.endDate).toBeNull();
    expect(dialog.timeFrameMode).toBe('permanent');
    expect(dialog.sendNotify).toBe(true);
    expect(dialog.notifyComment).toBe('');
    expect(dialog.suggestions()).toEqual([]);
    dialog.onSuggestionSelected({
      ...MEMBERS,
      id: 'alice',
      displayLabel: 'Alice',
      type: 'USER_TYPE',
    });
    dialog.create(false);
    expect(TestBed.inject(MatDialogRef).close).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ timeFrame: '2030-01-02 - 2030-01-31', grantedBy: 'Group' }),
      { userGroup: 'Alice', right: 'Read', timeFrame: 'Permanent', grantedBy: 'User' },
    ]);
  });

  it('preserves an edited principal and grantor when saving a normalized permission', async () => {
    const dialog = await open({
      initialData: {
        userGroup: 'Alice',
        right: 'Manage',
        timeFrame: 'Permanent',
        grantedBy: 'Administrator',
      },
    });
    expect(dialog.selectedPrincipal?.type).toBe('USER_TYPE');
    expect(dialog.right).toBe('Everything');
    dialog.create(false);
    expect(TestBed.inject(MatDialogRef).close).toHaveBeenCalledExactlyOnceWith([
      {
        userGroup: 'Alice',
        right: 'Everything',
        timeFrame: 'Permanent',
        grantedBy: 'Administrator',
      },
    ]);
  });

  it('does not submit without a principal or while saving, and cancels without a result', async () => {
    const dialog = await open({});
    const close = TestBed.inject(MatDialogRef).close;
    dialog.create(false);
    expect(close).not.toHaveBeenCalled();
    dialog.onSuggestionSelected(MEMBERS);
    dialog.saving.set(true);
    dialog.create(false);
    expect(close).not.toHaveBeenCalled();
    dialog.cancel();
    expect(close).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('displays suggestions and clears the selection when the search changes', async () => {
    const dialog = await open({});
    expect(dialog.displaySuggestion(null)).toBe('');
    expect(dialog.displaySuggestion('Alice')).toBe('Alice');
    expect(dialog.displaySuggestion(MEMBERS)).toBe('members');
    dialog.onSuggestionSelected(MEMBERS);
    dialog.onSearchChange('new');
    expect(dialog.searchText).toBe('new');
    expect(dialog.selectedPrincipal).toBeNull();
  });
});
