#!/usr/bin/env node

/**
 * Export the Beta infographic decks as PowerPoint files.
 *
 * ## What this is and is not
 *
 * The decks live as JSON and are drawn by `deck.html` in a browser, because the
 * marks, the type scale and the validated palette are CSS. PowerPoint cannot
 * reproduce any of that, so this does not try to rebuild the slides as native
 * PowerPoint shapes. It photographs each rendered slide at 2x and lays the image
 * full-bleed on a 16:9 page. The text you can select in the result is therefore
 * only the **speaker notes** — and those are read from the deck JSON, not scraped
 * back out of the DOM, so they say exactly what the deck author wrote.
 *
 * That trade is deliberate: a slide that looks identical to the screencast, plus
 * notes to present from, beats an approximate but editable rebuild.
 *
 * ## Output goes outside the repository
 *
 * A full-bleed 2x deck is megabytes of PNG. Files land in
 * `$AGENTIC_UI_EVIDENCE_DIR/beta/slides`, outside the working tree, for the same
 * reason the phase evidence does: they must not travel with a clone.
 *
 * ## Dependencies resolve from a sidecar, on purpose
 *
 * `pptxgenjs` is not a repo dependency and must not enter `package-lock.json`.
 * A `--no-save` install is pruned the moment any other `npm install` runs, so
 * this resolves it from `<tmpdir>/satori-pptx-deps` instead and installs it there
 * on first use. Nothing here writes to the repo's `node_modules` or lockfile.
 *
 * Usage:
 *   node tools/video/export-pptx.mjs                 # all three decks + combined
 *   node tools/video/export-pptx.mjs 01-provenance    # one deck (no combined file)
 */

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { packageCommand, spawnTool } from '../../scripts/beta-harness/package-command.mjs';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = resolve(import.meta.dirname);
const EVIDENCE_ROOT =
  process.env['AGENTIC_UI_EVIDENCE_DIR'] ?? join(homedir(), 'Desktop', 'agentic-ui-evidence');
const OUT_DIR = join(EVIDENCE_ROOT, 'beta', 'slides');

/** The deck CSS is written against exactly this viewport. */
const VIEWPORT = { width: 1920, height: 1080 };

/** 2x, so a slide PNG is 3840x2160 and survives a projector. */
const SCALE = 2;

/** Not the recorder's 4410/4411 — the two harnesses may be running at once. */
const PORT = 4412;

/** Let the slide settle before the shutter. Transitions in deck.css are sub-300ms. */
const SETTLE_MS = 400;

const DECKS = ['01-provenance', '02-customize', '03-mock-customer'];
const COMBINED = 'nuxeo-satori-beta';

/** A .pptx of full-bleed 2x images cannot plausibly be smaller than this. */
const MIN_PLAUSIBLE_BYTES = 200 * 1024;

function fail(message) {
  console.error(`\nexport-pptx: FAIL\n\n${message}\n`);
  process.exit(1);
}

/**
 * Resolve pptxgenjs without touching the repo's dependency tree.
 * Repo `node_modules` first (a `--no-save` install, if it survived), then the
 * sidecar, installing into the sidecar if it is not there yet.
 */
async function loadPptxGenJs() {
  try {
    return (await import('pptxgenjs')).default;
  } catch {
    /* fall through to the sidecar */
  }

  const sidecar = join(tmpdir(), 'satori-pptx-deps');
  const entry = join(sidecar, 'node_modules', 'pptxgenjs', 'dist', 'pptxgen.es.js');
  try {
    return (await import(entry)).default;
  } catch {
    /* not installed there yet */
  }

  console.log(`  installing pptxgenjs into ${sidecar}`);
  mkdirSync(sidecar, { recursive: true });
  const tool = packageCommand(
    'npm',
    ['install', '--no-audit', '--no-fund', '--loglevel=error', 'pptxgenjs@4'],
    { cwd: sidecar },
  );
  await execFileAsync(tool.command, tool.args, { cwd: sidecar });
  try {
    return (await import(entry)).default;
  } catch (error) {
    fail(`Could not load pptxgenjs.\n\n  ${error.message}`);
  }
}

