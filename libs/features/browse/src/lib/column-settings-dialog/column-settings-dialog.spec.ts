import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_COLUMNS,
  ColumnSettingsDialogComponent,
  loadColumnSettings,
  loadColumnVisibility,
  saveColumnSettings,
  type ColumnDef,
} from './column-settings-dialog';

/** The production key. */
const STORAGE_KEY = 'browse_column_settings';

describe('column settings persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('writes only the visible keys, under the production browse key', () => {
    saveColumnSettings([
      { key: 'title', label: 'Title', visible: true },
      { key: 'type', label: 'Type', visible: false },
      { key: 'state', label: 'State', visible: true },
    ]);

    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['title', 'state']));
  });

  it('distinguishes never-chosen (null) from everything-switched-off (empty array)', () => {
    expect(loadColumnVisibility()).toBeNull();

    saveColumnSettings(ALL_COLUMNS.map((c) => ({ ...c, visible: false })));

    expect(loadColumnVisibility()).toEqual([]);
  });

  it('returns null for a malformed stored value rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadColumnVisibility()).toBeNull();
  });

  it('returns null when the stored value is valid JSON but not an array', () => {
    localStorage.setItem(STORAGE_KEY, '{"title":true}');
    expect(loadColumnVisibility()).toBeNull();
  });

  it('drops non-string members of a stored array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['title', 42, null, 'state']));
    expect(loadColumnVisibility()).toEqual(['title', 'state']);
  });

  it('returns null when localStorage itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadColumnVisibility()).toBeNull();
  });

  it('loadColumnSettings applies the stored selection to the packaged column list', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['title', 'state']));

    const loaded = loadColumnSettings();

    expect(loaded.filter((c) => c.visible).map((c) => c.key)).toEqual(['title', 'state']);
    expect(loaded.map((c) => c.key)).toEqual(ALL_COLUMNS.map((c) => c.key));
  });

  it('loadColumnSettings falls back to the packaged defaults when nothing is stored', () => {
    const loaded = loadColumnSettings();

    expect(loaded.filter((c) => c.visible).map((c) => c.key)).toEqual(
      ALL_COLUMNS.filter((c) => c.visible).map((c) => c.key),
    );
  });

  it('loadColumnSettings returns copies, so a caller cannot mutate the packaged list', () => {
    const loaded = loadColumnSettings();
    loaded[0].visible = !loaded[0].visible;

    expect(ALL_COLUMNS[0].visible).toBe(true);
  });
});

describe('ColumnSettingsDialogComponent', () => {
  const close = vi.fn();

  async function setup(data: ColumnDef[]) {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ColumnSettingsDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    })
      .overrideComponent(ColumnSettingsDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(ColumnSettingsDialogComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => localStorage.clear());

  it('edits a copy of the incoming columns, leaving the caller array untouched', async () => {
    const incoming: ColumnDef[] = [
      { key: 'title', label: 'Title', visible: true },
      { key: 'type', label: 'Type', visible: false },
    ];

    const component = await setup(incoming);
    component.columns[1].visible = true;

    expect(incoming[1].visible).toBe(false);
  });

  it('reset() restores the packaged defaults without writing to storage yet', async () => {
    const component = await setup([{ key: 'title', label: 'Title', visible: false }]);

    component.reset();

    expect(component.columns.map((c) => c.key)).toEqual(ALL_COLUMNS.map((c) => c.key));
    expect(component.columns.find((c) => c.key === 'title')?.visible).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('done() persists the selection and closes with the edited columns', async () => {
    const component = await setup([
      { key: 'title', label: 'Title', visible: true },
      { key: 'type', label: 'Type', visible: false },
      { key: 'nature', label: 'Nature', visible: true },
    ]);

    component.done();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['title', 'nature']));
    expect(close).toHaveBeenCalledWith(component.columns);
  });

  it('done() after reset() persists the packaged default selection', async () => {
    const component = await setup([{ key: 'title', label: 'Title', visible: false }]);

    component.reset();
    component.done();

    expect(loadColumnVisibility()).toEqual(ALL_COLUMNS.filter((c) => c.visible).map((c) => c.key));
  });
});
