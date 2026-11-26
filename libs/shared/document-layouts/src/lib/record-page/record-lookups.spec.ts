import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { type LinkedRecord, isDocumentId, linkedRecordsQuery } from './linked-record';
import {
  LinkedRecordLookup,
  LookupCollector,
  type Lookups,
  NO_RECORDS,
  namesOf,
  recordIdsOf,
  recordLookups,
  sameLookups,
} from './record-lookups';

const A = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const B = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
const C = '9a651335-d3d4-434c-a7b4-afe7e5c0edae';
const D = '818498bf-08c2-4f8a-9ccc-cc3f88f87075';
const TITLES: Readonly<Record<string, string>> = {
  [A]: 'Wei Chen',
  [B]: 'John Smith',
  [C]: 'Maria Alvarez',
};
const STRING = { type: 'string' };

const found = (ids: readonly string[]): ReadonlyMap<string, LinkedRecord> =>
  new Map(
    ids
      .filter((id) => id in TITLES)
      .map((id): [string, LinkedRecord] => [id, { title: TITLES[id], url: `/doc/${id}` }]),
  );

describe('isDocumentId', () => {
  it('accepts an ecm:uuid as Nuxeo writes one', () => {
    expect(isDocumentId(A)).toBe(true);
  });

  it.each([
    ['upper case', A.toUpperCase()],
    ["a repository's name before it", `default:${A}`],
    ['a path', '/default-domain/workspaces/payers-demo/members/member-100051'],
    ['a trailing line break', `${A}\n`],
    ['a quote that would close a literal', `${A}' OR ecm:uuid IS NOT NULL OR ecm:uuid = '`],
    ['a bracket that would close the list', `${A}') OR (ecm:isProxy = 0`],
    ['nothing', ''],
  ])('refuses %s', (_, value) => {
    expect(isDocumentId(value)).toBe(false);
  });

  it.each([[42], [null], [undefined], [[A]], [{ uid: A }]])(
    'refuses %j, which is not text',
    (value) => {
      expect(isDocumentId(value)).toBe(false);
    },
  );
});

