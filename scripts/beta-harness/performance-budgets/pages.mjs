#!/usr/bin/env node
/**
 * The pages' performance budgets in the browser: the home page, a queue's first page and a record
 * page's first render, each the median of several cold loads, held to `budgets.json`.
 *
 *   npm run beta:page-budgets                          # build, measure, judge
 *   npm run beta:page-budgets -- --skip-build          # the build already in dist/
 *   npm run beta:page-budgets -- --report /tmp/pages.json
 *   npm run beta:page-budgets -- --skip-build --lower queue.firstPageMs=100   # must fail
 *
 * It serves the production build with the asset performance check's stand-in for the server
 * (`../asset-performance/stand-in.mjs`: the brand assets kit's configuration, 100,000 synthetic
 * assets, each answer after its stated latency, over the same emulated office network, a 40 ms
 * round trip and 10 Mbit/s), plus a home of three cards over the library's page provider, and
 * opens each page `--runs` times (5), each in a new browser context with nothing cached:
 *
 * - **`home.firstRenderMs`:** `/#/home`, until every card is drawn with its figure;
 * - **`queue.firstPageMs`:** `/#/queues/library`, until its first page's 50 rows are drawn, the
 *   first being the asset the server puts first;
 * - **`record.firstRenderMs`:** `/#/doc/<the first asset>`, until the record page shows the
 *   asset's title and its layout's first card.
 *
 * Each from navigation, by the page's own clock, and judged on the median of its runs: one slow
 * run, a garbage collection or a busy runner, does not fail the check; most of them slow does.
 * The loads are interleaved, home, queue, record, then again, so that a slow minute of the
 * machine falls on every page alike.
 *
 * The run fails, whatever its times, if a page threw, asked for something the stand-in has no
 * answer for, or asked a host other than the stand-in and the shell's icon font.
 *
 * Exit codes, as the beta harness's: 0 within budget; 1 over it, each line over named with its
 * number and its budget, or a page that did not draw; 2 a precondition not met (no Playwright or
 * Chromium, no build, or the port taken).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { spawnToolSync } from '../package-command.mjs';
import { EXTERNAL_ALLOWED, NETWORKS } from '../asset-performance/check.mjs';
import { startStandIn } from '../asset-performance/stand-in.mjs';
import { parseLowered } from './bundles.mjs';
import { failures, judgePages, lowered, median, readBudgets, table } from './budgets.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = join(ROOT, 'dist/nuxeo-ui/browser');

/** The home the stand-in serves: three cards over the library, a count, its buckets and one bucket. */
export const HOME = Object.freeze({
  version: 2,
  label: 'Brand library',
  cards: [
    {
      id: 'assets',
      label: 'Assets',
      kpi: { pageProvider: 'acme_asset_library' },
      queue: 'library',
    },
    {
      id: 'rights',
      label: 'Rights',
      kpi: { pageProvider: 'acme_asset_library', aggregate: 'acme_rights_agg' },
      queue: 'library',
    },
    {
      id: 'ending',
      label: 'Rights ending',
      kpi: { pageProvider: 'acme_asset_library', aggregate: 'acme_rights_agg', bucket: 'Ending' },
      queue: 'library',
    },
  ],
});

/**
 * In every page: what each measure waits for, read from the DOM alone, so polling it costs a
 * frame and no request.
 */
function pageInstruments() {
  const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
  window.__budget = {
    tests: {
      /** Every card of the home drawn, each with its figure, none still loading. */
      home: ({ cards }) => {
        const drawn = document.querySelectorAll('.home-page .home-card');
        if (drawn.length !== cards) return false;
        return [...drawn].every(
          (card) =>
            card.querySelector('.home-card__figure') !== null &&
            card.querySelector('.home-card__note[role="status"]') === null,
        );
      },
      /** The queue's rows drawn: as many as expected, the first being `title`. */
      queue: ({ title, rows }) => {
        const drawn = document.querySelectorAll('.queue-page tbody tr');
        return drawn.length === rows && clean(drawn[0]?.innerText).startsWith(title);
      },
      /**
       * The record page: the asset's title in its page heading, the header's `role="heading"
       * aria-level="1"`, and its layout's first card drawn.
       */
      record: ({ title }) => {
        const card = document.querySelector('.record-page .record-page__card');
        if (card === null) return false;
        return [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].some(
          (heading) => clean(heading.textContent) === title,
        );
      },
    },
    met: null,
  };
}

function exitWith(code, message) {
  console.error(message);
  process.exit(code);
}

function parse() {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      runs: { type: 'string', default: '5' },
      port: { type: 'string', default: '4295' },
      network: { type: 'string', default: 'desktop' },
      report: { type: 'string' },
      headed: { type: 'boolean', default: false },
      lower: { type: 'string', multiple: true, default: [] },
    },
    strict: true,
  });
  const runs = Number(values.runs);
  const port = Number(values.port);
  if (!Number.isInteger(runs) || runs < 1)
    exitWith(2, `--runs ${values.runs}: a whole number, 1 or more`);
  if (!Number.isInteger(port) || port < 1) exitWith(2, `--port ${values.port}: a port`);
  if (!Object.hasOwn(NETWORKS, values.network)) {
    exitWith(2, `--network ${values.network}: one of ${Object.keys(NETWORKS).join(', ')}`);
  }
  return { ...values, runs, port };
}

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return exitWith(
      2,
      'Playwright is not installed. As scripts/beta-harness/README.md says, "Prerequisites":\n' +
        '  npm install --no-save @playwright/test\n' +
        '  npx playwright install chromium',
    );
  }
}

