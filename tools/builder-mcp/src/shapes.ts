/**
 * Reading Nuxeo's JSON defensively. A server answers what its version and its packages make it
 * answer, so nothing here assumes a key is there: a missing one is reported or left out, never
 * invented.
 */
import { NuxeoError } from './nuxeo.ts';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The record, or an error naming what was expected where. */
export function record(value: unknown, what: string): JsonRecord {
  if (!isRecord(value)) throw new NuxeoError(`${what} is not the JSON object Nuxeo sends`, null);
  return value;
}

/** The array, or an error naming what was expected where. */
export function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value))
    throw new NuxeoError(`${what} is not the JSON array Nuxeo sends`, null);
  return value;
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Nuxeo's entries for a list answer, such as `{ "entity-type": "workflows", "entries": [...] }`. */
export function entries(value: unknown, what: string): unknown[] {
  return list(record(value, what)['entries'], `${what}'s entries`);
}

/**
 * Up to ten names close to one that was not found: the same name in another case first, then
 * names that contain it or that it contains. So an agent that guessed `file` learns of `File`.
 */
export function closeTo(name: string, candidates: Iterable<string>): string[] {
  const wanted = name.toLowerCase();
  const same: string[] = [];
  const near: string[] = [];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower === wanted) same.push(candidate);
    else if (wanted !== '' && (lower.includes(wanted) || wanted.includes(lower)))
      near.push(candidate);
  }
  return [...same, ...near.sort()].slice(0, 10);
}

/** What to say when a name is not on the server. */
export function notFound(kind: string, name: string, candidates: Iterable<string>): NuxeoError {
  const close = closeTo(name, candidates);
  return new NuxeoError(
    `The server has no ${kind} "${name}".` +
      (close.length ? ` Close names: ${close.join(', ')}.` : ''),
    404,
  );
}
