import type { CHECKLIST_SUBFIELDS } from '@agentic-ui/shared/app-definition';

import type { LayoutLabel } from '../layout.model';
import { type RecordValueContext, showValue, viewText } from './record-field-view';
import type { RecordChecklistEntry } from './record-layout';
import { own } from './widget-support';

/**
 * How the record page shows a checklist's card (layout-v2.md, section 7): the file's items, in
 * its order, each done or not by the record's own entry for it, with who and when for one that is.
 *
 * Functions from the record's value to a view, so the card is tested without drawing a page, as
 * the widgets are. They read the record already loaded and make no request; the users' names come
 * from the page's lookups, as a `user` field's do.
 */

/** One item, as the page shows it. */
export interface RecordChecklistItemShown {
  /** What the property's `item` subfield holds for it. */
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  /**
   * Who did it, as a `user` field shows a user: their name once it is read, the stored name
   * until then. `null` for an item not done, or done with no one recorded.
   */
  readonly by: string | null;
  /** The day, as the `date` widget shows one. `null` for an item not done, or with no day. */
  readonly on: string | null;
}

/** A checklist's card, as the page shows it. */
export interface RecordChecklistShown {
  readonly items: readonly RecordChecklistItemShown[];
  /** How many of the items are done. */
  readonly done: number;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An entry's subfield, by one of the names `CHECKLIST_SUBFIELDS` gives, which the validator holds a
 * schema to: a name renamed there no longer builds here. Its own value only, never an inherited one.
 */
const subfield = (entry: Json, name: keyof typeof CHECKLIST_SUBFIELDS): unknown => own(entry, name);

/**
 * The record's entry for each item it names, the first one that names it: what the page reads as
 * that item's state. An entry that is not an object, or whose `item` is not a text, names none.
 */
export function checklistEntries(value: unknown): ReadonlyMap<string, Json> {
  const entries = new Map<string, Json>();
  for (const entry of Array.isArray(value) ? value : []) {
    if (!isRecord(entry)) continue;
    const item = subfield(entry, 'item');
    if (typeof item === 'string' && !entries.has(item)) entries.set(item, entry);
  }
  return entries;
}

/**
 * The user names a checklist shows: the `doneBy` of each item the file lists that is done, which
 * the page reads with the rest of its users. An item not done shows no one, so its name is not
 * read.
 */
export function checklistUsers(checklist: RecordChecklistEntry, value: unknown): string[] {
  const entries = checklistEntries(value);
  return checklist.items.flatMap((item) => {
    const entry = entries.get(item.id);
    const by = entry && subfield(entry, 'done') === true ? subfield(entry, 'doneBy') : undefined;
    return typeof by === 'string' && by !== '' ? [by] : [];
  });
}

/**
 * The property's value with one item ticked, `done` `true`, or unticked: what a tick on the page
 * writes back, whole, as the Edit form writes a list (layout-v2.md, section 7).
 *
 * - **The record's entries stay, in their order:** an entry for an item the file does not list, a
 *   second entry for an item, one that is not an object, and every subfield besides the four.
 * - **The item's first entry,** the one the page reads its state from, changes. Ticked, it holds
 *   `done` `true`, `by` as `doneBy` and `on` as `doneOn`; unticked, it keeps its entry with `done`
 *   `false`, and the who and when it held, which the page does not show for an item not done.
 * - **An item with no entry** gets one at the end when ticked. Unticked, there is nothing to change.
 * - **Every item of `shown` with no entry gets one too,** at the end, in their order, `done`
 *   `false` and no one or day: the items the page shows over the same property, on every card it
 *   draws (layout-v2.md, section 7). So once a record is ticked, it holds an entry for each item it
 *   is held to, and a query can find it by one not done: the items are the file's, and NXQL sees
 *   only the record's entries. An item `shown` names twice gets one entry.
 *
 * Who and when are the client's: `by` is the signed-in user's name and `on` the page's clock. The
 * server's audit log, and the record's timeline, say who changed the property and when.
 */
export function tickedChecklist(
  value: unknown,
  item: string,
  done: boolean,
  by: string,
  on: string,
  shown: readonly string[] = [],
): unknown[] {
  const entries: unknown[] = Array.isArray(value) ? [...value] : [];
  const first = entries.findIndex((entry) => isRecord(entry) && subfield(entry, 'item') === item);
  const written = (entry: Json): Json =>
    done ? { ...entry, item, done: true, doneBy: by, doneOn: on } : { ...entry, done: false };
  if (first >= 0) entries[first] = written(entries[first] as Json);
  else if (done) entries.push(written({}));
  const held = new Set(
    entries.flatMap((entry) => {
      const id = isRecord(entry) ? subfield(entry, 'item') : undefined;
      return typeof id === 'string' ? [id] : [];
    }),
  );
  for (const missing of shown) {
    if (held.has(missing)) continue;
    held.add(missing);
    entries.push({ item: missing, done: false });
  }
  return entries;
}

/**
 * The card's items, from the property's value, `value`. An item is done only when its entry's
 * `done` is `true`: a missing entry, `false`, or anything else is not done, and shows neither who
 * nor when, whatever the entry still holds. An entry for an item the file does not list is not
 * shown.
 */
export function showChecklist(
  checklist: RecordChecklistEntry,
  value: unknown,
  label: (label: LayoutLabel) => string,
  context: RecordValueContext,
): RecordChecklistShown {
  const entries = checklistEntries(value);
  const items = checklist.items.map((item): RecordChecklistItemShown => {
    const entry = entries.get(item.id);
    const done = entry !== undefined && subfield(entry, 'done') === true;
    const by = done && entry ? subfield(entry, 'doneBy') : undefined;
    const on = done && entry ? subfield(entry, 'doneOn') : undefined;
    const day = showValue(
      { key: item.id, label: '', value: on, parameters: {}, definition: { type: 'date' } },
      'date',
      context,
    );
    return {
      id: item.id,
      label: label(item.label),
      done,
      by: typeof by === 'string' && by !== '' ? context.principal('user', by) : null,
      on: day.kind === 'empty' ? null : viewText(day, context.flagText),
    };
  });
  return { items, done: items.filter((item) => item.done).length };
}
