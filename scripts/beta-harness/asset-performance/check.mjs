#!/usr/bin/env node
/**
 * The brand assets library's performance check at 100,000 assets: phase 5's "a library of
 * 100,000 synthetic assets stays within the performance budget" (docs/business-apps/
 * development-plan.md). Repeatable, and without writing a document to any Nuxeo.
 *
 *   npm run beta:asset-performance                       # build, measure, judge
 *   npm run beta:asset-performance -- --skip-build       # measure the build already in dist/
 *   npm run beta:asset-performance -- --control slow     # a negative control: must fail
 *   npm run beta:asset-performance-controls              # every control, each seen failing
 *
 * It builds the application for production, serves the build and a stand-in for the REST calls
 * from `stand-in.mjs` on one port (4294 unless `--port`), opens Chromium with Playwright over the
 * network `--network` names (`desktop`: a 40 ms round trip and 10 Mbit/s), and measures:
 *
 * 1. **The library, cold**, `--runs` times (3) in a fresh browser context each: its first
 *    contentful paint and its first page of results drawn, both from navigation, and the requests
 *    it made.
 * 2. **Paging:** 49 clicks on the pager's next, so 50 pages browsed, each timed from its click to
 *    the page's first row being the asset the stand-in's order puts there, with its requests;
 *    then the JavaScript heap, after garbage collection, against the heap after page 1.
 * 3. **The search index's window:** on to page 200, the last that ends within OpenSearch's
 *    default `max_result_window` of 10,000, which the stand-in enforces as Nuxeo does, each page
 *    its expected first row and every pager's total held to the library's 100,000; then whether
 *    a control there still pages past it, which is pressed if so, and whether the list says how
 *    far its pages reach. Every page the stand-in refused for the window, over the run, counts.
 * 4. **Facets:** Rights "Ending" chosen, then a Shot, then each cleared, each timed from its click
 *    to the first row the server's narrowed order gives.
 * 5. **The asset page:** five rows opened from the library, each timed from its click to the
 *    asset's first picture view loaded from its blob, with its requests.
 *
 * Then it holds the measures to `budget.json` (`budget.mjs`) and writes a report under
 * `$AGENTIC_UI_EVIDENCE_DIR/beta/asset-performance/<timestamp>/`, outside the repository, or
 * under `--report <dir>`.
 *
 * Exit codes, as the beta harness's: 0 within budget; 1 over it, or a page that did not show what
 * it should; 2 a precondition not met (no Playwright or Chromium, or the port taken).
 *
 * **What it does not measure:** Nuxeo's and OpenSearch's own query time at 100,000 documents. The
 * stand-in answers from memory after a stated latency; the server's real time needs a server
 * holding that data. The network is emulated, not crossed: one machine runs both ends.
 * docs/business-apps/performance-budget.md says what the numbers do and do not stand for.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { EVIDENCE_ROOT } from '../../collect-evidence/evidence-path.mjs';
import { spawnToolSync } from '../package-command.mjs';
import { judge, largest, median, percentile, readBudget } from './budget.mjs';
import { RESULT_WINDOW } from './library.mjs';
import { LATENCY, startStandIn } from './stand-in.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = join(ROOT, 'dist/nuxeo-ui/browser');
const PAGES_BROWSED = 50;
const ASSETS_OPENED = 5;

/**
 * The negative controls: each makes the check measure something worse than the app, which the
 * check must then fail, on the lines `over` names. Between them they name every line of the
 * budget, so each has been seen failing (asset-performance.selftest.mjs holds them to that).
 * `controls.mjs` runs each and passes only when every run is over budget on its lines, each of
 * them measured.
 */
