import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, Subject, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { readLayoutFile } from '../layout-file';
import { DocumentTypeDefinition, LayoutSection, ResolvedLayout } from '../layout.model';
import type { LinkedRecord } from '../record-page/linked-record';
import { applyLayoutFile, generateLayout, readDocumentType } from '../resolve-layout';
import { DOCUMENT_LAYOUT_TIME_ZONE, DocumentLayoutComponent } from './document-layout';

const TITLES: Readonly<Record<string, string>> = {
  'a00e20f3-1398-4b64-827e-628bfdada64c': 'Wei Chen',
  '9cd9b1cf-6f0b-442f-afa0-c2539996ba30': 'John Smith',
};

/** What the search returns for `ids`: the records the reader may read. */
const linked = (ids: readonly string[]): ReadonlyMap<string, LinkedRecord> =>
  new Map(
    ids
      .filter((id) => id in TITLES)
      .map((id): [string, LinkedRecord] => [id, { title: TITLES[id], url: `/doc/${id}` }]),
  );

const claimDocument = (overrides: Record<string, unknown> = {}): NuxeoDocument =>
  ({
    uid: 'c1',
    title: 'Claim CLM-1',
    type: 'Claim',
    path: '/c1',
    lastModified: '',
    properties: {
      'claim:number': 'CLM-1',
      'claim:status': 'pending',
      'claim:urgent': true,
      'claim:serviceDate': '2026-09-14T12:00:00.000Z',
      'claim:codes': ['R51.9', 'G44.209'],
      ...overrides,
    },
  }) as NuxeoDocument;

const field = (
  xpath: string,
  type: string,
  extra: Record<string, unknown> = {},
  label: Record<string, unknown> = {},
) => ({
  xpath,
  definition: { type, ...extra },
  label: { keys: [`layout.field.${xpath}`], fallback: xpath.split(':')[1] ?? xpath, ...label },
});

const claimSection: LayoutSection = {
  id: 'claim',
  label: { keys: ['layout.schema.claim'], fallback: 'Claim' },
  fields: [
    field('claim:number', 'string'),
    field('claim:status', 'string', { directory: 'claim_status' }),
    field('claim:urgent', 'boolean'),
    field('claim:serviceDate', 'date'),
    field('claim:codes', 'string[]'),
  ],
};

const layout = (overrides: Partial<ResolvedLayout> = {}): ResolvedLayout => ({
  type: 'Claim',
  mode: 'metadata',
  source: 'generated',
  display: 'sections',
  sections: [claimSection],
  ...overrides,
});

@Component({
  selector: 'lib-acme-claim-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<p class="acme-claim-panel">{{ heading() }}: {{ document()?.title }}</p>`,
})
class ClaimPanelComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly heading = input('');
}

