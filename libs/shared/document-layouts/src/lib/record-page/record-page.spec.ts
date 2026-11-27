import { Component, input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NXS_PRIMITIVE_IDS, provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  ExtensionComponentRegistry,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import {
  CURRENT_USERNAME,
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
  ShareLinkService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition, LayoutFieldType } from '../layout.model';
import { ConnectorRecordService } from './connector-record.service';
import type { LinkedRecord } from './linked-record';
import { readRecordLayout } from './record-layout';
import { RecordListComponent } from './record-list';
import {
  BANNER_LINK_CLASS,
  RECORD_PAGE_TIME_ZONE,
  RECORD_PAGE_TODAY,
  RecordPageComponent,
} from './record-page';
import { RECORD_VIDEO_ID } from './record-video';
import { RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import { RecordTimelineComponent } from './record-timeline';
import { resolveRecordLayout, type ResolvedRecordLayout } from './resolve-record-layout';

const MEMBER_TYPE: DocumentTypeDefinition = {
  name: 'Member',
  schemas: [
    {
      name: 'member',
      prefix: 'member',
      fields: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        birthDate: { type: 'date' },
        visitedAt: { type: 'date' },
        phone: { type: 'string' },
        status: { type: 'string' },
        ssn: { type: 'string' },
        notes: { type: 'string' },
        caseManager: { type: 'string' },
        referrer: { type: 'string' },
        household: { type: 'string[]' },
        visits: {
          type: 'complex[]',
          fields: {
            adjuster: { type: 'string' },
            note: { type: 'string' },
            country: { type: 'string' },
            calls: {
              type: 'complex[]',
              fields: { by: { type: 'string' }, secret: { type: 'string' } },
            },
          },
        },
        address: {
          type: 'complex',
          fields: { street: { type: 'string' }, city: { type: 'string' }, zip: { type: 'string' } },
        },
        onboarding: {
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

const member = (overrides: Record<string, unknown> = {}): NuxeoDocument =>
  ({
    uid: 'm1',
    title: 'Jane Roe',
    type: 'Member',
    path: '/m1',
    lastModified: '',
    properties: {
      'member:firstName': 'Jane',
      'member:lastName': 'Roe',
      'member:birthDate': '1980-11-24T00:00:00Z',
      // An instant: 01:30 on the 24th at +05:30, still the 23rd in UTC.
      'member:visitedAt': '2026-11-23T20:00:00Z',
      'member:phone': '+1 555 0100',
      'member:status': 'active',
      'member:ssn': '000-00-0000',
      'member:notes': '<p>Prefers <b>email</b><script>alert(1)</script></p>',
      'member:caseManager': 'jdoe',
      'member:visits': [{ adjuster: 'jdoe', note: 'Called back', country: 'fr' }],
      'member:address': { street: '1 Main St', city: 'Springfield', zip: '12345' },
      ...overrides,
    },
  }) as NuxeoDocument;

/** A computed field that names `rich-text`, which a computation's text may never be shown as. */
const GREETING_PAGE = {
  version: 2,
  cards: [
    {
      id: 'a',
      fields: [
        'member:phone',
        {
          id: 'greeting',
          widget: 'rich-text',
          computed: { type: 'core.template', parameters: ['<b>Hello</b> {member:firstName}'] },
        },
      ],
    },
  ],
};

/** The Member page of layout-v2.md, section 9, without its related lists: those are below. */
const MEMBER_PAGE = {
  version: 2,
  columns: 2,
  cards: [
    {
      id: 'member',
      label: 'Member',
      fields: [
        {
          id: 'name',
          label: 'Name',
          computed: { type: 'core.template', parameters: ['{member:firstName} {member:lastName}'] },
        },
        {
          id: 'age',
          label: 'Age',
          widget: 'number',
          computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
        },
        {
          field: 'member:address',
          widget: 'address',
          parameters: { parts: { street: 'street', city: 'city', postcode: 'zip' } },
        },
        { field: 'member:phone', widget: 'phone' },
        {
          field: 'member:status',
          widget: 'status-badge',
          parameters: { tones: { active: 'positive' } },
        },
        { field: 'member:ssn', visibleWhen: 'test.rules.memberServices' },
      ],
    },
    {
      id: 'service',
      label: 'Service',
      span: 2,
      visibleWhen: 'test.rules.canSeeService',
      fields: [
        { field: 'member:caseManager', widget: 'user' },
        { field: 'member:notes', widget: 'rich-text' },
      ],
    },
  ],
};

function layoutOf(content: Record<string, unknown>): ResolvedRecordLayout {
  const read = readRecordLayout(content, {
    rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
  });
  if ('invalid' in read) throw new Error(read.invalid);
  return resolveRecordLayout(MEMBER_TYPE, read).layout;
}

const WEI = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const JOHN = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
const MARIA = '9a651335-d3d4-434c-a7b4-afe7e5c0edae';
/** A record the reader may not read, or that no longer exists: the search does not return it. */
const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';
const TITLES: Readonly<Record<string, string>> = {
  [WEI]: 'Wei Chen',
  [JOHN]: 'John Smith',
  [MARIA]: 'Maria Alvarez',
};

/** What the search returns for `ids`: the records the reader may read. */
const linked = (ids: readonly string[]): ReadonlyMap<string, LinkedRecord> =>
  new Map(
    ids
      .filter((id) => id in TITLES)
      .map((id): [string, LinkedRecord] => [id, { title: TITLES[id], url: `/doc/${id}` }]),
  );

/** A card of `document-link` fields, and a template that shows one of them. */
const LINKS_PAGE = {
  version: 2,
  cards: [
    {
      id: 'links',
      fields: [
        { field: 'member:referrer', widget: 'document-link', parameters: { types: ['Member'] } },
        { field: 'member:household', widget: 'document-link' },
        {
          id: 'referred',
          label: 'Referred',
          computed: { type: 'core.template', parameters: ['By {member:referrer}'] },
        },
      ],
    },
  ],
};

/** What a customer's own banner might be: it says which inputs reached it. */
@Component({
  selector: 'lib-test-overridden-banner',
  standalone: true,
  template: '<p class="test-banner">{{ tone() }} {{ announce() }}: {{ message() }}</p>',
})
class OverriddenBannerComponent {
  readonly message = input('');
  readonly tone = input('');
  readonly announce = input('');
}

/** What a customer's own video player might be: it says which inputs reached it. */
@Component({
  selector: 'lib-test-overridden-video',
  standalone: true,
  template: '<p class="test-video">{{ document()?.uid }} at level {{ stateHeadingLevel() }}</p>',
})
class OverriddenVideoComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly stateHeadingLevel = input(0);
}

describe('RecordPageComponent', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let rules: { memberServices: boolean; canSeeService: boolean };
  let principal: (kind: string, id: string) => Observable<string | null>;
  let vocabularyLabel: (directory: string, id: string) => Observable<string | null>;
  /** What a related list's rows' properties are, as the layout service reads them. */
  let rowProperties: () => Observable<ReadonlyMap<string, unknown>>;
  /** The linked records' search: each call is one request, with the ids it was given. */
  let linkedRecords: ReturnType<
    typeof vi.fn<
      (
        ids: readonly string[],
        schemas?: readonly string[],
      ) => Observable<ReadonlyMap<string, LinkedRecord> | null>
    >
  >;
  /** What a `show` reads of the types it links to, as the layout service reads their schemas. */
  let linkedProperty: ReturnType<
    typeof vi.fn<
      (
        types: readonly string[],
        show: string,
      ) => Observable<{ schema: string; definition: LayoutFieldType } | null>
    >
  >;
  /** The zone the page shows an instant in: the process's own, unless a test chooses one. */
  let timeZone: string | undefined;
  /**
   * The page's today, `RECORD_PAGE_TODAY`: noon UTC on 23 November, unless a test chooses another.
   * That instant is the 23rd only west of UTC+12, and a computation reads today as the reader's day
   * (`libs/shared/computations`, `dates.ts`), so a case about a day gives a time where the reader is.
   */
  let pageToday: Date;
  let warnings: string[];
  let execute: ReturnType<typeof vi.fn>;
  /** What a card from another system asks the server's connector. */
  let connectorRead: ReturnType<typeof vi.fn>;
  /** The record's history and comments: what the timeline and the comments cards ask for. */
  let documents: {
    getAuditLog: ReturnType<typeof vi.fn>;
    getAllComments: ReturnType<typeof vi.fn>;
    createComment: ReturnType<typeof vi.fn>;
    /** A Picture's views, which a page with the picture's preview fetches. */
    fetchBlobByXpath: ReturnType<typeof vi.fn>;
    /** A picture's review: its annotations on the views. */
    getAnnotationDocuments: ReturnType<typeof vi.fn>;
    /** A video's transcoded files, which a page with the video's preview fetches by name. */
    fetchRendition: ReturnType<typeof vi.fn>;
  };
  /** A picture's share links: what a page with `shareLinks` asks the server. */
  let shareLinks: { list: ReturnType<typeof vi.fn>; downloads: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    execute = vi.fn(() => new Subject());
    connectorRead = vi.fn(() => new Subject());
    documents = {
      getAuditLog: vi.fn(() => new Subject()),
      getAllComments: vi.fn(() => new Subject()),
      createComment: vi.fn(),
      fetchBlobByXpath: vi.fn(() => new Subject()),
      getAnnotationDocuments: vi.fn(() => of([])),
      fetchRendition: vi.fn(() => new Subject()),
    };
    shareLinks = { list: vi.fn(() => of([])), downloads: vi.fn(() => new Subject()) };
    rules = { memberServices: false, canSeeService: true };
    principal = (kind, id) =>
      of(
        kind === 'user' && id === 'jdoe'
          ? 'Jane Doe'
          : kind === 'group' && id === 'members'
            ? 'Member services'
            : null,
      );
    vocabularyLabel = (directory, id) =>
      of(
        directory === 'country' && id === 'fr'
          ? 'France'
          : directory === 'statuses' && id === 'active'
            ? 'Active'
            : null,
      );
    linkedRecords = vi.fn((ids: readonly string[]) => of(linked(ids)));
    linkedProperty = vi.fn(() => of(null));
    rowProperties = () => of(new Map());
    warnings = [];
    timeZone = undefined;
    pageToday = new Date('2026-11-23T12:00:00Z');
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      imports: [RecordPageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        { provide: PageProviderService, useValue: { execute } },
        { provide: ConnectorRecordService, useValue: { read: connectorRead } },
        { provide: DocumentDetailService, useValue: documents },
        { provide: ShareLinkService, useValue: shareLinks },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: (directory: string, id: string) => vocabularyLabel(directory, id),
            principalLabel: (kind: string, id: string) => principal(kind, id),
            rowPropertiesOf: () => rowProperties(),
            linkedRecords: (ids: readonly string[], schemas?: readonly string[]) =>
              schemas === undefined ? linkedRecords(ids) : linkedRecords(ids, schemas),
            linkedProperty: (types: readonly string[], show: string) => linkedProperty(types, show),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => pageToday },
        { provide: RECORD_PAGE_TIME_ZONE, useFactory: () => timeZone },
        // The timeline's second ask is its own spec's: here, one ask per timeline.
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useValue: null },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules({
      'test.rules.memberServices': () => rules.memberServices,
      'test.rules.canSeeService': () => rules.canSeeService,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    document = member(),
    content: Record<string, unknown> = MEMBER_PAGE,
    readOnly = false,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordPageComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('layout', layoutOf(content));
    if (readOnly) fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const valueOf = (root: HTMLElement, field: string): string | undefined =>
    root
      .querySelector(`[data-field="${field}"] .record-page__value`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();

  it('draws the cards, in order, with their headings and the columns each spans', async () => {
    const root = await render();
    const cards = [...root.querySelectorAll<HTMLElement>('.record-page__card')];
    expect(cards.map((card) => card.dataset['cardId'])).toEqual(['member', 'service']);
    expect(cards.map((card) => card.querySelector('h3')?.textContent?.trim())).toEqual([
      'Member',
      'Service',
    ]);
    expect(cards[1].style.getPropertyValue('--record-card-span')).toBe('2');
    expect(
      root
        .querySelector<HTMLElement>('.record-page')
        ?.style.getPropertyValue('--record-page-columns'),
    ).toBe('2');
  });

  it('shows what the registered computations work out from the record', async () => {
    // Born 24 November 1980: 45 on 23 November 2026, the day before the birthday. Noon on the
    // 23rd where the reader is, not an instant: noon UTC is already the 24th at UTC+12 and east of
    // it, where the reader has turned 46 (AGENTS/08-bug-patterns.md, pattern 29).
    pageToday = new Date(2026, 10, 23, 12);
    const root = await render();
    expect(valueOf(root, 'name')).toBe('Jane Roe');
    expect(valueOf(root, 'age')).toBe('45');
  });

  it("turns an age over at the reader's midnight, which only a zone off UTC tells from UTC's", async () => {
    // The stored birth date is midnight UTC, 24 November 1980: that day in any zone. A page that
    // read today in UTC fails this case in any zone east of UTC (the second age) or west of it
    // (the first), and cannot fail it in a zone at UTC's own offset, where both midnights agree.
    // This suite pins no zone, so on a UTC runner, as CI's are, it asserts only the ages.
    pageToday = new Date(2026, 10, 23, 23, 59);
    expect(valueOf(await render(), 'age')).toBe('45');
    pageToday = new Date(2026, 10, 24, 0, 1);
    expect(valueOf(await render(), 'age')).toBe('46');
  });

  it('shows each property through its widget', async () => {
    const root = await render();
    expect(
      [...root.querySelectorAll('[data-field="member:address"] .record-page__line')].map(
        (line) => line.textContent,
      ),
    ).toEqual(['1 Main St', '12345 Springfield']);
    const phone = root.querySelector<HTMLAnchorElement>('[data-field="member:phone"] a');
    expect(phone?.getAttribute('href')).toBe('tel:+15550100');
    const tag = root.querySelector('[data-field="member:status"] nxs-status-tag');
    // The tag's own text; its icon is a ligature, aria-hidden, which `textContent` also reads.
    expect(tag?.querySelector('.nxs-status-tag__label')?.textContent?.trim()).toBe('active');
    expect(tag?.classList).toContain('nxs-status-tag--success');
  });

  it('shows a user by name once the name is read', async () => {
    const names = new Subject<string | null>();
    principal = () => names;
    const root = await render();
    expect(valueOf(root, 'member:caseManager')).toBe('jdoe');
    names.next('Jane Doe');
    names.complete();
    fixture.detectChanges();
    expect(valueOf(root, 'member:caseManager')).toBe('Jane Doe');
  });

  describe('the link to the capture page', () => {
    const CAPTURE = { property: 'files:files', findBy: [], keepLocation: false };
    const draw = async (
      document: NuxeoDocument,
      capture: typeof CAPTURE | null,
      readOnly = false,
    ): Promise<HTMLElement> => {
      fixture = TestBed.createComponent(RecordPageComponent);
      fixture.componentRef.setInput('document', document);
      fixture.componentRef.setInput('layout', { ...layoutOf(MEMBER_PAGE), capture });
      fixture.componentRef.setInput('readOnly', readOnly);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const writable = (extra: Record<string, unknown> = {}) =>
      ({
        ...member(),
        contextParameters: { permissions: ['Read', 'Write'] },
        ...extra,
      }) as NuxeoDocument;

    it('links a record its layout captures photos for to the capture page, above the cards', async () => {
      const root = await draw(writable(), CAPTURE);
      const link = root.querySelector<HTMLAnchorElement>('.record-page__capture-link');
      expect(link?.textContent?.trim()).toBe('Take photos and file them here');
      expect(link?.getAttribute('href')).toBe('/capture?record=m1');
      expect(
        root
          .querySelector('.record-page__capture')
          ?.compareDocumentPosition(root.querySelector('.record-page__grid') as Node),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('offers no link to a reader who may not write the record, on a version, or read-only', async () => {
      expect((await draw(member(), CAPTURE)).querySelector('.record-page__capture')).toBeNull();
      fixture.destroy();
      expect(
        (await draw(writable({ isVersion: true }), CAPTURE)).querySelector('.record-page__capture'),
      ).toBeNull();
      fixture.destroy();
      expect(
        (await draw(writable(), CAPTURE, true)).querySelector('.record-page__capture'),
      ).toBeNull();
      fixture.destroy();
      expect((await draw(writable(), null)).querySelector('.record-page__capture')).toBeNull();
    });
  });

  describe('a document-link', () => {
    const linksOf = (root: HTMLElement, field: string) =>
      [...root.querySelectorAll<HTMLAnchorElement>(`[data-field="${field}"] a`)].map((link) => ({
        text: link.textContent?.trim(),
        href: link.getAttribute('href'),
      }));

    it("shows the linked record's title, as a link that opens it through the app's router", async () => {
      const root = await render(member({ 'member:referrer': WEI }), LINKS_PAGE);
      expect(valueOf(root, 'member:referrer')).toBe('Wei Chen');
      expect(linksOf(root, 'member:referrer')).toEqual([{ text: 'Wei Chen', href: `/doc/${WEI}` }]);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      root.querySelector<HTMLAnchorElement>('[data-field="member:referrer"] a')?.click();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(router.serializeUrl(navigate.mock.calls[0][0] as never)).toBe(`/doc/${WEI}`);
      // A template's placeholder shows the property as the field does: by its title.
      expect(valueOf(root, 'referred')).toBe('By Wei Chen');
      expect(warnings.some((w) => w.includes('document-link'))).toBe(false);
    });

    it('reads every record the page names in one request, each id once', async () => {
      await render(
        member({ 'member:referrer': WEI, 'member:household': [JOHN, WEI, GONE] }),
        LINKS_PAGE,
      );
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0][0]).toEqual([GONE, JOHN, WEI].sort());
    });

    it('shows a record it may not read, one that is gone and a value that is no id as unavailable, never the id', async () => {
      const injected = `${WEI}' OR ecm:uuid IS NOT NULL OR ecm:uuid = '`;
      const root = await render(
        member({ 'member:referrer': GONE, 'member:household': [JOHN, injected, GONE] }),
        LINKS_PAGE,
      );
      expect(valueOf(root, 'member:referrer')).toBe('Unavailable');
      expect(linksOf(root, 'member:referrer')).toEqual([]);
      expect(valueOf(root, 'member:household')).toBe('John Smith, Unavailable, Unavailable');
      expect(linksOf(root, 'member:household')).toEqual([
        { text: 'John Smith', href: `/doc/${JOHN}` },
      ]);
      const text = root.textContent ?? '';
      expect(text).not.toContain(GONE);
      expect(text).not.toContain(injected);
      // The value that is not an id was never asked for.
      expect(linkedRecords.mock.calls.flatMap(([ids]) => ids)).not.toContain(injected);
    });

    it('shows nothing of a record while it is read, not its id', async () => {
      const answer = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
      linkedRecords.mockReturnValueOnce(answer);
      const root = await render(member({ 'member:referrer': WEI }), LINKS_PAGE);
      expect(valueOf(root, 'member:referrer')).toBe('');
      expect(root.textContent).not.toContain(WEI);
      answer.next(linked([WEI]));
      answer.complete();
      fixture.detectChanges();
      expect(valueOf(root, 'member:referrer')).toBe('Wei Chen');
    });

    it('reads a record the page and its list both name once, the list asking only for the others', async () => {
      rowProperties = () => of(new Map([['claim:member', { type: 'string' }]]));
      const row = (uid: string, memberId: string) => ({
        uid,
        title: uid,
        type: 'Claim',
        path: `/claims/${uid}`,
        lastModified: '',
        properties: { 'claim:number': uid, 'claim:member': memberId },
      });
      execute.mockReturnValue(
        of({
          entries: [row('CLM-1', WEI), row('CLM-2', JOHN)],
          totalSize: 2,
          currentPageSize: 2,
          currentPageIndex: 0,
          numberOfPages: 1,
          isNextPageAvailable: false,
        }),
      );
      const root = await render(member({ 'member:referrer': WEI }), {
        version: 2,
        cards: [
          LINKS_PAGE.cards[0],
          {
            id: 'claims',
            related: {
              pageProvider: 'member_claims',
              parameters: [{ field: 'ecm:uuid' }],
              columns: ['claim:number', { field: 'claim:member', widget: 'document-link' }],
            },
          },
        ],
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const asked = linkedRecords.mock.calls.map(([ids]) => [...ids]);
      expect(asked).toEqual([[WEI], [JOHN]]);
      const list = root.querySelector('[data-card-id="claims"] table')?.textContent ?? '';
      expect(list).toContain('Wei Chen');
      expect(list).toContain('John Smith');
      expect(valueOf(root, 'member:referrer')).toBe('Wei Chen');
    });

    it('reads no label again when only its linked records change', async () => {
      const names = vi.fn(() => of('Jane Doe'));
      principal = names;
      const page = {
        version: 2,
        cards: [
          {
            id: 'links',
            fields: [
              { field: 'member:caseManager', widget: 'user' },
              { field: 'member:referrer', widget: 'document-link' },
            ],
          },
        ],
      };
      await render(member({ 'member:referrer': WEI }), page);
      expect(names).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput('document', member({ 'member:referrer': JOHN }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(linkedRecords).toHaveBeenCalledTimes(2);
      expect(names).toHaveBeenCalledTimes(1);
      expect(valueOf(fixture.nativeElement as HTMLElement, 'member:caseManager')).toBe('Jane Doe');
    });

    it('asks nothing more for the record reloaded with the same links, and only for an id it adds', async () => {
      await render(member({ 'member:referrer': WEI, 'member:household': [JOHN] }), LINKS_PAGE);
      fixture.componentRef.setInput(
        'document',
        member({
          'member:referrer': WEI,
          'member:household': [JOHN],
          'member:phone': '+1 555 0199',
        }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput(
        'document',
        member({ 'member:referrer': MARIA, 'member:household': [JOHN, WEI] }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(linkedRecords).toHaveBeenCalledTimes(2);
      expect(linkedRecords.mock.calls[1][0]).toEqual([MARIA]);
      expect(valueOf(fixture.nativeElement as HTMLElement, 'member:referrer')).toBe(
        'Maria Alvarez',
      );
    });
  });

  it("shows rich text through the platform's sanitiser: formatting kept, script gone", async () => {
    const root = await render();
    const notes = root.querySelector('[data-field="member:notes"] .record-page__rich-text');
    expect(notes?.querySelector('b')?.textContent).toBe('email');
    expect(notes?.querySelector('script')).toBeNull();
    expect(notes?.innerHTML).not.toContain('alert');
  });

  describe("a document-link's show", () => {
    /** The referrer by name, and the referrer's own plan and joining day, as a page shows them. */
    const SHOW_PAGE = {
      version: 2,
      cards: [
        {
          id: 'links',
          fields: [
            {
              field: 'member:referrer',
              widget: 'document-link',
              parameters: { types: ['Member'] },
            },
            {
              id: 'referrerPlan',
              field: 'member:referrer',
              widget: 'document-link',
              parameters: { types: ['Member'], show: 'plan:name' },
            },
            {
              id: 'referrerJoined',
              field: 'member:household',
              widget: 'document-link',
              label: 'Joined',
              parameters: { types: ['Member'], show: 'plan:joinedOn' },
            },
          ],
        },
      ],
    };
    const PLANS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
      [WEI]: { 'plan:name': 'Gold', 'plan:joinedOn': '2024-03-01T00:00:00.000Z' },
      [JOHN]: { 'plan:name': 'Silver', 'plan:joinedOn': null },
    };
    const PLAN = {
      'plan:name': { schema: 'plans', definition: { type: 'string' } },
      'plan:joinedOn': { schema: 'plans', definition: { type: 'date' } },
      'audit:checkedOn': { schema: 'audit', definition: { type: 'date' } },
    } as const;

    beforeEach(() => {
      linkedProperty = vi.fn((_types: readonly string[], show: string) =>
        of(PLAN[show as keyof typeof PLAN] ?? null),
      );
      // The search returns a record's properties of the schemas asked for, and none otherwise.
      linkedRecords.mockImplementation((ids, schemas = []) =>
        of(
          new Map(
            [...linked(ids)].map(([id, record]): [string, LinkedRecord] => [
              id,
              { ...record, properties: schemas.includes('plans') ? (PLANS[id] ?? {}) : {} },
            ]),
          ),
        ),
      );
    });

    const shown = (root: HTMLElement, field: string) =>
      [...root.querySelectorAll(`[data-field="${field}"] .record-page__value > *`)].map((node) => ({
        text: node.textContent?.trim(),
        href: node.getAttribute('href'),
      }));
    const labelOf = (root: HTMLElement, field: string) =>
      root.querySelector(`[data-field="${field}"] .record-page__label`)?.textContent?.trim();

    it("shows the linked record's property, by its schema type, as a link to that record", async () => {
      const root = await render(
        member({ 'member:referrer': WEI, 'member:household': [WEI, JOHN] }),
        SHOW_PAGE,
      );
      // The title and the property stand side by side, over one reference.
      expect(valueOf(root, 'member:referrer')).toBe('Wei Chen');
      expect(shown(root, 'member:referrer/plan:name')).toEqual([
        { text: 'Gold', href: `/doc/${WEI}` },
      ]);
      // Labelled as the shown property, not as the reference, unless the entry says otherwise.
      expect(labelOf(root, 'member:referrer/plan:name')).toBe('Name');
      expect(labelOf(root, 'member:household/plan:joinedOn')).toBe('Joined');
      // A date, as the date widget shows one; a record without the value is left out of the list.
      expect(shown(root, 'member:household/plan:joinedOn')).toEqual([
        { text: 'March 1, 2024', href: `/doc/${WEI}` },
      ]);
      expect(linkedProperty).toHaveBeenCalledWith(['Member'], 'plan:name');
    });

    it('reads each linked record once, with every schema the page shows, after the types are read', async () => {
      await render(member({ 'member:referrer': WEI, 'member:household': [JOHN, WEI] }), SHOW_PAGE);
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0]).toEqual([[JOHN, WEI].sort(), ['plans']]);
    });

    it('waits for the linked types before it reads, so a record is not read twice', async () => {
      const types = new Subject<{ schema: string; definition: { type: string } } | null>();
      linkedProperty = vi.fn(() => types);
      const root = await render(member({ 'member:referrer': WEI }), SHOW_PAGE);
      expect(linkedRecords).not.toHaveBeenCalled();
      // Meanwhile the property shows nothing, not the stored id.
      expect(valueOf(root, 'member:referrer/plan:name')).toBe('');
      types.next(PLAN['plan:name']);
      types.complete();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(valueOf(root, 'member:referrer/plan:name')).toBe('Gold');
    });

    it('shows a record the reader may not read as unavailable, never one of its values', async () => {
      const root = await render(
        member({ 'member:referrer': GONE, 'member:household': [GONE, 'not-an-id'] }),
        SHOW_PAGE,
      );
      expect(valueOf(root, 'member:referrer/plan:name')).toBe('Unavailable');
      expect(valueOf(root, 'member:household/plan:joinedOn')).toBe('Unavailable, Unavailable');
      expect(root.textContent).not.toContain(GONE);
    });

    it('shows a readable record without the value as empty', async () => {
      const root = await render(member({ 'member:household': [JOHN] }), SHOW_PAGE);
      expect(valueOf(root, 'member:household/plan:joinedOn')).toBe('—');
    });

    it('leaves the field out, and says why, where no linked type has the property or it is a reference', async () => {
      linkedProperty = vi.fn((_types: readonly string[], show: string) =>
        of(
          show === 'plan:name'
            ? null
            : { schema: 'plans', definition: { type: 'string', documentReference: true as const } },
        ),
      );
      const root = await render(
        member({ 'member:referrer': WEI, 'member:household': [WEI] }),
        SHOW_PAGE,
      );
      expect(root.querySelector('[data-field="member:referrer/plan:name"]')).toBeNull();
      expect(root.querySelector('[data-field="member:household/plan:joinedOn"]')).toBeNull();
      expect(valueOf(root, 'member:referrer')).toBe('Wei Chen');
      expect(warnings).toContain(
        '[agentic-ui-layouts] Member/view layout: cards[0].fields[1] left out: none of the types it links to, Member, has plan:name, or their schemas could not be read',
      );
      expect(warnings).toContain(
        "[agentic-ui-layouts] Member/view layout: cards[0].fields[2] left out: plan:joinedOn is itself a reference, and would show another record's stored id",
      );
      // The records the page still shows are read without the schema of a field it left out.
      expect(linkedRecords.mock.calls.at(-1)).toEqual([[WEI], []]);
    });

    it("reads with the schemas its related lists' columns show, so a list asks nothing again", async () => {
      const page = {
        version: 2,
        cards: [
          SHOW_PAGE.cards[0],
          {
            id: 'referred',
            label: 'Referred',
            related: {
              pageProvider: 'member_referred',
              parameters: [{ field: 'member:referrer' }],
              columns: [
                {
                  field: 'member:referrer',
                  widget: 'document-link',
                  parameters: { types: ['Member'], show: 'audit:checkedOn' },
                },
              ],
            },
          },
        ],
      };
      // The list's one row names the record the page's fields name.
      execute.mockImplementation(() =>
        of({
          entries: [{ ...member({ 'member:referrer': WEI }), uid: 'm2' }],
          totalSize: 1,
          currentPageSize: 1,
          currentPageIndex: 0,
          numberOfPages: 1,
          isNextPageAvailable: false,
        }),
      );
      rowProperties = () => of(new Map([['member:referrer', { type: 'string' }]]));
      const root = await render(member({ 'member:referrer': WEI }), page);
      await fixture.whenStable();
      fixture.detectChanges();
      const list = fixture.debugElement.query(By.directive(RecordListComponent));
      expect(list).not.toBeNull();
      // The list drew its row, and read nothing: the page read the record with the list's schema.
      expect(root.querySelector('[data-card-id="referred"] tr[data-uid="m2"]')).not.toBeNull();
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0]).toEqual([[WEI], ['audit', 'plans']]);
      expect(linkedProperty).toHaveBeenCalledWith(['Member'], 'audit:checkedOn');
    });

    it('reads nothing for a file drawn anew until its own shows are known, then each record once', async () => {
      // The case manager's field holds a record's id, which the first file does not name.
      await render(member({ 'member:referrer': WEI, 'member:caseManager': MARIA }), SHOW_PAGE);
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      const pending = new Subject<{ schema: string; definition: LayoutFieldType } | null>();
      linkedProperty = vi.fn(() => pending);
      // A plain link to a record not read yet, and a show whose types are not read yet.
      fixture.componentRef.setInput(
        'layout',
        layoutOf({
          version: 2,
          cards: [
            {
              id: 'links',
              fields: [
                { field: 'member:caseManager', widget: 'document-link' },
                {
                  id: 'checked',
                  field: 'member:caseManager',
                  widget: 'document-link',
                  parameters: { types: ['Member'], show: 'audit:checkedOn' },
                },
              ],
            },
          ],
        }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      pending.next(PLAN['audit:checkedOn']);
      pending.complete();
      await fixture.whenStable();
      fixture.detectChanges();
      // Read once, with the new file's schema, not first with the old file's and then again.
      expect(linkedRecords.mock.calls.slice(1)).toEqual([[[MARIA], ['audit']]]);
    });

    it("never pairs a file's show with what another file's read, as the page is drawn anew", async () => {
      const root = await render(member({ 'member:referrer': WEI }), SHOW_PAGE);
      expect(valueOf(root, 'member:referrer/plan:name')).toBe('Gold');
      // The same place shows another property; its type is not read yet.
      const pending = new Subject<{ schema: string; definition: LayoutFieldType } | null>();
      linkedProperty = vi.fn(() => pending);
      const fields = SHOW_PAGE.cards[0].fields;
      fixture.componentRef.setInput(
        'layout',
        layoutOf({
          ...SHOW_PAGE,
          cards: [
            {
              ...SHOW_PAGE.cards[0],
              fields: [
                fields[0],
                { ...fields[1], parameters: { types: ['Member'], show: 'plan:joinedOn' } },
              ],
            },
          ],
        }),
      );
      fixture.detectChanges();
      // Meanwhile it shows nothing: not the name read for the file before, under the new label.
      expect(valueOf(root, 'member:referrer/plan:joinedOn')).toBe('');
      expect(root.textContent).not.toContain('Gold');
      pending.next(PLAN['plan:joinedOn']);
      pending.complete();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(valueOf(root, 'member:referrer/plan:joinedOn')).toBe('March 1, 2024');
    });
  });

  describe('rules', () => {
    it('hide a field while theirs does not pass, and show it while it does', async () => {
      expect((await render()).querySelector('[data-field="member:ssn"]')).toBeNull();
      rules.memberServices = true;
      expect((await render()).querySelector('[data-field="member:ssn"]')).not.toBeNull();
    });

    it('hide a card while theirs does not pass', async () => {
      rules.canSeeService = false;
      const root = await render();
      expect(
        [...root.querySelectorAll<HTMLElement>('.record-page__card')].map(
          (card) => card.dataset['cardId'],
        ),
      ).toEqual(['member']);
    });

    it('hide a tab while theirs does not pass', async () => {
      rules.canSeeService = false;
      const root = await render(member(), {
        version: 2,
        tabs: [
          { id: 'summary', label: 'Summary', cards: [{ id: 'a', fields: ['member:phone'] }] },
          {
            id: 'service',
            label: 'Service',
            visibleWhen: 'test.rules.canSeeService',
            cards: [{ id: 'b', fields: ['member:status'] }],
          },
        ],
      });
      expect(
        [...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
      ).toEqual(['Summary']);
    });
  });

  it('leaves out a computed field whose computation cannot be worked out, and says so once', async () => {
    const page = {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            'member:phone',
            { id: 'age', computed: { type: 'core.age', parameters: [{ field: 'member:phone' }] } },
          ],
        },
      ],
    };
    const root = await render(member(), page);
    expect(root.querySelector('[data-field="age"]')).toBeNull();
    expect(root.querySelector('[data-field="member:phone"]')).not.toBeNull();
    // A new document object, as a refetch gives: the page recomputes, and must not say it again.
    fixture.componentRef.setInput('document', member());
    fixture.detectChanges();
    expect(
      warnings.filter((warning) => warning.includes('cards[0].fields[1] left out')),
    ).toHaveLength(1);
  });

  it('leaves out a computed field shown as rich text: a computation is text, never HTML', async () => {
    const root = await render(
      member({ 'member:firstName': '<img src="https://tracker.example/p.gif">Jane' }),
      GREETING_PAGE,
    );
    expect(root.querySelector('[data-field="greeting"]')).toBeNull();
    expect(root.querySelector('img, b')).toBeNull();
    // The reader, which the service logs from, says why.
    const read = readRecordLayout(GREETING_PAGE, {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    expect('problems' in read && read.problems).toEqual([
      'cards[0].fields[1].widget: a computed field is text, never HTML, so it cannot use the widget "rich-text"; cards[0].fields[1] left out',
    ]);
  });

  it('keeps formatting and links in rich text, and nothing that loads, submits or restyles', async () => {
    const root = await render(
      member({
        'member:notes':
          '<p><b>Call</b> <a href="https://help.example">help</a><img src="https://tracker.example/p.gif">' +
          '<form action="https://evil.example"><input type="password"></form><style>p{color:red}</style></p>',
      }),
    );
    const notes = root.querySelector('[data-field="member:notes"] .record-page__rich-text');
    expect(notes?.querySelector('b')?.textContent).toBe('Call');
    expect(notes?.querySelector('a')?.getAttribute('href')).toBe('https://help.example');
    expect(notes?.querySelector('img, form, input, style')).toBeNull();
  });

  it("shows a table's user column by name", async () => {
    const root = await render(member(), {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            {
              field: 'member:visits',
              widget: 'table',
              parameters: { columns: [{ field: 'visit:adjuster', widget: 'user' }, 'visit:note'] },
            },
          ],
        },
      ],
    });
    const cells = [...root.querySelectorAll('[data-field="member:visits"] td')].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual(['Jane Doe', 'Called back']);
    expect(root.querySelector('[data-field="member:visits"] caption')?.textContent?.trim()).toBe(
      'Visits',
    );
  });

  it("names each card's region by its own heading, not a second copy of it", async () => {
    const root = await render();
    const card = root.querySelector<HTMLElement>('[data-card-id="member"]');
    const heading = card?.querySelector('h3');
    expect(card?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(card?.hasAttribute('aria-label')).toBe(false);
  });

  /** Phase 1's demo step 4: member services see the member's social security number, others do not. */
  it("shows the Member page's SSN to member services, through the platform's app.rules.inGroup", async () => {
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    const page = {
      version: 2,
      cards: [
        {
          id: 'member',
          fields: [
            'member:phone',
            {
              field: 'member:ssn',
              visibleWhen: { type: 'app.rules.inGroup', parameters: ['member-services'] },
            },
          ],
        },
      ],
    };
    TestBed.inject(ExtensionRuleContextService).groups.set(['members']);
    expect((await render(member(), page)).querySelector('[data-field="member:ssn"]')).toBeNull();
    TestBed.inject(ExtensionRuleContextService).groups.set(['members', 'member-services']);
    expect(valueOf(await render(member(), page), 'member:ssn')).toBe('000-00-0000');
  });

  /** The reader keeps a field `fieldIn` shows by a number or a boolean, and the rule decides it. */
  it('shows a field by the number or the boolean that app.rules.fieldIn matches', async () => {
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    const page = (property: string, value: unknown) => ({
      version: 2,
      cards: [
        {
          id: 'member',
          fields: [
            'member:phone',
            {
              field: 'member:ssn',
              visibleWhen: { type: 'app.rules.fieldIn', parameters: [{ field: property }, value] },
            },
          ],
        },
      ],
    });
    const ssn = async (document: NuxeoDocument, content: Record<string, unknown>) =>
      valueOf(await render(document, content), 'member:ssn');

    expect(await ssn(member({ 'member:dues': 5000 }), page('member:dues', 5000))).toBe(
      '000-00-0000',
    );
    expect(await ssn(member({ 'member:dues': 4000 }), page('member:dues', 5000))).toBeUndefined();
    expect(await ssn(member({ 'member:vip': true }), page('member:vip', true))).toBe('000-00-0000');
    expect(await ssn(member({ 'member:vip': false }), page('member:vip', true))).toBeUndefined();
    expect(warnings.filter((warning) => warning.includes('left out'))).toEqual([]);
  });

  /** `core.choose` picks an id; the widget shows it by name, as a property's would be. */
  it('names a computed result shown as a user, a group or a vocabulary entry', async () => {
    const choose = (a: unknown, b: unknown) => ({
      type: 'core.choose',
      parameters: ['test.rules.canSeeService', a, b],
    });
    const root = await render(member(), {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            {
              id: 'manager',
              widget: 'user',
              computed: choose({ field: 'member:caseManager' }, 'x'),
            },
            { id: 'literal', widget: 'user', computed: choose('jdoe', 'x') },
            { id: 'team', widget: 'group', computed: choose('members', 'x') },
            {
              id: 'country',
              widget: 'vocabulary',
              parameters: { directory: 'country' },
              computed: choose('fr', 'de'),
            },
          ],
        },
      ],
    });
    expect(valueOf(root, 'manager')).toBe('Jane Doe');
    expect(valueOf(root, 'literal')).toBe('Jane Doe');
    expect(valueOf(root, 'team')).toBe('Member services');
    expect(valueOf(root, 'country')).toBe('France');
  });

  it("shows a table's vocabulary column by its label, from the column's own directory", async () => {
    const root = await render(member(), {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            {
              field: 'member:visits',
              widget: 'table',
              parameters: {
                columns: [
                  'visit:note',
                  {
                    field: 'visit:country',
                    widget: 'vocabulary',
                    parameters: { directory: 'country' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(
      [...root.querySelectorAll('[data-field="member:visits"] td')].map((cell) => cell.textContent),
    ).toEqual(['Called back', 'France']);
  });

  /** Its rules are never checked, so nothing in it is drawn: not a cell, not a heading. */
  it('leaves out a table inside a table, and shows the rest of the outer one', async () => {
    const root = await render(
      member({
        'member:visits': [
          { note: 'Called back', calls: [{ by: 'jdoe', secret: 'for the group only' }] },
        ],
      }),
      {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'member:visits',
                widget: 'table',
                parameters: {
                  columns: [
                    'visit:note',
                    {
                      field: 'visit:calls',
                      widget: 'table',
                      parameters: {
                        columns: [
                          'call:by',
                          {
                            field: 'call:secret',
                            visibleWhen: { type: 'app.rules.inGroup', parameters: ['g'] },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    );
    const table = root.querySelector('[data-field="member:visits"]');
    expect([...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim())).toEqual([
      'Note',
    ]);
    expect([...(table?.querySelectorAll('td') ?? [])].map((td) => td.textContent)).toEqual([
      'Called back',
    ]);
    expect(root.textContent).not.toContain('for the group only');
  });

  /** A cell is text: an entity is its character, and an escaped tag stays characters. */
  it("shows a table's rich-text cell as its words, entities read, never as markup", async () => {
    const root = await render(
      member({
        'member:visits': [
          {
            adjuster: 'jdoe',
            note: '<p>Under &lt;10, R&amp;D</p><p>&lt;img src="https://tracker.example/p.gif"&gt;</p>',
          },
        ],
      }),
      {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'member:visits',
                widget: 'table',
                parameters: { columns: [{ field: 'visit:note', widget: 'rich-text' }] },
              },
            ],
          },
        ],
      },
    );
    const cell = root.querySelector('[data-field="member:visits"] td');
    expect(cell?.textContent).toBe('Under <10, R&D <img src="https://tracker.example/p.gif">');
    expect(cell?.children).toHaveLength(0);
    expect(root.querySelector('img')).toBeNull();
  });

  /** A complex value with no widget is its sub-fields, in a cell as in a placeholder. */
  it('writes a complex value in a cell and in a placeholder, as its field lists it', async () => {
    const root = await render(
      member({
        'member:visits': [{ note: 'Called back', calls: [{ by: 'jdoe', secret: null }] }],
      }),
      {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                id: 'where',
                computed: { type: 'core.template', parameters: ['At {member:address}'] },
              },
              {
                field: 'member:visits',
                widget: 'table',
                parameters: { columns: ['visit:note', 'visit:calls'] },
              },
            ],
          },
        ],
      },
    );
    expect(valueOf(root, 'where')).toBe('At City: Springfield, Street: 1 Main St, Zip: 12345');
    expect(
      [...root.querySelectorAll('[data-field="member:visits"] td')].map((td) => td.textContent),
    ).toEqual(['Called back', 'By: jdoe']);
  });

  /** The validator takes a date widget on a computed field: a date the computation gives shows. */
  it("shows a computed date through a date widget, on the reader's day", async () => {
    timeZone = '+0530';
    const choose = {
      type: 'core.choose',
      parameters: ['test.rules.canSeeService', { field: 'member:visitedAt' }, 'x'],
    };
    const root = await render(member(), {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            { id: 'seen', widget: 'date', computed: choose },
            { id: 'seenAgo', widget: 'relative-date', computed: choose },
            { id: 'seenText', widget: 'text', computed: choose },
          ],
        },
      ],
    });
    expect(valueOf(root, 'seen')).toBe('November 24, 2026');
    expect(valueOf(root, 'seenAgo')).toBe('in 8 hours');
    expect(valueOf(root, 'seenText')).toBe('2026-11-23T20:00:00Z');
    // A result that is not a date is still left out, and the console says why.
    rules.canSeeService = false;
    const other = await render(member(), {
      version: 2,
      cards: [
        { id: 'a', fields: ['member:phone', { id: 'seen', widget: 'date', computed: choose }] },
      ],
    });
    expect(other.querySelector('[data-field="seen"]')).toBeNull();
    expect(warnings.some((warning) => warning.includes('does not show a string result'))).toBe(
      true,
    );
  });

  describe("a template's placeholder", () => {
    it('shows what the field showing its property shows: a name, a label, a day', async () => {
      // +05:30: 20:00 UTC on the 23rd is the 24th there, so a date read in UTC is a day out.
      timeZone = '+0530';
      const root = await render(member(), {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                id: 'summary',
                computed: {
                  type: 'core.template',
                  parameters: ['{member:caseManager}, {member:status}, {member:visitedAt}'],
                },
              },
              { field: 'member:caseManager', widget: 'user' },
              {
                field: 'member:status',
                widget: 'vocabulary',
                parameters: { directory: 'statuses' },
              },
              { field: 'member:visitedAt', widget: 'date' },
            ],
          },
        ],
      });
      expect(valueOf(root, 'member:caseManager')).toBe('Jane Doe');
      expect(valueOf(root, 'member:status')).toBe('Active');
      expect(valueOf(root, 'member:visitedAt')).toBe('November 24, 2026');
      expect(valueOf(root, 'summary')).toBe('Jane Doe, Active, November 24, 2026');
    });

    /** Its widget is what the property is, whether the field shows or its rule hides it. */
    it('shows a property through the widget of a field its rule hides', async () => {
      rules.canSeeService = false;
      const root = await render(member(), {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                id: 'manager',
                computed: { type: 'core.template', parameters: ['By {member:caseManager}'] },
              },
              {
                field: 'member:caseManager',
                widget: 'user',
                visibleWhen: 'test.rules.canSeeService',
              },
            ],
          },
        ],
      });
      expect(root.querySelector('[data-field="member:caseManager"]')).toBeNull();
      expect(valueOf(root, 'manager')).toBe('By Jane Doe');
    });

    /**
     * Pattern 29, with no widget anywhere: a stored day is the day written, and an instant the
     * reader's day, in a placeholder as in a field. One zone each side of UTC, each with an instant
     * whose day there is not its UTC day: version 1's view, in UTC, is a day out in both, and a
     * page that ignored its zone would be a day out in one of them wherever the suite runs.
     */
    it.each([
      ['+0530', '2026-11-23T20:00:00Z', 'November 24, 2026'],
      ['-0500', '2026-11-24T00:30:00Z', 'November 23, 2026'],
    ])("shows a date no widget names, at %s, on the reader's day", async (zone, at, day) => {
      timeZone = zone;
      const root = await render(member({ 'member:visitedAt': at }), {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                id: 'dates',
                computed: {
                  type: 'core.template',
                  parameters: ['Born {member:birthDate}, seen {member:visitedAt}'],
                },
              },
              'member:visitedAt',
            ],
          },
        ],
      });
      expect(valueOf(root, 'member:visitedAt')).toBe(day);
      expect(valueOf(root, 'dates')).toBe(`Born November 24, 1980, seen ${day}`);
    });
  });

  /** The validator lets a card show one property twice, so the page tracks each by its place. */
  it('shows one property twice, each through its own widget, each tracked apart', async () => {
    const root = await render(member(), {
      version: 2,
      cards: [
        {
          id: 'a',
          fields: [
            { field: 'member:birthDate', widget: 'date', parameters: { format: 'short' } },
            { field: 'member:birthDate', widget: 'date' },
          ],
        },
      ],
    });
    expect(
      [...root.querySelectorAll('[data-field="member:birthDate"] .record-page__value')].map(
        (value) => value.textContent?.trim(),
      ),
    ).toEqual(['11/24/80', 'November 24, 1980']);
    // Angular checks the keys when it reconciles a list it drew: a refetch, as a new object.
    fixture.componentRef.setInput('document', member({ 'member:birthDate': '1981-01-02' }));
    fixture.detectChanges();
    expect(
      [...root.querySelectorAll('[data-field="member:birthDate"] .record-page__value')].map(
        (value) => value.textContent?.trim(),
      ),
    ).toEqual(['1/2/81', 'January 2, 1981']);
    expect(warnings.filter((warning) => warning.includes('NG0955'))).toEqual([]);
  });

  it('shows an empty value as a dash', async () => {
    const root = await render(member({ 'member:phone': null }), {
      version: 2,
      cards: [{ id: 'a', fields: ['member:phone'] }],
    });
    expect(valueOf(root, 'member:phone')).toBe('—');
  });
  describe('related records', () => {
    /** The Member page's claims card, layout-v2.md section 9, with a column only some may see. */
    const CLAIMS_PAGE = {
      version: 2,
      columns: 2,
      cards: [
        { id: 'member', label: 'Member', fields: ['member:phone'] },
        {
          id: 'claims',
          label: 'Claims',
          span: 2,
          related: {
            pageProvider: 'member_claims',
            parameters: [{ field: 'ecm:uuid' }, { field: 'member:status' }],
            columns: [
              'claim:number',
              {
                field: 'claim:billedAmount',
                widget: 'currency',
                parameters: { currency: 'USD' },
                visibleWhen: 'test.rules.memberServices',
              },
              'claim:status',
            ],
            sort: [{ field: 'claim:serviceDate', order: 'desc' }],
          },
        },
      ],
    };

    const relatedList = (): RecordListComponent =>
      fixture.debugElement.query(By.directive(RecordListComponent))
        .componentInstance as RecordListComponent;

    it("lists the records in a card of their own, asked for with the open record's values", async () => {
      const root = await render(member(), CLAIMS_PAGE);
      const card = root.querySelector<HTMLElement>('[data-card-id="claims"]');
      expect(card?.querySelector('h3')?.textContent?.trim()).toBe('Claims');
      expect(card?.querySelector('lib-record-list')).not.toBeNull();
      expect(card?.querySelector('dl')).toBeNull();
      expect(execute).toHaveBeenCalledWith('member_claims', {
        parameters: ['m1', 'active'],
        pageSize: 10,
        pageIndex: 0,
        sort: [{ field: 'claim:serviceDate', order: 'desc' }],
      });
      expect(relatedList().label()).toBe('Claims');
      expect(relatedList().source()).toBe('Member/view layout: cards[1]');
    });

    it("shows a column only while its rule passes, as a field's does", async () => {
      await render(member(), CLAIMS_PAGE);
      expect(
        relatedList()
          .list()
          .columns.map((column) => column.xpath),
      ).toEqual(['claim:number', 'claim:status']);
      rules.memberServices = true;
      await render(member(), CLAIMS_PAGE);
      expect(
        relatedList()
          .list()
          .columns.map((column) => column.xpath),
      ).toEqual(['claim:number', 'claim:billedAmount', 'claim:status']);
      // Answered here, so that the list, which draws no column with a rule left to answer, draws it.
      expect(
        relatedList()
          .list()
          .columns.map((column) => column.visibleWhen),
      ).toEqual([null, null, null]);
      expect(relatedList()['shownColumns']()).toHaveLength(3);
    });

    it('offers the row actions the file lists, and none on a read-only page', async () => {
      const withActions = {
        ...CLAIMS_PAGE,
        cards: [
          CLAIMS_PAGE.cards[0],
          {
            ...CLAIMS_PAGE.cards[1],
            related: { ...CLAIMS_PAGE.cards[1].related, rowActions: ['app.rowActions.download'] },
          },
        ],
      };
      await render(member(), withActions);
      expect(relatedList().list().rowActions).toEqual(['app.rowActions.download']);
      await render(member(), withActions, true);
      expect(relatedList().list().rowActions).toEqual([]);
      // The rest of the list is drawn as it is anywhere else.
      expect(
        relatedList()
          .list()
          .columns.map((column) => column.xpath),
      ).toEqual(['claim:number', 'claim:status']);
    });

    it('does not ask for the list while a parameter has no value on the record, and says why', async () => {
      await render(member({ 'member:status': '' }), CLAIMS_PAGE);
      expect(relatedList().parameters()).toBeNull();
      expect(execute).not.toHaveBeenCalled();
      expect(warnings).toContain(
        '[agentic-ui-layouts] Member/view layout: cards[1]: not listed: parameters[1] reads member:status, which has no single value on this record',
      );
    });

    it('leaves out a card whose columns are all hidden by their rules', async () => {
      const root = await render(member(), {
        ...CLAIMS_PAGE,
        cards: [
          CLAIMS_PAGE.cards[0],
          {
            ...CLAIMS_PAGE.cards[1],
            related: {
              pageProvider: 'member_claims',
              columns: [{ field: 'claim:number', visibleWhen: 'test.rules.memberServices' }],
            },
          },
        ],
      });
      expect(root.querySelector('[data-card-id="claims"]')).toBeNull();
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('the timeline and comments', () => {
    /** A claim's page, as a kit writes one: its fields, its history and its comments. */
    const HISTORY_PAGE = {
      version: 2,
      columns: 2,
      cards: [
        { id: 'member', label: 'Member', fields: ['member:phone'] },
        {
          id: 'history',
          label: 'History',
          timeline: { events: ['documentModified', 'lifecycle_transition_event'], pageSize: 5 },
        },
        { id: 'notes', label: 'Comments', span: 2, comments: { pageSize: 2 } },
      ],
    };

    /** Comment documents, oldest first, as the thread reads them. */
    const thread = (...texts: string[]): NuxeoDocumentList => ({
      entries: texts.map((text, index): NuxeoDocument => ({
        uid: `k${index}`,
        title: `comment.${index}`,
        type: 'Comment',
        path: `/m1/Comments/comment.${index}`,
        lastModified: `2026-11-2${index}T09:00:00.000Z`,
        properties: {
          'comment:parentId': 'm1',
          'comment:text': text,
          'comment:author': 'jdoe',
          'comment:creationDate': `2026-11-2${index}T09:00:00.000Z`,
        },
      })),
      totalSize: texts.length,
      currentPageSize: texts.length,
      currentPageIndex: 0,
      numberOfPages: 1,
    });

    it('draws both cards from the layout file, each asking for the open record', async () => {
      documents.getAllComments.mockReturnValue(of(thread('First', 'Second', 'Third')));
      const root = await render(member(), HISTORY_PAGE);
      expect(
        [...root.querySelectorAll<HTMLElement>('.record-page__card')].map(
          (card) => card.dataset['cardId'],
        ),
      ).toEqual(['member', 'history', 'notes']);

      const history = root.querySelector<HTMLElement>('[data-card-id="history"]');
      expect(history?.querySelector('h3')?.textContent?.trim()).toBe('History');
      expect(history?.querySelector('lib-record-timeline')).not.toBeNull();
      expect(history?.querySelector('dl')).toBeNull();
      expect(documents.getAuditLog).toHaveBeenCalledWith('m1', 5, 0, {
        eventIds: ['documentModified', 'lifecycle_transition_event'],
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
      const timeline = fixture.debugElement.query(By.directive(RecordTimelineComponent))
        .componentInstance as RecordTimelineComponent;
      expect(timeline.label()).toBe('History');

      const notes = root.querySelector<HTMLElement>('[data-card-id="notes"]');
      expect(notes?.style.getPropertyValue('--record-card-span')).toBe('2');
      expect(documents.getAllComments).toHaveBeenCalledWith('m1');
      // The file's page size: the two newest, under a button for the rest.
      expect(
        [...(notes?.querySelectorAll('.nxs-comments__text') ?? [])].map((text) =>
          text.textContent?.trim(),
        ),
      ).toEqual(['Second', 'Third']);
    });

    it("adds the user's comment to the record's thread", async () => {
      documents.getAllComments.mockReturnValue(of(thread()));
      documents.createComment.mockReturnValue(
        of({
          id: 'k9',
          parentId: 'm1',
          text: 'Called the provider',
          author: 'jdoe',
          creationDate: '2026-11-23T09:00:00.000Z',
        }),
      );
      const root = await render(member(), HISTORY_PAGE);
      const box = root.querySelector<HTMLTextAreaElement>('[data-card-id="notes"] textarea');
      if (!box) throw new Error('no comment box');
      box.value = 'Called the provider';
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(documents.createComment).toHaveBeenCalledWith('m1', 'Called the provider');
      expect(
        root.querySelector('[data-card-id="notes"] .nxs-comments__text')?.textContent?.trim(),
      ).toBe('Called the provider');
    });

    it('draws the thread without the comment box on a read-only page', async () => {
      documents.getAllComments.mockReturnValue(of(thread('First')));
      const editable = await render(member(), HISTORY_PAGE);
      expect(editable.querySelector('[data-card-id="notes"] textarea')).not.toBeNull();

      const root = await render(member(), HISTORY_PAGE, true);
      const notes = root.querySelector<HTMLElement>('[data-card-id="notes"]');
      expect(notes?.querySelector('.nxs-comments__text')?.textContent?.trim()).toBe('First');
      expect(notes?.querySelector('textarea')).toBeNull();
      expect(documents.createComment).not.toHaveBeenCalled();
    });

    it('asks for neither while the rule of its card does not pass', async () => {
      rules.canSeeService = false;
      const root = await render(member(), {
        ...HISTORY_PAGE,
        cards: HISTORY_PAGE.cards.map((card) =>
          card.id === 'member' ? card : { ...card, visibleWhen: 'test.rules.canSeeService' },
        ),
      });
      expect(root.querySelector('[data-card-id="history"]')).toBeNull();
      expect(root.querySelector('[data-card-id="notes"]')).toBeNull();
      expect(documents.getAuditLog).not.toHaveBeenCalled();
      expect(documents.getAllComments).not.toHaveBeenCalled();
    });

    it('draws a timeline or comments inside a tab, as it draws any card', async () => {
      documents.getAllComments.mockReturnValue(of(thread('First')));
      const root = await render(member(), {
        version: 2,
        columns: 2,
        tabs: [
          { id: 'summary', label: 'Summary', cards: [HISTORY_PAGE.cards[0]] },
          { id: 'activity', label: 'Activity', cards: HISTORY_PAGE.cards.slice(1) },
        ],
      });
      const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Summary', 'Activity']);
      // A tab draws its cards when it is shown, so neither is asked for until then.
      expect(documents.getAuditLog).not.toHaveBeenCalled();
      expect(documents.getAllComments).not.toHaveBeenCalled();

      tabs[1].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(documents.getAuditLog).toHaveBeenCalledTimes(1);
      expect(root.querySelector('[data-tab-id="activity"] lib-record-timeline')).not.toBeNull();
      expect(
        root.querySelector('[data-tab-id="activity"] .nxs-comments__text')?.textContent?.trim(),
      ).toBe('First');
    });
  });

  describe('a card from another system', () => {
    const POLICY_PAGE = {
      version: 2,
      columns: 2,
      cards: [
        { id: 'member', label: 'Member', fields: ['member:phone'] },
        {
          id: 'policy',
          label: 'Policy',
          external: {
            connector: 'payers.memberPolicy',
            fields: [
              'policyNumber',
              { name: 'premium', widget: 'currency', parameters: { currency: 'USD' } },
              { name: 'internalRating', visibleWhen: 'test.rules.memberServices' },
            ],
          },
        },
      ],
    };

    it('draws it from the layout file, asking the connector for the open record', async () => {
      connectorRead.mockReturnValue(
        of({
          connector: 'payers.memberPolicy',
          status: 'found',
          fields: { policyNumber: 'POL-FICT-0048', premium: 120, internalRating: 'B' },
        }),
      );
      const root = await render(member(), POLICY_PAGE);

      const card = root.querySelector<HTMLElement>('[data-card-id="policy"]');
      expect(card?.querySelector('h3')?.textContent?.trim()).toBe('Policy');
      expect(card?.querySelector('lib-record-external')).not.toBeNull();
      expect(connectorRead).toHaveBeenCalledTimes(1);
      expect(connectorRead).toHaveBeenCalledWith('payers.memberPolicy', 'm1');
      // The page passes only the fields whose rules pass: member services' field is not drawn.
      expect(
        [...(card?.querySelectorAll<HTMLElement>('.record-external__field') ?? [])].map(
          (row) => row.dataset['field'],
        ),
      ).toEqual(['policyNumber', 'premium']);
      expect(card?.textContent).toContain('$120.00');
      expect(card?.textContent).not.toContain('Internal rating');
    });

    it('leaves the card out when no field of it passes its rule, and asks for nothing', async () => {
      const root = await render(member(), {
        version: 2,
        cards: [
          { id: 'member', label: 'Member', fields: ['member:phone'] },
          {
            id: 'policy',
            external: {
              connector: 'payers.memberPolicy',
              fields: [{ name: 'internalRating', visibleWhen: 'test.rules.memberServices' }],
            },
          },
        ],
      });
      expect(root.querySelector('[data-card-id="policy"]')).toBeNull();
      expect(connectorRead).not.toHaveBeenCalled();
    });
  });

  describe('a holds card and a related list New', () => {
    const HELD_PAGE = {
      version: 2,
      columns: 2,
      cards: [
        { id: 'member', label: 'Member', fields: ['member:phone'] },
        {
          id: 'holds',
          label: 'Holds',
          holds: { place: 'kit.placeHold', release: 'kit.releaseHold', pageSize: 5 },
        },
        {
          id: 'claims',
          label: 'Claims',
          related: {
            pageProvider: 'member_claims',
            parameters: [{ field: 'ecm:uuid' }],
            columns: ['dc:title'],
            create: { type: 'Claim', field: 'claim:member', label: 'New claim' },
          },
        },
      ],
    };

    it('draws the holds card from the platform, and asks the audit for its holds alone', async () => {
      const held = { ...member(), isRecord: true, hasLegalHold: true } as NuxeoDocument;
      const root = await render(held, HELD_PAGE);
      const card = root.querySelector<HTMLElement>('[data-card-id="holds"]');
      expect(card?.querySelector('h3')?.textContent?.trim()).toBe('Holds');
      expect(card?.querySelector('lib-record-holds')).not.toBeNull();
      expect(card?.querySelector('[data-fact="hold"] dd')?.textContent?.trim()).toBe(
        'On legal hold',
      );
      expect(documents.getAuditLog).toHaveBeenCalledWith('m1', 5, 0, {
        eventIds: ['afterSetLegalHold', 'afterRemoveLegalHold'],
        sortBy: 'eventDate',
        sortOrder: 'desc',
      });
    });

    it("offers the list's New over it, with the file's words, on a page that may change", async () => {
      const root = await render(
        { ...member(), parentRef: 'f0e1d2c3-b4a5-4968-8776-655443322110' },
        HELD_PAGE,
      );
      const card = root.querySelector<HTMLElement>('[data-card-id="claims"]');
      const create = card?.querySelector('lib-record-create');
      expect(create).not.toBeNull();
      // Before the list, so that it is met before the records it adds to.
      expect(create?.compareDocumentPosition(card?.querySelector('lib-record-list') as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const readOnly = await render(member(), HELD_PAGE, true);
      expect(readOnly.querySelector('[data-card-id="claims"] [data-record-create]')).toBeNull();
    });
  });

  describe('a checklist', () => {
    const ONBOARDING_PAGE = {
      version: 2,
      columns: 2,
      cards: [
        { id: 'member', label: 'Member', fields: ['member:phone'] },
        {
          id: 'onboarding',
          label: 'Onboarding',
          visibleWhen: 'test.rules.canSeeService',
          checklist: {
            field: 'member:onboarding',
            items: [
              { id: 'welcomeCall', label: 'Welcome call made' },
              { id: 'cardSent', labelKey: 'test.onboarding.cardSent' },
              { id: 'portal', label: 'Portal account opened' },
            ],
          },
        },
      ],
    };
    const ONBOARDED = [
      { item: 'cardSent', done: true, doneBy: 'jdoe', doneOn: '2026-11-03T00:00:00.000Z' },
      { item: 'welcomeCall', done: false, doneBy: 'jdoe', doneOn: '2026-11-02T00:00:00.000Z' },
      { item: 'legacyStep', done: true, doneBy: 'jdoe', doneOn: '2026-11-01T00:00:00.000Z' },
    ];
    /** Each item as drawn: its parts, `null` for one not drawn, and its icon by name. */
    const rowsOf = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('[data-card-id="onboarding"] li')].map((row) => {
        const part = (name: string): string | null =>
          row.querySelector(`.record-page__checklist-${name}`)?.textContent?.trim() ?? null;
        return {
          item: row.dataset['item'],
          done: row.dataset['done'],
          label: part('label'),
          state: part('state'),
          by: part('by'),
          on: part('on'),
          icon: row.querySelector('mat-icon')?.getAttribute('data-mat-icon-name'),
        };
      });

    it("draws the file's items, in its order, each done or not by the record, with who and when", async () => {
      const root = await render(member({ 'member:onboarding': ONBOARDED }), ONBOARDING_PAGE);
      const card = root.querySelector<HTMLElement>('[data-card-id="onboarding"]');
      expect(card?.querySelector('h3')?.textContent?.trim()).toBe('Onboarding');
      // A list, named by the card's heading through its section, and not a second time.
      expect(card?.getAttribute('aria-labelledby')).toBe('record-card-onboarding');
      expect(card?.querySelector('ul')?.getAttribute('role')).toBe('list');
      expect(card?.querySelector('ul')?.hasAttribute('aria-label')).toBe(false);
      // Each item's parts are read apart, by the commas only a screen reader hears.
      expect(
        card
          ?.querySelector('li[data-item="cardSent"] .record-page__checklist-text')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      ).toBe('Card sent, Done, Jane Doe, November 3, 2026');
      expect(card?.querySelector('.record-page__checklist-count')?.textContent?.trim()).toBe(
        '1 of 3 done',
      );
      expect(rowsOf(root)).toEqual([
        // Not done: its entry's who and when are not shown.
        {
          item: 'welcomeCall',
          done: 'false',
          label: 'Welcome call made',
          state: 'Not done',
          by: null,
          on: null,
          icon: 'circle_dot',
        },
        // A key with no text shows the item's id, made readable; the user by name.
        {
          item: 'cardSent',
          done: 'true',
          label: 'Card sent',
          state: 'Done',
          by: 'Jane Doe',
          on: 'November 3, 2026',
          icon: 'circle_check',
        },
        // No entry: required by the file, and not done.
        {
          item: 'portal',
          done: 'false',
          label: 'Portal account opened',
          state: 'Not done',
          by: null,
          on: null,
          icon: 'circle_dot',
        },
      ]);
      // An entry for an item the file does not list is not drawn.
      expect(card?.textContent).not.toContain('legacyStep');
      expect(card?.textContent).not.toContain('November 1, 2026');
    });

    it('names the list itself when its card has no heading', async () => {
      const root = await render(member({ 'member:onboarding': ONBOARDED }), {
        version: 2,
        cards: [
          {
            id: 'onboarding',
            checklist: { field: 'member:onboarding', items: [{ id: 'portal', label: 'Portal' }] },
          },
        ],
      });
      const card = root.querySelector('[data-card-id="onboarding"]');
      expect(card?.querySelector('h3')).toBeNull();
      expect(card?.querySelector('ul')?.getAttribute('aria-label')).toBe('Onboarding');
    });

    it("hides the card while its rule does not pass, as any card's", async () => {
      rules.canSeeService = false;
      const root = await render(member({ 'member:onboarding': ONBOARDED }), ONBOARDING_PAGE);
      expect(root.querySelector('[data-card-id="onboarding"]')).toBeNull();
      expect(root.querySelector('[data-card-id="member"]')).not.toBeNull();
    });

    it('shows every item not done on a record that holds no entry', async () => {
      const root = await render(member(), ONBOARDING_PAGE);
      expect(rowsOf(root).map((row) => row.done)).toEqual(['false', 'false', 'false']);
    });

    it('leaves out a card whose property the type does not have', async () => {
      const root = await render(member(), {
        version: 2,
        cards: [
          { id: 'member', fields: ['member:phone'] },
          {
            id: 'todo',
            checklist: { field: 'member:todo', items: [{ id: 'a', label: 'A' }] },
          },
        ],
      });
      expect(root.querySelector('[data-card-id="todo"]')).toBeNull();
    });
  });

  describe("a banner's link", () => {
    /** A banner that links to the record `member:referrer` names, as a superseded revision does. */
    const REFERRED = {
      version: 2,
      banners: [
        {
          id: 'referral',
          tone: 'warning',
          label: 'Referred by:',
          link: { field: 'member:referrer' },
        },
        { id: 'plain', label: 'No link here.' },
      ],
      cards: [{ id: 'member', label: 'Member', fields: ['member:phone'] }],
    };

    const linkOf = (root: HTMLElement, id: string) => {
      const button = root.querySelector<HTMLButtonElement>(
        `[data-banner-id="${id}"] .${BANNER_LINK_CLASS}`,
      );
      return button ? { text: button.textContent?.trim(), disabled: button.disabled } : null;
    };

    it("shows the linked record's title as the banner's action, which opens it through the router", async () => {
      const root = await render(member({ 'member:referrer': WEI }), REFERRED);
      // The icon is a ligature, aria-hidden, which `textContent` reads too.
      expect(linkOf(root, 'referral')).toEqual({ text: 'arrow_forward Wei Chen', disabled: false });
      expect(linkOf(root, 'plain')).toBeNull();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      root.querySelector<HTMLButtonElement>(`.${BANNER_LINK_CLASS}`)?.click();
      expect(navigate).toHaveBeenCalledWith(`/doc/${WEI}`);
    });

    it("reads the linked record with the fields' records, in the one request", async () => {
      await render(member({ 'member:referrer': WEI, 'member:household': [JOHN] }), {
        ...REFERRED,
        cards: [...REFERRED.cards, ...LINKS_PAGE.cards],
      });
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0][0]).toEqual([JOHN, WEI].sort());
    });

    it('offers no way to a record the reader may not read, and asks for no value that is not an id', async () => {
      const gone = await render(member({ 'member:referrer': GONE }), REFERRED);
      expect(linkOf(gone, 'referral')).toEqual({
        text: 'arrow_forward Unavailable',
        disabled: true,
      });
      fixture.destroy();
      const injected = "x' OR 1=1";
      const odd = await render(member({ 'member:referrer': injected }), REFERRED);
      expect(linkOf(odd, 'referral')).toEqual({
        text: 'arrow_forward Unavailable',
        disabled: true,
      });
      expect(linkedRecords.mock.calls.flatMap(([ids]) => ids)).not.toContain(injected);
      fixture.destroy();
      // No value at all: the message alone.
      expect(
        linkOf(await render(member({ 'member:referrer': '' }), REFERRED), 'referral'),
      ).toBeNull();
    });

    it('shows nothing while the record is read, then its title', async () => {
      const answer = new Subject<ReadonlyMap<string, LinkedRecord>>();
      linkedRecords.mockReturnValueOnce(answer);
      const root = await render(member({ 'member:referrer': WEI }), REFERRED);
      expect(linkOf(root, 'referral')).toBeNull();
      answer.next(linked([WEI]));
      answer.complete();
      fixture.detectChanges();
      expect(linkOf(root, 'referral')?.text).toBe('arrow_forward Wei Chen');
    });

    it('is shown but goes nowhere on a page drawn read-only, as the designer previews it', async () => {
      const root = await render(member({ 'member:referrer': WEI }), REFERRED, true);
      expect(linkOf(root, 'referral')).toEqual({ text: 'arrow_forward Wei Chen', disabled: true });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      root.querySelector<HTMLButtonElement>(`.${BANNER_LINK_CLASS}`)?.click();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('is left out, with the banner kept, for a property the type lacks or holds a list in', async () => {
      const lacking = await render(member({ 'member:referrer': WEI }), {
        ...REFERRED,
        banners: [{ ...REFERRED.banners[0], link: { field: 'member:nowhere' } }],
      });
      expect(lacking.querySelector('[data-banner-id="referral"]')).not.toBeNull();
      expect(linkOf(lacking, 'referral')).toBeNull();
      fixture.destroy();
      const list = await render(member({ 'member:household': [WEI] }), {
        ...REFERRED,
        banners: [{ ...REFERRED.banners[0], link: { field: 'member:household' } }],
      });
      expect(linkOf(list, 'referral')).toBeNull();
    });
  });

  describe('banners and a picture', () => {
    const RIGHTS = {
      version: 2,
      banners: [
        {
          id: 'rights-ended',
          tone: 'negative',
          label: 'The rights to this picture have ended.',
          visibleWhen: { type: 'app.rules.datePassed', parameters: [{ field: 'dc:expired' }] },
        },
        {
          id: 'rights-ending',
          tone: 'warning',
          label: 'The rights to this picture end within 30 days.',
          visibleWhen: {
            type: 'app.rules.dateWithin',
            parameters: [{ field: 'dc:expired' }, 30],
          },
        },
        { id: 'service', label: 'Member services only.', visibleWhen: 'test.rules.memberServices' },
      ],
      cards: [{ id: 'member', label: 'Member', fields: ['member:phone'] }],
    };

    const bannersOf = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('.record-page__banner')].map((banner) => ({
        id: banner.dataset['bannerId'],
        tone: banner.querySelector('.nxs-banner')?.getAttribute('data-tone'),
        text: banner.querySelector('.nxs-banner__message')?.textContent?.trim(),
      }));

    /**
     * The page's today, `RECORD_PAGE_TODAY`, months from the browser's, which is faked to
     * 24 November below: a banner that read the browser's clock would fall outside every window
     * these cases draw, so each of them fails if the rules stop reading the page's clock.
     */
    const PAGE_TODAY = new Date('2027-03-10T12:00:00Z');

    /**
     * The day `offset` days from the page's today, in the reader's zone, stored as Nuxeo stores a
     * day: its midnight UTC. Derived from the reader's own day on purpose: these cases are about
     * each rule's window, and hold in any zone; how a stored day and an instant are read in a zone
     * is `date-rules.spec.ts`'s, with literals in zones chosen either side of UTC, and the last
     * case here.
     */
    const storedDay = (offset: number): string => {
      const now = PAGE_TODAY;
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T00:00:00.000Z`;
    };

    beforeEach(() => {
      TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
      // Only `Date` is faked, so the page's own timers still run.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
      pageToday = PAGE_TODAY;
    });

    afterEach(() => vi.useRealTimers());

    const shownFor = async (expired: string): Promise<(string | undefined)[]> =>
      bannersOf(await render(member({ 'dc:expired': expired }), RIGHTS)).map((banner) => banner.id);

    it("reads its rules' today from the page's clock, not the browser's", async () => {
      // A day the browser's 24 November says is months away, and the page's 10 March says passed.
      expect(await shownFor('2027-03-09T00:00:00.000Z')).toEqual(['rights-ended']);
    });

    // RECORD_PAGE_TIME_ZONE is read once per test bed, so each zone has a case of its own. The
    // instant is 20:00 UTC on 9 March, the 9th in UTC and already the 10th at +05:30.
    it("reads an instant's day in the page's zone: east of UTC, still today", async () => {
      timeZone = '+0530';
      pageToday = new Date('2027-03-10T09:00:00Z');
      expect(await shownFor('2027-03-09T20:00:00Z')).toEqual(['rights-ending']);
    });

    it("reads an instant's day in the page's zone: in UTC, passed", async () => {
      timeZone = '+0000';
      pageToday = new Date('2027-03-10T09:00:00Z');
      expect(await shownFor('2027-03-09T20:00:00Z')).toEqual(['rights-ended']);
    });

    it('draws a banner while its date rule passes, above the cards', async () => {
      const root = await render(member({ 'dc:expired': storedDay(7) }), RIGHTS);
      expect(bannersOf(root)).toEqual([
        {
          id: 'rights-ending',
          tone: 'warning',
          text: 'The rights to this picture end within 30 days.',
        },
      ]);
      const page = root.querySelector('.record-page') as HTMLElement;
      expect(page.firstElementChild?.classList.contains('record-page__banners')).toBe(true);
    });

    it('draws the other banner once the date has passed, in its own tone', async () => {
      const root = await render(member({ 'dc:expired': storedDay(-1) }), RIGHTS);
      expect(bannersOf(root)).toEqual([
        {
          id: 'rights-ended',
          tone: 'error',
          text: 'The rights to this picture have ended.',
        },
      ]);
    });

    it('draws neither with no date, or one a day past the window, and follows any rule', async () => {
      expect(bannersOf(await render(member(), RIGHTS))).toEqual([]);
      fixture.destroy();
      expect(bannersOf(await render(member({ 'dc:expired': storedDay(31) }), RIGHTS))).toEqual([]);
      fixture.destroy();
      expect(
        bannersOf(await render(member({ 'dc:expired': storedDay(30) }), RIGHTS)).map(
          (banner) => banner.id,
        ),
      ).toEqual(['rights-ending']);
      fixture.destroy();
      rules.memberServices = true;
      expect(bannersOf(await render(member(), RIGHTS)).map((banner) => banner.id)).toEqual([
        'service',
      ]);
    });

    it("draws a banner above a file's tabs too", async () => {
      const root = await render(member({ 'dc:expired': storedDay(0) }), {
        version: 2,
        banners: RIGHTS.banners,
        tabs: [{ id: 'summary', label: 'Summary', cards: RIGHTS.cards }],
      });
      expect(bannersOf(root).map((banner) => banner.id)).toEqual(['rights-ending']);
      expect(
        root.querySelector(
          '.record-page__banners + .record-page__tabs, .record-page__banners ~ mat-tab-group',
        ),
      ).not.toBeNull();
    });

    it('draws them through the banner ID, so that an override of it reaches them', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        [NXS_PRIMITIVE_IDS.banner]: OverriddenBannerComponent,
      });
      const root = await render(member({ 'dc:expired': storedDay(-1) }), RIGHTS);
      expect(root.querySelector('.record-page__banner .nxs-banner')).toBeNull();
      expect(
        [...root.querySelectorAll('.record-page__banner .test-banner')].map((each) =>
          each.textContent?.trim(),
        ),
      ).toEqual(['error none: The rights to this picture have ended.']);
    });

    it("draws a picture's views first when the layout says so, and nothing of the kind otherwise", async () => {
      const plain = await render(member(), RIGHTS);
      expect(plain.querySelector('lib-record-picture-views')).toBeNull();
      fixture.destroy();

      fixture = TestBed.createComponent(RecordPageComponent);
      const views = [{ title: 'Medium', width: 10, height: 10, content: { digest: 'd' } }];
      fixture.componentRef.setInput(
        'document',
        member({ 'picture:views': views, 'dc:expired': storedDay(3) }),
      );
      fixture.componentRef.setInput('layout', { ...layoutOf(RIGHTS), preview: 'picture' });
      fixture.detectChanges();
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      const preview = root.querySelector('[data-preview="picture"]');
      expect(preview?.querySelector('lib-record-picture-views')).not.toBeNull();
      expect(preview?.getAttribute('aria-label')).toBe('Picture');
      // Under the banners, above the cards.
      expect(preview?.previousElementSibling?.classList.contains('record-page__banners')).toBe(
        true,
      );
      expect(preview?.nextElementSibling?.classList.contains('record-page__grid')).toBe(true);
      expect(documents.fetchBlobByXpath).toHaveBeenCalledWith('m1', 'picture:views/0/content');
      expect(preview?.querySelector('lib-record-picture-review')).toBeNull();
      expect(documents.getAnnotationDocuments).not.toHaveBeenCalled();
    });

    /** A video record, as Nuxeo 2025 writes one: two transcoded files and what it read of them. */
    const filmed = () =>
      member({
        'file:content': { name: 'film.webm', 'mime-type': 'video/webm', digest: 'o' },
        'vid:transcodedVideos': [
          { name: 'MP4 480p', content: { 'mime-type': 'video/mp4', digest: 'm' }, info: {} },
        ],
        'vid:info': { duration: 12, width: 160, height: 90, format: 'matroska,webm' },
        'dc:expired': storedDay(3),
      });

    it("draws a video's player first when the layout says so, under the banners and above the cards", async () => {
      fixture.destroy();
      fixture = TestBed.createComponent(RecordPageComponent);
      fixture.componentRef.setInput('document', filmed());
      fixture.componentRef.setInput('layout', { ...layoutOf(RIGHTS), preview: 'video' });
      fixture.detectChanges();
      await fixture.whenStable();
      // The outlet finds nothing registered, and the page draws its own player in its place.
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const preview = root.querySelector('[data-preview="video"]');
      expect(preview?.querySelector('lib-record-video')).not.toBeNull();
      expect(preview?.getAttribute('aria-label')).toBe('Video');
      expect(preview?.previousElementSibling?.classList.contains('record-page__banners')).toBe(
        true,
      );
      expect(preview?.nextElementSibling?.classList.contains('record-page__grid')).toBe(true);
      expect(documents.fetchRendition).toHaveBeenCalledWith('m1', 'MP4 480p');
      // A video is not a picture: neither its views nor a review are drawn.
      expect(root.querySelector('[data-preview="picture"]')).toBeNull();
      expect(root.querySelector('lib-record-picture-views')).toBeNull();
    });

    it('draws it through its ID, so that an override of it reaches the record page', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        [RECORD_VIDEO_ID]: OverriddenVideoComponent,
      });
      fixture.destroy();
      fixture = TestBed.createComponent(RecordPageComponent);
      fixture.componentRef.setInput('document', filmed());
      fixture.componentRef.setInput('layout', { ...layoutOf(RIGHTS), preview: 'video' });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const preview = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-preview="video"]',
      );
      expect(preview?.querySelector('lib-record-video')).toBeNull();
      expect(preview?.querySelector('.test-video')?.textContent?.trim()).toBe('m1 at level 3');
      expect(documents.fetchRendition).not.toHaveBeenCalled();
    });

    it('draws the picture as a review when the layout has one, its offers held back on a read-only page', async () => {
      fixture.destroy();
      const views = [{ title: 'Medium', width: 10, height: 10, content: { digest: 'd' } }];
      // As the layout service resolves a file with a review for a record that shows its picture.
      const reviewed = { ...layoutOf(RIGHTS), preview: 'picture' as const, review: true };
      // A pin is offered once a view is shown: the view answers, from a blob URL jsdom lacks.
      documents.fetchBlobByXpath.mockReturnValue(of(new Blob(['jpeg'], { type: 'image/jpeg' })));
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:view'), revokeObjectURL: vi.fn() });
      const draw = async (readOnly: boolean): Promise<HTMLElement> => {
        fixture = TestBed.createComponent(RecordPageComponent);
        fixture.componentRef.setInput('document', {
          ...member({ 'picture:views': views }),
          contextParameters: { permissions: ['Read', 'Write'] },
        });
        fixture.componentRef.setInput('layout', reviewed);
        fixture.componentRef.setInput('readOnly', readOnly);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
      };
      const root = await draw(false);
      const preview = root.querySelector('[data-preview="picture"]');
      expect(
        preview?.querySelector('lib-record-picture-review lib-record-picture-views'),
      ).not.toBeNull();
      expect(documents.getAnnotationDocuments).toHaveBeenCalledWith(
        'm1',
        'picture:views',
        'nuxeo-satori.review',
      );
      expect(preview?.querySelector('.record-review__add')).not.toBeNull();
      fixture.destroy();

      const readOnly = await draw(true);
      expect(readOnly.querySelector('lib-record-picture-review')).not.toBeNull();
      expect(readOnly.querySelector('.record-picture__image')).not.toBeNull();
      expect(readOnly.querySelector('.record-review__add')).toBeNull();
      // Destroyed first, so that it revokes its URL with the stand-ins, which then go.
      fixture.destroy();
      Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
    });

    it('lists the share links under the picture when the layout has them, held back on a read-only page', async () => {
      fixture.destroy();
      const views = [{ title: 'Medium', width: 10, height: 10, content: { digest: 'd' } }];
      // As the layout service resolves a file with share links for a record that shows its picture.
      const shared = { ...layoutOf(RIGHTS), preview: 'picture' as const, shareLinks: true };
      const draw = async (layout: ResolvedRecordLayout, readOnly = false): Promise<HTMLElement> => {
        fixture = TestBed.createComponent(RecordPageComponent);
        fixture.componentRef.setInput('document', member({ 'picture:views': views }));
        fixture.componentRef.setInput('layout', layout);
        fixture.componentRef.setInput('readOnly', readOnly);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
      };
      const root = await draw(shared);
      const links = root.querySelector('lib-record-share-links');
      // After the picture, above the cards.
      expect(links?.previousElementSibling?.getAttribute('data-preview')).toBe('picture');
      expect(links?.nextElementSibling?.classList.contains('record-page__grid')).toBe(true);
      expect(shareLinks.list).toHaveBeenCalledWith('m1');
      expect(links?.querySelector('.record-share-links__form')).not.toBeNull();
      fixture.destroy();

      const readOnly = await draw(shared, true);
      expect(readOnly.querySelector('lib-record-share-links')).not.toBeNull();
      expect(readOnly.querySelector('.record-share-links__form')).toBeNull();
      fixture.destroy();

      shareLinks.list.mockClear();
      const without = await draw({ ...shared, shareLinks: false });
      expect(without.querySelector('lib-record-share-links')).toBeNull();
      expect(shareLinks.list).not.toHaveBeenCalled();
    });
  });
});
