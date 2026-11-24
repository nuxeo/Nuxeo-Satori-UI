import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** The `localStorage` key prefix; the user's id follows it. */
export const NOTIFICATION_SEEN_KEY_PREFIX = 'nuxeo-satori.notifications.seen:';

/** At most this many items are remembered as seen, the most recently seen kept. */
export const NOTIFICATION_SEEN_LIMIT = 500;

/**
 * What each user has seen in the bell's panel, kept in this browser's `localStorage` under
 * {@link NOTIFICATION_SEEN_KEY_PREFIX} and the user's id: the items the panel has shown, by key
 * (`task:<id>`, `change:<audit id>`), the most recent last, as a JSON array.
 *
 * The items, not a time. A time marks as seen everything up to the moment the panel opened,
 * including a change made a moment before that the bell had not read yet: the audit is written a
 * second or so after the change, and the bell reads at an interval, so such a change would never
 * count. The browser's clock and the server's need not agree either.
 *
 * **Not shared across devices or browsers**, and gone when the browser's storage is cleared: Nuxeo
 * has nowhere to keep it for us (no notification API), and a server-side read state waits on
 * decision B. So the same item counts as unread on a second device until the panel is opened
 * there. Another tab of this browser follows at once, through the `storage` event.
 *
 * Storage that cannot be read or written, as in some private windows, gives nothing seen and keeps
 * nothing: every item then counts as unread, and opening the panel still clears the count for the
 * rest of the session, through the signal the bell keeps.
 */
@Injectable({ providedIn: 'root' })
export class NotificationReadState {
  private readonly storage = storageOf(inject(DOCUMENT));

  /** The storage key for a user. */
  key(user: string): string {
    return NOTIFICATION_SEEN_KEY_PREFIX + user;
  }

  /** The keys the user has seen, or `null` when this browser holds none for them. */
  seen(user: string): ReadonlySet<string> | null {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key(user)) ?? null;
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value)
        ? new Set(value.filter((key): key is string => typeof key === 'string'))
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Keeps `keys` as what the user has seen, the last of them the most recent, at most
   * {@link NOTIFICATION_SEEN_LIMIT}. Fails silently where storage is refused.
   */
  setSeen(user: string, keys: Iterable<string>): void {
    const kept = [...keys].slice(-NOTIFICATION_SEEN_LIMIT);
    try {
      this.storage?.setItem(this.key(user), JSON.stringify(kept));
    } catch {
      // Quota or a refused storage: the signal the bell keeps still holds it for this session.
    }
  }
}

function storageOf(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}
