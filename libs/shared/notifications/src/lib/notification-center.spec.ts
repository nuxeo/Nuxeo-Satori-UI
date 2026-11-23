import { type WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppConfigService, DEFAULT_APP_BOOTSTRAP_CONFIG } from '@nuxeo/satori-platform/app-config';
import {
  ADMIN_ACCESS_CHECKS,
  type AuditEntry,
  CURRENT_USERNAME,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, map, of, throwError } from 'rxjs';

import type { FollowedRecord, TaskNotification } from './notification.model';
import { NotificationCenter } from './notification-center';
import { NOTIFICATION_SEEN_KEY_PREFIX } from './notification-read-state';
import { NOTIFICATION_WINDOW_MS } from './notification-settings';
import {
  type ChangesRead,
  type ChangesWanted,
  type FollowedPage,
  NotificationSources,
} from './notification-sources';

const NOW = Date.parse('2026-11-23T18:00:00.000Z');
const INTERVAL = 60_000;
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

function audit(
  id: number,
  uid: string,
  eventDate: string,
  over: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    id,
    category: 'eventDocumentCategory',
    principalName: 'jsmith',
    comment: '',
    docLifeCycle: 'project',
    docPath: `/default-domain/workspaces/${uid}`,
    docType: 'File',
    docUUID: uid,
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate,
    logDate: eventDate,
    extended: {},
    ...over,
  };
}

function task(id: string, at: string): TaskNotification {
  return { kind: 'task', key: `task:${id}`, taskId: id, at, title: id, record: null };
}

/** Sources a test answers: what the next check gets, and what each check asked. */
class FakeSources {
  tasksResult: Observable<TaskNotification[]> = of([]);
  /** The first page of followed records. */
  followedResult: Observable<FollowedRecord[]> = of([]);
  /** The pages after it. */
  laterPages: FollowedRecord[][] = [];
  /** The audit, by record: every entry it holds; `changes` answers those at or after `since`. */
  audit: AuditEntry[] = [];
  changesError: unknown = null;
  refuse = false;
  readonly followedAsked: { user: string; since: Date; page: number }[] = [];
  readonly changesAsked: { wanted: readonly ChangesWanted[]; audit: boolean }[] = [];

  tasks(): Observable<TaskNotification[]> {
    return this.tasksResult;
  }

  followed(user: string, since: Date, page = 0): Observable<FollowedPage> {
    this.followedAsked.push({ user, since, page });
    const more = page < this.laterPages.length;
    return page === 0
      ? this.followedResult.pipe(map((records) => ({ records, more })))
      : of({ records: this.laterPages[page - 1] ?? [], more });
  }

  changes(
    wanted: readonly ChangesWanted[],
    audit: boolean,
  ): Observable<ChangesRead & { refused: boolean }> {
    this.changesAsked.push({ wanted, audit });
    if (this.changesError) return throwError(() => this.changesError);
    const entries = this.audit.filter((entry) =>
      wanted.some(
        (w) => w.uid === entry.docUUID && Date.parse(entry.eventDate) >= w.since.getTime(),
      ),
    );
    return of({ entries, read: new Set(wanted.map((w) => w.uid)), refused: this.refuse && audit });
  }
}

