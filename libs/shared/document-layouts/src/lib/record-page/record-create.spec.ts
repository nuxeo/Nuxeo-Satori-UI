import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import {
  DirectoryService,
  DocumentChangesService,
  DocumentImportService,
  NuxeoApiBase,
  type NuxeoDocument,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { Subject, of, throwError } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { readFormLayout } from '../form-layout/form-layout';
import { resolveFormLayout } from '../form-layout/resolve-form-layout';
import type { DocumentTypeDefinition } from '../layout.model';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import { RecordCreateComponent } from './record-create';
import { RecordCreateDialogComponent, type RecordCreateDialogData } from './record-create-dialog';
import type { RecordCreateEntry } from './record-layout';

const CASE_ID = '0b5e7d1c-2f4a-4e8b-9c6d-000000001003';
const REGISTER_ID = '0b5e7d1c-2f4a-4e8b-9c6d-0000000000a1';

const onboardingCase = (more: Partial<NuxeoDocument> = {}): NuxeoDocument => ({
  uid: CASE_ID,
  title: 'ONB-1003 Example Trading Ltd',
  type: 'OnboardingCase',
  path: '/onboarding-demo/onboarding/ONB-1003',
  parentRef: REGISTER_ID,
  lastModified: '2026-11-26T10:00:00.000Z',
  properties: {},
  ...more,
});

const folder = (permissions: string[], more: Partial<NuxeoDocument> = {}): NuxeoDocument => ({
  uid: 'f1',
  title: 'Disputes',
  type: 'DisputeRegister',
  path: '/onboarding-demo/disputes',
  lastModified: '',
  properties: {},
  contextParameters: { permissions },
  ...more,
});

const CREATE: RecordCreateEntry = {
  type: 'DisputeCase',
  field: 'dsp:case',
  label: { literal: 'New dispute', keys: [], fallback: null },
  folder: null,
};

/** The mark of the app's console, so that the test reads only what the button says there. */
const warnings = (spy: ReturnType<typeof vi.spyOn>): string[] =>
  spy.mock.calls.map((call: unknown[]) => String(call[0]));

describe('RecordCreateComponent, a related list New', () => {
  let fixture: ComponentFixture<RecordCreateComponent>;
  let get: ReturnType<typeof vi.fn>;
  let execute: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<NuxeoDocument | undefined>;
  let show: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    get = vi.fn(() =>
      of(
        folder(['Read', 'AddChildren'], {
          title: 'Onboarding',
          path: '/onboarding-demo/onboarding',
        }),
      ),
    );
    execute = vi.fn(() => of({ entries: [folder(['Read', 'ReadWrite', 'AddChildren'])] }));
    // Each dialog opened closes once, as MatDialog's do.
    open = vi.fn(() => {
      closed = new Subject();
      return { afterClosed: () => closed };
    });
    show = vi.fn();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [RecordCreateComponent, MatIconTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: NuxeoApiBase, useValue: { get } },
        { provide: PageProviderService, useValue: { execute } },
        { provide: MatDialog, useValue: { open } },
        { provide: NxsToastService, useValue: { show, error: vi.fn() } },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    create: RecordCreateEntry = CREATE,
    document: NuxeoDocument = onboardingCase(),
    readOnly = false,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordCreateComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('create', create);
    fixture.componentRef.setInput('label', 'New dispute');
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.componentRef.setInput('source', 'OnboardingCase/view layout: cards[5]');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('button');

  it("is offered in the open record's folder where its permissions let the person add to it", async () => {
    const root = await render();
    expect(get).toHaveBeenCalledWith(`/nuxeo/api/v1/id/${REGISTER_ID}`, undefined, {
      'enrichers.document': 'permissions',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(button(root)?.textContent?.trim()).toBe('New dispute');
  });

  it("files it in the first folder the file's page provider finds, when it names one", async () => {
    const root = await render({ ...CREATE, folder: 'onboarding_dispute_registers' });
    expect(execute).toHaveBeenCalledWith('onboarding_dispute_registers', {
      pageSize: 1,
      pageIndex: 0,
    });
    expect(get).not.toHaveBeenCalled();
    button(root)?.click();
    const data = open.mock.calls[0][1].data as RecordCreateDialogData;
    expect(data).toEqual({
      type: 'DisputeCase',
      title: 'New dispute',
      folder: { path: '/onboarding-demo/disputes', title: 'Disputes' },
      reference: { field: 'dsp:case', id: CASE_ID, title: 'ONB-1003 Example Trading Ltd' },
    });
  });

  it('is not offered where the folder does not let the person add to it, or none is found', async () => {
    get.mockReturnValue(of(folder(['Read'])));
    expect(button(await render())).toBeNull();
    fixture.destroy();
    execute.mockReturnValue(of({ entries: [] }));
    expect(button(await render({ ...CREATE, folder: 'onboarding_dispute_registers' }))).toBeNull();
    expect(warnings(warn).some((line) => line.includes('found no folder'))).toBe(true);
    fixture.destroy();
    get.mockReturnValue(throwError(() => new Error('offline')));
    expect(button(await render())).toBeNull();
  });

  it('is not offered on a read-only page, a version, a proxy or a record in the trash', async () => {
    for (const [document, readOnly] of [
      [onboardingCase(), true],
      [onboardingCase({ isVersion: true }), false],
      [onboardingCase({ isProxy: true }), false],
      [onboardingCase({ isTrashed: true }), false],
    ] as const) {
      expect(button(await render(CREATE, document, readOnly))).toBeNull();
      fixture.destroy();
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('says it was created, and has the lists read again, once the dialog closes with the record', async () => {
    const changes = vi.spyOn(TestBed.inject(DocumentChangesService), 'notify');
    const root = await render();
    button(root)?.click();
    closed.next(undefined);
    expect(changes).not.toHaveBeenCalled();
    button(root)?.click();
    closed.next({ ...onboardingCase(), uid: 'n1', title: 'DSP-2004 Card charged twice' });
    expect(show).toHaveBeenCalledWith('DSP-2004 Card charged twice created.');
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

const DISPUTE_TYPE: DocumentTypeDefinition = {
  name: 'DisputeCase',
  schemas: [
    {
      name: 'dispute',
      prefix: 'dsp',
      fields: {
        number: { type: 'string' },
        case: { type: 'string' },
        amount: { type: 'double' },
      },
    },
    { name: 'dublincore', prefix: 'dc', fields: { title: { type: 'string' } } },
  ],
};

const DISPUTE_CREATE = {
  version: 2,
  cards: [
    {
      id: 'dispute',
      label: 'Dispute',
      fields: [
        { field: 'dc:title', label: 'Title', required: true },
        { field: 'dsp:case', label: 'Onboarding case', widget: 'document-link' },
        'dsp:number',
      ],
    },
  ],
};

describe('RecordCreateDialogComponent', () => {
  let fixture: ComponentFixture<RecordCreateDialogComponent>;
  let createChildDocument: ReturnType<typeof vi.fn>;
  const close = vi.fn();

  const DATA: RecordCreateDialogData = {
    type: 'DisputeCase',
    title: 'New dispute',
    folder: { path: '/onboarding-demo/disputes', title: 'Disputes' },
    reference: { field: 'dsp:case', id: CASE_ID, title: 'ONB-1003 Example Trading Ltd' },
  };

  const host = (): HTMLElement => fixture.nativeElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (xpath: string, text: string) => {
    const field = host().querySelector<HTMLInputElement>(`input[data-xpath="${xpath}"]`);
    if (!field) throw new Error(`no field ${xpath}`);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('blur'));
    await settle();
  };
  const save = () => host().querySelector<HTMLButtonElement>('[data-record-create-save] button');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createChildDocument = vi.fn(() =>
      of({ ...onboardingCase(), uid: 'n1', type: 'DisputeCase', title: 'Card charged twice' }),
    );
    TestBed.configureTestingModule({
      imports: [RecordCreateDialogComponent, MatIconTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
        { provide: DocumentImportService, useValue: { createChildDocument } },
        {
          provide: DocumentLayoutService,
          useValue: {
            formLayoutFor: () => {
              const file = readFormLayout(DISPUTE_CREATE, 'create', {
                rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
              });
              if ('invalid' in file) throw new Error(file.invalid);
              return of(resolveFormLayout(DISPUTE_TYPE, file).layout);
            },
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            linkedRecords: () => of(new Map()),
          },
        },
        { provide: AppExtensionsService, useValue: { resolve: () => [] } },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-27T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    fixture = TestBed.createComponent(RecordCreateDialogComponent);
    await settle();
  });

  afterEach(() => vi.restoreAllMocks());

  it('is framed by nxs-dialog: its title, then what it asks for, then Cancel and Save', () => {
    const title = host().querySelector('nxs-dialog .nxs-dialog__title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent?.trim()).toBe('New dispute');
    expect(host().querySelector('.nxs-dialog__content .lib-record-create__form')).not.toBeNull();
    const actions = [...host().querySelectorAll<HTMLButtonElement>('.nxs-dialog__actions button')];
    expect(actions).toHaveLength(2);
    expect(actions[1]).toBe(save());
    expect(actions.every((button) => button.type === 'button')).toBe(true);
  });

  it('closes with nothing on Cancel', async () => {
    host()
      .querySelector<HTMLButtonElement>('.nxs-dialog__actions nxs-button:first-child button')
      ?.click();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith();
    expect(createChildDocument).not.toHaveBeenCalled();
  });

  it('says what it is for and where it is filed, and shows the reference read-only by its title', () => {
    expect(host().querySelector('h2')?.textContent?.trim()).toBe('New dispute');
    expect(host().querySelector('.lib-record-create__context')?.textContent?.trim()).toBe(
      'For ONB-1003 Example Trading Ltd, filed in Disputes.',
    );
    expect(host().querySelector('input[data-xpath="dsp:case"]')).toBeNull();
    expect(host().querySelector('[data-xpath="dsp:case"]')?.textContent).toContain(
      'ONB-1003 Example Trading Ltd',
    );
  });

  it("creates it in the folder, under the person's own permissions, with the reference the page gave", async () => {
    save()?.click();
    await settle();
    // The title is required: nothing is sent until it is entered.
    expect(createChildDocument).not.toHaveBeenCalled();
    await type('dc:title', 'Card charged twice');
    save()?.click();
    await settle();
    expect(createChildDocument).toHaveBeenCalledWith(
      '/onboarding-demo/disputes',
      'Card charged twice',
      'DisputeCase',
      { 'dc:title': 'Card charged twice', 'dsp:case': CASE_ID },
    );
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ uid: 'n1' }));
  });

  it("shows the server's reason when it refuses, and stays open with what was entered", async () => {
    createChildDocument.mockReturnValue(
      throwError(() => ({
        status: 403,
        error: {
          'entity-type': 'exception',
          status: 403,
          message: "Privilege 'AddChildren' is not granted to 'kpatel'",
        },
      })),
    );
    await type('dc:title', 'Card charged twice');
    save()?.click();
    await settle();
    expect(host().querySelector('.lib-record-create__failure')?.textContent).toContain(
      "Privilege 'AddChildren' is not granted to 'kpatel'",
    );
    expect(close).not.toHaveBeenCalled();
    expect(host().querySelector<HTMLInputElement>('input[data-xpath="dc:title"]')?.value).toBe(
      'Card charged twice',
    );
  });

  it("never shows a server error's internals, only that it failed", async () => {
    createChildDocument.mockReturnValue(
      throwError(() => ({
        status: 500,
        error: {
          'entity-type': 'exception',
          status: 500,
          message: 'java.lang.NullPointerException at Foo',
        },
      })),
    );
    await type('dc:title', 'Card charged twice');
    save()?.click();
    await settle();
    const failure = host().querySelector('.lib-record-create__failure')?.textContent ?? '';
    expect(failure).toContain('The record could not be created. Try again.');
    expect(failure).not.toContain('NullPointerException');
  });

  it('passes axe at WCAG 2.2 AA', async () => {
    const results = await axe.run(host(), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
