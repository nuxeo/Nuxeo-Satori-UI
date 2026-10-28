#!/usr/bin/env node
import { spawnTool } from '../../scripts/beta-harness/package-command.mjs';

/**
 * Record one Beta screencast.
 *
 * ## What this is and is not
 *
 * Playwright records the browser viewport to `.webm`; ffmpeg converts to `.mp4`.
 * There is **no audio** — Playwright cannot capture any — so every claim a narrator
 * would make is on screen as a slide or a footnote instead. Read the decks as the
 * script.
 *
 * ## Output goes outside the repository
 *
 * Videos are large binaries. They land in `$AGENTIC_UI_EVIDENCE_DIR/beta/video`,
 * next to the phase evidence and outside the working tree, for the same reason the
 * evidence does: they must not travel with a clone. Nothing here writes to `dist/`
 * or to the repo.
 *
 * Usage:
 *   node tools/video/record.mjs 01-provenance
 *   node tools/video/record.mjs 02-customize
 *   node tools/video/record.mjs 03-mock-customer
 *   node tools/video/record.mjs all
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = resolve(import.meta.dirname);
const EVIDENCE_ROOT =
  process.env['AGENTIC_UI_EVIDENCE_DIR'] ?? join(homedir(), 'Desktop', 'agentic-ui-evidence');
const OUT_DIR = join(EVIDENCE_ROOT, 'beta', 'video');

/** 1080p. The deck's CSS is written against exactly this viewport. */
export const VIEWPORT = { width: 1920, height: 1080 };

/** Ports the harness owns. Chosen high to avoid the dev server and Nuxeo. */
export const DECK_PORT = 4410;
export const TEMPLATE_PORT = 4411;

const SCENES = ['01-provenance', '02-customize', '03-mock-customer'];

function fail(message) {
  console.error(`\nrecord: FAIL\n\n${message}\n`);
  process.exit(1);
}

/** Serve a directory statically, and resolve once it actually answers. */
export async function serve(dir, port) {
  const child = spawnTool('npx', ['--yes', 'http-server', dir, '-p', String(port), '-s', '-c-1'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
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

/** Hold a frame long enough to read it. Reading rate, not a guess: ~14 wpm/sec. */
export const hold = (page, ms) => page.waitForTimeout(ms);

/**
 * Step through a deck, holding each slide for a dwell time derived from how much
 * text is on it, with a floor so a sparse slide is not a flash.
 */
export async function playDeck(page, { from = 0, to = Infinity } = {}) {
  const count = await page.evaluate(() => window.deck.count);
  const last = Math.min(count - 1, to);
  for (let i = from; i <= last; i += 1) {
    await page.evaluate((n) => window.deck.show(n), i);
    const words = await page.evaluate(
      () =>
        document.querySelector('.slide[data-active="true"]')?.innerText.split(/\s+/).length ?? 0,
    );
    // ~3.6 words per second, 2.6s floor, 11s ceiling.
    const dwell = Math.min(11000, Math.max(2600, Math.round((words / 3.6) * 1000)));
    await hold(page, dwell);
  }
  return count;
}

/** Convert the recorded webm to mp4, and keep both. */
async function toMp4(webm, mp4) {
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      webm,
      // yuv420p + even dimensions, or QuickTime and Slack refuse to play it.
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '22',
      '-movflags',
      '+faststart',
      mp4,
    ]);
    return true;
  } catch (error) {
    console.warn(`  [warn] mp4 conversion failed, keeping webm only: ${error.message}`);
    return false;
  }
}

async function record(sceneName) {
  const scenePath = join(VIDEO_DIR, 'scenes', `${sceneName}.mjs`);
  if (!existsSync(scenePath)) fail(`No scene at ${scenePath}`);

  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    fail(
      'Playwright is not installed.\n\n  npm install --no-save @playwright/test\n  npx playwright install chromium',
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const raw = join(OUT_DIR, `.raw-${sceneName}`);
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });

  console.log(`\nRecording ${sceneName}`);
  console.log(`  out  ${OUT_DIR}`);

  const decks = await serve(VIDEO_DIR, DECK_PORT);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    // Matching recordVideo size to the viewport avoids Playwright letterboxing.
    recordVideo: { dir: raw, size: VIEWPORT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  const teardown = [];
  let failure = null;
  try {
    const { default: run } = await import(scenePath);
    await run({ page, deckUrl: decks.url, serve, hold, playDeck, teardown, ROOT });
  } catch (error) {
    failure = error;
    console.error(`\n  [error] scene aborted: ${error.message}`);
  }

  // Video is only flushed on context.close().
  await context.close();
  await browser.close();
  decks.stop();
  for (const stop of teardown) {
    try {
      stop();
    } catch {
      /* best effort */
    }
  }

  const produced = readdirSync(raw).filter((f) => f.endsWith('.webm'));
  if (produced.length === 0) fail('Playwright produced no video file.');

  const webm = join(OUT_DIR, `${sceneName}.webm`);
  rmSync(webm, { force: true });
  renameSync(join(raw, produced[0]), webm);
  rmSync(raw, { recursive: true, force: true });

  const mp4 = join(OUT_DIR, `${sceneName}.mp4`);
  rmSync(mp4, { force: true });
  const converted = await toMp4(webm, mp4);

  const { size } = await import('node:fs').then((fs) => fs.statSync(converted ? mp4 : webm));
  console.log(`  ${converted ? 'mp4' : 'webm'}  ${(size / 1_048_576).toFixed(1)} MB`);
  if (failure) {
    console.error(`\nrecord: the video was written but the scene did not complete.\n`);
    process.exitCode = 1;
  }
  return converted ? mp4 : webm;
}

const arg = process.argv[2];
if (!arg) fail(`Usage: node tools/video/record.mjs <${SCENES.join('|')}|all>`);

const wanted = arg === 'all' ? SCENES : [arg];
for (const scene of wanted) {
  if (!SCENES.includes(scene)) fail(`Unknown scene "${scene}". Known: ${SCENES.join(', ')}`);
}

const written = [];
for (const scene of wanted) written.push(await record(scene));

console.log(`\nDone — ${written.length} video(s):`);
for (const w of written) console.log(`  ${w}`);
