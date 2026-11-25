import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
  type ExtensionActionDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import {
  DocumentChangesService,
  NuxeoApiBase,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, TimeoutError, catchError, map, of, switchMap, timeout } from 'rxjs';

import { appActionForm } from './app-action-form';
import {
  AppActionDialogComponent,
  type AppActionDialogData,
  type AppActionOutcome,
} from './app-action-dialog';
import {
  readAppActions,
  type AppActionDefinition,
  type AppActionMessage,
  type AppActionsRegistered,
} from './app-actions-file';

/** The operation of `nuxeo-agentic-core` that runs one action of an app on one record. */
export const APP_ACTION_RUN_OPERATION = 'AgenticUi.RunAction';

/** As for the record's other reads: a run that has not answered by then is said to have failed. */
export const APP_ACTION_TIMEOUT_MS = 30_000;

/** The message the run gives the person, by the status the server answered with. */
const FAILURE_KEYS: Readonly<Record<number, string>> = {
  400: 'document-layouts.action.invalid',
  403: 'document-layouts.action.refused',
  404: 'document-layouts.action.unknown',
};

/**
 * A gateway's answers, which say nothing of whether the server ran it: it may still be running, so
 * they are taken as no answer, and the action is not offered again.
 */
const UNANSWERED: ReadonlySet<number> = new Set([502, 503, 504]);

