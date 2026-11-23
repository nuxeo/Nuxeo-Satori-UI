import { describe, expect, it } from 'vitest';

import { PACKAGED_BULK_ACTIONS } from './packaged-actions';
import { PACKAGED_WHOLE_QUERY_BULK_ACTIONS, wholeQueryBulkAction } from './whole-query-actions';

describe('wholeQueryBulkAction', () => {
  it("maps Delete to the framework's trash, sent value true, and refreshes the list", () => {
    expect(wholeQueryBulkAction('app.bulkActions.delete')).toEqual({
      action: 'trash',
      parameters: { value: true },
      refresh: true,
    });
  });

  it('maps none of the other packaged bulk actions: the server has no HTTP action for them', () => {
    const mapped = PACKAGED_BULK_ACTIONS.map((action) => action.id).filter(
      (id) => wholeQueryBulkAction(id) !== null,
    );
    expect(mapped).toEqual(['app.bulkActions.delete']);
  });

  it('maps only packaged bulk actions', () => {
    const packaged = new Set(PACKAGED_BULK_ACTIONS.map((action) => action.id));
    for (const id of Object.keys(PACKAGED_WHOLE_QUERY_BULK_ACTIONS)) {
      expect(packaged.has(id)).toBe(true);
    }
  });

  it('answers null for an id it does not map, including the names an object inherits', () => {
    for (const id of ['acme.bulkActions.archive', 'toString', '__proto__', 'constructor', '']) {
      expect(wholeQueryBulkAction(id)).toBeNull();
    }
  });

  it('cannot be changed at run time: neither the table, an entry nor its parameters', () => {
    const table = PACKAGED_WHOLE_QUERY_BULK_ACTIONS as Record<string, unknown>;
    const entry = PACKAGED_WHOLE_QUERY_BULK_ACTIONS['app.bulkActions.delete'] as {
      action: string;
      parameters: Record<string, unknown>;
    };
    expect(() => {
      table['acme.bulkActions.archive'] = { action: 'setProperties', parameters: {} };
    }).toThrow(TypeError);
    expect(() => {
      entry.action = 'deletion';
    }).toThrow(TypeError);
    expect(() => {
      entry.parameters['value'] = false;
    }).toThrow(TypeError);
    expect(wholeQueryBulkAction('app.bulkActions.delete')?.action).toBe('trash');
  });
});
