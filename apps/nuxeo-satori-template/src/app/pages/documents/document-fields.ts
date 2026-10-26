import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

/**
 * Reading Nuxeo document properties, in one place.
 *
 * `NuxeoDocument.properties` is `Record<string, unknown>` on purpose — the shape
 * depends on which schemas the request asked for, so the platform refuses to
 * pretend it knows. Narrowing therefore belongs to the application, and doing it
 * here rather than in six templates is what stops `properties['dc:title']` being
 * rendered as `[object Object]` somewhere.
 */

export function stringProperty(doc: NuxeoDocument, name: string): string | null {
  const value = doc.properties?.[name];
  if (typeof value === 'string' && value.trim() !== '') return value;
  return null;
}

/** The main blob's descriptor, when the document holds one. */
export interface MainBlob {
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly length: number | null;
}

export function mainBlob(doc: NuxeoDocument): MainBlob | null {
  const content = doc.properties?.['file:content'];
  if (typeof content !== 'object' || content === null) return null;
  const record = content as Record<string, unknown>;
  const length = record['length'];
  return {
    name: typeof record['name'] === 'string' ? record['name'] : null,
    // Nuxeo spells it `mime-type` in the REST payload, not `mimeType`.
    mimeType: typeof record['mime-type'] === 'string' ? record['mime-type'] : null,
    // …and returns `length` as a string on some versions, a number on others.
    length:
      typeof length === 'number' ? length : typeof length === 'string' ? Number(length) : null,
  };
}

/** `1.4 kB`, or `—` when the document has no blob. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * A short local date-time.
 *
 * Hand-rolled rather than `DatePipe` because the template ships no locale data
 * beyond the default and a fork should not inherit an opinion about format from
 * us. `Intl` is in every browser this application supports.
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}
