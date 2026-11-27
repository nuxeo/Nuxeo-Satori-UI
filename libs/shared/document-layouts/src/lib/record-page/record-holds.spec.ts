import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ExtensionRuleContextService } from '@nuxeo/satori-platform/extensions';
import {
  type AuditEntry,
  type AuditLogList,
  type AuditLogQuery,
  DocumentChangesService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { type Observable, of, throwError } from 'rxjs';

import { AppActionsService, type AppCardAction } from '../app-actions/app-actions.service';
import { DocumentLayoutService } from '../document-layout.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import { HOLD_EVENTS, RecordHoldsComponent, retentionOf } from './record-holds';
import type { RecordHoldsEntry } from './record-layout';
import { LinkedRecordLookup } from './record-lookups';

const RULE = '6f1c2a90-5b1e-4c3d-9a7e-000000000001';

/** A dispute, its permissions those a records manager holds on it. */
const dispute = (
  top: Record<string, unknown> = {},
  properties: Record<string, unknown> = {},
  permissions: string[] = ['Read', 'Write', 'ManageLegalHold'],
): NuxeoDocument =>
  ({
    uid: 'd1',
    title: 'DSP-2002 Card not received',
    type: 'DisputeCase',
    path: '/disputes/DSP-2002',
    lastModified: '2026-11-23T10:00:00.000Z',
    isRecord: false,
    retainUntil: null,
    hasLegalHold: false,
    isUnderRetentionOrLegalHold: false,
    properties: { 'dsp:number': 'DSP-2002', ...properties },
    contextParameters: { permissions },
    ...top,
  }) as unknown as NuxeoDocument;

const held = (more: Record<string, unknown> = {}) =>
  dispute(
    {
      isRecord: true,
      hasLegalHold: true,
      isUnderRetentionOrLegalHold: true,
      retainUntil: '2033-03-12T00:00:00.000Z',
      ...more,
    },
    { 'record:ruleIds': [RULE] },
  );

let nextId = 500;
const entry = (
  eventId: string,
  eventDate: string,
  comment: string | null,
  principalName = 'rlee',
) =>
  ({
    'entity-type': 'logEntry',
    id: nextId++,
    category: 'eventDocumentCategory',
    principalName,
    docPath: '/disputes/DSP-2002',
    docType: 'DisputeCase',
    docUUID: 'd1',
    eventId,
    repositoryId: 'default',
    eventDate,
    docLifeCycle: 'project',
    comment,
  }) as unknown as AuditEntry;

const page = (entries: AuditEntry[]): AuditLogList =>
  ({ 'entity-type': 'logEntries', entries, isNextPageAvailable: false }) as unknown as AuditLogList;

const HOLDS: RecordHoldsEntry = {
  place: 'onboarding.dispute.placeHold',
  release: 'onboarding.dispute.releaseHold',
  pageSize: 10,
};

describe('RecordHoldsComponent', () => {
  let fixture: ComponentFixture<RecordHoldsComponent>;
  let getAuditLog: ReturnType<
    typeof vi.fn<
      (uid: string, size: number, index: number, query: AuditLogQuery) => Observable<AuditLogList>
    >
  >;
  let cardAction: ReturnType<typeof vi.fn<(id: string) => AppCardAction | null>>;
  let runOnCard: ReturnType<typeof vi.fn>;
  let records: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nextId = 500;
    getAuditLog = vi.fn(() =>
      of(
        page([
          entry(
            'afterSetLegalHold',
            '2026-11-24T09:30:00.000Z',
            'Chargeback dispute with the card scheme',
          ),
          entry('afterRemoveLegalHold', '2026-11-20T08:00:00.000Z', 'Settled', 'jdoe'),
          entry('afterSetLegalHold', '2026-11-18T08:00:00.000Z', null, 'jdoe'),
        ]),
      ),
    );
    cardAction = vi.fn((id: string) =>
      id === HOLDS.place
        ? { id, label: 'Place legal hold', icon: null, enabled: true }
        : id === HOLDS.release
          ? { id, label: 'Release legal hold', icon: null, enabled: true }
          : null,
    );
    runOnCard = vi.fn();
    records = vi.fn(() =>
      of(new Map([[RULE, { title: 'Disputes seven years', url: `/doc/${RULE}` }]])),
    );
    TestBed.configureTestingModule({
      imports: [RecordHoldsComponent, MatIconTestingModule],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: DocumentDetailService, useValue: { getAuditLog } },
        {
          provide: DocumentLayoutService,
          useValue: {
            principalLabel: (kind: string, id: string) =>
              of(id === 'rlee' ? 'Robin Lee' : id === 'jdoe' ? 'Jane Doe' : null),
          },
        },
        { provide: LinkedRecordLookup, useValue: { records } },
        { provide: AppActionsService, useValue: { cardAction, runOnCard } },
        { provide: ExtensionRuleContextService, useValue: { context: () => ({}) } },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0530' },
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useValue: null },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    document: NuxeoDocument = held(),
    holds: RecordHoldsEntry = HOLDS,
    readOnly = false,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordHoldsComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('holds', holds);
    fixture.componentRef.setInput('label', 'Legal holds');
    fixture.componentRef.setInput('cardId', 'holds');
    fixture.componentRef.setInput('readOnly', readOnly);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const fact = (root: HTMLElement, name: string): string | null =>
    root.querySelector(`[data-fact="${name}"] dd`)?.textContent?.replace(/\s+/g, ' ').trim() ??
    null;

  const lines = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.record-holds__entry')].map((item) =>
      ['.record-holds__what', '.record-holds__who', '.record-holds__when', '.record-holds__reason']
        .map((part) => item.querySelector(part)?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .join(' · '),
    );

  const button = (root: HTMLElement): HTMLButtonElement | null =>
    root.querySelector('.record-holds__actions button');

  async function wcag22(root: HTMLElement): Promise<axe.Result[]> {
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations;
  }

  describe('what the platform keeps', () => {
    it("reads the record's retention and hold from the document as the server answers it", () => {
      expect(retentionOf(held())).toEqual({
        record: true,
        until: new Date('2033-03-12T00:00:00.000Z'),
        indeterminate: false,
        ended: null,
        held: true,
        rule: RULE,
      });
      expect(retentionOf(dispute())).toMatchObject({ record: false, until: null, held: false });
      // A text that is no date is no retention, not an Invalid Date shown to the reader.
      expect(retentionOf(dispute({ retainUntil: 'soon' })).until).toBeNull();
    });

    it("shows the retention until its day, in the reader's zone, its rule by title, and the hold", async () => {
      const root = await render();
      expect(fact(root, 'retention')).toBe('Retained until March 12, 2033');
      expect(fact(root, 'rule')).toBe('Disputes seven years');
      expect(
        root.querySelector<HTMLAnchorElement>('[data-fact="rule"] a')?.getAttribute('href'),
      ).toBe(`/doc/${RULE}`);
      expect(records).toHaveBeenCalledWith([RULE]);
      expect(fact(root, 'hold')).toBe('On legal hold');
    });

    it('says when a retention waits for an event, ended, is none set, or there is none', async () => {
      expect(
        fact(await render(held({ retainUntil: '9999-12-31T23:59:59.999Z' })), 'retention'),
      ).toBe('Retained until an event ends it');
      fixture.destroy();
      const ended = dispute({ isRecord: true }, { 'record:retainUntil': '2026-11-01' });
      expect(fact(await render(ended), 'retention')).toBe('Retention ended on November 1, 2026');
      fixture.destroy();
      expect(fact(await render(dispute({ isRecord: true })), 'retention')).toBe(
        'A record, with no retention set',
      );
      fixture.destroy();
      const root = await render(dispute());
      expect(fact(root, 'retention')).toBe('Not under retention');
      expect(fact(root, 'rule')).toBeNull();
      expect(fact(root, 'hold')).toBe('None');
    });

    it('shows a rule the reader may not read as unavailable, never its id', async () => {
      records.mockReturnValue(of(new Map([[RULE, null]])));
      const root = await render();
      expect(fact(root, 'rule')).toBe('Unavailable');
      expect(root.textContent).not.toContain(RULE);
    });
  });

  describe('the holds placed and released', () => {
    it('asks the audit for the two hold events only, newest first, as many as the card shows', async () => {
      await render(held(), { ...HOLDS, pageSize: 5 });
      expect(getAuditLog).toHaveBeenCalledWith('d1', 5, 0, {
        eventIds: HOLD_EVENTS,
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
      expect(HOLD_EVENTS).toEqual(['afterSetLegalHold', 'afterRemoveLegalHold']);
    });

    it("lists each with who by name, when in the reader's zone, and the reason given", async () => {
      const root = await render();
      expect(lines(root)).toEqual([
        'Legal hold placed · Robin Lee · Nov 24, 2026, 3:00:00 PM · Reason: Chargeback dispute with the card scheme',
        'Legal hold released · Jane Doe · Nov 20, 2026, 1:30:00 PM · Reason: Settled',
        'Legal hold placed · Jane Doe · Nov 18, 2026, 1:30:00 PM · ',
      ]);
      expect(root.querySelector('ol')?.getAttribute('aria-label')).toBe('Legal holds');
    });

    it('says so when no hold was ever placed, and shows an error the reader can retry', async () => {
      getAuditLog.mockReturnValue(of(page([])));
      const root = await render(dispute());
      expect(root.querySelector('.record-holds__empty')?.textContent?.trim()).toBe(
        'No legal hold has been placed on this record.',
      );
      fixture.destroy();
      getAuditLog.mockReturnValue(throwError(() => ({ status: 500 })));
      const failed = await render();
      expect(failed.querySelector('nxs-error-state')).not.toBeNull();
      expect(failed.textContent).toContain('The legal holds could not be read');
    });

    it('asks again when the hold changes on the record, and when the page says records changed', async () => {
      await render(dispute());
      expect(getAuditLog).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput('document', held());
      await settle();
      expect(getAuditLog).toHaveBeenCalledTimes(2);
      TestBed.inject(DocumentChangesService).notify();
      await settle();
      expect(getAuditLog).toHaveBeenCalledTimes(3);
      // The same record given again, unchanged, asks nothing.
      fixture.componentRef.setInput('document', held());
      await settle();
      expect(getAuditLog).toHaveBeenCalledTimes(3);
    });
  });

  describe('placing and releasing', () => {
    it('offers Release while the record is held, and runs that action on the card', async () => {
      const root = await render();
      expect(button(root)?.textContent?.trim()).toBe('Release legal hold');
      expect(cardAction).toHaveBeenCalledWith(
        HOLDS.release,
        expect.objectContaining({ document: expect.objectContaining({ uid: 'd1' }) }),
      );
      button(root)?.click();
      expect(runOnCard).toHaveBeenCalledWith(
        HOLDS.release,
        expect.objectContaining({ document: expect.objectContaining({ uid: 'd1' }) }),
      );
    });

    it('offers Place while it is not, and nothing the file does not name', async () => {
      const root = await render(dispute());
      expect(button(root)?.textContent?.trim()).toBe('Place legal hold');
      fixture.destroy();
      expect(button(await render(dispute(), { ...HOLDS, place: null }))).toBeNull();
    });

    it('offers nothing the app registry did not serve, nor whose rule does not pass', async () => {
      cardAction.mockReturnValue(null);
      expect(button(await render())).toBeNull();
    });

    it('shows an action whose enabled rule does not pass, and runs nothing from it', async () => {
      cardAction.mockReturnValue({
        id: HOLDS.release ?? '',
        label: 'Release legal hold',
        icon: null,
        enabled: false,
      });
      const root = await render();
      expect(button(root)?.disabled).toBe(true);
      button(root)?.click();
      expect(runOnCard).not.toHaveBeenCalled();
    });

    it('offers nothing to someone the record does not let manage its hold, nor on a version, in the trash or read-only', async () => {
      expect(button(await render(dispute({}, {}, ['Read', 'Write'])))).toBeNull();
      fixture.destroy();
      // A record that came without its permissions offers nothing either.
      expect(button(await render(dispute({ contextParameters: {} })))).toBeNull();
      fixture.destroy();
      expect(button(await render(held({ isVersion: true })))).toBeNull();
      fixture.destroy();
      expect(button(await render(held({ isTrashed: true })))).toBeNull();
      fixture.destroy();
      expect(button(await render(held(), HOLDS, true))).toBeNull();
      expect(cardAction).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe at WCAG 2.2 AA, held with its holds, and with none', async () => {
      const root = await render();
      expect(await wcag22(root)).toEqual([]);
      // The facts are a description list, the holds an ordered list under their own heading.
      expect(root.querySelector('dl')).not.toBeNull();
      expect(root.querySelector('h4')?.textContent?.trim()).toBe('Legal holds placed and released');
      expect(root.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
        root.querySelector('h4')?.id,
      );
      fixture.destroy();
      getAuditLog.mockReturnValue(of(page([])));
      expect(await wcag22(await render(dispute()))).toEqual([]);
    });
  });
});
