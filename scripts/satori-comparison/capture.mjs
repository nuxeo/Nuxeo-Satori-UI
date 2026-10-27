#!/usr/bin/env node
/**
 * Render every `nxs-` component without and with Satori, from the same story, side by side.
 *
 * Reads the sections of `docs/satori-components/with-and-without-satori.md` (through the check,
 * so a page CI would reject is refused here too) and, for each:
 *
 *   - without Satori: the story in `satori-components`' default Storybook — Material theme, only
 *     `provideNxsComponents()`;
 *   - with Satori: for a component Satori replaces, the section's second story, in
 *     `satori-components-satori`'s Storybook — Satori theme, `provideNxsSatoriComponents()` and
 *     Satori's translations; for every other component, the same story in `satori-components`'
 *     `:satori` Storybook, which swaps only the theme.
 *
 * Each pair is cropped to the component (and any overlay it opens), checked, and composed into
 * `<name>-side-by-side.png` by screenshotting an HTML page with Playwright — no image library.
 * The three Storybooks are built into a temporary directory and served on the first free port
 * from 6008, never 6006 or 6007; the server and the directory are this process's and go with it.
 *
 * Output goes outside the repository, to `$AGENTIC_UI_EVIDENCE_DIR/satori-comparison/` by default:
 * the images are published to Confluence, never committed. Exit 0 when every check passed, 1 when
 * one failed, 2 when a precondition is missing.
 *
 * Usage:
 *   npm run docs:satori-comparison:capture
 *   npm run docs:satori-comparison:capture -- --out <dir>
 *   npm run docs:satori-comparison:capture -- --keep               # keep the built Storybooks
 *   npm run docs:satori-comparison:capture -- --storybooks <dir>   # reuse a kept build
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, Socket } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';
import { captureInputs } from './sources.mjs';
import {
  FULL_IMAGES,
  FULL_STORIES,
  ROOT,
  loadComparison,
  satoriElementSelector,
} from '../beta-harness/satori-comparison-doc.mjs';

const EXIT_FAIL = 1;
const EXIT_PRECONDITION = 2;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const OUT = resolve(option('out') ?? join(EVIDENCE_ROOT, 'satori-comparison'));
const REUSE = option('storybooks') ? resolve(option('storybooks')) : null;
const KEEP = flag('keep');

/** The two libraries' `storybook` dev-server ports. Never probed, never bound. */
const RESERVED_PORTS = new Set([6006, 6007]);
const FIRST_PORT = 6008;

/** The three static Storybooks, by the directory each is served from. */
const STORYBOOKS = {
  without: { target: 'satori-components:build-storybook', label: 'Material theme' },
  'with-theme': { target: 'satori-components:build-storybook:satori', label: 'Satori theme' },
  'with-satori': {
    target: 'satori-components-satori:build-storybook',
    label: 'Satori theme and registration',
  },
};

function precondition(message) {
  console.error(`\nsatori-comparison capture: ${message}\n`);
  process.exit(EXIT_PRECONDITION);
}

/* ---------------------------------------------------------------------- preconditions ---- */

const rel = relative(ROOT, OUT);
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  precondition(`--out ${OUT} is inside the repository; the images are never committed.`);
}
if (!existsSync(join(ROOT, 'node_modules/@hylandsoftware/satori-ui/package.json'))) {
  precondition(
    '@hylandsoftware/satori-ui is not installed. The "with Satori" half needs it, and it comes ' +
      'from GitHub Packages: set SATORI_GH_READONLY_TOKEN and run `npm ci`.',
  );
}
let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  precondition(
    'Playwright is required but is not installed. It is intentionally not a tracked dependency:\n' +
      '  npm install --no-save @playwright/test @axe-core/playwright\n' +
      '  npx playwright install chromium',
  );
}
let comparison;
try {
  comparison = loadComparison(ROOT);
} catch (error) {
  precondition(error.message);
}
const { components } = comparison;

