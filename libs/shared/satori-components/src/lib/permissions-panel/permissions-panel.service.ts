import { Injectable, inject } from '@angular/core';
import { Observable, catchError, concatMap, from, map, of, switchMap, toArray } from 'rxjs';

import {
  DocumentDetailService,
  type NuxeoDocument,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  dateToWrite,
  readSnapshot,
  refusalsFor,
  unconfirmedChanges,
  type NxsPermissionChange,
  type NxsPermissionRefusal,
  type NxsPermissionsSnapshot,
} from './permissions-model';

/** How a save ended. Every outcome that could read it carries the server's ACL afterwards. */
export type NxsSaveOutcome =
  /** Nothing was written, because the read before the first write failed. */
  | { readonly kind: 'unread'; readonly error: unknown }
  /** Every change was written and the re-read shows each one. */
  | { readonly kind: 'saved'; readonly count: number; readonly snapshot: NxsPermissionsSnapshot }
  /** Nothing was written, because these changes cannot be written faithfully. */
  | {
      readonly kind: 'refused';
      readonly refusals: readonly NxsPermissionRefusal[];
      readonly snapshot: NxsPermissionsSnapshot;
    }
  /**
   * The server rejected a change. `applied` counts the earlier changes the re-read confirms, and
   * `unconfirmed` names those it answered 200 but does not show. With no re-read neither is known,
   * so `applied` counts the 200s and `unconfirmed` is empty.
   */
  | {
      readonly kind: 'failed';
      readonly applied: number;
      readonly unconfirmed: readonly NxsPermissionRefusal[];
      readonly total: number;
      readonly change: NxsPermissionChange;
      readonly error: unknown;
      readonly snapshot: NxsPermissionsSnapshot | null;
    }
  /** The server answered 200, but the re-read does not show these changes. */
  | {
      readonly kind: 'unconfirmed';
      readonly refusals: readonly NxsPermissionRefusal[];
      readonly snapshot: NxsPermissionsSnapshot;
    }
  /** Every write was answered, but the re-read failed, so nothing is confirmed either way. */
  | { readonly kind: 'unverified'; readonly count: number; readonly error: unknown };

/**
 * Reads and writes one document's local ACL for `nxs-permissions-panel`, one ACE at a time.
 *
 * Provided by the panel, not by root, so each panel owns its instance. Every call goes through
 * `DocumentDetailService`, which carries authentication through the interceptor.
 */
@Injectable()
export class NxsPermissionsService {
  private readonly documents = inject(DocumentDetailService);

  load(uid: string): Observable<NxsPermissionsSnapshot> {
    return this.documents
      .getDocumentPermissions(uid)
      .pipe(map((doc: NuxeoDocument) => readSnapshot(doc)));
  }

  /**
   * Writes `changes`, refusing the whole batch first if any of them cannot be written faithfully.
   *
   * The ACL is read again before the first write rather than trusted from the panel's view, so a
   * target someone else changed meanwhile is refused instead of silently skipped by Nuxeo; if that
   * read fails, nothing is sent. Writes run in order and stop at the first server refusal. The ACL
   * is re-read afterwards, both to show the user what the server now holds and to confirm each
   * write actually took.
   */
  save(uid: string, changes: readonly NxsPermissionChange[]): Observable<NxsSaveOutcome> {
    return this.load(uid).pipe(
      map((fresh) => ({ fresh, error: null as unknown })),
      catchError((error: unknown) => of({ fresh: null, error })),
      switchMap(({ fresh, error }) => {
        if (!fresh) return of<NxsSaveOutcome>({ kind: 'unread', error });
        const refusals = refusalsFor(fresh, changes);
        if (refusals.length > 0) {
          return of<NxsSaveOutcome>({ kind: 'refused', refusals, snapshot: fresh });
        }
        return this.apply(uid, changes);
      }),
    );
  }

  /**
   * Blocks or unblocks inheritance, then re-reads. Emits `null` when the write succeeded and only
   * the re-read failed, so a caller does not report a change that happened as one that did not.
   */
  setInheritanceBlocked(uid: string, blocked: boolean): Observable<NxsPermissionsSnapshot | null> {
    const write = blocked
      ? this.documents.blockPermissionInheritance(uid)
      : this.documents.unblockPermissionInheritance(uid);
    return write.pipe(switchMap(() => this.load(uid).pipe(catchError(() => of(null)))));
  }

  searchPrincipals(term: string): Observable<UserGroupSuggestion[]> {
    return this.documents.searchUsersGroups(term);
  }

  private apply(uid: string, changes: readonly NxsPermissionChange[]): Observable<NxsSaveOutcome> {
    let applied = 0;
    return from(changes).pipe(
      concatMap((change) =>
        this.write(uid, change).pipe(
          map(() => {
            applied += 1;
            return change;
          }),
          catchError((error: unknown) => {
            throw new WriteFailure(change, error);
          }),
        ),
      ),
      toArray(),
      switchMap(() =>
        this.load(uid).pipe(
          map((after) => ({ after, error: null as unknown })),
          catchError((error: unknown) => of({ after: null, error })),
        ),
      ),
      map(({ after, error }): NxsSaveOutcome => {
        if (!after) return { kind: 'unverified', count: changes.length, error };
        const missing = unconfirmedChanges(after, changes);
        return missing.length > 0
          ? { kind: 'unconfirmed', refusals: missing, snapshot: after }
          : { kind: 'saved', count: changes.length, snapshot: after };
      }),
      catchError((caught: unknown) => {
        if (!(caught instanceof WriteFailure)) throw caught;
        // Re-read so the table shows what the server holds after a partial save. A failed re-read
        // is reported as an unknown state rather than masking the write failure that caused it.
        return this.load(uid).pipe(
          catchError(() => of(null)),
          map((snapshot): NxsSaveOutcome => {
            const unconfirmed = snapshot
              ? unconfirmedChanges(snapshot, changes.slice(0, applied))
              : [];
            return {
              kind: 'failed',
              applied: applied - unconfirmed.length,
              unconfirmed,
              total: changes.length,
              change: caught.change,
              error: caught.cause,
              snapshot,
            };
          }),
        );
      }),
    );
  }

  private write(uid: string, change: NxsPermissionChange): Observable<unknown> {
    switch (change.kind) {
      case 'add':
        return this.documents.addPermission(uid, {
          username: change.principal,
          permission: change.permission,
          begin: change.begin,
          end: change.end,
          notify: false,
        });
      case 'replace':
        return this.documents.replacePermission(uid, {
          id: change.target.id,
          username: change.target.principal,
          permission: change.permission,
          begin: dateToWrite(change.begin, change.target.begin),
          end: dateToWrite(change.end, change.target.end),
          notify: false,
        });
      case 'remove':
        return this.documents.removePermissionById(uid, change.target.id);
    }
  }
}

/** A write the server rejected, carrying the change so the outcome can name it. */
class WriteFailure extends Error {
  constructor(
    readonly change: NxsPermissionChange,
    override readonly cause: unknown,
  ) {
    super('A permission write was rejected');
  }
}
