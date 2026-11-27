import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import {
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import { CURRENT_USERNAME, NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { vi, type MockInstance } from 'vitest';

import { HOME_TASKS_LINK } from '../home.service';
import { HomePageComponent } from './home-page';

// The home's lists (docs/business-apps/app-definition-v2.md, section 10): the person's open tasks
// and the records they created or edited last, each with its filter, its limit and its empty state.

const HOME_URL = '/agentic-ui-config/home.json';
const TASK_URL = '/nuxeo/api/v1/task';
const NXQL_URL = '/nuxeo/api/v1/search/lang/NXQL/execute';

const tasksLink = (id?: string): string | readonly unknown[] =>
  id === undefined ? '/tasks' : ['/tasks', id];

/** A task as `GET /api/v1/task` returns it, enriched with its target, created on `day` of November. */
function task(id: string, day: number, workflow = 'SerialDocumentReview') {
  return {
    'entity-type': 'task',
    id,
    name: 'wf.serialDocumentReview.DocumentValidation',
    directive: 'wf.serialDocumentReview.AcceptReject',
    workflowModelName: workflow,
    workflowTitle: `wf.${workflow.charAt(0).toLowerCase()}${workflow.slice(1)}.${workflow}`,
    created: `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`,
    dueDate: '2026-12-01T00:00:00.000Z',
    targetDocumentIds: [{ uid: `doc-${id}`, title: `Contract ${id}`, type: 'Contract' }],
    actors: [{ id: 'user:ada' }],
  };
}

/** A record as the NXQL search returns it, last changed on `day` of November. */
function record(uid: string, title: string, type: string, day: number) {
  return {
    'entity-type': 'document',
    uid,
    title,
    type,
    path: `/default-domain/workspaces/${uid}`,
    facets: [],
    lastModified: `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`,
    properties: {},
  };
}

const list = (entries: object[]) => ({
  'entity-type': 'documents',
  entries,
  resultsCount: entries.length,
  isNextPageAvailable: false,
});

/** axe at WCAG 2.2 AA, in jsdom: contrast and target size need layout, which the Karma spec has. */
async function wcag22(root: Element): Promise<axe.Result[]> {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
  });
  return results.violations;
}

interface Setup {
  readonly groups?: readonly string[];
  /** Whether the app gives the tasks page; `false` is a host without one. */
  readonly tasksPage?: boolean;
  readonly user?: string | null;
}