describe('linkedRecordsQuery', () => {
  it('is the same text whatever the ids, a placeholder for each', () => {
    expect(linkedRecordsQuery(1)).toBe('SELECT * FROM Document WHERE ecm:uuid IN (?)');
    expect(linkedRecordsQuery(3)).toBe('SELECT * FROM Document WHERE ecm:uuid IN (?, ?, ?)');
    expect(linkedRecordsQuery(3)).not.toMatch(/['"\\]/);
  });
});

describe('LookupCollector, for document-link', () => {
  it('collects the ids a single or a multi-valued value holds, each once, in order', () => {
    const collector = new LookupCollector();
    collector.value('document-link', {}, STRING, B);
    collector.value('document-link', {}, { type: 'string[]' }, [A, B, '', null]);
    expect(collector.lookups().records).toEqual([A, B].sort());
  });

  it('never collects a value that is not a document id, so it is never asked for', () => {
    const collector = new LookupCollector();
    collector.value('document-link', {}, STRING, `${A}' OR '1'='1`);
    collector.value('document-link', {}, STRING, '/default-domain/members/m1');
    collector.value('document-link', {}, { type: 'string[]' }, [42, { uid: A }]);
    expect(collector.lookups().records).toEqual([]);
  });

  it("collects nothing from another widget's value, nor a vocabulary from a link's", () => {
    const collector = new LookupCollector();
    collector.value('text', {}, STRING, A);
    collector.value('document-link', {}, { type: 'string', directory: 'statuses' }, B);
    expect(collector.lookups()).toEqual({
      vocabulary: [],
      principals: [],
      records: [B],
      schemas: [],
    });
  });

  it('tells two sets apart by their records, so another set is read', () => {
    const one = new LookupCollector();
    one.value('document-link', {}, STRING, A);
    const other = new LookupCollector();
    other.value('document-link', {}, STRING, B);
    const same = new LookupCollector();
    same.value('document-link', {}, STRING, A);
    expect(sameLookups(one.lookups(), other.lookups())).toBe(false);
    expect(sameLookups(one.lookups(), same.lookups())).toBe(true);
  });
});

describe('LinkedRecordLookup', () => {
  let asked: string[][];
  let withSchemas: string[][];
  let answer: (ids: readonly string[]) => Observable<ReadonlyMap<string, LinkedRecord> | null>;
  let lookup: LinkedRecordLookup;

  beforeEach(() => {
    asked = [];
    withSchemas = [];
    answer = (ids) => of(found(ids));
    TestBed.configureTestingModule({
      providers: [
        LinkedRecordLookup,
        {
          provide: DocumentLayoutService,
          useValue: {
            linkedRecords: (ids: readonly string[], schemas: readonly string[] = []) => {
              asked.push([...ids]);
              withSchemas.push([...schemas]);
              return answer(ids);
            },
          },
        },
      ],
    });
    lookup = TestBed.inject(LinkedRecordLookup);
  });

  const records = (ids: readonly string[]) => firstValueFrom(lookup.records(ids));

  it('asks once for a whole set, however many values name each id', async () => {
    const read = await records([B, A, B, C, A]);
    expect(asked).toEqual([[C, B, A].sort()]);
    expect(read.get(A)).toEqual({ title: 'Wei Chen', url: `/doc/${A}` });
    expect([...read.keys()].sort()).toEqual([A, B, C].sort());
  });

  it('never asks again for an id it has read: an equal set, or a set it has read part of', async () => {
    await records([A, B]);
    await records([B, A]);
    expect(asked).toHaveLength(1);
    const read = await records([A, C]);
    expect(asked).toEqual([[A, B].sort(), [C]]);
    expect(read.get(C)?.title).toBe('Maria Alvarez');
  });

  it('keeps a record the server did not return as unavailable, and does not ask for it again', async () => {
    const read = await records([A, D]);
    expect(read.get(D)).toBeNull();
    expect(read.get(A)?.title).toBe('Wei Chen');
    await records([D]);
    expect(asked).toHaveLength(1);
  });

  it('shares one request between two sets asked while it is answered', async () => {
    const pending = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
    answer = () => pending;
    const first = records([A, B]);
    const second = records([B]);
    expect(asked).toEqual([[A, B].sort()]);
    pending.next(found([A, B]));
    pending.complete();
    expect((await first).get(A)?.title).toBe('Wei Chen');
    expect((await second).get(B)?.title).toBe('John Smith');
    expect(asked).toHaveLength(1);
  });

  it('shows the ids of a failed request as unavailable, and asks for them again with the next set', async () => {
    answer = () => of(null);
    const failed = await records([A]);
    expect(failed.get(A)).toBeNull();
    answer = (ids) => of(found(ids));
    const again = await records([A, B]);
    expect(asked).toEqual([[A], [A, B].sort()]);
    expect(again.get(A)?.title).toBe('Wei Chen');
  });

  it('asks again for the ids of a failed request that nothing waited for any more', async () => {
    const pending = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
    answer = () => pending;
    // A page asks, then moves on to another set before the request answers.
    lookup.records([A]).subscribe().unsubscribe();
    pending.next(null);
    pending.complete();
    answer = (ids) => of(found(ids));
    const again = await records([A]);
    expect(asked).toEqual([[A], [A]]);
    expect(again.get(A)?.title).toBe('Wei Chen');
  });

  it('asks in requests of 100 ids at most', async () => {
    const many = Array.from(
      { length: 150 },
      (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    );
    await records(many);
    expect(asked.map((ids) => ids.length)).toEqual([100, 50]);
    expect(new Set(asked.flat()).size).toBe(150);
  });

  it('never hands the service a value that is not a document id', async () => {
    const read = await records([`${A}' OR '1'='1`, 'member-100051', B]);
    expect(asked).toEqual([[B]]);
    expect([...read.keys()]).toEqual([B]);
  });

  describe("with the schemas a document-link's show reads", () => {
    const read = (ids: readonly string[], schemas: readonly string[]) =>
      firstValueFrom(lookup.records(ids, schemas));

    it('asks once with them, and not again for a set it read with as many or more', async () => {
      await read([A, B], ['move', 'dublincore']);
      expect(withSchemas).toEqual([['dublincore', 'move']]);
      await read([A], ['move']);
      await records([B]);
      expect(asked).toHaveLength(1);
    });

    it('asks again for a record read without one, with every schema it was read with', async () => {
      await read([A, B], ['dublincore']);
      await read([B, C], ['move']);
      // B again, with both; C, never read, in the same request.
      expect(asked).toEqual([[A, B].sort(), [B, C].sort()]);
      expect(withSchemas).toEqual([['dublincore'], ['dublincore', 'move']]);
      await read([A, B, C], ['dublincore']);
      expect(asked).toHaveLength(2);
    });

    it('never asks with a schema for a set that names none', async () => {
      await records([A]);
      expect(withSchemas).toEqual([[]]);
    });
  });

  it('asks nothing for a set with no document id', async () => {
    expect(await records(['member-100051'])).toBe(NO_RECORDS);
    expect(asked).toEqual([]);
  });
});

describe('namesOf and recordIdsOf', () => {
  const lookups = (records: readonly string[], user: string): Lookups => ({
    vocabulary: [],
    principals: [{ kind: 'user', id: user }],
    records,
  });

  it('change only when their own half does, so labels and records are not read again for each other', () => {
    const source = signal(lookups([A], 'jdoe'));
    const names = namesOf(source);
    const ids = recordIdsOf(source);
    const first = { names: names(), ids: ids() };
    source.set(lookups([A, B], 'jdoe'));
    expect(names()).toBe(first.names);
    expect(ids()).toEqual([A, B]);
    const second = ids();
    source.set(lookups([A, B], 'asmith'));
    expect(ids()).toBe(second);
    expect(names()).not.toBe(first.names);
  });
});

describe('recordLookups', () => {
  const records = new Map<string, LinkedRecord | null>([
    [A, { title: 'Wei Chen', url: `/doc/${A}` }],
    [D, null],
  ]);
  const { record } = recordLookups(records, 'Unavailable');

  it("gives a read record's title and its route", () => {
    expect(record(A)).toEqual({ text: 'Wei Chen', url: `/doc/${A}` });
  });

  it('gives the unavailable text, with no route and never the id, for a record not returned', () => {
    expect(record(D)).toEqual({ text: 'Unavailable', url: null });
  });

  it('gives the unavailable text at once for a value that is not a document id', () => {
    expect(record(`${A}' OR '1'='1`)).toEqual({ text: 'Unavailable', url: null });
    expect(record('member-100051')).toEqual({ text: 'Unavailable', url: null });
  });

  it('gives nothing yet for a record still being read', () => {
    expect(record(B)).toBeNull();
  });

  it("gives a read record's property for a show, and nothing of a record not returned", () => {
    const { linkedValue } = recordLookups(
      new Map<string, LinkedRecord | null>([
        [
          A,
          { title: 'Wei Chen', url: `/doc/${A}`, properties: { 'move:deliveredOn': '2026-11-14' } },
        ],
        [B, { title: 'John Smith', url: `/doc/${B}` }],
        [D, null],
      ]),
      'Unavailable',
    );
    expect(linkedValue?.(A, 'move:deliveredOn')).toBe('2026-11-14');
    expect(linkedValue?.(A, 'move:number')).toBeUndefined();
    // An inherited key is no property of the record's.
    expect(linkedValue?.(A, 'toString')).toBeUndefined();
    expect(linkedValue?.(B, 'move:deliveredOn')).toBeUndefined();
    expect(linkedValue?.(D, 'move:deliveredOn')).toBeUndefined();
    expect(linkedValue?.(C, 'move:deliveredOn')).toBeUndefined();
  });
});
