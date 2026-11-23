import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import { type NuxeoDocument, PageProviderService } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition } from '../layout.model';
import { readRecordLayout } from './record-layout';
import { RecordListComponent } from './record-list';
import { RECORD_PAGE_TODAY, RecordPageComponent } from './record-page';
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
        phone: { type: 'string' },
        status: { type: 'string' },
        ssn: { type: 'string' },
        notes: { type: 'string' },
        caseManager: { type: 'string' },
        visits: {
          type: 'complex[]',
          fields: { adjuster: { type: 'string' }, note: { type: 'string' } },
        },
        address: {
          type: 'complex',
          fields: { street: { type: 'string' }, city: { type: 'string' }, zip: { type: 'string' } },
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
      'member:phone': '+1 555 0100',
      'member:status': 'active',
      'member:ssn': '000-00-0000',
      'member:notes': '<p>Prefers <b>email</b><script>alert(1)</script></p>',
      'member:caseManager': 'jdoe',
      'member:visits': [{ adjuster: 'jdoe', note: 'Called back' }],
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

describe('RecordPageComponent', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let rules: { memberServices: boolean; canSeeService: boolean };
  let principal: (kind: string, id: string) => Observable<string | null>;
  let warnings: string[];
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execute = vi.fn(() => new Subject());
    rules = { memberServices: false, canSeeService: true };
    principal = (kind, id) => of(kind === 'user' && id === 'jdoe' ? 'Jane Doe' : null);
    warnings = [];
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
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: () => of(null),
            principalLabel: (kind: string, id: string) => principal(kind, id),
            rowPropertiesOf: () => of(new Map()),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
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
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordPageComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('layout', layoutOf(content));
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
    const root = await render();
    expect(valueOf(root, 'name')).toBe('Jane Roe');
    // Born 24 November 1980: 45 on 23 November 2026, the day before the birthday.
    expect(valueOf(root, 'age')).toBe('45');
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

  it("shows rich text through the platform's sanitiser: formatting kept, script gone", async () => {
    const root = await render();
    const notes = root.querySelector('[data-field="member:notes"] .record-page__rich-text');
    expect(notes?.querySelector('b')?.textContent).toBe('email');
    expect(notes?.querySelector('script')).toBeNull();
    expect(notes?.innerHTML).not.toContain('alert');
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
});