/** Written beside a build, so that reusing it records what it was built from. */
const KEPT_INPUTS = 'inputs.json';
function keptInputs(dir) {
  const file = join(dir, KEPT_INPUTS);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { digest: null, files: 0 };
}
// Taken before the builds, so it describes what was built rather than what is on disk afterwards.
// A reused build is described by what it recorded, so publish refuses it once anything has changed.
const inputs = REUSE ? keptInputs(REUSE) : captureInputs(ROOT, components);
if (REUSE && inputs.digest !== captureInputs(ROOT, components).digest) {
  console.log(`  note   ${REUSE} predates the current sources; publish will refuse this capture`);
}

/* ------------------------------------------------------------- cleanup of what we own ---- */

const owned = { server: null, browser: null, dir: null };
async function cleanup() {
  await owned.browser
    ?.close()
    .catch((error) => console.error(`  could not close the browser: ${error.message}`));
  owned.browser = null;
  await new Promise((done) => (owned.server ? owned.server.close(() => done()) : done()));
  owned.server = null;
  if (owned.dir && !KEEP) rmSync(owned.dir, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup().finally(() => process.exit(130));
  });
}

/* ------------------------------------------------------------------------- Storybooks ---- */

function buildStorybooks() {
  const dir = mkdtempSync(join(tmpdir(), 'nxs-satori-comparison-'));
  owned.dir = dir;
  mkdirSync(OUT, { recursive: true });
  for (const [name, { target, label }] of Object.entries(STORYBOOKS)) {
    const started = Date.now();
    process.stdout.write(`  build  ${name.padEnd(12)} ${target} (${label}) … `);
    const log = join(OUT, `build-${name}.log`);
    const res = spawnSync(
      'npx',
      ['nx', 'run', target, `--outputDir=${join(dir, name)}`, '--skip-nx-cache'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, NX_DAEMON: 'false' },
        maxBuffer: 1 << 28,
      },
    );
    writeFileSync(log, `${res.stdout ?? ''}\n${res.stderr ?? ''}`);
    if (res.status !== 0) {
      console.log('FAILED');
      console.error(`${(res.stdout ?? '').split('\n').slice(-30).join('\n')}\n  full log: ${log}`);
      throw new Error(`build of ${target} failed`);
    }
    console.log(`${Math.round((Date.now() - started) / 1000)}s`);
  }
  writeFileSync(join(dir, KEPT_INPUTS), JSON.stringify(inputs));
  return dir;
}

function storyIndex(dir, name) {
  const file = join(dir, name, 'index.json');
  if (!existsSync(file))
    throw new Error(`${file} is missing; is ${dir} a kept --storybooks build?`);
  const entries = Object.values(JSON.parse(readFileSync(file, 'utf8')).entries ?? {});
  return new Set(entries.filter((e) => e.type === 'story').map((e) => e.id));
}

/* ----------------------------------------------------------------- static file server ---- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** Is anything already answering on `port`, over IPv4 or IPv6? */
function answering(port, host) {
  return new Promise((done) => {
    const socket = new Socket();
    const finish = (yes) => {
      socket.destroy();
      done(yes);
    };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function freePort() {
  for (let port = FIRST_PORT; port < FIRST_PORT + 100; port += 1) {
    if (RESERVED_PORTS.has(port)) continue;
    if ((await answering(port, '127.0.0.1')) || (await answering(port, '::1'))) continue;
    const ok = await new Promise((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (ok) return port;
  }
  throw new Error(`no free port in ${FIRST_PORT}-${FIRST_PORT + 99}`);
}

async function serve(dir) {
  const port = await freePort();
  const root = resolve(dir);
  const server = createHttpServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  owned.server = server;
  return `http://127.0.0.1:${port}`;
}

/* ---------------------------------------------------------------------------- capture ---- */

/** Translation-key-shaped text: a raw `sat.*`, `satori-components.*` or `browse.*` key. */
const RAW_KEY = /\b(?:sat|satori-components|browse)\.[a-z][\w-]*(?:\.[\w-]+)+/i;

/**
 * Load a story and let it settle. Reports page errors, and whether the Material Icons font loaded:
 * without it every ligature icon renders as its name, and the images would compare words.
 */
async function open(page, url, selector) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const iconFont = await page
    .waitForFunction(() => document.fonts.check('24px "Material Icons"'), null, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  // `sat-breadcrumbs` measures through a ResizeObserver debounced by 100 ms.
  await page.waitForTimeout(800);
  await page.mouse.move(1, 1);
  await freeze(page);
  return { errors, iconFont };
}

const isOpen = (page, selector) =>
  page.evaluate((sel) => {
    const pane = document.querySelector('.cdk-overlay-pane');
    if (pane && pane.getBoundingClientRect().height > 0) return true;
    return [...document.querySelectorAll(sel)].some((el) =>
      el.querySelector('[aria-expanded="true"]'),
    );
  }, selector);

/** Tab from the top of the document into the component, then Enter if focus alone did not open it. */
async function openFromKeyboard(page, selector) {
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)].some((el) => el.contains(document.activeElement)),
      selector,
    );
    if (inside) break;
  }
  await page.waitForTimeout(700);
  if (!(await isOpen(page, selector))) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }
  return isOpen(page, selector);
}

