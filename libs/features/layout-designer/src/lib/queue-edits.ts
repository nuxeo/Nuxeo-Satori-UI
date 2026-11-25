/**
 * The designer's edits on a queue, `queues/<id>.json` (docs/business-apps/app-definition-v2.md,
 * section 4): its name, its columns, its sort and its facets.
 *
 * As for a layout file's edits, each takes the file and gives back a new one, the file it was
 * given left as it was, and changes only what it names: every other key, one the queue format does
 * not have included, is kept as written. An edit whose entry is not in the file gives the file back
 * unchanged. Whether the result is a valid queue is the validator's to say.
 */
import { fieldOf, type DesignerField, type LayoutJson } from './layout-edits';

/** A queue's lists the designer edits. */
export type QueueList = 'columns' | 'sort' | 'facets';

/** One entry of a queue's `sort`, as the designer lists it. */
export interface DesignerSort {
  readonly index: number;
  /** The property sorted on, or `''` for an entry that names none, which the validator refuses. */
  readonly field: string;
  /** `asc` or `desc`, or `null` when the entry says neither, and the page provider's order holds. */
  readonly order: 'asc' | 'desc' | null;
}

/** One of a queue's facets, as the designer lists it. */
export interface DesignerFacet {
  readonly index: number;
  /** The page provider's aggregate it filters on, by the server's id. */
  readonly aggregate: string;
  readonly label: string;
  readonly labelKey: string;
}

/** The keys of a queue's own name, and of a facet's, that the designer edits. */
export type QueueText = 'label' | 'labelKey';

const isObject = (value: unknown): value is LayoutJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const listOf = (file: unknown, key: QueueList): readonly unknown[] => {
  const list = isObject(file) ? file[key] : undefined;
  return Array.isArray(list) ? list : [];
};

/** The queue's columns, in their order, read as a card's fields are. */
export function columnsOf(file: unknown): DesignerField[] {
  return listOf(file, 'columns').map(fieldOf);
}

/** The queue's sort, in its order. */
export function sortsOf(file: unknown): DesignerSort[] {
  return listOf(file, 'sort').map((entry, index) => {
    const sort = isObject(entry) ? entry : {};
    const order = sort['order'];
    return {
      index,
      field: text(sort['field']),
      order: order === 'asc' || order === 'desc' ? order : null,
    };
  });
}

/** The queue's facets, in their order. */
export function facetsOf(file: unknown): DesignerFacet[] {
  return listOf(file, 'facets').map((entry, index) => {
    const facet = isObject(entry) ? entry : {};
    return {
      index,
      aggregate: text(facet['aggregate']),
      label: text(facet['label']),
      labelKey: text(facet['labelKey']),
    };
  });
}

/**
 * The file with `change` made to a copy of its list `key`. A `sort` or `facets` list left empty is
 * taken out, as a queue with neither writes none; `columns` is kept, and an empty one refused by
 * the validator. Unchanged when the file has no such list and `create` is not asked for.
 */
function withList(
  file: LayoutJson,
  key: QueueList,
  change: (list: unknown[]) => void,
  create = false,
): LayoutJson {
  const copy = structuredClone(file);
  if (!Array.isArray(copy[key])) {
    if (!create || key in copy) return copy;
    copy[key] = [];
  }
  const list = copy[key] as unknown[];
  change(list);
  if (list.length === 0 && key !== 'columns') delete copy[key];
  return copy;
}

/** The file with the entry of `key` at `from` moved to `to`, the others keeping their order. */
export function moveEntry(file: LayoutJson, key: QueueList, from: number, to: number): LayoutJson {
  return withList(file, key, (list) => {
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    const [entry] = list.splice(from, 1);
    list.splice(to, 0, entry);
  });
}

/**
 * The file without the entry of `key` at `index`, and that entry, as written, to put back with
 * {@link insertEntry}. `entry` is `undefined` when there is no such entry.
 */
export function removeEntry(
  file: LayoutJson,
  key: QueueList,
  index: number,
): { readonly file: LayoutJson; readonly entry: unknown } {
  let entry: unknown;
  const next = withList(file, key, (list) => {
    if (index < 0 || index >= list.length) return;
    [entry] = list.splice(index, 1);
  });
  return { file: next, entry };
}

/** The file with `entry` in its list `key` at `index`, or last when the list has fewer. */
export function insertEntry(
  file: LayoutJson,
  key: QueueList,
  index: number,
  entry: unknown,
): LayoutJson {
  return withList(
    file,
    key,
    (list) => list.splice(Math.max(0, Math.min(index, list.length)), 0, structuredClone(entry)),
    true,
  );
}

/**
 * The file with the property `xpath` as its last column, written `"<prefix>:<name>"`, so that the
 * widget its schema type picks shows it.
 */
export function addColumn(file: LayoutJson, xpath: string): LayoutJson {
  return insertEntry(file, 'columns', Number.MAX_SAFE_INTEGER, xpath);
}

/** The file sorted last on `xpath`, ascending. */
export function addSort(file: LayoutJson, xpath: string): LayoutJson {
  return insertEntry(file, 'sort', Number.MAX_SAFE_INTEGER, { field: xpath, order: 'asc' });
}

/** The file with the sort at `index` in the order `order`. */
export function setSortOrder(file: LayoutJson, index: number, order: 'asc' | 'desc'): LayoutJson {
  return withList(file, 'sort', (list) => {
    const entry: unknown = list[index];
    if (isObject(entry)) entry['order'] = order;
  });
}

/** The file filtered last by the page provider's aggregate `aggregate`, with no label of its own. */
export function addFacet(file: LayoutJson, aggregate: string): LayoutJson {
  return insertEntry(file, 'facets', Number.MAX_SAFE_INTEGER, { aggregate });
}

/**
 * The file with the facet at `index` given `value` for `key`. An empty `label` or `labelKey` is
 * taken out rather than written empty, and the facet is then named by its aggregate.
 */
export function setFacetText(
  file: LayoutJson,
  index: number,
  key: QueueText,
  value: string,
): LayoutJson {
  return withList(file, 'facets', (list) => {
    const entry: unknown = list[index];
    if (!isObject(entry)) return;
    if (value === '') delete entry[key];
    else entry[key] = value;
  });
}

/**
 * The file with the queue's own `label` or `labelKey` set to `value`, or taken out when it is
 * empty. A queue with neither is refused by the validator: it needs a name.
 */
export function setQueueText(file: LayoutJson, key: QueueText, value: string): LayoutJson {
  const copy = structuredClone(file);
  if (value === '') delete copy[key];
  else copy[key] = value;
  return copy;
}

/** The name a package gives a queue's file, under `queues/`. */
export function queueFileName(id: string): string {
  return `${id}.json`;
}
