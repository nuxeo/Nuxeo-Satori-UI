import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  type AuditEntry,
  type AuditLogList,
  type AuditLogQuery,
  DocumentChangesService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import type { RecordTimelineEntry } from './record-layout';
import { RecordTimelineComponent } from './record-timeline';

const claim = (overrides: Partial<NuxeoDocument> = {}): NuxeoDocument => ({
  uid: 'c1',
  title: 'Claim 1',
  type: 'Claim',
  path: '/c1',
  lastModified: '2026-11-23T10:00:00.000Z',
  state: 'approved',
  properties: {},
  ...overrides,
});

let nextId = 100;
/** An audit entry as Nuxeo 2025 returns one, but that it sends `null` for no comment, which the model types as a text. */
const entry = (
  eventId: string,
  eventDate: string,
  docLifeCycle: string,
  overrides: Partial<AuditEntry> = {},
): AuditEntry => ({
  id: nextId--,
  category: 'eventDocumentCategory',
  principalName: 'jdoe',
  comment: '',
  docLifeCycle,
  docPath: '/c1',
  docType: 'Claim',
  docUUID: 'c1',
  eventId,
  repositoryId: 'default',
  eventDate,
  logDate: eventDate,
  extended: {},
  ...overrides,
});

/** A page as the `@audit` adapter returns one. */
const page = (entries: AuditEntry[], next = false): AuditLogList => ({
  entries,
  totalSize: entries.length,
  resultsCount: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: next,
});

/** The newest first, as the adapter sorts them: a transition, then two entries in the state it left. */
const transitioned = (): AuditEntry[] => [
  entry('lifecycle_transition_event', '2026-11-23T20:00:00.000Z', 'approved', {
    category: 'eventLifeCycleCategory',
  }),
  entry('documentModified', '2026-11-22T09:00:00.000Z', 'project', { principalName: 'system' }),
  entry('documentCreated', '2026-11-21T09:00:00.000Z', 'project', { principalName: 'asmith' }),
];

/** The second ask's delay where a test wants one: short, and waited out by the test zone. */
const AUDIT_DELAY = 30;

const TIMELINE: RecordTimelineEntry = {
  events: ['documentCreated', 'documentModified', 'lifecycle_transition_event'],
  filter: false,
  pageSize: 20,
};