function build() {
  console.log('building nuxeo-ui for production ...');
  const result = spawnToolSync(
    'nx',
    ['run', 'nuxeo-ui:build:production', '--stats-json', '--outputStyle=static'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.split('\n').slice(-30).join('\n');
    exitWith(1, `the production build failed:\n${tail || result.error?.message}`);
  }
}

/** One cold load of `path` in a new context: the page's clock when `test` first held, from navigation. */
async function coldLoad(browser, standIn, options, run, path, test, arg) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await context.addInitScript(pageInstruments);
    const page = await context.newPage();
    page.on('pageerror', (error) => run.problems.push(`${path}: page error: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== standIn.url)
        run.external.add(url.origin);
    });
    const network = NETWORKS[options.network];
    if (network.kbps > 0) {
      const cdp = await context.newCDPSession(page);
      const bytesPerSecond = (network.kbps * 1024) / 8;
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: bytesPerSecond,
        uploadThroughput: bytesPerSecond,
      });
    }
    await page.goto(`${standIn.url}/${path}`);
    await page.waitForFunction(
      ([name, value]) => {
        if (!window.__budget.tests[name](value)) return false;
        window.__budget.met = performance.now();
        return true;
      },
      [test, arg],
      { polling: 'raf', timeout: 30_000 },
    );
    return await page.evaluate(() => window.__budget.met);
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parse();
  let budgets = readBudgets();
  let lowers;
  try {
    lowers = parseLowered(options.lower);
    for (const { id, limit } of lowers) budgets = lowered(budgets, id, limit);
  } catch (error) {
    exitWith(2, error.message);
  }
  const chromium = await loadPlaywright();
  if (!options['skip-build']) build();
  if (!existsSync(join(DIST, 'index.html'))) exitWith(2, `no production build at ${DIST}`);

  let standIn;
  try {
    standIn = await startStandIn({
      port: options.port,
      dist: DIST,
      rttMs: NETWORKS[options.network].rttMs,
      home: HOME,
    });
  } catch (error) {
    exitWith(2, `the stand-in did not start: ${error.message}`);
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: !options.headed,
      // Hermetic, as the asset performance check: no host but the stand-in is resolved.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
    });
  } catch (error) {
    await standIn.close();
    exitWith(2, `Chromium did not start (npx playwright install chromium): ${error.message}`);
  }

  const first = standIn.library.at(0);
  const pages = [
    { id: 'home.firstRenderMs', path: '#/home', test: 'home', arg: { cards: HOME.cards.length } },
    {
      id: 'queue.firstPageMs',
      path: '#/queues/library',
      test: 'queue',
      arg: { title: first.title, rows: 50 },
    },
    {
      id: 'record.firstRenderMs',
      path: `#/doc/${first.uid}`,
      test: 'record',
      arg: { title: first.title },
    },
  ];
  const run = { problems: [], external: new Set() };
  const times = Object.fromEntries(pages.map((page) => [page.id, []]));
  let verdict = 'error';
  let judged = null;
  let checks = [];
  try {
    for (let index = 0; index < options.runs; index++) {
      for (const page of pages) {
        let ms = Number.NaN;
        try {
          ms = await coldLoad(browser, standIn, options, run, page.path, page.test, page.arg);
        } catch (error) {
          run.problems.push(`${page.path}, load ${index + 1}: ${error.message.split('\n')[0]}`);
        }
        times[page.id].push(ms);
        console.log(
          `${page.id} load ${index + 1}: ${Number.isFinite(ms) ? `${Math.round(ms)} ms` : 'did not draw'}`,
        );
      }
    }
    const measured = Object.fromEntries(pages.map((page) => [page.id, median(times[page.id])]));
    judged = judgePages(measured, budgets);
    const unknown = [
      ...new Set(
        standIn.log.filter((r) => r.kind === 'unknown').map((r) => `${r.method} ${r.path}`),
      ),
    ];
    const external = [...run.external].filter((origin) => !EXTERNAL_ALLOWED.includes(origin));
    checks = [
      {
        name: 'every request had an answer from the stand-in',
        pass: unknown.length === 0,
        detail: unknown.join(', ') || null,
      },
      {
        name: `no host was asked but the stand-in and ${EXTERNAL_ALLOWED.join(' and ')}`,
        pass: external.length === 0,
        detail: external.join(', ') || null,
      },
      {
        name: 'every page drew, and none threw',
        pass: run.problems.length === 0,
        detail: run.problems.join('; ') || null,
      },
    ];
    verdict = judged.pass && checks.every((check) => check.pass) ? 'pass' : 'fail';
  } finally {
    await browser.close();
    await standIn.close();
  }

  const report = {
    kind: 'pages',
    chromium: browser.version(),
    network: { profile: options.network, ...NETWORKS[options.network] },
    runs: options.runs,
    lowered: lowers,
    times,
    judged,
    checks,
    verdict,
    pass: verdict === 'pass',
  };
  if (options.report)
    writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);

  console.log('');
  console.log(table(judged));
  for (const check of checks) {
    console.log(
      `- ${check.pass ? 'pass' : 'FAIL'}: ${check.name}${check.detail ? ` (${check.detail})` : ''}`,
    );
  }
  if (lowers.length > 0) {
    console.log(
      `control: ${lowers.map(({ id, limit }) => `${id} lowered to ${limit}`).join(', ')}`,
    );
  }
  if (verdict !== 'pass') {
    for (const each of failures(judged)) console.error(each);
    for (const check of checks.filter((each) => !each.pass)) console.error(`failed: ${check.name}`);
    process.exit(1);
  }
  console.log(
    `within budget: ${pages.length} pages, the median of ${options.runs} cold loads each`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
