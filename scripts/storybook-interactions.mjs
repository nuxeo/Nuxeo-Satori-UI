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
 * and are refused, so the job never depends on the token.
 *
 * Needs `@playwright/test` and Chromium, which CI installs with `--no-save`:
 *   npm install --no-save @playwright/test@<a11y/versions.mjs> && npx playwright install chromium
 *
 * Usage:
 *   node scripts/storybook-interactions.mjs [--dir dist/storybook/satori-components]
 *     [--port 6231] [--story-timeout 20000] [--budget 600000] [--only <id-part>] [--json <file>]
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
const budget = Number(option('--budget', '600000'));
const only = option('--only', null);
const jsonOut = option('--json', null);

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
const RAW_KEY = /\b(?:satori-components|shared-ui)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/;

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
  if (/satori-components-satori|satori-theme/.test(dir)) {
    refuse(
      `${dir} is a Satori Storybook, which needs @hylandsoftware/satori-ui and a GitHub Packages ` +
        'token. This runner covers the token-free build only.',
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
  try {
    const events = await openStory(page, story, failures);
    const finished = events.find((event) => event.name === 'storyFinished');
    const a11y = (finished?.payload?.reporters ?? [])
      .filter((reporter) => reporter?.type === 'a11y')
      .reduce((count, reporter) => count + (reporter?.result?.violations?.length ?? 0), 0);
    if (!failures.length) {
      const text = await page.evaluate(() => document.body.innerText);
      const raw = RAW_KEY.exec(text);
      if (raw) failures.push(`an untranslated key is on screen: ${raw[0]}`);
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
