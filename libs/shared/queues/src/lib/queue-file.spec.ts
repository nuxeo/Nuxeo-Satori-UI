import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORE_RULE_EVALUATORS, DOCUMENT_RULE_EVALUATORS } from '@nuxeo/satori-platform/extensions';

import { readQueue, type QueueRegistered, type ReadQueue } from './queue-file';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'app-definition-v2.md'), 'utf8');
/** The proposal's `queues/unassigned-claims.json`, as the app is to read it. */
const example = JSON.parse(
  /```json queues\/unassigned-claims\.json\n([\s\S]*?)```/.exec(proposal)?.[1] ?? 'null',
) as Record<string, unknown>;
const sample = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', 'samples', 'documents', 'queues', 'documents.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/** What the app registers: the composites and the document rules, `app.rules.inGroup` among them. */
const REGISTERED: QueueRegistered = {
  rules: [...Object.keys(CORE_RULE_EVALUATORS), ...Object.keys(DOCUMENT_RULE_EVALUATORS)],
  rowActions: [],
  bulkActions: [],
};

/** A queue of the proposal's shape, with `keys` in place of its own. */
const queue = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  label: 'Unassigned claims',
  pageProvider: 'payers_unassigned_claims',
  columns: ['claim:number', { field: 'claim:received', widget: 'relative-date' }],
  ...keys,
});

const read = (content: unknown, registered = REGISTERED): ReadQueue =>
  readQueue(content, registered);

function queueOf(result: ReadQueue) {
  if (!('queue' in result)) throw new Error(`refused: ${result.refused.join('; ')}`);
  return result.queue;
}
const problems = (result: ReadQueue): readonly string[] =>
  'problems' in result ? result.problems : result.refused;

