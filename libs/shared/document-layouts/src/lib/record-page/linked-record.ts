import { documentNavigationUrl } from '@nuxeo/satori-platform/nuxeo-client';

import type { LayoutFieldType } from '../layout.model';

/**
 * What a `document-link` reads of the record it names (layout-v2.md, section 11): the record's
 * title, and the app's own route to it, and, for one with `show`, the properties of the schemas the
 * page asked for (section 12). Read by id, in one search for every id a page or a list names, so
 * that a list of fifty claims asks once for their members, not fifty times.
 */

/** A linked record as a `document-link` shows it. */
export interface LinkedRecord {
  /** Its title, as Nuxeo returns it: `dc:title`, or its name when that is empty. */
  readonly title: string;
  /**
   * The app's route to it, as a row of a list opens it (`documentNavigationUrl`): `/doc/<uid>` for
   * a record, browse for a folder, the collection page for a collection.
   */
  readonly url: string;
  /**
   * The properties the search returned for it, by `<prefix>:<name>`: those of the schemas it was
   * asked with, for a `document-link`'s `show`, and none when it was asked with none. Only what the
   * search returned to the reader, for this record's own id. A search always gives it; absent, none.
   */
  readonly properties?: Readonly<Record<string, unknown>>;
  /**
   * For a version, its label as Nuxeo writes it, `1.0`: a `document-link` to a version shows it
   * beside the title, so that two versions of one record read apart. Absent for a live record, a
   * proxy, and a version the server returned no label for.
   */
  readonly versionLabel?: string;
}

/**
 * What a `document-link`'s `show` reads of the records it links to (layout-v2.md, section 12): the
 * schema that holds the property, which the linked records are asked for with, and what the
 * property is in it, which the value is shown by.
 */
export interface LinkedProperty {
  /** The schema's name, as Nuxeo's `properties` header names one: `dublincore`, never `dc`. */
  readonly schema: string;
  readonly definition: LayoutFieldType;
}

/** A schema's name as the `properties` header may carry one: nothing else is ever sent in it. */
export const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * A document's id as Nuxeo writes `ecm:uuid`: a UUID, in lower case. Only such a value is ever
 * sent to the server to be looked up. Anything else a `document-link` holds, such as a path, an id
 * prefixed with its repository's name, or a text that would change a query, is shown as
 * unavailable and never asked for.
 */
const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `value` is a document's id, which a `document-link` may be looked up by. */
export function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_ID.test(value);
}

/** How many ids one search asks for. A page of a list names fewer, at 100 rows or less. */
export const LINKED_RECORDS_PER_REQUEST = 100;

/**
 * The search for `count` records by id. Its text never holds an id: each `?` is given one as a
 * `queryParams` value of its own, which Nuxeo quotes as a literal before the query runs, so no
 * value can change what the query means. The ids are checked by {@link isDocumentId} as well.
 *
 * Every record the reader may read, wherever it is, in the trash too, as Nuxeo's own document
 * resolver reads a reference: the query leaves out no trashed record, version or proxy. A record
 * the reader may not read is not returned, and nor is one that no longer exists.
 */
export function linkedRecordsQuery(count: number): string {
  return `SELECT * FROM Document WHERE ecm:uuid IN (${Array.from({ length: count }, () => '?').join(', ')})`;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A record's name, the last part of its path: what Nuxeo calls a record whose title is empty. */
function nameOf(path: unknown): string {
  if (typeof path !== 'string') return '';
  return (
    path
      .split('/')
      .filter((part) => part.trim() !== '')
      .pop() ?? ''
  );
}

/**
 * The records a search returned, by id: only those it was asked for, each with a title. An entry
 * that is not one of `asked`, or names no title or path, is left out, and its id shows as
 * unavailable. Its route is built from what the search returned for it, not from the value.
 */
export function readLinkedRecords(
  raw: unknown,
  asked: readonly string[],
): ReadonlyMap<string, LinkedRecord> {
  const wanted = new Set(asked);
  const entries = isRecord(raw) && Array.isArray(raw['entries']) ? raw['entries'] : [];
  const found = new Map<string, LinkedRecord>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { uid, type, path, facets, properties, isVersion, versionLabel } = entry;
    if (!isDocumentId(uid) || !wanted.has(uid) || typeof type !== 'string') continue;
    const title =
      typeof entry['title'] === 'string' && entry['title'].trim() !== ''
        ? entry['title']
        : nameOf(path);
    if (title === '') continue;
    found.set(uid, {
      title,
      url: documentNavigationUrl({
        uid,
        type,
        path: typeof path === 'string' ? path : '',
        facets: Array.isArray(facets)
          ? facets.filter((facet): facet is string => typeof facet === 'string')
          : [],
      }),
      properties: isRecord(properties) ? properties : {},
      ...(isVersion === true && typeof versionLabel === 'string' && versionLabel.trim() !== ''
        ? { versionLabel: versionLabel.trim() }
        : {}),
    });
  }
  return found;
}
