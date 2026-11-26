import { describe, expect, it } from 'vitest';

import type { LayoutLabel } from '../layout.model';
import {
  checklistEntries,
  checklistUsers,
  showChecklist,
  tickedChecklist,
} from './record-checklist';
import type { RecordValueContext } from './record-field-view';
import type { RecordChecklistEntry } from './record-layout';

const context: RecordValueContext = {
  locale: 'en-US',
  today: new Date('2026-11-23T12:00:00Z'),
  vocabulary: (_directory, id) => id,
  principal: (kind, id) =>
    kind === 'user' && id === 'sam.patel'
      ? 'Sam Patel'
      : kind === 'user' && id === 'morgan.chen'
        ? 'Morgan Chen'
        : id,
  record: () => null,
  property: () => undefined,
  label: (label) => label.literal ?? label.fallback,
  flagText: (flag) => (flag ? 'Yes' : 'No'),
  rule: () => true,
  // Far east of UTC, where an instant at 20:00 UTC is already the next day.
  timeZone: '+1300',
};

const label = (written: LayoutLabel): string => written.literal ?? written.fallback ?? '';

/** An appeal's checklist, as the file lists it: what the record is held to. */
const CHECKLIST: RecordChecklistEntry = {
  field: 'case:checklist',
  items: [
    { id: 'acknowledged', label: { literal: 'Acknowledgement sent', keys: [], fallback: null } },
    { id: 'medicalRecords', label: { keys: ['x.y'], fallback: 'Medical records' } },
    { id: 'reviewerAssigned', label: { literal: 'Reviewer assigned', keys: [], fallback: null } },
    { id: 'decisionLetter', label: { literal: 'Decision letter sent', keys: [], fallback: null } },
  ],
  tickable: false,
};

describe('showChecklist', () => {
  it("shows the file's items, in its order, each done or not by the record's entry for it", () => {
    const shown = showChecklist(
      CHECKLIST,
      [
        // The record's order is not the page's: the file's is.
        { item: 'reviewerAssigned', done: true, doneBy: 'morgan.chen', doneOn: '2026-11-04' },
        {
          item: 'acknowledged',
          done: true,
          doneBy: 'sam.patel',
          doneOn: '2026-11-03T00:00:00.000Z',
        },
        { item: 'medicalRecords', done: false, doneBy: null, doneOn: null },
      ],
      label,
      context,
    );
    expect(shown.items).toEqual([
      {
        id: 'acknowledged',
        label: 'Acknowledgement sent',
        done: true,
        by: 'Sam Patel',
        on: 'November 3, 2026',
      },
      { id: 'medicalRecords', label: 'Medical records', done: false, by: null, on: null },
      {
        id: 'reviewerAssigned',
        label: 'Reviewer assigned',
        done: true,
        by: 'Morgan Chen',
        on: 'November 4, 2026',
      },
      // No entry at all: required by the file, and not done.
      { id: 'decisionLetter', label: 'Decision letter sent', done: false, by: null, on: null },
    ]);
    expect(shown.done).toBe(2);
  });

  it('shows neither who nor when for an item not done, whatever its entry still holds', () => {
    const shown = showChecklist(
      CHECKLIST,
      [{ item: 'acknowledged', done: false, doneBy: 'sam.patel', doneOn: '2026-11-03' }],
      label,
      context,
    );
    expect(shown.items[0]).toEqual({
      id: 'acknowledged',
      label: 'Acknowledgement sent',
      done: false,
      by: null,
      on: null,
    });
    expect(shown.done).toBe(0);
  });

  it('takes only true as done: not "true", 1 or a day alone', () => {
    const shown = showChecklist(
      CHECKLIST,
      [
        { item: 'acknowledged', done: 'true', doneBy: 'sam.patel' },
        { item: 'medicalRecords', done: 1 },
        { item: 'reviewerAssigned', doneOn: '2026-11-04' },
      ],
      label,
      context,
    );
    expect(shown.items.map((item) => item.done)).toEqual([false, false, false, false]);
    expect(shown.done).toBe(0);
  });

  it('shows a done item with no one or no day recorded without them', () => {
    const shown = showChecklist(
      CHECKLIST,
      [
        { item: 'acknowledged', done: true },
        { item: 'medicalRecords', done: true, doneBy: '', doneOn: '2026-11-05' },
        { item: 'reviewerAssigned', done: true, doneBy: 'riley.brooks' },
      ],
      label,
      context,
    );
    expect(shown.items.slice(0, 3).map(({ by, on }) => ({ by, on }))).toEqual([
      { by: null, on: null },
      { by: null, on: 'November 5, 2026' },
      // A name the page has not read, or cannot, shows as stored, as a user field's does.
      { by: 'riley.brooks', on: null },
    ]);
  });

  it("shows a stored day as written, and an instant on the reader's day, as the date widget does", () => {
    const shown = showChecklist(
      CHECKLIST,
      [
        { item: 'acknowledged', done: true, doneOn: '2026-11-03T00:00:00.000Z' },
        // 20:00 UTC on the 3rd is the 4th at +13:00.
        { item: 'medicalRecords', done: true, doneOn: '2026-11-03T20:00:00.000Z' },
      ],
      label,
      context,
    );
    expect(shown.items.slice(0, 2).map((item) => item.on)).toEqual([
      'November 3, 2026',
      'November 4, 2026',
    ]);
  });

  it('does not show an entry for an item the file does not list', () => {
    const shown = showChecklist(
      CHECKLIST,
      [{ item: 'peerToPeer', done: true, doneBy: 'sam.patel', doneOn: '2026-11-06' }],
      label,
      context,
    );
    expect(shown.items.map((item) => item.id)).toEqual([
      'acknowledged',
      'medicalRecords',
      'reviewerAssigned',
      'decisionLetter',
    ]);
    expect(shown.done).toBe(0);
  });

  it('shows every item not done when the record holds no list, or something else', () => {
    for (const value of [undefined, null, [], 'done', { item: 'acknowledged', done: true }]) {
      const shown = showChecklist(CHECKLIST, value, label, context);
      expect(shown.items.every((item) => !item.done)).toBe(true);
      expect(shown.done).toBe(0);
    }
  });
});

