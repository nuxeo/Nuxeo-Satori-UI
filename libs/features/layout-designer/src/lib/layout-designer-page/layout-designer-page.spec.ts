import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  PACKAGED_REGISTRIES,
  readContentModel,
  type ContentModel,
} from '@agentic-ui/shared/app-definition';
import {
  RecordPageComponent,
  type RecordLayoutPreview,
  type ResolvedRecordLayout,
} from '@agentic-ui/shared/document-layouts';
import { MatDialog } from '@angular/material/dialog';
import { NxsConfirmDialogComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { BehaviorSubject, Subject, firstValueFrom, of, startWith, type Observable } from 'rxjs';

import { LayoutDesignerService, type Reading } from '../layout-designer.service';
import type { LayoutJson } from '../layout-edits';
import { LayoutDesignerPageComponent } from './layout-designer-page';

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
  let created: Blob[];
  let clicked: { download: string }[];
  /** The confirmation dialog: what it was asked, and what the person answers. */
  let asked: unknown[];
  let answer: true | undefined;

  const service = () => ({
    types: () => of({ state: 'read', value: ['Member', 'Claim'] }),
    model: () => model,
    // As the service's every reading does: `reading` first, at once.
    source: () => source.pipe(startWith({ state: 'reading' } as const)),
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
  });

  beforeEach(() => {
    model = new BehaviorSubject<Reading<ContentModel>>({ state: 'read', value: MODEL });
    source = new Subject();
    previewed = [];
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
      remove: { imports: [RecordPageComponent] },
      add: { imports: [StubRecordPageComponent] },
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

  /** Opens the Member page, served as `content`. */
  async function open(content: LayoutJson = MEMBER_VIEW): Promise<void> {
    await settle();
    page.open('Member');
    await settle();
    source.next({ state: 'read', value: { url: '/layouts/Member/view.layout.json', content } });
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

  it('offers the served record pages, and opens one with its first record previewed', async () => {
    await open();
    const options = [...root().querySelectorAll<HTMLOptionElement>('[data-picker="type"] option')];
    expect(options.map((option) => option.value)).toEqual(['', 'Member', 'Claim']);
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
    page.open('Member');
    await settle();
    source.next({ state: 'read', value: { url: '/x', problem: 'HTTP 404' } });
    await settle();
    expect(root().querySelector('[data-source="failed"]')).not.toBeNull();
    expect(page.file()).toBeNull();
    expect(page.saveState()).toBe('nothing');
    expect(root().querySelector('[data-action="download"]')).toBeNull();
  });

  it('opens a type by its button, not as the picker changes', async () => {
    await settle();
    const picker = root().querySelector<HTMLSelectElement>('[data-picker="type"]');
    if (!picker) throw new Error('no type picker');
    expect(button('[data-action="open"]').disabled).toBe(true);
    picker.value = 'Member';
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
      page.typeChosen.set('Claim');
      page.open('Claim');
      await settle();
      expect(asked).toEqual([
        {
          component: NxsConfirmDialogComponent,
          data: {
            title: 'Discard your changes?',
            message:
              'Your changes to the Member layout have not been downloaded, and will be lost.',
            confirmLabel: 'Discard changes',
          },
        },
      ]);
      expect(page.type()).toBe('Member');
      expect(page.typeChosen()).toBe('Member');
      expect(page.hidden().map((field) => field.name)).toEqual(['member:phone']);

      answer = true;
      page.open('Claim');
      await settle();
      expect(page.type()).toBe('Claim');
      expect(page.file()).toBeNull();
      expect(page.hidden()).toEqual([]);
    });

    it('opens another type without asking when nothing is changed', async () => {
      await open();
      page.open('Claim');
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
});
