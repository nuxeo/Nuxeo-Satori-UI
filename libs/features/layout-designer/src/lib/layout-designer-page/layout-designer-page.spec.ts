import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  PACKAGED_REGISTRIES,
  readContentModel,
  type ContentModel,
} from '@agentic-ui/shared/app-definition';
import {
  DocumentLayoutFormComponent,
  RecordPageComponent,
  type FormLayoutPreview,
  type RecordLayoutPreview,
  type ResolvedFormLayout,
  type ResolvedRecordLayout,
} from '@agentic-ui/shared/document-layouts';
import { MatDialog } from '@angular/material/dialog';
import { NxsConfirmDialogComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { BehaviorSubject, Subject, firstValueFrom, of, startWith, type Observable } from 'rxjs';

import { LayoutDesignerService, type Reading } from '../layout-designer.service';
import type { LayoutJson } from '../layout-edits';
import { LayoutDesignerPageComponent } from './layout-designer-page';
import { LayerPanelComponent } from '../layer/layer-panel';

/**
 * The deployment layer's panel, as the page hands it the file open: what it is given is what is
 * checked here. The panel itself, and every request it makes, is held by `layer-panel.spec.ts`.
 */
@Component({
  selector: 'lib-layer-panel',
  standalone: true,
  template: '<p class="stub-layer-panel">{{ path() }}</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubLayerPanelComponent {
  readonly path = input<string | null>(null);
  readonly file = input<unknown>(null);
  readonly saveable = input(false);
  readonly openVersion = output<unknown>();
}

/** The record page, as the designer hands it a preview: what it is given is what is checked. */
@Component({
  selector: 'lib-record-page',
  standalone: true,
  template: '<p class="stub-record-page">{{ layout().type }}</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubRecordPageComponent {
  readonly document = input.required<NuxeoDocument>();
  readonly layout = input.required<ResolvedRecordLayout>();
  readonly readOnly = input(false);
}

/** The form, as the designer hands it a preview. */
@Component({
  selector: 'lib-document-layout-form',
  standalone: true,
  template: '<p class="stub-form">{{ mode() }}</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubFormComponent {
  readonly mode = input.required<'edit' | 'create' | 'task'>();
  readonly document = input<NuxeoDocument | null>(null);
  readonly type = input<string | null>(null);
  readonly parentPath = input<string | null>(null);
  readonly preview = input<ResolvedFormLayout | null>(null);
  readonly disabled = input(false);
  readonly headingLevel = input<number>(3);
}

/** The Member edit form, cut down to what the edits reach. */
const MEMBER_EDIT: LayoutJson = {
  version: 2,
  cards: [
    {
      id: 'member',
      fields: [
        { field: 'member:phone', widget: 'phone', required: true },
        'member:status',
        {
          field: 'member:email',
          required: {
            type: 'app.rules.fieldIn',
            parameters: [{ field: 'member:status' }, 'Active'],
          },
        },
      ],
    },
  ],
};

const FORM_LAYOUT = { version: 2, kind: 'edit', type: 'Member' } as unknown as ResolvedFormLayout;

/** The Member page of the Payers kit, cut down to what the edits reach. */
const MEMBER_VIEW: LayoutJson = {
  version: 2,
  columns: 2,
  cards: [
    {
      id: 'member',
      labelKey: 'payers.member.card',
      fields: [
        {
          id: 'age',
          widget: 'number',
          computed: { type: 'core.age', parameters: [{ field: 'member:birthDate' }] },
        },
        { field: 'member:phone', widget: 'phone' },
        'member:status',
      ],
    },
    {
      id: 'claims',
      labelKey: 'payers.member.claims',
      related: { pageProvider: 'member_claims', columns: ['claim:number'] },
    },
  ],
};

const MODEL: ContentModel = (() => {
  const read = readContentModel({
    doctypes: { Member: { parent: 'Document', facets: [], schemas: ['dublincore', 'member'] } },
    facets: [],
    schemas: [
      { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
      {
        name: 'member',
        '@prefix': 'member',
        fields: { birthDate: 'date', phone: 'string', status: 'string', email: 'string' },
      },
    ],
  });
  if (!read.model) throw new Error(read.problems.join('; '));
  return read.model;
})();

const RECORD = {
  uid: 'm1',
  type: 'Member',
  title: 'Jane Doe',
  path: '/default-domain/workspaces/payers-demo/m1',
  lastModified: '2026-11-24T09:00:00Z',
  properties: {},
} as NuxeoDocument;

const LAYOUT = { type: 'Member' } as ResolvedRecordLayout;

describe('LayoutDesignerPageComponent', () => {
  let fixture: ComponentFixture<LayoutDesignerPageComponent>;
  let page: LayoutDesignerPageComponent;
  let model: BehaviorSubject<Reading<ContentModel>>;
  let source: Subject<Reading<{ url: string; content?: LayoutJson; problem?: string }>>;
  let previewed: unknown[];
  /** Each form preview asked for: the file, its mode, the type and the record. */
  let formsPreviewed: [unknown, string, string, string | undefined][];
  /** Each file read: its type and mode. */
  let read: [string, string][];
  /** What the form preview answers, or `null` for the form drawn. */
  let formAnswer: FormLayoutPreview | null;
  let created: Blob[];
  let clicked: { download: string }[];
  /** The confirmation dialog: what it was asked, and what the person answers. */
  let asked: unknown[];
  let answer: true | undefined;

  const service = () => ({
    files: () =>
      of({
        state: 'read',
        value: [
          { type: 'Member', mode: 'view' },
          { type: 'Member', mode: 'edit' },
          { type: 'Claim', mode: 'view' },
        ],
      }),
    model: () => model,
    // As the service's every reading does: `reading` first, at once.
    source: (type: string, mode: string) => {
      read.push([type, mode]);
      return source.pipe(startWith({ state: 'reading' } as const));
    },
    records: () =>
      of({
        state: 'read',
        value: [
          { uid: 'm1', title: 'Jane Doe', path: RECORD.path },
          { uid: 'm2', title: 'John Roe', path: '/m2' },
        ],
      }),
    record: (uid: string) => of({ state: 'read', value: { ...RECORD, uid } }),
    registries: () => PACKAGED_REGISTRIES,
    preview: (content: unknown): Observable<RecordLayoutPreview> => {
      previewed.push(structuredClone(content));
      return of({ layout: LAYOUT, notes: ['Member/view layout: a note'] });
    },
    previewForm: (
      content: unknown,
      mode: string,
      type: string,
      record: NuxeoDocument | null,
    ): Observable<FormLayoutPreview> => {
      formsPreviewed.push([structuredClone(content), mode, type, record?.uid]);
      return of(
        formAnswer ?? { layout: FORM_LAYOUT, notes: [`Member/${mode} layout: a form note`] },
      );
    },
  });

  beforeEach(() => {
    model = new BehaviorSubject<Reading<ContentModel>>({ state: 'read', value: MODEL });
    source = new Subject();
    previewed = [];
    formsPreviewed = [];
    read = [];
    formAnswer = null;
    created = [];
    clicked = [];
    asked = [];
    answer = undefined;
    // jsdom has no object URLs, and an anchor's click would try to navigate.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:designer';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download });
    });

    TestBed.configureTestingModule({
      imports: [LayoutDesignerPageComponent],
      providers: [
        provideRouter([]),
        provideNxsComponents(),
        { provide: LayoutDesignerService, useFactory: service },
        {
          provide: MatDialog,
          useValue: {
            open: (component: unknown, config: { data: unknown }) => {
              asked.push({ component, data: config.data });
              return { afterClosed: () => of(answer) };
            },
          },
        },
      ],
    });
    TestBed.overrideComponent(LayoutDesignerPageComponent, {
      remove: { imports: [RecordPageComponent, DocumentLayoutFormComponent, LayerPanelComponent] },
      add: { imports: [StubRecordPageComponent, StubFormComponent, StubLayerPanelComponent] },
    });
    fixture = TestBed.createComponent(LayoutDesignerPageComponent);
    page = fixture.componentInstance;
  });

  afterEach(() => vi.restoreAllMocks());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens the Member file `key` names, served as `content`. */
  async function open(content: LayoutJson = MEMBER_VIEW, key = 'Member/view'): Promise<void> {
    await settle();
    page.open(key);
    await settle();
    source.next({ state: 'read', value: { url: `/layouts/${key}.layout.json`, content } });
    await settle();
  }

  const button = (selector: string): HTMLButtonElement => {
    const found = root().querySelector<HTMLButtonElement>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };

  const fieldNames = (): (string | undefined)[] =>
    [...root().querySelectorAll<HTMLElement>('[data-card="cards[0]"] [data-field]')].map(
      (field) => field.dataset['field'],
    );

  const blobText = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it('says that hiding the page is not a security control', async () => {
    await settle();
    expect(root().textContent).toContain('that is not a security control');
  });

  it("hands the deployment layer's panel the file open, as edited, and whether it may be saved", async () => {
    await open();
    const panel = fixture.debugElement.query(By.directive(StubLayerPanelComponent))
      .componentInstance as StubLayerPanelComponent;
    expect(panel.path()).toBe('layouts/Member/view.layout.json');
    expect(panel.file()).toEqual(MEMBER_VIEW);
    expect(panel.saveable()).toBe(true);

    page.file.set({ ...MEMBER_VIEW, bogus: true } as LayoutJson);
    await settle();
    expect(panel.saveable()).toBe(false);

    // A version the panel opens becomes the file edited, a change to the one opened.
    const draft = { version: 2, cards: [{ id: 'member', fields: ['member:phone'] }] };
    panel.openVersion.emit(draft);
    await settle();
    expect(page.file()).toEqual(draft);
    expect(page.unsaved()).toBe(true);
    panel.openVersion.emit(['not', 'a', 'file']);
    expect(page.file()).toEqual(draft);
  });

  it('offers each type its three files, served or new, and opens one with its first record previewed', async () => {
    await open();
    const options = [...root().querySelectorAll<HTMLOptionElement>('[data-picker="type"] option')];
    expect(options.map((option) => [option.value, option.textContent?.trim()])).toEqual([
      ['', 'Choose a file'],
      ['Member/view', 'Member: record page'],
      ['Member/edit', 'Member: edit form'],
      ['Member/create', 'Member: create form, a new file'],
      ['Claim/view', 'Claim: record page'],
      ['Claim/edit', 'Claim: edit form, a new file'],
      ['Claim/create', 'Claim: create form, a new file'],
    ]);
    expect(read).toEqual([['Member', 'view']]);
    expect(page.recordUid()).toBe('m1');
    expect(fieldNames()).toEqual(['age', 'member:phone', 'member:status']);
    expect(previewed).toEqual([MEMBER_VIEW]);
    const stub = fixture.debugElement.query(
      (node) => node.componentInstance instanceof StubRecordPageComponent,
    ).componentInstance as StubRecordPageComponent;
    expect(stub.layout()).toBe(LAYOUT);
    expect(stub.document().uid).toBe('m1');
    expect(stub.readOnly()).toBe(true);
    expect(root().textContent).toContain('Member/view layout: a note');
  });

  it('draws the preview again for another record', async () => {
    await open();
    page.chooseRecord('m2');
    await settle();
    const stub = fixture.debugElement.query(
      (node) => node.componentInstance instanceof StubRecordPageComponent,
    ).componentInstance as StubRecordPageComponent;
    expect(stub.document().uid).toBe('m2');
  });

  it('moves a field, and draws the moved file', async () => {
    await open();
    button('[data-field="member:status"] [data-action="up"]').click();
    await settle();
    expect(fieldNames()).toEqual(['age', 'member:status', 'member:phone']);
    const served = (MEMBER_VIEW['cards'] as LayoutJson[])[0]['fields'] as unknown[];
    const last = previewed.at(-1) as LayoutJson;
    expect((last['cards'] as LayoutJson[])[0]['fields']).toEqual([served[0], served[2], served[1]]);
    expect(button('[data-field="age"] [data-action="up"]').disabled).toBe(true);
    expect(button('[data-field="member:phone"] [data-action="down"]').disabled).toBe(true);
    expect(page.changed()).toBe(true);
  });

  it('keeps the focus on the field it moves, and on the next one when it hides one', async () => {
    await open();
    const focused = (): [string | null | undefined, string | undefined] => {
      const element = document.activeElement as HTMLElement | null;
      return [
        element?.closest('[data-field]')?.getAttribute('data-field'),
        element?.dataset['action'],
      ];
    };
    button('[data-field="member:status"] [data-action="up"]').click();
    await settle();
    expect(focused()).toEqual(['member:status', 'up']);
    // At the top, Up is not offered, so the focus stays on the field, on Down.
    button('[data-field="member:status"] [data-action="up"]').click();
    await settle();
    expect(fieldNames()).toEqual(['member:status', 'age', 'member:phone']);
    expect(focused()).toEqual(['member:status', 'down']);

    button('[data-field="age"] [data-action="hide"]').click();
    await settle();
    expect(focused()).toEqual(['member:phone', 'hide']);
  });

  it('hides a field, and shows it again where it was', async () => {
    await open();
    button('[data-field="member:phone"] [data-action="hide"]').click();
    await settle();
    expect(fieldNames()).toEqual(['age', 'member:status']);
    expect(page.hidden().map((field) => field.name)).toEqual(['member:phone']);
    expect(page.fileText()).not.toContain('member:phone');

    button('[data-hidden="member:phone"] [data-action="show"]').click();
    await settle();
    expect(fieldNames()).toEqual(['age', 'member:phone', 'member:status']);
    expect(page.hidden()).toEqual([]);
    expect(page.file()).toEqual(MEMBER_VIEW);
  });

  it('adds a property of the type that the card does not show yet', async () => {
    await open();
    const choices = [
      ...root().querySelectorAll<HTMLOptionElement>(
        '[data-card="cards[0]"] [data-picker="add"] option',
      ),
    ].map((option) => option.value);
    expect(choices).toEqual(['', 'dc:title', 'member:birthDate', 'member:email']);
    const [card] = page.cards();
    page.choose(card, 'member:email');
    await settle();
    button('[data-card="cards[0]"] [data-action="add"]').click();
    await settle();
    expect(fieldNames()).toEqual(['age', 'member:phone', 'member:status', 'member:email']);
    expect(page.chosen(page.cards()[0])).toBe('');
  });

  it("renames a card's heading and changes its label key", async () => {
    await open();
    const [card] = page.cards();
    page.setText(card, 'label', 'The member');
    page.setText(page.cards()[0], 'labelKey', 'payers.member.heading');
    await settle();
    expect((page.file()?.['cards'] as LayoutJson[])[0]).toMatchObject({
      id: 'member',
      label: 'The member',
      labelKey: 'payers.member.heading',
    });
    expect(page.saveState()).toBe('saveable');
  });

  describe('saving', () => {
    it('downloads a file the validator finds nothing in, as the package holds it', async () => {
      await open();
      button('[data-field="member:status"] [data-action="up"]').click();
      await settle();
      expect(root().querySelector('[data-verdict="none"]')).not.toBeNull();
      const download = button('[data-action="download"]');
      expect(download.disabled).toBe(false);
      download.click();
      expect(clicked).toEqual([{ download: 'view.layout.json' }]);
      expect(created).toHaveLength(1);
      const text = await blobText(created[0]);
      expect(text).toBe(`${JSON.stringify(page.file(), null, 2)}\n`);
      expect(JSON.parse(text).cards[0].fields[1]).toBe('member:status');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:designer');
    });

    it('refuses to save a file the validator refuses, whatever calls it', async () => {
      await open();
      // Card ids are unique in a file: renaming the claims card to "member" is refused.
      page.setText(page.cards()[1], 'id', 'member');
      await settle();
      expect(page.saveState()).toBe('refused');
      expect(page.findings()).toEqual([
        {
          path: 'cards[1].id',
          kind: 'structure',
          message: 'the id "member" is already used at cards[0].id',
        },
      ]);
      expect(root().querySelector('[data-verdict="refused"]')?.textContent).toContain(
        'The validator refuses the file, so it cannot be saved. Findings: 1',
      );
      expect(root().querySelector('[data-kind="structure"]')?.textContent).toContain(
        'the id "member" is already used at cards[0].id',
      );
      expect(button('[data-action="download"]').disabled).toBe(true);
      // The guard is the method's, not only the button's.
      page.download();
      expect(created).toEqual([]);
      expect(clicked).toEqual([]);

      // Put right, it may be saved again.
      page.setText(page.cards()[1], 'id', 'claims');
      await settle();
      page.download();
      expect(clicked).toHaveLength(1);
    });

    it('refuses a file the content model refuses: a property the type does not have', async () => {
      await open({
        ...MEMBER_VIEW,
        cards: [{ id: 'member', fields: ['member:phone', 'member:nope'] }],
      });
      expect(page.saveState()).toBe('refused');
      expect(page.findings().map((finding) => [finding.path, finding.kind])).toEqual([
        ['cards[0].fields[1]', 'unknown'],
      ]);
      page.download();
      expect(created).toEqual([]);
      // Hidden, it is out of the file, which may be saved.
      button('[data-field="member:nope"] [data-action="hide"]').click();
      await settle();
      expect(page.saveState()).toBe('saveable');
    });

    it('waits for the content model before it lets a file be saved', async () => {
      model.next({ state: 'reading' });
      await open();
      expect(page.saveState()).toBe('checking');
      expect(root().querySelector('[data-verdict]')?.textContent).toContain(
        'The validator finds nothing so far.',
      );
      expect(root().querySelector('[data-save="checking"]')).not.toBeNull();
      page.download();
      expect(created).toEqual([]);
      model.next({ state: 'read', value: MODEL });
      await settle();
      expect(page.saveState()).toBe('saveable');
    });

    it('checks the rest without a model it cannot read, and says so', async () => {
      model.next({ state: 'failed', problem: 'HTTP 500' });
      await open({
        ...MEMBER_VIEW,
        cards: [{ id: 'member', fields: ['member:phone', 'member:nope'] }],
      });
      expect(page.saveState()).toBe('saveable');
      expect(root().textContent).toContain(
        "The file is not checked against the server's content model, which could not be read: HTTP 500.",
      );
      expect(page.properties()).toBeNull();
      expect(root().querySelector('[data-picker="add"]')).toBeNull();
    });

    it('undoes every change, back to the file as it was opened', async () => {
      await open();
      button('[data-field="member:phone"] [data-action="hide"]').click();
      page.setText(page.cards()[0], 'id', 'other');
      await settle();
      button('[data-action="reset"]').click();
      await settle();
      expect(page.file()).toEqual(MEMBER_VIEW);
      expect(page.hidden()).toEqual([]);
      expect(page.changed()).toBe(false);
    });
  });

  it('says why a file could not be opened, and offers nothing to edit', async () => {
    await settle();
    page.open('Member/view');
    await settle();
    source.next({ state: 'read', value: { url: '/x', problem: 'HTTP 404' } });
    await settle();
    expect(root().querySelector('[data-source="failed"]')).not.toBeNull();
    expect(page.file()).toBeNull();
    expect(page.saveState()).toBe('nothing');
    expect(root().querySelector('[data-action="download"]')).toBeNull();

    // Opened again, it is read again; once open, it is not.
    page.open('Member/view');
    await settle();
    expect(read).toEqual([
      ['Member', 'view'],
      ['Member', 'view'],
    ]);
    source.next({ state: 'read', value: { url: '/x', content: MEMBER_VIEW } });
    await settle();
    expect(page.file()).toEqual(MEMBER_VIEW);
    page.open('Member/view');
    await settle();
    expect(read).toHaveLength(2);
  });

  it('opens a type by its button, not as the picker changes', async () => {
    await settle();
    const picker = root().querySelector<HTMLSelectElement>('[data-picker="type"]');
    if (!picker) throw new Error('no type picker');
    expect(button('[data-action="open"]').disabled).toBe(true);
    picker.value = 'Member/view';
    picker.dispatchEvent(new Event('change'));
    await settle();
    expect(page.type()).toBeNull();
    const open = button('[data-action="open"]');
    open.focus();
    open.click();
    await settle();
    expect(page.type()).toBe('Member');
    // Still offered, so that the focus stays on it; pressed again, it opens nothing anew.
    expect(open.disabled).toBe(false);
    expect(document.activeElement).toBe(open);
    open.click();
    await settle();
    expect(asked).toEqual([]);
    expect(page.type()).toBe('Member');
  });

  describe('changes not downloaded', () => {
    it('asks before another type is opened, and keeps the file when the answer is no', async () => {
      await open();
      button('[data-field="member:phone"] [data-action="hide"]').click();
      await settle();
      page.fileChosen.set('Claim/view');
      page.open('Claim/view');
      await settle();
      expect(asked).toEqual([
        {
          component: NxsConfirmDialogComponent,
          data: {
            title: 'Discard your changes?',
            message:
              'Your changes to the Member record page have not been downloaded, and will be lost.',
            confirmLabel: 'Discard changes',
          },
        },
      ]);
      expect(page.type()).toBe('Member');
      expect(page.fileChosen()).toBe('Member/view');
      expect(page.hidden().map((field) => field.name)).toEqual(['member:phone']);

      answer = true;
      page.open('Claim/view');
      await settle();
      expect(page.type()).toBe('Claim');
      expect(page.file()).toBeNull();
      expect(page.hidden()).toEqual([]);
    });

    it('opens another type without asking when nothing is changed', async () => {
      await open();
      page.open('Claim/view');
      await settle();
      expect(asked).toEqual([]);
      expect(page.type()).toBe('Claim');
    });

    it('asks before the page is left, and before the tab is closed', async () => {
      await open();
      expect(await firstValueFrom(page.leave())).toBe(true);
      const quiet = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(quiet);
      expect(quiet.defaultPrevented).toBe(false);

      page.setText(page.cards()[0], 'label', 'Changed');
      await settle();
      expect(await firstValueFrom(page.leave())).toBe(false);
      answer = true;
      expect(await firstValueFrom(page.leave())).toBe(true);
      expect(asked).toHaveLength(2);
      const held = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(held);
      expect(held.defaultPrevented).toBe(true);
    });
  });

  it('keeps the focus on what it changes: an added field, and the editor once undone', async () => {
    await open();
    const [card] = page.cards();
    page.choose(card, 'member:email');
    await settle();
    button('[data-card="cards[0]"] [data-action="add"]').click();
    await settle();
    const added = document.activeElement as HTMLElement | null;
    expect(added?.closest('[data-field]')?.getAttribute('data-field')).toBe('member:email');
    expect(added?.dataset['action']).toBe('up');

    button('[data-action="reset"]').click();
    await settle();
    expect(document.activeElement?.id).toBe('layout-designer-editor');
  });

  describe('forms', () => {
    /** Sets a picker or a field, as the person does, and lets it say so. */
    const change = (selector: string, value: string): void => {
      const element = root().querySelector<
        HTMLSelectElement | HTMLTextAreaElement | HTMLInputElement
      >(selector);
      if (!element) throw new Error(`no ${selector}`);
      element.value = value;
      element.dispatchEvent(new Event('change'));
    };

    const stubForm = (): StubFormComponent | undefined =>
      fixture.debugElement.query((node) => node.componentInstance instanceof StubFormComponent)
        ?.componentInstance as StubFormComponent | undefined;

    const fields = (): unknown[] =>
      ((page.file()?.['cards'] as LayoutJson[])[0]['fields'] as unknown[]) ?? [];

    it('opens an edit form, and previews it with the form engine, read-only, for the record', async () => {
      await open(MEMBER_EDIT, 'Member/edit');
      expect(read).toEqual([['Member', 'edit']]);
      expect(fieldNames()).toEqual(['member:phone', 'member:status', 'member:email']);
      expect(formsPreviewed).toEqual([[MEMBER_EDIT, 'edit', 'Member', 'm1']]);
      expect(previewed).toEqual([]);
      expect(root().querySelector('lib-record-page')).toBeNull();
      const form = stubForm();
      expect(form?.mode()).toBe('edit');
      expect(form?.document()?.uid).toBe('m1');
      expect(form?.preview()).toBe(FORM_LAYOUT);
      // Read-only, so that nothing typed there could be saved; the page offers no Save of its own.
      expect(form?.disabled()).toBe(true);
      expect(root().textContent).toContain(
        'The edit form of Jane Doe, read-only. Nothing is saved: Save is not offered here.',
      );
      expect(root().textContent).toContain('Member/edit layout: a form note');
      expect(root().querySelector('.layout-designer__notes h3')?.textContent?.trim()).toBe(
        'What the form leaves out, and why',
      );
      expect(
        [...root().querySelectorAll('[data-note="required"]')].map((note) =>
          note.closest('[data-field]')?.getAttribute('data-field'),
        ),
      ).toEqual(['member:phone', 'member:email']);

      button('[data-action="download"]').click();
      expect(clicked).toEqual([{ download: 'edit.layout.json' }]);
    });

    it("says, in a form's own words, why no form is drawn and what it leaves out", async () => {
      formAnswer = {
        notDrawn: 'the schemas of Member could not be read',
        notes: ['Member/edit layout: left out'],
      };
      await open(MEMBER_EDIT, 'Member/edit');
      expect(stubForm()).toBeUndefined();
      expect(root().querySelector('[data-preview="not-drawn"]')?.textContent).toContain(
        'No form is drawn for this record: the schemas of Member could not be read',
      );
      expect(root().querySelector('.layout-designer__notes h3')?.textContent?.trim()).toBe(
        'What the form leaves out, and why',
      );
    });

    it('makes a field required always, or not, writing a string field as an object and back', async () => {
      await open(MEMBER_EDIT, 'Member/edit');
      change('[data-field="member:status"] [data-rule="required-choice"]', 'always');
      await settle();
      expect(fields()[1]).toEqual({ field: 'member:status', required: true });
      expect(formsPreviewed.at(-1)?.[0]).toEqual(page.file());

      change('[data-field="member:status"] [data-rule="required-choice"]', 'no');
      change('[data-field="member:phone"] [data-rule="required-choice"]', 'no');
      await settle();
      expect(fields()[0]).toEqual({ field: 'member:phone', widget: 'phone' });
      expect(fields()[1]).toBe('member:status');
      expect(page.saveState()).toBe('saveable');

      page.open('Member/view');
      await settle();
      expect((asked[0] as { data: { message: string } }).data.message).toBe(
        'Your changes to the Member edit form have not been downloaded, and will be lost.',
      );
    });

    it("writes a field's rules as configuration, the rule's ID or its JSON", async () => {
      await open(MEMBER_EDIT, 'Member/edit');
      change('[data-field="member:status"] [data-rule="readOnlyWhen"]', ' app.rules.isLocked ');
      change(
        '[data-field="member:status"] [data-rule="visibleWhen"]',
        '{ "type": "app.rules.inGroup", "parameters": ["members"] }',
      );
      await settle();
      expect(fields()[1]).toEqual({
        field: 'member:status',
        readOnlyWhen: 'app.rules.isLocked',
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['members'] },
      });
      expect(
        root().querySelector<HTMLTextAreaElement>(
          '[data-field="member:status"] [data-rule="visibleWhen"]',
        )?.value,
      ).toBe(JSON.stringify({ type: 'app.rules.inGroup', parameters: ['members'] }, null, 2));
      expect(page.findings()).toEqual([]);
      // Emptied, each is taken out, and the field written as it was.
      change('[data-field="member:status"] [data-rule="readOnlyWhen"]', '');
      change('[data-field="member:status"] [data-rule="visibleWhen"]', '  ');
      await settle();
      expect(fields()[1]).toBe('member:status');
    });

    it('refuses to save a form whose rule is not one, whatever calls it', async () => {
      await open(MEMBER_EDIT, 'Member/edit');
      // A rule chosen and not yet written is written empty, which the validator refuses.
      change('[data-field="member:status"] [data-rule="required-choice"]', 'rule');
      await settle();
      expect(fields()[1]).toEqual({ field: 'member:status', required: '' });
      expect(page.findings().map((finding) => [finding.path, finding.kind])).toEqual([
        ['cards[0].fields[1].required', 'structure'],
      ]);
      expect(page.saveState()).toBe('refused');
      expect(button('[data-action="download"]').disabled).toBe(true);
      page.download();
      expect(created).toEqual([]);

      change('[data-field="member:status"] [data-rule="required"]', 'app.rules.canWrite');
      await settle();
      expect(page.saveState()).toBe('saveable');

      // JSON that is not JSON is written as it was typed, as a rule's ID, and the validator
      // refuses it: the designer does not guess what was meant.
      change('[data-field="member:status"] [data-rule="visibleWhen"]', '{ "type": "app.rules.');
      await settle();
      expect(fields()[1]).toMatchObject({ visibleWhen: '{ "type": "app.rules.' });
      expect(page.findings().map((finding) => finding.path)).toEqual([
        'cards[0].fields[1].visibleWhen',
      ]);
      page.download();
      expect(created).toEqual([]);
      expect(clicked).toEqual([]);
    });

    it('checks a form in its own mode: a card only a record page has is refused', async () => {
      const withList: LayoutJson = {
        version: 2,
        cards: [
          { id: 'member', fields: ['member:phone'] },
          { id: 'claims', related: { pageProvider: 'member_claims', columns: ['claim:number'] } },
        ],
      };
      await open(withList, 'Member/edit');
      expect(page.findings().map((finding) => [finding.path, finding.kind])).toEqual([
        ['cards[1].related', 'structure'],
      ]);
      expect(page.saveState()).toBe('refused');
    });

    it('offers no required or read-only rule on a record page, where only forms have them', async () => {
      await open();
      expect(root().querySelector('[data-rule="required-choice"]')).toBeNull();
      expect(root().querySelector('[data-rule="readOnlyWhen"]')).toBeNull();
      expect(root().querySelectorAll('[data-rule="visibleWhen"]')).toHaveLength(3);
    });

    it("opens a create form the server does not serve as a new file, previewed in the record's folder", async () => {
      await settle();
      page.open('Member/create');
      await settle();
      expect(read).toEqual([]);
      expect(root().querySelector('[data-new]')?.textContent).toContain(
        'The server serves no create.layout.json for Member: this is a new file',
      );
      expect(page.file()).toEqual({ version: 2, cards: [{ id: 'main', fields: [] }] });
      expect(page.unsaved()).toBe(false);

      page.choose(page.cards()[0], 'member:phone');
      page.add(page.cards()[0]);
      await settle();
      expect(fields()).toEqual(['member:phone']);
      expect(formsPreviewed.at(-1)).toEqual([page.file(), 'create', 'Member', 'm1']);
      const form = stubForm();
      expect(form?.mode()).toBe('create');
      expect(form?.document()).toBeNull();
      expect(form?.type()).toBe('Member');
      expect(form?.parentPath()).toBe('/default-domain/workspaces/payers-demo');
      expect(form?.disabled()).toBe(true);
      expect(page.unsaved()).toBe(true);

      button('[data-action="download"]').click();
      expect(clicked).toEqual([{ download: 'create.layout.json' }]);
    });
  });
});
