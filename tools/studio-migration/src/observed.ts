/**
 * What each custom element shows on a set of records, and what clicking it asks the server: the
 * observed behaviour that check 9 holds each plugin to (docs/business-apps/studio-migration.md,
 * section 6), as check 6 holds a layout to what Web UI shows.
 *
 * Its format is provisional, `studio-migration-observed/1`, and it is data: records as Nuxeo's
 * REST API returns them, and for each element, record by record, the text it shows, normalised as
 * check 6 normalises text, and each click with the request it sends and the events it fires.
 *
 * For a real package it is recorded from Web UI on the migration server, which lab mode does not
 * do yet. The made-up corpus's (`testing/m3-corpus.ts`) was worked out by hand from each element's
 * code, so check 9's values half has been seen only against that.
 */
import { readFileSync } from 'node:fs';

export const OBSERVED_FORMAT = 'studio-migration-observed/1';

/** One click of a button the element shows, with what it then asks and fires. */
export interface ObservedClick {
  /** The button's text, as shown. */
  readonly button: string;
  /** What the server answers the request with: the body of a success. */
  readonly answer?: unknown;
  /** Or the HTTP status of a failure. */
  readonly failure?: number;
  /** The request it sends, as check 7 records one: the operation, its input and its parameters. */
  readonly asks: {
    readonly operation: string;
    readonly input: string | null;
    readonly params: Readonly<Record<string, unknown>>;
  } | null;
  /** The events it fires, in order, with their detail; `null` for none. */
  readonly fires: readonly { readonly event: string; readonly detail: unknown }[];
}

export interface ObservedRecord {
  /** The record's `uid`, among the file's `records`. */
  readonly record: string;
  /** Everything the element shows on it, as text, its spacing collapsed. Empty for nothing. */
  readonly shows: string;
  readonly clicks?: readonly ObservedClick[];
}

export interface ObservedElement {
  /** The values the page gives its other properties, beside the record, by property name. */
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly records: readonly ObservedRecord[];
}

export interface ObservedBehaviour {
  readonly format: typeof OBSERVED_FORMAT;
  /** The language the texts were read in. */
  readonly locale: string;
  readonly records: readonly Readonly<Record<string, unknown>>[];
  /** By element name. */
  readonly elements: Readonly<Record<string, ObservedElement>>;
}

export class ObservedError extends Error {
  override readonly name = 'ObservedError';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads and checks the shape of an observed-behaviour file, or says what is wrong with it. */
export function readObserved(path: string): ObservedBehaviour {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ObservedError(`${path} cannot be read as JSON: ${(error as Error).message}`);
  }
  const problem = observedProblem(parsed);
  if (problem !== null) throw new ObservedError(`${path}: ${problem}`);
  return parsed as ObservedBehaviour;
}

/** What is wrong with an observed-behaviour value's shape, or `null`. */
export function observedProblem(value: unknown): string | null {
  if (!isRecord(value) || value['format'] !== OBSERVED_FORMAT)
    return `it is not a ${OBSERVED_FORMAT} file`;
  if (typeof value['locale'] !== 'string') return 'it names no locale';
  const records = value['records'];
  if (!Array.isArray(records) || !records.every((record) => isRecord(record)))
    return 'its records are not a list of documents';
  const uids = new Set(records.map((record) => (record as Record<string, unknown>)['uid']));
  const elements = value['elements'];
  if (!isRecord(elements)) return 'its elements are not an object, by element name';
  for (const [name, element] of Object.entries(elements)) {
    if (!isRecord(element) || !isRecord(element['inputs']) || !Array.isArray(element['records']))
      return `${name}: an element holds its inputs and its records`;
    for (const seen of element['records'] as unknown[]) {
      if (
        !isRecord(seen) ||
        typeof seen['record'] !== 'string' ||
        typeof seen['shows'] !== 'string'
      )
        return `${name}: each record it shows names the record and what it shows`;
      if (!uids.has(seen['record'])) return `${name}: ${seen['record']} is none of its records`;
      if (seen['clicks'] !== undefined && !Array.isArray(seen['clicks']))
        return `${name}: ${seen['record']}'s clicks are not a list`;
    }
  }
  return null;
}

/** Text as check 6 compares it: its spacing collapsed and trimmed. */
export function shown(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
