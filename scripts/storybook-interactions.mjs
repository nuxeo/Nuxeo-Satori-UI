#!/usr/bin/env node
/**
 * Run every story of a built Storybook in a real browser, its play function included, and fail
 * when a story does not render or its play function throws.
 *
 * The `nxs-` library's stories carry play functions that assert behaviour — a picker returns what
 * was chosen, a date typed in French reads as French. Without this nothing ran them: Storybook runs
 * a play function only when a person opens the story, so one that started failing stayed green
 * everywhere. This serves the static build, opens each story's iframe in Chromium and reads what
 * the preview reports on its channel.
 *
 * ## What counts as a failure
 *
 * - `playFunctionThrewException`, `unhandledErrorsWhilePlaying`, `storyThrewException`,
 *   `storyErrored` or `storyMissing` for the story. **Not `storyFinished`'s status:** Storybook
 *   reports `storyFinished` with `success` even when the play function threw, so the status alone
 *   would pass a failing play — the reason these events are watched one by one.
 * - An uncaught error on the page while the story ran.
 * - No terminal event within `--story-timeout`.
 * - An untranslated `satori-components.*` or `shared-ui.*` key left on screen once the story
 *   finished. The preview loads the catalogue before the first story renders (`preview.ts`), so a
 *   play function never races the translations; a key still showing is a missing translation.
 * - A `Dialogs/` story whose preview is not laid out as MatDialog lays the dialog out in the
 *   application, at 1280 px or on a fresh page at 320 px: an element outside the surface or its
 *   rounded corners, title, content or buttons closer to the edge than Material's spacing, a field
 *   that cuts off its value, a sideways scroll, or a focus indicator painting outside the surface.
 *   The rules and their negative controls are in `storybook-dialog-layout.mjs` and its selftest.
 *
 * ## What does not
 *
 * Accessibility. The a11y addon runs axe after each story and reports through `storyFinished`;
 * those results are **observation only**, printed as a count and never a failure, because
 * `docs/accessibility.md` gives the WCAG verdict to the axe runtime layer alone.
 *
 * ## Scope
 *
 * The default Storybook, which builds without a GitHub Packages token. The Satori adapter's
 * Storybook (`satori-components-satori`) and the Satori-theme build need `@hylandsoftware/satori-ui`
 * and are refused unless `--satori` is passed, so the CI job never depends on the token.
 *
 * ## With `--satori`
 *
 * For the Satori adapter's Storybook (the `storybook-satori` gate), each story also fails when:
 *
 * - a request under `i18n/@hylandsoftware/satori-ui/` answers an error and Satori's loader has no
 *   fallback that loaded — it asks for `<lang>.json` and, for a regional code, then the base
 *   language's file, so `en-US.json` 404 followed by `en.json` 200 is fine and a lone 404 is not;
 * - no Satori catalogue loaded at all;
 * - an untranslated `sat.*` key is on screen (checked in every run; nothing else renders one).
 *
 * This is what the static `checkStorybookSatoriCatalogues` guardrail approximates from the config
 * files. It asks the built Storybook instead, so no way of writing `staticDirs`, `assets` or the
 * loader's languages can make it disagree with what is served. satori-ui 1.0.0 dropped `en.json`
 * and the Satori Storybook rendered raw `sat.*` keys with every gate green; this is that check.
 *
 * Needs `@playwright/test` and Chromium, which CI installs with `--no-save`:
 *   npm install --no-save @playwright/test@<a11y/versions.mjs> && npx playwright install chromium
 *
 * Usage:
 *   node scripts/storybook-interactions.mjs [--dir dist/storybook/satori-components]
 *     [--port 6231] [--story-timeout 20000] [--budget 900000] [--only <id-part>] [--json <file>]
 *     [--satori] [--catalogue-timeout 10000]
 *
 * Exit 0 all stories passed, 1 a story failed or the budget ran out, 2 nothing could be run.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { PLAYWRIGHT_TEST_VERSION } from '../a11y/versions.mjs';
import {
  DIALOG_LAYOUT_WIDTHS,
  checkDialogLayout,
  isDialogStory,
} from './storybook-dialog-layout.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, option('--dir', 'dist/storybook/satori-components'));
const port = Number(option('--port', process.env.STORYBOOK_INTERACTIONS_PORT ?? '6231'));
const storyTimeout = Number(option('--story-timeout', '20000'));
// A wall clock over a suite that grows with the library: every story added tightens it. Raised
// from 600000 by NXSAT-331, when `main` ran 300 stories in 582.2 s and eighteen new ones stranded
// 61 behind it. At that run's 1.94 s per story this is reached at roughly 464. See ci.yml.
const budget = Number(option('--budget', '900000'));
const only = option('--only', null);
const jsonOut = option('--json', null);
/** Accept a Satori Storybook and check what Satori's own translation loader is served. */
const satori = argv.includes('--satori');
/** How long a Satori catalogue request may take to finish, after the story has, before it fails. */
const catalogueTimeout = Number(option('--catalogue-timeout', '10000'));

