import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  AppExtensionsService,
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import { DirectoryService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { readFormLayout } from '../form-layout/form-layout';
import { resolveFormLayout, type ResolvedFormLayout } from '../form-layout/resolve-form-layout';
import type { DocumentTypeDefinition } from '../layout.model';
import type { LinkedRecord } from '../record-page/linked-record';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from '../record-page/record-clock';
import { DocumentLayoutFormComponent } from './document-layout-form';

// An edit and a create form drawn from a version 2 file (layout-v2.md): its cards, each widget as
// its field's input, fields required and read-only by rule, and checks across fields, with the
// rules reading the values as they are entered. The rules are the platform's own evaluators.

const CLAIM_TYPE: DocumentTypeDefinition = {
  name: 'Claim',
  schemas: [
    {
      name: 'claim',
      prefix: 'claim',
      fields: {
        number: { type: 'string' },
        status: { type: 'string' },
        billed: { type: 'double' },
        allowed: { type: 'double' },
        denial: { type: 'string' },
        notes: { type: 'string' },
        member: { type: 'string' },
      },
    },
    { name: 'dublincore', prefix: 'dc', fields: { title: { type: 'string' } } },
  ],
};

const status = (...values: string[]) => ({
  type: 'app.rules.fieldIn',
  parameters: [{ field: 'claim:status' }, ...values],
});

const CLAIM_EDIT = {
  version: 2,
  cards: [
    {
      id: 'claim',
      label: 'Claim',
      fields: [
        'claim:number',
        'claim:status',
        {
          field: 'claim:billed',
          label: 'Billed',
          widget: 'currency',
          parameters: { currency: 'USD' },
        },
        {
          field: 'claim:allowed',
          label: 'Allowed',
          widget: 'currency',
          parameters: { currency: 'USD' },
          required: status('approved'),
          checks: [
            {
              type: 'core.atMost',
              parameters: [{ field: 'claim:billed' }],
              label: 'No more than the billed amount',
            },
          ],
        },
        { field: 'claim:denial', label: 'Denial reason', visibleWhen: status('denied') },
        {
          field: 'claim:notes',
          label: 'Notes',
          widget: 'long-text',
          readOnlyWhen: status('closed'),
        },
      ],
    },
  ],
};

const CLAIM: NuxeoDocument = Object.assign(
  {
    uid: 'c1',
    title: 'Claim CLM-1',
    type: 'Claim',
    path: '/default-domain/workspaces/ws/c1',
    lastModified: '',
    properties: {
      'dc:title': 'Claim CLM-1',
      'claim:number': 'CLM-1',
      'claim:status': 'open',
      'claim:billed': 1200,
      'claim:allowed': null,
      'claim:notes': 'First look',
    },
    facets: [],
  },
  { schemas: [{ name: 'claim', prefix: 'claim' }] },
);

const MEMBER = 'a00e20f3-1398-4b64-827e-628bfdada64c';

describe('DocumentLayoutFormComponent, with a version 2 file', () => {
  let fixture: ComponentFixture<DocumentLayoutFormComponent>;
  let form: DocumentLayoutFormComponent;
  let formLayoutFor: ReturnType<typeof vi.fn>;
  let linkedRecords: ReturnType<
    typeof vi.fn<(ids: readonly string[]) => Observable<ReadonlyMap<string, LinkedRecord> | null>>
  >;
  let warnings: string[];

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const host = (): HTMLElement => fixture.nativeElement;
  const input$ = (xpath: string) =>
    host().querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `input[data-xpath="${xpath}"], textarea[data-xpath="${xpath}"]`,
    );
  const type = async (xpath: string, text: string) => {
    const field = input$(xpath);
    if (!field) throw new Error(`no field ${xpath}`);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('blur'));
    await settle();
  };
  const errors = () =>
    [...host().querySelectorAll('mat-error')].map((node) => node.textContent?.trim());
  const labels = () =>
    [...host().querySelectorAll('mat-label, .nxs-metadata-editor__read-only-label')].map((node) =>
      node.textContent?.trim(),
    );

  function layoutOf(content: Record<string, unknown>, mode: 'edit' | 'create'): ResolvedFormLayout {
    const file = readFormLayout(content, mode, {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    if ('invalid' in file) throw new Error(file.invalid);
    return resolveFormLayout(CLAIM_TYPE, file).layout;
  }

  async function render(
    inputs: Record<string, unknown>,
    content: Record<string, unknown> = CLAIM_EDIT,
  ) {
    const mode = inputs['mode'] === 'create' ? 'create' : 'edit';
    formLayoutFor.mockReturnValue(of(layoutOf(content, mode)));
    fixture = TestBed.createComponent(DocumentLayoutFormComponent);
    form = fixture.componentInstance;
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle();
  }

  beforeEach(() => {
    formLayoutFor = vi.fn();
    linkedRecords = vi.fn((ids: readonly string[]) =>
      of(
        new Map(
          ids
            .filter((id) => id === MEMBER)
            .map((id): [string, LinkedRecord] => [id, { title: 'Wei Chen', url: `/doc/${id}` }]),
        ),
      ),
    );
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    TestBed.configureTestingModule({
      imports: [DocumentLayoutFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DocumentLayoutService,
          useValue: {
            formLayoutFor,
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            linkedRecords: (ids: readonly string[]) => linkedRecords(ids),
          },
        },
        { provide: AppExtensionsService, useValue: { resolve: () => [] } },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
  });

  afterEach(() => vi.restoreAllMocks());

  it('draws only what the file lists, its cards as sections, and no Dublin Core of its own', async () => {
    await render({ mode: 'edit', document: CLAIM });
    expect(host().querySelector('[data-layout-source="version-2"]')).not.toBeNull();
    expect(host().querySelector('[role="heading"]')?.textContent?.trim()).toBe('Claim');
    expect(input$('dc:title')).toBeNull();
    expect(labels()).toEqual(['Number', 'Status', 'Billed (USD)', 'Allowed (USD)', 'Notes']);
    expect(input$('claim:number')?.value).toBe('CLM-1');
    expect(input$('claim:notes')?.tagName).toBe('TEXTAREA');
  });

  it('makes a field required as soon as the value its rule reads is entered', async () => {
    await render({ mode: 'edit', document: CLAIM });
    expect(form.validate()).toBe(true);
    await type('claim:status', 'approved');
    expect(form.validate()).toBe(false);
    await settle();
    expect(errors()).toContain('Allowed (USD) is required.');
    await type('claim:allowed', '1000');
    expect(form.validate()).toBe(true);
    expect(form.changedProperties()).toEqual({ 'claim:status': 'approved', 'claim:allowed': 1000 });
  });

  it('shows a field when another field’s value is chosen, and sends nothing it no longer shows', async () => {
    await render({ mode: 'edit', document: CLAIM });
    expect(input$('claim:denial')).toBeNull();
    await type('claim:status', 'denied');
    expect(input$('claim:denial')).not.toBeNull();
    await type('claim:denial', 'Not covered');
    expect(form.changedProperties()).toEqual({
      'claim:status': 'denied',
      'claim:denial': 'Not covered',
    });
    await type('claim:status', 'open');
    expect(input$('claim:denial')).toBeNull();
    expect(form.changedProperties()).toEqual({ 'claim:status': 'open' });
  });

  it('stops the save on a failed check, with its message beside the field', async () => {
    await render({ mode: 'edit', document: CLAIM });
    await type('claim:allowed', '1500');
    expect(form.validate()).toBe(false);
    await settle();
    expect(errors()).toEqual(['No more than the billed amount']);
    // The bound is a field too: raising it lets the value through.
    await type('claim:billed', '2000');
    expect(form.validate()).toBe(true);
    await settle();
    expect(errors()).toEqual([]);
  });

  it('makes a field read-only by rule, as the document holds it, and never sends it', async () => {
    await render({ mode: 'edit', document: CLAIM });
    await type('claim:notes', 'Second look');
    expect(form.changedProperties()['claim:notes']).toBe('Second look');
    await type('claim:status', 'closed');
    expect(input$('claim:notes')).toBeNull();
    const notes = host().querySelector('.nxs-metadata-editor__read-only[data-xpath="claim:notes"]');
    expect(notes?.textContent).toContain('First look');
    expect(form.changedProperties()).toEqual({ 'claim:status': 'closed' });
  });

  it("shows a read-only document-link as the linked record's title, never its id", async () => {
    const content = {
      version: 2,
      cards: [
        {
          id: 'claim',
          fields: [
            'claim:status',
            {
              field: 'claim:member',
              label: 'Member',
              widget: 'document-link',
              readOnlyWhen: status('closed'),
            },
          ],
        },
      ],
    };
    const closed = { ...CLAIM, properties: { ...CLAIM.properties, 'claim:status': 'closed' } };
    await render(
      {
        mode: 'edit',
        document: { ...closed, properties: { ...closed.properties, 'claim:member': MEMBER } },
      },
      content,
    );
    const member = host().querySelector(
      '.nxs-metadata-editor__read-only[data-xpath="claim:member"]',
    );
    expect(member?.textContent).toContain('Wei Chen');
    expect(member?.textContent).not.toContain(MEMBER);
    expect(linkedRecords).toHaveBeenCalledTimes(1);
    expect(linkedRecords.mock.calls[0][0]).toEqual([MEMBER]);
  });

  it('puts Nuxeo’s messages on their fields, as a version 1 form does', async () => {
    await render({ mode: 'edit', document: CLAIM });
    expect(form.showServerErrors({ 'claim:number': 'Taken', 'x:y': 'Elsewhere' })).toEqual([
      'Elsewhere',
    ]);
    await settle();
    expect(errors()).toContain('Taken');
  });

  it('draws a create form from its create file, its rules reading the values entered', async () => {
    await render({ mode: 'create', type: 'Claim', parentPath: '/ws' });
    expect(formLayoutFor).toHaveBeenCalledWith('Claim', 'create', []);
    expect(input$('claim:number')?.value).toBe('');
    await type('claim:status', 'approved');
    expect(form.validate()).toBe(false);
    await type('claim:allowed', '10');
    await type('claim:number', 'CLM-9');
    expect(form.validate()).toBe(true);
    expect(form.changedProperties()).toEqual({
      'claim:number': 'CLM-9',
      'claim:status': 'approved',
      'claim:allowed': 10,
    });
  });

  it('keeps reading what was typed in a create form when its folder changes', async () => {
    await render({ mode: 'create', type: 'Claim', parentPath: '/ws' });
    await type('claim:billed', '1000');
    await type('claim:allowed', '1500');
    expect(form.validate()).toBe(false);
    fixture.componentRef.setInput('parentPath', '/ws/other');
    await settle();
    // The editor keeps what was typed, so the check that compares it must still fail.
    expect(input$('claim:allowed')?.value).toBe('1500');
    expect(form.validate()).toBe(false);
    await settle();
    expect(errors()).toEqual(['No more than the billed amount']);
  });

  it('draws tabs as tabs', async () => {
    await render(
      { mode: 'edit', document: CLAIM },
      {
        version: 2,
        tabs: [
          { id: 'main', label: 'Main', cards: [{ id: 'a', fields: ['claim:number'] }] },
          { id: 'more', label: 'More', cards: [{ id: 'b', fields: ['claim:notes'] }] },
        ],
      },
    );
    const tabs = [...host().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['Main', 'More']);
  });

  it('says once in the console why a check could not compare, and lets the save through', async () => {
    await render(
      {
        mode: 'edit',
        document: { ...CLAIM, properties: { ...CLAIM.properties, 'claim:notes': 'x' } },
      },
      {
        version: 2,
        cards: [
          {
            id: 'a',
            fields: [
              {
                field: 'claim:allowed',
                checks: [{ type: 'core.atMost', parameters: [{ field: 'claim:notes' }] }],
              },
            ],
          },
        ],
      },
    );
    await type('claim:allowed', '5');
    await type('claim:allowed', '6');
    expect(form.validate()).toBe(true);
    expect(warnings.filter((message) => message.includes('not checked'))).toEqual([
      '[agentic-ui-layouts] Claim/edit layout: cards[0].fields[0].checks[0] not checked: core.atMost compares numbers, not "x"',
    ]);
  });

  it("reads its date rules against the page's clock, not the browser's", async () => {
    // The browser's clock says 1 November, and the page's, RECORD_PAGE_TODAY, 23 November: the
    // 22nd has passed on the page's day only, and is within 30 days of the browser's only.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    try {
      await render(
        { mode: 'edit', document: CLAIM },
        {
          version: 2,
          cards: [
            {
              id: 'claim',
              label: 'Claim',
              fields: [
                'claim:number',
                {
                  field: 'claim:denial',
                  visibleWhen: { type: 'app.rules.datePassed', parameters: ['2026-11-22'] },
                },
                {
                  field: 'claim:notes',
                  visibleWhen: { type: 'app.rules.dateWithin', parameters: ['2026-11-22', 30] },
                },
              ],
            },
          ],
        },
      );
      expect(input$('claim:number')).not.toBeNull();
      expect(input$('claim:denial')).not.toBeNull();
      expect(input$('claim:notes')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