describe('NotificationCenter', () => {
  let sources: FakeSources;
  let user: WritableSignal<string | null>;
  let admin: boolean;
  let center: NotificationCenter;

  function followed(...records: [string, string][]): void {
    sources.followedResult = of(
      records.map(([uid, modified]) => ({ uid, title: `Title ${uid.slice(0, 1)}`, modified })),
    );
  }

  /** The record lower bounds the latest check asked the audit for, by uid. */
  function lastAsked(): Record<string, string> {
    const last = sources.changesAsked.at(-1);
    return Object.fromEntries((last?.wanted ?? []).map((w) => [w.uid, w.since.toISOString()]));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    sources = new FakeSources();
    user = signal<string | null>('me');
    admin = false;
    TestBed.configureTestingModule({
      providers: [
        NotificationCenter,
        { provide: NotificationSources, useValue: sources },
        { provide: CURRENT_USERNAME, useValue: () => user() },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => admin,
            isPowerUser: () => false,
            hasAdministrationAccess: () => admin,
          },
        },
        { provide: AppConfigService, useValue: { bootstrap: () => DEFAULT_APP_BOOTSTRAP_CONFIG } },
      ],
    });
    center = TestBed.inject(NotificationCenter);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks for the signed-in user over the last seven days', () => {
    sources.tasksResult = of([task('t1', '2026-11-23T10:00:00.000Z')]);
    followed([A, '2026-11-23T17:00:00.000Z']);
    sources.audit = [audit(1, A, '2026-11-23T17:00:00.000Z')];
    center.start();

    expect(sources.followedAsked).toEqual([
      { user: 'me', since: new Date(NOW - NOTIFICATION_WINDOW_MS), page: 0 },
    ]);
    expect(lastAsked()).toEqual({ [A]: new Date(NOW - NOTIFICATION_WINDOW_MS).toISOString() });
    expect(center.tasks().map((t) => t.key)).toEqual(['task:t1']);
    expect(center.changes()).toEqual([
      {
        kind: 'change',
        key: 'change:1',
        auditId: 1,
        at: '2026-11-23T17:00:00.000Z',
        who: 'jsmith',
        event: 'documentModified',
        state: null,
        uid: A,
        title: 'Title a',
      },
    ]);
    expect(center.loaded()).toBe(true);
  });

  it("leaves out the user's own changes and events it does not list", () => {
    followed([A, '2026-11-23T17:00:00.000Z']);
    sources.audit = [
      audit(1, A, '2026-11-23T17:00:00.000Z', { principalName: 'me' }),
      audit(2, A, '2026-11-23T16:00:00.000Z', { eventId: 'download' }),
      audit(3, A, '2026-11-23T15:00:00.000Z', {
        eventId: 'lifecycle_transition_event',
        docLifeCycle: 'approved',
      }),
    ];
    center.start();
    expect(center.changes().map((c) => [c.key, c.state])).toEqual([['change:3', 'approved']]);
  });

  it('asks the audit query for an administrator, and stops asking once it was refused', () => {
    admin = true;
    sources.refuse = true;
    followed([A, '2026-11-23T17:00:00.000Z']);
    center.start();
    expect(sources.changesAsked.at(-1)?.audit).toBe(true);

    followed([A, '2026-11-23T17:30:00.000Z']);
    vi.advanceTimersByTime(INTERVAL);
    expect(sources.changesAsked.at(-1)?.audit).toBe(false);
  });

  it('does not ask the audit query for anyone else', () => {
    followed([A, '2026-11-23T17:00:00.000Z']);
    center.start();
    expect(sources.changesAsked.at(-1)?.audit).toBe(false);
  });

  describe('what each check reads', () => {
    it('reads only the records whose dc:modified moved, from the change it last read at', () => {
      followed([A, '2026-11-23T17:00:00.000Z'], [B, '2026-11-23T16:00:00.000Z']);
      sources.audit = [
        audit(1, A, '2026-11-23T17:00:00.000Z'),
        audit(2, B, '2026-11-23T16:00:00.000Z'),
      ];
      center.start();
      expect(Object.keys(lastAsked()).sort()).toEqual([A, B]);

      // Nothing moved: the audit is not asked at all.
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.changesAsked.at(-1)?.wanted).toEqual([]);

      // A moved: A alone, from its last change, included, so nothing between is skipped.
      followed([A, '2026-11-23T18:00:30.000Z'], [B, '2026-11-23T16:00:00.000Z']);
      sources.audit.push(audit(3, A, '2026-11-23T18:00:30.000Z'));
      vi.advanceTimersByTime(INTERVAL);
      expect(lastAsked()).toEqual({ [A]: '2026-11-23T17:00:00.000Z' });
      // The change read again at its lower bound is listed once.
      expect(center.changes().map((c) => c.key)).toEqual(['change:3', 'change:1', 'change:2']);
    });

    it('reads a record once more when its audit had not caught up, then leaves it', () => {
      followed([A, '2026-11-23T17:00:00.000Z']);
      // dc:modified moved, and the audit has nothing for it yet.
      center.start();
      expect(Object.keys(lastAsked())).toEqual([A]);

      sources.audit = [audit(1, A, '2026-11-23T17:00:00.000Z')];
      vi.advanceTimersByTime(INTERVAL);
      // From where it was read before, held to the window, which has moved on by a minute.
      expect(lastAsked()).toEqual({
        [A]: new Date(NOW + INTERVAL - NOTIFICATION_WINDOW_MS).toISOString(),
      });
      expect(center.changes().map((c) => c.key)).toEqual(['change:1']);

      vi.advanceTimersByTime(INTERVAL);
      expect(sources.changesAsked.at(-1)?.wanted).toEqual([]);
    });

    it('gives up on a change that wrote no event it lists after two reads', () => {
      followed([A, '2026-11-23T17:00:00.000Z']);
      center.start();
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.changesAsked).toHaveLength(2);
      expect(sources.changesAsked[1]?.wanted.map((w) => w.uid)).toEqual([A]);
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.changesAsked[2]?.wanted).toEqual([]);
    });

    it('drops a change once it is older than the window', () => {
      // The window starts at 2026-11-16T18:00:00Z, seven days before now.
      followed([A, '2026-11-16T18:00:30.000Z']);
      sources.audit = [audit(2, A, '2026-11-16T18:00:30.000Z')];
      center.start();
      expect(center.changes().map((c) => c.key)).toEqual(['change:2']);
      // A minute later the window starts after it.
      vi.advanceTimersByTime(INTERVAL);
      expect(center.changes()).toEqual([]);
    });

    it('lists at most fifty changes, newest first', () => {
      followed([A, '2026-11-23T17:59:00.000Z']);
      sources.audit = Array.from({ length: 60 }, (_, i) =>
        audit(i + 1, A, new Date(NOW - (60 - i) * 60_000).toISOString()),
      );
      center.start();
      expect(center.changes()).toHaveLength(50);
      expect(center.changes()[0]?.auditId).toBe(60);
      expect(center.changes()[49]?.auditId).toBe(11);
    });

    it('reads further pages of followed records while every record on a page changed', () => {
      const page = (prefix: string, modified: string) =>
        Array.from({ length: 2 }, (_, i) => ({
          uid: `${prefix}${i}`,
          title: `${prefix}${i}`,
          modified,
        }));
      // First check: the first page only, as nothing is known yet.
      sources.followedResult = of(page('p', '2026-11-23T17:00:00.000Z'));
      sources.laterPages = [page('q', '2026-11-23T16:00:00.000Z')];
      center.start();
      expect(sources.followedAsked.map((a) => a.page)).toEqual([0]);

      // Someone changes the records the bell read, and more: page 0 holds only known records that
      // changed, so page 1 is read too, and its records join the audit read.
      sources.followedResult = of(page('p', '2026-11-23T18:00:30.000Z'));
      sources.laterPages = [page('q', '2026-11-23T18:00:20.000Z')];
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.followedAsked.slice(1).map((a) => a.page)).toEqual([0, 1]);
      expect(Object.keys(lastAsked()).sort()).toEqual(['p0', 'p1', 'q0', 'q1']);
    });

    it('reads further pages when a change to many records brings in ones the bell never read', () => {
      // The bell watched A and B. Someone changes 6 followed records at once, in an order that
      // puts records it never read first: every one is newer than the newest it saw, so it reads
      // on, and finds A and B on the next pages.
      sources.followedResult = of([
        { uid: A, title: 'a', modified: '2026-11-23T17:00:00.000Z' },
        { uid: B, title: 'b', modified: '2026-11-23T16:00:00.000Z' },
      ]);
      center.start();
      const at = (s: number) => `2026-11-23T18:00:${String(s).padStart(2, '0')}.000Z`;
      sources.followedResult = of([
        { uid: 'u1', title: 'u1', modified: at(40) },
        { uid: 'u2', title: 'u2', modified: at(39) },
      ]);
      sources.laterPages = [
        [
          { uid: 'u3', title: 'u3', modified: at(38) },
          { uid: A, title: 'a', modified: at(37) },
        ],
        [
          { uid: B, title: 'b', modified: at(36) },
          { uid: 'old', title: 'old', modified: '2026-11-20T00:00:00.000Z' },
        ],
      ];
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.followedAsked.slice(1).map((a) => a.page)).toEqual([0, 1, 2]);
      expect(Object.keys(lastAsked()).sort()).toEqual([A, B, 'old', 'u1', 'u2', 'u3'].sort());
    });

    it('pages on a change to many records after checks that found none in the window', () => {
      sources.followedResult = of([]);
      center.start();
      sources.followedResult = of([
        { uid: A, title: 'a', modified: '2026-11-23T18:00:40.000Z' },
        { uid: B, title: 'b', modified: '2026-11-23T18:00:39.000Z' },
      ]);
      sources.laterPages = [[{ uid: 'c', title: 'c', modified: '2026-11-23T18:00:38.000Z' }]];
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.followedAsked.slice(1).map((a) => a.page)).toEqual([0, 1]);
    });

    it('stops at the first page holding a record that did not change', () => {
      sources.followedResult = of([
        { uid: A, title: 'a', modified: '2026-11-23T17:00:00.000Z' },
        { uid: B, title: 'b', modified: '2026-11-23T16:00:00.000Z' },
      ]);
      sources.laterPages = [[{ uid: 'c', title: 'c', modified: '2026-11-23T15:00:00.000Z' }]];
      center.start();
      sources.followedResult = of([
        { uid: A, title: 'a', modified: '2026-11-23T18:00:30.000Z' },
        { uid: B, title: 'b', modified: '2026-11-23T16:00:00.000Z' },
      ]);
      vi.advanceTimersByTime(INTERVAL);
      expect(sources.followedAsked.map((a) => a.page)).toEqual([0, 0]);
    });
  });

  describe('read state', () => {
    const stored = (user: string) => localStorage.getItem(`${NOTIFICATION_SEEN_KEY_PREFIX}${user}`);
    const store = (user: string, keys: string[]) =>
      localStorage.setItem(`${NOTIFICATION_SEEN_KEY_PREFIX}${user}`, JSON.stringify(keys));

    beforeEach(() => {
      sources.tasksResult = of([task('t1', '2026-11-23T10:00:00.000Z')]);
      followed([A, '2026-11-23T17:00:00.000Z']);
      sources.audit = [audit(1, A, '2026-11-23T17:00:00.000Z')];
    });

    it('counts every item as unread when this browser has seen nothing for the user', () => {
      center.start();
      expect(center.seen()).toBeNull();
      expect(center.unread()).toBe(2);
    });

    it('counts only what the panel has not shown', () => {
      store('me', ['task:t1']);
      center.start();
      expect(center.unread()).toBe(1);
    });

    it('keeps what was seen per user', () => {
      store('someone-else', ['task:t1', 'change:1']);
      center.start();
      expect(center.unread()).toBe(2);
    });

    it('opening the panel clears the count, stores what it shows, and keeps what was new marked', () => {
      store('me', ['task:t1']);
      center.start();
      const [taskItem] = center.tasks();
      const [change] = center.changes();

      center.opened();
      expect(center.unread()).toBe(0);
      expect(JSON.parse(stored('me') ?? 'null')).toEqual(['task:t1', 'change:1']);
      // Marked against what was seen before it opened: the change is new, the task is not.
      expect(change && center.isNew(change)).toBe(true);
      expect(taskItem && center.isNew(taskItem)).toBe(false);
    });

    it('counts a change read after the panel opened even when it is dated before', () => {
      // A change made a moment before the panel opens, which the bell reads only at the next
      // check: the audit is written a second or so after the change, and checks run at an
      // interval. Seen by time, it would never count.
      center.start();
      vi.advanceTimersByTime(10_000);
      center.opened();
      expect(center.unread()).toBe(0);

      followed([A, '2026-11-23T18:00:05.000Z']);
      sources.audit.push(audit(2, A, '2026-11-23T18:00:05.000Z'));
      vi.advanceTimersByTime(INTERVAL);
      expect(center.unread()).toBe(1);
      center.opened();
      const late = center.changes().find((c) => c.key === 'change:2');
      expect(late && center.isNew(late)).toBe(true);
    });

    it('keeps an item seen whatever the clocks say', () => {
      // The browser's clock is behind the server's: the change is "in the future" here.
      followed([A, '2026-11-23T18:05:00.000Z']);
      sources.audit = [audit(1, A, '2026-11-23T18:05:00.000Z')];
      center.start();
      center.opened();
      expect(center.unread()).toBe(0);
      vi.advanceTimersByTime(INTERVAL);
      expect(center.unread()).toBe(0);
    });

    it('opening before the first check ends forgets nothing seen before', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      store('me', ['task:t1', 'change:1']);
      sources.followedResult = throwError(() => new Error('down'));
      center.start();
      center.opened();
      expect(JSON.parse(stored('me') ?? 'null')).toEqual(['task:t1', 'change:1']);
    });

    it('"mark all as read" covers what arrived while the panel was open, and clears the marks', () => {
      center.start();
      center.opened();

      followed([A, '2026-11-23T18:01:30.000Z']);
      sources.audit.push(audit(2, A, '2026-11-23T18:01:30.000Z'));
      vi.advanceTimersByTime(INTERVAL);
      expect(center.unread()).toBe(1);

      center.markAllRead();
      expect(center.unread()).toBe(0);
      expect(center.changes().some((c) => center.isNew(c))).toBe(false);
    });

    it('closing the panel marks as seen what a check brought while it was open', () => {
      center.start();
      center.opened();
      followed([A, '2026-11-23T18:01:30.000Z']);
      sources.audit.push(audit(2, A, '2026-11-23T18:01:30.000Z'));
      vi.advanceTimersByTime(INTERVAL);
      expect(center.unread()).toBe(1);
      center.closed();
      expect(center.unread()).toBe(0);
      expect(JSON.parse(stored('me') ?? 'null')).toContain('change:2');
    });

    it('follows another tab of this browser that clears its storage', () => {
      store('me', ['task:t1', 'change:1']);
      center.start();
      expect(center.unread()).toBe(0);
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      expect(center.unread()).toBe(2);
    });

    it('follows another tab of this browser that opened the panel', () => {
      center.start();
      expect(center.unread()).toBe(2);
      store('me', ['task:t1', 'change:1']);
      window.dispatchEvent(
        new StorageEvent('storage', { key: `${NOTIFICATION_SEEN_KEY_PREFIX}me` }),
      );
      expect(center.unread()).toBe(0);
      // Another user's key changes nothing here.
      store('me', []);
      window.dispatchEvent(
        new StorageEvent('storage', { key: `${NOTIFICATION_SEEN_KEY_PREFIX}someone-else` }),
      );
      expect(center.unread()).toBe(0);
    });

    it('asks for a check when the panel opens, unless one ran a moment ago', () => {
      center.start();
      center.opened();
      expect(sources.followedAsked).toHaveLength(1);
      vi.advanceTimersByTime(20_000);
      center.opened();
      expect(sources.followedAsked).toHaveLength(2);
    });
  });

  it('keeps the items of the last good check when one fails, and says so until one succeeds', () => {
    followed([A, '2026-11-23T17:00:00.000Z']);
    sources.audit = [audit(1, A, '2026-11-23T17:00:00.000Z')];
    center.start();
    expect(center.failed()).toBe(false);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sources.followedResult = throwError(() => new Error('down'));
    vi.advanceTimersByTime(INTERVAL);
    expect(center.failed()).toBe(true);
    expect(center.changes().map((c) => c.key)).toEqual(['change:1']);
    // Said once for the run of failures, not at every retry.
    vi.advanceTimersByTime(2 * INTERVAL);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    followed([A, '2026-11-23T17:00:00.000Z']);
    // Backed off: four times the interval after two failures.
    vi.advanceTimersByTime(3 * INTERVAL);
    expect(center.failed()).toBe(true);
    vi.advanceTimersByTime(INTERVAL);
    expect(center.failed()).toBe(false);
  });

  it('reports a read that throws before it returns as a failed check', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sources.followed = () => {
      throw new Error('thrown before an observable');
    };
    center.start();
    expect(center.failed()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('starts again from nothing for another user, and stops while no one is signed in', () => {
    followed([A, '2026-11-23T17:00:00.000Z']);
    sources.audit = [audit(1, A, '2026-11-23T17:00:00.000Z')];
    center.start();
    expect(center.changes()).toHaveLength(1);

    user.set(null);
    center.start();
    expect(center.changes()).toEqual([]);
    expect(center.loaded()).toBe(false);
    const asked = sources.followedAsked.length;
    vi.advanceTimersByTime(5 * INTERVAL);
    expect(sources.followedAsked).toHaveLength(asked);

    user.set('jsmith');
    localStorage.setItem(`${NOTIFICATION_SEEN_KEY_PREFIX}jsmith`, JSON.stringify(['task:x']));
    center.start();
    expect(sources.followedAsked.at(-1)?.user).toBe('jsmith');
    // jsmith made the change: it is their own, so it is not listed.
    expect(center.changes()).toEqual([]);
    expect(center.seen()).toEqual(new Set(['task:x']));
  });

  it('does nothing when started again for the same user', () => {
    center.start();
    center.start();
    expect(sources.followedAsked).toHaveLength(1);
  });
});
