import { Injectable, inject } from '@angular/core';
import {
  PACKAGED_REGISTRIES,
  readContentModel,
  withRegistered,
  type ContentModel,
  type Registries,
} from '@agentic-ui/shared/app-definition';
import {
  DocumentLayoutService,
  type RecordLayoutPreview,
  type RecordLayoutSource,
} from '@agentic-ui/shared/document-layouts';
import {
  EXTENSION_SLOTS,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
} from '@nuxeo/satori-platform/extensions';
import {
  ContentModelService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, catchError, map, of, startWith } from 'rxjs';

/** A read the designer waits on: still reading, read, or why it could not be. */
export type Reading<T> =
  | { readonly state: 'reading' }
  | { readonly state: 'read'; readonly value: T }
  | { readonly state: 'failed'; readonly problem: string };

/** A record the preview may be drawn for. */
export interface RecordChoice {
  readonly uid: string;
  readonly title: string;
  readonly path: string;
}

/** How many records of the type the designer offers to preview with. */
export const RECORDS_OFFERED = 20;

const READING = { state: 'reading' } as const;

function problemOf(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status !== 0) return `HTTP ${status}`;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

/** `reading` first, then what `source` gives, or why it failed. */
function reading<T>(source: Observable<T>): Observable<Reading<T>> {
  return source.pipe(
    map((value): Reading<T> => ({ state: 'read', value })),
    catchError((error: unknown) => of<Reading<T>>({ state: 'failed', problem: problemOf(error) })),
    startWith(READING),
  );
}

/**
 * What the layout designer reads. Every request is a read: nothing here writes to the server, and
 * the designer saves only to the browser's downloads.
 */
@Injectable({ providedIn: 'root' })
export class LayoutDesignerService {
  private readonly contentModel = inject(ContentModelService);
  private readonly detail = inject(DocumentDetailService);
  private readonly layouts = inject(DocumentLayoutService);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly slots = inject(ExtensionSlotRegistry);

  /** The types whose record page is served, which the designer may open. */
  types(): Observable<Reading<readonly string[]>> {
    return reading(this.layouts.recordLayoutTypes());
  }

  /** A type's `view` file, as it is served now. */
  source(type: string): Observable<Reading<RecordLayoutSource>> {
    return reading(this.layouts.recordLayoutSource(type));
  }

  /**
   * The {@link RECORDS_OFFERED} records of the type last changed, as the reader may read them, by
   * the record page engine's search (`DocumentLayoutService.previewRecords`).
   */
  records(type: string): Observable<Reading<readonly RecordChoice[]>> {
    return reading(
      this.layouts.previewRecords(type, RECORDS_OFFERED).pipe(
        map((records) =>
          records.map((record) => ({
            uid: record.uid,
            title:
              typeof record.title === 'string' && record.title !== '' ? record.title : record.uid,
            path: typeof record.path === 'string' ? record.path : '',
          })),
        ),
      ),
    );
  }

  /** One record, read as the document page reads it, which the preview draws. */
  record(uid: string): Observable<Reading<NuxeoDocument>> {
    return reading(this.detail.getFullDocument(uid));
  }

  /**
   * The server's content model, read by the app definition's model reader. A model it cannot read
   * whole is a failure, with its first problem: held to part of a model, a file would be refused
   * for what was left out.
   */
  model(): Observable<Reading<ContentModel>> {
    return this.contentModel.getContentModel().pipe(
      map((raw): Reading<ContentModel> => {
        const read = readContentModel(raw);
        if (read.model) return { state: 'read', value: read.model };
        const more = read.problems.length > 1 ? ` (and ${read.problems.length - 1} more)` : '';
        return { state: 'failed', problem: `${read.problems[0]}${more}` };
      }),
      catchError((error: unknown) =>
        of<Reading<ContentModel>>({ state: 'failed', problem: problemOf(error) }),
      ),
      startWith(READING),
    );
  }

  /**
   * What a file may name: the platform's registries, with the rules and row actions this build
   * registers, as the record page reads a file. A customer's own rule, registered in Layer 2 code,
   * is known; the pipeline knows it when `--registered` lists it.
   */
  registries(): Registries {
    return withRegistered(PACKAGED_REGISTRIES, {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
    });
  }

  /** The record page `content` draws for `document`, through the record page engine. */
  preview(content: unknown, document: NuxeoDocument): Observable<RecordLayoutPreview> {
    return this.layouts.previewRecordLayout(content, document);
  }
}
