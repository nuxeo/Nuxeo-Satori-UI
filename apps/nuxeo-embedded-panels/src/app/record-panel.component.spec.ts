import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { EXPIRED, READY, TOKEN } from './panel-handshake';
import { PanelMessages } from './panel-messages.service';
import { PANEL_SERVER } from './panel-server';
import { PanelToken, panelTokenInterceptor } from './panel-token';
import { RecordPanelComponent, panelLayout } from './record-panel.component';

const SERVER = {
  origin: 'https://nuxeo.example.com',
  base: 'https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/',
};
const RECORD = '5f1c0e2a-0000-4000-8000-000000000130';
const FIRST = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJqc21pdGgiLCJuIjoxfQ.c2lnbmF0dXJlMQ';
const SECOND = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJqc21pdGgiLCJuIjoyfQ.c2lnbmF0dXJlMg';
const FORMAT = 'nuxeo-agentic-ui-config/1';
const CONFIG = `${SERVER.origin}/nuxeo/agentic-ui-config`;
const HOSTS = `${SERVER.origin}/nuxeo/agentic-embedded/v1/hosts/crm`;
const DOCUMENT = `${SERVER.origin}/nuxeo/api/v1/id/${RECORD}`;

const CLAIM = {
  'entity-type': 'document',
  uid: RECORD,
  type: 'Claim',
  title: 'CLAIM-000130',
  lastModified: '2026-11-20T10:00:00.000Z',
  facets: [],
  schemas: [
    { name: 'dublincore', prefix: 'dc' },
    { name: 'claim', prefix: 'claim' },
  ],
  properties: {
    'dc:title': 'CLAIM-000130',
    'claim:number': 'CLAIM-000130',
    'claim:billedAmount': 412.5,
  },
  contextParameters: { permissions: ['Read'] },
};

const VIEW = {
  version: 2,
  columns: 2,
  cards: [
    { id: 'claim', label: 'Claim', fields: ['claim:number'] },
    { id: 'notes', label: 'Notes', fields: ['dc:title'] },
    {
      id: 'payment',
      label: 'Payment',
      external: {
        connector: 'payers.claimPayments',
        fields: [{ name: 'paymentStatus', label: 'Payment status' }],
      },
    },
  ],
};

const CLAIM_TYPE = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', billedAmount: 'double' } },
  ],
};

