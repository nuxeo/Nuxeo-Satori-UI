import { Injectable } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

/**
 * Says that documents have changed, so that the lists following it read their page again.
 *
 * An action can run from a surface other than the list it changed: the platform's row actions run
 * from one registration for the whole app, whichever list offered them. So the action does not
 * reload the list itself. It notifies this service, and each list that follows it asks again:
 * browse's listing, and each `RecordListComponent`: a record page's related records and a queue.
 *
 * Every list follows every change, not only the one the action came from. A copy or a move can add
 * a row to another list on the same page, and a list cannot tell from a uid whether its query
 * would now return that document.
 *
 * A customer's own action that changes documents notifies it too, and the lists on screen follow.
 *
 * Delivered synchronously: every follower hears of the change before `notify` returns, and what it
 * does then is its own. Browse reloads its folder at once; a record list asks again on the next
 * change detection, as for any other change to its request. `BrowseContextService
 * .requestContentRefresh()` is different: it asks browse alone, through an effect.
 */
@Injectable({ providedIn: 'root' })
export class DocumentChangesService {
  private readonly changed = new Subject<void>();

  /** One emission for each change notified. */
  readonly changes: Observable<void> = this.changed.asObservable();

  /** Documents were renamed, copied, moved, trashed or otherwise changed. */
  notify(): void {
    this.changed.next();
  }
}