describe('RecordTimelineComponent', () => {
  let fixture: ComponentFixture<RecordTimelineComponent>;
  let getAuditLog: ReturnType<
    typeof vi.fn<
      (uid: string, size: number, index: number, query: AuditLogQuery) => Observable<AuditLogList>
    >
  >;
  let principalLabel: ReturnType<typeof vi.fn>;
  /** `null` unless a test wants the second ask: then every timeline asks twice. */
  let auditDelay: number | null;

  beforeEach(() => {
    nextId = 100;
    auditDelay = null;
    getAuditLog = vi.fn(() => of(page(transitioned())));
    principalLabel = vi.fn((kind: string, id: string) =>
      of(kind === 'user' && id === 'jdoe' ? 'Jane Doe' : id === 'asmith' ? 'Ann Smith' : null),
    );
    TestBed.configureTestingModule({
      imports: [RecordTimelineComponent, MatIconTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: { getAuditLog } },
        { provide: DocumentLayoutService, useValue: { principalLabel } },
        // Ahead of UTC by a time that is not whole hours, so that an instant shown in UTC, or in
        // the zone the suite runs in, shows another time and, here, another day.
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0530' },
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useFactory: () => auditDelay },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    timeline: RecordTimelineEntry = TIMELINE,
    document = claim(),
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordTimelineComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('label', 'History');
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Each entry as `what · who · when`, each part's own text. */
  const lines = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.record-timeline__entry')].map((item) =>
      ['.record-timeline__what', '.record-timeline__who', '.record-timeline__when']
        .map((part) => item.querySelector(part)?.textContent?.replace(/\s+/g, ' ').trim())
        .join(' · '),
    );
  const button = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );

  it("asks the audit for the file's kinds of event, newest first, a page of the file's size", async () => {
    await render();
    expect(getAuditLog).toHaveBeenCalledTimes(1);
    expect(getAuditLog).toHaveBeenCalledWith('c1', 20, 0, {
      eventIds: ['documentCreated', 'documentModified', 'lifecycle_transition_event'],
      sortBy: 'eventDate',
      sortOrder: 'desc',
    });
  });

  it("says who, by name, what, and when in the reader's zone, with a transition's two states", async () => {
    const root = await render();
    expect(lines(root)).toEqual([
      'State changed from Project to Approved · Jane Doe · Nov 24, 2026, 1:30:00 AM',
      'Modified · system · Nov 22, 2026, 2:30:00 PM',
      'Created · Ann Smith · Nov 21, 2026, 2:30:00 PM',
    ]);
    expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-23T20:00:00.000Z');
    expect(root.querySelector('ol')?.getAttribute('aria-label')).toBe('History');
    // Nuxeo's own account is no user to look up.
    expect(principalLabel.mock.calls.map(([, id]) => id).sort()).toEqual(['asmith', 'jdoe']);
  });

  it("shows the audit's own comment, and writes out an event the catalogue does not label", async () => {
    getAuditLog.mockReturnValue(
      of(
        page([
          entry('claimEscalated', '2026-11-23T08:00:00.000Z', 'open', {
            comment: 'Over the adjuster limit',
          }),
        ]),
      ),
    );
    const root = await render({ ...TIMELINE, events: ['claimEscalated'] });
    expect(root.querySelector('.record-timeline__what')?.textContent?.trim()).toBe(
      'Claim escalated',
    );
    expect(root.querySelector('.record-timeline__comment')?.textContent?.trim()).toBe(
      'Over the adjuster limit',
    );
  });

  describe('Show more', () => {
    it('asks for the next page and adds its entries, each once, until there is none', async () => {
      const [transition, modified, created] = transitioned();
      getAuditLog.mockReturnValueOnce(of(page([transition], true)));
      const root = await render({ ...TIMELINE, pageSize: 1 });
      // The state it left is on the next page, still to load.
      expect(lines(root)).toEqual([
        'State changed to Approved · Jane Doe · Nov 24, 2026, 1:30:00 AM',
      ]);

      // An entry recorded in between pushes the first one onto the second page as well.
      getAuditLog.mockReturnValueOnce(of(page([transition, modified], true)));
      button(root, 'Show more')?.click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 1, 1, expect.anything());
      expect(lines(root)[0]).toBe(
        'State changed from Project to Approved · Jane Doe · Nov 24, 2026, 1:30:00 AM',
      );
      expect(lines(root)).toHaveLength(2);

      getAuditLog.mockReturnValueOnce(of(page([created], false)));
      button(root, 'Show more')?.click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 1, 2, expect.anything());
      expect(lines(root)).toHaveLength(3);
      expect(button(root, 'Show more')).toBeUndefined();
    });

    it('keeps the entries when a later page fails, says so, and asks for it again', async () => {
      getAuditLog.mockReturnValueOnce(of(page(transitioned().slice(0, 1), true)));
      const root = await render({ ...TIMELINE, pageSize: 1 });
      getAuditLog.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      button(root, 'Show more')?.click();
      await settle();
      expect(lines(root)).toHaveLength(1);
      expect(root.querySelector('[role="status"]')?.textContent?.trim()).toBe(
        'The next entries could not be loaded. Try Show more again.',
      );

      getAuditLog.mockReturnValueOnce(of(page(transitioned().slice(1), false)));
      button(root, 'Show more')?.click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 1, 1, expect.anything());
      expect(lines(root)).toHaveLength(3);
      expect(root.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
    });
  });

  describe('the filter by kind of event', () => {
    const options = (): HTMLElement[] => [
      ...document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option'),
    ];

    it('is offered only when the file asks for it and names more than one kind', async () => {
      expect((await render()).querySelector('mat-select')).toBeNull();
      expect(
        (await render({ ...TIMELINE, filter: true, events: ['documentModified'] })).querySelector(
          'mat-select',
        ),
      ).toBeNull();
      expect(
        (await render({ ...TIMELINE, filter: true })).querySelector('mat-select'),
      ).not.toBeNull();
    });

    it('asks the server for the chosen kind only, from the first page, and for all of them again', async () => {
      const root = await render({ ...TIMELINE, filter: true });
      root.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
      await settle();
      expect(options().map((option) => option.textContent?.trim())).toEqual([
        'All events',
        'Created',
        'Modified',
        'State changed',
      ]);

      getAuditLog.mockReturnValueOnce(of(page([])));
      options()[3].click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 20, 0, {
        eventIds: ['lifecycle_transition_event'],
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
      expect(root.querySelector('nxs-empty-state')?.textContent).toContain(
        'Nothing of this kind recorded',
      );

      root.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
      await settle();
      options()[0].click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 20, 0, {
        eventIds: TIMELINE.events,
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
      expect(lines(root)).toHaveLength(3);
    });
  });

  it('shows the empty state when nothing of its kinds is recorded', async () => {
    getAuditLog.mockReturnValue(of(page([])));
    const root = await render();
    expect(root.querySelector('nxs-empty-state')?.textContent).toContain('Nothing recorded yet');
    expect(root.querySelector('ol')).toBeNull();
  });

  it('shows the error state when the audit fails, and asks again on retry', async () => {
    getAuditLog.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    const root = await render();
    expect(root.querySelector('nxs-error-state')?.textContent).toContain(
      'The history could not be loaded',
    );
    root.querySelector<HTMLButtonElement>('nxs-error-state button')?.click();
    await settle();
    expect(getAuditLog).toHaveBeenCalledTimes(2);
    expect(lines(root)).toHaveLength(3);
  });

  describe('when the record changes', () => {
    const [transition, modified, created] = transitioned();

    beforeEach(() => {
      auditDelay = AUDIT_DELAY;
    });

    it('asks once more when drawn anew, as its host may have drawn it for the change', async () => {
      getAuditLog.mockReturnValueOnce(of(page([modified, created])));
      getAuditLog.mockReturnValueOnce(of(page([transition, modified, created])));
      const root = await render();
      expect(getAuditLog).toHaveBeenCalledTimes(2);
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual([
        'State changed from Project to Approved',
        'Modified',
        'Created',
      ]);
    });

    it("puts what the second ask finds in the audit's order, an older entry under a newer", async () => {
      // The audit indexed the transition before the modification that preceded it.
      getAuditLog.mockReturnValueOnce(of(page([transition, created])));
      getAuditLog.mockReturnValueOnce(of(page([transition, modified, created])));
      const root = await render();
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual([
        'State changed from Project to Approved',
        'Modified',
        'Created',
      ]);
    });

    it('starts again from what a refresh finds, when more was recorded than a page holds', async () => {
      const e4 = entry('documentModified', '2026-11-23T21:00:00.000Z', 'approved', { id: 500 });
      getAuditLog.mockReturnValueOnce(of(page([modified], true)));
      getAuditLog.mockReturnValueOnce(of(page([modified], true)));
      const root = await render({ ...TIMELINE, pageSize: 1 });
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual(['Modified']);

      // Two entries were recorded since, a transition and then e4: the refresh's one-entry page
      // shares nothing with what is shown, so it takes its place, and the transition is not
      // skipped but is the next page.
      getAuditLog.mockReturnValue(of(page([e4], true)));
      fixture.componentRef.setInput('document', claim({ state: 'closed' }));
      await settle();
      expect(lines(root)).toEqual(['Modified · Jane Doe · Nov 24, 2026, 2:30:00 AM']);
      getAuditLog.mockReturnValueOnce(of(page([transition], true)));
      button(root, 'Show more')?.click();
      await settle();
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 1, 1, expect.anything());
      getAuditLog.mockReturnValueOnce(of(page([modified], false)));
      button(root, 'Show more')?.click();
      await settle();
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual([
        'Modified',
        'State changed from Project to Approved',
        'Modified',
      ]);
    });

    it('offers "Show more" when the second ask finds a full page where the first found none', async () => {
      getAuditLog.mockReturnValueOnce(of(page([])));
      getAuditLog.mockReturnValueOnce(of(page([transition], true)));
      const root = await render({ ...TIMELINE, pageSize: 1 });
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual([
        'State changed to Approved',
      ]);
      expect(button(root, 'Show more')).toBeDefined();
    });

    it('does not ask twice for another kind chosen in the filter: the record is the same', async () => {
      const root = await render({ ...TIMELINE, filter: true });
      const calls = getAuditLog.mock.calls.length;
      root.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
      await settle();
      document.querySelectorAll<HTMLElement>('.cdk-overlay-container mat-option')[2].click();
      await settle();
      expect(getAuditLog.mock.calls.length).toBe(calls + 1);
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 20, 0, {
        eventIds: ['documentModified'],
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
    });

    it('is refreshed in place, and again once the audit has written the change', async () => {
      getAuditLog.mockReturnValue(of(page([modified, created])));
      const root = await render();
      fixture.componentRef.setInput('document', claim());
      await settle();
      // Drawn: asked, and once more after the delay. An equal copy of the record asks nothing.
      expect(getAuditLog).toHaveBeenCalledTimes(2);

      // The host hands over the record reloaded after a transition. Nuxeo writes the audit a
      // moment later, so the first answer has nothing new, and the second has the transition.
      getAuditLog.mockReturnValueOnce(of(page([modified, created])));
      getAuditLog.mockReturnValueOnce(of(page([transition, modified, created])));
      fixture.componentRef.setInput('document', claim({ state: 'closed' }));
      fixture.detectChanges();
      expect(getAuditLog).toHaveBeenCalledTimes(3);
      // In place: the entries stay on screen, with no spinner in their stead.
      expect(root.querySelector('nxs-spinner')).toBeNull();
      expect(lines(root)).toHaveLength(2);

      // The test zone waits for the second refresh's timer.
      await settle();
      expect(getAuditLog).toHaveBeenCalledTimes(4);
      expect(getAuditLog).toHaveBeenLastCalledWith('c1', 20, 0, expect.anything());
      expect(lines(root)[0]).toBe(
        'State changed from Project to Approved · Jane Doe · Nov 24, 2026, 1:30:00 AM',
      );
      expect(lines(root)).toHaveLength(3);
    });

    it('keeps the pages "Show more" loaded, adding the new entries on top', async () => {
      const earlier = entry('documentModified', '2026-11-21T12:00:00.000Z', 'project', { id: 501 });
      getAuditLog.mockReturnValueOnce(of(page([modified, earlier], true)));
      // Its second ask, after the delay, finds nothing new.
      getAuditLog.mockReturnValueOnce(of(page([modified, earlier], true)));
      const root = await render({ ...TIMELINE, pageSize: 2 });
      getAuditLog.mockReturnValueOnce(of(page([created], false)));
      button(root, 'Show more')?.click();
      await settle();
      expect(lines(root)).toHaveLength(3);

      // The refresh's page shares an entry with those shown: what it adds goes on top.
      getAuditLog.mockReturnValue(of(page([transition, modified], true)));
      fixture.componentRef.setInput('document', claim({ state: 'closed' }));
      await settle();
      expect(lines(root).map((line) => line.split(' · ')[0])).toEqual([
        'State changed from Project to Approved',
        'Modified',
        'Modified',
        'Created',
      ]);
    });

    it('is refreshed in place when the page says documents changed, as after an operation button', async () => {
      getAuditLog.mockReturnValue(of(page([modified, created])));
      const root = await render();
      const calls = getAuditLog.mock.calls.length;
      // The record is the same: an action that recorded a request changed nothing the revision reads.
      getAuditLog.mockReturnValue(of(page([transition, modified, created])));
      TestBed.inject(DocumentChangesService).notify();
      fixture.detectChanges();
      expect(getAuditLog.mock.calls.length).toBe(calls + 1);
      expect(root.querySelector('nxs-spinner')).toBeNull();
      // And once more after the audit's delay, which a notification from outside the page's own
      // change detection leaves to be waited out.
      await new Promise((resolve) => setTimeout(resolve, AUDIT_DELAY * 3));
      await settle();
      expect(getAuditLog.mock.calls.length).toBe(calls + 2);
      expect(lines(root)).toHaveLength(3);
    });

    it('is refreshed for a lock, a check-in and the trash, and not for an equal copy', async () => {
      await render();
      for (const change of [
        { lockOwner: 'jdoe' },
        { lockOwner: 'jdoe', isCheckedOut: false },
        { lockOwner: 'jdoe', isCheckedOut: false, isTrashed: true },
      ]) {
        const calls = getAuditLog.mock.calls.length;
        fixture.componentRef.setInput('document', claim(change));
        await settle();
        // Once at once, and once after the audit's delay.
        expect(getAuditLog.mock.calls.length).toBe(calls + 2);
        fixture.componentRef.setInput('document', claim(change));
        await settle();
        expect(getAuditLog.mock.calls.length).toBe(calls + 2);
      }
    });

    it('starts again, from a spinner, for another record', async () => {
      const root = await render();
      getAuditLog.mockReturnValueOnce(new Subject<AuditLogList>());
      fixture.componentRef.setInput('document', claim({ uid: 'c2' }));
      await settle();
      expect(root.querySelector('nxs-spinner')).not.toBeNull();
      expect(lines(root)).toEqual([]);
      expect(getAuditLog).toHaveBeenLastCalledWith('c2', 20, 0, expect.anything());
    });
  });

  it('moves the focus to the first entry "Show more" adds', async () => {
    const [transition, modified, created] = transitioned();
    getAuditLog.mockReturnValueOnce(of(page([transition], true)));
    const root = await render({ ...TIMELINE, pageSize: 1 });
    document.body.appendChild(root);
    const more = button(root, 'Show more');
    more?.focus();
    getAuditLog.mockReturnValueOnce(of(page([modified, created], false)));
    more?.click();
    await settle();
    expect(document.activeElement?.getAttribute('data-entry-id')).toBe(String(modified.id));
    root.remove();
  });

  it('leaves the focus where the reader moved it while the next page loaded', async () => {
    const [transition, modified] = transitioned();
    getAuditLog.mockReturnValueOnce(of(page([transition], true)));
    const root = await render({ ...TIMELINE, pageSize: 1 });
    document.body.appendChild(root);
    const elsewhere = document.createElement('textarea');
    document.body.appendChild(elsewhere);
    const late = new Subject<AuditLogList>();
    getAuditLog.mockReturnValueOnce(late);
    button(root, 'Show more')?.click();
    fixture.detectChanges();
    elsewhere.focus();
    late.next(page([modified], false));
    late.complete();
    await settle();
    expect(lines(root)).toHaveLength(2);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
    root.remove();
  });

  it('keeps the names it has read while it reads a new one', async () => {
    const [transition, , created] = transitioned();
    const later = new Subject<string | null>();
    principalLabel.mockImplementation((kind: string, id: string) =>
      id === 'jdoe' ? of('Jane Doe') : later,
    );
    getAuditLog.mockReturnValueOnce(of(page([transition], true)));
    const root = await render({ ...TIMELINE, pageSize: 1 });
    expect(lines(root)[0]).toContain('Jane Doe');
    getAuditLog.mockReturnValueOnce(of(page([created], false)));
    button(root, 'Show more')?.click();
    await settle();
    expect(lines(root)).toEqual([
      'State changed from Project to Approved · Jane Doe · Nov 24, 2026, 1:30:00 AM',
      'Created · asmith · Nov 21, 2026, 2:30:00 PM',
    ]);
    later.next('Ann Smith');
    later.complete();
    await settle();
    expect(lines(root)[1]).toBe('Created · Ann Smith · Nov 21, 2026, 2:30:00 PM');
  });

  it('drops a page still on its way when the record changes, and never shows the last one', async () => {
    const late = new Subject<AuditLogList>();
    getAuditLog.mockReturnValueOnce(late);
    const root = await render();
    getAuditLog.mockReturnValueOnce(
      of(page([entry('documentCreated', '2026-11-20T09:00:00.000Z', 'project', { id: 502 })])),
    );
    fixture.componentRef.setInput('document', claim({ uid: 'c2' }));
    await settle();
    late.next(page(transitioned()));
    await settle();
    expect(lines(root)).toEqual(['Created · Jane Doe · Nov 20, 2026, 2:30:00 PM']);
  });
});
