/**
 * The designer with the engines themselves, not stand-ins: the real `LayoutDesignerService`,
 * `DocumentLayoutService`, `lib-record-page` and `lib-document-layout-form`, the server answered by
 * `HttpTestingController`. What it holds: the page or form the preview draws is the engine's, from
 * the file as edited, the form's inputs are read-only, and every request the designer makes is a read.
 */
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { APP_BOOTSTRAP_CONFIG_URL, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  DocumentDetailService,
  NUXEO_API_ORIGIN,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';

import { LayoutDesignerPageComponent } from './layout-designer-page';

const CONFIG = '/nuxeo/agentic-ui-config';
const FORMAT = 'nuxeo-agentic-ui-config/1';

const VIEW = {
  version: 2,
  cards: [
    {
      id: 'member',
      label: 'Member',
      fields: ['member:firstName', 'member:lastName', { field: 'member:phone', widget: 'phone' }],
    },
  ],
};

const EDIT = {
  version: 2,
  cards: [
    {
      id: 'member',
      label: 'Member',
      fields: [
        { field: 'member:firstName', required: true },
        'member:lastName',
        { field: 'member:phone', widget: 'phone' },
      ],
    },
  ],
};

const MEMBER_SCHEMA = {
  name: 'member',
  '@prefix': 'member',
  fields: { firstName: 'string', lastName: 'string', phone: 'string', email: 'string' },
};

const RECORD = {
  uid: 'm1',
  type: 'Member',
  title: 'Jane Doe',
  path: '/default-domain/workspaces/payers-demo/m1',
  lastModified: '2026-11-24T09:00:00Z',
  properties: {
    'member:firstName': 'Jane',
    'member:lastName': 'Doe',
    'member:phone': '(916) 555-0152',
    'member:email': 'jane@example.com',
  },
} as NuxeoDocument;

describe('LayoutDesignerPageComponent, with the record page and form engines', () => {
  let fixture: ComponentFixture<LayoutDesignerPageComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [LayoutDesignerPageComponent, MatIconTestingModule],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNxsComponents(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: `${CONFIG}/bootstrap.json` },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        // The record, as the document page reads it: the one read here not answered over HTTP.
        { provide: DocumentDetailService, useValue: { getFullDocument: () => of(RECORD) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LayoutDesignerPageComponent);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  /**
   * One turn: the page drawn, and its timers and effects run. Not `whenStable`, which waits for
   * every request still open, and these are answered by `answer`.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  /** Every request still open answered, as the server would; each must be a read. */
  function answer(): void {
    for (const request of http.match(() => true)) {
      // A read the page gave up on, as a `switchMap` does when what it reads for changes.
      if (request.cancelled) continue;
      expect(request.request.method).toBe('GET');
      const url = request.request.url;
      if (url === `${CONFIG}/layouts.json`) {
        request.flush({
          format: FORMAT,
          layer: 'layouts',
          layouts: [
            { type: 'Member', mode: 'view', component: 'payers' },
            { type: 'Member', mode: 'edit', component: 'payers' },
          ],
          diagnostics: [],
        });
      } else if (url === `${CONFIG}/layouts/Member/view.layout.json`) {
        request.flush({
          format: FORMAT,
          layer: 'layout',
          type: 'Member',
          mode: 'view',
          content: VIEW,
        });
      } else if (url === `${CONFIG}/layouts/Member/edit.layout.json`) {
        request.flush({
          format: FORMAT,
          layer: 'layout',
          type: 'Member',
          mode: 'edit',
          content: EDIT,
        });
      } else if (url === '/nuxeo/api/v1/config/types') {
        request.flush({
          doctypes: { Member: { parent: 'Document', facets: [], schemas: ['member'] } },
        });
      } else if (url === '/nuxeo/api/v1/config/facets') {
        request.flush([]);
      } else if (url === '/nuxeo/api/v1/config/schemas') {
        request.flush([MEMBER_SCHEMA]);
      } else if (url === '/nuxeo/api/v1/config/types/Member') {
        request.flush({ name: 'Member', schemas: [MEMBER_SCHEMA] });
      } else if (url === '/nuxeo/api/v1/search/lang/NXQL/execute') {
        request.flush({ entries: [RECORD] });
      } else {
        throw new Error(`unexpected request: ${url}`);
      }
    }
  }

  async function settleAndAnswer(): Promise<void> {
    for (let round = 0; round < 6; round++) {
      await settle();
      answer();
    }
    await settle();
  }

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** The fields the record page draws, in its order. */
  const drawn = (): (string | undefined)[] =>
    [...root().querySelectorAll<HTMLElement>('lib-record-page [data-field]')].map(
      (field) => field.dataset['field'],
    );

  it('draws the edited file with the record page, reading only', async () => {
    await settleAndAnswer();
    fixture.componentInstance.open('Member/view');
    await settleAndAnswer();
    expect(drawn()).toEqual(['member:firstName', 'member:lastName', 'member:phone']);
    expect(
      root().querySelector('lib-record-page [data-field="member:phone"]')?.textContent,
    ).toContain('(916) 555-0152');

    const page = fixture.componentInstance;
    page.moveUp(page.cards()[0], page.cards()[0].fields[2]);
    await settleAndAnswer();
    expect(drawn()).toEqual(['member:firstName', 'member:phone', 'member:lastName']);

    page.choose(page.cards()[0], 'member:email');
    page.add(page.cards()[0]);
    await settleAndAnswer();
    expect(drawn()).toEqual([
      'member:firstName',
      'member:phone',
      'member:lastName',
      'member:email',
    ]);
    expect(page.saveState()).toBe('saveable');
  });

  it('draws nothing for a file the engine refuses, and says why', async () => {
    await settleAndAnswer();
    const page = fixture.componentInstance;
    page.open('Member/view');
    await settleAndAnswer();
    page.setText(page.cards()[0], 'id', 'not an id');
    await settleAndAnswer();
    expect(root().querySelector('lib-record-page')).toBeNull();
    expect(root().querySelector('[data-preview="refused"]')?.textContent).toContain(
      'cards[0].id: an id is 1 to 64 letters',
    );
    expect(page.saveState()).toBe('refused');
  });

  describe('the edit form, with the form engine', () => {
    /** The inputs the form draws, by property, in its order. */
    const inputs = (): HTMLInputElement[] => [
      ...root().querySelectorAll<HTMLInputElement>('lib-document-layout-form input[data-xpath]'),
    ];
    const drawnInputs = (): (string | null)[] =>
      inputs().map((input) => input.getAttribute('data-xpath'));

    it('draws the edited file with the form engine, for the record, every input read-only', async () => {
      await settleAndAnswer();
      const page = fixture.componentInstance;
      page.open('Member/edit');
      await settleAndAnswer();
      expect(root().querySelector('lib-record-page')).toBeNull();
      expect(drawnInputs()).toEqual(['member:firstName', 'member:lastName', 'member:phone']);
      expect(inputs().map((input) => input.value)).toEqual(['Jane', 'Doe', '(916) 555-0152']);
      // Read-only: nothing can be typed, so there is nothing a Save could send.
      expect(inputs().every((input) => input.disabled)).toBe(true);

      page.moveUp(page.cards()[0], page.cards()[0].fields[2]);
      page.choose(page.cards()[0], 'member:email');
      page.add(page.cards()[0]);
      await settleAndAnswer();
      expect(drawnInputs()).toEqual([
        'member:firstName',
        'member:phone',
        'member:lastName',
        'member:email',
      ]);
      expect(page.saveState()).toBe('saveable');
    });

    it('follows a required rule as configuration, and refuses a rule that is not one', async () => {
      await settleAndAnswer();
      const page = fixture.componentInstance;
      page.open('Member/edit');
      await settleAndAnswer();
      const lastName = (): HTMLInputElement | undefined =>
        inputs().find((input) => input.getAttribute('data-xpath') === 'member:lastName');
      expect(lastName()?.required).toBe(false);
      page.setRequired(page.cards()[0], page.cards()[0].fields[1], 'always');
      await settleAndAnswer();
      expect(lastName()?.required).toBe(true);

      page.setRule(page.cards()[0], page.cards()[0].fields[1], 'visibleWhen', 'not a rule!');
      await settleAndAnswer();
      expect(page.saveState()).toBe('refused');
      // The form engine refuses it too, and draws nothing.
      expect(drawnInputs()).toEqual([]);
      expect(root().querySelector('[data-preview="refused"]')?.textContent).toContain(
        'The form refuses this file',
      );
    });
  });
});
