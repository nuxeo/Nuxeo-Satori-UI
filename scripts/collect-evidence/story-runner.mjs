#!/usr/bin/env node
/**
 * Bug-fix evidence capture, as a story rather than a pile of screenshots.
 *
 * Usage:
 *   node scripts/collect-evidence/story-runner.mjs <TICKET-ID> <scenes-file>
 *   EVIDENCE_PHASE=before|after  which half of the story this run captures
 *
 * Output: ~/Desktop/agentic-ui-evidence/<TICKET>/fix/<phase>/
 *   manifest.json   scenes, checks, per-scene console/HTTP errors, environment, verdict
 *   STORY.md        the narrative, images inlined
 *   chapters.vtt    video chapter markers
 *   <TICKET>-<phase>.webm
 *
 * ## Why this is not `runner.mjs`
 *
 * `runner.mjs` took screenshots and a video and stopped: no assertions, no report, no
 * console capture, and a `login()` that authenticates the route guard but not XHRs — which
 * surfaces as intermittent 403s and screenshots of empty states that read as component
 * defects. The Beta phase harness had already solved all of that, so this runner reuses its
 * helpers (`scripts/beta-harness/helpers.mjs`) instead of growing a third dialect.
 *
 * ## Two authoring modes
 *
 * A scenes file may export either:
 *
 *   export default async function (page, helpers, outDir) { ... }   // legacy, still supported
 *   export const scenes = [ { act, title, intent, criterion, run } ] // declarative
 *
 * The declarative form is stricter on purpose: it requires three acts and an acceptance
 * criterion per scene, so the artifact argues something instead of merely recording that the
 * app rendered. The legacy form keeps the twenty-odd existing ticket files working.
 */

import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { evidenceDirForTicket } from './evidence-path.mjs';
import { createHelpers, PreconditionError } from '../beta-harness/helpers.mjs';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error(
    '\nPlaywright is required to capture evidence but is not installed.\n' +
      'It is intentionally not a tracked dependency. Install it locally:\n\n' +
      '  npm install --no-save @playwright/test\n' +
      '  npx playwright install chromium\n',
  );
  process.exit(1);
}

const [, , ticketId, scenesFile] = process.argv;
if (!ticketId || !scenesFile) {
  console.error('Usage: node story-runner.mjs <TICKET-ID> <scenes-file.mjs>');
  process.exit(2);
}

const phase = process.env['EVIDENCE_PHASE'] ?? '';
const outDir = resolve(evidenceDirForTicket(ticketId), 'fix', phase);
await mkdir(outDir, { recursive: true });

const baseUrl = process.env['APP_URL'] ?? 'http://localhost:4200';

const scenesUrl = pathToFileURL(resolve(process.cwd(), scenesFile)).href;
const scenesMod = await import(scenesUrl);

const ACT_NAMES = {
  1: 'Setup — where we are and what the user is trying to do',
  2:
    phase === 'after'
      ? 'The fix — the behaviour as it now is'
      : 'The bug — the behaviour as reported',
  3: 'The proof — the criterion asserted, and what still works',
};

console.log(`\nEvidence story: ${ticketId}${phase ? ` (${phase})` : ''}`);
console.log(`  scenes  ${scenesFile}`);
console.log(`  app     ${baseUrl}`);
console.log(`  out     ${outDir}`);

/** @type {{ steps: import('../beta-harness/helpers.mjs').StepRecord[], consoleErrors: string[] }} */
const recorder = { steps: [], consoleErrors: [] };

const browser = await chromium.launch({
  headless: process.env['EVIDENCE_HEADLESS'] === '1',
  // Per-scene pacing replaces a blunt global slowMo. A uniform 400ms made every
  // interaction equally slow and still left the key states flashing past.
  slowMo: Number(process.env['EVIDENCE_SLOWMO'] ?? 120),
});

