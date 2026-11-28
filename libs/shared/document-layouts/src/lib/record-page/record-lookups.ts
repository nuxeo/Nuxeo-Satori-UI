import { Injectable, type Signal, computed, inject } from '@angular/core';
import {
  type Observable,
  catchError,
  forkJoin,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { type VocabularyValue, vocabularyValues } from '../document-layout/field-view';
import type { LayoutFieldType } from '../layout.model';
import { LINKED_RECORDS_PER_REQUEST, type LinkedRecord, isDocumentId } from './linked-record';
import type { RecordLink, RecordValueContext } from './record-field-view';

/**
 * What a page reads for the values it shows: a vocabulary entry's label, a user's or a group's
 * display name, and the record a `document-link` names. The record page and a list of records
 * read them the same way, and only those their values name.
 */

export interface Principal {
  readonly kind: 'user' | 'group';
  readonly id: string;
}

export interface Lookups {
  readonly vocabulary: readonly VocabularyValue[];
  readonly principals: readonly Principal[];
  /** The ids `document-link` values hold, each once, sorted: only those {@link isDocumentId} accepts. */
  readonly records: readonly string[];
  /**
   * The schemas the linked records are read with, each once, sorted: those holding what a
   * `document-link`'s `show` reads (layout-v2.md, section 12). Empty where nothing on the page
   * shows one.
   */
  readonly schemas: readonly string[];
}

/** The labels read, by lookup; one that could not be read is absent. */
export type Labels = ReadonlyMap<string, string>;

export const NO_LABELS: Labels = new Map();

/** A label read for a lookup's key, or `null` where it could not be read. */
type LabelPair = [string, string | null];

const vocabularyKey = (directory: string, id: string): string => `v\n${directory}\n${id}`;
const principalKey = (kind: Principal['kind'], id: string): string => `${kind}\n${id}`;

/** Whether two sets of lookups read the same names: a signal's `equal`, so equal sets read nothing. */
export function sameLookups(a: Lookups, b: Lookups): boolean {
  return sameNames(a, b) && sameIds(a.records, b.records) && sameIds(a.schemas, b.schemas);
}

/** What a page reads labels for: the vocabulary entries and the users and groups its values name. */
export type NameLookups = Pick<Lookups, 'vocabulary' | 'principals'>;

/** Whether two sets of lookups read the same labels, whatever records they name. */
function sameNames(a: NameLookups, b: NameLookups): boolean {
  const key = (lookups: NameLookups) =>
    JSON.stringify([
      lookups.vocabulary.map((value) => [value.directory, value.id]),
      lookups.principals.map((principal) => [principal.kind, principal.id]),
    ]);
  return key(a) === key(b);
}

/** Whether two sorted lists of ids are the same: a signal's `equal`, so an equal set asks nothing. */
export const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The labels part of `lookups`, which changes only when the labels it names do: a page whose linked
 * records change reads no label again, and shows none as its stored id meanwhile.
 */
export function namesOf(lookups: Signal<Lookups>): Signal<NameLookups> {
  return computed(
    (): NameLookups => {
      const { vocabulary, principals } = lookups();
      return { vocabulary, principals };
    },
    { equal: sameNames },
  );
}

/**
 * The linked records `lookups` names, which changes only when the set of ids does: a page whose
 * labels change asks for no record again, and nor does an equal set, even after a failure.
 */
export function recordIdsOf(lookups: Signal<Lookups>): Signal<readonly string[]> {
  return computed(() => lookups().records, { equal: sameIds });
}

/** The linked records a page reads, and the schemas it reads them with. */
export interface RecordRead {
  readonly ids: readonly string[];
  readonly schemas: readonly string[];
}

/**
 * The linked records `lookups` names and the schemas they are read with, which changes only when
 * either does: as {@link recordIdsOf}, for a page whose `document-link`s may have a `show`.
 */
export function recordReadOf(lookups: Signal<Lookups>): Signal<RecordRead> {
  return computed(
    (): RecordRead => {
      const { records, schemas } = lookups();
      return { ids: records, schemas };
    },
    { equal: (a, b) => sameIds(a.ids, b.ids) && sameIds(a.schemas, b.schemas) },
  );
}

function sortedUnique<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
}

/** Collects lookups, each once, in an order that does not depend on the order they were added in. */
export class LookupCollector {
  private readonly vocabulary: VocabularyValue[] = [];
  private readonly principals: Principal[] = [];
  private readonly records: string[] = [];
  private readonly schemas: string[] = [];