/** What the rendering shows, measured in the page: crop box, Satori elements, theme, raw keys. */
function inspect(page, selector) {
  return page.evaluate(
    ({ sel, rawKey }) => {
      const targets = [...document.querySelectorAll(sel)];
      const boxes = [];
      const visible = (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      // A box covering the whole viewport is a backdrop, not the component; one of a pixel or
      // less is screen-reader-only text such as `cdk-visually-hidden`, wherever it sits.
      const backdrop = (r) => r.width >= innerWidth - 1 && r.height >= innerHeight - 1;
      const hiddenText = (r) => r.width <= 1 || r.height <= 1;
      const collect = (el) => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        if (!hiddenText(r) && !backdrop(r)) boxes.push(r);
        for (const child of el.children) collect(child);
      };
      targets.forEach(collect);
      // An overlay pane is sized for its largest position, so only what it holds counts.
      const panes = [...document.querySelectorAll('.cdk-overlay-pane')];
      for (const pane of panes) for (const child of pane.children) collect(child);
      let text = '';
      for (const el of [...targets, ...panes]) {
        text += ` ${el.innerText ?? ''}`;
        for (const node of el.querySelectorAll('*')) {
          for (const a of ['aria-label', 'title', 'alt']) text += ` ${node.getAttribute(a) ?? ''}`;
          const described = node.getAttribute('aria-describedby');
          if (described) text += ` ${document.getElementById(described)?.textContent ?? ''}`;
        }
      }
      const satTags = (els) =>
        els.flatMap((el) => [...el.querySelectorAll('*')].map((n) => n.tagName.toLowerCase()));
      const satInside = satTags([...targets, ...panes]).filter((t) => t.startsWith('sat-'));
      const satElements = [
        ...document.querySelectorAll('#storybook-root *, .cdk-overlay-container *'),
      ]
        .map((el) => el.tagName.toLowerCase())
        .filter((t) => t.startsWith('sat-'));
      return {
        count: targets.length,
        box: boxes.length
          ? {
              x: Math.min(...boxes.map((b) => b.left)),
              y: Math.min(...boxes.map((b) => b.top)),
              right: Math.max(...boxes.map((b) => b.right)),
              bottom: Math.max(...boxes.map((b) => b.bottom)),
            }
          : null,
        satElements: [...new Set(satElements)],
        satInside: [...new Set(satInside)],
        icons: [...targets, ...panes]
          .flatMap((el) => [...el.querySelectorAll('mat-icon, .material-icons')])
          .filter(
            (i) => !i.querySelector('svg') && /Material Icons/.test(getComputedStyle(i).fontFamily),
          ).length,
        nxsSatoriHosts: [...document.querySelectorAll('*')].filter((el) =>
          el.tagName.toLowerCase().startsWith('nxs-satori-'),
        ).length,
        primary: getComputedStyle(document.documentElement)
          .getPropertyValue('--mat-sys-primary')
          .trim(),
        rawKeys: [...new Set(text.match(new RegExp(rawKey, 'gi')) ?? [])],
      };
    },
    { sel: selector, rawKey: RAW_KEY.source },
  );
}

