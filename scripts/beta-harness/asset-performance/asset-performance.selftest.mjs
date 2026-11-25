#!/usr/bin/env node
/**
 * The performance check's offline controls: `npm run beta:asset-performance-selftest`. No browser
 * and no build, so they run in CI, where the check itself cannot (it needs Chromium and a
 * production build; phase 10 puts performance budgets in CI).
 *
 * They hold, in turn: the synthetic library to Nuxeo's paging, order and aggregates; the stand-in
 * to its routes, its latencies and its log; the budget's judgement, which must fail a line that is
 * over or not measured; the budget page's two tables to `budget.json` and to `LATENCY`; and the
 * controls' verdict, which must refuse a control run that failed for another reason.
 *
 * The stand-in is started on a port the system picks, over a build directory made in the system's
 * temporary directory. Nothing tracked is touched.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, before, describe, it } from 'node:test';

import { MEASURES, judge, median, percentile, readBudget } from './budget.mjs';
import { CONTROLS } from './check.mjs';
import { controlShortfalls } from './controls.mjs';
import {
  AGGREGATES,
  LIBRARY_SIZE,
  MAX_PAGE_SIZE,
  PAST_WINDOW_MESSAGE,
  PastWindowError,
  RESULT_WINDOW,
  assetNumber,
  assetUid,
  createLibrary,
} from './library.mjs';
import { KINDS, LATENCY, VOCABULARY_SIZES, resolveStaticFile, startStandIn } from './stand-in.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const PAGE = join(ROOT, 'docs/business-apps/performance-budget.md');
const TODAY = new Date('2026-11-25T12:00:00Z');

const sum = (buckets) => buckets.reduce((total, bucket) => total + bucket.docCount, 0);
const bucket = (aggregation, key) => aggregation.buckets.find((each) => each.key === key);

describe('the synthetic library', () => {
  const library = createLibrary({ today: TODAY });

  it('holds 100,000 assets, paged 50 at a time as the page provider is', () => {
    const page = library.execute();
    assert.equal(library.size, LIBRARY_SIZE);
    assert.equal(LIBRARY_SIZE, 100_000);
    assert.equal(page.resultsCount, 100_000);
    assert.equal(page.entries.length, 50);
    assert.equal(page.numberOfPages, 2_000);
    assert.equal(page.isNextPageAvailable, true);
    assert.equal(page.isPreviousPageAvailable, false);
  });

  it('holds a page to the provider’s maxPageSize, as Nuxeo does', () => {
    const page = library.execute({ pageSize: 5_000 });
    assert.equal(page.pageSize, MAX_PAGE_SIZE);
    assert.equal(page.entries.length, MAX_PAGE_SIZE);
  });

  it('orders by rights end ascending, the assets with none last, and pages without overlap', () => {
    const first = library.execute({ pageIndex: 0 }).entries;
    const second = library.execute({ pageIndex: 1 }).entries;
    const ends = [...first, ...second].map((entry) => entry.properties['dc:expired']);
    assert.deepEqual(
      ends,
      [...ends].sort((a, b) => a.localeCompare(b)),
    );
    const ids = new Set([...first, ...second].map((entry) => entry.uid));
    assert.equal(ids.size, 100);
    // The last page is past the window: read from a library whose window holds every asset.
    const whole = createLibrary({ today: TODAY, window: LIBRARY_SIZE });
    const last = whole.execute({ pageIndex: 1_999 }).entries;
    assert.equal(last.at(-1).properties['dc:expired'], null);
    assert.equal(library.at(0).uid, first[0].uid);
    assert.equal(library.at(50).uid, second[0].uid);
  });

  it('counts every asset with a rights end in exactly one rights bucket', () => {
    const { aggregations } = library.execute();
    const rights = aggregations.acme_rights_agg;
    assert.deepEqual(
      rights.buckets.map((each) => each.key),
      ['Ended', 'Ending', 'Cleared'],
    );
    const noEnd = library.count() - sum(rights.buckets);
    assert.ok(noEnd > 0 && noEnd < library.size / 10, `${noEnd} assets with no rights end`);
    assert.equal(bucket(rights, 'Ending').docCount, library.count({ acme_rights_agg: ['Ending'] }));
  });

  it('keeps a chosen bucket’s assets, and counts each aggregate without its own choice', () => {
    const choices = { acme_rights_agg: ['Ending'] };
    const page = library.execute({ choices });
    const ending = library.count(choices);
    assert.equal(page.resultsCount, ending);
    assert.ok(page.entries.every((entry) => bucketOf(entry) === 'Ending'));
    // Its own choice not applied: the rights facet still counts the whole library.
    const all = library.execute().aggregations.acme_rights_agg;
    assert.deepEqual(page.aggregations.acme_rights_agg.buckets, all.buckets);
    // The others' are: every shot bucket counts Ending assets only.
    assert.equal(sum(page.aggregations.acme_shot_agg.buckets), ending);
    assert.deepEqual(page.aggregations.acme_rights_agg.selection, ['Ending']);
  });

  it('keeps any chosen bucket of one aggregate and all aggregates chosen in', () => {
    const one = library.count({ acme_shot_agg: ['Detail'] });
    const two = library.count({ acme_shot_agg: ['Detail', 'Front'] });
    const both = library.count({ acme_shot_agg: ['Detail'], acme_rights_agg: ['Ending'] });
    assert.ok(two > one, 'a second bucket of one aggregate widens the list');
    assert.ok(both < one, 'a bucket of another aggregate narrows it');
    assert.equal(
      library.execute({ choices: { acme_shot_agg: ['Detail'], acme_rights_agg: ['Ending'] } })
        .resultsCount,
      both,
    );
  });

  it('returns a terms aggregate’s 10 largest buckets, largest first', () => {
    const product = library.execute().aggregations.acme_product_agg;
    assert.equal(product.type, 'terms');
    assert.equal(product.buckets.length, 10);
    const counts = product.buckets.map((each) => each.docCount);
    assert.deepEqual(
      counts,
      [...counts].sort((a, b) => b - a),
    );
    assert.equal(product.properties.size, '10');
  });

  it('lists a chosen bucket that holds nothing in extendedBuckets, at 0', () => {
    const page = library.execute({ choices: { acme_product_agg: ['AO-9999'] } });
    assert.equal(page.resultsCount, 0);
    assert.deepEqual(page.aggregations.acme_product_agg.extendedBuckets[0], {
      key: 'AO-9999',
      docCount: 0,
    });
  });

  it('refuses an aggregate, an order or a direction it does not have', () => {
    assert.throws(() => library.execute({ choices: { nope_agg: ['x'] } }), /no aggregate/);
    assert.throws(() => library.execute({ sortBy: 'dc:nope' }), /does not sort/);
    assert.throws(() => library.execute({ sortOrder: 'up' }), /no order/);
    assert.deepEqual(Object.keys(AGGREGATES).sort(), [
      'acme_product_agg',
      'acme_rights_agg',
      'acme_shot_agg',
    ]);
  });

  it('names each asset by a UUID it can read back, and none it does not hold', () => {
    assert.equal(assetNumber(assetUid(0)), 0);
    assert.equal(assetNumber(assetUid(99_999)), 99_999);
    assert.equal(assetNumber(assetUid(100_000)), null);
    assert.equal(assetNumber('not-a-uid'), null);
    const document = library.document(assetUid(7));
    assert.equal(document.type, 'AcmeAsset');
    assert.ok(Array.isArray(document.contextParameters.acls), 'the document page’s enrichers');
    assert.equal(document.properties['picture:views'].length, 5);
    assert.equal(library.document('a55e7000-0000-4000-8000-ffffffffffff'), null);
  });

  it('is the same library for the same day, record for record', () => {
    const again = createLibrary({ today: TODAY });
    assert.deepEqual(again.execute({ pageIndex: 3 }), library.execute({ pageIndex: 3 }));
  });
});

/**
 * The search index's window, held to what the local Nuxeo 2025.10.18 answered over OpenSearch's
 * default of 10,000 (docs/api-integrations.md, section 33): every document through the search
 * service, 13,592, and `acme_asset_library`'s 6 assets.
 */