describe('RecordPanelComponent: a record page panel inside another system page', () => {
  let fixture: ComponentFixture<RecordPanelComponent>;
  let backend: HttpTestingController;
  let posted: { message: Record<string, unknown>; origin: string }[];
  let messages: PanelMessages;

  const page = window.location.origin;

  beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown, origin?: unknown) => {
      posted.push({ message: message as Record<string, unknown>, origin: String(origin) });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: PANEL_SERVER, useValue: SERVER },
        { provide: NUXEO_API_ORIGIN, useValue: SERVER.origin },
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: `${CONFIG}/bootstrap.json` },
        PanelToken,
        PanelMessages,
        provideHttpClient(withXhr(), withInterceptors([panelTokenInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        provideNxsComponents(),
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    messages = TestBed.inject(PanelMessages);
    fixture = TestBed.createComponent(RecordPanelComponent);
  });

  afterEach(() => vi.restoreAllMocks());

  const shadow = () => fixture.nativeElement.shadowRoot as ShadowRoot;
  const state = () => shadow().querySelector('.record-panel')?.getAttribute('data-state');

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  async function start(record: string | null = RECORD, host: string | null = 'crm'): Promise<void> {
    fixture.componentRef.setInput('recordId', record);
    fixture.componentRef.setInput('host', host);
    await settle();
  }

  function give(token: string, from: Partial<MessageEventInit> = {}): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: page,
        source: window,
        data: { type: TOKEN, panel: messages.panel, token },
        ...from,
      }),
    );
  }

  /** The layout engine's reads of a Claim's page: the index, its view file, its type. */
  function serveTheLayout(): void {
    backend.expectOne(`${CONFIG}/layouts.json`).flush({
      format: FORMAT,
      layer: 'layouts',
      layouts: [{ type: 'Claim', mode: 'view', component: 'org.acme.config' }],
      diagnostics: [],
    });
  }

  async function serveTheRest(): Promise<void> {
    await settle();
    backend
      .expectOne(`${CONFIG}/layouts/Claim/view.layout.json`)
      .flush({ format: FORMAT, layer: 'layout', type: 'Claim', mode: 'view', content: VIEW });
    await settle();
    backend.expectOne(`${SERVER.origin}/nuxeo/api/v1/config/types/Claim`).flush(CLAIM_TYPE);
    await settle();
  }

  it('lives in a shadow root of its own', () => {
    expect(fixture.nativeElement.shadowRoot).not.toBeNull();
  });

  it('asks the server for the host origins, then its page for a token, then reads the record with it', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: [page] });
    await settle();
    expect(state()).toBe('signing-in');
    expect(posted).toEqual([
      {
        message: { type: READY, panel: messages.panel, host: 'crm', recordId: RECORD },
        origin: page,
      },
    ]);

    give(FIRST);
    await settle();
    const read = backend.expectOne((request) => request.url === DOCUMENT);
    expect(read.request.headers.get('Authorization')).toBe(`Bearer ${FIRST}`);
    expect(read.request.withCredentials).toBe(false);
    expect(read.request.urlWithParams).not.toContain(FIRST);
    read.flush(CLAIM);
    await settle();
    serveTheLayout();
    await serveTheRest();

    // The card from the core system reads through the server's connector, with the token.
    const connector = backend.expectOne(`${SERVER.origin}/nuxeo/api/v1/automation/Connector.Read`);
    expect(connector.request.headers.get('Authorization')).toBe(`Bearer ${FIRST}`);
    expect(connector.request.body).toEqual({
      params: { connector: 'payers.claimPayments' },
      context: {},
      input: `doc:${RECORD}`,
    });
    connector.flush({
      connector: 'payers.claimPayments',
      status: 'found',
      fields: { paymentStatus: 'Paid' },
    });
    await settle();

    expect(state()).toBe('ready');
    const text = shadow().textContent ?? '';
    expect(text).toContain('CLAIM-000130');
    expect(text).toContain('Paid');
    expect(shadow().querySelector('[data-field="paymentStatus"]')).not.toBeNull();
    // Read-only: nothing on the page writes.
    expect(shadow().querySelector('textarea, input[type="checkbox"]')).toBeNull();
    // The token is in no attribute, nowhere on the page.
    expect(fixture.nativeElement.outerHTML).not.toContain(FIRST);
    expect(shadow().innerHTML).not.toContain(FIRST);
    backend.verify();
  });

  it('refuses a page the configuration does not name, and asks it for nothing', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: ['https://crm.example.com'] });
    await settle();
    expect(state()).toBe('refused');
    expect(posted).toEqual([]);
    give(FIRST, { origin: 'https://crm.example.com' });
    await settle();
    backend.verify();
  });

  it('refuses when the server will not give the host origins to this page', async () => {
    await start();
    backend
      .expectOne(HOSTS)
      .flush({ error: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(state()).toBe('refused');
    expect(posted).toEqual([]);
    backend.verify();
  });

  it('refuses attributes that name no record or no host, before asking the server anything', async () => {
    await start('../../management', 'crm');
    expect(state()).toBe('refused');
    await start(RECORD, 'CRM host');
    expect(state()).toBe('refused');
    backend.verify();
  });

  it('ignores a token from another origin or another window', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: [page] });
    await settle();
    give(FIRST, { origin: 'https://elsewhere.example' });
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    give(FIRST, { source: frame.contentWindow });
    await settle();
    expect(state()).toBe('signing-in');
    backend.verify();
    frame.remove();
  });

  it('asks its page for a fresh token when the server refuses one as expired, and reads again', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: [page] });
    await settle();
    give(FIRST);
    await settle();
    backend
      .expectOne((request) => request.url === DOCUMENT)
      .flush({ status: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    expect(state()).toBe('signing-in');
    expect(posted.map((each) => each.message['type'])).toEqual([READY, EXPIRED]);

    give(SECOND);
    await settle();
    const again = backend.expectOne((request) => request.url === DOCUMENT);
    expect(again.request.headers.get('Authorization')).toBe(`Bearer ${SECOND}`);
    again.flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(state()).toBe('not-found');
    backend.verify();
  });

  it('asks for a fresh token once only: a second refusal in a row is an error, not another exchange', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: [page] });
    await settle();
    give(FIRST);
    await settle();
    backend
      .expectOne((request) => request.url === DOCUMENT)
      .flush({ status: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    give(SECOND);
    await settle();
    backend
      .expectOne((request) => request.url === DOCUMENT)
      .flush({ status: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    expect(state()).toBe('failed');
    expect(posted.map((each) => each.message['type'])).toEqual([READY, EXPIRED]);
    expect(shadow().querySelector('nxs-error-state')?.getAttribute('data-status')).toBe('401');
    backend.verify();
  });

  it('shows a record the user may not read as not found, and a refused one as such', async () => {
    await start();
    backend.expectOne(HOSTS).flush({ host: 'crm', origins: [page] });
    await settle();
    give(FIRST);
    await settle();
    backend
      .expectOne((request) => request.url === DOCUMENT)
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(state()).toBe('forbidden');
  });
});

describe('panelLayout: the cards a page asks for', () => {
  const layout = {
    type: 'Claim',
    columns: 3,
    banners: [{ id: 'late' }],
    preview: null,
    review: false,
    shareLinks: true,
    tabs: [
      { id: 'main', cards: [{ id: 'claim' }, { id: 'notes' }] },
      { id: 'more', cards: [{ id: 'payment' }] },
    ],
    cards: [],
    properties: new Map(),
  } as never;

  it('keeps the named cards, in the order named, as one list with no banner or tab', () => {
    const picked = panelLayout(layout, ['payment', 'claim', 'missing']);
    expect(picked.cards.map((card) => card.id)).toEqual(['payment', 'claim']);
    expect(picked.tabs).toBeNull();
    expect(picked.banners).toEqual([]);
    expect(picked.shareLinks).toBe(false);
    expect(picked.columns).toBe(2);
  });

  it('keeps the whole page when none is named', () => {
    expect(panelLayout(layout, null)).toBe(layout);
  });
});