/** Serve a directory statically, and resolve only once it actually answers. */
async function serve(dir, port) {
  const child = spawnTool('npx', ['--yes', 'http-server', dir, '-p', String(port), '-s', '-c-1'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 302) return { url, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
  }
  child.kill();
  throw new Error(`${dir} did not start serving on ${port}`);
}

/** Deck copy allows `**bold**` and `` `code` ``. Notes are plain text. */
const plain = (s) =>
  String(s)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();

/**
 * Speaker notes for one slide, from the JSON.
 *
 * The lede is the claim and the footnote is the evidence for it, so a presenter
 * needs both; the title is already on screen and is not repeated.
 */
function notesFor(slide) {
  return [slide.lede, slide.footnote].filter(Boolean).map(plain).join('\n\n');
}

/**
 * Alt text for the slide image.
 *
 * Every slide in these decks is a single picture, so without this a screen reader
 * gets nothing. pptxgenjs otherwise defaults the description to the source file
 * path, which is both useless and a leak of a local temp directory.
 */
function altFor(slide) {
  return [slide.eyebrow, slide.title].filter(Boolean).map(plain).join(' — ') || 'Slide';
}

const readDeck = async (name) =>
  JSON.parse(await readFile(join(VIDEO_DIR, 'decks', `${name}.json`), 'utf8'));

/**
 * Photograph every slide of a deck.
 * Returns one entry per slide, in order, each with its PNG path and notes.
 */
async function shootDeck(page, deckUrl, name, deck, frameDir) {
  await page.goto(`${deckUrl}/deck.html?deck=${name}`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
  // A FontFaceSet cannot cross the bridge, so resolve it to a boolean.
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const count = await page.evaluate(() => window.deck.count);
  if (count !== deck.slides.length) {
    throw new Error(
      `${name}: renderer reports ${count} slides, JSON has ${deck.slides.length}. ` +
        `The notes would be attached to the wrong slides.`,
    );
  }

  const frames = [];
  for (let i = 0; i < count; i += 1) {
    await page.evaluate((n) => window.deck.show(n), i);
    await page.waitForTimeout(SETTLE_MS);
    const png = join(frameDir, `${name}-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: png });
    frames.push({ png, notes: notesFor(deck.slides[i]), alt: altFor(deck.slides[i]) });
  }
  return frames;
}

/**
 * Write a .pptx from already-captured frames.
 *
 * `sections` is a list of `{ title, frames }`. More than one gets a PowerPoint
 * section per deck; a single one is written flat, since a lone section is noise.
 */
async function writePptx(PptxGenJS, file, title, sections) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333in x 7.5in — 16:9 exactly
  pptx.title = title;
  pptx.subject = 'Nuxeo Satori Beta';
  pptx.author = 'Nuxeo Satori';

  const W = pptx.presLayout.width / 914400;
  const H = pptx.presLayout.height / 914400;

  const useSections = sections.length > 1;
  let added = 0;

  for (const section of sections) {
    if (useSections) pptx.addSection({ title: section.title });
    for (const frame of section.frames) {
      const slide = pptx.addSlide(useSections ? { sectionTitle: section.title } : undefined);
      slide.background = { color: '0E1116' }; // matches the deck plane, so no white hairline
      slide.addImage({ path: frame.png, x: 0, y: 0, w: W, h: H, altText: frame.alt });
      if (frame.notes) slide.addNotes(frame.notes);
      added += 1;
    }
  }

  const expected = sections.reduce((n, s) => n + s.frames.length, 0);
  if (added !== expected) throw new Error(`${file}: added ${added} slides, expected ${expected}`);

  await pptx.writeFile({ fileName: file });
  return added;
}

/**
 * Verify the written file, not the intent.
 *
 * Counts `ppt/slides/slideN.xml` and `ppt/media/*` entries inside the actual zip
 * and checks the size is plausible. A .pptx that is valid XML but has no slides
 * is exactly the failure mode a size check alone would miss.
 */
async function verify(file, expectedSlides) {
  const { size } = statSync(file);
  const problems = [];
  if (size < MIN_PLAUSIBLE_BYTES) {
    problems.push(`only ${size} bytes — full-bleed 2x images cannot be this small`);
  }

  let slides = null;
  let media = null;
  try {
    const { stdout } = await execFileAsync('unzip', ['-l', file], { maxBuffer: 8 * 1024 * 1024 });
    const entries = stdout.split('\n');
    slides = entries.filter((l) => /\sppt\/slides\/slide\d+\.xml\s*$/.test(l)).length;
    media = entries.filter((l) => /\sppt\/media\/\S+\s*$/.test(l)).length;
    const notes = entries.filter((l) =>
      /\sppt\/notesSlides\/notesSlide\d+\.xml\s*$/.test(l),
    ).length;
    if (slides !== expectedSlides) {
      problems.push(`zip contains ${slides} slide parts, expected ${expectedSlides}`);
    }
    if (media < expectedSlides) {
      problems.push(`zip contains ${media} media files, expected at least ${expectedSlides}`);
    }
    // pptxgenjs emits a notes part per slide whether or not it carries text, so
    // this number is not the count of slides that actually have speaker notes —
    // that is the "with speaker notes" figure logged at capture time.
    console.log(
      `    verified: ${slides} slide parts, ${media} media files, ` +
        `${notes} notes parts (one per slide, text or not), ` +
        `${(size / 1_048_576).toFixed(2)} MB`,
    );
  } catch (error) {
    // Not a pass. An unverified file is reported as unverified.
    console.warn(`    [warn] could not read the zip (${error.message}) — slide count UNVERIFIED`);
  }

  if (problems.length > 0) throw new Error(`${file}\n    - ${problems.join('\n    - ')}`);
  return { size, slides, media };
}

// ------------------------------------------------------------------ main ----

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = args.length > 0 ? args : DECKS;
for (const name of wanted) {
  if (!DECKS.includes(name)) fail(`Unknown deck "${name}". Known: ${DECKS.join(', ')}`);
}

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  fail(
    'Playwright is not installed.\n\n' +
      '  npm install --no-save @playwright/test\n  npx playwright install chromium',
  );
}
const PptxGenJS = await loadPptxGenJs();

mkdirSync(OUT_DIR, { recursive: true });
const frameDir = mkdtempSync(join(tmpdir(), 'satori-slides-'));

console.log(`\nExporting ${wanted.length} deck(s) to PowerPoint`);
console.log(`  out    ${OUT_DIR}`);
console.log(`  frames ${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE} (${SCALE}x)`);

const server = await serve(VIDEO_DIR, PORT);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  reducedMotion: 'reduce',
});
const page = await context.newPage();

const captured = [];
let failure = null;
try {
  for (const name of wanted) {
    const deck = await readDeck(name);
    console.log(`\n  ${name} — "${deck.title}"`);
    const frames = await shootDeck(page, server.url, name, deck, frameDir);
    const withNotes = frames.filter((f) => f.notes).length;
    console.log(`    captured ${frames.length} slides, ${withNotes} with speaker notes`);
    captured.push({ name, title: deck.title, frames });
  }
} catch (error) {
  failure = error;
}

await context.close();
await browser.close();
server.stop();

if (failure) {
  rmSync(frameDir, { recursive: true, force: true });
  fail(failure.message);
}

const written = [];
try {
  for (const [i, deck] of captured.entries()) {
    const file = join(OUT_DIR, `${deck.name}.pptx`);
    rmSync(file, { force: true });
    const n = await writePptx(PptxGenJS, file, deck.title, [
      { title: `${i + 1}. ${deck.title}`, frames: deck.frames },
    ]);
    console.log(`\n  wrote ${file} — ${n} slides`);
    const checked = await verify(file, deck.frames.length);
    written.push({ file, size: checked.size, slides: n });
  }

  if (captured.length > 1) {
    const file = join(OUT_DIR, `${COMBINED}.pptx`);
    rmSync(file, { force: true });
    const sections = captured.map((d, i) => ({ title: `${i + 1}. ${d.title}`, frames: d.frames }));
    const n = await writePptx(PptxGenJS, file, 'Nuxeo Satori Beta — three decks', sections);
    console.log(`\n  wrote ${file} — ${n} slides in ${sections.length} sections`);
    // Expected count comes from the captured frames, not from writePptx's own
    // return value — checking a writer against what it reports proves nothing.
    const expected = captured.reduce((total, d) => total + d.frames.length, 0);
    const checked = await verify(file, expected);
    written.push({ file, size: checked.size, slides: expected });
  }
} catch (error) {
  rmSync(frameDir, { recursive: true, force: true });
  fail(error.message);
} finally {
  rmSync(frameDir, { recursive: true, force: true });
}

console.log(`\nDone — ${written.length} file(s):`);
for (const w of written) {
  console.log(`  ${w.file}  ${(w.size / 1_048_576).toFixed(2)} MB  ${w.slides} slides`);
}
console.log(
  '\nVerified: file exists, size is plausible, and the zip holds one slide part and at\n' +
    'least one media file per captured slide. Not verified: how PowerPoint renders it.\n',
);