export const CONTROLS = Object.freeze({
  slow: {
    describe: "the stand-in's server five times slower, the network as it was",
    latencyScale: 5,
    over: [
      'library.firstPageMs',
      'paging.medianMs',
      'paging.p95Ms',
      'facets.maxMs',
      'asset.firstViewMs',
    ],
  },
  'big-bundle': {
    describe:
      "the app's first script 1.5 MB heavier, in bytes that do not compress, as a first bundle grown by that much would be",
    padMainBytes: 1_500_000,
    over: ['library.firstContentfulPaintMs', 'library.firstPageMs'],
  },
  'fetch-all': {
    describe:
      "a script in the page that reads every page of a query before the app's own request for it is sent, as an app that pages on the client would",
    initScript: fetchAllPages,
    over: ['library.firstPageMs', 'library.openRequests', 'facets.requestsPerChoice'],
  },
  twice: {
    describe:
      'a script in the page that sends every request to the server twice, as a request subscribed to twice would',
    initScript: sendTwice,
    over: [
      'library.openRequests',
      'paging.requestsPerPage',
      'facets.requestsPerChoice',
      'asset.requests',
    ],
  },
  'hold-pages': {
    describe:
      'a script in the page that keeps every page of results the app is sent, as a list that never lets a page go would',
    initScript: holdPages,
    over: ['heap.growthMB'],
  },
  ballast: {
    describe:
      'a script in the page that holds 80 MB from its first moment, as an app that loads a large structure and keeps it would',
    initScript: holdBallast,
    over: ['heap.after50PagesMB'],
  },
  unwindowed: {
    describe:
      "the stand-in refusing a page past the search index's window as the server does, but saying nothing of where it is, as the check's first stand-in did: no resultsCountLimit, and a next page while records remain",
    standIn: { windowShown: false },
    over: ['window.requestsPast', 'window.controlsPast', 'window.noticeMissing'],
  },
  'capped-count': {
    describe:
      "the stand-in counting only as far as the window, as OpenSearch's own default track_total_hits would have the index count, so the server reports 10,000 results of 100,000",
    standIn: { counted: RESULT_WINDOW },
    over: ['window.totalsMisstated', 'window.noticeMissing'],
  },
});

/**
 * The hosts other than the stand-in that the app is allowed to ask: the shell's icon font, which
 * `index.html` links. They are not resolved, so they cost nothing; the first contentful paint
 * leaves them out. Any other host asked fails the run, so a new one cannot be measured as free
 * without anyone seeing it.
 */
export const EXTERNAL_ALLOWED = Object.freeze([
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]);

/** Which requests an action is charged with: all but static files and the bell's own timer. */
const CHARGED = (record) => record.kind !== 'static' && record.kind !== 'background';

function exitWith(code, message) {
  console.error(message);
  process.exit(code);
}

/**
 * `fetch-all`'s script, in the page: every page of a library query, 100 at a time and six at once,
 * read before the app's own request for that query is sent, once per query. What it reads is
 * dropped, so the heap does not hold it.
 */
function fetchAllPages() {
  const PROVIDER = '/search/pp/acme_asset_library/execute';
  const read = new Map();
  const { open, send, setRequestHeader } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__perfUrl = String(url);
    this.__perfHeaders = {};
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.__perfHeaders[name] = value;
    return setRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = new URL(this.__perfUrl ?? '', location.href);
    if (!url.pathname.endsWith(PROVIDER)) return send.call(this, body);
    const query = new URLSearchParams(url.search);
    query.delete('currentPageIndex');
    query.delete('pageSize');
    const key = query.toString();
    if (!read.has(key)) read.set(key, readEvery(url, this.__perfHeaders));
    // Sent whether the reading worked or not: the app's own request is never held back for good.
    const go = () => send.call(this, body);
    read.get(key).then(go, go);
  };
  async function readEvery(url, headers) {
    const first = new URL(url);
    first.searchParams.set('pageSize', '100');
    first.searchParams.set('currentPageIndex', '0');
    const pages = (await (await fetch(first, { headers })).json()).numberOfPages ?? 0;
    let next = 1;
    const worker = async () => {
      while (next < pages) {
        const page = new URL(first);
        page.searchParams.set('currentPageIndex', String(next++));
        await (await fetch(page, { headers })).text();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
}

/** `hold-pages`'s script, in the page: every page of results the app is sent, kept in a global. */
function holdPages() {
  const held = [];
  window.__perfHeld = held;
  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__perfHold = String(url).includes('/search/pp/acme_asset_library/execute');
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__perfHold) {
      this.addEventListener('load', () => {
        const text = this.responseType === '' || this.responseType === 'text';
        held.push(text ? JSON.parse(this.responseText) : this.response);
      });
    }
    return send.call(this, body);
  };
}

/**
 * `twice`'s script, in the page: every request to the stand-in's REST API or configuration sent a
 * second time, alongside the app's own, its answer dropped.
 */