describe('checklistEntries', () => {
  it("reads each item's first entry, and none that is not an object or names no item", () => {
    const first = { item: 'acknowledged', done: true };
    const entries = checklistEntries([
      'acknowledged',
      null,
      { item: 7, done: true },
      first,
      { item: 'acknowledged', done: false },
      // A subfield every object inherits is not one the entry holds.
      Object.create({ item: 'inherited' }),
    ]);
    expect([...entries.keys()]).toEqual(['acknowledged']);
    expect(entries.get('acknowledged')).toBe(first);
  });
});

describe('checklistUsers', () => {
  it("names who did each listed item that is done, and no one else's", () => {
    expect(
      checklistUsers(CHECKLIST, [
        { item: 'acknowledged', done: true, doneBy: 'sam.patel' },
        { item: 'medicalRecords', done: false, doneBy: 'riley.brooks' },
        { item: 'peerToPeer', done: true, doneBy: 'jordan.kim' },
        { item: 'reviewerAssigned', done: true, doneBy: '' },
      ]),
    ).toEqual(['sam.patel']);
  });
});

describe('tickedChecklist', () => {
  const ON = '2026-11-26T09:30:00.000Z';
  const RECORD = [
    { item: 'reviewerAssigned', done: true, doneBy: 'morgan.chen', doneOn: '2026-11-04' },
    { item: 'legacyStep', done: true, doneBy: 'riley.brooks', doneOn: '2026-10-01' },
    'not an entry',
    { item: 'medicalRecords', done: false, doneBy: 'sam.patel', doneOn: '2026-11-12', note: 'x' },
    { item: 'medicalRecords', done: true, doneBy: 'jordan.kim', doneOn: '2026-11-13' },
  ];

  it("ticks the item's first entry with who and when, and keeps every other entry as it was", () => {
    const written = tickedChecklist(RECORD, 'medicalRecords', true, 'sam.patel', ON);
    expect(written).toEqual([
      RECORD[0],
      RECORD[1],
      'not an entry',
      { item: 'medicalRecords', done: true, doneBy: 'sam.patel', doneOn: ON, note: 'x' },
      RECORD[4],
    ]);
    // The record's own value is not changed: the page shows it until the server answers.
    expect(RECORD[3]).toEqual({
      item: 'medicalRecords',
      done: false,
      doneBy: 'sam.patel',
      doneOn: '2026-11-12',
      note: 'x',
    });
  });

  it('unticks by keeping the entry, with done false and the who and when it held', () => {
    expect(tickedChecklist(RECORD, 'reviewerAssigned', false, 'sam.patel', ON)).toEqual([
      { item: 'reviewerAssigned', done: false, doneBy: 'morgan.chen', doneOn: '2026-11-04' },
      ...RECORD.slice(1),
    ]);
  });

  it('adds an entry at the end for an item ticked with none, and nothing for one unticked', () => {
    expect(tickedChecklist(RECORD, 'decisionLetter', true, 'sam.patel', ON)).toEqual([
      ...RECORD,
      { item: 'decisionLetter', done: true, doneBy: 'sam.patel', doneOn: ON },
    ]);
    expect(tickedChecklist(RECORD, 'decisionLetter', false, 'sam.patel', ON)).toEqual(RECORD);
    for (const value of [undefined, null, 'done', { item: 'decisionLetter' }])
      expect(tickedChecklist(value, 'decisionLetter', true, 'sam.patel', ON)).toEqual([
        { item: 'decisionLetter', done: true, doneBy: 'sam.patel', doneOn: ON },
      ]);
  });

  it('reads an entry by its own item only, never an inherited one', () => {
    const inherited = Object.create({ item: 'decisionLetter' }) as object;
    expect(tickedChecklist([inherited], 'decisionLetter', true, 'sam.patel', ON)).toEqual([
      inherited,
      { item: 'decisionLetter', done: true, doneBy: 'sam.patel', doneOn: ON },
    ]);
  });
});
