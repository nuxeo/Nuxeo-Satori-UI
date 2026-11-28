import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { DOCUMENT_RULE_EVALUATORS, ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  CURRENT_USERNAME,
  DocumentDetailService,
  type NuxeoDocument,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition, LayoutFieldType } from '../layout.model';
import { ConnectorRecordService } from './connector-record.service';
import type { LinkedRecord } from './linked-record';
import { RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import { readRecordLayout } from './record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY, RecordPageComponent } from './record-page';
import { resolveRecordLayout, type ResolvedRecordLayout } from './resolve-record-layout';

/**
 * The record page reading a linked record's property (layout-v2.md, sections 5 and 12): a `show`
 * drawn through a widget, and a rule deciding a banner, a card or a field by the linked record's
 * property, read as the reader through the same search a `show` reads with.
 */

const DEAL_TYPE: DocumentTypeDefinition = {
  name: 'VehicleDeal',
  schemas: [
    {
      name: 'vehicledeal',
      prefix: 'vdeal',
      fields: {
        number: { type: 'string' },
        title: { type: 'string' },
        titles: { type: 'string[]' },
        year: { type: 'long' },
      },
    },
  ],
};

const TITLE = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const OTHER = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
/** A title the reader may not read, or that no longer exists: the search does not return it. */
const HIDDEN = '0a762678-0e77-4b58-8256-e5d7bce1f55e';

/** What the titles hold, as the search returns them with the `vehicletitle` schema. */
const TITLES: Readonly<Record<string, { title: string; properties: Record<string, unknown> }>> = {
  [TITLE]: {
    title: 'Title OR-118204',
    properties: { 'vtitle:status': 'Awaiting lien release', 'vtitle:openedOn': '2026-10-01' },
  },
  [OTHER]: {
    title: 'Title WA-552910',
    properties: { 'vtitle:status': 'Issued', 'vtitle:openedOn': '2026-11-20' },
  },
};

const TITLE_PROPERTIES: Readonly<Record<string, { schema: string; definition: LayoutFieldType }>> =
  {
    'vtitle:status': { schema: 'vehicletitle', definition: { type: 'string' } },
    'vtitle:openedOn': { schema: 'vehicletitle', definition: { type: 'date' } },
    'vtitle:payoff': { schema: 'vehicletitle', definition: { type: 'double' } },
  };

const TONES = { Issued: 'positive', 'Awaiting lien release': 'warning' };

const status = { field: 'vdeal:title', types: ['VehicleTitle'], show: 'vtitle:status' };
const openedOn = { field: 'vdeal:title', types: ['VehicleTitle'], show: 'vtitle:openedOn' };

const awaitingLien = {
  type: 'app.rules.fieldIn',
  parameters: [status, 'Awaiting lien release'],
};
const overdue = {
  type: 'core.every',
  parameters: [
    { type: 'app.rules.fieldIn', parameters: [status, 'Awaiting lien release', 'In hand'] },
    { type: 'app.rules.dateAfter', parameters: ['today', openedOn, 30] },
  ],
};

/** The deal page: two banners on its title, a card shown while the lien waits, and the title. */
const DEAL_PAGE = {
  version: 2,
  banners: [
    {
      id: 'lien',
      tone: 'warning',
      label: 'Its title awaits its lien release',
      visibleWhen: awaitingLien,
    },
    { id: 'overdue', tone: 'negative', label: 'Its title is overdue', visibleWhen: overdue },
  ],
  cards: [
    {
      id: 'title',
      label: 'Title',
      fields: [
        { field: 'vdeal:title', widget: 'document-link', parameters: { types: ['VehicleTitle'] } },
        {
          id: 'titleStatus',
          field: 'vdeal:title',
          widget: 'document-link',
          parameters: {
            types: ['VehicleTitle'],
            show: { field: 'vtitle:status', widget: 'status-badge', parameters: { tones: TONES } },
          },
        },
        {
          id: 'year',
          field: 'vdeal:year',
          widget: 'number',
          parameters: { grouping: false },
        },
      ],
    },
    {
      id: 'lien-card',
      label: 'Lien',
      visibleWhen: awaitingLien,
      fields: ['vdeal:number'],
    },
  ],
};

const deal = (properties: Record<string, unknown>): NuxeoDocument =>
  ({
    uid: 'deal-5002',
    title: 'VD-5002',
    type: 'VehicleDeal',
    path: '/deals/deal-5002',
    lastModified: '2026-11-20T10:00:00.000Z',
    properties: { 'vdeal:number': 'VD-5002', 'vdeal:year': 2024, ...properties },
  }) as NuxeoDocument;

describe('RecordPageComponent: a linked record read for a show and a rule', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let warnings: string[];
  /** The linked records' search: each call is one request, with the ids and the schemas asked. */
  let linkedRecords: ReturnType<
    typeof vi.fn<
      (
        ids: readonly string[],
        schemas?: readonly string[],
      ) => Observable<ReadonlyMap<string, LinkedRecord> | null>
    >
  >;
  let linkedProperty: ReturnType<
    typeof vi.fn<
      (
        types: readonly string[],
        show: string,
      ) => Observable<{ schema: string; definition: LayoutFieldType } | null>
    >
  >;

  /** The search as the reader: only the titles they may read, with the schemas asked for. */
  const search = (ids: readonly string[], schemas: readonly string[] = []) =>
    of(
      new Map(
        ids
          .filter((id) => id in TITLES)
          .map((id): [string, LinkedRecord] => [
            id,
            {
              title: TITLES[id].title,
              url: `/doc/${id}`,
              properties: schemas.includes('vehicletitle') ? TITLES[id].properties : {},
            },
          ]),
      ),
    );

  beforeEach(() => {
    warnings = [];
    linkedRecords = vi.fn(search);
    linkedProperty = vi.fn((_types: readonly string[], show: string) =>
      of(TITLE_PROPERTIES[show] ?? null),
    );
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      imports: [RecordPageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        { provide: PageProviderService, useValue: { execute: vi.fn(() => new Subject()) } },
        { provide: ConnectorRecordService, useValue: { read: vi.fn(() => new Subject()) } },
        { provide: DocumentDetailService, useValue: { getAuditLog: vi.fn(() => new Subject()) } },
        { provide: CURRENT_USERNAME, useValue: () => 'ines.calloway' },
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            rowPropertiesOf: () => of(new Map()),
            linkedRecords: (ids: readonly string[], schemas?: readonly string[]) =>
              schemas === undefined ? linkedRecords(ids) : linkedRecords(ids, schemas),
            linkedProperty: (types: readonly string[], show: string) => linkedProperty(types, show),
          },
        },
        // Noon UTC on 27 November: 57 days after 1 October, 7 after 20 November.
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-27T12:00:00.000Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useValue: null },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
  });

  afterEach(() => vi.restoreAllMocks());

  function layoutOf(content: Record<string, unknown>): ResolvedRecordLayout {
    const read = readRecordLayout(content, {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    if ('invalid' in read) throw new Error(read.invalid);
    return resolveRecordLayout(DEAL_TYPE, read).layout;
  }

  async function render(
    document: NuxeoDocument,
    content: Record<string, unknown> = DEAL_PAGE,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordPageComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('layout', layoutOf(content));
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const banners = (root: HTMLElement): string[] =>
    [...root.querySelectorAll<HTMLElement>('[data-banner-id]')].map(
      (banner) => banner.dataset['bannerId'] as string,
    );
  const cards = (root: HTMLElement): string[] =>
    [...root.querySelectorAll<HTMLElement>('[data-card-id]')].map(
      (card) => card.dataset['cardId'] as string,
    );
  const valueOf = (root: HTMLElement, field: string): string | undefined =>
    root
      .querySelector(`[data-field="${field}"] .record-page__value`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();

  async function wcag22(root: HTMLElement): Promise<axe.Result[]> {
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations;
  }

  describe('a show through a widget', () => {
    it("draws the linked record's status as a badge inside the link that opens it", async () => {
      const root = await render(deal({ 'vdeal:title': TITLE }));
      const link = root.querySelector<HTMLAnchorElement>(
        '[data-field="vdeal:title/vtitle:status"] a.record-page__record',
      );
      expect(link?.getAttribute('href')).toBe(`/doc/${TITLE}`);
      const tag = link?.querySelector('nxs-status-tag');
      expect(tag?.querySelector('.nxs-status-tag__label')?.textContent?.trim()).toBe(
        'Awaiting lien release',
      );
      expect(tag?.classList).toContain('nxs-status-tag--warning');
      // The link is named by the badge's words.
      expect(link?.textContent?.replace(/\s+/g, ' ')).toContain('Awaiting lien release');
    });

    it('draws a value of no tone as a neutral badge, and an unreadable record as unavailable', async () => {
      let root = await render(deal({ 'vdeal:title': OTHER }));
      expect(
        root.querySelector('[data-field="vdeal:title/vtitle:status"] nxs-status-tag')?.classList,
      ).toContain('nxs-status-tag--success');
      fixture.destroy();
      root = await render(deal({ 'vdeal:title': HIDDEN }));
      expect(valueOf(root, 'vdeal:title/vtitle:status')).toBe('Unavailable');
      expect(root.querySelector('[data-field="vdeal:title/vtitle:status"] nxs-status-tag')).toBe(
        null,
      );
    });

    it("leaves the field out, and says why, where the widget does not show the property's type", async () => {
      const page = {
        version: 2,
        cards: [
          {
            id: 'title',
            fields: [
              {
                id: 'opened',
                field: 'vdeal:title',
                widget: 'document-link',
                parameters: {
                  types: ['VehicleTitle'],
                  show: { field: 'vtitle:openedOn', widget: 'number' },
                },
              },
              'vdeal:number',
            ],
          },
        ],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      expect(root.querySelector('[data-field="vdeal:title/vtitle:openedOn"]')).toBe(null);
      expect(warnings).toContain(
        '[agentic-ui-layouts] VehicleDeal/view layout: cards[0].fields[0] left out: the widget "number" does not show vtitle:openedOn, a date property',
      );
    });

    it('shows a number without its group separator for grouping: false', async () => {
      const root = await render(deal({ 'vdeal:title': TITLE }));
      expect(valueOf(root, 'vdeal:year')).toBe('2024');
    });

    it('passes axe at WCAG 2.2 AA, with the badge in its link and both banners shown', async () => {
      const root = await render(deal({ 'vdeal:title': TITLE }));
      expect(banners(root)).toEqual(['lien', 'overdue']);
      expect(await wcag22(root)).toEqual([]);
    });
  });

  describe('a positive banner', () => {
    it('draws in the success tone, its icon decorative, and passes axe at WCAG 2.2 AA', async () => {
      const page = {
        version: 2,
        banners: [
          {
            id: 'issued',
            tone: 'positive',
            label: 'Its title is issued',
            visibleWhen: { type: 'app.rules.fieldIn', parameters: [status, 'Issued'] },
            link: { field: 'vdeal:title' },
          },
        ],
        cards: [{ id: 'deal', fields: ['vdeal:number'] }],
      };
      const root = await render(deal({ 'vdeal:title': OTHER }), page);
      const banner = root.querySelector('[data-banner-id="issued"] .nxs-banner');
      expect(banner?.getAttribute('data-tone')).toBe('success');
      expect(banner?.querySelector('.nxs-banner__icon')?.textContent?.trim()).toBe('check_circle');
      expect(banner?.querySelector('.nxs-banner__icon')?.getAttribute('aria-hidden')).toBe('true');
      expect(banner?.querySelector('.nxs-banner__message')?.textContent?.trim()).toBe(
        'Its title is issued',
      );
      expect(await wcag22(root)).toEqual([]);
    });
  });

  describe("a rule over a linked record's property", () => {
    it("shows a banner, a card and a field by the linked record's property", async () => {
      const root = await render(deal({ 'vdeal:title': TITLE }));
      // Awaiting its lien release, and opened 57 days ago: both banners, and the lien card.
      expect(banners(root)).toEqual(['lien', 'overdue']);
      expect(cards(root)).toEqual(['title', 'lien-card']);
    });

    it('hides them for a linked record whose property does not pass', async () => {
      // Issued, and opened 7 days ago.
      const root = await render(deal({ 'vdeal:title': OTHER }));
      expect(banners(root)).toEqual([]);
      expect(cards(root)).toEqual(['title']);
    });

    it('reads the linked record once, with the schema the rules and the show read', async () => {
      await render(deal({ 'vdeal:title': TITLE }));
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0]).toEqual([[TITLE], ['vehicletitle']]);
      expect(linkedProperty).toHaveBeenCalledWith(['VehicleTitle'], 'vtitle:status');
      expect(linkedProperty).toHaveBeenCalledWith(['VehicleTitle'], 'vtitle:openedOn');
    });

    it('reads it as the reader: a title the reader may not read passes no rule', async () => {
      // `core.not` of the lien rule would pass for a title with no value: a banner on it shows.
      const page = {
        ...DEAL_PAGE,
        banners: [
          {
            id: 'not-awaiting',
            label: 'Not awaiting a lien release',
            visibleWhen: { type: 'core.not', parameters: [awaitingLien] },
          },
          ...DEAL_PAGE.banners,
        ],
      };
      const root = await render(deal({ 'vdeal:title': HIDDEN }), page);
      expect(banners(root)).toEqual(['not-awaiting']);
      // Nothing of the hidden record's reaches the page, and it is asked for by its id only.
      expect(linkedRecords.mock.calls[0]).toEqual([[HIDDEN], ['vehicletitle']]);
      expect(root.textContent).not.toContain('Awaiting lien release');
    });

    it('decides nothing until the linked record is read, so nothing shows for a moment', async () => {
      const answer = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
      linkedRecords = vi.fn(() => answer);
      const page = {
        ...DEAL_PAGE,
        banners: [
          {
            id: 'not-awaiting',
            label: 'Not awaiting a lien release',
            visibleWhen: { type: 'core.not', parameters: [awaitingLien] },
          },
          ...DEAL_PAGE.banners,
        ],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      // While the title is read, no rule over it passes, its `core.not` included.
      expect(banners(root)).toEqual([]);
      expect(cards(root)).toEqual(['title']);
      answer.next(
        new Map([
          [
            TITLE,
            {
              title: TITLES[TITLE].title,
              url: `/doc/${TITLE}`,
              properties: TITLES[TITLE].properties,
            },
          ],
        ]),
      );
      answer.complete();
      await settle();
      expect(banners(root)).toEqual(['lien', 'overdue']);
    });

    it('decides nothing until the linked types are read', async () => {
      const types = new Subject<{ schema: string; definition: LayoutFieldType } | null>();
      linkedProperty = vi.fn(() => types);
      const page = {
        ...DEAL_PAGE,
        banners: [
          {
            id: 'not-awaiting',
            label: 'Not awaiting a lien release',
            visibleWhen: { type: 'core.not', parameters: [awaitingLien] },
          },
          ...DEAL_PAGE.banners,
        ],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      expect(linkedRecords).not.toHaveBeenCalled();
      // Not even the `core.not` of a rule whose linked types are still read.
      expect(banners(root)).toEqual([]);
    });

    it('reads the record a rule names when no field on the page names it', async () => {
      const page = {
        version: 2,
        banners: DEAL_PAGE.banners,
        cards: [{ id: 'deal', fields: ['vdeal:number'] }],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      expect(linkedRecords.mock.calls).toEqual([[[TITLE], ['vehicletitle']]]);
      expect(banners(root)).toEqual(['lien', 'overdue']);
    });

    it("waits with a computation's core.choose over it, as a banner does, then shows its value", async () => {
      const answer = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
      linkedRecords = vi.fn(() => answer);
      const page = {
        version: 2,
        cards: [
          {
            id: 'deal',
            fields: [
              'vdeal:number',
              {
                id: 'lien',
                label: 'Lien',
                computed: {
                  type: 'core.choose',
                  parameters: [awaitingLien, 'Waiting for its release', 'Released'],
                },
              },
            ],
          },
        ],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      // Never the other value for a moment: nothing while the title is read.
      expect(valueOf(root, 'lien')).toBe('');
      answer.next(
        new Map([
          [
            TITLE,
            {
              title: TITLES[TITLE].title,
              url: `/doc/${TITLE}`,
              properties: TITLES[TITLE].properties,
            },
          ],
        ]),
      );
      answer.complete();
      await settle();
      expect(valueOf(root, 'lien')).toBe('Waiting for its release');
    });

    it('passes no rule, and says why, over a property none of its types has', async () => {
      const page = {
        version: 2,
        banners: [
          {
            id: 'paid-off',
            label: 'Paid off',
            visibleWhen: {
              type: 'core.not',
              parameters: [
                {
                  type: 'app.rules.fieldIn',
                  parameters: [
                    { field: 'vdeal:title', types: ['VehicleTitle'], show: 'vtitle:lender' },
                    'none',
                  ],
                },
              ],
            },
          },
        ],
        cards: [{ id: 'deal', fields: ['vdeal:number'] }],
      };
      const root = await render(deal({ 'vdeal:title': TITLE }), page);
      expect(banners(root)).toEqual([]);
      expect(warnings.some((warning) => warning.includes('a rule reading vtitle:lender'))).toBe(
        true,
      );
    });

    it('reads no linked record for a reference that holds no id, and decides at once', async () => {
      const root = await render(deal({ 'vdeal:title': 'not-an-id' }));
      expect(linkedRecords).not.toHaveBeenCalled();
      expect(banners(root)).toEqual([]);
      expect(cards(root)).toEqual(['title']);
    });
  });
});