function sendTwice() {
  const nativeFetch = window.fetch.bind(window);
  const ours = (url) => {
    const parsed = new URL(url, location.href);
    return (
      parsed.origin === location.origin &&
      (parsed.pathname.startsWith('/nuxeo/') || parsed.pathname.startsWith('/agentic-ui-config/'))
    );
  };
  const again = (url, init) =>
    nativeFetch(url, init)
      .then((response) => response.arrayBuffer())
      .catch((error) => console.debug('[control twice] the second request failed', error));
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (ours(url)) again(url, init);
    return nativeFetch(input, init);
  };
  const { open, send, setRequestHeader } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__perfTwice = { method, url: String(url), headers: {} };
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.__perfTwice.headers[name] = value;
    return setRequestHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const { method, url, headers } = this.__perfTwice;
    if (ours(url)) again(url, { method, headers, body: body ?? undefined });
    return send.call(this, body);
  };
}

/** `ballast`'s script, in the page: 80 MB held in a global, ten million numbers, from the start. */
function holdBallast() {
  window.__perfBallast = new Array(10_000_000).fill(0.5);
}

/**
 * In every page: when the last click landed, by the page's clock, and what the check waits for.
 * Each test reads only the DOM, so polling it costs a frame and no request.
 */
function pageInstruments() {
  const tests = {
    /** The library's rows drawn: as many as expected, the first being `title`. */
    rowsStartWith: ({ title, rows }) => {
      const drawn = document.querySelectorAll('.queue-page tbody tr');
      if (drawn.length !== rows) return false;
      const first = (drawn[0]?.innerText ?? '').replace(/\s+/g, ' ').trim();
      return first.startsWith(title);
    },
    /**
     * The asset page's first picture view loaded from its blob, for the asset in the address:
     * `complete`, with its size known. Loaded, not painted: Chromium decodes at paint.
     */
    firstViewLoaded: ({ uid }) => {
      if (!location.hash.includes(uid)) return false;
      const image = document.querySelector('img.record-picture__image');
      return (
        image !== null && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:')
      );
    },
  };
  /** What the library's pager and the list's notice of the window say, as numbers where they can. */
  const read = {
    /** The total the pager's range names, "1–50 of 100000"; `null` where it names none. */
    pagerTotal: () => {
      const range = document.querySelector('.queue-page .nxs-pager__range')?.textContent ?? '';
      const total = /\bof\s+(\d[\d.,\s\u00a0\u202f]*)$/.exec(range.replace(/\s+/g, ' ').trim());
      return total ? Number(total[1].replace(/\D/g, '')) : null;
    },
    /** The pager's next button, and the window's notice with the numbers it names. */
    edge: () => {
      const next = document.querySelector('.queue-page .nxs-pager__next');
      const notice = document.querySelector(
        '.queue-page .record-list__window .nxs-banner__message',
      );
      const text = notice ? notice.textContent.replace(/\s+/g, ' ').trim() : null;
      return {
        nextDrawn: next !== null,
        nextEnabled: next !== null && !next.disabled,
        range: document.querySelector('.queue-page .nxs-pager__range')?.textContent?.trim() ?? null,
        notice: text,
        noticeNumbers: (text?.match(/\d[\d.,\u00a0\u202f]*/g) ?? []).map((n) =>
          Number(n.replace(/\D/g, '')),
        ),
      };
    },
  };
  window.__perf = { click: null, met: null, tests, read };
  document.addEventListener('click', () => (window.__perf.click = performance.now()), true);
}

/**
 * The network between the browser and the server. `desktop` is the budget's: Lighthouse's desktop
 * figures, a 40 ms round trip and 10 Mbit/s, for a person on an office connection to a server
 * elsewhere. The round trip is added by the stand-in to every answer; the bandwidth is Chromium's
 * own emulation. `none` is the loopback, for a look at the app's own share.
 */
export const NETWORKS = Object.freeze({
  desktop: { describe: '40 ms round trip, 10 Mbit/s each way', rttMs: 40, kbps: 10_240 },
  none: { describe: 'none: the loopback', rttMs: 0, kbps: 0 },
});