describe('HomePageComponent: the lists of tasks and of recent records', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HomePageComponent>;
  let warn: MockInstance<typeof console.warn>;

  function create({ groups = [], tasksPage = true, user = 'ada' }: Setup = {}): void {
    TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
        { provide: CURRENT_USERNAME, useValue: () => user },
        ...(tasksPage ? [{ provide: HOME_TASKS_LINK, useValue: tasksLink }] : []),
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    const context = TestBed.inject(ExtensionRuleContextService);
    context.username.set(user ?? '');
    context.groups.set(groups);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HomePageComponent);
    // Attached, so that axe sees the page as a person would and `aria-labelledby` resolves.
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
  }

  const home = (cards: object[]): void => {
    http.expectOne(HOME_URL).flush({ version: 2, cards });
    fixture.detectChanges();
  };
  const tasksRequest = (): TestRequest => http.expectOne((r) => r.url === TASK_URL);
  const nxqlRequest = (): TestRequest => http.expectOne((r) => r.url === NXQL_URL);
  const flush = (request: TestRequest, body: object): void => {
    request.flush(body);
    fixture.detectChanges();
  };
  const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const card = (id: string): HTMLElement => {
    const found = page().querySelector<HTMLElement>(`[data-card-id="${id}"]`);
    if (!found) throw new Error(`no card ${id}`);
    return found;
  };
  /** Each item of a card: its link's text and address, and the lines under it. */
  const items = (id: string): string[][] =>
    [...card(id).querySelectorAll('.home-card__item')].map((item) => [
      item.querySelector('a')?.textContent?.trim() ?? '',
      item.querySelector('a')?.getAttribute('href') ?? '',
      ...[...item.querySelectorAll('.home-card__item-detail, .home-card__item-date')].map(
        (line) => line.textContent?.trim() ?? '',
      ),
    ]);

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
    vi.restoreAllMocks();
  });

  describe('the tasks', () => {
    it("lists the person's open tasks newest first, each opening on the tasks page, which axe passes", async () => {
      create();
      home([{ id: 'mine', tasks: {} }]);
      expect(card('mine').querySelector('h2')?.textContent?.trim()).toBe('My tasks');
      expect(card('mine').querySelector('[role="status"]')?.textContent?.trim()).toBe(
        'Loading your tasks',
      );
      const request = tasksRequest();
      expect(request.request.params.get('userId')).toBe('ada');
      // The default limit, and every workflow.
      expect(request.request.params.get('pageSize')).toBe('5');
      expect(request.request.params.has('workflowModelName')).toBe(false);
      // In Nuxeo's order, due soonest first, which is not the newest first.
      flush(request, list([task('t1', 1), task('t3', 3), task('t2', 2)]));
      expect(items('mine')).toEqual([
        [
          'Document Validation',
          '/tasks/t3',
          'Contract t3',
          'Serial Document Review',
          'Open since Nov 3, 2026',
        ],
        [
          'Document Validation',
          '/tasks/t2',
          'Contract t2',
          'Serial Document Review',
          'Open since Nov 2, 2026',
        ],
        [
          'Document Validation',
          '/tasks/t1',
          'Contract t1',
          'Serial Document Review',
          'Open since Nov 1, 2026',
        ],
      ]);
      const more = card('mine').querySelector<HTMLAnchorElement>('a.home-card__link');
      expect([more?.textContent?.trim(), more?.getAttribute('href')]).toEqual([
        'Open the tasks page',
        '/tasks',
      ]);
      // The list is named by its card's heading.
      const listed = card('mine').querySelector('ul');
      expect(
        document.getElementById(listed?.getAttribute('aria-labelledby') ?? '')?.textContent,
      ).toBe('My tasks');
      expect(card('mine').querySelector('time')?.getAttribute('datetime')).toBe(
        '2026-11-03T08:00:00.000Z',
      );
      expect(await wcag22(page())).toEqual([]);
    });

    it("asks for one workflow's tasks alone, as many as the limit says, under the card's own name", () => {
      create();
      home([
        {
          id: 'reviews',
          label: 'Reviews to do',
          tasks: { workflow: 'SerialDocumentReview', limit: 2 },
        },
      ]);
      const request = tasksRequest();
      expect(request.request.params.get('workflowModelName')).toBe('SerialDocumentReview');
      expect(request.request.params.get('pageSize')).toBe('2');
      // Nuxeo answers a workflow's tasks unpaged, all of them; one of another workflow is left out.
      flush(request, {
        'entity-type': 'tasks',
        entries: [
          task('a', 1),
          task('other', 9, 'ParallelDocumentReview'),
          task('c', 3),
          task('b', 2),
        ],
      });
      expect(card('reviews').querySelector('h2')?.textContent?.trim()).toBe('Reviews to do');
      expect(items('reviews').map(([, href]) => href)).toEqual(['/tasks/c', '/tasks/b']);
    });

    it('says when there is no open task, still links to the tasks page, and axe passes', async () => {
      create();
      home([{ id: 'mine', tasks: {} }]);
      flush(tasksRequest(), list([]));
      const empty = card('mine').querySelector('nxs-empty-state');
      expect(empty?.querySelector('h3')?.textContent?.trim()).toBe('No open tasks');
      expect(card('mine').querySelectorAll('.home-card__item')).toHaveLength(0);
      expect(card('mine').querySelector('a.home-card__link')?.getAttribute('href')).toBe('/tasks');
      expect(await wcag22(page())).toEqual([]);
    });

    it('says the list is unavailable, and why in the console, when the server refuses it', () => {
      create();
      home([{ id: 'mine', tasks: {} }]);
      tasksRequest().flush('', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(card('mine').querySelector('.home-card__note')?.textContent?.trim()).toBe(
        'Unavailable',
      );
      expect(warn).toHaveBeenCalledWith(
        '[agentic-ui-home] card "mine": the tasks were not read: HTTP 500',
      );
    });

    it('leaves the list out, asking for nothing, in a host that has no tasks page', () => {
      create({ tasksPage: false });
      home([
        { id: 'mine', tasks: {} },
        { id: 'recent', recent: {} },
      ]);
      expect(
        [...page().querySelectorAll('.home-card')].map((c) => c.getAttribute('data-card-id')),
      ).toEqual(['recent']);
      http.expectNone((r) => r.url === TASK_URL);
      flush(nxqlRequest(), list([]));
      expect(warn).toHaveBeenCalledWith(
        '[agentic-ui-home] the app has no tasks page, so the lists of tasks are not drawn',
      );
    });
  });

  describe('the recent records', () => {
    it('lists the records the person worked on last, each opening its page, which axe passes', async () => {
      create();
      home([{ id: 'recent', recent: {} }]);
      expect(card('recent').querySelector('h2')?.textContent?.trim()).toBe('Recently viewed');
      expect(card('recent').querySelector('[role="status"]')?.textContent?.trim()).toBe(
        'Loading your recent records',
      );
      const request = nxqlRequest();
      const query = request.request.params.get('query') ?? '';
      // What Recently viewed reads: what the person created or last changed, latest first.
      expect(query).toContain("(dc:creator = 'ada' OR dc:lastContributor = 'ada')");
      expect(query).toMatch(/ORDER BY dc:modified DESC$/);
      expect(query).not.toContain('ecm:primaryType IN');
      expect(request.request.params.get('pageSize')).toBe('5');
      flush(
        request,
        list([
          record('c-2', 'Supply agreement', 'Contract', 20),
          record('n-1', 'Meeting notes', 'Note', 18),
        ]),
      );
      expect(items('recent')).toEqual([
        ['Supply agreement', '/doc/c-2', 'Contract', 'Changed Nov 20, 2026'],
        ['Meeting notes', '/doc/n-1', 'Note', 'Changed Nov 18, 2026'],
      ]);
      // A list of records links to nothing but its records.
      expect(card('recent').querySelector('a.home-card__link')).toBeNull();
      expect(await wcag22(page())).toEqual([]);
    });

    it('keeps to the types and the limit it is given', () => {
      create();
      home([{ id: 'contracts', recent: { types: ['Contract', 'Amendment'], limit: 3 } }]);
      const request = nxqlRequest();
      expect(request.request.params.get('query')).toContain(
        "AND ecm:primaryType IN ('Contract', 'Amendment') ORDER BY dc:modified DESC",
      );
      expect(request.request.params.get('pageSize')).toBe('3');
      flush(request, list([record('c-1', 'Lease', 'Contract', 2)]));
      expect(items('contracts').map(([title]) => title)).toEqual(['Lease']);
    });

    it('says when there is none, and axe passes', async () => {
      create();
      home([{ id: 'recent', labelKey: 'no.such.key', recent: {} }]);
      flush(nxqlRequest(), list([]));
      // A key with no text falls back to the platform's name, as a figure's does to its key.
      expect(card('recent').querySelector('h2')?.textContent?.trim()).toBe('Recently viewed');
      expect(card('recent').querySelector('nxs-empty-state h3')?.textContent?.trim()).toBe(
        'No recent records',
      );
      expect(await wcag22(page())).toEqual([]);
    });

    it('shows an untitled record by its id, never as an empty link', () => {
      create();
      home([{ id: 'recent', recent: {} }]);
      flush(nxqlRequest(), list([{ ...record('u-1', '', 'File', 1), lastModified: 'not a date' }]));
      expect(items('recent')).toEqual([['u-1', '/doc/u-1', 'File']]);
    });

    it('says the list is unavailable when no one is signed in, and asks for nothing', () => {
      create({ user: null });
      home([{ id: 'recent', recent: {} }]);
      http.expectNone((r) => r.url === NXQL_URL);
      fixture.detectChanges();
      expect(card('recent').querySelector('.home-card__note')?.textContent?.trim()).toBe(
        'Unavailable',
      );
      expect(warn).toHaveBeenCalledWith(
        '[agentic-ui-home] card "recent": the recent records were not read: no one is signed in',
      );
    });
  });

  it('asks for a hidden list nothing, and for a shown one once, beside the figures', () => {
    create({ groups: ['contract-managers'] });
    home([
      {
        id: 'legal',
        recent: {},
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['legal-reviewers'] },
      },
      {
        id: 'mine',
        tasks: {},
        visibleWhen: { type: 'app.rules.inGroup', parameters: ['contract-managers'] },
      },
      { id: 'count', label: 'Active', kpi: { pageProvider: 'contracts_active' } },
    ]);
    http.expectNone((r) => r.url === NXQL_URL);
    flush(tasksRequest(), list([task('t1', 1)]));
    http
      .expectOne((r) => r.url === '/nuxeo/api/v1/search/pp/contracts_active/execute')
      .flush({
        resultsCount: 7,
      });
    fixture.detectChanges();
    expect(
      [...page().querySelectorAll('.home-card')].map((c) => c.getAttribute('data-card-id')),
    ).toEqual(['mine', 'count']);
    // Drawn again, the page asks again for nothing.
    fixture.detectChanges();
    http.expectNone((r) => r.url === TASK_URL);
  });
});