describe("the synthetic library at the search index's window", () => {
  const library = createLibrary({ today: TODAY });
  const flags = (page) => ({
    resultsCount: page.resultsCount,
    resultsCountLimit: page.resultsCountLimit,
    numberOfPages: page.numberOfPages,
    isNextPageAvailable: page.isNextPageAvailable,
    isLastPageAvailable: page.isLastPageAvailable,
  });

  it('is the server’s window, 10,000, and still counts every asset past it', () => {
    assert.equal(RESULT_WINDOW, 10_000);
    assert.equal(library.window, RESULT_WINDOW);
    assert.deepEqual(flags(library.execute()), {
      resultsCount: 100_000,
      resultsCountLimit: 10_000,
      numberOfPages: 2_000,
      isNextPageAvailable: true,
      isLastPageAvailable: false,
    });
  });

  it('serves the last page that ends within it, with no next page, as the server did', () => {
    // Measured: 50 a page, page 198 had a next page and 199 had none; 30 a page, 332 had none.
    assert.equal(library.execute({ pageIndex: 198 }).isNextPageAvailable, true);
    const edge = library.execute({ pageIndex: 199 });
    assert.equal(edge.entries.length, 50);
    assert.equal(edge.currentPageOffset, 9_950);
    assert.equal(edge.isNextPageAvailable, false);
    assert.equal(edge.numberOfPages, 2_000, 'numberOfPages is not held to the window');
    assert.equal(library.execute({ pageSize: 30, pageIndex: 332 }).isNextPageAvailable, false);
    assert.equal(library.execute({ pageSize: 1, pageIndex: 9_999 }).entries.length, 1);
  });

  it('refuses a page that ends past it, even one that starts within it', () => {
    // Measured: 50 a page, page 200; 30 a page, page 333, from result 9,990; 1 a page, 10,000.
    assert.throws(() => library.execute({ pageIndex: 200 }), PastWindowError);
    assert.throws(() => library.execute({ pageSize: 30, pageIndex: 333 }), PastWindowError);
    assert.throws(() => library.execute({ pageSize: 1, pageIndex: 10_000 }), PastWindowError);
  });

  it('refuses it however few the results, as the server refused page 10,000 of 6 assets', () => {
    const six = createLibrary({ size: 6, today: TODAY });
    assert.deepEqual(flags(six.execute({ pageSize: 1 })), {
      resultsCount: 6,
      resultsCountLimit: 10_000,
      numberOfPages: 6,
      isNextPageAvailable: true,
      isLastPageAvailable: true,
    });
    assert.equal(six.execute({ pageSize: 1, pageIndex: 5 }).isNextPageAvailable, false);
    assert.equal(six.execute({ pageSize: 1, pageIndex: 9_999 }).entries.length, 0);
    assert.throws(() => six.execute({ pageSize: 1, pageIndex: 10_000 }), PastWindowError);
  });

  it('stops short of a count within it at a page size that does not divide it, as 9,886 at 910 a page did', () => {
    // The library's pages are 100 at most, so 30: 9,995 assets, page 332 the last that ends within.
    const within = createLibrary({ size: 9_995, today: TODAY });
    const edge = within.execute({ pageSize: 30, pageIndex: 332 });
    assert.equal(edge.resultsCount, 9_995);
    assert.equal(edge.numberOfPages, 334);
    assert.equal(edge.isNextPageAvailable, false);
    assert.throws(() => within.execute({ pageSize: 30, pageIndex: 333 }), PastWindowError);
  });

  it('for its controls, counts only as far as told, or leaves the window unsaid and still enforces it', () => {
    const capped = createLibrary({ today: TODAY, counted: RESULT_WINDOW });
    assert.equal(capped.execute().resultsCount, 10_000);
    assert.equal(capped.execute().totalSize, 10_000);
    assert.equal(capped.execute({ pageIndex: 199 }).isNextPageAvailable, false);
    const unsaid = createLibrary({ today: TODAY, windowShown: false });
    const edge = unsaid.execute({ pageIndex: 199 });
    assert.equal(edge.resultsCountLimit, -1);
    assert.equal(edge.isNextPageAvailable, true);
    assert.throws(() => unsaid.execute({ pageIndex: 200 }), PastWindowError);
  });
});