describe('readQueue', () => {
  it("reads the proposal's queue, leaving out the package's own actions, which this build does not run", () => {
    const result = read(example);
    const read_ = queueOf(result);
    expect(read_.label).toBe('Unassigned claims');
    expect(read_.labelKey).toBe('payers.queue.unassigned');
    expect(read_.list.pageProvider).toBe('payers_unassigned_claims');
    expect(read_.list.columns.map((column) => [column.xpath, column.widget])).toEqual([
      ['claim:number', null],
      ['claim:member', 'document-link'],
      ['claim:billedAmount', 'currency'],
      ['claim:received', 'relative-date'],
    ]);
    expect(read_.list.columns[2].parameters).toEqual({ currency: 'USD' });
    expect(read_.list.sort).toEqual([{ field: 'claim:received', order: 'asc' }]);
    expect(read_.list.pageSize).toBe(50);
    expect(read_.parameters).toEqual([]);
    expect(read_.facets).toEqual([
      { aggregate: 'claim_type_agg', label: 'Claim type', labelKey: null, widget: null },
    ]);
    // `payers.claim.requestRecords` and `payers.claims.assignToMe` are the package's, from its
    // actions.json: phase 2 runs them, so this build registers neither.
    expect(read_.list.rowActions).toEqual(['app.rowActions.download']);
    expect(read_.bulkActions).toEqual(['app.bulkActions.downloadZip']);
    expect(read_.visibleWhen).toEqual({
      type: 'app.rules.inGroup',
      parameters: ['claims-adjusters'],
    });
    expect(read_.alwaysHidden).toBe(false);
    expect(problems(result)).toEqual([
      expect.stringMatching(
        /^rowActions\[0\]: .*payers\.claim\.requestRecords.*rowActions\[0\] left out$/,
      ),
      expect.stringMatching(
        /^bulkActions\[0\]: .*payers\.claims\.assignToMe.*bulkActions\[0\] left out$/,
      ),
    ]);
  });

  it("knows a customer's own actions, registered in Layer 2 code, though the validator does not", () => {
    const read_ = queueOf(
      read(example, {
        ...REGISTERED,
        rowActions: ['payers.claim.requestRecords'],
        bulkActions: ['payers.claims.assignToMe'],
      }),
    );
    expect(read_.list.rowActions).toEqual([
      'payers.claim.requestRecords',
      'app.rowActions.download',
    ]);
    expect(read_.bulkActions).toEqual(['payers.claims.assignToMe', 'app.bulkActions.downloadZip']);
  });

  it("reads the development server's sample whole", () => {
    const result = read(sample);
    expect(problems(result)).toEqual([]);
    expect(queueOf(result).facets.map((facet) => facet.aggregate)).toEqual([
      'dc_nature_agg',
      'dc_creator_agg',
      'dc_modified_agg',
    ]);
  });

  describe('a search', () => {
    it('reads its name and whether it opens a record found alone; none without one', () => {
      expect(queueOf(read(queue())).search).toBeNull();
      expect(
        queueOf(read(queue({ search: { labelKey: 'records.lookup.barcode', open: 'single' } })))
          .search,
      ).toEqual({ label: null, labelKey: 'records.lookup.barcode', openSingle: true });
      expect(queueOf(read(queue({ search: { label: 'Barcode' } }))).search).toEqual({
        label: 'Barcode',
        labelKey: null,
        openSingle: false,
      });
    });

    it('refuses the queue rather than drawing it without a search it cannot read', () => {
      // Without its search the queue would ask its page provider with a parameter too few.
      expect(problems(read(queue({ search: { label: 'Barcode', scan: 'camera' } })))).toEqual([
        'search.scan: "scan" is not a key version 2 has [unknown]',
      ]);
      expect('refused' in read(queue({ search: { label: 'Barcode', open: 'several' } }))).toBe(
        true,
      );
      expect('refused' in read(queue({ search: {} }))).toBe(true);
      expect('refused' in read(queue({ search: 'barcode' }))).toBe(true);
    });
  });

  it('sends each literal parameter as it is written', () => {
    expect(queueOf(read(queue({ parameters: ['$currentUser', 3, true] }))).parameters).toEqual([
      '$currentUser',
      '3',
      'true',
    ]);
  });

  describe('refuses', () => {
    it.each([
      ['another version', queue({ version: 1 })],
      ['no page provider', queue({ pageProvider: undefined })],
      ['no columns', queue({ columns: [] })],
      [
        'a parameter from a record, which a queue has none of',
        queue({ parameters: [{ field: 'ecm:uuid' }] }),
      ],
      ['a page size over 100', queue({ pageSize: 500 })],
      ['facets that are not a list', queue({ facets: { aggregate: 'claim_type_agg' } })],
      ['a facet with no aggregate', queue({ facets: [{ label: 'Type' }] })],
      ['not an object', ['a queue']],
    ])('a queue with %s', (_, content) => {
      expect('refused' in read(content)).toBe(true);
    });

    it('a queue with an empty parameter, as a related list is not asked with one', () => {
      expect(read(queue({ parameters: ['open', ''] }))).toEqual({
        refused: [
          'parameters[1] is empty: a page provider asked with an empty parameter matches what its author did not mean, or nothing',
        ],
      });
    });

    it('a queue with no column this build can show', () => {
      const result = read(queue({ columns: [{ field: 'claim:number', widget: 'sparkline' }] }));
      expect(result).toEqual({
        refused: [
          expect.stringMatching(/^columns\[0\]\.widget: .*columns\[0\] left out$/),
          'the queue has no column this build can show; left out',
        ],
      });
    });
  });

  describe('leaves out', () => {
    it('a column a finding names, and a computed one, and says why', () => {
      const result = read(
        queue({
          columns: [
            'claim:number',
            { field: 'claim:member', widget: 'sparkline' },
            { id: 'age', computed: { type: 'core.age', parameters: [{ field: 'member:born' }] } },
            'claim:number',
          ],
        }),
      );
      expect(queueOf(result).list.columns.map((column) => column.place)).toEqual(['columns[0]']);
      expect(problems(result)).toEqual([
        expect.stringMatching(/^columns\[1\]\.widget: .*; columns\[1\] left out$/),
        'columns[2] is a computed column, which this build does not draw yet; that column left out',
        'columns[3] shows claim:number again; that column left out',
      ]);
    });

    it("a facet's buckets shown as records, and a facet whose widget is another, left out", () => {
      const result = read(
        queue({
          facets: [
            {
              aggregate: 'claim_member_agg',
              labelKey: 'payers.facet.member',
              widget: 'document-link',
            },
            { aggregate: 'claim_adjuster_agg', label: 'Adjuster', widget: 'user' },
          ],
        }),
      );
      expect(queueOf(result).facets).toEqual([
        {
          aggregate: 'claim_member_agg',
          label: null,
          labelKey: 'payers.facet.member',
          widget: 'document-link',
        },
      ]);
      expect(problems(result)).toEqual([
        expect.stringMatching(
          /^facets\[1\]\.widget: a facet shows its buckets .*; facets\[1\] left out$/,
        ),
      ]);
    });

    it('a facet a finding names, one the search would read for itself, and one repeated', () => {
      const result = read(
        queue({
          facets: [
            { aggregate: 'claim_type_agg', label: 'Type', colour: 'red' },
            { aggregate: 'pageSize', label: 'Size' },
            { aggregate: 'claim.state', label: 'State' },
            { aggregate: 'claim_state_agg', labelKey: 'payers.facet.state' },
            { aggregate: 'claim_state_agg', label: 'State again' },
          ],
        }),
      );
      expect(queueOf(result).facets).toEqual([
        { aggregate: 'claim_state_agg', label: null, labelKey: 'payers.facet.state', widget: null },
      ]);
      expect(problems(result)).toEqual([
        expect.stringMatching(/^facets\[0\]\.colour: .*; facets\[0\] left out$/),
        expect.stringMatching(
          /^facets\[1\]: the aggregate "pageSize" cannot be sent back as a filter.*facets\[1\] left out$/,
        ),
        expect.stringMatching(
          /^facets\[2\]: the aggregate "claim\.state" cannot be sent back.*facets\[2\] left out$/,
        ),
        'facets[4] filters on "claim_state_agg" again; facets[4] left out',
      ]);
    });

    it('an action this build does not register, and keeps the rest in order', () => {
      const result = read(
        queue({
          rowActions: ['acme.rowActions.flag', 'app.rowActions.download'],
          bulkActions: [
            'app.bulkActions.delete',
            'acme.bulkActions.archive',
            'app.bulkActions.downloadZip',
          ],
        }),
      );
      expect(queueOf(result).list.rowActions).toEqual(['app.rowActions.download']);
      expect(queueOf(result).bulkActions).toEqual([
        'app.bulkActions.delete',
        'app.bulkActions.downloadZip',
      ]);
    });
  });

  it("ignores a key of the queue's own it does not know, and says so", () => {
    const result = read(queue({ colour: 'red' }));
    expect(queueOf(result).list.columns).toHaveLength(2);
    expect(problems(result)).toEqual([expect.stringMatching(/^colour: .*; ignored$/)]);
  });

  describe('hides the queue from everyone, rather than show it to everyone,', () => {
    it.each([
      [
        'a rule neither the platform nor this build has',
        { type: 'acme.rules.isNightShift', parameters: [] },
      ],
      [
        'a known rule given parameters it does not take',
        { type: 'app.rules.inGroup', parameters: [3] },
      ],
      [
        'an unknown rule inside a composite',
        { type: 'core.some', parameters: ['acme.rules.isNightShift'] },
      ],
    ])('for %s', (_, visibleWhen) => {
      const result = read(queue({ visibleWhen }));
      expect(queueOf(result).alwaysHidden).toBe(true);
      expect(problems(result).at(-1)).toMatch(/the queue is hidden$/);
    });

    it('for a platform rule this build was made without', () => {
      const result = read(
        queue({ visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] } }),
        {
          ...REGISTERED,
          rules: Object.keys(CORE_RULE_EVALUATORS),
        },
      );
      expect(queueOf(result).alwaysHidden).toBe(true);
      expect(problems(result)).toEqual([
        'visibleWhen names the rule "app.rules.inGroup", which this build does not register; the queue is hidden',
      ]);
    });

    it('for a rule nested deeper than the rule registry answers', () => {
      let rule: unknown = 'core.false';
      for (let level = 0; level < 32; level++) rule = { type: 'core.not', parameters: [rule] };
      const result = read(queue({ visibleWhen: rule }));
      expect(queueOf(result).alwaysHidden).toBe(true);
      expect(problems(result).at(-1)).toMatch(/nests its rule more than 32 levels deep/);
    });

    it('and not for a rule it answers', () => {
      expect(queueOf(read(queue({ visibleWhen: 'core.true' }))).alwaysHidden).toBe(false);
    });
  });
});
