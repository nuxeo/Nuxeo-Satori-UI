import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  createEnvironmentInjector,
  DestroyRef,
  effect,
  EnvironmentInjector,
  inject,
  Injectable,
  signal,
  untracked,
  type Provider,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CURRENT_USERNAME, TagService } from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, concatMap, defer, map, of, Subject, takeUntil, type Observable } from 'rxjs';

import { NxsToastService, provideNxsToast } from '../toast/toast.service';

export type NxsTagChange = 'add' | 'remove';

/** One change the user made to one document's tags. */
export interface NxsTagWrite {
  readonly uid: string;
  readonly change: NxsTagChange;
  readonly label: string;
  /** Who made it: `CURRENT_USERNAME` at the time. */
  readonly user: string | null;
  /** The session it was made in: bumped whenever the user changes, so no write outlives it. */
  readonly session: number;
}

/**
 * What the server answered to one write: the document's tags afterwards, or why not — or that it
 * was never sent, because its user had signed out before its turn came.
 */
export type NxsTagAnswer = { readonly write: NxsTagWrite } & (
  { readonly tags: string[] } | { readonly error: unknown } | { readonly dropped: true }
);

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
 * An answer no editor was open to hear leaves its document marked, and the next editor for that
 * document asks Nuxeo for the document's tags rather than trusting the copy its host holds: a copy
 * loaded before the change, or after another client changed the tags again, is never replayed.
 *
 * Every change belongs to the user who made it, and to the session that user was in. The app's
 * user is a plain function over its own signal, so a change of user is seen at the next effect
 * flush: each such change starts a new session, and a change still waiting then is dropped unsent,
 * rather than sent with whoever signs in next. Two changes that coalesce within one flush are not
 * seen, which a person signing out and back in cannot do. An answer that arrives after its session
 * has ended says nothing and is not kept. A host that provides no `CURRENT_USERNAME` gets no such
 * separation.
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
  /** The documents with an answer no editor was open to hear. */
  private readonly unheard = new Set<string>();
  /** Every write not yet answered, whoever made it. */
  private readonly queued = signal<readonly NxsTagWrite[]>([]);
  private readonly sessionEnded = new Subject<void>();
  /** Bumped at each change of user, which ends the session the writes were made in. */
  private readonly session = signal(0);

  /** The current user's writes not yet answered, in the order they were made. */
  readonly pending = computed(() =>
    this.queued().filter((write) => write.session === this.session() && write.user === this.user()),
  );
  /** Each answer, as it arrives. An editor that hears one for its document calls `heard`. */
  readonly answers: Observable<NxsTagAnswer> = this.answered.asObservable();
  /** Fires when the session a read or a write was made in has ended, so it must not finish. */
  readonly sessionsEnded: Observable<void> = this.sessionEnded.asObservable();

  constructor() {
    // The user is read through a plain function, so the only sign of a sign-out is the app's signal
    // changing under this effect. Each change ends the session, and with it every answer kept for
    // the session before, and every request still on its way: nothing from one session may be sent,
    // shown, kept or answered under the next. It runs in the toast injector, not the editor's, so an
    // editor closing without the provider does not end it.
    effect(
      () => {
        this.user();
        untracked(() => {
          this.session.update((session) => session + 1);
          this.unheard.clear();
          this.known.clear();
          this.queued.update((writes) =>
            writes.filter((write) => write.session === this.session()),
          );
          this.sessionEnded.next();
        });
      },
      { injector: this.toastInjector },
    );
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
    const write: NxsTagWrite = {
      uid,
      change,
      label,
      user: this.user(),
      session: this.session(),
    };
    this.queued.update((writes) => [...writes, write]);
    this.queue.next(write);
  }

  /**
   * Whether `uid` has an answer that no editor heard, and clears the mark. The next editor for the
   * document must then read its tags from Nuxeo, since neither its host's copy nor the answer is
   * known to be current.
   */
  takeUnheard(uid: string): boolean {
    return this.unheard.delete(uid);
  }

  /** A read that was to replace `uid`'s copy did not finish, so the next editor must read again. */
  keepUnheard(uid: string): void {
    this.unheard.add(uid);
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
    // then, which must still be the user, in the session, who made the change.
    return defer(() => {
      if (write.session !== this.session() || write.user !== this.user()) {
        return of({ write, dropped: true as const });
      }
      const call =
        write.change === 'add'
          ? this.tagService.addTag(write.uid, write.label)
          : this.tagService.removeTag(write.uid, write.label);
      // Cancelled when its session ends, so the request never reaches a session it was not made in.
      // Completing without an answer lets the queue move on, and the write is no longer pending.
      return call.pipe(
        map((tags) => ({ write, tags })),
        catchError((error: unknown) => of({ write, error })),
        takeUntil(this.sessionEnded),
      );
    });
  }

  private settle(answer: NxsTagAnswer): void {
    const { uid, change, label } = answer.write;
    const before = this.known.get(uid) ?? [];
    this.queued.update((writes) => writes.filter((write) => write !== answer.write));
    if ('dropped' in answer || !this.inSession(answer.write)) {
      // Another session's change: never sent, or answered after its session ended. Nobody here asked.
      if (!this.pendingOn(uid)) this.known.delete(uid);
      return;
    }
    if ('error' in answer) {
      this.toast.error(this.failure(change, answer.error, label));
    } else {
      this.known.set(uid, answer.tags);
      this.unheard.add(uid);
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

  private inSession(write: NxsTagWrite): boolean {
    return write.session === this.session() && write.user === this.user();
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
 * next editor for that document, which reads the document's tags from Nuxeo and passes them on in
 * `tagsChange`. A change never outlives its user's session: one still waiting at sign-out is
 * dropped, not sent as whoever signs in next. That needs the app's `CURRENT_USERNAME`.
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
