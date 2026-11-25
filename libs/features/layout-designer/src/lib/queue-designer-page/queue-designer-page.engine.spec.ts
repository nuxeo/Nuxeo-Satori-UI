/**
 * The queue designer with the queue page itself, not a stand-in: the real `LayoutDesignerService`,
 * `QueueService` and `lib-queue-page`, the server answered by `HttpTestingController`. What it
 * holds: the list the preview draws is the queue page's, from the file as edited, against the page
 * provider, and every request the designer makes, the page provider's included, is a read.
 */
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { RECORD_PAGE_TODAY } from '@agentic-ui/shared/document-layouts';
import { APP_BOOTSTRAP_CONFIG_URL, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  EXTENSION_SLOTS,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import { NUXEO_API_ORIGIN, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { providePackagedRowActions } from '@nuxeo/satori-platform/ui';

import { QueueDesignerPageComponent } from './queue-designer-page';

const CONFIG = '/nuxeo/agentic-ui-config';
const EXECUTE = '/nuxeo/api/v1/search/pp/contracts_up_for_renewal/execute';

const QUEUE = {
  version: 2,
  label: 'Up for renewal',
  pageProvider: 'contracts_up_for_renewal',
  columns: ['contract:number', 'dc:title', { field: 'contract:end', widget: 'date' }],
  sort: [{ field: 'contract:end', order: 'asc' }],
  pageSize: 50,
  rowActions: ['app.rowActions.delete'],
  bulkActions: ['app.bulkActions.delete'],
};

const CONTRACT_SCHEMA = {
  name: 'contract',
  '@prefix': 'contract',
  fields: { number: 'string', end: 'date', status: 'string' },
};

const contract = (n: number): NuxeoDocument => ({
  uid: `k${n}`,
  type: 'Contract',
  title: `Contract ${n}`,
  path: `/contracts/k${n}`,
  lastModified: '2026-11-24T09:00:00Z',
  properties: {
    'dc:title': `Contract ${n}`,
    'contract:number': `CTR-${n}`,
    'contract:end': '2026-12-0' + n,
  },
  contextParameters: { permissions: ['Read', 'Write', 'Remove'] },
});

describe('QueueDesignerPageComponent, with the queue page', () => {
  let fixture: ComponentFixture<QueueDesignerPageComponent>;
  let http: HttpTestingController;
  let asked: { sortBy: string | null; sortOrder: string | null }[];

  beforeEach(() => {
    asked = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      imports: [QueueDesignerPageComponent, MatIconTestingModule],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNxsComponents(),
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.rowActions]: PACKAGED_ROW_ACTIONS,
            [EXTENSION_SLOTS['bulk-actions']]: PACKAGED_BULK_ACTIONS,
          },
          rules: DOCUMENT_RULE_EVALUATORS,
          actions: { 'app.bulkActions.delete': { execute: () => undefined, wholeQuery: true } },
        }),
        providePackagedRowActions(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: `${CONFIG}/bootstrap.json` },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-24T12:00:00Z') },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(QueueDesignerPageComponent);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  /** Every request still open answered, as the server would; each must be a read. */
  function answer(): void {
    for (const request of http.match(() => true)) {
      if (request.cancelled) continue;
      expect(request.request.method).toBe('GET');
      const url = request.request.url;
      if (url === `${CONFIG}/navigation.json`) {
        request.flush({
          version: 2,
          entries: [{ id: 'renewals', icon: 'clock', queue: 'up-for-renewal' }],
        });
      } else if (url === `${CONFIG}/queues/up-for-renewal.json`) {
        request.flush(QUEUE);
      } else if (url === '/nuxeo/api/v1/config/types') {
        request.flush({
          doctypes: { Contract: { parent: 'Document', facets: [], schemas: ['contract'] } },
        });
      } else if (url === '/nuxeo/api/v1/config/facets') {
        request.flush([]);
      } else if (url === '/nuxeo/api/v1/config/schemas') {
        request.flush([CONTRACT_SCHEMA]);
      } else if (url === '/nuxeo/api/v1/config/types/Contract') {
        request.flush({
          name: 'Contract',
          schemas: [
            { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
            CONTRACT_SCHEMA,
          ],
        });
      } else if (url === EXECUTE) {
        asked.push({
          sortBy: request.request.params.get('sortBy'),
          sortOrder: request.request.params.get('sortOrder'),
        });
        request.flush({
          entries: [contract(1), contract(2)],
          totalSize: 2,
          resultsCount: 2,
          currentPageSize: 2,
          currentPageIndex: 0,
          numberOfPages: 1,
          isNextPageAvailable: false,
        });
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

  /** The column headers the queue page draws, in its order. */
  const headers = (): string[] =>
    [...root().querySelectorAll<HTMLElement>('lib-queue-page [role="columnheader"]')]
      .map((header) => (header.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((text) => text !== '');

  it('draws the edited queue with the queue page, against the page provider, reading only', async () => {
    await settleAndAnswer();
    const page = fixture.componentInstance;
    page.idChosen.set('up-for-renewal');
    page.open('up-for-renewal');
    await settleAndAnswer();
    expect(root().querySelector('lib-queue-page h3')?.textContent?.trim()).toBe('Up for renewal');
    expect(asked).toEqual([{ sortBy: 'contract:end', sortOrder: 'asc' }]);
    const before = headers();
    expect(before).toHaveLength(3);
    expect(root().querySelector('lib-queue-page')?.textContent).toContain('CTR-1');

    page.move('columns', 2, -1);
    page.setOrder(page.sorts()[0], 'desc');
    await settleAndAnswer();
    expect(asked.at(-1)).toEqual({ sortBy: 'contract:end', sortOrder: 'desc' });
    // The third column, moved up, is drawn second.
    expect(headers()).toEqual([before[0], before[2], before[1]]);
    expect(page.saveState()).toBe('saveable');
    // Read-only: the rows the queue's bulk actions would let be selected cannot be.
    expect(root().querySelector('lib-queue-page input[type="checkbox"]')).toBeNull();
  });
});
