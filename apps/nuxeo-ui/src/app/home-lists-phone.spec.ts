/**
 * The home's lists, the person's tasks and their recent records (docs/business-apps/
 * app-definition-v2.md, section 10), at a phone's 320 CSS pixels and on a desktop, in real Chrome
 * with the app's stylesheet: axe at WCAG 2.2 AA, colour contrast and target size included, which
 * jsdom cannot measure, and nothing wider than the window.
 *
 * Karma runs each spec in an iframe, and the iframe's width is the test window's: resizing it is
 * what a phone's screen does to the layout.
 */
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  TranslateService,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { HOME_TASKS_LINK, HomePageComponent } from '@agentic-ui/shared/home';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { CURRENT_USERNAME, NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';

import { tasksLink } from './business-apps.routes';

const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function resizeTo(width: number): Promise<void> {
  const frame = window.frameElement as HTMLIFrameElement | null;
  if (frame === null)
    throw new Error('Karma must run the specs in its iframe to resize the window');
  frame.style.width = `${width}px`;
  frame.style.height = '900px';
  for (let tries = 0; tries < 100 && window.innerWidth !== width; tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(window.innerWidth).withContext('the test window is resized').toBe(width);
}

/** A task with a long title and record, which a phone has to wrap. */
const task = (id: string, day: number) => ({
  'entity-type': 'task',
  id,
  name: 'wf.contractReview.ReviewTheRenewalTermsAndTheCounterpartysAmendments',
  workflowModelName: 'ContractReview',
  workflowTitle: 'wf.contractReview.ContractReview',
  created: `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  targetDocumentIds: [
    { uid: `doc-${id}`, title: `Master services agreement with Northwind Traders ${id}` },
  ],
  actors: [{ id: 'user:ada' }],
});

const record = (uid: string, title: string, day: number) => ({
  'entity-type': 'document',
  uid,
  title,
  type: 'Contract',
  path: `/default-domain/workspaces/contracts/${uid}`,
  facets: [],
  lastModified: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  properties: {},
});

const list = (entries: object[]) => ({ entries, resultsCount: entries.length });

describe('HomePageComponent: the lists at a phone width and on a desktop', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HomePageComponent>;
  let english: TranslationObject = {};

  beforeAll(async () => {
    const response = await fetch('/i18n/en.json');
    expect(response.ok).withContext('Karma serves the English catalogue').toBe(true);
    english = (await response.json()) as TranslationObject;
  });

  async function draw(width: number, tasks: object[], records: object[]): Promise<HTMLElement> {
    await resizeTo(width);
    TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
        { provide: CURRENT_USERNAME, useValue: () => 'ada' },
        { provide: HOME_TASKS_LINK, useValue: tasksLink },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', english);
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HomePageComponent);
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    http.expectOne('/agentic-ui-config/home.json').flush({
      version: 2,
      label: 'Contracts',
      cards: [
        { id: 'mine', tasks: { workflow: 'ContractReview' } },
        { id: 'recent', labelKey: 'home.recent.title', recent: { types: ['Contract'] } },
        { id: 'active', label: 'Active contracts', kpi: { pageProvider: 'contracts_active' } },
      ],
    });
    fixture.detectChanges();
    const answer = (match: (request: TestRequest['request']) => boolean, body: object) =>
      http.expectOne(match).flush(body);
    answer((r) => r.url === '/nuxeo/api/v1/task', list(tasks));
    answer((r) => r.url === '/nuxeo/api/v1/search/lang/NXQL/execute', list(records));
    answer((r) => r.url.endsWith('/contracts_active/execute'), { resultsCount: 42 });
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    http?.verify();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
    const frame = window.frameElement as HTMLIFrameElement | null;
    if (frame) {
      frame.style.width = '';
      frame.style.height = '';
    }
  });

  async function violations(root: HTMLElement): Promise<string[]> {
    const results = await axe.run(root, { runOnly: { type: 'tag', values: WCAG22 } });
    return results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
    );
  }

  /** How far anything on the home reaches past its own card, or past the window. */
  function overflow(root: HTMLElement): string[] {
    const found: string[] = [];
    for (const card of root.querySelectorAll<HTMLElement>('.home-card')) {
      const box = card.getBoundingClientRect();
      if (box.right > window.innerWidth + 0.5)
        found.push(`${card.dataset['cardId']} ends at ${box.right}`);
      for (const child of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
        const inner = child.getBoundingClientRect();
        if (inner.width > 0 && inner.right > box.right + 0.5)
          found.push(`${card.dataset['cardId']}: ${child.className} ends at ${inner.right}`);
        // A flex item keeps its box while its text runs out of it: that is overflow too.
        if (child.clientWidth > 0 && child.scrollWidth > child.clientWidth + 1)
          found.push(`${card.dataset['cardId']}: ${child.className} scrolls ${child.scrollWidth}`);
      }
    }
    return found;
  }

  for (const [name, width] of [
    ['at 320 CSS pixels', 320],
    ['on a desktop, 1280 CSS pixels', 1280],
  ] as const) {
    describe(name, () => {
      it('draws both lists within the window, which axe passes', async () => {
        const root = await draw(
          width,
          [task('t1', 1), task('t2', 2)],
          [
            record('c-1', 'Supply agreement for the northern distribution centres', 20),
            record('c-2', 'Lease', 18),
          ],
        );
        expect(root.querySelectorAll('.home-card__item').length).toBe(4);
        expect(root.querySelector('a.home-card__link')?.textContent?.trim()).toBe(
          'Open the tasks page',
        );
        expect(overflow(root)).toEqual([]);
        // The home scrolls nothing sideways. Karma's own page is 2 pixels wider than any window,
        // so the home is measured, not the document.
        const page = root.querySelector('.home-page') as HTMLElement;
        expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
        expect(page.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(await violations(root)).toEqual([]);
      });

      it('draws both empty states within the window, which axe passes', async () => {
        const root = await draw(width, [], []);
        expect(
          [...root.querySelectorAll('nxs-empty-state h3')].map((h) => h.textContent?.trim()),
        ).toEqual(['No open tasks', 'No recent records']);
        expect(overflow(root)).toEqual([]);
        expect(await violations(root)).toEqual([]);
      });
    });
  }
});
