import { OverlayContainer } from '@angular/cdk/overlay';
import { type WritableSignal, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { FakeMatIconRegistry } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { AppConfigService, DEFAULT_APP_BOOTSTRAP_CONFIG } from '@nuxeo/satori-platform/app-config';
import {
  ADMIN_ACCESS_CHECKS,
  type AuditEntry,
  CURRENT_USERNAME,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, map, of, throwError } from 'rxjs';

import type { FollowedRecord, TaskNotification } from '../notification.model';
import { NotificationCenter } from '../notification-center';
import { NOTIFICATION_SEEN_KEY_PREFIX } from '../notification-read-state';
import {
  type ChangesRead,
  type ChangesWanted,
  type FollowedPage,
  NotificationSources,
} from '../notification-sources';
import { NotificationBellComponent } from './notification-bell';

const NOW = Date.parse('2026-11-23T18:00:00.000Z');
const A = 'aaaaaaaa-0000-0000-0000-000000000001';

function audit(id: number, eventDate: string, over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    category: 'eventDocumentCategory',
    principalName: 'jsmith',
    comment: '',
    docLifeCycle: 'project',
    docPath: '/default-domain/workspaces/claim-42',
    docType: 'Claim',
    docUUID: A,
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate,
    logDate: eventDate,
    extended: {},
    ...over,
  };
}

class FakeSources {
  tasksResult: Observable<TaskNotification[]> = of([]);
  followedResult: Observable<FollowedRecord[]> = of([]);
  audit: AuditEntry[] = [];

  tasks(): Observable<TaskNotification[]> {
    return this.tasksResult;
  }

  /** Who each check asked for. */
  readonly askedFor: string[] = [];

  followed(user: string): Observable<FollowedPage> {
    this.askedFor.push(user);
    return this.followedResult.pipe(map((records) => ({ records, more: false })));
  }

  changes(wanted: readonly ChangesWanted[]): Observable<ChangesRead & { refused: boolean }> {
    return of({ entries: this.audit, read: new Set(wanted.map((w) => w.uid)), refused: false });
  }
}

