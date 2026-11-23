import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition } from '../layout.model';
import { readRecordLayout } from './record-layout';
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
      'member:address': { street: '1 Main St', city: 'Springfield', zip: '12345' },
      ...overrides,
    },
  }) as NuxeoDocument;

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
  let warnings: string[];

  beforeEach(() => {
    rules = { memberServices: false, canSeeService: true };
    principal = (kind, id) => of(kind === 'user' && id === 'jdoe' ? 'Jane Doe' : null);
    warnings = [];
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
            vocabularyLabel: () => of(null),
            principalLabel: (kind: string, id: string) => principal(kind, id),
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
    fixture.detectChanges();
    expect(
      warnings.filter((warning) => warning.includes('cards[0].fields[1] left out')),
    ).toHaveLength(1);
  });

  it('shows an empty value as a dash', async () => {
    const root = await render(member({ 'member:phone': null }), {
      version: 2,
      cards: [{ id: 'a', fields: ['member:phone'] }],
    });
    expect(valueOf(root, 'member:phone')).toBe('—');
  });
});
