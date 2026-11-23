import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition } from '../layout.model';
import { readRecordLayout } from './record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY, RecordPageComponent } from './record-page';
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
        visits: {
          type: 'complex[]',
          fields: {
            adjuster: { type: 'string' },
            note: { type: 'string' },
            country: { type: 'string' },
          },
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

/** The Member page of layout-v2.md, section 9, without the related lists this build does not draw. */
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
  const read = readRecordLayout(content, TestBed.inject(ExtensionRuleRegistry).registeredRuleIds());
  if ('invalid' in read) throw new Error(read.invalid);
  return resolveRecordLayout(MEMBER_TYPE, read).layout;
}

describe('RecordPageComponent', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let rules: { memberServices: boolean; canSeeService: boolean };
  let principal: (kind: string, id: string) => Observable<string | null>;
  let vocabularyLabel: (directory: string, id: string) => Observable<string | null>;
  /** The zone the page shows an instant in: the process's own, unless a test chooses one. */
  let timeZone: string | undefined;
  let warnings: string[];

  beforeEach(() => {
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
    warnings = [];
    timeZone = undefined;
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      imports: [RecordPageComponent],
      providers: [
        provideNxsComponents(),
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: (directory: string, id: string) => vocabularyLabel(directory, id),
            principalLabel: (kind: string, id: string) => principal(kind, id),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useFactory: () => timeZone },
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
    const read = readRecordLayout(
      GREETING_PAGE,
      TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    );
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

  it('shows an empty value as a dash', async () => {
    const root = await render(member({ 'member:phone': null }), {
      version: 2,
      cards: [{ id: 'a', fields: ['member:phone'] }],
    });
    expect(valueOf(root, 'member:phone')).toBe('—');
  });
});
