/**
 * Phase 6's round trip (docs/business-apps/development-plan.md, demo step 3): the designer's output
 * matches the hand-written JSON byte for byte, for every kit's record pages, edit and create forms
 * and queues, walked from `business-apps/packages` so that a kit added later is held too.
 *
 * **Byte for byte** means, as the README says: the designer's file is the bytes the repository's
 * Prettier writes for the file's JSON value laid out afresh, with `.prettierrc` as it is. A kit's
 * file round-trips when, opened and saved with no edit, the designer gives back its very bytes. The
 * few that cannot, by design, are listed in `NOT_BYTE_FOR_BYTE` with why, and this spec holds the
 * list to the kits: a file that stops round-tripping fails here, and so does one listed that does.
 *
 * Then each single edit made here changes only the edited place: every line outside the list or
 * object the edit is made in is the same bytes before and after, at the same place. It is measured
 * against what the designer writes of the file unedited, which is the file itself but for the four
 * listed. Not every edit of every file can be confined, as the README says; none made here on a
 * kit's file fails to be.
 *
 * Through the pages, the download included, is `round-trip.pages.spec.ts`.
 */
import { join } from 'node:path';
import * as prettier from 'prettier';

import { kitFiles, kits, NOT_BYTE_FOR_BYTE, REPOSITORY, type KitFile } from './kit-files.testing';
import {
  addProperty,
  cardsOf,
  layoutFileText,
  moveField,
  removeField,
  setCardText,
  setFieldRule,
  type LayoutJson,
} from './layout-edits';
import {
  actionsOf,
  addAction,
  addColumn,
  addFacet,
  addSort,
  columnsOf,
  facetsOf,
  moveEntry,
  removeEntry,
  setFacetText,
  setQueueText,
  setSortOrder,
  sortsOf,
} from './queue-edits';

const FILES = kitFiles();

/** The repository's Prettier, as `lint-staged` runs it on a file at `path`. */
async function prettierFormat(
  text: string,
  path: string,
  options: prettier.Options = {},
): Promise<string> {
  const filepath = join(REPOSITORY, path);
  const config = await prettier.resolveConfig(filepath);
  return prettier.format(text, { ...config, ...options, filepath });
}

/**
 * Where each value of a JSON text is written: its first and last line, from 0, by its path as the
 * validator writes one, `cards[0].fields[1]`, the whole file being `''`. Read here, apart from the
 * designer's writer, so that the confinement below is not checked by the code it checks.
 */
function linesOf(text: string): Map<string, readonly [number, number]> {
  const found = new Map<string, readonly [number, number]>();
  let at = 0;
  let line = 0;
  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at])) {
      if (text[at] === '\n') line++;
      at++;
    }
  };
  const string = (): string => {
    const from = at++;
    while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    at++;
    return JSON.parse(text.slice(from, at)) as string;
  };
  const value = (path: string): void => {
    skip();
    const first = line;
    const opening = text[at];
    if (opening === '{' || opening === '[') {
      const closing = opening === '{' ? '}' : ']';
      at++;
      skip();
      if (text[at] === closing) at++;
      else
        for (let index = 0; ; index++) {
          skip();
          if (opening === '{') {
            const key = string();
            skip();
            at++; // the colon
            value(path === '' ? key : `${path}.${key}`);
          } else value(`${path}[${index}]`);
          skip();
          if (text[at++] === closing) break;
        }
    } else if (opening === '"') string();
    else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    found.set(path, [first, line]);
  };
  value('');
  return found;
}

const parentOf = (path: string): string | null => {
  if (path === '') return null;
  const cut = Math.max(path.lastIndexOf('.'), path.lastIndexOf('['));
  return cut < 0 ? '' : path.slice(0, cut);
};

/**
 * The place an edit at `path` is made in: the value there, or, for a value written on one line
 * with what holds it, the outermost value on that one line, since a change to it may draw that
 * line across several, as Prettier does.
 */
function placeOf(text: string, path: string): string {
  const lines = linesOf(text);
  let place = path;
  for (let parent = parentOf(place); parent !== null; parent = parentOf(place)) {
    const held = lines.get(parent);
    if (!held || held[0] !== held[1]) break;
    place = parent;
  }
  return place;
}

/**
 * That `after` differs from `before` within the lines of the place an edit at `path` is made in
 * alone: every line before it, and every line after it, is the same, and it starts on the same line.
 */