// Credentials come from the environment, with no fallback. Defaulting to Administrator
// meant a capture silently ran with privileged credentials whenever the variables were
// unset — and produced evidence of what an administrator sees, which is rarely the claim.
const skipHttpCredentials = scenesMod.skipHttpCredentials === true;
const nuxeoUser = process.env['NUXEO_USER'];
const nuxeoPass = process.env['NUXEO_PASS'];
if (!skipHttpCredentials && (!nuxeoUser || !nuxeoPass)) {
  // Placeholders, not a worked example. Spelling the local dev value out as an assignment
  // reads as a hardcoded credential to both a reviewer and the secret scanner, and this
  // repository gates merges on the latter.
  console.error(
    '\nNUXEO_USER and NUXEO_PASS must be set — there is deliberately no default.\n\n' +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>\n\n' +
      'A local Nuxeo dev container uses its documented default administrator account.\n' +
      'Public routes (e.g. /#/login) may export skipHttpCredentials = true and run without them.\n',
  );
  await browser.close();
  process.exit(2);
}

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  // Both auth mechanisms are required on authenticated surfaces: the injected session satisfies
  // the route guard so pages render, httpCredentials authenticates the XHRs behind them. Login
  // and other public routes set `skipHttpCredentials: true` on the scenes file so /me hydration
  // does not sign the browser in before the login form renders.
  ...(skipHttpCredentials
    ? {}
    : {
        // `send: 'always'` (NXSAT-643): a guest-enabled Nuxeo never challenges, so a
        // challenge-based credential is never sent and `page.request` runs as Anonymous.
        httpCredentials: { username: nuxeoUser, password: nuxeoPass, origin: baseUrl, send: 'always' },
      }),
});

if (skipHttpCredentials) {
  // Anonymous /me hydration still satisfies loginGuard unless the signed-out flag is set.
  await context.addInitScript(() => {
    sessionStorage.setItem('agentic_ui_signed_out', '1');
  });
}

// Chapter offsets are measured from here. Recording actually begins inside newContext, a few
// tens of milliseconds earlier, so offsets are approximate — stated in chapters.json rather
// than presented as exact.
const videoT0 = Date.now();
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // Carries no URL, so it cannot be triaged. The response listener records the same
  // failures with their path.
  if (text.startsWith('Failed to load resource')) return;
  recorder.consoleErrors.push(text.slice(0, 300));
});
page.on('pageerror', (err) =>
  recorder.consoleErrors.push(`uncaught: ${String(err.message).slice(0, 300)}`),
);
page.on('response', (res) => {
  if (res.status() < 400) return;
  let path = res.url();
  try {
    path = new URL(path).pathname;
  } catch {
    /* keep the raw url */
  }
  recorder.consoleErrors.push(`HTTP ${res.status()} ${path}`);
});

const helpers = createHelpers(page, outDir, recorder);

// ---------------------------------------------------------------- narration

const BANNER_ID = '__evidence_banner__';

/** @type {{actNo:number,title:string,intent?:string}|null} */
let currentBanner = null;

/**
 * Set while a screenshot is being taken.
 *
 * Hiding the live overlay was not enough: the `load` handler's `waitFor` could resolve and
 * inject a *new* spotlight between hiding it and `page.screenshot()`, putting the outline
 * into a raw still — and the before/after pair audit compares those bytes.
 */
let suppressSpotlight = false;

/** @type {{file:string,label:string,box:{x:number,y:number,w:number,h:number}}[]} */
const highlights = [];

// A scene almost always navigates, and navigation discards the injected banner. Re-inject on
// every load so the caption survives the whole scene rather than only its first frame.
/** Restorations that failed after a navigation, raised as a failed check at scene end. */
const spotlightFailures = [];

page.on('load', () => {
  if (currentBanner) injectBanner(currentBanner).catch(() => {});
  if (!currentSpotlight) return;

  // A `load` fires before Angular has rendered data-backed content, so re-injecting once and
  // swallowing the miss meant a scene that navigated after `spotlight()` could carry on with
  // no highlight at all while the run passed. Wait for the element, and if it never arrives
  // record it — a spotlight that silently vanished is a recording that points at nothing.
  const want = currentSpotlight;
  (async () => {
    await page.locator(want.selector).first().waitFor({ state: 'attached', timeout: 10_000 });
    if (currentSpotlight === want) await injectSpotlight(want);
  })().catch((err) => {
    if (currentSpotlight !== want) return; // superseded or cleared; not a failure
    spotlightFailures.push(`${want.selector}: ${err.message.split('\n')[0]}`);
  });
});

/**
 * Caption the video. The banner is injected into the page so the recorder captures it, and
 * hidden again for every screenshot — a burned-in caption makes a still harder to reuse and
 * obscures the UI underneath, which is the thing the still exists to show.
 */
