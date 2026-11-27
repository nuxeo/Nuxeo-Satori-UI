import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { vi, type MockInstance } from 'vitest';

import { HOME_QUEUE_LINK } from '../home.service';
import { HomePageComponent } from './home-page';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'app-definition-v2.md'), 'utf8');
/** The proposal's `home.json`: a home for adjusters and one for supervisors. */
const example = JSON.parse(
  /```json home\.json\n([\s\S]*?)```/.exec(proposal)?.[1] ?? '{}',
) as object;

const HOME_URL = '/agentic-ui-config/home.json';
const ppUrl = (name: string): string => `/nuxeo/api/v1/search/pp/${name}/execute`;

/** The server's answers for the example's two page providers. */
const UNASSIGNED = {
  resultsCount: 1234,
  aggregations: {
    claim_type_agg: {
      buckets: [
        { key: 'medical', docCount: 1000 },
        { key: 'dental', docCount: 234 },
      ],
    },
  },
};
const OPEN = {
  resultsCount: 40,
  aggregations: { claim_state_agg: { buckets: [{ key: 'pending', docCount: 17 }] } },
};

interface Setup {
  readonly groups: readonly string[];
  readonly queueLink?: (queue: string) => string;
  /** Whether the app registers its document rules, `app.rules.inGroup` among them. */
  readonly documentRules?: boolean;
}