function parse() {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      control: { type: 'string' },
      runs: { type: 'string', default: '3' },
      port: { type: 'string', default: '4294' },
      headed: { type: 'boolean', default: false },
      cpu: { type: 'string', default: '1' },
      network: { type: 'string', default: 'desktop' },
      report: { type: 'string' },
    },
    strict: true,
  });
  const runs = Number(values.runs);
  const port = Number(values.port);
  const cpu = Number(values.cpu);
  if (!Number.isInteger(runs) || runs < 1) {
    exitWith(2, `--runs ${values.runs}: a whole number, 1 or more`);
  }
  if (!Number.isInteger(port) || port < 1) exitWith(2, `--port ${values.port}: a port`);
  if (!Number.isFinite(cpu) || cpu < 1) exitWith(2, `--cpu ${values.cpu}: a slowdown, 1 or more`);
  if (values.control !== undefined && !Object.hasOwn(CONTROLS, values.control)) {
    exitWith(2, `--control ${values.control}: one of ${Object.keys(CONTROLS).join(', ')}`);
  }
  if (!Object.hasOwn(NETWORKS, values.network)) {
    exitWith(2, `--network ${values.network}: one of ${Object.keys(NETWORKS).join(', ')}`);
  }
  return { ...values, runs, port, cpu };
}

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    exitWith(
      2,
      'Playwright is not installed. As scripts/beta-harness/README.md says, "Prerequisites":\n' +
        '  npm install --no-save @playwright/test @axe-core/playwright\n' +
        '  npx playwright install chromium',
    );
  }
}

function build() {
  console.log('building nuxeo-ui for production ...');
  const result = spawnToolSync('nx', ['run', 'nuxeo-ui:build:production', '--outputStyle=static'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.split('\n').slice(-30).join('\n');
    exitWith(1, `the production build failed:\n${tail || result.error?.message}`);
  }
}

/**
 * What was measured, for the report: the commit, whether the tree had changes on top of it, and
 * the build's first script, whose name is its hash. `null` for what could not be read.
 */
function buildIdentity() {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const status = git('status', '--porcelain');
  const index = join(DIST, 'index.html');
  const main = /src="(main-[A-Za-z0-9_-]+\.js)"/.exec(
    existsSync(index) ? readFileSync(index, 'utf8') : '',
  );
  return {
    commit: git('rev-parse', 'HEAD'),
    changesOnTop: status === null ? null : status !== '',
    mainScript: main?.[1] ?? null,
  };
}

/**
 * Waits until the stand-in has nothing in flight and no charged request for `quietMs`. Requests
 * still coming after `maxMs` are a problem of the run: the action's count would be cut short, and
 * what came after charged to the next one.
 */
async function settle(standIn, problems, label, { quietMs = 500, maxMs = 8_000 } = {}) {
  const start = performance.now();
  for (;;) {
    const now = performance.now();
    const last = standIn.log.findLast(CHARGED);
    const quietFor = last ? now - Math.max(last.at + last.ms, start) : now - start;
    if (standIn.inFlight() === 0 && quietFor >= quietMs) return;
    if (now - start > maxMs) {
      problems.push(
        `${label}: requests still coming ${maxMs} ms after it, so its count is cut short`,
      );
      return;
    }
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** The requests the stand-in saw from `from` on, charged and by kind. */
function requestsSince(standIn, from) {
  const records = standIn.log.filter((record) => record.at >= from);
  const charged = records.filter(CHARGED);
  const byKind = {};
  for (const record of charged) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
  return {
    charged: charged.length,
    byKind,
    pageProvider: byKind.pageProvider ?? 0,
    background: records.filter((record) => record.kind === 'background').length,
    unknown: records
      .filter((record) => record.kind === 'unknown')
      .map((r) => `${r.method} ${r.path}`),
  };
}

/**
 * Waits, in the page, for the test `name` of `pageInstruments` to hold for `arg`, polling each
 * frame, and returns the page's clock when it first held.
 */
async function metAt(page, name, arg, timeout) {
  await page.waitForFunction(
    ([test, value]) => {
      if (!window.__perf.tests[test](value)) return false;
      window.__perf.met = performance.now();
      return true;
    },
    [name, arg],
    { polling: 'raf', timeout },
  );
  return page.evaluate(() => window.__perf.met);
}

async function newPage(browser, options, standIn, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(pageInstruments);
  if (options.control) {
    const script = CONTROLS[options.control].initScript;
    if (script) await context.addInitScript(script);
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => run.problems.push(`page error: ${error.message}`));
  // Every other host the page asks, seen here because the stand-in never sees it.
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== standIn.url) run.external.add(url.origin);
  });
  const cdp = await context.newCDPSession(page);
  if (options.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
  const network = NETWORKS[options.network];
  if (network.kbps > 0) {
    const bytesPerSecond = (network.kbps * 1024) / 8;
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: bytesPerSecond,
      uploadThroughput: bytesPerSecond,
    });
  }
  return { context, page, cdp, standIn };
}