/** Events after which a story has said all it will. */
const TERMINAL = ['storyFinished', 'storyErrored', 'storyMissing', 'storyThrewException'];
/** Events that fail a story whatever `storyFinished` says. */
const FAILING = [
  'playFunctionThrewException',
  'unhandledErrorsWhilePlaying',
  'storyThrewException',
  'storyErrored',
  'storyMissing',
];
/** A key from a catalogue the library binds, left untranslated on screen. */
const RAW_KEY = /\b(?:satori-components|shared-ui|sat)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/;
/** Where Satori's loader fetches its catalogues: `./i18n/@hylandsoftware/satori-ui/<lang>.json`. */
const SATORI_CATALOGUES = '/i18n/@hylandsoftware/satori-ui/';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function refuse(message) {
  console.error(`storybook-interactions: ${message}`);
  process.exit(2);
}

/**
 * The script the page runs before Storybook's own: it wraps the addon store's `setChannel`, so
 * every event the preview emits from its first one is recorded on `window.__nxsStoryEvents`.
 */
function recordChannel(watched) {
  const events = [];
  Object.defineProperty(window, '__nxsStoryEvents', { value: events });
  const plain = (payload) => {
    try {
      return JSON.parse(JSON.stringify(payload ?? null));
    } catch {
      return String(payload);
    }
  };
  const attach = (channel) => {
    if (!channel || channel.__nxsRecorded) return;
    channel.__nxsRecorded = true;
    for (const name of watched)
      channel.on(name, (payload) => events.push({ name, payload: plain(payload) }));
  };
  let store;
  Object.defineProperty(window, '__STORYBOOK_ADDONS_PREVIEW', {
    configurable: true,
    get: () => store,
    set: (value) => {
      store = value;
      if (value?.channel) attach(value.channel);
      const setChannel = value?.setChannel;
      if (typeof setChannel === 'function') {
        value.setChannel = (channel) => {
          attach(channel);
          return setChannel(channel);
        };
      }
    },
  });
}