describe('HomePageComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<HomePageComponent>;
  let warn: MockInstance<typeof console.warn>;

  function create({ groups, queueLink, documentRules = true }: Setup): void {
    TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
        ...(queueLink ? [{ provide: HOME_QUEUE_LINK, useValue: queueLink }] : []),
      ],
    });
    if (documentRules)
      TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    const context = TestBed.inject(ExtensionRuleContextService);
    context.username.set('ada');
    context.groups.set(groups);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HomePageComponent);
    fixture.detectChanges();
  }

  const home = (content: object): void => {
    http.expectOne(HOME_URL).flush(content);
    fixture.detectChanges();
  };
  const pp = (name: string): TestRequest => http.expectOne((r) => r.url === ppUrl(name));
  const answer = (name: string, body: object): void => {
    pp(name).flush(body);
    fixture.detectChanges();
  };
  const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** Each card's texts, its title, figure, buckets and link, one after another. */
  const cards = (): string[] =>
    [...page().querySelectorAll('.home-card')].map((card) =>
      [...card.querySelectorAll('h2, p, dt, dd, a')]
        .map((part) => (part.textContent ?? '').trim())
        .join(' '),
    );
  const cardIds = (): string[] =>
    [...page().querySelectorAll('.home-card')].map(
      (card) => card.getAttribute('data-card-id') ?? '',
    );

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it("draws an adjuster's home: the KPIs from one request, and none of the supervisors' cards", () => {
    create({ groups: ['claims-adjusters', 'members'] });
    home(example);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Claims');
    expect(cardIds()).toEqual(['unassigned', 'unassigned-by-type']);
    expect(cards()).toEqual(['Unassigned claims Counting', 'Unassigned, by claim type Counting']);
    // Both cards read the same page provider: one request. The supervisors' is not asked for.
    answer('payers_unassigned_claims', UNASSIGNED);
    http.expectNone((r) => r.url === ppUrl('payers_open_claims'));
    expect(cards()).toEqual([
      'Unassigned claims 1,234',
      'Unassigned, by claim type 1,234 medical 1,000 dental 234',
    ]);
    expect(page().querySelector('.home-card__link')).toBeNull();
  });

  it("draws a supervisor's home: the bucket's count, and no link where the app has no queue page", () => {
    create({ groups: ['claims-supervisors'] });
    home(example);
    // The link-only card waits for the queue page, so it is left out.
    expect(cardIds()).toEqual(['pending']);
    answer('payers_open_claims', OPEN);
    http.expectNone((r) => r.url === ppUrl('payers_unassigned_claims'));
    expect(cards()).toEqual(['Pending determination 17']);
  });

  it('links to the queues where the app gives their address', () => {
    create({
      groups: ['claims-adjusters', 'claims-supervisors'],
      queueLink: (q) => `/queues/${q}`,
    });
    home(example);
    expect(cardIds()).toEqual(['unassigned', 'unassigned-by-type', 'pending', 'unassigned-queue']);
    answer('payers_unassigned_claims', UNASSIGNED);
    answer('payers_open_claims', OPEN);
    const links = [...page().querySelectorAll('a')].map((a) => [
      a.textContent?.trim(),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Open the queue', '/queues/unassigned-claims'],
      // With no name of its own, until the app reads queues, a link shows the queue's id.
      ['unassigned-claims', '/queues/unassigned-claims'],
    ]);
  });

  it('shows nothing that is not for the person, and asks for nothing', () => {
    create({ groups: ['members'] });
    home(example);
    expect(cardIds()).toEqual([]);
    expect(page().textContent).toContain('Nothing on the home is for you.');
    http.expectNone((r) => r.url.startsWith('/nuxeo/api/v1/search/pp/'));
  });

  it('shows a card with no rule to everyone, with the platform title when the home has none', () => {
    create({ groups: [] });
    home({
      version: 2,
      cards: [{ id: 'all', label: 'All claims', kpi: { pageProvider: 'payers_all' } }],
    });
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Home');
    answer('payers_all', { resultsCount: 0 });
    expect(cards()).toEqual(['All claims 0']);
  });

  it('says a figure is unavailable, and why in the console, when the server cannot give it', () => {
    create({ groups: [] });
    home({
      version: 2,
      cards: [
        { id: 'gone', label: 'Gone', kpi: { pageProvider: 'no_such' } },
        { id: 'flat', label: 'By type', kpi: { pageProvider: 'core_only', aggregate: 'type_agg' } },
      ],
    });
    pp('no_such').flush('', { status: 404, statusText: 'Not Found' });
    answer('core_only', { resultsCount: 3, aggregations: {} });
    expect(cards()).toEqual(['Gone Unavailable', 'By type Unavailable']);
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[agentic-ui-home] card "gone": the page provider "no_such" was not read: HTTP 404',
      '[agentic-ui-home] card "flat": the page provider "core_only" returns no aggregates: it has them only if it defines them and the search index serves it',
    ]);
  });

  it('leaves out a card a finding names, and draws the rest', () => {
    create({ groups: [] });
    home({
      version: 2,
      cards: [
        { id: 'a', label: 'A', kpi: { pageProvider: 'pp_a' }, visibleWhen: 'acme.rules.unknown' },
        { id: 'b', label: 'B', kpi: { pageProvider: 'pp_b' } },
      ],
    });
    expect(cardIds()).toEqual(['b']);
    answer('pp_b', { resultsCount: 2 });
    http.expectNone((r) => r.url === ppUrl('pp_a'));
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json cards[0].visibleWhen: the rule "acme.rules.unknown" is not registered [unknown]; cards[0] left out',
    );
  });

  it('leaves out every group card in a build that does not register the group rule', () => {
    create({ groups: ['claims-adjusters', 'claims-supervisors'], documentRules: false });
    home(example);
    expect(cardIds()).toEqual([]);
    http.expectNone((r) => r.url.startsWith('/nuxeo/api/v1/search/pp/'));
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json cards[0].visibleWhen names the rule "app.rules.inGroup", which this build does not register; cards[0] left out',
    );
  });

  it('evaluates the rules with no record, whatever record the shell last had open', () => {
    create({ groups: [] });
    // A surface that did not clear its document on leaving would otherwise gate the home on it.
    TestBed.inject(ExtensionRuleContextService).document.set({
      'entity-type': 'document',
      uid: 'doc-1',
      path: '/default-domain/doc-1',
      type: 'File',
      title: 'A file',
      facets: [],
      properties: {},
    } as never);
    home({
      version: 2,
      cards: [
        {
          id: 'open',
          label: 'With a record',
          kpi: { pageProvider: 'pp_a' },
          visibleWhen: 'app.rules.hasDocument',
        },
        {
          id: 'none',
          label: 'With none',
          kpi: { pageProvider: 'pp_b' },
          visibleWhen: { type: 'core.not', parameters: ['app.rules.hasDocument'] },
        },
      ],
    });
    expect(cardIds()).toEqual(['none']);
    answer('pp_b', { resultsCount: 1 });
    http.expectNone((r) => r.url === ppUrl('pp_a'));
  });

  it('says the home could not be read when every card is left out, not that none is for you', () => {
    create({ groups: [] });
    home({
      version: 2,
      cards: [
        { id: 'a', label: 'A', kpi: { pageProvider: 'pp_a' }, visibleWhen: 'acme.rules.one' },
        { id: 'b', label: 'B', kpi: { pageProvider: 'pp_b' }, visibleWhen: 'acme.rules.two' },
      ],
    });
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'The home could not be read.',
    );
    expect(page().textContent).not.toContain('Nothing on the home is for you.');
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json refused: every card is left out',
    );
  });

  it('names a card by its id when its name is empty, and says when a list of buckets may be cut', () => {
    create({ groups: [] });
    home({
      version: 2,
      cards: [{ id: 'authors', labelKey: '', kpi: { pageProvider: 'pp', aggregate: 'by_author' } }],
    });
    answer('pp', {
      resultsCount: 30,
      aggregations: {
        by_author: {
          type: 'terms',
          properties: { size: '2' },
          buckets: [
            { key: 'ada', docCount: 20 },
            { key: 'grace', docCount: 7 },
          ],
        },
      },
    });
    expect(page().querySelector('h2')?.textContent?.trim()).toBe('authors');
    expect(cards()).toEqual(['authors 30 ada 20 grace 7 The largest only']);
  });

  it('leaves out a card nested deeper than the validator reads, rather than staying loading', () => {
    create({ groups: [] });
    let deep: unknown = 'x';
    for (let index = 0; index < 6000; index++) deep = { a: deep };
    TestBed.inject(ExtensionRuleRegistry).registerRules({ 'acme.rules.anyOf': () => true });
    home({
      version: 2,
      cards: [
        {
          id: 'deep',
          label: 'Deep',
          kpi: { pageProvider: 'pp_deep' },
          visibleWhen: { type: 'acme.rules.anyOf', parameters: [deep] },
        },
        { id: 'b', label: 'B', kpi: { pageProvider: 'pp_b' } },
      ],
    });
    expect(cardIds()).toEqual(['b']);
    answer('pp_b', { resultsCount: 1 });
    http.expectNone((r) => r.url === ppUrl('pp_deep'));
  });

  it('says the home could not be read when reading it throws, rather than staying loading', () => {
    create({ groups: [] });
    vi.spyOn(TestBed.inject(ExtensionRuleRegistry), 'registeredRuleIds').mockImplementation(() => {
      throw new Error('the registry failed');
    });
    home({ version: 2, cards: [{ id: 'b', label: 'B', kpi: { pageProvider: 'pp_b' } }] });
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'The home could not be read.',
    );
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json refused: it could not be read: the registry failed',
    );
  });

  it('says the home could not be read whatever is thrown, an error or not', () => {
    create({ groups: [] });
    vi.spyOn(TestBed.inject(ExtensionRuleRegistry), 'registeredRuleIds').mockImplementation(() => {
      throw undefined;
    });
    home({ version: 2, cards: [{ id: 'b', label: 'B', kpi: { pageProvider: 'pp_b' } }] });
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'The home could not be read.',
    );
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json refused: it could not be read: undefined',
    );
  });

  it('draws no home, and says so, for a file it refuses', () => {
    create({ groups: [] });
    home({ version: 2, cards: [{ id: 'a' }] });
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'The home could not be read.',
    );
    expect(cardIds()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-home] home.json refused: cards[0]: a card has a "kpi", a "queue", or both; or a "tasks" or a "recent" [structure]',
    );
  });

  it('says no home is configured where none is served, as on a server today', () => {
    create({ groups: [] });
    http.expectOne(HOME_URL).flush('', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(page().textContent).toContain('No home is configured for this app.');
    expect(warn).not.toHaveBeenCalled();
  });

  it('shows that it is loading until the file comes', () => {
    create({ groups: [] });
    expect(page().querySelector('[role="status"]')?.textContent?.trim()).toBe('Loading the home');
    home({ version: 2, cards: [{ id: 'q', queue: 'open' }] });
    expect(cardIds()).toEqual([]);
  });
});
