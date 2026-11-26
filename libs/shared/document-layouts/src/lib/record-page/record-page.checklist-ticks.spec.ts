import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsToastService, provideNxsComponents } from '@nuxeo/satori-platform/components';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  BrowseService,
  CURRENT_USERNAME,
  DocumentChangesService,
  DocumentDetailService,
  type NuxeoDocument,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition } from '../layout.model';
import { ConnectorRecordService } from './connector-record.service';
import { RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import { readRecordLayout } from './record-layout';
import {
  RECORD_PAGE_TIME_ZONE,
  RECORD_PAGE_TODAY,
  RecordPageComponent,
  canTick,
} from './record-page';
import { resolveRecordLayout, type ResolvedRecordLayout } from './resolve-record-layout';

/**
 * Ticking a checklist's item on the record page (layout-v2.md, section 7, "A checklist"): offered
 * only where the file opts in and the record's permissions let the signed-in user change it,
 * written through the Edit form's document update, and left as it was when the write fails.
 */

const CASE_TYPE: DocumentTypeDefinition = {
  name: 'Case',
  schemas: [
    {
      name: 'case',
      prefix: 'case',
      fields: {
        number: { type: 'string' },
        checklist: {
          type: 'complex[]',
          fields: {
            item: { type: 'string' },
            done: { type: 'boolean' },
            doneBy: { type: 'string' },
            doneOn: { type: 'date' },
          },
        },
      },
    },
  ],
};

const ITEMS = [
  { id: 'appealLetter', label: 'Appeal letter received' },
  { id: 'medicalRecords', label: 'Medical records received' },
  { id: 'decisionLetter', label: 'Decision letter sent' },
];

const page = (tickable?: unknown) => ({
  version: 2,
  cards: [
    { id: 'case', label: 'Case', fields: ['case:number'] },
    {
      id: 'checklist',
      label: 'Appeal checklist',
      checklist: {
        field: 'case:checklist',
        items: ITEMS,
        ...(tickable === undefined ? {} : { tickable }),
      },
    },
  ],
});

/** What the record holds: the letter done, the medical records asked for and not received. */
const HELD = [
  { item: 'appealLetter', done: true, doneBy: 'sam.patel', doneOn: '2026-11-02T00:00:00.000Z' },
  { item: 'medicalRecords', done: false, doneBy: 'sam.patel', doneOn: '2026-11-12T00:00:00.000Z' },
  // An entry for an item the file no longer lists, which a tick keeps.
  { item: 'legacyStep', done: true, doneBy: 'riley.brooks', doneOn: '2026-10-01T00:00:00.000Z' },
];

const appeal = (
  overrides: Partial<NuxeoDocument> = {},
  permissions: readonly string[] | null = ['Read', 'ReadWrite', 'Write', 'WriteProperties'],
): NuxeoDocument =>
  ({
    uid: 'case-2041',
    title: 'Appeal of denied knee arthroscopy',
    type: 'Case',
    path: '/cases/case-2041',
    lastModified: '2026-11-20T10:00:00.000Z',
    properties: { 'case:number': 'CASE-2041', 'case:checklist': HELD },
    ...(permissions === null ? {} : { contextParameters: { permissions: [...permissions] } }),
    ...overrides,
  }) as NuxeoDocument;

describe('RecordPageComponent: ticking a checklist item', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let username: string | null;
  let writes: Subject<NuxeoDocument>[];
  let updateDocument: ReturnType<
    typeof vi.fn<(uid: string, properties: Record<string, unknown>) => Observable<NuxeoDocument>>
  >;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let notified: number;

  beforeEach(() => {
    username = 'sam.patel';
    writes = [];
    updateDocument = vi.fn(() => {
      const answer = new Subject<NuxeoDocument>();
      writes.push(answer);
      return answer.asObservable();
    });
    toast = { show: vi.fn(), error: vi.fn() };
    notified = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [RecordPageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        { provide: PageProviderService, useValue: { execute: vi.fn(() => new Subject()) } },
        { provide: ConnectorRecordService, useValue: { read: vi.fn(() => new Subject()) } },
        { provide: DocumentDetailService, useValue: { getAuditLog: vi.fn(() => new Subject()) } },
        { provide: BrowseService, useValue: { updateDocument } },
        { provide: CURRENT_USERNAME, useValue: () => username },
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: () => of(null),
            principalLabel: (kind: string, id: string) =>
              of(
                kind !== 'user'
                  ? null
                  : id === 'sam.patel'
                    ? 'Sam Patel'
                    : id === 'riley.brooks'
                      ? 'Riley Brooks'
                      : null,
              ),
            rowPropertiesOf: () => of(new Map()),
            linkedRecords: () => of(new Map()),
          },
        },
        // 20:00 UTC on 25 November: already the 26th where the page shows its days, at +13:00.
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-25T20:00:00.000Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+1300' },
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useValue: null },
      ],
    });
    // The page lists the toast among its own providers, which only an override reaches.
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    TestBed.inject(DocumentChangesService).changes.subscribe(() => notified++);
  });

  afterEach(() => vi.restoreAllMocks());

  function layoutOf(content: Record<string, unknown>): ResolvedRecordLayout {
    const read = readRecordLayout(content, {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    if ('invalid' in read) throw new Error(read.invalid);
    return resolveRecordLayout(CASE_TYPE, read).layout;
  }

  async function render(
    document = appeal(),
    content: Record<string, unknown> = page(true),
    readOnly = false,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordPageComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('layout', layoutOf(content));
    if (readOnly) fixture.componentRef.setInput('readOnly', true);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const boxes = (): HTMLInputElement[] => [
    ...root().querySelectorAll<HTMLInputElement>(
      '[data-card-id="checklist"] input[type="checkbox"]',
    ),
  ];
  const box = (item: string): HTMLInputElement => {
    const input = root().querySelector<HTMLInputElement>(
      `[data-card-id="checklist"] li[data-item="${item}"] input[type="checkbox"]`,
    );
    if (!input) throw new Error(`no tick box for ${item}`);
    return input;
  };
  const row = (item: string): HTMLElement =>
    root().querySelector<HTMLElement>(`[data-card-id="checklist"] li[data-item="${item}"]`)!;
  const part = (item: string, name: string): string | null =>
    row(item).querySelector(`.record-page__checklist-${name}`)?.textContent?.trim() ?? null;
  /** A box's accessible name: the text of the label its native box is labelled by. */
  const nameOf = (input: HTMLInputElement): string =>
    [...(input.labels ?? [])].map((label) => label.textContent?.trim() ?? '').join(' ');
  /** A box's description: the text of the elements its `aria-describedby` names. */
  const descriptionOf = (input: HTMLInputElement): string =>
    (input.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .join(' ');

  describe('who is offered a tick box', () => {
    it("offers one per item where the file opts in and the record's permissions allow a write", async () => {
      await render();
      expect(boxes().map((input) => nameOf(input))).toEqual(ITEMS.map((item) => item.label));
      expect(boxes().map((input) => input.checked)).toEqual([true, false, false]);
      // The read-only card's icon gives way to the box.
      expect(root().querySelector('[data-card-id="checklist"] nxs-icon')).toBeNull();
    });

    it('offers none on a record whose permissions do not allow a write, or that came without them', async () => {
      for (const permissions of [['Read'], ['Read', 'ReadCanCollect', 'Comment'], [], null]) {
        await render(appeal({}, permissions));
        expect(boxes()).toEqual([]);
        // It is still the read-only card, every item drawn.
        expect(root().querySelectorAll('[data-card-id="checklist"] li')).toHaveLength(3);
        expect(root().querySelectorAll('[data-card-id="checklist"] nxs-icon')).toHaveLength(3);
      }
      // WriteProperties alone is enough, as for the Edit button.
      await render(appeal({}, ['Read', 'WriteProperties']));
      expect(boxes()).toHaveLength(3);
    });

    it('offers none where the file does not opt in, which every card written before did not', async () => {
      for (const content of [page(), page(false)]) {
        await render(appeal(), content);
        expect(boxes()).toEqual([]);
      }
    });

    it('offers none on a read-only page, a version, a record in the trash, or with no one signed in', async () => {
      await render(appeal(), page(true), true);
      expect(boxes()).toEqual([]);
      await render(appeal({ isVersion: true }));
      expect(boxes()).toEqual([]);
      await render(appeal({ isTrashed: true }));
      expect(boxes()).toEqual([]);
      username = null;
      await render();
      expect(boxes()).toEqual([]);
    });

    it('reads write permission as the other editable surfaces do', () => {
      expect(canTick(appeal())).toBe(true);
      expect(canTick(appeal({}, ['Read', 'Write']))).toBe(true);
      expect(canTick(appeal({}, ['Read']))).toBe(false);
      expect(canTick(appeal({}, null))).toBe(false);
      expect(canTick(appeal({ isVersion: true }))).toBe(false);
      expect(canTick(appeal({ isTrashed: true }))).toBe(false);
    });
  });

  describe('ticking and unticking', () => {
    it('ticks an item: its entry written done, by the signed-in user, now, through the document update', async () => {
      await render();
      box('medicalRecords').click();
      await settle();

      expect(updateDocument).toHaveBeenCalledTimes(1);
      expect(updateDocument).toHaveBeenCalledWith('case-2041', {
        'case:checklist': [
          HELD[0],
          {
            item: 'medicalRecords',
            done: true,
            doneBy: 'sam.patel',
            doneOn: '2026-11-25T20:00:00.000Z',
          },
          HELD[2],
        ],
      });
      // While it is written: the box shows what was asked, the item what the record holds.
      expect(box('medicalRecords').checked).toBe(true);
      expect(part('medicalRecords', 'state')).toBe('Not done');
      expect(notified).toBe(0);

      const written = (updateDocument.mock.calls[0][1] as Record<string, unknown>)[
        'case:checklist'
      ];
      writes[0].next(appeal({ properties: { 'case:checklist': written } }, null));
      writes[0].complete();
      await settle();

      // The server's answer is shown, and the record is asked for again.
      expect(notified).toBe(1);
      expect(box('medicalRecords').checked).toBe(true);
      expect(part('medicalRecords', 'state')).toBe('Done');
      expect(part('medicalRecords', 'by')).toBe('Sam Patel');
      // An instant, shown on the reader's day: at +13:00 it is already the 26th.
      expect(part('medicalRecords', 'on')).toBe('November 26, 2026');
      expect(
        root()
          .querySelector('[data-card-id="checklist"] .record-page__checklist-count')
          ?.textContent?.trim(),
      ).toBe('2 of 3 done');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('unticks an item by keeping its entry with done false, and shows it not done', async () => {
      await render();
      box('appealLetter').click();
      await settle();
      const sent = (updateDocument.mock.calls[0][1] as Record<string, unknown>)['case:checklist'];
      expect(sent).toEqual([
        {
          item: 'appealLetter',
          done: false,
          doneBy: 'sam.patel',
          doneOn: '2026-11-02T00:00:00.000Z',
        },
        HELD[1],
        HELD[2],
      ]);
      expect(box('appealLetter').checked).toBe(false);

      writes[0].next(appeal({ properties: { 'case:checklist': sent } }, null));
      await settle();
      expect(box('appealLetter').checked).toBe(false);
      expect(part('appealLetter', 'state')).toBe('Not done');
      expect(part('appealLetter', 'by')).toBeNull();
      expect(part('appealLetter', 'on')).toBeNull();
      expect(notified).toBe(1);
    });

    it('starts a second tick from the first, before the record is read again', async () => {
      await render();
      box('medicalRecords').click();
      await settle();
      const first = (updateDocument.mock.calls[0][1] as Record<string, unknown>)['case:checklist'];
      writes[0].next(appeal({ properties: { 'case:checklist': first } }, null));
      await settle();

      box('decisionLetter').click();
      await settle();
      expect(
        (updateDocument.mock.calls[1][1] as Record<string, unknown>)['case:checklist'],
      ).toEqual([
        HELD[0],
        expect.objectContaining({ item: 'medicalRecords', done: true }),
        HELD[2],
        {
          item: 'decisionLetter',
          done: true,
          doneBy: 'sam.patel',
          doneOn: '2026-11-25T20:00:00.000Z',
        },
      ]);
    });

    it('shows the record it is given again once it is read anew, whatever it last wrote', async () => {
      await render();
      box('medicalRecords').click();
      await settle();
      writes[0].next(
        appeal({ properties: { 'case:checklist': [{ item: 'medicalRecords', done: true }] } }),
      );
      await settle();
      expect(box('medicalRecords').checked).toBe(true);

      // The record read again, as someone else left it since: the page follows the record.
      fixture.componentRef.setInput(
        'document',
        appeal({ properties: { 'case:number': 'CASE-2041', 'case:checklist': [] } }),
      );
      await settle();
      expect(boxes().map((input) => input.checked)).toEqual([false, false, false]);
    });

    it('writes one tick at a time: every box asks nothing while one is written', async () => {
      await render();
      box('medicalRecords').click();
      await settle();
      box('decisionLetter').click();
      box('medicalRecords').click();
      await settle();
      expect(updateDocument).toHaveBeenCalledTimes(1);
      expect(box('decisionLetter').checked).toBe(false);
    });
  });

  describe('progress and failure', () => {
    it('shows progress on the item being written, and marks the list busy', async () => {
      await render();
      const list = root().querySelector('[data-card-id="checklist"] ul')!;
      expect(list.hasAttribute('aria-busy')).toBe(false);
      expect(root().querySelector('nxs-spinner')).toBeNull();

      box('medicalRecords').click();
      await settle();
      expect(list.getAttribute('aria-busy')).toBe('true');
      const spinner = row('medicalRecords').querySelector('nxs-spinner [role="progressbar"]');
      expect(spinner?.getAttribute('aria-label')).toBe('Saving');
      expect(root().querySelectorAll('nxs-spinner')).toHaveLength(1);
      expect(boxes().every((input) => input.getAttribute('aria-disabled') === 'true')).toBe(true);

      writes[0].error(new HttpErrorResponse({ status: 500 }));
      await settle();
      expect(list.hasAttribute('aria-busy')).toBe(false);
      expect(root().querySelector('nxs-spinner')).toBeNull();
      expect(boxes().some((input) => input.hasAttribute('aria-disabled'))).toBe(false);
    });

    it.each([
      [
        'that it may not be changed, for a 403',
        new HttpErrorResponse({ status: 403, statusText: 'Forbidden' }),
        'You do not have permission to change this checklist.',
      ],
      [
        'that it could not be saved, for anything else',
        new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }),
        'The checklist could not be saved. Try again.',
      ],
      [
        "the server's own words, for a value it refused",
        new HttpErrorResponse({
          status: 400,
          error: {
            'entity-type': 'validation_report',
            violations: [
              {
                message: 'An appeal checklist item needs a day',
                path: [{ field_name: 'case:checklist' }],
              },
            ],
          },
        }),
        'An appeal checklist item needs a day',
      ],
    ])('leaves the card as it was when the write fails, and says %s', async (_, failure, said) => {
      await render();
      const before = root().querySelector('[data-card-id="checklist"]')!.textContent;
      box('medicalRecords').click();
      await settle();
      writes[0].error(failure);
      await settle();

      expect(box('medicalRecords').checked).toBe(false);
      expect(boxes().map((input) => input.checked)).toEqual([true, false, false]);
      expect(root().querySelector('[data-card-id="checklist"]')!.textContent).toBe(before);
      expect(toast.error).toHaveBeenCalledWith(said);
      expect(notified).toBe(0);

      // And it may be ticked again, from what the record holds.
      box('medicalRecords').click();
      await settle();
      expect(updateDocument).toHaveBeenCalledTimes(2);
      expect(updateDocument.mock.calls[1]).toEqual(updateDocument.mock.calls[0]);
    });
  });

  describe('keyboard and names', () => {
    it("names each box by its item's words and describes it by its state, who and when", async () => {
      await render();
      expect(boxes().map((input) => input.type)).toEqual(['checkbox', 'checkbox', 'checkbox']);
      expect(boxes().map(nameOf)).toEqual([
        'Appeal letter received',
        'Medical records received',
        'Decision letter sent',
      ]);
      expect(descriptionOf(box('appealLetter'))).toBe('Done, Sam Patel, November 2, 2026');
      // Not done: no one and no day, whatever the entry still holds.
      expect(descriptionOf(box('medicalRecords'))).toBe('Not done');
      // The list is still named by its card's heading, through its section.
      const card = root().querySelector('[data-card-id="checklist"]')!;
      expect(card.getAttribute('aria-labelledby')).toBe('record-card-checklist');
      expect(card.querySelector('ul')?.getAttribute('role')).toBe('list');
    });

    it('is reached by Tab and ticked by Space, and keeps the focus through the write', async () => {
      await render();
      // In the tab order, each box, in the file's order.
      expect(boxes().map((input) => input.tabIndex)).toEqual([0, 0, 0]);
      expect(boxes().some((input) => input.disabled)).toBe(false);
      const medical = box('medicalRecords');
      medical.focus();
      expect(document.activeElement).toBe(medical);

      // Space on a focused checkbox is its click, as the browser dispatches it.
      medical.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      medical.click();
      medical.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      await settle();
      expect(updateDocument).toHaveBeenCalledTimes(1);
      // Disabled while written, and still focused: the box is not taken out of the tab order.
      expect(document.activeElement).toBe(medical);
      expect(medical.disabled).toBe(false);
      expect(medical.getAttribute('aria-disabled')).toBe('true');

      writes[0].next(
        appeal(
          {
            properties: {
              'case:checklist': (updateDocument.mock.calls[0][1] as Record<string, unknown>)[
                'case:checklist'
              ],
            },
          },
          null,
        ),
      );
      await settle();
      expect(document.activeElement).toBe(box('medicalRecords'));
      expect(box('medicalRecords').checked).toBe(true);
    });

    it('keeps the focus on the box when the write fails', async () => {
      await render();
      box('decisionLetter').focus();
      box('decisionLetter').click();
      await settle();
      writes[0].error(new HttpErrorResponse({ status: 500 }));
      await settle();
      expect(document.activeElement).toBe(box('decisionLetter'));
      expect(box('decisionLetter').checked).toBe(false);
    });
  });
});