function warn(message: string): void {
  console.warn(`[agentic-ui-actions] ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An app's operation buttons (docs/business-apps/app-definition-v2.md, section 5): each action of its
 * `actions.json` that runs an operation on one record, offered on the record page's toolbar and on
 * a queue's rows, and run through `AgenticUi.RunAction`.
 *
 * - **Registered once, at startup,** by the app, from the `actions.json` the app registry serves
 *   ({@link register}): an action on `record` in the `toolbar` slot, one on `row` in the
 *   `rowActions` slot, each with its `visibleWhen` as its rule and its `enabledWhen` as its enabled
 *   rule, and a handler under its own id. So a queue that lists it offers it on its rows, and the
 *   document page shows it on its toolbar, where its rules pass.
 * - **Run** in four steps: its rules are checked again with the record the person chose it on; a
 *   dialog asks the action's question, with its form when it has one, drawn by the version 2 form
 *   engine; on confirmation the record is read again from the server and both rules are checked a
 *   third time, on what the record is now; only then is the server asked to run it. The answer is
 *   said: the action's success message, or why it failed, in the dialog, which stays open.
 * - **The request names the app, the action and the record**, and what was entered in the form.
 *   Never the operation, nor its other parameters: the server reads those from the app's file as it
 *   serves it, checks its allow-list and the person's permissions again, and refuses anything else.
 * - **Afterwards,** unless the action says `"refresh": false`, every list reads its page again, and
 *   the document page the record again (`DocumentChangesService`).
 *
 * Hiding or disabling a button is not a security control. The server's allow-list, Nuxeo's
 * permissions and the lifecycle decide what runs.
 */
@Injectable({ providedIn: 'root' })
export class AppActionsService {
  private readonly extensions = inject(AppExtensionsService);
  private readonly slots = inject(ExtensionSlotRegistry);
  private readonly handlers = inject(ExtensionActionRegistry);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly api = inject(NuxeoApiBase);
  private readonly changes = inject(DocumentChangesService);
  /** As the platform's row actions do: the environment's, when a host provides one. */
  private readonly toast = inject(NxsToastService, { optional: true }) ?? new NxsToastService();

  /**
   * Registers the actions of `content`, the `actions.json` of the app `app`, and answers their ids.
   * Once per page: the slots are plain registries, read when a toolbar or a list is drawn. The
   * console says what is left out, and why.
   */
  register(app: string, content: unknown): readonly string[] {
    const registered: AppActionsRegistered = {
      rules: this.rules.registeredRuleIds(),
      rowActions: this.slots.registeredIds(EXTENSION_SLOTS.rowActions),
      bulkActions: this.slots.registeredIds(EXTENSION_SLOTS['bulk-actions']),
      actions: [
        ...this.slots.registeredIds(EXTENSION_SLOTS.toolbar),
        ...this.slots.registeredIds(EXTENSION_SLOTS.contextMenu),
      ],
    };
    const read = readAppActions(content, registered);
    if ('refused' in read) {
      for (const problem of read.refused) warn(`actions.json refused: ${problem}`);
      return [];
    }
    for (const problem of read.problems) warn(`actions.json ${problem}`);
    for (const action of read.actions) {
      const descriptor: ExtensionActionDescriptor = {
        id: action.id,
        // A literal wins, as in every file of version 2.
        ...(action.label
          ? { label: action.label }
          : { label: action.id, ...(action.labelKey ? { labelKey: action.labelKey } : {}) }),
        ...(action.icon ? { icon: action.icon } : {}),
        ...(action.order === null ? {} : { order: action.order }),
        ...(action.visibleWhen === null ? {} : { rule: action.visibleWhen }),
        ...(action.enabledWhen === null ? {} : { enabledRule: action.enabledWhen }),
      };
      if (action.placements.includes('record'))
        this.extensions.register(EXTENSION_SLOTS.toolbar, [descriptor]);
      if (action.placements.includes('row'))
        this.extensions.register(EXTENSION_SLOTS.rowActions, [descriptor]);
    }
    this.handlers.registerPackaged(
      Object.fromEntries(
        read.actions.map((action) => [
          action.id,
          { execute: (context: ExtensionRuleContext) => this.start(app, action, context) },
        ]),
      ),
    );
    return read.actions.map((action) => action.id);
  }

  /** Whether the action's own rules pass, as `actions.json` writes them, for this context. */
  private passes(action: AppActionDefinition, context: ExtensionRuleContext): boolean {
    return (
      this.extensions.evaluateRule(action.visibleWhen, context) &&
      this.extensions.evaluateRule(action.enabledWhen, context)
    );
  }

  /** Chosen on a record: its rules again, then the dialog. */
  private start(app: string, action: AppActionDefinition, context: ExtensionRuleContext): void {
    const document = context.document;
    if (!document?.uid) return;
    if (!this.passes(action, context)) {
      this.toast.error(this.translate.instant('document-layouts.action.not-available'));
      return;
    }
    let form: AppActionDialogData['form'] = null;
    if (action.form) {
      const read = appActionForm(action.form, document.type, this.rules.registeredRuleIds());
      if ('refused' in read) {
        warn(`actions.json "${action.id}": its form is not drawn: ${read.refused}; not run`);
        this.toast.error(this.translate.instant('document-layouts.action.failed'));
        return;
      }
      for (const problem of read.problems) warn(`actions.json "${action.id}" form: ${problem}`);
      form = read.form;
    }
    const title = this.text({ label: action.label, labelKey: action.labelKey }) ?? action.id;
    const question =
      this.text(action.confirm) ??
      this.translate.instant('document-layouts.action.confirm', {
        action: title,
        record: document.title,
      });
    const data: AppActionDialogData = {
      title,
      question,
      document,
      form,
      run: (values) => this.run(app, action, document.uid, context, values),
    };
    this.dialog
      .open<AppActionDialogComponent, AppActionDialogData, 'done'>(AppActionDialogComponent, {
        data,
        autoFocus: 'dialog',
      })
      .afterClosed()
      .subscribe((result) => {
        if (result !== 'done') return;
        this.toast.show(
          this.text(action.success) ??
            this.translate.instant('document-layouts.action.done', { action: title }),
        );
        if (action.refresh) this.changes.notify();
      });
  }

  /**
   * The record read again, its rules checked on what it is now, then the run. Never errors: each
   * way it can end is an outcome the dialog says.
   */
  private run(
    app: string,
    action: AppActionDefinition,
    uid: string,
    context: ExtensionRuleContext,
    values: Readonly<Record<string, unknown>>,
  ): Observable<AppActionOutcome> {
    return this.fresh(uid).pipe(
      switchMap((document): Observable<AppActionOutcome> => {
        if (!document) return of(this.failed('document-layouts.action.failed'));
        if (!this.passes(action, { ...context, document }))
          return of(this.failed('document-layouts.action.no-longer-available'));
        return this.api
          .post<unknown>(`/nuxeo/api/v1/automation/${APP_ACTION_RUN_OPERATION}`, {
            input: `doc:${uid}`,
            params: { app, action: action.id, values: JSON.stringify(values) },
            context: {},
          })
          .pipe(
            timeout(APP_ACTION_TIMEOUT_MS),
            map((body): AppActionOutcome => {
              if (isRecord(body) && body['status'] === 'done' && body['action'] === action.id)
                return { kind: 'done' };
              warn(`${APP_ACTION_RUN_OPERATION} gave an answer that is not one for "${action.id}"`);
              return this.failed('document-layouts.action.failed');
            }),
            catchError((error: unknown) => {
              const status = error instanceof HttpErrorResponse ? error.status : 0;
              // No answer, in time or at all: the server may have run it, so it is not offered again.
              if (error instanceof TimeoutError || status === 0 || UNANSWERED.has(status)) {
                warn(`"${action.id}": no answer from ${APP_ACTION_RUN_OPERATION}; it may have run`);
                return of({
                  kind: 'unknown',
                  message: this.translate.instant('document-layouts.action.may-have-run'),
                } satisfies AppActionOutcome);
              }
              warn(`"${action.id}" not run: HTTP ${status}`);
              return of(this.failed(FAILURE_KEYS[status] ?? 'document-layouts.action.failed'));
            }),
          );
      }),
    );
  }

  /** The record as the server has it now, with its permissions, or `null` when it cannot be read. */
  private fresh(uid: string): Observable<NuxeoDocument | null> {
    return this.api
      .get<NuxeoDocument>(`/nuxeo/api/v1/id/${encodeURIComponent(uid)}`, undefined, {
        properties: '*',
        'enrichers.document': 'permissions',
      })
      .pipe(
        timeout(APP_ACTION_TIMEOUT_MS),
        catchError((error: unknown) => {
          warn(`record ${uid} not read again before its action: ${String(error)}`);
          return of(null);
        }),
      );
  }

  private failed(key: string): AppActionOutcome {
    return { kind: 'failed', message: this.translate.instant(key) };
  }

  /** A message's literal, which wins, else its key's translation, else `null`. */
  private text(message: AppActionMessage | null): string | null {
    if (!message) return null;
    if (message.label) return message.label;
    if (!message.labelKey) return null;
    const translated: unknown = this.translate.instant(message.labelKey);
    return typeof translated === 'string' && translated !== message.labelKey ? translated : null;
  }
}
