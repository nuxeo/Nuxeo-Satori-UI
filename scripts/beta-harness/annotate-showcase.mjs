#!/usr/bin/env node
/**
 * Annotated comparison artifact: agentic UI (Satori + Material) versus the adf-hx POC.
 *
 * Produces a single shareable PNG with numbered callouts drawn over real screenshots.
 * Highlight rectangles are taken from live DOM bounding boxes rather than placed by
 * hand, so they stay correct when the layout changes.
 *
 * Usage:
 *   node scripts/beta-harness/annotate-showcase.mjs [outDir]
 *
 * Requires the dev server, a reachable Nuxeo, and NUXEO_USER / NUXEO_PASS (no default):
 *   export NUXEO_USER=<user> NUXEO_PASS=<password>
 *   npx nx serve nuxeo-ui
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';
import { nuxeoCredentialsOrExit } from './nuxeo-credentials.mjs';

/**
 * Angular version for the generated footer, read from the installed package.
 *
 * This was a hardcoded string, and the bump to 20.3.31 would have made every newly generated
 * artifact misreport the framework it was captured against. A stamp claiming a version it did not
 * observe is worse than no stamp, because it is believed. Reading the installed `@angular/core`
 * leaves no second place to remember, and falls back to an explicit `unknown` rather than a stale
 * number if the package cannot be read.
 */
