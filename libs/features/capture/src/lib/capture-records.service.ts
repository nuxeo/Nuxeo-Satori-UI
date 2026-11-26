import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { DocumentLayoutService, type RecordCapture } from '@agentic-ui/shared/document-layouts';
import {
  NuxeoApiBase,
  canWriteDocument,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, map, of, switchMap } from 'rxjs';

import { captureLookup, type CaptureTarget } from './capture-code';

/** A record photos may be filed on, as the capture page shows it. */
export interface CaptureRecord {
  readonly uid: string;
  readonly title: string;
  readonly type: string;
  /** The first of its capture's `findBy` properties it has a value for: its number, to show. */
  readonly number: string | null;
  /** How photos are filed on it; `null` when its type takes none. */
  readonly capture: RecordCapture | null;
  /**
   * Whether the person signed in may add a file to it, as the Attachments panel asks: `Write` or
   * `WriteProperties` on it, from its `permissions` enricher, and not a version. Not the control:
   * the server checks again on every upload.
   */
  readonly writable: boolean;
}

/** One record a number names, among which the person chooses. */
export interface CaptureChoice {
  readonly uid: string;
  readonly title: string;
  readonly number: string | null;
}

/** How many records a number may name before the page asks for a longer one. */
export const CAPTURE_CHOICES_MAX = 20;

const SEARCH = '/nuxeo/api/v1/search/lang/NXQL/execute';

/**
 * Finds the record photos are filed on, and reads it, through the REST API as the person signed in:
 * only records they may read are found.
 */
@Injectable({ providedIn: 'root' })
export class CaptureRecordsService {
  private readonly api = inject(NuxeoApiBase);
  private readonly layouts = inject(DocumentLayoutService);

  /**
   * The record by its id, with its permissions, and how photos are filed on it. Errors with the
   * server's answer: 404 for a record that is not there or that the person may not read.
   */
  load(uid: string): Observable<CaptureRecord> {
    return this.api
      .get<NuxeoDocument>(`/nuxeo/api/v1/id/${encodeURIComponent(uid)}`, undefined, {
        properties: '*',
        'enrichers.document': 'permissions',
      })
      .pipe(
        switchMap((document) =>
          this.layouts.captureFor(document).pipe(
            map((capture): CaptureRecord => ({
              uid: document.uid,
              title: titleOf(document),
              type: document.type,
              number: capture ? numberOf(document, capture.findBy) : null,
              capture,
              writable: !document.isVersion && canWriteDocument(document),
            })),
          ),
        ),
      );
  }

  /**
   * The records a typed or scanned number names: those of every type photos are filed on whose
   * capture looks a number up (`findBy`), the most recently changed first, at most
   * {@link CAPTURE_CHOICES_MAX} and one more, so that the page can tell there are more. Empty when
   * no type looks a number up. Errors with the server's answer.
   */
  find(number: string): Observable<readonly CaptureChoice[]> {
    return this.layouts.captureTypes().pipe(
      switchMap((targets) => {
        const lookup = captureLookup(targets, number);
        if (!lookup) return of([]);
        let params = new HttpParams()
          .set('query', lookup.query)
          .set('pageSize', CAPTURE_CHOICES_MAX + 1)
          .set('currentPageIndex', 0);
        for (const value of lookup.params) params = params.append('queryParams', value);
        return this.api
          .get<{ readonly entries?: readonly NuxeoDocument[] }>(SEARCH, params, {
            properties: '*',
          })
          .pipe(map((list) => choicesOf(list.entries ?? [], targets)));
      }),
    );
  }

  /** Whether `capture`'s property of the record holds a file of this name and size. */
  holds(uid: string, property: string, name: string, size: number): Observable<boolean> {
    return this.api
      .get<NuxeoDocument>(`/nuxeo/api/v1/id/${encodeURIComponent(uid)}`, undefined, {
        properties: '*',
      })
      .pipe(
        map((document) => filesOf(document, property).some((file) => sameFile(file, name, size))),
      );
  }
}

function titleOf(document: NuxeoDocument): string {
  const title = document.title ?? document.properties?.['dc:title'];
  return typeof title === 'string' && title.trim() !== '' ? title : document.uid;
}

function numberOf(document: NuxeoDocument, findBy: readonly string[]): string | null {
  for (const name of findBy) {
    const value = document.properties?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function choicesOf(
  entries: readonly NuxeoDocument[],
  targets: readonly CaptureTarget[],
): CaptureChoice[] {
  return entries
    .filter((entry) => typeof entry?.uid === 'string' && entry.uid !== '')
    .map((entry) => ({
      uid: entry.uid,
      title: titleOf(entry),
      number: numberOf(
        entry,
        targets.find((target) => target.type === entry.type)?.capture.findBy ?? [],
      ),
    }));
}

/** The files a list property holds: each entry's `file` for a list of `{ file }`, else the entry. */
function filesOf(document: NuxeoDocument, property: string): Record<string, unknown>[] {
  const list = document.properties?.[property];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const file = (entry as Record<string, unknown>)['file'];
    const blob = typeof file === 'object' && file !== null ? file : entry;
    return [blob as Record<string, unknown>];
  });
}

function sameFile(file: Record<string, unknown>, name: string, size: number): boolean {
  return file['name'] === name && Number(file['length']) === size;
}
