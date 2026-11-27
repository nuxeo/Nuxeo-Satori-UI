/**
 * What each custom element shows on a set of records, and what it asks the server and fires: the
 * observed behaviour that check 9 holds each plugin to (docs/business-apps/studio-migration.md,
 * section 6), as check 6 holds a layout to what Web UI shows.
 *
 * Its format is provisional, `studio-migration-observed/1`, and it is data: records as Nuxeo's
 * REST API returns them, and for each element, record by record, the text it shows, as check 6
 * reads text, what it asks the server as it is drawn, what it fires, and each press of a button,
 * with the request it sends, the answer, and the events it fires then.
 *
 * For a real package it is recorded from Web UI on the migration server, which lab mode does not
 * do yet. The made-up corpus's (`testing/m3-corpus.ts`) was worked out by hand from each element's
 * code, so check 9's values half has been seen only against that.
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const OBSERVED_FORMAT = 'studio-migration-observed/1';

/** A request an element sends, as check 7 records one: the operation, its input, its parameters. */
export interface ObservedAsk {
  readonly operation: string;
  /** The document it runs on, `doc:<uid>` or the uid alone, which name the same document. */
  readonly input: string | null;
  readonly params: Readonly<Record<string, unknown>>;
}

/** An event an element fires, with its detail: `{}` for one fired with none, as Polymer fires it. */
export interface ObservedEvent {
  readonly event: string;
  readonly detail: unknown;
}

/** One press of a button the element shows, with what it then asks and fires. */
export interface ObservedClick {
  /** The button's text, as shown. */
  readonly button: string;
  /** What the server answers the request with: the body of a success. */
  readonly answer?: unknown;
  /** Or the HTTP status of a failure. */
  readonly failure?: number;
  /** The one request it sends, or `null` for none. */
  readonly asks: ObservedAsk | null;
  /** The events it fires, in order. */
  readonly fires: readonly ObservedEvent[];
}

export interface ObservedRecord {
  /** The record's `uid`, among the file's `records`. */
  readonly record: string;
  /** The values the page gives the element's other properties on this record, over the element's. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /**
   * Everything the element shows on it: each piece of text, its spacing collapsed, one space
   * between pieces, as check 6 reads labels. Empty for nothing.
   */
  readonly shows: string;
  /** What it asks the server as it is drawn, each with the answer; none when left out. */
  readonly loads?: readonly (ObservedAsk & {
    readonly answer?: unknown;
    readonly failure?: number;
  })[];
  /** What it fires as it is drawn; none when left out. */
  readonly fires?: readonly ObservedEvent[];
  /** Each button it shows is pressed here: one it shows and the file does not press fails. */
  readonly clicks?: readonly ObservedClick[];
}

export interface ObservedElement {
  /** The property the page gives the record to: `document` when left out. */
  readonly recordInput?: string;
  /** The values the page gives its other properties, by property name. */
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

/** What is wrong with a request's shape, or `null`. */
function askProblem(value: unknown): string | null {
  if (!isRecord(value) || typeof value['operation'] !== 'string')
    return 'a request names its operation';
  if (value['input'] !== null && typeof value['input'] !== 'string')
    return "a request's input is a document reference, or null";
  if (!isRecord(value['params'])) return "a request's parameters are an object";
  return null;
}

/** What is wrong with a list of events' shape, or `null`. */
function eventsProblem(value: unknown): string | null {
  return Array.isArray(value) &&
    value.every(
      (fired) => isRecord(fired) && typeof fired['event'] === 'string' && 'detail' in fired,
    )
    ? null
    : 'events are a list of an event and its detail each';
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
    if (element['recordInput'] !== undefined && typeof element['recordInput'] !== 'string')
      return `${name}: its recordInput names a property`;
    for (const seen of element['records'] as unknown[]) {
      if (
        !isRecord(seen) ||
        typeof seen['record'] !== 'string' ||
        typeof seen['shows'] !== 'string'
      )
        return `${name}: each record it shows names the record and what it shows`;
      const at = `${name}, on ${seen['record']}`;
      if (!uids.has(seen['record'])) return `${name}: ${seen['record']} is none of its records`;
      if (seen['inputs'] !== undefined && !isRecord(seen['inputs']))
        return `${at}: its inputs are an object, by property name`;
      if (seen['loads'] !== undefined) {
        if (!Array.isArray(seen['loads'])) return `${at}: what it loads is a list of requests`;
        for (const load of seen['loads']) {
          const problem = askProblem(load);
          if (problem) return `${at}: ${problem}`;
        }
      }
      if (seen['fires'] !== undefined && eventsProblem(seen['fires']))
        return `${at}: ${eventsProblem(seen['fires'])}`;
      if (seen['clicks'] === undefined) continue;
      if (!Array.isArray(seen['clicks'])) return `${at}: its clicks are not a list`;
      for (const click of seen['clicks'] as unknown[]) {
        if (!isRecord(click) || typeof click['button'] !== 'string')
          return `${at}: each click names the button pressed`;
        if (click['asks'] !== null && askProblem(click['asks']))
          return `${at}: ${askProblem(click['asks'])}`;
        if (eventsProblem(click['fires'])) return `${at}: ${eventsProblem(click['fires'])}`;
        if (click['failure'] !== undefined && typeof click['failure'] !== 'number')
          return `${at}: a failure is an HTTP status`;
      }
    }
  }
  return null;
}

/** Text as check 6 compares it: its spacing collapsed and trimmed. */
export function shown(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** An event's detail as Polymer gives one fired with none, `{}`, whatever stands for none. */
export function detailOf(detail: unknown): unknown {
  return detail === null || detail === undefined ? {} : detail;
}

/** A document reference as Nuxeo reads it: `doc:<uid>` and the uid alone are the same document. */
export function documentOf(input: unknown): unknown {
  return typeof input === 'string' ? input.replace(/^doc:/, '') : (input ?? null);
}

/** True when a request the plugin sent is the one the element sent. */
export function sameAsk(
  ask: { readonly operation: string | null; readonly input: unknown; readonly params: unknown },
  expected: ObservedAsk,
): boolean {
  return (
    ask.operation === expected.operation &&
    isDeepStrictEqual(documentOf(ask.input), documentOf(expected.input)) &&
    isDeepStrictEqual(ask.params ?? {}, expected.params)
  );
}