async function showBanner(actNo, title, intent) {
  currentBanner = { actNo, title, intent };
  await injectBanner(currentBanner);
}

async function injectBanner({ actNo, title, intent }) {
  await page
    .evaluate(
      ({ id, actNo, title, intent }) => {
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        Object.assign(el.style, {
          position: 'fixed',
          insetInlineStart: '0',
          insetBlockEnd: '0',
          zIndex: '2147483647',
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 18px',
          background: 'rgba(17,17,17,0.86)',
          color: '#fff',
          font: '500 15px/1.4 system-ui, sans-serif',
          pointerEvents: 'none',
        });
        const t = document.createElement('div');
        t.textContent = `Act ${actNo} · ${title}`;
        const i = document.createElement('div');
        i.textContent = intent ?? '';
        Object.assign(i.style, { opacity: '0.75', fontSize: '13px', fontWeight: '400' });
        el.append(t, i);
        document.body.appendChild(el);
      },
      { id: BANNER_ID, actNo, title, intent },
    )
    .catch(() => {});
}

const SPOTLIGHT_ID = '__evidence_spotlight__';

/** @type {{selector:string,label?:string,tone:string}|null} */
let currentSpotlight = null;

/**
 * Outline the element the scene is about, in the live page, so the **recording** points at it.
 *
 * The annotated stills produced afterwards can only be looked at one at a time; a viewer
 * watching the video had no way to tell which part of the screen the fix touched. This draws
 * a bright outline around the target and dims the rest, so the eye goes to the right place
 * while the narration explains it.
 *
 * Like the caption banner it is hidden for every screenshot. Raw stills must stay unmodified:
 * the before/after pair audit compares their bytes, and an overlay would make every pair
 * differ for a reason that has nothing to do with the fix.
 *
 * @param {string} selector
 * @param {{label?: string, dim?: boolean}} [opts]
 */
async function spotlight(selector, opts = {}) {
  // The colour is derived from the half being captured and cannot be overridden. An
  // overridable tone let a scene pin a constant colour and so show green while the defect
  // was still on screen — contradicting the one thing the colour is supposed to mean,
  // without the scene ever branching on `EVIDENCE_PHASE`.
  const tone = phase === 'after' ? 'fixed' : phase === 'before' ? 'problem' : 'neutral';
  currentSpotlight = { selector, label: opts.label, tone, dim: opts.dim !== false };

  // Deliberately not caught. A mistyped or stale selector used to be swallowed here and in
  // `injectSpotlight`, so the capture passed while the recording pointed at nothing — an
  // evidence run that silently proves less than it claims. A declared spotlight is part of
  // the evidence, so failing to find it fails the run.
  await page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 });
  await page
    .locator(selector)
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await injectSpotlight(currentSpotlight);
}

async function clearSpotlight() {
  currentSpotlight = null;
  await page.evaluate((id) => document.getElementById(id)?.remove(), SPOTLIGHT_ID).catch(() => {});
}

