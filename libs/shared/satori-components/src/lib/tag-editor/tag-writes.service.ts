import { HttpErrorResponse } from '@angular/common/http';
import {
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TagService } from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, concatMap, map, of, Subject, type Observable } from 'rxjs';

import { NxsToastService, provideNxsToast } from '../toast/toast.service';

export type NxsTagChange = 'add' | 'remove';

/** One change the user made to one document's tags. */
export interface NxsTagWrite {
  readonly uid: string;
  readonly change: NxsTagChange;
  readonly label: string;
}

/** What the server answered to one write: the document's tags afterwards, or why not. */
export type NxsTagAnswer = { readonly write: NxsTagWrite } & (
  | { readonly tags: string[] }
  | { readonly error: unknown }
);

/**
 * The tag editor's writes, held at the root so they outlive the editor that made them.
 *
 * A host shows the editor in a tab or a panel the user can close while a change is still on its
 * way. Destroying the editor used to cancel that request and drop every change queued behind it,
 * and the host never heard the answer to a request the server had already applied. Here a change,
 * once made, is sent and answered whatever happens to the view: one at a time, in order, so an
 * answer can never overwrite a later one. The toast is said here for the same reason.
 *
 * An answer no editor was open to hear is kept for its document, and the next editor for that
 * document takes it, so a reopened panel shows what Nuxeo stored rather than the tags the host
 * loaded before the change.
 *
 * Not exported: it is how the editor keeps its promise, not something a host calls.
 */
@Injectable({ providedIn: 'root' })
export class NxsTagWrites {
  private readonly tagService = inject(TagService);
  private readonly translate = inject(TranslateService);
  // `NxsToastService` is provided per component, so the root keeps an injector of its own for one.
  private readonly toastInjector = createEnvironmentInjector(
    [provideNxsToast()],
    inject(EnvironmentInjector),
  );
  private readonly toast = this.toastInjector.get(NxsToastService);

  private readonly queue = new Subject<NxsTagWrite>();
  private readonly answered = new Subject<NxsTagAnswer>();
  /** The tags each document had after its last answer, while it still has writes in the queue. */
  private readonly known = new Map<string, readonly string[]>();
  /** The tags an answer left on a document that no editor was open to hear. */
  private readonly unheard = new Map<string, readonly string[]>();

  /** The writes sent and not yet answered, in the order they were made. */
  readonly pending = signal<readonly NxsTagWrite[]>([]);
  /** Each answer, as it arrives. An editor that hears one for its document calls `take`. */
  readonly answers: Observable<NxsTagAnswer> = this.answered.asObservable();

  constructor() {
    // Not tied to any view: the root lives as long as the app, and so must a change the user made.
    this.queue.pipe(concatMap((write) => this.send(write))).subscribe((answer) => {
      this.settle(answer);
    });
    inject(DestroyRef).onDestroy(() => {
      this.queue.complete();
      this.toastInjector.destroy();
    });
  }

  /** Queues a change to `uid`'s tags, which the caller last saw as `tags`. */
  write(uid: string, change: NxsTagChange, label: string, tags: readonly string[]): void {
    // With nothing queued for the document, the caller's tags are the latest. Behind a queued
    // write, the answer to that write will be, so the caller's copy must not replace it.
    if (!this.pendingOn(uid)) this.known.set(uid, tags);
    const write: NxsTagWrite = { uid, change, label };
    this.pending.update((writes) => [...writes, write]);
    this.queue.next(write);
  }

  /** The tags an unheard answer left on `uid`, handed over once. */
  take(uid: string): readonly string[] | undefined {
    const tags = this.unheard.get(uid);
    this.unheard.delete(uid);
    return tags;
  }

  private pendingOn(uid: string): boolean {
    return this.pending().some((write) => write.uid === uid);
  }

  private send(write: NxsTagWrite): Observable<NxsTagAnswer> {
    const call =
      write.change === 'add'
        ? this.tagService.addTag(write.uid, write.label)
        : this.tagService.removeTag(write.uid, write.label);
    return call.pipe(
      map((tags) => ({ write, tags })),
      catchError((error: unknown) => of({ write, error })),
    );
  }

  private settle(answer: NxsTagAnswer): void {
    const { uid, change, label } = answer.write;
    const before = this.known.get(uid) ?? [];
    this.pending.update((writes) => writes.filter((write) => write !== answer.write));
    if ('error' in answer) {
      this.toast.error(this.failure(change, answer.error, label));
    } else {
      this.known.set(uid, answer.tags);
      this.unheard.set(uid, answer.tags);
      // The label Nuxeo stored, which is the one to announce: "Q3 Report" comes back as `q3report`.
      const stored =
        change === 'add'
          ? (answer.tags.find((tag) => !before.includes(tag)) ?? label.replace(/\s+/g, ''))
          : label;
      const done = change === 'add' ? 'added' : 'removed';
      this.toast.show(
        this.translate.instant(`satori-components.tag-editor.${done}`, { tag: stored }),
      );
    }
    if (!this.pendingOn(uid)) this.known.delete(uid);
    this.answered.next(answer);
  }

  private failure(change: NxsTagChange, error: unknown, tag: string): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const key =
      status === 401 || status === 403
        ? `satori-components.tag-editor.error.forbidden`
        : `satori-components.tag-editor.error.${change}`;
    return this.translate.instant(key, { tag });
  }
}