function expectConfined(before: string, after: string, path: string): void {
  expect(after).not.toBe(before);
  const place = placeOf(before, path);
  const was = linesOf(before).get(place);
  const now = linesOf(after).get(place);
  if (!was || !now) throw new Error(`no ${place} before or after the edit`);
  const a = before.split('\n');
  const b = after.split('\n');
  expect(now[0]).toBe(was[0]);
  expect(b.slice(0, now[0])).toEqual(a.slice(0, was[0]));
  expect(b.slice(now[1] + 1)).toEqual(a.slice(was[1] + 1));
}

/**
 * That `after` is `before` with the lines of the key at `path` added, which it did not have: every
 * other line is the same, but for the line before them, which may only have gained its comma. An
 * object written on one line is edited on its line, and that alone is checked of it.
 */
function expectAdded(before: string, after: string, path: string): void {
  expect(linesOf(before).has(path)).toBe(false);
  const parent = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '';
  const lines = linesOf(before).get(parent);
  if (lines && lines[0] === lines[1]) {
    expectConfined(before, after, parent);
    return;
  }
  const now = linesOf(after).get(path);
  if (!now) throw new Error(`no ${path} after the edit`);
  const a = before.split('\n');
  const b = after.split('\n');
  const kept = [...b.slice(0, now[0]), ...b.slice(now[1] + 1)];
  expect(kept).toHaveLength(a.length);
  kept.forEach((line, index) =>
    index === now[0] - 1 && line !== a[index]
      ? expect(line).toBe(`${a[index]},`)
      : expect(line).toBe(a[index]),
  );
}

interface Edit {
  readonly name: string;
  readonly edit: (file: LayoutJson) => LayoutJson;
  /** The path of the list or object the edit is made in; or of the key it adds, with `added`. */
  readonly within: string;
  readonly added?: boolean;
}

/** The single edits the designer makes on a layout file, each where this file allows it. */
function layoutEdits(file: LayoutJson): Edit[] {
  const cards = cardsOf(file);
  const edits: Edit[] = [];
  const first = cards[0];
  if (first)
    edits.push(
      {
        name: "a card's id changed",
        edit: (f) => setCardText(f, first.place, 'id', `${first.id}2`),
        within: `${first.path}.id`,
      },
      {
        name: "a card's heading text set",
        edit: (f) => setCardText(f, first.place, 'label', 'A heading'),
        within: `${first.path}.label`,
        added: first.label === '',
      },
    );
  const some = cards.find((each) => each.shows === 'fields' && each.fields.length >= 1);
  if (some)
    edits.push(
      {
        name: 'a property added',
        edit: (f) => addProperty(f, some.place, 'dc:description'),
        within: `${some.path}.fields`,
      },
      {
        name: "a field's rule set",
        edit: (f) => setFieldRule(f, some.place, 0, 'visibleWhen', 'app.rules.canWrite'),
        within: `${some.path}.fields[0]`,
      },
    );
  const two = cards.find((each) => each.shows === 'fields' && each.fields.length >= 2);
  if (two)
    edits.push(
      {
        name: 'a field moved down',
        edit: (f) => moveField(f, two.place, 0, 1),
        within: `${two.path}.fields`,
      },
      {
        name: 'a field hidden',
        edit: (f) => removeField(f, two.place, 1).file,
        within: `${two.path}.fields`,
      },
    );
  return edits;
}