async function injectSpotlight({ selector, label, tone, dim }) {
  if (suppressSpotlight) return; // a screenshot is in flight; do not draw into it
  await page.evaluate(
    ({ id, selector, label, tone, dim }) => {
      // Carry the latch across a replacement. Re-injecting built a fresh root and so
      // discarded `data-wasLost`, which meant a `shot()` after a recovery erased the evidence
      // of the gap and the scene-end check passed over it.
      const previous = document.getElementById(id);
      const inheritedLoss = previous?.dataset.wasLost === '1';
      previous?.remove();
      if (!document.querySelector(selector)) {
        throw new Error(`spotlight: no element matches ${selector}`);
      }

      const colours = { problem: '#ff5449', fixed: '#29c05a', neutral: '#4a9eff' };
      const colour = colours[tone] ?? colours.neutral;

      const root = document.createElement('div');
      root.id = id;
      root.setAttribute('aria-hidden', 'true');
      if (inheritedLoss) root.dataset.wasLost = '1';
      Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        pointerEvents: 'none',
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        borderRadius: '4px',
        outline: `3px solid ${colour}`,
        outlineOffset: '2px',
        boxShadow: dim ? '0 0 0 9999px rgba(0,0,0,0.45)' : 'none',
        transition: 'all 140ms ease-out',
      });

      const chip = document.createElement('div');
      if (label) {
        chip.textContent = label;
        Object.assign(chip.style, {
          position: 'fixed',
          padding: '4px 10px',
          borderRadius: '4px',
          background: colour,
          color: tone === 'fixed' ? '#04210f' : '#fff',
          font: '600 13px/1.3 system-ui, sans-serif',
          whiteSpace: 'nowrap',
        });
      }

      // Re-resolved, not captured once. `withHashLocation()` makes `goto('/#/x')` a
      // same-document navigation, so no `load` fires: the overlay survived while this
      // function kept measuring the *detached* element from the previous route and pointed
      // at a stale rectangle. Re-querying every tick also covers a component re-render
      // replacing the node. When it is gone, mark the overlay lost so the run can see it.
      // Connected is not the same as visible. A `display:none` node, a zero-sized box or an
      // element scrolled entirely out of view all resolve fine while the outline shows
      // nothing — so they count as lost. The scene-end check applies the identical
      // predicate, via `window.__evidenceSpotlightVisible`.
      const visible = (el) => {
        if (!el || !el.isConnected) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
          return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      window.__evidenceSpotlightVisible = (sel) => visible(document.querySelector(sel));

      const place = () => {
        const live = document.querySelector(selector);
        if (!visible(live)) {
          root.dataset.lost = '1';
          // Latched for the lifetime of this spotlight, and never cleared. `lost` alone is
          // transient: on a route change or re-render the target can be absent for several
          // ticks — the outline visibly disappears — and then return before the hold ends,
          // leaving a gap in the recording that a live query at scene end cannot see.
          root.dataset.wasLost = '1';
          box.style.display = 'none';
          chip.style.display = 'none';
          return;
        }
        delete root.dataset.lost;
        box.style.display = '';
        if (label) chip.style.display = '';
        const r = live.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        if (label) {
          const above = r.top > 34;
          Object.assign(chip.style, {
            left: `${Math.max(6, r.left)}px`,
            top: above ? `${r.top - 30}px` : `${r.bottom + 8}px`,
          });
        }
      };
      place();

      root.append(box);
      if (label) root.append(chip);
      document.body.appendChild(root);

      const onMove = () => place();
      addEventListener('scroll', onMove, true);
      addEventListener('resize', onMove);
      const timer = setInterval(place, 250);

      // Watch `root.isConnected`, not "is there an element with this id". Replacing a
      // spotlight removes the old root and inserts the new one in a single task, so the
      // outgoing observer looked up the id, found the *incoming* root, concluded nothing
      // had been removed, and left its timer and listeners running forever. Every
      // replacement leaked another set.
      const obs = new MutationObserver(() => {
        if (root.isConnected) return;
        clearInterval(timer);
        removeEventListener('scroll', onMove, true);
        removeEventListener('resize', onMove);
        obs.disconnect();
      });
      obs.observe(document.body, { childList: true });
    },
    { id: SPOTLIGHT_ID, selector, label, tone, dim },
  );
}

async function setSpotlightVisible(visible) {
  await page
    .evaluate(
      ({ id, visible }) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? 'block' : 'none';
      },
      { id: SPOTLIGHT_ID, visible },
    )
    .catch(() => {});
}

async function setBannerVisible(visible) {
  await page
    .evaluate(
      ({ id, visible }) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? 'block' : 'none';
      },
      { id: BANNER_ID, visible },
    )
    .catch(() => {});
}

/**
 * Full-frame card, used to open and close the recording so a viewer knows what they are
 * watching before the app appears.
 */