async function heapMB(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / (1024 * 1024);
}

const pageSize = 50;

async function coldLoad(browser, options, standIn, run, timeout) {
  const { context, page, cdp } = await newPage(browser, options, standIn, run);
  const first = standIn.library.at(0);
  const from = performance.now();
  await page.goto(`${standIn.url}/#/queues/library`);
  const drawnAt = await metAt(
    page,
    'rowsStartWith',
    { title: first.title, rows: pageSize },
    timeout,
  );
  const paint = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  );
  await settle(standIn, run.problems, 'the cold load');
  return {
    context,
    page,
    cdp,
    fcp: paint,
    firstPage: drawnAt,
    requests: requestsSince(standIn, from),
  };
}

/**
 * Clicks, then times the page from the click to `test` holding, and counts what it asked for.
 * `test` must not hold before the click: what it waits for would then be what was already drawn,
 * and the action would read as instant. That is an error, not a measure.
 */
async function timedAction(page, standIn, run, label, click, test, arg, { timeout, quietMs }) {
  const before = await page.evaluate(
    ([name, value]) => window.__perf.tests[name](value),
    [test, arg],
  );
  if (before) {
    throw new Error(`${test}(${JSON.stringify(arg)}) already held before the click`);
  }
  const from = performance.now();
  await page.evaluate(() => (window.__perf.click = null));
  await click();
  const met = await metAt(page, test, arg, timeout);
  const clicked = await page.evaluate(() => window.__perf.click);
  await settle(standIn, run.problems, label, { quietMs });
  return {
    ms: clicked === null || met < clicked ? Number.NaN : met - clicked,
    requests: requestsSince(standIn, from),
  };
}