  /**
   * A schema the linked records are to be read with, for a `document-link`'s `show`: the page asks
   * for every record once, with every schema something on it shows (layout-v2.md, section 12).
   */
  schema(name: string): void {
    this.schemas.push(name);
  }

  /**
   * What one value shown through `widget` names: the users or groups of a `user` or `group`
   * widget; the records of a `document-link`, by id; the vocabulary entries of a property with a
   * directory, or of a `vocabulary` widget's own. A table's cells are each a value of their own,
   * given with their column's widget.
   */
  value(
    widget: string | null,
    parameters: Readonly<Record<string, unknown>>,
    definition: LayoutFieldType,
    value: unknown,
  ): void {
    if (widget === 'user' || widget === 'group') {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (typeof id === 'string' && id !== '') this.principals.push({ kind: widget, id });
      }
      return;
    }
    if (widget === 'document-link') {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (isDocumentId(id)) this.records.push(id);
      }
      return;
    }
    const directory =
      widget === 'vocabulary' && typeof parameters['directory'] === 'string'
        ? parameters['directory']
        : definition.directory;
    this.vocabulary.push(
      ...vocabularyValues([
        { definition: directory ? { ...definition, directory } : definition, value },
      ]),
    );
  }

  lookups(): Lookups {
    return {
      vocabulary: sortedUnique(this.vocabulary, (value) =>
        vocabularyKey(value.directory, value.id),
      ),
      principals: sortedUnique(this.principals, (principal) =>
        principalKey(principal.kind, principal.id),
      ),
      records: sortedUnique(this.records, (id) => id),
      schemas: sortedUnique(this.schemas, (name) => name),
    };
  }
}

/**
 * The labels `lookups` name, read through the layout service: none at first, then all of them at
 * once. Never errors, since neither read does; a label that cannot be read is left absent, and
 * the value shows its stored id.
 */
export function readLabels(
  layouts: DocumentLayoutService,
  lookups: NameLookups,
): Observable<Labels> {
  const { vocabulary, principals } = lookups;
  if (vocabulary.length + principals.length === 0) return of(NO_LABELS);
  return forkJoin([
    ...vocabulary.map(({ directory, id }) =>
      layouts
        .vocabularyLabel(directory, id)
        .pipe(map((label): LabelPair => [vocabularyKey(directory, id), label])),
    ),
    ...principals.map(({ kind, id }) =>
      layouts
        .principalLabel(kind, id)
        .pipe(map((label): LabelPair => [principalKey(kind, id), label])),
    ),
  ]).pipe(
    map(
      (pairs): Labels =>
        new Map(pairs.filter((pair): pair is [string, string] => pair[1] !== null)),
    ),
    startWith(NO_LABELS),
  );
}

/** The lookups a widget's context answers from `labels`: the label, or the stored id until it is read. */
export function labelLookups(labels: Labels): Pick<RecordValueContext, 'vocabulary' | 'principal'> {
  return {
    vocabulary: (directory, id) => labels.get(vocabularyKey(directory, id)) ?? id,
    principal: (kind, id) => labels.get(principalKey(kind, id)) ?? id,
  };
}

/**
 * The records read so far, by id: `null` for one the reader may not read, that does not exist, or
 * whose read failed. An id not here is still being read.
 */
export type LinkedRecords = ReadonlyMap<string, LinkedRecord | null>;

export const NO_RECORDS: LinkedRecords = new Map();

/** One record read, or being read, by a page: the schemas it was asked with, and its answer. */
interface ReadRecord {
  readonly schemas: ReadonlySet<string>;
  readonly record: Observable<LinkedRecord | null>;
}

/**
 * The records the `document-link` values of one page name, read for as long as the page is drawn:
 * each id once, in one request for every id a set adds, never one per field or cell. A set whose
 * ids are all read asks for nothing. A failed request is not kept, and its ids are asked for again
 * by the next set that names them; until then they show as unavailable.
 *
 * **With the schemas a `show` reads** (layout-v2.md, section 12): an id read with every schema a
 * set asks for is not asked for again; one read without one of them is asked for again, with those
 * it was read with and those asked for now, so that it loses none. The record page asks with every
 * schema it and its lists need, so a list asks again only for a record the page does not name.
 *
 * Provided by the record page, whose lists share it, so a record a field and a list both name is
 * read once; by a form; by the Properties panel, for the references its schemas name, so a
 * document page showing both the panel and a record page asks once for each; and by a queue's
 * page, whose facets and list share it. A list drawn elsewhere has one of its own
 * ({@link linkedRecordLookup}). Per page, not per session as a label is: a record's title changes
 * more often than a user's name, and a record the reader may not read today may be shared with
 * them tomorrow.
 */