async function card(title, subtitle, holdMs = 2200) {
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;
      flex-direction:column;align-items:center;justify-content:center;background:#111;color:#fff;
      font:600 42px/1.3 system-ui,sans-serif;text-align:center;padding:0 8vw">
      <div>${escapeHtml(title)}</div>
      <div style="font:400 22px/1.5 system-ui,sans-serif;opacity:.7;margin-top:18px">${escapeHtml(subtitle)}</div>
    </body>`,
    { waitUntil: 'load' },
  );
  await page.waitForTimeout(holdMs);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

/**
 * Screenshot wrapper that also records the highlight target's position, so the annotator can
 * draw a callout later from a real bounding box rather than a hand-placed rectangle.
 */
async function shot(name, opts = {}) {
  suppressSpotlight = true;
  await setBannerVisible(false);
  await setSpotlightVisible(false);
  try {
    const file = await helpers.screenshot(
      name,
      opts.highlight ? page.locator(opts.highlight).first() : undefined,
    );
    const shotName = file.split('/').pop();

    if (opts.highlight) {
      const box = await page
        .locator(opts.highlight)
        .first()
        .boundingBox()
        .catch(() => null);
      const vp = page.viewportSize();
      if (box && vp) {
        highlights.push({
          file: shotName,
          label: opts.label ?? name,
          box: {
            x: (box.x / vp.width) * 100,
            y: (box.y / vp.height) * 100,
            w: (box.width / vp.width) * 100,
            h: (box.height / vp.height) * 100,
          },
        });
      }
    }
    return file;
  } finally {
    // In `finally` so an assertion or locator failure mid-capture cannot leave the overlay
    // suppressed for the rest of the run.
    suppressSpotlight = false;
    await setBannerVisible(true);
    await setSpotlightVisible(true);
    if (currentSpotlight) await injectSpotlight(currentSpotlight);
  }
}

// ---------------------------------------------------------------- run

const mod = scenesMod;
const declarative = Array.isArray(mod.scenes) ? mod.scenes : null;

/** @type {{index:number,act:number,title:string,criterion?:string,offsetMs:number}[]} */
const chapters = [];
let runError = null;
let preconditionFailure = null;

try {
  await card(`${ticketId}${phase ? ` — ${phase}` : ''}`, mod.summary ?? 'Bug fix evidence', 2000);

  if (declarative) {
    for (const [i, scene] of declarative.entries()) {
      const actNo = scene.act ?? 1;
      helpers.step(`[Act ${actNo}] ${scene.title}`);
      chapters.push({
        index: i + 1,
        act: actNo,
        title: scene.title,
        criterion: scene.criterion,
        offsetMs: Date.now() - videoT0,
      });

      const errorsBefore = recorder.consoleErrors.length;
      const current = recorder.steps[recorder.steps.length - 1];
      current.act = actNo;
      current.intent = scene.intent;
      current.criterion = scene.criterion;

      // Strict in the declarative form: an unlabelled scene proves nothing in particular,
      // and "it looked right" is the claim this whole artifact exists to replace.
      if (!scene.criterion) {
        helpers.check(
          `scene names an acceptance criterion`,
          false,
          'add `criterion: "AC-n"` from the ticket analysis, or move this to a note',
        );
      }

      await showBanner(actNo, scene.title, scene.intent);
      await clearSpotlight();
      // A scene may call `h.step()`, which opens a *new* record. Everything it asserts
      // afterwards lands there, not on `current` — so counting only `current`'s checks
      // reported "scene asserts something" as failed on a scene that had asserted plenty,
      // and left the later records without the act or criterion. Track the whole span.
      const firstRecord = recorder.steps.length - 1;
      const checksBefore = current.checks.length;
      await scene.run(page, {
        ...helpers,
        shot,
        spotlight,
        clearSpotlight,
        step: helpers.step.bind(helpers),
      });

      // A scene may instead just declare what it is about. Applied after `run`, so the
      // outline is on screen for the hold below — the part of the recording a viewer
      // actually pauses on.
      if (scene.spotlight) {
        const sp =
          typeof scene.spotlight === 'string' ? { selector: scene.spotlight } : scene.spotlight;
        await spotlight(sp.selector, sp);
      }

      const spanned = recorder.steps.slice(firstRecord);
      for (const rec of spanned) {
        rec.act = actNo;
        rec.intent ??= scene.intent;
        rec.criterion ??= scene.criterion;
      }
      const assertedInScene =
        spanned.reduce((n, rec) => n + rec.checks.length, 0) - checksBefore > 0;

      // Per scene, not just per run. The act-structure assertions below always contribute
      // three checks, so a whole-run count can never reach zero and would certify a story
      // whose every scene only took pictures.
      if (!assertedInScene) {
        helpers.check(
          'scene asserts something',
          false,
          'this scene only took screenshots. Add an expect*/check for the behaviour it claims to show',
        );
      }

      // Hold on the finished state so the video is followable rather than a flicker.
      await page.waitForTimeout(scene.hold ?? 2500);

      // Checked *after* the hold, because the hold is the part a viewer pauses on: validating
      // before it meant an element that vanished during those seconds was never noticed, and
      // the next scene cleared the overlay without looking.
      //
      // Resolved live rather than read from `data-lost`, which a 250ms interval maintains — a
      // target removed just before the scene returned had not been flagged yet.
      //
      // A restoration that timed out counts even if a later one succeeded: the recording still
      // has the gap, so the count is part of the condition and not merely the message.
      if (currentSpotlight) {
        const sel = currentSpotlight.selector;
        const state = await page
          .evaluate(
            ({ id, sel }) => {
              const el = document.getElementById(id);
              const target = document.querySelector(sel);
              const fn = window.__evidenceSpotlightVisible;
              return {
                present: !!el,
                // The same predicate `place()` uses, so the two cannot disagree. Falls back
                // to a connectivity test only if the helper is somehow absent.
                resolves: fn ? fn(sel) : !!target && target.isConnected,
                wasLost: el?.dataset.wasLost === '1',
              };
            },
            { id: SPOTLIGHT_ID, sel },
          )
          .catch(() => ({ present: false, resolves: false, wasLost: true }));

        const gaps = spotlightFailures.length;
        const ok = state.present && state.resolves && !state.wasLost && gaps === 0;
        const detail = !state.present
          ? `the overlay is gone (${sel})`
          : !state.resolves
            ? `${sel} is not visibly outlined — missing, hidden, zero-sized or off-screen`
            : state.wasLost
              ? `${sel} disappeared during the scene and came back — the recording has a gap`
              : `restoration failed ${gaps} time(s) during this scene — ${spotlightFailures.join('; ')}`;
        helpers.check('the spotlight still points at its element', ok, detail);
      }
      spotlightFailures.length = 0;

      const sceneErrors = recorder.consoleErrors.slice(errorsBefore);
      recorder.steps[recorder.steps.length - 1].consoleErrors = sceneErrors;
      if (sceneErrors.length) {
        console.log(`  [note] ${sceneErrors.length} console/HTTP error(s) during this scene`);
      }
    }

    // Three-act structure, asserted rather than assumed.
    const acts = new Set(declarative.map((s) => s.act ?? 1));
    helpers.step('Story structure');
    for (const n of [1, 2, 3]) {
      helpers.check(
        `act ${n} present — ${ACT_NAMES[n]}`,
        acts.has(n),
        `no scene declared act: ${n}`,
      );
    }
  } else if (typeof mod.default === 'function') {
    console.log(
      '  [note] legacy steps file — no acts or criteria. Convert to `export const scenes`.',
    );
    await mod.default(page, { ...helpers, shot, spotlight, clearSpotlight }, outDir);
  } else {
    throw new Error(`${scenesFile} must export \`scenes\` (array) or a default async function`);
  }

  await clearSpotlight();
  await card('End of capture', `${ticketId}${phase ? ` — ${phase}` : ''}`, 1600);
} catch (err) {
  if (err instanceof PreconditionError) {
    preconditionFailure = err.message;
    console.error(`\n[precondition] ${preconditionFailure}`);
  } else {
    runError = err instanceof Error ? err.message : String(err);
    console.error(`\n[error] capture aborted: ${runError}`);
  }
} finally {
  await page.waitForTimeout(600);
  const video = page.video();
  await context.close(); // flushes the video
  await browser.close();
  if (video) {
    try {
      await rename(
        await video.path(),
        resolve(outDir, `${ticketId}${phase ? `-${phase}` : ''}.webm`),
      );
    } catch (err) {
      console.warn(`  could not rename the recording: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------- report

const videoFile = (await readdir(outDir)).find((f) => f.endsWith('.webm')) ?? null;

const totalChecks = recorder.steps.reduce((n, s) => n + s.checks.length, 0);
const failed = recorder.steps.flatMap((s) =>
  s.checks.filter((c) => !c.passed).map((c) => ({ step: s.index, label: s.label, ...c })),
);

// A capture that asserts nothing cannot pass. This is the rule the old runner had no way to
// express, and the reason a green capture used to mean only that the browser opened.
//
// Legacy steps files pre-date that contract: none of them calls an assertion, so treating
// zero checks as `fail` would have made every one of them exit 1 while the documentation
// claimed they still worked. They get their own verdict instead — not `pass`, so it can
// never be cited as evidence, but not a failure of the capture either.
const verdict = preconditionFailure
  ? 'precondition-not-met'
  : runError
    ? 'error'
    : totalChecks === 0
      ? declarative
        ? 'fail'
        : 'legacy-no-assertions'
      : failed.length === 0
        ? 'pass'
        : 'fail';

const manifest = {
  ticket: ticketId,
  phase: phase || null,
  mode: declarative ? 'scenes' : 'legacy',
  verdict,
  finishedAt: new Date().toISOString(),
  environment: {
    appUrl: baseUrl,
    node: process.version,
    scenesFile,
    commit: safeExec('git', ['rev-parse', '--short', 'HEAD']),
    branch: safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    // Written by new-ticket-workspace.sh. A story that cannot say which server produced it
    // cannot be reproduced from.
    nuxeoImage: safeRead(resolve(outDir, '..', 'nuxeo-image.txt')),
  },
  totals: { scenes: recorder.steps.length, checks: totalChecks, failed: failed.length },
  ...(runError ? { error: runError } : {}),
  ...(preconditionFailure ? { preconditionFailure } : {}),
  video: videoFile,
  chapters,
  highlights,
  steps: recorder.steps,
  consoleErrors: recorder.consoleErrors,
};

await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(resolve(outDir, 'STORY.md'), renderStory(manifest), 'utf8');
if (chapters.length) await writeFile(resolve(outDir, 'chapters.vtt'), renderVtt(manifest), 'utf8');

console.log(
  `\nverdict  ${verdict.toUpperCase()} — ${totalChecks - failed.length}/${totalChecks} checks across ${recorder.steps.length} scene(s)`,
);
console.log(`story    ${resolve(outDir, 'STORY.md')}`);

// Two different questions, and they were conflated. "Did the capture run correctly?" decides
// the exit code; "did the claims hold?" is the verdict. The BEFORE half of a bug fix is
// *supposed* to fail its assertions — that is the bug reproducing — so exiting 1 there made
// the documented sequence look like a broken command, indistinguishable from malformed
// evidence. Assertion failures are a result; structural defects are a failure.
const STRUCTURAL = new Set([
  'scene asserts something',
  'scene names an acceptance criterion',
  // A missing or stale spotlight is a broken capture, not a failed claim. Left as an ordinary
  // check it exited 0 and printed "the capture itself is sound" over a recording that pointed
  // at nothing — precisely the acceptance this file exists to prevent.
  'the spotlight still points at its element',
]);
const structural = failed.filter((f) => STRUCTURAL.has(f.name) || f.name.startsWith('act '));
const captureBroken = Boolean(runError) || Boolean(preconditionFailure) || structural.length > 0;

if (verdict === 'legacy-no-assertions') {
  console.log(
    '\n  This is a legacy steps file: it produced screenshots but asserted nothing, so the\n' +
      '  capture cannot be cited as evidence of anything. Convert it to `export const scenes`\n' +
      '  with a criterion and an assertion per scene when you next touch this ticket.',
  );
} else if (verdict !== 'pass') {
  for (const f of failed)
    console.log(
      `  [FAIL] scene ${f.step} (${f.label}) — ${f.name}${f.detail ? `: ${f.detail}` : ''}`,
    );
  if (totalChecks === 0)
    console.log('  No checks were recorded. A capture that asserts nothing is not evidence.');
  if (!captureBroken) {
    console.log(
      '\n  The capture itself is sound — these are failed claims, not a broken run. For a BEFORE\n' +
        '  capture that is the expected result: it is the bug reproducing. `evidence:story`\n' +
        '  decides whether the before/after pair supports the fix.',
    );
  }
}

if (captureBroken) process.exit(1);

// ---------------------------------------------------------------- helpers

function safeExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** WebVTT timestamp. Milliseconds are significant: truncating to whole seconds produced
 *  cues whose start equalled their end, which players reject as zero-length. */
function ms(t) {
  const total = Math.max(0, Math.round(t));
  const h = String(Math.floor(total / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(total % 1000).padStart(3, '0')}`;
}

function renderVtt(m) {
  const lines = [
    'WEBVTT',
    '',
    `NOTE Offsets are measured from browser-context creation and are accurate to roughly`,
    `NOTE 100ms — recording starts inside newContext, marginally before the first timestamp.`,
    '',
  ];
  for (const [i, c] of m.chapters.entries()) {
    // A cue must be strictly shorter than the next one's start, and never zero-length.
    const next = m.chapters[i + 1]?.offsetMs;
    const end = Math.max(c.offsetMs + 500, next ?? c.offsetMs + 8000);
    lines.push(`${c.index}`, `${ms(c.offsetMs)} --> ${ms(end)}`, `Act ${c.act} — ${c.title}`, '');
  }
  return lines.join('\n');
}

/** The narrative. Images inlined so it can be pasted into a PR, Jira or Confluence. */
function renderStory(m) {
  const title = `# ${m.ticket}${m.phase ? ` — ${m.phase}` : ''}`;
  const lines = [
    title,
    '',
    `**Verdict:** ${m.verdict.toUpperCase()} — ${m.totals.checks - m.totals.failed}/${m.totals.checks} checks across ${m.totals.scenes} scene(s)`,
    '',
    '| | |',
    '| --- | --- |',
    `| App | ${m.environment.appUrl} |`,
    `| Branch / commit | \`${m.environment.branch ?? '?'}\` @ \`${m.environment.commit ?? '?'}\` |`,
    `| Nuxeo image | ${m.environment.nuxeoImage ? `\`${m.environment.nuxeoImage}\`` : '_not recorded_'} |`,
    `| Scenes file | \`${m.environment.scenesFile}\` |`,
    ...(m.video
      ? [
          `| Recording | \`${m.video}\`${m.chapters.length ? ' (chapters in `chapters.vtt`)' : ''} |`,
        ]
      : []),
    '',
  ];

  if (m.preconditionFailure) {
    lines.push(
      '> **Precondition not met — this is not a defect.**',
      '>',
      `> ${m.preconditionFailure}`,
      '>',
      '> Fix the environment or run the scenes file that matches it. Do not change application',
      '> code to make this go green.',
      '',
    );
  }
  if (m.error) {
    lines.push('> **The capture aborted before completing every scene.**', '>', `> ${m.error}`, '');
  }
  if (m.verdict === 'legacy-no-assertions') {
    lines.push(
      '> **Legacy capture — screenshots only, nothing asserted.**',
      '>',
      '> This steps file pre-dates the assertion contract. The images below show that pages',
      '> rendered; they do not show that they rendered the right thing, so this cannot be',
      '> cited as evidence. Convert it to `export const scenes`.',
      '',
    );
  } else if (m.totals.checks === 0) {
    lines.push(
      '> **No checks were recorded, so this capture proves nothing.**',
      '>',
      '> Screenshots show that the app rendered something. They do not show that it rendered',
      '> the right thing. Add an assertion per scene.',
      '',
    );
  }

  if (m.totals.failed > 0) {
    lines.push('## Failed checks', '');
    for (const f of m.steps.flatMap((s) =>
      s.checks.filter((c) => !c.passed).map((c) => ({ s, c })),
    )) {
      lines.push(
        `- Scene ${f.s.index} (${f.s.label}) — **${f.c.name}**${f.c.detail ? `: ${f.c.detail}` : ''}`,
      );
    }
    lines.push('');
  }

  let lastAct = null;
  for (const s of m.steps) {
    if (s.act && s.act !== lastAct) {
      lines.push(`## Act ${s.act} — ${ACT_NAMES[s.act] ?? ''}`, '');
      lastAct = s.act;
    }
    const bad = s.checks.filter((c) => !c.passed).length;
    const status = s.checks.length === 0 ? 'no checks' : bad === 0 ? 'pass' : `${bad} failed`;
    lines.push(`### ${s.index}. ${s.label.replace(/^\[Act \d+\] /, '')}  _(${status})_`, '');
    if (s.intent) lines.push(`_${s.intent}_`, '');
    if (s.criterion) lines.push(`Proves: **${s.criterion}**`, '');
    for (const c of s.checks) {
      lines.push(
        `- ${c.passed ? '[pass]' : '[FAIL]'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`,
      );
    }
    for (const n of s.notes ?? []) lines.push(`- _not covered:_ ${n}`);
    for (const e of s.consoleErrors ?? []) lines.push(`- _observed in the browser:_ \`${e}\``);
    if (s.checks.length || (s.notes ?? []).length || (s.consoleErrors ?? []).length) lines.push('');
    for (const shotFile of s.screenshots) {
      lines.push(`![${s.label} — ${shotFile}](./${shotFile})`, '');
    }
  }

  return `${lines.join('\n')}\n`;
}
