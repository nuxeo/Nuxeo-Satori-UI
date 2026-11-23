import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  type AuditEntry,
  type AuditLogList,
  type AuditLogQuery,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { RECORD_PAGE_TIME_ZONE } from './record-clock';
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

  beforeEach(() => {
    nextId = 100;
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
    expect(root.querySelector('.record-timeline__event')?.textContent?.trim()).toBe(
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

  it('asks again when the record changes, and not for an equal copy of it', async () => {
    await render();
    fixture.componentRef.setInput('document', claim());
    await settle();
    expect(getAuditLog).toHaveBeenCalledTimes(1);

    // The host reloads the record after a transition: its state is new, and so is the history.
    fixture.componentRef.setInput('document', claim({ state: 'closed' }));
    await settle();
    expect(getAuditLog).toHaveBeenCalledTimes(2);
    fixture.componentRef.setInput(
      'document',
      claim({ state: 'closed', lastModified: '2026-11-23T11:00:00.000Z' }),
    );
    await settle();
    expect(getAuditLog).toHaveBeenCalledTimes(3);
  });

  it('drops a page still on its way when the record changes, and never shows the last one', async () => {
    const late = new Subject<AuditLogList>();
    getAuditLog.mockReturnValueOnce(late);
    const root = await render();
    getAuditLog.mockReturnValueOnce(
      of(page([entry('documentCreated', '2026-11-20T09:00:00.000Z', 'project')])),
    );
    fixture.componentRef.setInput('document', claim({ uid: 'c2' }));
    await settle();
    late.next(page(transitioned()));
    await settle();
    expect(lines(root)).toEqual(['Created · Jane Doe · Nov 20, 2026, 2:30:00 PM']);
  });
});