describe('NotificationBellComponent', () => {
  let sources: FakeSources;
  let user: WritableSignal<string | null>;
  let fixture: ComponentFixture<NotificationBellComponent>;
  let overlay: HTMLElement;

  const bell = () =>
    fixture.nativeElement.querySelector('button.notification-bell') as HTMLButtonElement;
  const panel = () => overlay.querySelector<HTMLElement>('[role="dialog"]');
  const text = (el: Element | null | undefined) =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function openPanel(): Promise<void> {
    bell().click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function press(key: string, target: Element): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    sources = new FakeSources();
    sources.tasksResult = of([
      {
        kind: 'task',
        key: 'task:t1',
        taskId: 't1',
        at: '2026-11-23T10:00:00.000Z',
        title: 'Document Validation',
        record: 'Claim 42',
      },
    ]);
    sources.followedResult = of([
      { uid: A, title: 'Claim 42', modified: '2026-11-23T18:31:13.000Z' },
    ]);
    sources.audit = [
      audit(2, '2026-11-23T18:31:13.000Z', {
        eventId: 'lifecycle_transition_event',
        docLifeCycle: 'approved',
      }),
      audit(1, '2026-11-23T17:00:00.000Z'),
    ];
    user = signal<string | null>('me');
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideRouter([]),
        { provide: NotificationSources, useValue: sources },
        { provide: CURRENT_USERNAME, useValue: () => user() },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => false,
            isPowerUser: () => false,
            hasAdministrationAccess: () => false,
          },
        },
        { provide: AppConfigService, useValue: { bootstrap: () => DEFAULT_APP_BOOTSTRAP_CONFIG } },
        { provide: MatIconRegistry, useClass: FakeMatIconRegistry },
      ],
    });
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('the bell', () => {
    it('names the unread count, which the badge shows', async () => {
      await render();
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 3 unread');
      expect(text(fixture.nativeElement.querySelector('.notification-bell__badge'))).toBe('3');
      // The badge is hidden from assistive technology: the name says it already.
      expect(
        fixture.nativeElement
          .querySelector('.notification-bell__badge')
          ?.getAttribute('aria-hidden'),
      ).toBe('true');
    });

    it('names a count of none, and shows no badge', async () => {
      localStorage.setItem(
        `${NOTIFICATION_SEEN_KEY_PREFIX}me`,
        JSON.stringify(['task:t1', 'change:2', 'change:1']),
      );
      await render();
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 0 unread');
      expect(fixture.nativeElement.querySelector('.notification-bell__badge')).toBeNull();
    });

    it('caps the badge at 99+, while the name says the number', async () => {
      sources.tasksResult = of(
        Array.from({ length: 120 }, (_, i) => ({
          kind: 'task' as const,
          key: `task:t${i}`,
          taskId: `t${i}`,
          at: '2026-11-23T10:00:00.000Z',
          title: `Task ${i}`,
          record: null,
        })),
      );
      await render();
      expect(text(fixture.nativeElement.querySelector('.notification-bell__badge'))).toBe('99+');
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 122 unread');
    });

    it('is a button that says it opens a dialog, and whether it is open', async () => {
      await render();
      expect(bell().getAttribute('type')).toBe('button');
      expect(bell().getAttribute('aria-haspopup')).toBe('dialog');
      expect(bell().getAttribute('aria-expanded')).toBe('false');
      expect(bell().hasAttribute('aria-controls')).toBe(false);
      await openPanel();
      expect(bell().getAttribute('aria-expanded')).toBe('true');
      expect(bell().getAttribute('aria-controls')).toBe(panel()?.id);
    });
  });

  describe('the panel', () => {
    it('is a dialog named by its heading, and takes the focus when it opens', async () => {
      await render();
      expect(panel()).toBeNull();
      await openPanel();
      const dialog = panel();
      expect(dialog).not.toBeNull();
      const heading = overlay.querySelector(`#${dialog?.getAttribute('aria-labelledby')}`);
      expect(text(heading)).toBe('Notifications');
      // Modal, as the focus is kept inside it.
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(dialog);
    });

    it('clears the count when it opens, and keeps what was new marked', async () => {
      localStorage.setItem(`${NOTIFICATION_SEEN_KEY_PREFIX}me`, JSON.stringify(['task:t1']));
      await render();
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread');
      await openPanel();
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 0 unread');
      const marked = [...overlay.querySelectorAll('.notification-panel__item--new')].map((el) =>
        text(el.querySelector('.notification-panel__primary')),
      );
      expect(marked).toEqual(['New Claim 42', 'New Claim 42']);
    });

    it('lists the open tasks, each opening its task, with when it was created in the reader’s zone', async () => {
      await render();
      await openPanel();
      const items = [...overlay.querySelectorAll<HTMLAnchorElement>('a.notification-panel__item')];
      const taskItem = items.find((a) => a.getAttribute('href') === '/tasks/t1');
      expect(text(taskItem?.querySelector('.notification-panel__primary'))).toBe(
        'New Document Validation',
      );
      expect(text(taskItem?.querySelector('.notification-panel__secondary'))).toBe('On Claim 42');
      const time = taskItem?.querySelector('time');
      expect(time?.getAttribute('datetime')).toBe('2026-11-23T10:00:00.000Z');
      // 10:00 UTC is 15:30 in the suite's zone, Asia/Calcutta (+05:30).
      expect(text(time)).toBe('Nov 23, 2026, 3:30:00 PM');
    });

    it('lists the changes with who, what and when, each opening its record', async () => {
      await render();
      await openPanel();
      const changes = [
        ...overlay.querySelectorAll<HTMLAnchorElement>('a.notification-panel__item'),
      ].filter((a) => a.getAttribute('href') === `/doc/${A}`);
      expect(changes.map((a) => text(a.querySelector('.notification-panel__secondary')))).toEqual([
        'State changed to Approved by jsmith',
        'Modified by jsmith',
      ]);
      const times = changes.map((a) => a.querySelector('time'));
      expect(times.map((t) => t?.getAttribute('datetime'))).toEqual([
        '2026-11-23T18:31:13.000Z',
        '2026-11-23T17:00:00.000Z',
      ]);
      // 18:31:13 UTC is past midnight in +05:30: the day moves too, which UTC would not show.
      expect(times.map((t) => text(t))).toEqual([
        'Nov 24, 2026, 12:01:13 AM',
        'Nov 23, 2026, 10:30:00 PM',
      ]);
    });

    it('says when there is nothing to list', async () => {
      sources.tasksResult = of([]);
      sources.followedResult = of([]);
      sources.audit = [];
      await render();
      await openPanel();
      expect(text(overlay)).toContain('No open tasks');
      expect(text(overlay)).toContain('No changes by other people in the last 7 days');
      expect(
        overlay.querySelector<HTMLButtonElement>('.notification-panel__mark-read')?.disabled,
      ).toBe(true);
    });

    it('says the read state is kept in this browser only', async () => {
      await render();
      await openPanel();
      expect(text(overlay.querySelector('.notification-panel__note'))).toBe(
        'What you have read is remembered in this browser only, not on your other devices.',
      );
    });

    it('says when it could not check, and lists nothing it does not know', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      sources.followedResult = throwError(() => new Error('down'));
      await render();
      await openPanel();
      expect(text(overlay.querySelector('[role="status"]'))).toBe(
        'The latest check for new items failed. The bell will try again.',
      );
      // Neither "No open tasks" nor "No changes": nothing is known yet.
      expect(overlay.querySelectorAll('.notification-panel__section')).toHaveLength(0);
      expect(text(overlay)).not.toContain('No open tasks');
      expect(text(overlay)).not.toContain('No changes');
    });

    it('"Mark all as read" clears the new marks', async () => {
      await render();
      await openPanel();
      expect(overlay.querySelectorAll('.notification-panel__item--new')).toHaveLength(3);
      overlay.querySelector<HTMLButtonElement>('.notification-panel__mark-read')?.click();
      fixture.detectChanges();
      expect(overlay.querySelectorAll('.notification-panel__item--new')).toHaveLength(0);
      expect(bell().getAttribute('aria-label')).toBe('Notifications, 0 unread');
    });
  });

  describe('the keyboard', () => {
    it('Escape closes the panel and gives the focus back to the bell', async () => {
      await render();
      await openPanel();
      const dialog = panel();
      expect(dialog).not.toBeNull();
      press('Escape', dialog as HTMLElement);
      await fixture.whenStable();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(bell());
    });

    it('closing the panel, however it closes, marks what it showed as seen', async () => {
      await render();
      const center = fixture.debugElement.injector.get(NotificationCenter);
      const closed = vi.spyOn(center, 'closed');
      await openPanel();
      press('Escape', panel() as HTMLElement);
      await openPanel();
      overlay.querySelector<HTMLButtonElement>('.notification-panel__close')?.click();
      fixture.detectChanges();
      await openPanel();
      bell().click();
      fixture.detectChanges();
      expect(closed).toHaveBeenCalledTimes(3);
    });

    it('the close button closes it and gives the focus back to the bell', async () => {
      await render();
      await openPanel();
      const close = overlay.querySelector<HTMLButtonElement>('.notification-panel__close');
      expect(close?.getAttribute('aria-label')).toBe('Close notifications');
      close?.click();
      fixture.detectChanges();
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(bell());
    });

    it('surrounds the panel with a focus trap', async () => {
      // That the trap is there, and nothing more. Its anchors move the focus only to an element
      // with layout, which jsdom has none of; the wrap was checked by hand in a browser, not here.
      await render();
      await openPanel();
      const anchors = overlay.querySelectorAll('.cdk-focus-trap-anchor');
      expect(anchors).toHaveLength(2);
      const links = overlay.querySelectorAll('a.notification-panel__item');
      expect(links).toHaveLength(3);
      for (const link of links) expect(link.getAttribute('href')).toMatch(/^\/(tasks|doc)\//);
    });

    it('the bell toggles the panel', async () => {
      await render();
      await openPanel();
      expect(panel()).not.toBeNull();
      bell().click();
      fixture.detectChanges();
      expect(panel()).toBeNull();
    });
  });

  it('closes the panel and starts again when the user changes', async () => {
    await render();
    await openPanel();
    expect(sources.askedFor).toEqual(['me']);
    user.set('someone-else');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(panel()).toBeNull();
    expect(sources.askedFor).toEqual(['me', 'someone-else']);
  });
});
