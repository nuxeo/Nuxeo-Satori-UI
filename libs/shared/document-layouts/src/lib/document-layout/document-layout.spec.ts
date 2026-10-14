import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo-satori/platform/extensions';
import { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { Observable, Subject, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { LayoutSection, ResolvedLayout } from '../layout.model';
import { DocumentLayoutComponent } from './document-layout';

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
    TestBed.configureTestingModule({
      imports: [DocumentLayoutComponent],
      providers: [
        { provide: DocumentLayoutService, useValue: { layoutFor, vocabularyLabel } },
        { provide: AppExtensionsService, useValue: { resolve } },
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
});