async function main() {
  const options = parse();
  const chromium = await loadPlaywright();
  const budget = readBudget();
  if (!options['skip-build']) build();

  const control = options.control ? CONTROLS[options.control] : null;
  let standIn;
  try {
    standIn = await startStandIn({
      port: options.port,
      dist: DIST,
      latencyScale: control?.latencyScale ?? 1,
      rttMs: NETWORKS[options.network].rttMs,
      padMainBytes: control?.padMainBytes ?? 0,
      ...control?.standIn,
    });
  } catch (error) {
    exitWith(2, `the stand-in did not start: ${error.message}`);
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: !options.headed,
      // Hermetic: no host but the stand-in is resolved, so the shell's icon font on
      // fonts.googleapis.com fails at once rather than costing what it would. Every other host
      // asked is still seen (`run.external`) and held to EXTERNAL_ALLOWED.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
    });
  } catch (error) {
    await standIn.close();
    exitWith(2, `Chromium did not start (npx playwright install chromium): ${error.message}`);
  }

  const timeout = options.control === 'fetch-all' ? 240_000 : 30_000;
  const run = { problems: [], external: new Set() };
  const { problems } = run;
  const report = {
    control: options.control ?? null,
    controlDescription: control?.describe ?? null,
    assets: standIn.library.size,
    today: standIn.library.today,
    latency: LATENCY,
    latencyScale: control?.latencyScale ?? 1,
    cpuSlowdown: options.cpu,
    network: { profile: options.network, ...NETWORKS[options.network] },
    chromium: browser.version(),
    build: buildIdentity(),
    loads: [],
    pages: [],
    facets: [],
    opens: [],
    heap: null,
    window: standIn.library.window,
    /** The pages from 2 to the window's edge whose pager named another total than the library's. */
    totals: { read: 0, misstated: [] },
    edge: null,
  };
  let verdict = 'error';
  try {
    // 1. Cold loads; the last one's page goes on to the rest.
    let session = null;
    for (let load = 0; load < options.runs; load++) {
      if (session) await session.context.close();
      session = await coldLoad(browser, options, standIn, run, timeout);
      report.loads.push({
        fcp: session.fcp,
        firstPage: session.firstPage,
        requests: session.requests,
      });
      console.log(
        `cold load ${load + 1}: first paint ${Math.round(session.fcp)} ms, first page ${Math.round(session.firstPage)} ms, ${session.requests.charged} requests`,
      );
    }
    const { page, cdp } = session;
    const next = page.locator('.queue-page .nxs-pager__next');
    /** The pager's total on the page now drawn, held to the library's whole count. */
    const readTotal = async (pageNumber) => {
      const shown = await page.evaluate(() => window.__perf.read.pagerTotal());
      report.totals.read += 1;
      if (shown !== standIn.library.size) report.totals.misstated.push({ page: pageNumber, shown });
    };

    // 2. Paging: 50 pages browsed.
    const heapAtFirst = await heapMB(cdp);
    for (let index = 1; index < PAGES_BROWSED; index++) {
      const expected = standIn.library.at(index * pageSize);
      const action = await timedAction(
        page,
        standIn,
        run,
        `page ${index + 1}`,
        () => next.click(),
        'rowsStartWith',
        { title: expected.title, rows: pageSize },
        { timeout, quietMs: 300 },
      );
      report.pages.push({ page: index + 1, ...action });
      await readTotal(index + 1);
    }
    const heapAtLast = await heapMB(cdp);
    report.heap = { atPage1MB: heapAtFirst, atPage50MB: heapAtLast };
    console.log(
      `paging: ${report.pages.length} pages, median ${Math.round(median(report.pages.map((p) => p.ms)))} ms; heap ${heapAtFirst.toFixed(1)} MB at page 1, ${heapAtLast.toFixed(1)} MB at page 50`,
    );

    // 3. The search index's window: on from page 50 to its last page, 200 at 50 a page, records
    // 9,951 to 10,000, each page its expected first row; then what the edge offers and says. A
    // next page still offered there is pressed, as a person would, and the stand-in refuses it as
    // the server does. Not timed: the stand-in's latency is the same deep in the window.
    const lastWithin = Math.floor(standIn.library.window / pageSize) - 1;
    for (let index = PAGES_BROWSED; index <= lastWithin; index++) {
      const expected = standIn.library.at(index * pageSize);
      await next.click({ timeout });
      await metAt(page, 'rowsStartWith', { title: expected.title, rows: pageSize }, timeout);
      await readTotal(index + 1);
    }
    await settle(standIn, problems, "the walk to the window's edge");
    const atEdge = await page.evaluate(() => window.__perf.read.edge());
    const noticeShown =
      atEdge.notice !== null &&
      atEdge.noticeNumbers.includes(standIn.library.window) &&
      atEdge.noticeNumbers.includes(standIn.library.size);
    report.edge = { page: lastWithin + 1, ...atEdge, noticeShown, pressedPast: false };
    if (!atEdge.nextDrawn) problems.push("the window's edge: the pager is not drawn");
    if (atEdge.nextEnabled) {
      report.edge.pressedPast = true;
      await next.click({ timeout });
      await settle(standIn, problems, "next, pressed at the window's edge");
    }
    console.log(
      `window: page ${lastWithin + 1} reached, "${atEdge.range}"; next ${atEdge.nextEnabled ? 'ENABLED' : 'disabled'}; notice ${noticeShown ? 'shown' : 'MISSING'}; ${report.totals.misstated.length} of ${report.totals.read} pages misstated the total`,
    );

    // 4. Facets, from the window's edge: a choice starts the list again on its first page.
    const bucket = (aggregate, key) =>
      page
        .locator(
          `.queue-page fieldset.queue-facet[data-aggregate="${aggregate}"] .queue-facet__bucket`,
          {
            hasText: new RegExp(`^\\s*${key}\\b`),
          },
        )
        .locator('input');
    const choicesSteps = [
      {
        label: 'Rights: Ending chosen',
        aggregate: 'acme_rights_agg',
        key: 'Ending',
        after: { acme_rights_agg: ['Ending'] },
      },
      {
        label: 'Shot: Detail chosen',
        aggregate: 'acme_shot_agg',
        key: 'Detail',
        after: { acme_rights_agg: ['Ending'], acme_shot_agg: ['Detail'] },
      },
      {
        label: 'Shot: Detail cleared',
        aggregate: 'acme_shot_agg',
        key: 'Detail',
        after: { acme_rights_agg: ['Ending'] },
      },
      { label: 'Rights: Ending cleared', aggregate: 'acme_rights_agg', key: 'Ending', after: {} },
    ];
    for (const step of choicesSteps) {
      const expected = standIn.library.at(0, step.after);
      const rows = Math.min(pageSize, standIn.library.count(step.after));
      const action = await timedAction(
        page,
        standIn,
        run,
        step.label,
        () => bucket(step.aggregate, step.key).click(),
        'rowsStartWith',
        { title: expected.title, rows },
        { timeout, quietMs: 300 },
      );
      report.facets.push({ label: step.label, ...action });
      console.log(
        `facet: ${step.label}: ${Math.round(action.ms)} ms, ${action.requests.charged} requests`,
      );
    }

    // 5. The asset page, five rows opened from the library's first page.
    for (let row = 0; row < ASSETS_OPENED; row++) {
      const asset = standIn.library.at(row);
      const action = await timedAction(
        page,
        standIn,
        run,
        `asset ${row + 1} opened`,
        () => page.locator('.queue-page tbody tr').nth(row).click(),
        'firstViewLoaded',
        { uid: asset.uid },
        // The history card asks the audit once more 2.5 s after it is drawn: counted with the open.
        { timeout, quietMs: 3_000 },
      );
      report.opens.push({ uid: asset.uid, title: asset.title, ...action });
      console.log(
        `asset ${row + 1}: first view ${Math.round(action.ms)} ms, ${action.requests.charged} requests`,
      );
      await page.goBack();
      await metAt(
        page,
        'rowsStartWith',
        { title: standIn.library.at(0).title, rows: pageSize },
        timeout,
      );
      await settle(standIn, problems, `back from asset ${row + 1}`);
    }
    await session.context.close();

    const measured = {
      'library.firstContentfulPaintMs': median(report.loads.map((load) => load.fcp ?? Number.NaN)),
      'library.firstPageMs': median(report.loads.map((load) => load.firstPage)),
      'library.openRequests': largest(report.loads.map((load) => load.requests.charged)),
      'paging.medianMs': median(report.pages.map((p) => p.ms)),
      'paging.p95Ms': percentile(
        report.pages.map((p) => p.ms),
        0.95,
      ),
      'paging.requestsPerPage': largest(report.pages.map((p) => p.requests.charged)),
      'facets.maxMs': largest(report.facets.map((f) => f.ms)),
      'facets.requestsPerChoice': largest(report.facets.map((f) => f.requests.charged)),
      'asset.firstViewMs': largest(report.opens.map((a) => a.ms)),
      'asset.requests': largest(report.opens.map((a) => a.requests.charged)),
      'heap.after50PagesMB': report.heap.atPage50MB,
      'heap.growthMB': report.heap.atPage50MB - report.heap.atPage1MB,
      'window.requestsPast': standIn.log.filter((record) => record.pastWindow).length,
      'window.controlsPast': report.edge.nextEnabled ? 1 : 0,
      'window.totalsMisstated': report.totals.misstated.length,
      'window.noticeMissing': report.edge.noticeShown ? 0 : 1,
    };
    const judged = judge(measured, budget);

    // What the run must also have shown, whatever the times: else it measured something else.
    const unknown = [
      ...new Set(
        standIn.log.filter((r) => r.kind === 'unknown').map((r) => `${r.method} ${r.path}`),
      ),
    ];
    const external = [...run.external].filter((origin) => !EXTERNAL_ALLOWED.includes(origin));
    const checks = [
      {
        name: 'every request the pages made had an answer from the stand-in',
        pass: unknown.length === 0,
        detail: unknown.join(', ') || null,
      },
      {
        name: `no host was asked but the stand-in and ${EXTERNAL_ALLOWED.join(' and ')}`,
        pass: external.length === 0,
        detail: external.join(', ') || null,
      },
      {
        name: 'nothing went wrong in the run: no error in the page, every action settled',
        pass: problems.length === 0,
        detail: problems.join('; ') || null,
      },
      {
        name: 'each page of results and each facet asked the page provider once',
        pass: [...report.pages, ...report.facets].every(
          (action) => action.requests.pageProvider === 1,
        ),
        detail: null,
      },
    ];
    report.measured = measured;
    report.judged = judged;
    report.checks = checks;
    verdict = judged.pass && checks.every((check) => check.pass) ? 'pass' : 'fail';
  } catch (error) {
    problems.push(error.stack ?? String(error));
    report.error = error.stack ?? String(error);
    verdict = 'error';
  } finally {
    await browser.close();
    await standIn.close();
  }

  report.verdict = verdict;
  report.requestLog = standIn.log.map(
    ({ at, method, path, query, kind, status, bytes, ms, pastWindow }) => ({
      at: Math.round(at),
      method,
      path,
      query,
      kind,
      status,
      bytes,
      ms: Math.round(ms),
      ...(pastWindow ? { pastWindow } : {}),
    }),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = options.report
    ? resolve(options.report)
    : resolve(
        EVIDENCE_ROOT,
        'beta',
        'asset-performance',
        `${stamp}${options.control ? `-${options.control}` : ''}`,
      );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'REPORT.md'), markdown(report));
  console.log('');
  console.log(markdown(report));
  console.log(`report: ${outDir}`);
  process.exit(verdict === 'pass' ? 0 : 1);
}