async function main() {
  if (!satori && /satori-components-satori|satori-theme/.test(dir)) {
    refuse(
      `${dir} is a Satori Storybook, which needs @hylandsoftware/satori-ui and a GitHub Packages ` +
        'token. This runner covers the token-free build only; pass --satori to check it anyway.',
    );
  }
  const indexFile = join(dir, 'index.json');
  if (!existsSync(indexFile) || !existsSync(join(dir, 'iframe.html'))) {
    refuse(
      `${dir} has no index.json and iframe.html. Build it first: npx nx run satori-components:build-storybook`,
    );
  }
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const stories = Object.values(index.entries ?? {})
    .filter((entry) => entry.type === 'story')
    .filter((entry) => !only || entry.id.includes(only))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (stories.length === 0)
    refuse(`${indexFile} lists no story${only ? ` matching "${only}"` : ''}.`);

  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    refuse(
      `@playwright/test is not installed. Install it without touching the lockfile:\n` +
        `  npm install --no-save @playwright/test@${PLAYWRIGHT_TEST_VERSION} && npx playwright install chromium`,
    );
  }

  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dir + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));

  const started = Date.now();
  const browser = await chromium.launch();
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(recordChannel, [...new Set([...TERMINAL, ...FAILING])]);
    for (const story of stories) {
      if (Date.now() - started > budget) {
        results.push({
          id: story.id,
          play: false,
          failures: [`budget of ${budget} ms spent before it ran`],
          a11y: 0,
        });
        continue;
      }
      results.push(await runStory(context, story));
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((result) => result.failures.length);
  const plays = results.filter((result) => result.play);
  const withViolations = results.filter((result) => result.a11y > 0);
  const dialogs = results.filter((result) => result.layout);
  const laidOut = dialogs.filter((result) =>
    Object.values(result.layout).every((problems) => problems.length === 0),
  );
  for (const result of failed) {
    console.error(`FAIL ${result.id}`);
    for (const failure of result.failures) console.error(`     ${failure}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `storybook-interactions: ${results.length - failed.length} of ${results.length} stories passed ` +
      `(${plays.length} with a play function) in ${seconds}s.`,
  );
  console.log(
    `storybook-interactions: dialog layout at ${DIALOG_LAYOUT_WIDTHS.join(' and ')} px: ` +
      `${laidOut.length} of ${dialogs.length} dialog stories laid out as MatDialog lays them out.`,
  );
  console.log(
    `storybook-interactions: axe, observation only (docs/accessibility.md): ${withViolations.length} ` +
      `stories with violations, ${withViolations.reduce((n, r) => n + r.a11y, 0)} in all. Not a verdict.`,
  );
  if (jsonOut) {
    writeFileSync(
      resolve(jsonOut),
      `${JSON.stringify({ seconds: Number(seconds), results }, null, 2)}\n`,
    );
  }
  process.exit(failed.length ? 1 : 0);
}

async function runStory(context, story) {
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(`uncaught on the page: ${error.message}`));
  /** Every response to Satori's loader, by path: what the built Storybook actually serves. */
  const catalogues = [];
  /**
   * Translation catalogue requests not yet finished. The preview starts loading translations in an
   * `ENVIRONMENT_INITIALIZER` that does not block the story, so a catalogue can still be on its
   * way when the story reports finished; judging then failed a healthy story (review on #602).
   */
  const inFlight = new Set();
  if (satori) {
    const pathOf = (request) => new URL(request.url()).pathname;
    // Every translation catalogue the page asks for — Satori's and the application's own,
    // served at `i18n/` — is waited for, because the untranslated-key check reads what both
    // render; waiting for Satori's alone judged a story before its own strings arrived.
    const isTranslation = (request) => /\/i18n\//.test(pathOf(request));
    page.on('request', (request) => {
      if (isTranslation(request)) inFlight.add(request);
    });
    // A catalogue counts as served only once its body has arrived. `response` fires on the
    // headers, so recording it there let a download cut off half-way count as loaded, and the
    // `requestfailed` that followed was then ignored for that path (review on #602).
    page.on('requestfinished', async (request) => {
      if (pathOf(request).includes(SATORI_CATALOGUES)) {
        const response = await request.response().catch(() => null);
        // Its strings, not just its status: a 200 with `{}` loaded nothing, and a story whose
        // `sat.*` text sits only in attributes then passed with no translations (review on #602).
        const body = response ? await response.text().catch(() => '') : '';
        catalogues.push({
          path: pathOf(request),
          status: response?.status() ?? 0,
          strings: countStrings(body),
          error: 'no response',
        });
      }
      inFlight.delete(request);
    });
    // A transport failure — refused, reset, aborted, cut off — emits `requestfailed` instead.
    page.on('requestfailed', (request) => {
      if (pathOf(request).includes(SATORI_CATALOGUES)) {
        catalogues.push({
          path: pathOf(request),
          status: 0,
          error: request.failure()?.errorText ?? 'request failed',
        });
      }
      inFlight.delete(request);
    });
  }
  try {
    const events = await openStory(page, story, failures);
    if (satori) {
      // Still pending is its own verdict; judging a record that has not arrived yet would add a
      // misleading "requested nothing".
      const pending = await settleCatalogues(page, inFlight);
      failures.push(...(pending.length ? pending : satoriCatalogueFailures(catalogues)));
    }
    const finished = events.find((event) => event.name === 'storyFinished');
    const a11y = (finished?.payload?.reporters ?? [])
      .filter((reporter) => reporter?.type === 'a11y')
      .reduce((count, reporter) => count + (reporter?.result?.violations?.length ?? 0), 0);
    if (!failures.length) {
      // With --satori, the text a screen reader announces as well as what is drawn: an accessible
      // name left as a raw key is the regression this started from, and `innerText` cannot see
      // it. The default run reads `innerText` only, as it always has.
      const text = await page.evaluate(
        (withAttributes) =>
          [
            document.body.innerText,
            ...(withAttributes
              ? [...document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')].flatMap(
                  (el) =>
                    ['aria-label', 'title', 'placeholder', 'alt']
                      .map((name) => el.getAttribute(name))
                      .filter(Boolean),
                )
              : []),
          ].join('\n'),
        satori,
      );
      const raw = RAW_KEY.exec(text);
      if (raw)
        failures.push(`an untranslated key is on screen or in an accessible name: ${raw[0]}`);
    }
    const layout =
      isDialogStory(story) && !failures.length ? await checkLayout(context, page, story) : null;
    for (const [width, problems] of Object.entries(layout ?? {})) {
      for (const problem of problems) failures.push(`at ${width} px: ${problem}`);
    }
    return {
      id: story.id,
      play: (story.tags ?? []).includes('play-fn'),
      // Recorded to show why the status alone is not read: it says `success` for a throwing play.
      finished: finished?.payload?.status ?? null,
      failures,
      a11y,
      ...(layout ? { layout } : {}),
    };
  } finally {
    await page.close();
  }
}

/**
 * How many usable strings a catalogue body holds, at any depth; 0 for one that is not JSON. Blank
 * strings do not count: a catalogue of `""` values renders empty labels, which no raw-key check can
 * see, and would otherwise pass as served (review on #602).
 */
function countStrings(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return 0;
  }
  const walk = (node) =>
    typeof node === 'string'
      ? Number(node.trim().length > 0)
      : node && typeof node === 'object'
        ? Object.values(node).reduce((sum, child) => sum + walk(child), 0)
        : 0;
  return walk(value);
}

/**
 * Waits until no Satori catalogue request is in flight and none has started for a short quiet
 * period — a failed request can start its base-language fallback after it — then lets the page
 * render what arrived. Returns a failure for any request still unfinished at the timeout.
 */
async function settleCatalogues(page, inFlight) {
  const QUIET_MS = 250;
  const deadline = Date.now() + catalogueTimeout;
  let quietSince = inFlight.size === 0 ? Date.now() : null;
  while (Date.now() < deadline) {
    if (inFlight.size > 0) quietSince = null;
    else if (quietSince === null) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) break;
    await page.waitForTimeout(25);
  }
  if (inFlight.size > 0) {
    const paths = [...new Set([...inFlight].map((request) => new URL(request.url()).pathname))];
    return paths.map(
      (path) =>
        `The translation catalogue ${path} had not finished ${catalogueTimeout} ms ` +
        'after the story did',
    );
  }
  // Translations arrive through change detection; give it a frame before reading the screen.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  return [];
}

/**
 * What is wrong with the catalogues Satori's loader was served, by its own rule: it asks for
 * `<lang>.json` and, for a regional code, falls back to the base language's file. A failed request
 * is fine only if that fallback then loaded; and a Satori Storybook must load at least one.
 */
function satoriCatalogueFailures(catalogues) {
  /** An HTTP answer below 400. A transport failure is recorded as status 0. */
  const ok = (status) => status >= 200 && status < 400;
  /** Served: answered, and holding at least one translation string. */
  const served = (c) => ok(c.status) && (c.strings ?? 0) > 0;
  const loaded = new Set(catalogues.filter(served).map((c) => c.path));
  const failures = [];
  for (const catalogue of catalogues) {
    const { path, status, error } = catalogue;
    // Served on another attempt — the preview and a story can each ask — means the strings arrived.
    if (served(catalogue) || loaded.has(path)) continue;
    const file = path.slice(path.lastIndexOf('/') + 1);
    const lang = file.replace(/\.json$/, '');
    const parts = lang.split(/[-_]/);
    const fallback =
      parts.length > 1 ? path.replace(new RegExp(`${file}$`), `${parts[0]}.json`) : null;
    if (fallback && loaded.has(fallback)) continue;
    failures.push(
      `Satori's catalogue ${path} ${ok(status) ? `answered ${status} with no non-blank translation strings` : status ? `answered ${status}` : `failed in transport (${error})`}` +
        (fallback ? ` and its fallback ${fallback} did not load` : '') +
        ', so its sat.* strings are missing',
    );
  }
  if (loaded.size === 0) {
    failures.push(
      catalogues.length
        ? 'no Satori catalogue loaded'
        : `Satori's loader requested nothing under ${SATORI_CATALOGUES}; is the Satori translation provider configured?`,
    );
  }
  return [...new Set(failures)];
}

