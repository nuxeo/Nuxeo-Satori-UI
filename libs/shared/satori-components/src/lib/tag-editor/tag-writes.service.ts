import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  inject,
  Injectable,
  signal,
  type Provider,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CURRENT_USERNAME, TagService } from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, concatMap, defer, map, of, Subject, type Observable } from 'rxjs';

import { NxsToastService, provideNxsToast } from '../toast/toast.service';

export type NxsTagChange = 'add' | 'remove';

/** One change the user made to one document's tags. */
export interface NxsTagWrite {
  readonly uid: string;
  readonly change: NxsTagChange;
  readonly label: string;
  /** Who made it: `CURRENT_USERNAME` at the time. */
  readonly user: string | null;
}

/**
 * What the server answered to one write: the document's tags afterwards, or why not — or that it
 * was never sent, because its user had signed out before its turn came.
 */
export type NxsTagAnswer = { readonly write: NxsTagWrite } & (
  { readonly tags: string[] } | { readonly error: unknown } | { readonly dropped: true }
);

/** An answer no editor was open to hear, and what it may be applied over. */
interface NxsUnheard {
  readonly user: string | null;
  /** The tags the document had when the first unheard change was made. */
  readonly base: readonly string[];
  readonly tags: readonly string[];
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag) => b.includes(tag));

/**
 * The tag editor's writes, held by the injector that provides them so they outlive the editor that
 * made them.
 *
 * A host shows the editor in a tab or a panel the user can close while a change is still on its
 * way. Destroying the editor used to cancel that request and drop every change queued behind it,
 * and the host never heard the answer to a request the server had already applied. Here a change,
 * once made, is sent and answered whatever happens to the view: one at a time, in order, so an
 * answer can never overwrite a later one. The toast is said here for the same reason.
 *
 * An answer no editor was open to hear is kept for its document, and the next editor for that
 * document takes it, so a reopened panel shows what Nuxeo stored rather than the tags the host
 * loaded before the change — unless the host has loaded the document again since, when its copy
 * is newer and wins.
 *
 * Every change belongs to the user who made it, so the queue outliving a view never lets it outlive
 * a session: a change still waiting when its user signs out is dropped unsent, rather than sent
 * with whoever signs in next, and an answer that arrives after its user has gone says nothing and
 * is not kept. A host that provides no `CURRENT_USERNAME` gets no such separation.
 *
 * Not exported: a host installs it with `provideNxsTagWrites()`, and only the editor calls it.
 */
@Injectable()
export class NxsTagWrites {
  private readonly tagService = inject(TagService);
  private readonly translate = inject(TranslateService);
  private readonly user = inject(CURRENT_USERNAME);
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
  /** The answers left on a document that no editor was open to hear. */
  private readonly unheard = new Map<string, NxsUnheard>();
  /** Every write not yet answered, whoever made it. */
  private readonly queued = signal<readonly NxsTagWrite[]>([]);

  /** The current user's writes not yet answered, in the order they were made. */
  readonly pending = computed(() => this.queued().filter((write) => write.user === this.user()));
  /** Each answer, as it arrives. An editor that hears one for its document calls `take`. */
  readonly answers: Observable<NxsTagAnswer> = this.answered.asObservable();

  constructor() {
    // When the provider goes, no change is taken any more, but those already made are still sent
    // and answered: completing the queue lets `concatMap` finish them, where unsubscribing would
    // cancel the one in flight and drop the rest.
    this.queue.pipe(concatMap((write) => this.send(write))).subscribe({
      next: (answer) => this.settle(answer),
      complete: () => this.toastInjector.destroy(),
    });
    inject(DestroyRef).onDestroy(() => this.queue.complete());
  }

  /** Queues a change to `uid`'s tags, which the caller last saw as `tags`. */
  write(uid: string, change: NxsTagChange, label: string, tags: readonly string[]): void {
    // With nothing queued for the document, the caller's tags are the latest. Behind a queued
    // write, the answer to that write will be, so the caller's copy must not replace it.
    if (!this.pendingOn(uid)) this.known.set(uid, tags);
    const write: NxsTagWrite = { uid, change, label, user: this.user() };
    this.queued.update((writes) => [...writes, write]);
    this.queue.next(write);
  }

  /**
   * The tags an unheard answer left on `uid`, handed over once, to its own user, and only over the
   * tags the change was made over. Any other `current` tags mean the host has loaded the document
   * again since, so they are newer than the answer and it is dropped.
   */
  take(uid: string, current: readonly string[]): readonly string[] | undefined {
    const unheard = this.unheard.get(uid);
    this.unheard.delete(uid);
    if (!unheard || unheard.user !== this.user()) return undefined;
    return sameTags(current, unheard.base) ? unheard.tags : undefined;
  }

  /** An editor heard `uid`'s answer, so nothing is kept for the next one. */
  heard(uid: string): void {
    this.unheard.delete(uid);
  }

  private pendingOn(uid: string): boolean {
    return this.pending().some((write) => write.uid === uid);
  }

  private send(write: NxsTagWrite): Observable<NxsTagAnswer> {
    // Decided when its turn comes, not when it was queued: the request takes whoever is signed in
    // then, which must still be the user who made the change.
    return defer(() => {
      if (write.user !== this.user()) return of({ write, dropped: true as const });
      const call =
        write.change === 'add'
          ? this.tagService.addTag(write.uid, write.label)
          : this.tagService.removeTag(write.uid, write.label);
      return call.pipe(
        map((tags) => ({ write, tags })),
        catchError((error: unknown) => of({ write, error })),
      );
    });
  }

  private settle(answer: NxsTagAnswer): void {
    const { uid, change, label, user } = answer.write;
    const before = this.known.get(uid) ?? [];
    this.queued.update((writes) => writes.filter((write) => write !== answer.write));
    if ('dropped' in answer || user !== this.user()) {
      // Another user's change: never sent, or answered after its user left. Nobody here asked.
      if (!this.pendingOn(uid)) this.known.delete(uid);
      return;
    }
    if ('error' in answer) {
      this.toast.error(this.failure(change, answer.error, label));
    } else {
      this.known.set(uid, answer.tags);
      // A chain of unheard answers is applied over what the host had before the first of them.
      const earlier = this.unheard.get(uid);
      const base = earlier?.user === user ? earlier.base : before;
      this.unheard.set(uid, { user, base, tags: answer.tags });
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

/**
 * Keeps `nxs-tag-editor`'s changes for as long as the injector it is listed in, so one the user
 * made is never cancelled or dropped by the editor closing first — a tab or panel switched away, or
 * the host moving to another document. An answer that arrives with no editor open is shown by the
 * next editor for that document, which passes it on in `tagsChange` — unless the host has loaded
 * the document again since. A change never outlives its user's session: one still waiting at
 * sign-out is dropped, not sent as whoever signs in next. That needs the app's `CURRENT_USERNAME`.
 *
 * List it once, in the application's providers. A host and a remote share the instance the host
 * provides; a `providedIn` singleton would become one per side of a federation boundary.
 *
 * Without it, each editor keeps its own: its changes are still sent and answered after it closes,
 * with their toasts, but a reopened editor shows the tags its host passes in until the host
 * reloads the document.
 */
export function provideNxsTagWrites(): Provider {
  return NxsTagWrites;
}