/** The rights bucket an entry is in, from its rights end and the library's day. */
function bucketOf(entry) {
  const end = entry.properties['dc:expired'];
  if (end === null) return null;
  const days = Math.round((Date.parse(end) - Date.parse('2026-11-25T00:00:00Z')) / 86_400_000);
  return days < 0 ? 'Ended' : days < 31 ? 'Ending' : 'Cleared';
}

describe('the stand-in', () => {
  let dist;
  let standIn;
  let slow;

  before(async () => {
    dist = mkdtempSync(join(tmpdir(), 'asset-performance-selftest-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>stand-in</title>');
    writeFileSync(join(dist, 'main-ABCDEFGH.js'), 'console.log("app");'.repeat(100));
    standIn = await startStandIn({ port: 0, dist, size: 1_000, today: TODAY });
    slow = await startStandIn({
      port: 0,
      dist,
      size: 1_000,
      today: TODAY,
      latencyScale: 3,
      rttMs: 30,
    });
  });

  after(async () => {
    await standIn?.close();
    await slow?.close();
    rmSync(dist, { recursive: true, force: true });
  });

  const timed = async (server, path, init) => {
    const started = performance.now();
    const response = await fetch(`${server.url}${path}`, init);
    const body = response.headers.get('content-type')?.startsWith('application/json')
      ? await response.json()
      : await response.text();
    return { response, body, ms: performance.now() - started };
  };
  const kindOf = (server, path) => server.log.findLast((record) => record.path === path)?.kind;

  it('answers /me as its reader, a member of the brand team, not an administrator', async () => {
    const { response, body } = await timed(standIn, '/nuxeo/api/v1/me');
    assert.equal(response.status, 200);
    assert.equal(body.id, 'perf-reader');
    assert.equal(body.isAdministrator, false);
    assert.ok(body.properties.groups.includes('brand-team'));
  });

  it('answers the page provider no sooner than its stated latency, gzipped', async () => {
    const path = '/nuxeo/api/v1/search/pp/acme_asset_library/execute';
    const { response, body, ms } = await timed(standIn, `${path}?pageSize=50&currentPageIndex=2`);
    assert.equal(response.status, 200);
    assert.equal(body.entries.length, 50);
    assert.equal(body.currentPageIndex, 2);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    const stated = LATENCY.pageProvider.base + LATENCY.pageProvider.perEntry * 50;
    assert.ok(ms >= stated - 5, `${ms.toFixed(0)} ms, stated ${stated}`);
    assert.equal(kindOf(standIn, path), 'pageProvider');
  });

  it('scales the server’s latency and adds the round trip, unscaled, to every answer', async () => {
    const { ms } = await timed(slow, '/nuxeo/api/v1/me');
    const stated = 30 + LATENCY.me.base * 3;
    assert.ok(ms >= stated - 5, `${ms.toFixed(0)} ms, stated ${stated}`);
    const file = await timed(slow, '/main-ABCDEFGH.js');
    assert.equal(file.response.status, 200);
    assert.ok(file.ms >= 25, `a static file waits for the round trip: ${file.ms.toFixed(0)} ms`);
  });

  it('reads a bucket chosen as Nuxeo sends it, and refuses one that is not JSON', async () => {
    const path = '/nuxeo/api/v1/search/pp/acme_asset_library/execute';
    const chosen = encodeURIComponent(JSON.stringify(['Ending']));
    const { body } = await timed(standIn, `${path}?pageSize=50&acme_rights_agg=${chosen}`);
    assert.deepEqual(body.aggregations.acme_rights_agg.selection, ['Ending']);
    assert.equal(body.resultsCount, standIn.library.count({ acme_rights_agg: ['Ending'] }));
    const refused = await timed(standIn, `${path}?acme_rights_agg=Ending`);
    assert.equal(refused.response.status, 400);
  });

  it("answers a page past the search index's window HTTP 500, as Nuxeo does, and logs it", async () => {
    const path = '/nuxeo/api/v1/search/pp/acme_asset_library/execute';
    const within = await timed(standIn, `${path}?pageSize=50&currentPageIndex=199`);
    assert.equal(within.response.status, 200);
    assert.equal(within.body.entries.length, 0, 'past the 1,000 records, within the window');
    assert.equal(within.body.resultsCountLimit, 10_000);
    const query = '?pageSize=50&currentPageIndex=200';
    const past = await timed(standIn, `${path}${query}`);
    assert.equal(past.response.status, 500);
    assert.deepEqual(past.body, {
      'entity-type': 'exception',
      status: 500,
      message: PAST_WINDOW_MESSAGE,
    });
    const record = standIn.log.findLast((each) => each.query === query);
    assert.equal(record.kind, 'pageProvider');
    assert.equal(record.pastWindow, true);
    assert.equal(
      standIn.log.filter((each) => each.pastWindow).length,
      1,
      'only the page past the window is marked',
    );
  });

  it('serves the kit’s configuration as config:dev writes it', async () => {
    const bootstrap = await timed(standIn, '/agentic-ui-config/bootstrap.json');
    assert.equal(bootstrap.body.format, 'nuxeo-agentic-ui-config/1');
    assert.equal(bootstrap.body.layer, 'bootstrap');
    const queue = await timed(standIn, '/agentic-ui-config/queues/library.json');
    const kit = JSON.parse(
      readFileSync(
        join(
          ROOT,
          'business-apps/packages/brand-assets-demo/bundle/agentic-ui-config/queues/library.json',
        ),
        'utf8',
      ),
    );
    assert.deepEqual(queue.body, kit);
    const home = await timed(standIn, '/agentic-ui-config/home.json');
    assert.equal(home.response.status, 404);
    assert.equal(kindOf(standIn, '/agentic-ui-config/home.json'), 'config');
  });

  it('serves the asset type from the kit’s content model, and its picture views as images', async () => {
    const type = await timed(standIn, '/nuxeo/api/v1/config/types/AcmeAsset');
    assert.ok(type.body.schemas.some((schema) => schema.name === 'acmeasset'));
    const uid = standIn.library.at(0).uid;
    const view = await fetch(`${standIn.url}/nuxeo/api/v1/id/${uid}/@blob/picture:views/2/content`);
    assert.equal(view.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await view.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
    // As large as the record says the view is, so it costs the network what such a view would.
    const advertised = standIn.library.document(uid).properties['picture:views'][2].content.length;
    assert.equal(bytes.length, advertised);
    assert.equal(bytes.subarray(-8, -4).toString('latin1'), 'IEND', 'the padding is before IEND');
  });

  it('pages a vocabulary as large as the stock one', async () => {
    let pages = 0;
    let entries = 0;
    for (let index = 0; ; index++) {
      const { body } = await timed(
        standIn,
        `/nuxeo/api/v1/directory/l10ncoverage?pageSize=50&currentPageIndex=${index}`,
      );
      pages += 1;
      entries += body.entries.length;
      if (!body.isNextPageAvailable) break;
    }
    assert.equal(entries, VOCABULARY_SIZES.l10ncoverage);
    assert.equal(pages, Math.ceil(VOCABULARY_SIZES.l10ncoverage / 50));
  });

  it('files the review’s annotations apart from the bell’s own reads', async () => {
    const post = (query) =>
      fetch(`${standIn.url}/nuxeo/api/v1/automation/Repository.Query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { query } }),
      });
    await post('SELECT * FROM Annotation WHERE ecm:ancestorId = ? AND annotation:xpath = ?');
    assert.equal(standIn.log.at(-1).kind, 'annotations');
    await post('SELECT * FROM Document WHERE notif:notifications/*/subscribers/* = ? AND x');
    assert.equal(standIn.log.at(-1).kind, 'background');
    // Any other query is not the bell's: unknown, so it fails the check rather than going free.
    const other = await post('SELECT * FROM Document WHERE ecm:isProxy = 0');
    assert.equal(other.status, 404);
    assert.equal(standIn.log.at(-1).kind, 'unknown');
    await fetch(`${standIn.url}/nuxeo/api/v1/task?userId=someone-else&pageSize=20`);
    assert.equal(standIn.log.at(-1).kind, 'unknown');
    await fetch(`${standIn.url}/nuxeo/api/v1/task?userId=perf-reader&pageSize=100`);
    assert.equal(standIn.log.at(-1).kind, 'background');
  });

  it('records what it has no answer for as unknown, and answers it 404', async () => {
    const { response } = await timed(standIn, '/nuxeo/api/v1/nothing/here');
    assert.equal(response.status, 404);
    assert.equal(kindOf(standIn, '/nuxeo/api/v1/nothing/here'), 'unknown');
    const malformed = await timed(standIn, '/%E0%A4%A');
    assert.equal(malformed.response.status, 404, 'a malformed escape is answered, not thrown');
    assert.equal(standIn.log.at(-1).kind, 'unknown');
  });

  it('serves the build and nothing outside it, on POSIX and on Windows', () => {
    const inside = (root, file, path) => file === null || file.startsWith(root + path.sep);
    const posixRoot = '/srv/dist';
    assert.equal(resolveStaticFile(posixRoot, '/main.js', posix), '/srv/dist/main.js');
    assert.equal(resolveStaticFile(posixRoot, '/', posix), '/srv/dist/index.html');
    for (const hostile of [
      '/..%2F..%2Fetc%2Fpasswd',
      '/a/%2E%2E/%2E%2E/%2E%2E/x',
      '//etc/passwd',
    ]) {
      const file = resolveStaticFile(posixRoot, hostile, posix);
      assert.ok(inside(posixRoot, file, posix), `${hostile} resolved to ${file}`);
    }
    assert.equal(resolveStaticFile(posixRoot, '/%E0%A4%A', posix), null, 'a malformed escape');
    assert.equal(resolveStaticFile(posixRoot, '/a%00b', posix), null, 'a NUL');
    const windowsRoot = 'C:\\srv\\dist';
    assert.equal(resolveStaticFile(windowsRoot, '/main.js', win32), 'C:\\srv\\dist\\main.js');
    // On Windows a drive in the address resolves to the drive itself, outside the build, unless
    // refused: `resolve('C:\\srv\\dist', 'C:\\Windows\\win.ini')` is `C:\\Windows\\win.ini`.
    assert.equal(win32.resolve(windowsRoot, 'C:\\Windows\\win.ini'), 'C:\\Windows\\win.ini');
    assert.equal(resolveStaticFile(windowsRoot, '/C:/Windows/win.ini', win32), null);
    assert.equal(resolveStaticFile(windowsRoot, '/D:%5Csecret.txt', win32), null);
    for (const hostile of ['/%5C%5Cserver%5Cshare%5Cx', '/..%5C..%5Cx', '/C:..%5Cx']) {
      const file = resolveStaticFile(windowsRoot, hostile, win32);
      assert.ok(inside(windowsRoot, file, win32), `${hostile} resolved to ${file}`);
    }
  });

  it('counts what is in flight, and nothing once answered', async () => {
    const seen = standIn.log.length;
    const pending = fetch(`${standIn.url}/nuxeo/api/v1/me`);
    // Until the stand-in has the request: a fixed wait could be too short on a loaded runner.
    while (standIn.log.length === seen) await new Promise((done) => setTimeout(done, 1));
    assert.equal(standIn.inFlight(), 1);
    await (await pending).json();
    assert.equal(standIn.inFlight(), 0);
  });

  it('is reached at its address by number, not by a name that may resolve elsewhere', () => {
    assert.match(standIn.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('files every request it saw under one of the kinds it documents', () => {
    const known = new Set(KINDS);
    const kinds = new Set([...standIn.log, ...slow.log].map((record) => record.kind));
    for (const kind of kinds) assert.ok(known.has(kind), kind);
    assert.ok(kinds.size >= 8, `only ${[...kinds].join(', ')}`);
  });
});

describe('the budget', () => {
  const budget = readBudget();

  it('has a limit for every measure the check takes, positive or 0 for one that must be none, and none for any other', () => {
    assert.deepEqual(Object.keys(budget.limits).sort(), MEASURES.map((m) => m.id).sort());
    for (const { id, none } of MEASURES) {
      assert.ok(none ? budget.limits[id] === 0 : budget.limits[id] > 0, id);
    }
  });

  it("holds the window's lines to none, and refuses a budget that allows one or gives 0 elsewhere", () => {
    const window = MEASURES.filter((measure) => measure.none).map((measure) => measure.id);
    assert.deepEqual(window, [
      'window.requestsPast',
      'window.controlsPast',
      'window.totalsMisstated',
      'window.noticeMissing',
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'asset-performance-budget-'));
    try {
      const write = (limits) => {
        const file = join(dir, 'budget.json');
        writeFileSync(file, JSON.stringify({ limits: { ...budget.limits, ...limits } }));
        return file;
      };
      assert.throws(() => readBudget(write({ 'window.requestsPast': 1 })), /must be none/);
      assert.throws(() => readBudget(write({ 'paging.p95Ms': 0 })), /no positive limit/);
      const measured = Object.fromEntries(MEASURES.map(({ id }) => [id, 0]));
      measured['window.requestsPast'] = 1;
      const failed = judge(measured, budget).lines.filter((line) => !line.pass);
      assert.deepEqual(
        failed.map((line) => line.id),
        ['window.requestsPast'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes a run within every limit', () => {
    const measured = Object.fromEntries(MEASURES.map(({ id }) => [id, budget.limits[id]]));
    assert.equal(judge(measured, budget).pass, true);
  });

  it('fails a line over its limit, and only that line', () => {
    const measured = Object.fromEntries(MEASURES.map(({ id }) => [id, 0]));
    measured['paging.p95Ms'] = budget.limits['paging.p95Ms'] + 1;
    const judged = judge(measured, budget);
    assert.equal(judged.pass, false);
    assert.deepEqual(
      judged.lines.filter((line) => !line.pass).map((line) => line.id),
      ['paging.p95Ms'],
    );
  });

  it('fails a line that was not measured, rather than passing it', () => {
    const measured = Object.fromEntries(MEASURES.map(({ id }) => [id, 0]));
    measured['heap.growthMB'] = Number.NaN;
    delete measured['asset.requests'];
    const failed = judge(measured, budget)
      .lines.filter((line) => !line.pass)
      .map((line) => line.id);
    assert.deepEqual(failed.sort(), ['asset.requests', 'heap.growthMB']);
  });

  it('reads percentiles by nearest rank, and none from a measure that is missing', () => {
    const values = Array.from({ length: 49 }, (_, i) => i + 1);
    assert.equal(median(values), 25);
    assert.equal(percentile(values, 0.95), 47);
    assert.ok(Number.isNaN(percentile([], 0.5)));
    assert.ok(Number.isNaN(median([1, Number.NaN, 3])));
  });

  it('is the budget its page states, line for line', () => {
    const stated = tableRows(readFileSync(PAGE, 'utf8'), 'measure');
    assert.deepEqual(
      Object.fromEntries(stated.map(([id, limit]) => [id, Number(limit.replace(/[^\d.]/g, ''))])),
      budget.limits,
    );
  });

  it('has the stand-in latencies its page states, route for route', () => {
    const stated = tableRows(readFileSync(PAGE, 'utf8'), 'latency');
    const expected = Object.entries(LATENCY).map(([kind, { base, perEntry }]) => [
      kind,
      perEntry ? `${base} + ${perEntry} per record` : String(base),
    ]);
    assert.deepEqual(stated, expected);
  });
});

/**
 * The rows of the page's table marked `<!-- table: name -->`: each row's first two cells, the
 * first with its backticks removed.
 */
function tableRows(markdown, name) {
  const start = markdown.indexOf(`<!-- table: ${name} -->`);
  assert.ok(start >= 0, `the page has no table marked "${name}"`);
  const rows = [];
  for (const line of markdown.slice(start).split('\n').slice(1)) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (/^-+:?$/.test(cells[0]) || cells[0] === 'Measure' || cells[0] === 'Route') continue;
    rows.push([cells[0].replace(/`/g, ''), cells[1].replace(/ ms$/, '')]);
  }
  return rows;
}

describe('the controls', () => {
  const lines = (values) => ({
    verdict: 'fail',
    judged: {
      lines: Object.entries(values).map(([id, value]) => ({ id, value, limit: 100 })),
    },
  });

  it('name only measures the check takes, and between them every line of the budget', () => {
    const known = new Set(MEASURES.map((measure) => measure.id));
    for (const [id, control] of Object.entries(CONTROLS)) {
      assert.ok(control.over.length > 0, `${id} names a line it must break`);
      for (const line of control.over) assert.ok(known.has(line), `${id}: ${line}`);
    }
    // A line no control breaks has never been seen failing.
    const broken = new Set(Object.values(CONTROLS).flatMap((control) => control.over));
    assert.deepEqual(
      [...known].filter((id) => !broken.has(id)),
      [],
      'lines no control is held to break',
    );
  });

  it('accept a control run that failed over budget on its own lines', () => {
    const over = Object.fromEntries(CONTROLS.slow.over.map((id) => [id, 101]));
    assert.deepEqual(controlShortfalls('slow', lines(over)), []);
  });

  it('refuse a control run that ended in an error, or not over on its lines', () => {
    const over = Object.fromEntries(CONTROLS.slow.over.map((id) => [id, 101]));
    assert.match(
      controlShortfalls('slow', { ...lines(over), verdict: 'error' })[0],
      /ended "error"/,
    );
    const [first, ...rest] = CONTROLS.slow.over;
    const within = { [first]: 99, ...Object.fromEntries(rest.map((id) => [id, 101])) };
    assert.match(controlShortfalls('slow', lines(within)).join(), /within its limit/);
    const unmeasured = { [first]: null, ...Object.fromEntries(rest.map((id) => [id, 101])) };
    assert.match(controlShortfalls('slow', lines(unmeasured)).join(), /not measured/);
    assert.match(controlShortfalls('slow', null).join(), /no report/);
  });
});