@Injectable()
export class LinkedRecordLookup {
  private readonly layouts = inject(DocumentLayoutService);
  private readonly read = new Map<string, ReadRecord>();

  /**
   * The records `ids` name, once all of them are read, each with at least the properties of
   * `schemas`. Never errors.
   */
  records(ids: readonly string[], schemas: readonly string[] = []): Observable<LinkedRecords> {
    const wanted = [...new Set(ids.filter(isDocumentId))].sort();
    if (wanted.length === 0) return of(NO_RECORDS);
    const needed = [...new Set(schemas)];
    const unread = wanted.filter((id) => {
      const read = this.read.get(id);
      return read === undefined || needed.some((schema) => !read.schemas.has(schema));
    });
    if (unread.length > 0) {
      const asked = [
        ...new Set([...needed, ...unread.flatMap((id) => [...(this.read.get(id)?.schemas ?? [])])]),
      ].sort();
      for (let start = 0; start < unread.length; start += LINKED_RECORDS_PER_REQUEST) {
        this.ask(unread.slice(start, start + LINKED_RECORDS_PER_REQUEST), asked);
      }
    }
    return forkJoin(
      wanted.map((id) =>
        (this.read.get(id)?.record ?? of(null)).pipe(
          map((record): [string, LinkedRecord | null] => [id, record]),
        ),
      ),
    ).pipe(map((pairs): LinkedRecords => new Map(pairs)));
  }

  /**
   * One request for `ids`, with `schemas`, shared by each of them. An id read before, without some
   * of `schemas`, keeps that read if this one fails: it answers it again, and is asked for anew by
   * the next set that names it, rather than showing as unavailable meanwhile.
   */
  private ask(ids: readonly string[], schemas: readonly string[]): void {
    const ones = new Map<string, ReadRecord>();
    const earlier = new Map(
      ids.flatMap((id): [string, ReadRecord][] => {
        const read = this.read.get(id);
        return read ? [[id, read]] : [];
      }),
    );
    const request = this.layouts.linkedRecords(ids, schemas).pipe(
      catchError(() => of(null)),
      // Once, as the request answers, whether or not anything still waits for it: a request kept
      // running after the page moved on to another set must not leave its failure cached.
      tap((found) => {
        if (found !== null) return;
        for (const [id, one] of ones) {
          if (this.read.get(id) !== one) continue;
          const before = earlier.get(id);
          if (before) this.read.set(id, before);
          else this.read.delete(id);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    const read = new Set(schemas);
    for (const id of ids) {
      const before = earlier.get(id);
      const one: ReadRecord = {
        schemas: read,
        record: request.pipe(
          switchMap((found) =>
            found === null && before ? before.record : of(found?.get(id) ?? null),
          ),
        ),
      };
      ones.set(id, one);
      this.read.set(id, one);
    }
  }
}

/**
 * The lookup a list reads its records through: the record page's, when the list is one of its
 * cards, so the page and its lists ask for a record once; else one of the list's own, for as long
 * as the list is drawn. Called where `inject` may be.
 */
export function linkedRecordLookup(): LinkedRecordLookup {
  return inject(LinkedRecordLookup, { optional: true }) ?? new LinkedRecordLookup();
}

/**
 * The `document-link` lookup a widget's context answers from `records`, and the Properties panel's
 * for a reference (`ValueContext.record`, in `field-view.ts`): the record's title and
 * its route, `unavailable` without a route where it cannot be shown, or `null` while it is read.
 * A value that is not a document's id is unavailable at once, and was never asked for.
 */
export function recordLookups(
  records: LinkedRecords,
  unavailable: string,
  version: (title: string, label: string) => string = (title, label) => `${title} ${label}`,
): Pick<RecordValueContext, 'record' | 'linkedValue'> {
  return {
    linkedValue: (id, xpath) => {
      const properties = records.get(id)?.properties;
      return properties && Object.hasOwn(properties, xpath) ? properties[xpath] : undefined;
    },
    record: (id): RecordLink | null => {
      if (!isDocumentId(id)) return { text: unavailable, url: null };
      const record = records.get(id);
      if (record === undefined) return null;
      return record === null
        ? { text: unavailable, url: null }
        : {
            text:
              record.versionLabel === undefined
                ? record.title
                : version(record.title, record.versionLabel),
            url: record.url,
          };
    },
  };
}