/** Hide everything in the story that is neither the component, inside it, nor around it. */
function isolate(page, selector) {
  return page.evaluate((sel) => {
    const targets = [...document.querySelectorAll(sel)];
    for (const el of document.querySelectorAll('#storybook-root *')) {
      if (targets.some((t) => t === el || t.contains(el) || el.contains(t))) continue;
      el.style.visibility = 'hidden';
    }
  }, selector);
}

/**
 * Animations are stopped for every screenshot — an endless one at its first frame, a finite one at
 * its last — so the same sources give the same bytes, and `publish --verify` can compare them.
 * Playwright's `animations: 'disabled'` does not hold Material's indeterminate spinner still, so
 * anything with `role="progressbar"` loses its animation outright, as soon as the story loads:
 * its rotating parts would otherwise give a different crop box each time it is measured.
 */
async function freeze(page) {
  await page.addStyleTag({
    content:
      '[role="progressbar"], [role="progressbar"] * { animation: none !important; transition: none !important; }',
  });
}

async function crop(page, box, file) {
  const pad = 16;
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const clip = {
    x,
    y,
    width: Math.min(vp.width - x, Math.ceil(box.right - box.x + pad * 2)),
    height: Math.min(vp.height - y, Math.ceil(box.bottom - box.y + pad * 2)),
  };
  await page.screenshot({ path: file, clip, animations: 'disabled' });
  return clip;
}

/* ---------------------------------------------------------------------------- compose ---- */

const escHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** A PNG's pixel width, from its IHDR chunk. */
const pngWidth = (file) => readFileSync(file).readUInt32BE(16);

/** Widest a half may be drawn, in pixels; both halves shrink by the same factor to fit. */
const MAX_HALF_WIDTH = 1400;

/**
 * Two PNGs side by side with their labels, screenshotted as one image.
 *
 * Both halves are drawn at one scale, so a wider rendering is not shrunk into looking smaller
 * than its counterpart.
 */
