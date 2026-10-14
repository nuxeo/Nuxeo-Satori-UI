import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionComponentRegistry,
  type DocumentLayoutChange,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo-satori/platform/extensions';
import { DirectoryService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { Observable, Subject, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { ResolvedLayout } from '../layout.model';
import { DocumentLayoutFormComponent } from './document-layout-form';

const CLAIM: NuxeoDocument = Object.assign(
  {
    uid: 'c1',
    title: 'Claim CLM-1',
    type: 'Claim',
    path: '/default-domain/workspaces/ws/c1',
    lastModified: '',
    properties: { 'dc:title': 'Claim CLM-1', 'claim:number': 'CLM-1' },
  },
  {
    schemas: [
      { name: 'claim', prefix: 'claim' },
      { name: 'externalEntity', prefix: 'externalEntity' },
    ],
  },
);

const layout = (
  mode: 'edit' | 'create',
  overrides: Partial<ResolvedLayout> = {},
): ResolvedLayout => ({
  type: 'Claim',
  mode,
  source: 'generated',
  display: 'sections',
  sections: [
    {
      id: 'claim',
      label: { keys: ['layout.schema.claim'], fallback: 'Claim' },
      fields: [
        {
          xpath: 'claim:number',
          definition: { type: 'string', required: true },
          label: { keys: ['layout.field.claim:number'], fallback: 'Number' },
        },
      ],
    },
  ],
  ...overrides,
});

@Component({
  selector: 'lib-acme-claim-form',
  standalone: true,
  template: `<p class="acme-claim-form">
    {{ document()?.uid ?? type() }} {{ parentPath() }} {{ showErrors() }}
  </p>`,
})
class ClaimFormComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly type = input<string | null>(null);
  readonly parentPath = input<string | null>(null);
  readonly showErrors = input(false);
  readonly onChange = input<((change: DocumentLayoutChange) => void) | null>(null);
}

describe('DocumentLayoutFormComponent', () => {
  let fixture: ComponentFixture<DocumentLayoutFormComponent>;
  let form: DocumentLayoutFormComponent;
  let layoutFor: ReturnType<
    typeof vi.fn<
      (type: string, mode: string, schemas: readonly unknown[]) => Observable<ResolvedLayout | null>
    >
  >;
  let slotEntries: Record<string, ExtensionDocumentLayoutDescriptor[]>;
  let resolve: ReturnType<
    typeof vi.fn<
      (slot: string, context?: ExtensionRuleContext) => ExtensionDocumentLayoutDescriptor[]
    >
  >;
  let validity: boolean[];

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const host = (): HTMLElement => fixture.nativeElement;
  const input$ = (xpath: string) =>
    host().querySelector<HTMLInputElement>(`[data-xpath="${xpath}"]`);
  const type = async (xpath: string, text: string) => {
    const field = input$(xpath);
    if (!field) throw new Error(`no field ${xpath}`);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    await settle();
  };

  async function render(
    inputs: Record<string, unknown>,
    answer: Observable<ResolvedLayout | null> | null = null,
  ) {
    const mode = inputs['mode'] === 'create' ? 'create' : 'edit';
    layoutFor.mockReturnValue(answer ?? of(layout(mode)));
    fixture = TestBed.createComponent(DocumentLayoutFormComponent);
    form = fixture.componentInstance;
    validity = [];
    form.validChange.subscribe((valid) => validity.push(valid));
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle();
  }

  beforeEach(() => {
    layoutFor = vi.fn();
    slotEntries = {};
    resolve = vi.fn((slot: string) => slotEntries[slot] ?? []);
    TestBed.configureTestingModule({
      imports: [DocumentLayoutFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentLayoutService, useValue: { layoutFor } },
        { provide: AppExtensionsService, useValue: { resolve } },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
      ],
    });
    TestBed.inject(ExtensionComponentRegistry).register({
      'acme.components.claimForm': ClaimFormComponent,
    });
  });

  describe('editing', () => {
    it("reads the type's edit layout, facet schemas included, and fills it from the document", async () => {
      await render({ mode: 'edit', document: CLAIM });
      expect(layoutFor).toHaveBeenCalledWith('Claim', 'edit', [
        { name: 'claim', prefix: 'claim' },
        { name: 'externalEntity', prefix: 'externalEntity' },
      ]);
      expect(host().querySelector('[data-layout-source="generated"]')).not.toBeNull();
      expect(input$('dc:title')?.value).toBe('Claim CLM-1');
      expect(input$('claim:number')?.value).toBe('CLM-1');
      expect(host().querySelector('[role="heading"]')?.textContent?.trim()).toBe('Claim');
    });

    it('sends only what changed, and refuses a required field left blank', async () => {
      await render({ mode: 'edit', document: CLAIM });
      expect(form.changedProperties()).toEqual({});
      await type('claim:number', 'CLM-2');
      expect(form.changedProperties()).toEqual({ 'claim:number': 'CLM-2' });
      expect(form.validate()).toBe(true);
      await type('claim:number', '');
      expect(validity.at(-1)).toBe(false);
      expect(form.validate()).toBe(false);
    });

    it("puts Nuxeo's messages on their fields and hands back the rest", async () => {
      await render({ mode: 'edit', document: CLAIM });
      expect(form.showServerErrors({ 'claim:number': 'Taken', 'x:y': 'Elsewhere' })).toEqual([
        'Elsewhere',
      ]);
      await settle();
      expect(host().textContent).toContain('Taken');
    });

    it('keeps the Dublin Core fields when the type cannot be read', async () => {
      await render({ mode: 'edit', document: CLAIM }, of(null));
      expect(host().querySelector('[data-layout-source="none"]')).not.toBeNull();
      expect(input$('dc:title')).not.toBeNull();
      expect(input$('claim:number')).toBeNull();
    });

    it('shows a spinner while the layout resolves', async () => {
      const pending = new Subject<ResolvedLayout | null>();
      await render({ mode: 'edit', document: CLAIM }, pending);
      expect(form.ready()).toBe(false);
      expect(host().querySelector('nxs-spinner')).not.toBeNull();
      expect(form.changedProperties()).toEqual({});
      expect(form.validate()).toBe(false);
      pending.next(layout('edit'));
      await settle();
      expect(form.ready()).toBe(true);
      expect(host().querySelector('nxs-spinner')).toBeNull();
    });
  });

  describe('creating', () => {
    it("reads the type's create layout without the parent's facets, empty, and sends every value", async () => {
      await render({
        mode: 'create',
        type: 'Claim',
        parentPath: '/default-domain/workspaces/ws',
        document: CLAIM,
      });
      expect(layoutFor).toHaveBeenCalledWith('Claim', 'create', []);
      expect(input$('dc:title')?.value).toBe('');
      expect(form.validate()).toBe(false);
      await type('dc:title', 'New claim');
      await type('claim:number', 'CLM-9');
      expect(form.validate()).toBe(true);
      expect(form.changedProperties()).toMatchObject({
        'dc:title': 'New claim',
        'claim:number': 'CLM-9',
        'dc:description': null,
      });
    });

    it('asks for nothing until it knows the type', async () => {
      await render({ mode: 'create', type: null });
      expect(layoutFor).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('a contributed form', () => {
    const contributed = (
      inputs: Record<string, unknown> = {},
    ): ExtensionDocumentLayoutDescriptor => ({
      id: 'acme.layout.claim',
      componentId: 'acme.components.claimForm',
      inputs,
    });
    const claimForm = (): ClaimFormComponent | undefined =>
      fixture.debugElement.query(By.directive(ClaimFormComponent))?.componentInstance;

    it('replaces the edit layout, given the document the host edits whatever the manifest says', async () => {
      slotEntries[EXTENSION_SLOTS.documentEdit] = [contributed({ document: { uid: 'other' } })];
      await render({ mode: 'edit', document: CLAIM });
      expect(host().querySelector('[data-layout-entry="acme.layout.claim"]')).not.toBeNull();
      expect(host().querySelector('nxs-metadata-editor')).toBeNull();
      expect(layoutFor).not.toHaveBeenCalled();
      expect(claimForm()?.document()?.uid).toBe('c1');
      expect(resolve.mock.calls.at(-1)?.[0]).toBe(EXTENSION_SLOTS.documentEdit);
    });

    it('saves only once the component says its values are valid, and sends what it reported', async () => {
      slotEntries[EXTENSION_SLOTS.documentEdit] = [contributed()];
      await render({ mode: 'edit', document: CLAIM });
      expect(form.validate()).toBe(false);
      await settle();
      expect(claimForm()?.showErrors()).toBe(true);
      claimForm()?.onChange()?.({ properties: { 'claim:number': 'CLM-3' }, valid: true });
      expect(validity).toEqual([true]);
      expect(form.validate()).toBe(true);
      expect(form.changedProperties()).toEqual({ 'claim:number': 'CLM-3' });
      expect(form.showServerErrors({ 'claim:number': 'Taken' })).toEqual(['Taken']);
    });

    it('forgets what it reported when the host hands it another document of the same type', async () => {
      slotEntries[EXTENSION_SLOTS.documentEdit] = [contributed()];
      await render({ mode: 'edit', document: CLAIM });
      claimForm()?.onChange()?.({ properties: { 'claim:number': 'CLM-3' }, valid: true });
      expect(form.validate()).toBe(true);

      fixture.componentRef.setInput('document', { ...CLAIM, uid: 'c2', title: 'Claim CLM-2' });
      await settle();

      expect(validity).toEqual([true, false]);
      expect(form.changedProperties()).toEqual({});
      expect(form.validate()).toBe(false);
    });

    it("judges a create's rule by the type being created, in its folder", async () => {
      slotEntries[EXTENSION_SLOTS.documentCreate] = [contributed()];
      await render({ mode: 'create', type: 'Claim', parentPath: '/default-domain/workspaces/ws/' });
      const [slot, context] = resolve.mock.calls.at(-1) ?? [];
      expect(slot).toBe(EXTENSION_SLOTS.documentCreate);
      expect(context?.document).toMatchObject({
        type: 'Claim',
        path: '/default-domain/workspaces/ws/',
        uid: '',
      });
      expect(claimForm()?.type()).toBe('Claim');
      expect(claimForm()?.parentPath()).toBe('/default-domain/workspaces/ws/');
    });

    it('falls back to the layout when the entry names a component this build lacks', async () => {
      slotEntries[EXTENSION_SLOTS.documentEdit] = [
        { id: 'acme.layout.claim', componentId: 'acme.none' },
      ];
      await render({ mode: 'edit', document: CLAIM });
      expect(host().querySelector('nxs-metadata-editor')).not.toBeNull();
    });

    it('puts the layout back, savable, when the component fails to load', async () => {
      TestBed.inject(ExtensionComponentRegistry).register({
        'acme.components.brokenForm': () => Promise.reject(new Error('chunk failed to load')),
      });
      slotEntries[EXTENSION_SLOTS.documentEdit] = [
        { id: 'acme.layout.claim', componentId: 'acme.components.brokenForm' },
      ];
      await render({ mode: 'edit', document: CLAIM });
      await settle();
      expect(host().querySelector('[data-layout-entry="acme.layout.claim"]')).not.toBeNull();
      expect(host().querySelector('nxs-metadata-editor')).not.toBeNull();
      expect(layoutFor).toHaveBeenCalledWith('Claim', 'edit', expect.any(Array));
      await type('claim:number', 'CLM-2');
      expect(form.validate()).toBe(true);
      expect(form.changedProperties()).toEqual({ 'claim:number': 'CLM-2' });
    });
  });
});