/** Opens a story's iframe, waits for it to finish and records the events that fail it. */
async function openStory(page, story, failures) {
  await page.goto(
    `http://127.0.0.1:${port}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`,
  );
  try {
    await page.waitForFunction(
      ([terminal, id]) =>
        window.__nxsStoryEvents?.some(
          (event) => terminal.includes(event.name) && (event.payload?.storyId ?? id) === id,
        ),
      [TERMINAL, story.id],
      { timeout: storyTimeout },
    );
  } catch {
    failures.push(`no storyFinished, storyErrored or storyMissing within ${storyTimeout} ms`);
  }
  // An exception event can trail the terminal one by a task.
  await page.waitForTimeout(50);
  const events = await page.evaluate(() => window.__nxsStoryEvents ?? []);
  for (const event of events.filter((e) => FAILING.includes(e.name))) {
    failures.push(`${event.name}: ${describe(event.payload)}`);
  }
  return events;
}

/**
 * The dialog layout check at each width, keyed by width: on the page already open when it is at
 * that width, otherwise on a fresh page opened at it, so the story renders as it would on that
 * screen rather than being resized after it rendered.
 */
async function checkLayout(context, page, story) {
  const layout = {};
  for (const width of DIALOG_LAYOUT_WIDTHS) {
    if (page.viewportSize()?.width === width) {
      layout[width] = await checkDialogLayout(page);
      continue;
    }
    const other = await context.newPage();
    const failures = [];
    other.on('pageerror', (error) => failures.push(`uncaught on the page: ${error.message}`));
    try {
      await other.setViewportSize({ width, height: 800 });
      await openStory(other, story, failures);
      if (!failures.length) failures.push(...(await checkDialogLayout(other)));
      layout[width] = failures;
    } finally {
      await other.close();
    }
  }
  return layout;
}

function describe(payload) {
  if (!payload) return '(no detail)';
  if (typeof payload === 'string') return payload;
  const error = payload.error ?? payload;
  // A matcher's message says what it expected and received on the lines after its first.
  const lines = (error?.message ?? JSON.stringify(payload))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ');
  return lines.length > 600 ? `${lines.slice(0, 600)}…` : lines;
}

await main();