async function compose(browser, { title, subtitle, left, right, footnote }, file) {
  const scale = Math.min(1, MAX_HALF_WIDTH / Math.max(pngWidth(left.png), pngWidth(right.png)));
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
  });
  const cell = ({ heading, sub, png }) => `
    <section class="${heading.startsWith('Without') ? 'left' : 'right'}">
      <h2>${escHtml(heading)}</h2>
      <p class="sub">${escHtml(sub)}</p>
      <div class="cell"><img width="${Math.round(pngWidth(png) * scale)}" src="data:image/png;base64,${readFileSync(png).toString('base64')}" /></div>
    </section>`;
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1e1e22; background: #fff; }
    .sheet { display: inline-block; padding: 24px 28px 20px; }
    h1 { font-size: 30px; margin: 0 0 4px; }
    .lede { margin: 0 0 18px; color: #5f626c; font-size: 18px; }
    .row { display: flex; gap: 24px; align-items: stretch; }
    section { border-top: 4px solid; padding-top: 10px; display: flex; flex-direction: column; }
    section.left { border-color: #005cbb; } section.right { border-color: #5654ac; }
    h2 { font-size: 24px; margin: 0; } .left h2 { color: #005cbb; } .right h2 { color: #5654ac; }
    .sub { margin: 2px 0 10px; color: #5f626c; font-size: 17px; }
    .cell { flex: 1; background: #f6f6f8; display: flex; align-items: center; justify-content: center; min-width: 420px; min-height: 120px; padding: 16px; }
    img { display: block; height: auto; }
    .foot { margin: 14px 0 0; color: #5f626c; font-size: 16px; }
  </style></head><body><div class="sheet">
    <h1>${escHtml(title)}</h1>
    <p class="lede">${escHtml(subtitle)}</p>
    <div class="row">${cell(left)}${cell(right)}</div>
    ${footnote ? `<p class="foot">${escHtml(footnote)}</p>` : ''}
  </div></body></html>`);
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.locator('.sheet').screenshot({ path: file });
  await page.close();
}

/* ------------------------------------------------------------------------------- main ---- */

const checks = [];
const record = (subject, name, pass, detail, kind = 'load-bearing') => {
  checks.push({ subject, name, pass: Boolean(pass), detail, kind });
  if (!pass) console.log(`         FAIL ${subject}: ${name}${detail ? ` — ${detail}` : ''}`);
};

let exitCode = 0;
try {
  console.log(`satori-comparison capture: ${components.length} component(s) → ${OUT}`);
  // Otherwise a run that stops before writing its own would leave the last run's manifest
  // vouching for whatever images this one had already overwritten.
  rmSync(join(OUT, 'manifest.json'), { force: true });
  const dir = REUSE ?? buildStorybooks();
  mkdirSync(join(OUT, 'raw'), { recursive: true });
  const indexes = Object.fromEntries(Object.keys(STORYBOOKS).map((n) => [n, storyIndex(dir, n)]));
  const base = await serve(dir);
  console.log(`  serve  ${dir} on ${base}${KEEP ? ' (kept)' : ''}`);

  owned.browser = await chromium.launch();
  const browser = owned.browser;
  const results = [];

  for (const c of components) {
    const slug = c.image.replace(/-side-by-side\.png$/, '');
    const halves = {
      without: { book: 'without', story: c.story, selector: c.selector },
      with: c.own
        ? { book: 'with-satori', story: c.satoriStory, selector: c.satoriSelector }
        : { book: 'with-theme', story: c.story, selector: c.selector },
    };
    const shot = {};
    for (const [side, h] of Object.entries(halves)) {
      const subject = `${c.heading} (${side})`;
      if (!indexes[h.book].has(h.story)) {
        record(subject, `story ${h.story} is in the ${h.book} Storybook`, false);
        continue;
      }
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      const url = `${base}/${h.book}/iframe.html?id=${h.story}&viewMode=story`;
      try {
        const { errors, iconFont } = await open(page, url, h.selector);
        let opened = null;
        if (c.captured === 'Opened from the keyboard')
          opened = await openFromKeyboard(page, h.selector);
        const seen = await inspect(page, h.selector);
        await isolate(page, h.selector);
        const file = join(OUT, 'raw', `${slug}-${side}.png`);
        const clip = seen.box ? await crop(page, seen.box, file) : null;
        shot[side] = { file, clip, url, seen };

        record(
          subject,
          `<${h.selector}> rendered`,
          seen.count > 0 && clip,
          `${seen.count} element(s)`,
        );
        record(subject, 'no page errors', errors.length === 0, errors.join(' | '));
        // The font loads only when something uses it, so it is asked of components with icons.
        if (seen.icons > 0) {
          record(subject, `its ${seen.icons} icon(s) render in the Material Icons font`, iconFont);
        }
        record(
          subject,
          'no raw translation keys visible or announced',
          seen.rawKeys.length === 0,
          seen.rawKeys.join(', '),
        );
        if (opened !== null) record(subject, 'opened from the keyboard', opened);
        if (side === 'without') {
          record(
            subject,
            'no Satori element rendered',
            seen.satElements.length === 0,
            seen.satElements.join(', '),
            'negative',
          );
        } else if (c.own) {
          // The element the section documents, not any `sat-*`: a wrapper rendering something else
          // would otherwise pass a check named after Satori's component. By selector, so an element
          // a Satori component is applied to by attribute — `<button satActionBarButton>` — counts.
          const inside = await page.evaluate(
            ([host, element]) =>
              [...document.querySelectorAll(host)].some((t) => t.querySelector(element)),
            [h.selector, satoriElementSelector(c.satElement)],
          );
          record(
            subject,
            `Satori's <${c.satElement}> inside <${h.selector}>`,
            inside,
            seen.satInside.length ? `rendered: ${seen.satInside.join(', ')}` : 'no sat-* element',
          );
        }
      } catch (error) {
        record(subject, 'captured', false, error.message.split('\n')[0]);
      } finally {
        await ctx.close();
      }
    }
    if (shot.without && shot.with && !c.own) {
      record(
        c.heading,
        'the Satori theme is applied (--mat-sys-primary differs)',
        shot.without.seen.primary && shot.without.seen.primary !== shot.with.seen.primary,
        `${shot.without.seen.primary} → ${shot.with.seen.primary}`,
      );
    }
    if (shot.without?.clip && shot.with?.clip) {
      const out = join(OUT, c.image);
      await compose(
        browser,
        {
          title: `${c.heading}${c.registeredId ? ` — ${c.registeredId}` : ''}`,
          subtitle: c.own
            ? `<${c.selector}> without Satori, Satori's <${c.satoriSelector}> with it. Same inputs.`
            : `The same <${c.selector}> under each theme. Same inputs.`,
          left: {
            heading: 'Without Satori access',
            sub: 'provideNxsComponents() only · Angular Material theme',
            png: shot.without.file,
          },
          right: {
            heading: 'With Satori access',
            sub: c.own
              ? '+ provideNxsSatoriComponents() + provideSatori() · Satori theme'
              : 'Same component · Satori theme',
            png: shot.with.file,
          },
          footnote:
            `Storybook story ${c.story}${c.own ? ` / ${c.satoriStory}` : ''}` +
            (c.captured === 'As rendered' ? '' : ` · ${c.captured.toLowerCase()}`) +
            ' · close-ups at 2x device pixel ratio',
        },
        out,
      );
      results.push({
        component: c.component,
        heading: c.heading,
        image: c.image,
        without: shot.without.url,
        with: shot.with.url,
      });
      console.log(`  ok     ${c.image}`);
    }
  }

  // The "Primitives/By registered ID" story in both Storybooks: the whole viewport, as it renders,
  // and a close-up of every primitive together for the side-by-side.
  const full = {};
  // One host per `NXS_PRIMITIVE_IDS` entry, in the story's order; the story renders each ID once.
  const PRIMITIVE_HOSTS = {
    without: [
      'nxs-avatar',
      'nxs-breadcrumbs',
      'nxs-tag',
      'nxs-status-tag',
      'nxs-rich-tooltip',
      'nxs-error-state',
      'nxs-tabs',
      'nxs-document-toolbar',
    ],
    with: [
      'nxs-satori-avatar',
      'nxs-satori-breadcrumbs',
      'nxs-satori-tag',
      'nxs-satori-status-tag',
      'nxs-satori-rich-tooltip',
      'nxs-satori-error-state',
      'nxs-satori-tabs',
      'nxs-satori-action-bar',
    ],
  };
  const primitiveCount = PRIMITIVE_HOSTS.with.length;
  for (const [side, book] of [
    ['without', 'without'],
    ['with', 'with-satori'],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const url = `${base}/${book}/iframe.html?id=${FULL_STORIES[side]}&viewMode=story`;
    const host = side === 'without' ? 'nxs-avatar' : 'nxs-satori-avatar';
    try {
      const { errors } = await open(page, url, host);
      const seen = await inspect(page, host);
      await page.screenshot({ path: join(OUT, FULL_IMAGES[side]), animations: 'disabled' });
      const close = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      try {
        const zoomed = await close.newPage();
        await open(zoomed, url, host);
        const all = await inspect(zoomed, PRIMITIVE_HOSTS[side].join(', '));
        full[side] = join(OUT, 'raw', `full-${side}.png`);
        await crop(zoomed, all.box, full[side]);
      } finally {
        await close.close();
      }
      record(
        `Full screenshot (${side})`,
        'no page errors',
        errors.length === 0,
        errors.join(' | '),
      );
      if (side === 'without') {
        record(
          `Full screenshot (${side})`,
          'no Satori element rendered',
          seen.satElements.length === 0,
          seen.satElements.join(', '),
          'negative',
        );
      } else {
        record(
          `Full screenshot (${side})`,
          `all ${primitiveCount} IDs resolve to Satori wrappers`,
          seen.nxsSatoriHosts === primitiveCount,
          `${seen.nxsSatoriHosts} nxs-satori-* host(s)`,
        );
      }
    } finally {
      await ctx.close();
    }
  }
  if (full.without && full.with) {
    await compose(
      browser,
      {
        title: `All ${primitiveCount} primitives, by registered ID`,
        subtitle:
          'The "Primitives/By registered ID" story: one template, the same inputs. Close-ups at 2x device pixel ratio.',
        left: {
          heading: 'Without Satori access',
          sub: 'provideNxsComponents() only · Angular Material theme',
          png: full.without,
        },
        right: {
          heading: 'With Satori access',
          sub: '+ provideNxsSatoriComponents() + provideSatori() · Satori theme',
          png: full.with,
        },
      },
      join(OUT, FULL_IMAGES.sideBySide),
    );
    console.log(`  ok     ${FULL_IMAGES.sideBySide}`);
  }

  for (const name of [...components.map((c) => c.image), ...Object.values(FULL_IMAGES)]) {
    record(name, 'written', existsSync(join(OUT, name)));
  }

  const failed = checks.filter((c) => !c.pass);
  const manifest = {
    capturedAt: new Date().toISOString(),
    browser: browser.version(),
    storybooks: REUSE ? `${REUSE} (reused)` : KEEP ? dir : '(temporary, removed)',
    served: base,
    inputs,
    // Each image's sha256, so publish can tell a file replaced after this run from what it wrote.
    images: Object.fromEntries(
      [...components.map((c) => c.image), ...Object.values(FULL_IMAGES)]
        .filter((name) => existsSync(join(OUT, name)))
        .map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(join(OUT, name)))
            .digest('hex'),
        ]),
    ),
    components: results,
    checks,
    summary: {
      total: checks.length,
      failed: failed.length,
      loadBearing: checks.filter((c) => c.kind === 'load-bearing').length,
      negative: checks.filter((c) => c.kind === 'negative').length,
    },
  };
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(OUT, 'INDEX.md'),
    [
      '# Satori comparison capture',
      '',
      `Captured ${manifest.capturedAt} with Chromium ${manifest.browser}. ` +
        `${checks.length} checks (${manifest.summary.loadBearing} load-bearing, ` +
        `${manifest.summary.negative} negative), ${failed.length} failed.`,
      '',
      ...components.flatMap((c) => [`## ${c.heading}`, '', `![${c.heading}](${c.image})`, '']),
      '## Full screenshots',
      '',
      `![All ${primitiveCount} primitives](${FULL_IMAGES.sideBySide})`,
      '',
      '## Checks',
      '',
      '| Subject | Check | Kind | Result |',
      '| --- | --- | --- | --- |',
      ...checks.map(
        (c) =>
          `| ${c.subject} | ${c.name} | ${c.kind} | ${c.pass ? 'pass' : `FAIL ${c.detail ?? ''}`} |`,
      ),
      '',
    ].join('\n'),
  );
  console.log(
    `\nsatori-comparison capture: ${failed.length ? 'FAIL' : 'pass'} — ${checks.length} check(s), ` +
      `${failed.length} failed (${manifest.summary.loadBearing} load-bearing, ${manifest.summary.negative} negative)\n` +
      `  ${join(OUT, 'INDEX.md')}` +
      (KEEP && !REUSE ? `\n  Storybooks kept in ${dir}; reuse with --storybooks ${dir}` : ''),
  );
  if (failed.length) exitCode = EXIT_FAIL;
} catch (error) {
  console.error(`\nsatori-comparison capture: ${error.message}`);
  exitCode = EXIT_FAIL;
} finally {
  await cleanup();
}
process.exit(exitCode);