/** The single edits the designer makes on a queue, each where this queue allows it. */
function queueEdits(file: LayoutJson): Edit[] {
  const columns = columnsOf(file);
  const sorts = sortsOf(file);
  const facets = facetsOf(file);
  const edits: Edit[] = [
    { name: 'a column added', edit: (f) => addColumn(f, 'dc:description'), within: 'columns' },
    {
      name: 'its name text set',
      edit: (f) => setQueueText(f, 'label', 'A queue'),
      within: 'label',
      added: !('label' in file),
    },
  ];
  if (columns.length > 1)
    edits.push(
      {
        name: 'a column moved down',
        edit: (f) => moveEntry(f, 'columns', 0, 1),
        within: 'columns',
      },
      {
        name: 'a column hidden',
        edit: (f) => removeEntry(f, 'columns', 1).file,
        within: 'columns',
      },
    );
  if ('labelKey' in file)
    edits.push({
      name: 'its name key changed',
      edit: (f) => setQueueText(f, 'labelKey', 'acme.queue.edited'),
      within: 'labelKey',
    });
  const unsorted = columns.find(
    (column) => column.name && !sorts.some((sort) => sort.field === column.name),
  )?.name;
  if (unsorted)
    edits.push({
      name: 'a sort added',
      edit: (f) => addSort(f, unsorted),
      within: 'sort',
      added: sorts.length === 0,
    });
  if (sorts.length > 0)
    edits.push({
      name: "a sort's order changed",
      edit: (f) => setSortOrder(f, 0, sorts[0].order === 'desc' ? 'asc' : 'desc'),
      within: 'sort[0]',
    });
  edits.push({
    name: 'a facet added',
    edit: (f) => addFacet(f, 'acme_added_agg'),
    within: 'facets',
    added: facets.length === 0,
  });
  if (facets.length > 0)
    edits.push({
      name: "a facet's name set",
      edit: (f) => setFacetText(f, 0, 'label', 'A facet'),
      within: 'facets[0]',
    });
  if (facets.length > 1)
    edits.push({
      name: 'a facet removed',
      edit: (f) => removeEntry(f, 'facets', 0).file,
      within: 'facets',
    });
  for (const list of ['rowActions', 'bulkActions'] as const) {
    const actions = actionsOf(file, list);
    const id = list === 'rowActions' ? 'app.rowActions.rename' : 'app.bulkActions.compare';
    if (!actions.some((action) => action.id === id))
      edits.push({
        name: `an action added to ${list}`,
        edit: (f) => addAction(f, list, id),
        within: list,
        added: actions.length === 0,
      });
    if (actions.length > 1) {
      edits.push({
        name: `an action of ${list} moved down`,
        edit: (f) => moveEntry(f, list, 0, 1),
        within: list,
      });
      edits.push({
        name: `an action of ${list} removed`,
        edit: (f) => removeEntry(f, list, 0).file,
        within: list,
      });
    }
  }
  return edits;
}

const editsOf = (file: KitFile): Edit[] => {
  const value = JSON.parse(file.text) as LayoutJson;
  return file.opens.kind === 'layout' ? layoutEdits(value) : queueEdits(value);
};

describe("the designer's round trip over every kit's files", () => {
  it('walks every kit, and finds the files the designer opens in them', () => {
    expect(kits().length).toBeGreaterThanOrEqual(4);
    // Every kit with a layout or a queue has them walked: a kit's folders are read, not listed here.
    for (const kit of kits()) {
      const mine = FILES.filter((file) => file.kit === kit);
      expect(mine.length, kit).toBeGreaterThan(0);
    }
    expect(FILES.some((file) => file.opens.kind === 'layout' && file.opens.mode === 'edit')).toBe(
      true,
    );
    expect(FILES.some((file) => file.opens.kind === 'queue')).toBe(true);
    // Each file listed as not round-tripping is one of them.
    for (const path of Object.keys(NOT_BYTE_FOR_BYTE))
      expect(FILES.map((file) => file.path)).toContain(path);
  });

  describe.each(FILES.map((file) => [file.path, file] as const))('%s', (_, file) => {
    const value = JSON.parse(file.text) as LayoutJson;
    const written = layoutFileText(value);
    const reason = NOT_BYTE_FOR_BYTE[file.path];

    it("is written as the repository's Prettier lays its JSON value out afresh", async () => {
      expect(written).toBe(await prettierFormat(JSON.stringify(value), file.path));
    });

    it(
      reason
        ? `cannot round-trip by design, and is listed: ${reason}`
        : 'unedited, is written back byte for byte',
      async () => {
        if (!reason) {
          expect(written).toBe(file.text);
          return;
        }
        // Why, checked: the file is Prettier's own, and its only difference from the designer's is
        // the objects its author kept across lines, which Prettier collapses when told to.
        expect(written).not.toBe(file.text);
        expect(await prettierFormat(file.text, file.path)).toBe(file.text);
        expect(await prettierFormat(file.text, file.path, { objectWrap: 'collapse' })).toBe(
          written,
        );
      },
    );

    const edits = editsOf(file);
    it('is edited at least once below', () => expect(edits.length).toBeGreaterThan(0));

    it.each(edits.map((edit) => [edit.name, edit] as const))(
      'with %s, changes only the edited place',
      (_name, edit) => {
        const after = layoutFileText(edit.edit(value));
        if (edit.added) expectAdded(written, after, edit.within);
        else expectConfined(written, after, edit.within);
      },
    );
  });
});
