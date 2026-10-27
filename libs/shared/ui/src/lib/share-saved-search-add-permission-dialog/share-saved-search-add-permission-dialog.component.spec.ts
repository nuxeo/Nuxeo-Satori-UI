import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
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
  type ShareSavedSearchAddPermissionResult,
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
  let fixture: ComponentFixture<ShareSavedSearchAddPermissionDialogComponent>;

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
    fixture = TestBed.createComponent(ShareSavedSearchAddPermissionDialogComponent);
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

  // NXSAT-300: editing an entry must not change the permission it holds. Nuxeo Web UI's
  // `nuxeo-popup-permission` assigns `params.permission = ace.permission` verbatim and only ever
  // defaults to `Read` for a *new* entry (`_getResetParams`), never for an edit.
  describe('an entry holding a permission outside the type’s list', () => {
    // The nine grants NXSAT-300 added, the retention pair, and the section-root permission Nuxeo
    // grants `members` by default. None is in a saved search's `userVisiblePermissions`.
    const OUTSIDE = [
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
      'CanAskForPublishing',
    ];

    it.each(OUTSIDE)('opens an edit of %s on that permission, not another', async (permission) => {
      const dialog = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: { userGroup: 'members', right: permission, timeFrame: 'Permanent' },
      });
      expect(dialog.right).toBe(permission);
    });

    it.each(OUTSIDE)('offers %s so the edit can be submitted unchanged', async (permission) => {
      const dialog = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: { userGroup: 'members', right: permission, timeFrame: 'Permanent' },
      });
      expect(values(dialog)).toEqual([...SAVED_SEARCH_VISIBLE, permission]);
    });

    it.each(OUTSIDE)(
      'returns %s unchanged when the user edits only the dates',
      async (permission) => {
        const dialog = await open({
          permissions: SAVED_SEARCH_VISIBLE,
          initialData: { userGroup: 'members', right: permission, timeFrame: 'Permanent' },
        });
        const mockDialogRef = TestBed.inject(MatDialogRef);

        // Actually move the dates, so this exercises the date-based branch rather than returning
        // through the permanent one — the permission must survive a change to something else.
        dialog.timeFrameMode = 'date-based';
        dialog.beginDate = new Date(2026, 0, 15);
        dialog.endDate = new Date(2026, 1, 20);

        dialog.create(false);

        expect(mockDialogRef.close).toHaveBeenCalledWith([
          expect.objectContaining({
            userGroup: 'members',
            right: permission,
            timeFrame: '2026-01-15 - 2026-02-20',
          }),
        ]);
      },
    );

    it.each(OUTSIDE)('returns %s unchanged for a permanent entry', async (permission) => {
      const dialog = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: { userGroup: 'members', right: permission, timeFrame: 'Permanent' },
      });
      const mockDialogRef = TestBed.inject(MatDialogRef);

      dialog.create(false);

      expect(mockDialogRef.close).toHaveBeenCalledWith([
        expect.objectContaining({
          userGroup: 'members',
          right: permission,
          timeFrame: 'Permanent',
        }),
      ]);
    });
  });

  // NXSAT-334, second round: the dates used to be read back out of the rendered `timeFrame`, which
  // is a *translated* label. Only English parsed, so in any other locale a one-sided range became
  // `Permanent` and the boundary was cleared. The label is now never parsed — `begin`/`end` carry
  // the instants — and this is the round trip the parent relies on.
  describe('dates round-tripping through an edit', () => {
    // A day written at CET midnight, which Nuxeo holds as 23:00 UTC the day before.
    const BEGIN = '2026-01-14T23:00:00.000Z';
    const END = '2026-02-19T23:00:00.000Z';

    const submit = async (
      initial: Partial<ShareSavedSearchAddPermissionDialogData['initialData']> = {},
      act: (d: ShareSavedSearchAddPermissionDialogComponent) => void = () => undefined,
    ) => {
      const dialog = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: {
          userGroup: 'powerusers',
          right: 'Write',
          timeFrame: 'ignored',
          begin: BEGIN,
          end: END,
          ...initial,
        },
      });
      act(dialog);
      dialog.create(false);
      const close = TestBed.inject(MatDialogRef).close as unknown as {
        mock: { calls: unknown[][] };
      };
      return (close.mock.calls[0]?.[0] as ShareSavedSearchAddPermissionResult[])?.[0];
    };

    it('returns both original instants when the user leaves the dates alone', async () => {
      const result = await submit();
      expect(result).toMatchObject({ right: 'Write', begin: BEGIN, end: END });
    });

    it.each([
      ['a translated range', 'Du 15 janv. 2026 au 20 févr. 2026'],
      ['a translated one-sided range', "Jusqu'au 20 févr. 2026"],
      ['a translated open start', 'À partir du 15 janv. 2026'],
    ])('ignores %s in the label and keeps the instants', async (_what, timeFrame) => {
      const result = await submit({ timeFrame });
      expect(result).toMatchObject({ begin: BEGIN, end: END });
    });

    it('keeps a one-sided range one-sided rather than clearing it', async () => {
      const result = await submit({ begin: null, end: END, timeFrame: "Jusqu'au 20 févr. 2026" });
      expect(result).toMatchObject({ begin: null, end: END });
      expect(result.timeFrame).not.toBe('Permanent');
    });

    it('returns the picked days once the user changes them', async () => {
      const result = await submit({}, (d) => {
        d.beginDate = new Date(2026, 2, 1);
        d.onBeginChanged();
        d.endDate = new Date(2026, 2, 31);
        d.onEndChanged();
      });
      expect(result).toMatchObject({ begin: '2026-03-01', end: '2026-03-31' });
    });

    // One flag for both endpoints meant changing the start rewrote the end from its instant to a
    // day, which Nuxeo re-anchors at its own midnight — moving a boundary nobody touched.
    it('keeps the end instant when only the start changes', async () => {
      // Before the end, which is 2026-02-19T23:00Z — an inverted range is refused on purpose.
      const result = await submit({}, (d) => {
        d.beginDate = new Date(2026, 1, 1);
        d.onBeginChanged();
      });
      expect(result).toMatchObject({ begin: '2026-02-01', end: END });
    });

    it('keeps the start instant when only the end changes', async () => {
      const result = await submit({}, (d) => {
        d.endDate = new Date(2026, 2, 31);
        d.onEndChanged();
      });
      expect(result).toMatchObject({ begin: BEGIN, end: '2026-03-31' });
    });

    // Material answers unparseable input with `null` on the model and a parse error on the
    // control. From the model alone that is indistinguishable from a cleared field, so a typo in
    // an existing expiry read as "cleared" and the save removed the boundary.
    describe('invalid date input', () => {
      /** Types `text` into one of the pickers, the way a user would. */
      const type = async (which: 'from' | 'to', text: string) => {
        const host: HTMLElement = fixture.nativeElement;
        // The two date inputs are the ones bound to a datepicker, in From/To order.
        const inputs = host.querySelectorAll<HTMLInputElement>('.date-fields input');
        const input = inputs[which === 'from' ? 0 : 1];
        if (!input) throw new Error(`no ${which} date input (found ${inputs.length})`);
        input.value = text;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await fixture.whenStable();
        return input;
      };

      it('will not submit a mistyped expiry, so the boundary cannot be cleared', async () => {
        const dialog = await open({
          permissions: SAVED_SEARCH_VISIBLE,
          initialData: {
            userGroup: 'powerusers',
            right: 'Write',
            timeFrame: 'x',
            begin: BEGIN,
            end: END,
          },
        });
        expect(dialog.isSubmitDisabled()).toBe(false);

        await type('to', 'not a date');

        expect(dialog.endDate).toBeNull();
        expect(dialog.isSubmitDisabled()).toBe(true);

        dialog.create(false);

        expect(TestBed.inject(MatDialogRef).close).not.toHaveBeenCalled();
      });

      it('still allows clearing a date on purpose', async () => {
        const dialog = await open({
          permissions: SAVED_SEARCH_VISIBLE,
          initialData: {
            userGroup: 'powerusers',
            right: 'Write',
            timeFrame: 'x',
            begin: BEGIN,
            end: END,
          },
        });

        await type('to', '');

        expect(dialog.isSubmitDisabled()).toBe(false);

        dialog.create(false);

        const close = TestBed.inject(MatDialogRef).close as unknown as {
          mock: { calls: unknown[][] };
        };
        const result = (close.mock.calls[0]?.[0] as ShareSavedSearchAddPermissionResult[])?.[0];
        expect(result).toMatchObject({ begin: BEGIN, end: null });
      });
    });

    // Both controls are individually valid when the start is after the end, so nothing else
    // catches it, and Nuxeo accepts the ACE — leaving an entry that never grants anything.
    // `nxs-permissions-panel` refuses the same shape as `invalid-time-frame`.
    describe('an inverted range', () => {
      const dated = () =>
        open({
          permissions: SAVED_SEARCH_VISIBLE,
          initialData: {
            userGroup: 'powerusers',
            right: 'Write',
            timeFrame: 'x',
            begin: BEGIN,
            end: END,
          },
        });

      it('will not submit a start later than the end', async () => {
        const dialog = await dated();
        expect(dialog.isSubmitDisabled()).toBe(false);

        dialog.beginDate = new Date(2026, 2, 1);
        dialog.onBeginChanged();

        expect(dialog.rangeInverted()).toBe(true);
        expect(dialog.isSubmitDisabled()).toBe(true);

        dialog.create(false);

        expect(TestBed.inject(MatDialogRef).close).not.toHaveBeenCalled();
      });

      it('judges on the calendar days shown, not the picker instants', async () => {
        // Two instants the user sees as the same day must not compare as inverted. Instants an
        // hour apart on one day did, depending on the browser's offset.
        const dialog = await dated();

        dialog.beginDate = new Date(2026, 1, 20, 23, 0, 0);
        dialog.onBeginChanged();
        dialog.endDate = new Date(2026, 1, 20, 1, 0, 0);
        dialog.onEndChanged();

        expect(dialog.rangeInverted()).toBe(false);
        expect(dialog.isSubmitDisabled()).toBe(false);
      });

      it('accepts a start equal to the end', async () => {
        const dialog = await dated();

        dialog.beginDate = new Date(2026, 1, 20);
        dialog.onBeginChanged();
        dialog.endDate = new Date(2026, 1, 20);
        dialog.onEndChanged();

        expect(dialog.rangeInverted()).toBe(false);
        expect(dialog.isSubmitDisabled()).toBe(false);
      });

      it('ignores the ordering once the entry is permanent', async () => {
        const dialog = await dated();
        dialog.beginDate = new Date(2026, 2, 1);
        dialog.onBeginChanged();
        expect(dialog.rangeInverted()).toBe(true);

        dialog.timeFrameMode = 'permanent';
        dialog.onTimeFrameModeChanged();

        expect(dialog.rangeInverted()).toBe(false);
        expect(dialog.isSubmitDisabled()).toBe(false);
      });

      it('ignores a single bound, which cannot be inverted', async () => {
        const dialog = await dated();

        dialog.endDate = null;
        dialog.onEndChanged();

        expect(dialog.rangeInverted()).toBe(false);
        expect(dialog.isSubmitDisabled()).toBe(false);
      });
    });

    it('clears both dates when the user makes the entry permanent', async () => {
      const result = await submit({}, (d) => {
        d.timeFrameMode = 'permanent';
        d.onTimeFrameModeChanged();
      });
      expect(result).toMatchObject({ timeFrame: 'Permanent', begin: null, end: null });
    });

    it('writes both as days when the user switches back to date-based', async () => {
      // Switching mode rewrites both endpoints, so neither keeps a stale instant.
      const result = await submit({}, (d) => {
        d.timeFrameMode = 'permanent';
        d.onTimeFrameModeChanged();
        d.timeFrameMode = 'date-based';
        d.onTimeFrameModeChanged();
      });
      expect(result.begin).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('opens a dated entry in date-based mode, from the instants not the label', async () => {
      const dated = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: { userGroup: 'powerusers', right: 'Write', timeFrame: 'x', end: END },
      });
      expect(dated.timeFrameMode).toBe('date-based');
      expect(dated.beginDate).toBeNull();
      expect(dated.endDate).not.toBeNull();
    });

    it('opens an entry with no dates as permanent', async () => {
      const undated = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: { userGroup: 'members', right: 'Read', timeFrame: 'x' },
      });
      expect(undated.timeFrameMode).toBe('permanent');
      expect(undated.beginDate).toBeNull();
      expect(undated.endDate).toBeNull();
    });

    it('shows no date for an instant it cannot parse, but still writes it back', async () => {
      // A value the server sent that is not a date leaves the picker empty rather than showing
      // `Invalid Date`; untouched, it is still returned as it came, so nothing is destroyed.
      const dialog = await open({
        permissions: SAVED_SEARCH_VISIBLE,
        initialData: {
          userGroup: 'powerusers',
          right: 'Write',
          timeFrame: 'x',
          begin: 'not-a-date',
        },
      });
      expect(dialog.beginDate).toBeNull();

      dialog.create(false);

      const close = TestBed.inject(MatDialogRef).close as unknown as {
        mock: { calls: unknown[][] };
      };
      const result = (close.mock.calls[0]?.[0] as ShareSavedSearchAddPermissionResult[])?.[0];
      expect(result.begin).toBe('not-a-date');
    });

    it('carries the notification choices the dialog collected', async () => {
      const result = await submit({}, (d) => {
        d.sendNotify = true;
        d.notifyComment = '  please review  ';
      });
      expect(result).toMatchObject({ notify: true, comment: 'please review' });
    });

    it('sends no comment when notification is off', async () => {
      const result = await submit({}, (d) => {
        d.sendNotify = false;
        d.notifyComment = 'dropped';
      });
      expect(result).toMatchObject({ notify: false, comment: null });
    });
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