describe('DocumentLayoutComponent', () => {
  let fixture: ComponentFixture<DocumentLayoutComponent>;
  let slotEntries: Record<string, ExtensionDocumentLayoutDescriptor[]>;
  let resolve: ReturnType<
    typeof vi.fn<
      (slot: string, context?: ExtensionRuleContext) => ExtensionDocumentLayoutDescriptor[]
    >
  >;
  let layoutFor: ReturnType<
    typeof vi.fn<
      (
        type: string,
        mode: string,
        schemas: readonly { name: string; prefix: string }[],
      ) => Observable<ResolvedLayout | null>
    >
  >;
  let vocabularyLabel: ReturnType<
    typeof vi.fn<(directory: string, id: string) => Observable<string | null>>
  >;
  /** The linked records' search: each call is one request, with the ids it was given. */
  let linkedRecords: ReturnType<
    typeof vi.fn<(ids: readonly string[]) => Observable<ReadonlyMap<string, LinkedRecord> | null>>
  >;
  const LABELS: Record<string, string> = {
    'claim_status/pending': 'Pending review',
    'claim_status/approved': 'Approved',
    'l10nsubjects/architecture': 'Art/Architecture',
  };

  async function render(document: NuxeoDocument | null, answer: ResolvedLayout | null = layout()) {
    layoutFor.mockReturnValue(of(answer));
    fixture = TestBed.createComponent(DocumentLayoutComponent);
    fixture.componentRef.setInput('document', document);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (selector: string) =>
    host().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const value = (xpath: string) => text(`[data-field="${xpath}"] .document-layout__value`);
  const labelOf = (xpath: string) => text(`[data-field="${xpath}"] .document-layout__label`);

  beforeEach(() => {
    layoutFor = vi.fn();
    slotEntries = {};
    resolve = vi.fn((slot: string) => slotEntries[slot] ?? []);
    vocabularyLabel = vi.fn((directory: string, id: string) =>
      of(LABELS[`${directory}/${id}`] ?? null),
    );
    linkedRecords = vi.fn((ids: readonly string[]) => of(linked(ids)));
    TestBed.configureTestingModule({
      imports: [DocumentLayoutComponent],
      providers: [
        provideRouter([]),
        {
          provide: DocumentLayoutService,
          useValue: {
            layoutFor,
            vocabularyLabel,
            linkedRecords: (ids: readonly string[]) => linkedRecords(ids),
          },
        },
        { provide: AppExtensionsService, useValue: { resolve } },
        // A named offset rather than the host's zone, for every case that renders a date: a
        // midday instant is the next day at +13, Auckland in summer (pattern 29).
        { provide: DOCUMENT_LAYOUT_TIME_ZONE, useValue: '+0530' },
      ],
    });
  });

  it('asks for the layout of the document type in the given mode', async () => {
    await render(claimDocument());
    expect(layoutFor).toHaveBeenCalledWith('Claim', 'metadata', []);
  });

  const carrying = (document: NuxeoDocument, ...names: string[]): NuxeoDocument =>
    Object.assign(document, { schemas: names.map((name) => ({ name, prefix: name })) });

  it('passes the schemas the document reports, its facets included, sorted by name', async () => {
    await render(carrying(claimDocument(), 'dublincore', 'hxai', 'claim', 'externalEntity'));
    expect(layoutFor).toHaveBeenCalledWith('Claim', 'metadata', [
      { name: 'claim', prefix: 'claim' },
      { name: 'dublincore', prefix: 'dublincore' },
      { name: 'externalEntity', prefix: 'externalEntity' },
      { name: 'hxai', prefix: 'hxai' },
    ]);
  });

  it('renders each section with its heading and each field by its type', async () => {
    await render(claimDocument());
    expect(host().querySelector('[data-layout-source="generated"]')).not.toBeNull();
    expect(text('[data-section-id="claim"] .document-layout__heading')).toBe('Claim');
    expect(
      host().querySelector('[data-section-id="claim"] .document-layout__heading')?.tagName,
    ).toBe('H4');
    expect(value('claim:number')).toBe('CLM-1');
    expect(value('claim:status')).toBe('Pending review');
    expect(value('claim:urgent')).toBe('Yes');
    expect(value('claim:serviceDate')).toBe('September 14, 2026');
    expect(
      [...host().querySelectorAll('[data-field="claim:codes"] .document-layout__chip')].map(
        (chip) => chip.textContent?.trim(),
      ),
    ).toEqual(['R51.9', 'G44.209']);
    expect(vocabularyLabel.mock.calls).toEqual([['claim_status', 'pending']]);
  });

  describe('the zone a date is shown in', () => {
    it('is the reader’s own unless a test chooses one', () => {
      // Without this suite's provider, as the panel runs.
      TestBed.resetTestingModule();
      expect(TestBed.inject(DOCUMENT_LAYOUT_TIME_ZONE)).toBeUndefined();
    });

    it.each<[string, string, string]>([
      // The zone, the value, and the day shown. Each value's other reading is the other day.
      ['+0530', '2026-11-23T20:00:00.000Z', 'November 24, 2026'],
      ['-0500', '2026-11-24T03:00:00.000Z', 'November 23, 2026'],
      ['-0500', '2026-11-24T00:00:00.000Z', 'November 24, 2026'],
    ])('at %s shows %s on %s', async (zone, serviceDate, expected) => {
      TestBed.overrideProvider(DOCUMENT_LAYOUT_TIME_ZONE, { useValue: zone });
      await render(claimDocument({ 'claim:serviceDate': serviceDate }));
      expect(value('claim:serviceDate')).toBe(expected);
    });
  });

  it('translates a boolean false as No and an unset value as a dash', async () => {
    await render(claimDocument({ 'claim:urgent': false, 'claim:number': null }));
    expect(value('claim:urgent')).toBe('No');
    expect(value('claim:number')).toBe('—');
  });

  it('labels each listed value by its own entry, and shows the id of one with no label', async () => {
    const subjects = {
      ...claimSection,
      fields: [field('dc:subjects', 'string[]', { directory: 'l10nsubjects' })],
    };
    await render(
      claimDocument({ 'dc:subjects': ['architecture', 'unknown'] }),
      layout({ sections: [subjects] }),
    );
    expect(
      [...host().querySelectorAll('[data-field="dc:subjects"] .document-layout__chip')].map(
        (chip) => chip.textContent?.trim(),
      ),
    ).toEqual(['Art/Architecture', 'unknown']);
    expect(vocabularyLabel.mock.calls).toEqual([
      ['l10nsubjects', 'architecture'],
      ['l10nsubjects', 'unknown'],
    ]);
  });

  it('shows the stored id when the entry cannot be read', async () => {
    vocabularyLabel.mockReturnValue(of(null));
    await render(claimDocument());
    expect(value('claim:status')).toBe('pending');
  });

  it('labels from a translation key when one resolves, and a literal ahead of it', async () => {
    TestBed.inject(TranslateService).setTranslation(
      'en',
      { 'layout.field.claim:number': 'Claim no.' },
      true,
    );
    const literal = {
      ...claimSection,
      fields: [field('claim:status', 'string', {}, { literal: 'State' }), claimSection.fields[0]!],
    };
    await render(claimDocument(), layout({ sections: [literal] }));
    expect(labelOf('claim:number')).toBe('Claim no.');
    expect(labelOf('claim:status')).toBe('State');
  });

  it('falls back to the readable name when no key resolves', async () => {
    await render(claimDocument());
    expect(labelOf('claim:serviceDate')).toBe('serviceDate');
  });

  describe("a generated section's heading", () => {
    // The brand-assets kit's product, as the Properties panel generates it: one section for the
    // kit's schema, `acmeproduct`, whose name made readable is "Acmeproduct".
    const product = {
      ...claimDocument(),
      uid: 'p1',
      type: 'AcmeProduct',
      properties: { 'acmeproduct:style': 'TR-100' },
    } as NuxeoDocument;
    const productType: DocumentTypeDefinition = {
      name: 'AcmeProduct',
      schemas: [
        { name: 'acmeproduct', prefix: 'acmeproduct', fields: { style: { type: 'string' } } },
      ],
    };
    const heading = () => text('[data-section-id="acmeproduct"] .document-layout__heading');

    it("is the kit's label for the schema, layout.schema.<schema>, when it has one", async () => {
      TestBed.inject(TranslateService).setTranslation(
        'en',
        { 'layout.schema.acmeproduct': 'Product' },
        true,
      );
      await render(product, generateLayout(productType, 'metadata'));
      expect(heading()).toBe('Product');
    });

    it("is the schema's name made readable when no label names it", async () => {
      await render(product, generateLayout(productType, 'metadata'));
      expect(heading()).toBe('Acmeproduct');
    });
  });

  it('leaves out the heading of a contributed section with no label', async () => {
    const unlabelled = { ...claimSection, id: 'summary', label: { keys: [], fallback: null } };
    await render(claimDocument(), layout({ source: 'contributed', sections: [unlabelled] }));
    expect(host().querySelector('[data-section-id="summary"]')).not.toBeNull();
    expect(host().querySelector('.document-layout__heading')).toBeNull();
    expect(host().querySelector('[data-layout-source="contributed"]')).not.toBeNull();
  });

  it('renders sections as named tabs, naming an unlabelled one from its id', async () => {
    const amounts = {
      id: 'claim_amounts',
      label: { keys: [], fallback: null },
      fields: [field('claim:number', 'string')],
    };
    await render(claimDocument(), layout({ display: 'tabs', sections: [claimSection, amounts] }));
    const tablist = host().querySelector('[role="tablist"]');
    expect(tablist?.getAttribute('aria-label')).toBe('Property sections');
    expect(
      [...host().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    ).toEqual(['Claim', 'Claim amounts']);
    expect(host().querySelector('.document-layout__heading')).toBeNull();
  });

  it('renders nothing for a layout with no sections, as a stock File has', async () => {
    await render(claimDocument(), layout({ sections: [] }));
    expect(host().querySelector('.document-layout')).toBeNull();
  });

  it('renders nothing when the type cannot be read', async () => {
    await render(claimDocument(), null);
    expect(host().querySelector('.document-layout')).toBeNull();
  });

  it('never shows a layout resolved for another type against this document', async () => {
    await render({ ...claimDocument(), type: 'Member' }, layout());
    expect(host().querySelector('.document-layout')).toBeNull();
  });

  it('renders nothing and asks for nothing without a document', async () => {
    await render(null);
    expect(layoutFor).not.toHaveBeenCalled();
    expect(host().querySelector('.document-layout')).toBeNull();
  });

  async function show(document: NuxeoDocument) {
    fixture.componentRef.setInput('document', document);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('asks again for the next document, so a failed schema read recovers', async () => {
    await render(claimDocument(), null);
    expect(host().querySelector('.document-layout')).toBeNull();
    layoutFor.mockReturnValue(of(layout()));
    await show({ ...claimDocument({ 'claim:number': 'CLM-2' }), uid: 'c2' });
    expect(layoutFor).toHaveBeenCalledTimes(2);
    expect(value('claim:number')).toBe('CLM-2');
  });

  it('does not ask again when the same document is refetched', async () => {
    await render(claimDocument());
    await show(claimDocument({ 'claim:number': 'CLM-1b' }));
    expect(layoutFor).toHaveBeenCalledTimes(1);
    expect(value('claim:number')).toBe('CLM-1b');
  });

  it('asks again when the same document comes back carrying another facet schema', async () => {
    await render(carrying(claimDocument(), 'claim'));
    await show(carrying(claimDocument(), 'claim'));
    expect(layoutFor).toHaveBeenCalledTimes(1);
    await show(carrying(claimDocument(), 'claim', 'externalEntity'));
    expect(layoutFor).toHaveBeenCalledTimes(2);
    expect(layoutFor.mock.lastCall?.[2]).toEqual([
      { name: 'claim', prefix: 'claim' },
      { name: 'externalEntity', prefix: 'externalEntity' },
    ]);
  });

  it("never shows the previous document's layout while this one's resolves", async () => {
    const external: LayoutSection = {
      id: 'externalEntity',
      label: { keys: [], fallback: 'External entity' },
      fields: [field('externalEntity:entityId', 'string')],
    };
    await render(
      carrying(claimDocument(), 'claim', 'externalEntity'),
      layout({ sections: [claimSection, external] }),
    );
    expect(host().querySelector('[data-section-id="externalEntity"]')).not.toBeNull();

    const pending = new Subject<ResolvedLayout | null>();
    layoutFor.mockReturnValue(pending);
    await show({ ...carrying(claimDocument(), 'claim', 'hxai'), uid: 'c2' });
    expect(host().querySelector('.document-layout')).toBeNull();

    pending.next(layout());
    fixture.detectChanges();
    expect(host().querySelector('[data-section-id="claim"]')).not.toBeNull();
    expect(host().querySelector('[data-section-id="externalEntity"]')).toBeNull();
  });

  it('asks for an entry only when a value names it, not again for the same values', async () => {
    await render(claimDocument());
    await show(claimDocument({ 'claim:number': 'CLM-1b' }));
    expect(vocabularyLabel).toHaveBeenCalledTimes(1);
    await show(claimDocument({ 'claim:status': 'approved' }));
    expect(value('claim:status')).toBe('Approved');
    expect(vocabularyLabel.mock.calls).toEqual([
      ['claim_status', 'pending'],
      ['claim_status', 'approved'],
    ]);
  });

  describe('the documentMetadata slot', () => {
    beforeEach(() => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.components.claimPanel': ClaimPanelComponent,
      });
    });

    it('renders the entry its rule admits in place of the layout, given the document', async () => {
      slotEntries[EXTENSION_SLOTS.documentMetadata] = [
        { id: 'acme.documentMetadata.missing', componentId: 'acme.components.notBuilt', order: 1 },
        {
          id: 'acme.documentMetadata.claim',
          componentId: 'acme.components.claimPanel',
          inputs: { heading: 'Claim', document: null },
        },
      ];
      await render(claimDocument());
      expect(text('.acme-claim-panel')).toBe('Claim: Claim CLM-1');
      expect(
        host().querySelector('[data-layout-entry="acme.documentMetadata.claim"]'),
      ).not.toBeNull();
      expect(host().querySelector('.document-layout')).toBeNull();
      expect(layoutFor).not.toHaveBeenCalled();
      const [slot, context] = resolve.mock.calls.at(-1) ?? [];
      expect(slot).toBe(EXTENSION_SLOTS.documentMetadata);
      expect(context?.document?.uid).toBe('c1');
    });

    it('keeps the layout when no entry has a component this build registers', async () => {
      slotEntries[EXTENSION_SLOTS.documentMetadata] = [
        { id: 'acme.documentMetadata.claim', componentId: 'acme.components.notBuilt' },
      ];
      await render(claimDocument());
      expect(host().querySelector('[data-section-id="claim"]')).not.toBeNull();
    });

    it("shows the layout when the entry's component fails to load", async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.components.brokenPanel': () => Promise.reject(new Error('chunk failed to load')),
      });
      slotEntries[EXTENSION_SLOTS.documentMetadata] = [
        { id: 'acme.documentMetadata.claim', componentId: 'acme.components.brokenPanel' },
      ];
      await render(claimDocument());
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        host().querySelector('[data-layout-entry="acme.documentMetadata.claim"]'),
      ).not.toBeNull();
      expect(host().querySelector('[data-section-id="claim"]')).not.toBeNull();
    });
  });

  /**
   * Rendered from the real resolver rather than a hand-built layout, so these assert what a
   * contributed file puts on screen — the surface NXSAT-728 was reported against.
   */
  describe('a contributed section with nothing to show', () => {
    const claimType = (): DocumentTypeDefinition => {
      const type = readDocumentType(
        {
          schemas: [
            { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
            { name: 'claim', '@prefix': 'claim', fields: { number: 'string' } },
          ],
        },
        'Claim',
      );
      if (!type) throw new Error('fixture did not read');
      return type;
    };

    const fromFile = (content: Record<string, unknown>): ResolvedLayout => {
      const read = readLayoutFile(content);
      if ('invalid' in read) throw new Error(read.invalid);
      return applyLayoutFile(claimType(), 'metadata', read).layout;
    };

    const headings = () =>
      [...host().querySelectorAll('.document-layout__heading')].map((heading) =>
        heading.textContent?.trim(),
      );

    it('renders only the section that resolved a field, heading and rows included', async () => {
      await render(
        claimDocument(),
        fromFile({
          version: 1,
          sections: [
            { id: 'details', label: 'Details', fields: ['claim:number'] },
            { id: 'extra', label: 'Extra info', fields: ['qa:missing', 'qa:gone'] },
            { id: 'nothing', label: 'Nothing here', fields: [] },
          ],
        }),
      );
      expect(headings()).toEqual(['Details']);
      // The control: the section that does resolve a field still renders its row, so the fix
      // cannot pass by rendering nothing at all.
      expect(host().querySelector('[data-section-id="details"]')).not.toBeNull();
      expect(value('claim:number')).toBe('CLM-1');
      expect(host().querySelector('[data-section-id="extra"]')).toBeNull();
      expect(host().querySelector('[data-section-id="nothing"]')).toBeNull();
    });

    it('renders no layout at all when no section resolved a field', async () => {
      await render(
        claimDocument(),
        fromFile({
          version: 1,
          sections: [
            { id: 'only', label: 'Nothing at all', fields: ['qa:missing'] },
            { id: 'empty', label: 'Nothing here either', fields: [] },
          ],
        }),
      );
      expect(host().querySelector('.document-layout')).toBeNull();
      expect(headings()).toEqual([]);
    });

    it('offers no tab for a section with nothing under it', async () => {
      await render(
        claimDocument(),
        fromFile({
          version: 1,
          display: 'tabs',
          sections: [
            { id: 'details', label: 'Details', fields: ['claim:number'] },
            { id: 'extra', label: 'Extra info', fields: ['qa:missing'] },
          ],
        }),
      );
      expect(
        [...host().querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
      ).toEqual(['Details']);
      expect(value('claim:number')).toBe('CLM-1');
    });
  });

  /**
   * A reference to a document, a `documentResolver` that stores an id, as the generated panel
   * beside a Case lists `case:member` (layout-v2.md, section 11): shown by the record's title, read
   * through the record page's own lookup.
   */
  describe('a document reference', () => {
    const WEI = 'a00e20f3-1398-4b64-827e-628bfdada64c';
    const JOHN = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
    /** A record the reader may not read, or that no longer exists: the search does not return it. */
    const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';
    const reference = { documentReference: true };
    const caseSection: LayoutSection = {
      id: 'case',
      label: { keys: [], fallback: 'Case' },
      fields: [
        field('case:number', 'string'),
        field('case:member', 'string', reference),
        field('case:household', 'string[]', reference),
        field('case:history', 'complex[]', { fields: { by: { type: 'string', ...reference } } }),
      ],
    };
    const caseDocument = (properties: Record<string, unknown>): NuxeoDocument =>
      ({
        uid: 'k1',
        title: 'CASE-1',
        type: 'Case',
        path: '/k1',
        lastModified: '',
        properties: { 'case:number': 'CASE-1', ...properties },
      }) as NuxeoDocument;
    const caseLayout = layout({ type: 'Case', sections: [caseSection] });
    const linksOf = (xpath: string) =>
      [...host().querySelectorAll<HTMLAnchorElement>(`[data-field="${xpath}"] a`)].map((a) => ({
        text: a.textContent?.trim(),
        href: a.getAttribute('href'),
      }));
    const chipsOf = (xpath: string) =>
      [...host().querySelectorAll(`[data-field="${xpath}"] .document-layout__chip`)].map((chip) =>
        chip.textContent?.trim(),
      );

    it("shows the linked record's title, as a link that opens it through the app's router", async () => {
      await render(caseDocument({ 'case:member': WEI }), caseLayout);
      expect(value('case:member')).toBe('Wei Chen');
      expect(linksOf('case:member')).toEqual([{ text: 'Wei Chen', href: `/doc/${WEI}` }]);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      host().querySelector<HTMLAnchorElement>('[data-field="case:member"] a')?.click();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(router.serializeUrl(navigate.mock.calls[0][0] as never)).toBe(`/doc/${WEI}`);
      expect(host().textContent).not.toContain(WEI);
    });

    it('reads every record the panel names in one request, each id once', async () => {
      await render(
        caseDocument({
          'case:member': WEI,
          'case:household': [JOHN, WEI],
          'case:history': [{ by: GONE }, { by: JOHN }],
        }),
        caseLayout,
      );
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0][0]).toEqual([GONE, JOHN, WEI].sort());
      expect(chipsOf('case:household')).toEqual(['John Smith', 'Wei Chen']);
      expect(text('[data-field="case:history"] [data-subfield="by"] a')).toBe('John Smith');
    });

    it('shows a record it may not read, one that is gone and a value that is no id as unavailable, never the id', async () => {
      const injected = `${WEI}' OR ecm:uuid IS NOT NULL OR ecm:uuid = '`;
      await render(
        caseDocument({ 'case:member': GONE, 'case:household': [JOHN, injected] }),
        caseLayout,
      );
      expect(value('case:member')).toBe('Unavailable');
      expect(linksOf('case:member')).toEqual([]);
      expect(
        host().querySelector('[data-field="case:member"] .document-layout__unavailable'),
      ).not.toBeNull();
      expect(chipsOf('case:household')).toEqual(['John Smith', 'Unavailable']);
      expect(host().textContent).not.toContain(GONE);
      expect(host().textContent).not.toContain(injected);
      // The value that is not an id was never asked for.
      expect(linkedRecords.mock.calls.flatMap(([ids]) => ids)).not.toContain(injected);
    });

    it('shows nothing of a record while it is read, not its id', async () => {
      const answer = new Subject<ReadonlyMap<string, LinkedRecord> | null>();
      linkedRecords.mockReturnValue(answer);
      await render(caseDocument({ 'case:member': WEI, 'case:household': [JOHN] }), caseLayout);
      expect(value('case:member')).toBe('');
      expect(chipsOf('case:household')).toEqual([]);
      expect(host().textContent).not.toContain(WEI);
      answer.next(linked([WEI, JOHN]));
      answer.complete();
      fixture.detectChanges();
      expect(value('case:member')).toBe('Wei Chen');
      expect(chipsOf('case:household')).toEqual(['John Smith']);
    });

    it('asks nothing more for the record reloaded with the same references, and only for an id it adds', async () => {
      await render(caseDocument({ 'case:member': WEI }), caseLayout);
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput('document', caseDocument({ 'case:member': WEI }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      fixture.componentRef.setInput(
        'document',
        caseDocument({ 'case:member': WEI, 'case:household': [JOHN] }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(linkedRecords).toHaveBeenCalledTimes(2);
      expect(linkedRecords.mock.calls[1][0]).toEqual([JOHN]);
      expect(value('case:member')).toBe('Wei Chen');
      expect(chipsOf('case:household')).toEqual(['John Smith']);
    });

    it('asks for nothing, and shows the value, where the property is no reference', async () => {
      const plain = { ...caseSection, fields: [field('case:member', 'string')] };
      await render(
        caseDocument({ 'case:member': WEI }),
        layout({ type: 'Case', sections: [plain] }),
      );
      expect(value('case:member')).toBe(WEI);
      expect(linkedRecords).not.toHaveBeenCalled();
    });
  });
});