const round = (value, unit) =>
  value === null || !Number.isFinite(value)
    ? 'not measured'
    : unit === 'MB'
      ? value.toFixed(1)
      : String(Math.round(value));

export function markdown(report) {
  const lines = [
    `# Asset library performance at ${report.assets.toLocaleString('en')} assets: ${report.verdict.toUpperCase()}`,
    '',
    report.control
      ? `**Negative control \`${report.control}\`:** ${report.controlDescription}. It must fail.`
      : 'No control: the app as built.',
    '',
    `Chromium ${report.chromium}; network ${report.network.describe}; CPU slowdown ${report.cpuSlowdown}x; stand-in latency x${report.latencyScale}.`,
    '',
    `Built from ${report.build.commit ?? 'an unknown commit'}${report.build.changesOnTop ? ', with changes on top' : ''}: ${report.build.mainScript ?? 'no main script found'}.`,
    '',
  ];
  if (report.judged) {
    lines.push('| Measure | Value | Budget | |', '| --- | ---: | ---: | --- |');
    for (const line of report.judged.lines) {
      lines.push(
        `| ${line.label} | ${round(line.value, line.unit)} ${line.unit} | ${line.limit} ${line.unit} | ${line.pass ? 'within' : '**over**'} |`,
      );
    }
    lines.push('');
    for (const check of report.checks) {
      const detail = check.detail ? ` (${check.detail})` : '';
      lines.push(`- ${check.pass ? 'pass' : '**FAIL**'}: ${check.name}${detail}`);
    }
    if (report.edge) {
      const { edge, totals } = report;
      lines.push(
        '',
        `**The window's edge,** ${report.window.toLocaleString('en')} results: page ${edge.page}, its pager "${edge.range ?? 'not drawn'}", next ${edge.nextEnabled ? '**enabled**, and pressed' : 'disabled'}; notice ${edge.notice ? `"${edge.notice}"` : '**none**'}; totals misstated on ${totals.misstated.length} of ${totals.read} pages${totals.misstated[0] ? `, the first page ${totals.misstated[0].page} showing ${totals.misstated[0].shown}` : ''}.`,
      );
    }
    const kinds = (requests) =>
      Object.entries(requests.byKind)
        .map(([kind, count]) => `${kind} ${count}`)
        .join(', ') || 'none';
    const actions = [
      ['the library, cold (first load)', report.loads[0]],
      ['a page of results (page 2)', report.pages[0]],
      [`a facet (${report.facets[0]?.label})`, report.facets[0]],
      ['the asset page (first open)', report.opens[0]],
      ['the asset page (second open)', report.opens[1]],
    ].filter(([, action]) => action);
    lines.push('', '| Action | Requests | By kind |', '| --- | ---: | --- |');
    for (const [label, action] of actions) {
      lines.push(`| ${label} | ${action.requests.charged} | ${kinds(action.requests)} |`);
    }
  }
  if (report.error) lines.push('', '```', report.error, '```');
  lines.push(
    '',
    "Not measured: Nuxeo's and OpenSearch's own query time at 100,000 documents; the stand-in answers after a stated latency. The network is emulated on one machine, not crossed.",
    '',
  );
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
