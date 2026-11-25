import type { LayoutJson } from './layout-edits';
import {
  addColumn,
  addFacet,
  addSort,
  columnsOf,
  facetsOf,
  insertEntry,
  moveEntry,
  queueFileName,
  removeEntry,
  setFacetText,
  setQueueText,
  setSortOrder,
  sortsOf,
} from './queue-edits';

/** The Contracts kit's renewals queue, cut down, with a facet and a key of its own. */
const RENEWALS: LayoutJson = {
  $schema: '../queue.schema.json',
  version: 2,
  labelKey: 'contracts.queue.up-for-renewal',
  pageProvider: 'contracts_up_for_renewal',
  columns: [
    'contract:number',
    { field: 'dc:title', labelKey: 'contracts.field.title' },
    { field: 'contract:end', widget: 'relative-date' },
  ],
  sort: [{ field: 'contract:end', order: 'asc' }],
  facets: [{ aggregate: 'contract_status', label: 'Status' }],
  pageSize: 50,
  later: true,
};

describe('the queue edits', () => {
  it('lists the columns, the sort and the facets, as written', () => {
    expect(columnsOf(RENEWALS).map((column) => [column.kind, column.name, column.widget])).toEqual([
      ['property', 'contract:number', null],
      ['property', 'dc:title', null],
      ['property', 'contract:end', 'relative-date'],
    ]);
    expect(sortsOf(RENEWALS)).toEqual([{ index: 0, field: 'contract:end', order: 'asc' }]);
    expect(facetsOf(RENEWALS)).toEqual([
      { index: 0, aggregate: 'contract_status', label: 'Status', labelKey: '' },
    ]);
    expect(sortsOf({ sort: [{ field: 'dc:title', order: 'up' }, 'x'] })).toEqual([
      { index: 0, field: 'dc:title', order: null },
      { index: 1, field: '', order: null },
    ]);
    expect(columnsOf(null)).toEqual([]);
  });

  it('moves, takes out and puts back a column, changing nothing else', () => {
    const before = structuredClone(RENEWALS);
    const moved = moveEntry(RENEWALS, 'columns', 2, 0);
    expect(columnsOf(moved).map((column) => column.name)).toEqual([
      'contract:end',
      'contract:number',
      'dc:title',
    ]);
    const { file: hidden, entry } = removeEntry(moved, 'columns', 2);
    expect(entry).toEqual({ field: 'dc:title', labelKey: 'contracts.field.title' });
    const back = insertEntry(hidden, 'columns', 2, entry);
    expect(back).toEqual(moved);
    expect(RENEWALS).toEqual(before);
    expect(back['later']).toBe(true);
    expect(moveEntry(RENEWALS, 'columns', 0, 9)).toEqual(RENEWALS);
    expect(removeEntry(RENEWALS, 'columns', 9)).toEqual({ file: RENEWALS, entry: undefined });
  });

  it('keeps an empty column list, for the validator to refuse', () => {
    let file: LayoutJson = { version: 2, columns: ['dc:title'] };
    file = removeEntry(file, 'columns', 0).file;
    expect(file['columns']).toEqual([]);
  });

  it('adds a column as its property, last', () => {
    expect(columnsOf(addColumn(RENEWALS, 'contract:owner')).at(-1)?.name).toBe('contract:owner');
    expect((addColumn(RENEWALS, 'contract:owner')['columns'] as unknown[]).at(-1)).toBe(
      'contract:owner',
    );
  });

  it('adds a sort, sets its order, and takes the list out once it is empty', () => {
    const sorted = addSort(RENEWALS, 'dc:title');
    expect(sortsOf(sorted).at(-1)).toEqual({ index: 1, field: 'dc:title', order: 'asc' });
    const descending = setSortOrder(sorted, 1, 'desc');
    expect(sortsOf(descending).at(-1)?.order).toBe('desc');
    const none = removeEntry(removeEntry(descending, 'sort', 1).file, 'sort', 0).file;
    expect('sort' in none).toBe(false);
    // A file with no sort gets one.
    expect(addSort(none, 'contract:end')['sort']).toEqual([
      { field: 'contract:end', order: 'asc' },
    ]);
  });

  it('adds a facet by its aggregate, names it, and takes out an empty name', () => {
    const faceted = addFacet(RENEWALS, 'contract_category');
    expect(facetsOf(faceted).at(-1)).toEqual({
      index: 1,
      aggregate: 'contract_category',
      label: '',
      labelKey: '',
    });
    const named = setFacetText(faceted, 1, 'labelKey', 'contracts.facet.category');
    expect((named['facets'] as LayoutJson[])[1]).toEqual({
      aggregate: 'contract_category',
      labelKey: 'contracts.facet.category',
    });
    expect((setFacetText(named, 0, 'label', '')['facets'] as LayoutJson[])[0]).toEqual({
      aggregate: 'contract_status',
    });
    expect('facets' in removeEntry(RENEWALS, 'facets', 0).file).toBe(false);
  });

  it("sets the queue's own name, and takes out an empty one for the validator to judge", () => {
    expect(setQueueText(RENEWALS, 'label', 'Renewals')['label']).toBe('Renewals');
    expect('labelKey' in setQueueText(RENEWALS, 'labelKey', '')).toBe(false);
    expect(queueFileName('up-for-renewal')).toBe('up-for-renewal.json');
  });
});