const ANGULAR_VERSION = (() => {
  try {
    const pkg = resolve(import.meta.dirname, '..', '..', 'node_modules/@angular/core/package.json');
    return JSON.parse(readFileSync(pkg, 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

// From the environment, no default — both used to fall back to the local Docker administrator
// pair (NXSAT-649). Checked before the browser is launched; exits 2 when either is unset.
const { username: user, password: pass } = nuxeoCredentialsOrExit('capture the annotated showcase');

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('Playwright required: npm install --no-save @playwright/test');
  process.exit(1);
}

const BASE = process.env['APP_URL'] ?? 'http://localhost:4200';
const SCALE = 2; // deviceScaleFactor — bounding boxes are CSS px, so multiply by this
const VIEWPORT = { width: 1440, height: 820 };

const outDir = resolve(process.argv[2] ?? resolve(EVIDENCE_ROOT, 'beta', 'annotated'), '');
await mkdir(outDir, { recursive: true });

/** Callouts per panel. `selector` is resolved against the live page. */
const PANELS = [
  {
    id: 'agentic',
    title: 'AGENTIC UI — production browse',
    subtitle: 'Hyland Satori design components on Angular Material',
    tone: 'neutral',
    route: '/#/browse/default-domain',
    root: 'lib-browse',
    expect: 'Workspaces',
    callouts: [
      {
        selector: 'sat-breadcrumbs',
        label: 'sat-breadcrumbs',
        note: 'Satori breadcrumbs — root reads "Root"',
      },
      // mat-tab-header, not mat-tab-group: the group's box includes the whole tab body.
      {
        selector: 'lib-browse mat-tab-header',
        label: 'mat-tab-header',
        note: 'Angular Material tab strip',
      },
      {
        selector: 'lib-browse mat-form-field',
        label: 'mat-form-field',
        note: 'Material outlined filters with a date-range picker',
      },
      {
        selector: 'lib-browse .mat-mdc-icon-button',
        label: 'header actions',
        note: 'Upload, edit, delete, download — all live',
      },
      {
        noteOnly: true,
        label: 'list rows',
        note: 'Plain divs with mat-checkbox and sat-avatar — no table component to point at',
      },
    ],
  },
  {
    id: 'adfhx',
    title: 'ADF-HX POC — same folder, same user',
    subtitle: 'Hand-written hxp-* components imitating the adf-hx library',
    tone: 'accent',
    route: '/#/browse-adf-hx?path=%2Fdefault-domain',
    root: 'lib-browse-adf-hx-poc',
    expect: 'Workspaces',
    callouts: [
      {
        selector: 'hxp-ui-breadcrumb',
        label: 'hxp-ui-breadcrumb',
        note: 'Ancestors plus the current folder, which the page supplies; upstream renders the list',
      },
      {
        selector: 'hxp-browse-tabs',
        label: 'hxp-browse-tabs',
        note: 'Native role=tab buttons, no Material',
      },
      {
        selector: 'hxp-browse-toolbar',
        label: 'hxp-browse-toolbar',
        note: 'Native inputs and browser date pickers; filters the 50 loaded rows in memory',
      },
      {
        selector: 'hxp-folder-header',
        label: 'hxp-folder-header',
        note: 'Create/Import opens the shared dialog; the other writes show a Scope A notice',
      },
      {
        selector: 'hxp-document-list',
        label: 'hxp-document-list',
        note: 'Real Nuxeo children through the bridge DOCUMENT_API / QUERY_API ports',
      },
    ],
  },
];

/** Measured differences shown as a table under the panels. */
const COMPARISON = [
  ['Component stack', 'Satori + Angular Material', 'Hand-written hxp-* (no adf-hx package yet)'],
  ['Breadcrumb root', 'Root', 'Repository (synthetic, fabricated by the bridge)'],
  ['Filter controls', 'Material outlined fields', 'Native HTML inputs, browser date pickers'],
  [
    'Write actions',
    'Live (Create / Import, edit, delete)',
    'Create / Import via the shared dialog; drive, edit, delete, share and export stubbed',
  ],
  ['Data source', 'BrowseService → Nuxeo REST', 'Bridge ports → BrowseService → Nuxeo REST'],
  ['Rows returned', '6', '6 — identical data'],
  ['Paging', 'Server paged', 'Fixed 50, first page only, no pager'],
  ['Search', 'NXQL via SearchService', 'None — toolbar filters loaded rows in memory'],
];

const browser = await chromium.launch({ headless: true });
// `httpCredentials` guarantees Basic on every request to the origin. Injecting the
// session into sessionStorage alone satisfies the route guard but does not reliably
// authenticate XHRs, which shows up as 403s on /nuxeo/api paths.
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  httpCredentials: { username: user, password: pass, origin: BASE },
});
const page = await context.newPage();

// The session object is still needed so the auth guard lets us past /#/login.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(
  (v) => {
    sessionStorage.setItem('agentic_ui_nuxeo_session', v);
    sessionStorage.removeItem('agentic_ui_signed_out');
  },
  JSON.stringify({
    kind: 'basic',
    username: user,
    basic: Buffer.from(`${user}:${pass}`).toString('base64'),
    isAdministrator: true,
    groups: [],
  }),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

/**
 * Load a panel's route and confirm real content arrived. Folder loads are
 * intermittently rejected on a cold Nuxeo, and a screenshot of the "Failed to
 * load folder contents" state is worse than no screenshot, so retry and then
 * fail loudly rather than capture it.
 * @param {(typeof PANELS)[number]} panel
 */
async function loadPanel(panel) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto(`${BASE}${panel.route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.locator(panel.root).first().waitFor({ state: 'visible', timeout: 15_000 });

    const retry = page.locator(`${panel.root} button`).filter({ hasText: /retry/i });
    if (await retry.count()) {
      await retry.first().click();
      await page.waitForTimeout(3000);
    }

    const loaded = await page.locator(panel.root).filter({ hasText: panel.expect }).count();
    if (loaded) return;
    console.log(`  attempt ${attempt}: "${panel.expect}" not present, retrying`);
    await page.waitForTimeout(2000);
  }
  throw new Error(
    `${panel.id}: folder content never loaded (expected "${panel.expect}"). ` +
      'Check Nuxeo is reachable and the session is valid; refusing to capture an error state.',
  );
}

for (const panel of PANELS) {
  console.log(`capturing ${panel.id} ...`);
  await loadPanel(panel);

  const shot = await page.screenshot({ type: 'png' });
  panel.image = `data:image/png;base64,${shot.toString('base64')}`;

  for (const c of panel.callouts) {
    if (c.noteOnly) {
      c.box = null;
      continue;
    }
    const el = page.locator(c.selector).first();
    if ((await el.count()) === 0) {
      c.box = null;
      console.log(`  miss: ${c.selector}`);
      continue;
    }
    const box = await el.boundingBox();
    // Stored as percentages of the CSS viewport so the overlay tracks the image
    // however it is scaled in the report layout. Clamped because tall elements can
    // extend past the fold.
    c.box = box
      ? {
          x: (box.x / VIEWPORT.width) * 100,
          y: (box.y / VIEWPORT.height) * 100,
          w: Math.min((box.width / VIEWPORT.width) * 100, 100 - (box.x / VIEWPORT.width) * 100),
          h: Math.min((box.height / VIEWPORT.height) * 100, 100 - (box.y / VIEWPORT.height) * 100),
        }
      : null;
    console.log(`  ${c.box ? 'ok  ' : 'miss'}: ${c.label}`);
  }
}

const capturedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
const html = renderHtml(capturedAt);
await writeFile(resolve(outDir, 'comparison.html'), html, 'utf8');

// Render the report itself to a PNG so it can be pasted into Jira, Confluence or a PR.
const reportPage = await context.newPage();
await reportPage.setViewportSize({ width: 1600, height: 1200 });
await reportPage.setContent(html, { waitUntil: 'load' });
await reportPage.waitForTimeout(800);
const png = resolve(outDir, 'agentic-ui-vs-adf-hx-annotated.png');
await reportPage.screenshot({ path: png, fullPage: true });

await browser.close();

console.log(`\nwrote ${png}`);
console.log(`wrote ${resolve(outDir, 'comparison.html')}`);

/** @param {string} capturedAt */
function renderHtml(capturedAt) {
  const panelHtml = PANELS.map((p) => {
    const overlays = p.callouts
      .map((c, i) =>
        c.box
          ? `<div class="hl ${p.tone}" style="left:${c.box.x.toFixed(3)}%;top:${c.box.y.toFixed(3)}%;width:${c.box.w.toFixed(3)}%;height:${c.box.h.toFixed(3)}%">
               <span class="badge ${p.tone}">${i + 1}</span>
             </div>`
          : '',
      )
      .join('');
    const legend = p.callouts
      .map(
        (c, i) => `<tr${c.box ? '' : ' class="dim"'}>
            <td class="num">${c.box ? `<span class="badge ${p.tone}">${i + 1}</span>` : `<span class="badge hollow">${i + 1}</span>`}</td>
            <td class="mono">${esc(c.label)}</td>
            <td>${esc(c.note)}${!c.box && !c.noteOnly ? ' <em>(selector not found)</em>' : ''}</td>
          </tr>`,
      )
      .join('');
    return `<section class="panel">
      <header class="bar ${p.tone}">
        <strong>${esc(p.title)}</strong>
        <span>${esc(p.subtitle)}</span>
      </header>
      <div class="shotwrap"><img src="${p.image}" alt="${esc(p.title)}"/>${overlays}</div>
      <table class="legend"><tbody>${legend}</tbody></table>
    </section>`;
  }).join('');

  const rows = COMPARISON.map(
    ([what, a, b]) =>
      `<tr><td>${esc(what)}</td><td class="neutralcell">${esc(a)}</td><td class="accentcell">${esc(b)}</td></tr>`,
  ).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --accent:#6b3fd4; --neutral:#5b6270; --line:#e3e5ea; --ink:#1a1c22; --muted:#6b7280; }
    * { box-sizing:border-box; }
    body { margin:0; padding:28px 30px 20px; background:#f4f5f7; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--ink); }
    .sheet { background:#fff; border:1px solid var(--line); border-radius:10px; padding:26px 28px 20px; }
    h1 { font-size:21px; margin:0 0 4px; letter-spacing:-.2px; }
    .lede { color:var(--muted); margin:0 0 22px; font-size:13px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
    .panel { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    .bar { padding:8px 12px; color:#fff; display:flex; flex-direction:column; gap:1px; }
    .bar strong { font-size:12.5px; letter-spacing:.4px; }
    .bar span { font-size:11px; opacity:.9; }
    .bar.neutral { background:var(--neutral); }
    .bar.accent { background:var(--accent); }
    .shotwrap { position:relative; line-height:0; background:#fff; }
    .shotwrap img { width:100%; height:auto; display:block; }
    .hl { position:absolute; border:2px solid var(--accent); border-radius:3px; background:rgba(107,63,212,.07); }
    .hl.neutral { border-color:#c0392b; background:rgba(192,57,43,.07); }
    .badge { position:absolute; top:-11px; left:-11px; width:20px; height:20px; border-radius:50%; color:#fff;
             font-size:11.5px; font-weight:700; line-height:20px; text-align:center; background:var(--accent); }
    .badge.neutral { background:#c0392b; }
    .badge.hollow { background:#fff; color:#9aa0aa; border:1.5px dashed #c7cbd2; line-height:17px; }
    td .badge, .num .badge { position:static; display:inline-block; }
    table { width:100%; border-collapse:collapse; }
    .legend td { padding:6px 10px; border-top:1px solid var(--line); font-size:11.5px; vertical-align:top; }
    .legend .num { width:30px; }
    .legend tr.dim { opacity:.45; }
    .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; white-space:nowrap; }
    h2 { font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin:24px 0 8px; }
    .cmp th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted);
              padding:6px 10px; border-bottom:1px solid var(--line); }
    .cmp td { padding:7px 10px; border-bottom:1px solid var(--line); font-size:12.5px; }
    .cmp td:first-child { color:var(--muted); width:20%; }
    .neutralcell { color:#8a3327; }
    .accentcell { color:#4b2a99; }
    .note { margin:18px 0 0; padding:10px 12px; border-left:3px solid var(--accent); background:#faf8ff; font-size:12.5px; }
    footer { margin-top:16px; color:#9aa0aa; font-size:10.5px; }
  </style></head><body><div class="sheet">
    <h1>Agentic UI and adf-hx — the same Nuxeo folder, two component stacks</h1>
    <p class="lede">Both panels show <span class="mono">/default-domain</span> in the same repository, as the same user, seconds apart. Numbered callouts are positioned from live DOM bounding boxes.</p>
    <div class="grid">${panelHtml}</div>
    <h2>What actually differs</h2>
    <table class="cmp"><thead><tr><th>Measured</th><th>Agentic UI (production)</th><th>adf-hx POC</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note"><strong>Read this before drawing conclusions:</strong> the <span class="mono">hxp-*</span> components shown on the right were hand-written in this repository to imitate adf-hx. No component from the published <span class="mono">@alfresco/adf-hx-content-services</span> package is imported yet. The POC validated the data contract — that Nuxeo can satisfy adf-hx's twelve API ports — and reproduced the look. Adopting the real library is Phase 3 of the Beta plan.</p>
    <footer>Captured ${esc(capturedAt)} UTC · ${esc(BASE)} · Chrome headless ${VIEWPORT.width}×${VIEWPORT.height} @${SCALE}x · Angular ${esc(ANGULAR_VERSION)} · live local Nuxeo on :8080 · generated by scripts/beta-harness/annotate-showcase.mjs</footer>
  </div></body></html>`;
}

/** @param {string} s */
function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}
