import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import {
  PACKAGED_REGISTRIES,
  readContentModel,
  withRegistered,
  type ContentModel,
  type Registries,
} from '@agentic-ui/shared/app-definition';
import {
  DocumentLayoutService,
  type FormLayoutPreview,
  type LayoutSource,
  type RecordLayoutPreview,
  type ServedLayout,
} from '@agentic-ui/shared/document-layouts';
import { HomeService } from '@agentic-ui/shared/home';
import { QueueService, isQueueId, type QueueRegistered } from '@agentic-ui/shared/queues';
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

/** The modes of a layout file the designer edits: the record page, and the edit and create forms. */
export type DesignedMode = 'view' | 'edit' | 'create';

export const DESIGNED_MODES: readonly DesignedMode[] = ['view', 'edit', 'create'];

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What the layout designer reads. Every request is a read: nothing here writes to the server, and
 * the designer saves only to the browser's downloads.
 */
@Injectable({ providedIn: 'root' })
export class LayoutDesignerService {
  private readonly contentModel = inject(ContentModelService);
  private readonly detail = inject(DocumentDetailService);
  private readonly layouts = inject(DocumentLayoutService);
  private readonly home = inject(HomeService);
  private readonly queues = inject(QueueService);
  private readonly definitionFiles = inject(APP_DEFINITION_FILES);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly slots = inject(ExtensionSlotRegistry);

  /**
   * The layout files the server serves for a record page, an edit form or a create form, by type
   * and mode, which the designer may open.
   */
  files(): Observable<Reading<readonly ServedLayout[]>> {
    return reading(
      this.layouts
        .servedLayouts()
        .pipe(
          map((served) =>
            served.filter((each) => (DESIGNED_MODES as readonly string[]).includes(each.mode)),
          ),
        ),
    );
  }

  /** A type's file for `mode`, as it is served now. */
  source(type: string, mode: DesignedMode): Observable<Reading<LayoutSource>> {
    return reading(this.layouts.layoutSource(type, mode));
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

  /**
   * The form `content` draws for a record of `type`, through the form engine: for an edit, the
   * form of the edited `document`, held to its own schemas too, as the Edit form is.
   */
  previewForm(
    content: unknown,
    mode: 'edit' | 'create',
    type: string,
    document: NuxeoDocument | null,
  ): Observable<FormLayoutPreview> {
    return this.layouts.previewFormLayout(content, mode, type, document);
  }

  /**
   * The queues the app's menu opens, by id, each once: those `navigation.json` names, as it is
   * served now. A menu that is not served lists none; one that cannot be read says why.
   */
  queueIds(): Observable<Reading<readonly string[]>> {
    return this.home.loadNavigation().pipe(
      map((load): Reading<readonly string[]> => {
        if (load.kind === 'unreadable') return { state: 'failed', problem: load.reason };
        if (load.kind === 'none' || !isObject(load.content)) return { state: 'read', value: [] };
        const entries = load.content['entries'];
        const ids = (Array.isArray(entries) ? entries : []).flatMap((entry: unknown) =>
          isObject(entry) && typeof entry['queue'] === 'string' && isQueueId(entry['queue'])
            ? [entry['queue']]
            : [],
        );
        return { state: 'read', value: [...new Set(ids)] };
      }),
      startWith(READING),
    );
  }

  /** A queue's file, `queues/<id>.json`, as the queue page reads it now. */
  queueSource(id: string): Observable<Reading<unknown>> {
    return this.queues.load(id).pipe(
      map((load): Reading<unknown> => {
        if (load.kind === 'file') return { state: 'read', value: load.content };
        return {
          state: 'failed',
          problem: load.kind === 'none' ? 'no queue is served there' : load.reason,
        };
      }),
      startWith(READING),
    );
  }

  /**
   * The app's own actions, its `actions.json`, as the app registry serves it for the app open:
   * what the pipeline adds to the registries a package's queues are checked with
   * (`withPackageActions`). `null` when nothing serves it: the development server never does, and
   * a registry serves it only for an app the person may see. Never errors.
   */
  packageActions(): Observable<Reading<unknown>> {
    return this.definitionFiles.file('actions.json', null).pipe(
      map((content): Reading<unknown> => ({ state: 'read', value: content })),
      catchError((error: unknown) =>
        of<Reading<unknown>>(
          error instanceof HttpErrorResponse && error.status === 404
            ? { state: 'read', value: null }
            : { state: 'failed', problem: problemOf(error) },
        ),
      ),
      startWith(READING),
    );
  }

  /** What a queue may name: what this build registers, as the queue page reads a queue. */
  queueRegistered(): QueueRegistered {
    return {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
      bulkActions: this.slots.registeredIds(EXTENSION_SLOTS['bulk-actions']),
    };
  }
}
