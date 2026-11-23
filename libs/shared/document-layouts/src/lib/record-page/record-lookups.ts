import { type Observable, forkJoin, map, of, startWith } from 'rxjs';

import type { DocumentLayoutService } from '../document-layout.service';
import { type VocabularyValue, vocabularyValues } from '../document-layout/field-view';
import type { LayoutFieldType } from '../layout.model';
import type { RecordValueContext } from './record-field-view';
import { tableColumns } from './widget-support';

/**
 * The names a page reads for the values it shows: a vocabulary entry's label, and a user's or a
 * group's display name. The record page and a list of records read them the same way, and only
 * those their values name.
 */

export interface Principal {
  readonly kind: 'user' | 'group';
  readonly id: string;
}

export interface Lookups {
  readonly vocabulary: readonly VocabularyValue[];
  readonly principals: readonly Principal[];
}

/** The labels read, by lookup; one that could not be read is absent. */
export type Labels = ReadonlyMap<string, string>;

export const NO_LABELS: Labels = new Map();

/** A label read for a lookup's key, or `null` where it could not be read. */
type LabelPair = [string, string | null];

const vocabularyKey = (directory: string, id: string): string => `v\n${directory}\n${id}`;
const principalKey = (kind: Principal['kind'], id: string): string => `${kind}\n${id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether two sets of lookups read the same names: a signal's `equal`, so equal sets read nothing. */
export function sameLookups(a: Lookups, b: Lookups): boolean {
  const key = (lookups: Lookups) =>
    JSON.stringify([
      lookups.vocabulary.map((value) => [value.directory, value.id]),
      lookups.principals.map((principal) => [principal.kind, principal.id]),
    ]);
  return key(a) === key(b);
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

  /**
   * What one value shown through `widget` names: the users or groups of a `user` or `group`
   * widget, and of a table's `user` and `group` columns; the vocabulary entries of a property
   * with a directory, or of a `vocabulary` widget's own.
   */
  value(
    widget: string | null,
    parameters: Readonly<Record<string, unknown>>,
    definition: LayoutFieldType,
    value: unknown,
  ): void {
    if (widget === 'table') {
      const rows = (Array.isArray(value) ? value : []).filter(isRecord);
      for (const column of tableColumns(parameters['columns'])) {
        const kind = column.widget;
        if (kind !== 'user' && kind !== 'group') continue;
        for (const row of rows) this.principal(kind, row[column.subfield]);
      }
    }
    if (widget === 'user' || widget === 'group') {
      this.principal(widget, value);
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
    };
  }

  private principal(kind: Principal['kind'], value: unknown): void {
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id === 'string' && id !== '') this.principals.push({ kind, id });
    }
  }
}

/**
 * The labels `lookups` name, read through the layout service: none at first, then all of them at
 * once. Never errors, since neither read does; a label that cannot be read is left absent, and
 * the value shows its stored id.
 */
export function readLabels(layouts: DocumentLayoutService, lookups: Lookups): Observable<Labels> {
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
