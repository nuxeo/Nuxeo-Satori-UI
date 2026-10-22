/**
 * NXSAT-308 parity — the core-slice Build components, captured once on the upstream adf-hx
 * components ("before") and again on their nxs- replacements ("after"), against the same data.
 *
 * Plan section 10 makes build-alongside conditional on parity being demonstrated, not asserted.
 * The "before" half needs the upstream packages to install; once adf-hx access is gone it cannot
 * be produced again. So the steps below are written once and never edited between the halves:
 * only the surface adapter changes.
 *
 * ## Surfaces (`PARITY_SURFACE`)
 *
 * - `adf-hx` (default) — `main` as shipped: upstream `hxp-document-list`, `hxp-document-tree`,
 *   `hxp-ui-breadcrumb`, `hxp-permissions-management-panel` and `hxp-ui-document-viewer` on
 *   `/browse-adf-hx` and `/search-adf-hx`. Upstream's properties and versions sidebars are not
 *   mounted on `main` (removed in 0b7b44b15), so on this surface the PropertiesPanel and
 *   ManageVersions steps read the production document page, and say so in the step label.
 * - `adf-hx-remount` — the same, plus upstream's `hxp-properties-sidebar` and
 *   `hxp-manage-versions-sidebar` re-mounted as the browse POC's Properties and Versions tabs by
 *   a local, uncommitted revert of 0b7b44b15's three POC files. Only those two steps differ.
 * - `adf-hx-as-target` — negative control: `adf-hx` with no known gaps, so every gap check is
 *   judged as a parity target and must fail. Run it to see the gap checks go red.
 * - `nxs` — the replacements. The adapter is provisional: its selectors follow the table-primitive
 *   decision (`docs/satori-components/decision-table-primitive.md`) and must be confirmed against
 *   the built components. Change the adapter only; never the steps or the expected values.
 *
 * ## Reading the checks
 *
 * Every check this file writes starts with its kind (the harness's own `precondition:`, console
 * and screenshot-audit checks keep their names):
 *
 * - `[load-bearing]` — the claim the component must keep. These carry the parity.
 * - `[negative]` — something that must be absent (stale rows, a leaked document). Each one's
 *   condition also requires that the surface rendered, so an empty page cannot pass it.
 * - `[context]` — environment or provenance facts that make the rest interpretable.
 * - `[known upstream gap reproduced]` — on an adf-hx surface, a defect upstream already has. It
 *   passes only when the specific wrong behaviour is affirmatively observed, so a broken selector
 *   cannot pass it. On `nxs` the same check is named `[parity target]` and passes only when the
 *   correct behaviour is observed. These are targets for the replacements, not things to copy.
 *
 * ## Data
 *
 * Seeded by `nxsat-308-parity/seed-parity-data.mjs`, next to this file (committed by NXSAT-643;
 * it had been kept only with the 2026-10-08 evidence). The first step verifies the fixture over
 * REST and aborts with `precondition-not-met` (exit 2) when it does not match. Team runs use a
 * Nuxeo of their own, started and seeded from that folder — see its `README.md`.
 *
 * ## Run
 *
 *   # your own Nuxeo seeded, app served against it (nxsat-308-parity/README.md)
 *   export NUXEO_USER=… NUXEO_PASS=… PARITY_USER_PASS=…   # the same PARITY_USER_PASS the seed used
 *   APP_URL=http://localhost:4216 PARITY_SURFACE=adf-hx npm run beta:evidence -- nxsat-308-parity
 *
 * The after-half runs the same command with `PARITY_SURFACE=nxs` against a freshly seeded Nuxeo.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { askThroughFetch, PROBE_TIMEOUT_MS } from '../identity-guard.mjs';

const LB = '[load-bearing]';
const NEG = '[negative]';
const CTX = '[context]';

// ── The fixture. Must match seed-parity-data.mjs; the first step proves it does. ────────────────

const ROOT = '/default-domain/workspaces/parity';
const DEEP_LEVELS = 6;
const deepPath = (n) =>
  `${ROOT}/${Array.from({ length: n }, (_, i) => `deep-l${i + 1}`).join('/')}`;
const deepTitle = (n) =>
  n === 5
    ? 'Deep L5 with a deliberately long folder title to exercise breadcrumb truncation'
    : `Deep L${n}`;
const PAGED = { path: `${ROOT}/paged`, title: 'Paged folder', count: 125, pageSize: 50 };
const pagedTitle = (n) => `Paged item ${String(n).padStart(3, '0')}`;
const VERSIONS = {
  path: `${ROOT}/versions`,
  doc: `${ROOT}/versions/versioned-contract`,
  docTitle: 'Versioned contract',
  description: 'edited after approval',
  fileName: 'versioned-contract.txt',
  live: '1.0+',
  labels: ['1.0', '0.2', '0.1'],
  unversioned: `${ROOT}/versions/unversioned-memo`,
};
const ACL = {
  path: `${ROOT}/acl`,
  title: 'ACL beyond three levels',
  doc: `${ROOT}/acl/acl-memo`,
  user: 'parity-user',
  userLabel: 'Parity User',
};
const DENIED = { path: `${ROOT}/denied`, title: 'Restricted folder', doc: 'Secret memo' };
const MEDIA = {
  path: `${ROOT}/media`,
  pdf: 'Parity PDF',
  image: 'Parity image',
  video: 'Parity video',
  unknown: 'Parity unsupported format',
  pdfText: 'Parity PDF fixture',
};
const EMPTY = { path: `${ROOT}/empty` };
const SEARCH = { token: 'paritytoken', none: 'zzznoparityresult', secret: 'secret' };
const SESSION_KEY = 'agentic_ui_nuxeo_session';

/**
 * For a wait or a click that may not land. Its failure is never the finding: the check after it
 * observes what is actually on screen and records why, which a thrown timeout would pre-empt by
 * aborting the run before that check could say anything.
 */
const leaveItToTheNextCheck = () => undefined;

/** For a request or a page evaluation that got no answer at all; the caller's check reports it. */
const noAnswer = () => null;

// ── Surfaces ──────────────────────────────────────────────────────────────────────────────────────

/** Defects upstream already has. Each is a parity target for the replacement. */
const UPSTREAM_GAPS = [
  'list.aria-sort-initial',
  'list.aria-sort-tokens',
  'list.sort-announced',
  'list.range-select',
  'list.arrow-keys',
  'list.row-name',
  'list.roving-tabindex',
  'tree.depth-legible',
  'tree.current-indicated',
  'tree.load-error-shown',
  'crumb.truncation',
  'perm.non-expressible-shown',
  'perm.full-set',
  'perm.save-applied',
  'perm.refusal-explained',
  'viewer.pdf',
  'viewer.video',
  'viewer.img-alt',
  'search.error-message',
  'denied.distinct-message',
  'denied.stale-breadcrumb',
];

/** Defects of upstream's properties and versions sidebars, which only `adf-hx-remount` renders. */
const SIDEBAR_GAPS = [
  'props.version-label',
  'props.blob-rendered',
  'props.labels-translated',
  'versions.restore-offered',
  'versions.create-offered',
  'versions.none-explained',
];

const adfHxBrowse = (path) => `/#/browse-adf-hx?path=${encodeURIComponent(path)}`;

/** Sets one row of upstream's DataTable selected or not, by keyboard; Space toggles, so read first. */
async function adfHxSetRowSelected(page, A, title, selected) {
  const row = page.locator(A.list.rows).filter({ hasText: title }).first();
  await row.waitFor({ timeout: 15_000 }).catch(leaveItToTheNextCheck);
  if ((await row.getAttribute('aria-selected').catch(noAnswer)) === String(selected)) return;
  await row.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
}

/** Opens a per-document tab of the re-mounted POC on exactly one selected row. */
async function adfHxOpenRowTab(page, h, path, title, tab) {
  await h.goTo(adfHxBrowse(ROOT)); // a folder change clears the POC's selection
  await h.goTo(adfHxBrowse(path));
  await page.locator('hxp-browse-tabs [role="tab"]').filter({ hasText: 'View' }).first().click();
  await page.waitForTimeout(1500);
  await adfHxSetRowSelected(page, ADF_HX, title, true);
  await page.locator('hxp-browse-tabs [role="tab"]').filter({ hasText: tab }).first().click();
}

async function adfHxOpenFolderTab(page, h, path, tab) {
  await h.goTo(adfHxBrowse(path));
  await page.locator('hxp-browse-tabs [role="tab"]').filter({ hasText: tab }).first().click();
  await page.waitForTimeout(2500);
}

const ADF_HX = {
  id: 'adf-hx',
  upstream: true,
  label: 'upstream adf-hx components on the POC routes (main as shipped)',
  knownGaps: new Set(UPSTREAM_GAPS),
  browse: adfHxBrowse,
  crumbHref: (path) => `#/browse-adf-hx?path=${encodeURIComponent(path)}`,
  async present(page, h) {
    await h.goTo(adfHxBrowse(ROOT));
    return (await page.locator('hxp-document-list').count()) > 0;
  },
  list: {
    rows: 'hxp-document-list .adf-datatable-body adf-datatable-row',
    title: '[role="gridcell"][aria-label="Title"] .adf-datatable-cell-value',
    headers: 'hxp-document-list [role="columnheader"]',
    headerControl: (label) =>
      `hxp-document-list [role="columnheader"][aria-label="${label}"] .adf-datatable-cell-header-content`,
    checkbox: 'mat-checkbox',
    selectAll: 'hxp-document-list .adf-datatable-header mat-checkbox input',
    next: 'hxp-browse-pager button[aria-label="Next page"]',
    previous: 'hxp-browse-pager button[aria-label="Previous page"]',
    range: 'hxp-browse-pager .hxp-pager__range',
    empty: '.hxp-poc-empty',
    error: '.hxp-poc-error [role="alert"]',
    retry: '.hxp-poc-error button',
    failPattern: '**/@children**',
  },
  tree: {
    node: 'hxp-browse-nav-drawer hxp-document-tree [role="treeitem"]',
    label: '.hxp-node-label',
    toggle: (label) =>
      `hxp-browse-nav-drawer hxp-document-tree button[aria-label="Toggle ${label}"]`,
    region: 'hxp-browse-nav-drawer',
    failPattern: '**/search/pp/tree_children/execute**',
  },
  breadcrumb: { items: 'hxp-ui-breadcrumb nav li', nav: 'hxp-ui-breadcrumb nav' },
  permissions: {
    root: 'hxp-permissions-management-panel',
    async open(page, h, path) {
      await adfHxOpenFolderTab(page, h, path, 'Permissions');
      await page
        .locator('hxp-permissions-management-panel')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(leaveItToTheNextCheck);
      await page.waitForTimeout(1500);
    },
    async showTab(page, label) {
      await page
        .locator('hxp-permissions-management-panel [role="tab"]')
        .filter({ hasText: label })
        .first()
        .click();
      await page.waitForTimeout(1200);
    },
    rows: 'hxp-permissions-management-panel mat-tab-body.mat-mdc-tab-body-active tr[mat-row]',
    accessControl: 'mat-select',
    options: '.cdk-overlay-container mat-option',
    save: 'hxp-permissions-management-panel button',
    feedback: 'mat-snack-bar-container',
  },
  viewer: {
    root: 'mat-dialog-container .hxp-viewer-overlay',
    async open(page, A, title) {
      await adfHxSetRowSelected(page, A, title, true);
      await page.locator('.hxp-browse-page__preview-btn').click();
      await page.waitForTimeout(5000);
    },
    async close(page, A, title) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
      await adfHxSetRowSelected(page, A, title, false);
    },
  },
  properties: {
    provenance:
      'production document page (hand-written): upstream hxp-properties-sidebar is not mounted on main',
    root: 'lib-document-detail .properties-panel',
    async open(page, h, uid) {
      await h.goToDoc(uid);
      await page
        .locator('lib-document-detail .properties-panel')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(leaveItToTheNextCheck);
    },
  },
  versions: {
    provenance:
      'production document page version menu (hand-written): upstream hxp-manage-versions-sidebar is not mounted on main',
    async open(page, h, uid) {
      await h.goToDoc(uid);
      await page
        .locator('lib-document-detail .properties-panel')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(leaveItToTheNextCheck);
      // A never-versioned document has no menu: the Version row holds a Create version button.
      const menu = page.locator('lib-document-detail .version-select');
      if (await menu.count()) {
        await menu.first().click();
        await page.waitForTimeout(1500);
      }
    },
    root: 'lib-document-detail .version-dropdown',
    /** @returns {Promise<{labels: string[], live: string, restore: number, create: number, empty: string}>} */
    async read(page) {
      if ((await page.locator('lib-document-detail .version-dropdown').count()) === 0) {
        return {
          labels: [],
          live: '',
          restore: 0,
          create: await page
            .locator('lib-document-detail .create-version-btn:not([disabled])')
            .count(),
          empty: '',
        };
      }
      return page
        .locator('lib-document-detail .version-dropdown')
        .first()
        .evaluate((el) => ({
          labels: [
            ...el.querySelectorAll(
              '.version-dropdown-item:not(.version-dropdown-item--current):not(.version-dropdown-create) .version-dropdown-label',
            ),
          ].map((s) => (s.textContent ?? '').trim()),
          live: (el.querySelector('.version-dropdown-item--current')?.textContent ?? '').trim(),
          restore: el.querySelectorAll(
            'button.version-dropdown-item:not(.version-dropdown-item--current):not(.version-dropdown-create):not([disabled])',
          ).length,
          create: el.querySelectorAll('.version-dropdown-create:not([disabled])').length,
          empty: (el.querySelector('.version-dropdown-empty')?.textContent ?? '').trim(),
        }))
        .catch(() => ({ labels: [], live: '', restore: 0, create: 0, empty: '' }));
    },
  },
  search: {
    route: '/#/search-adf-hx',
    input: 'lib-search-adf-hx input[matinput], lib-search-adf-hx input',
    rows: 'lib-search-adf-hx hxp-document-list .adf-datatable-body adf-datatable-row',
    title: '[role="gridcell"][aria-label="Title"] .adf-datatable-cell-value',
    next: 'lib-search-adf-hx button[aria-label="Next page"]',
    count: 'lib-search-adf-hx .hxp-search-page__results-count',
    none: 'lib-search-adf-hx .hxp-search-page__no-results',
    error: 'lib-search-adf-hx .hxp-search-page__error',
    failPattern: '**/search/lang/NXQL/execute**',
  },
};

/**
 * Upstream's two per-document sidebars, re-mounted by a local revert of 0b7b44b15's POC files.
 * Everything else is `ADF_HX`.
 */
const ADF_HX_REMOUNT = {
  ...ADF_HX,
  id: 'adf-hx-remount',
  label: 'upstream adf-hx components, plus the properties and versions sidebars re-mounted locally',
  knownGaps: new Set([...UPSTREAM_GAPS, ...SIDEBAR_GAPS]),
  /** The re-mount is a local patch; without it this surface must stop, not report missing panels. */
  async present(page, h) {
    if (!(await ADF_HX.present(page, h))) return false;
    const tabs = (
      await page
        .locator('hxp-browse-tabs [role="tab"]')
        .allInnerTexts()
        .catch(() => [])
    ).map((t) => t.trim());
    return ['Properties', 'Versions'].every((t) => tabs.includes(t));
  },
  properties: {
    provenance: 'upstream hxp-properties-sidebar, re-mounted as the browse POC Properties tab',
    root: 'hxp-properties-sidebar',
    async open(page, h) {
      await adfHxOpenRowTab(page, h, VERSIONS.path, VERSIONS.docTitle, 'Properties');
      await page
        .locator('hxp-properties-sidebar')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(leaveItToTheNextCheck);
      await page.waitForTimeout(2500);
      // Description and file name sit in the collapsed "Other Properties" section.
      for (const header of await page
        .locator('hxp-properties-sidebar mat-expansion-panel-header[aria-expanded="false"]')
        .all()) {
        await header.click();
        await page.waitForTimeout(600);
      }
    },
  },
  versions: {
    provenance: 'upstream hxp-manage-versions-sidebar, re-mounted as the browse POC Versions tab',
    async open(page, h, _uid, title = VERSIONS.docTitle) {
      await adfHxOpenRowTab(page, h, VERSIONS.path, title, 'Versions');
      await page
        .locator('hxp-manage-versions-sidebar')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(leaveItToTheNextCheck);
      await page.waitForTimeout(3000);
    },
    root: 'hxp-manage-versions-sidebar',
    /** Restore and create live in each version's ⋮ menu, so every menu is opened and read. */
    async read(page) {
      const root = page.locator('hxp-manage-versions-sidebar').first();
      const items = root.locator('.hxp-version-item');
      const titles = (
        await items
          .locator('.hxp-version-title')
          .allInnerTexts()
          .catch(() => [])
      ).map((t) => t.trim());
      const menus = [];
      for (let i = 0; i < (await items.count()); i++) {
        await items
          .nth(i)
          .locator('.hxp-context-btn button')
          .first()
          .click()
          .catch(leaveItToTheNextCheck);
        await page.waitForTimeout(600);
        menus.push(
          (
            await page
              .locator('.cdk-overlay-container [role="menuitem"]')
              .allInnerTexts()
              .catch(() => [])
          ).map((t) => t.trim()),
        );
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      const text = (await root.innerText().catch(() => '')).replace(/\s+/g, ' ');
      return {
        labels: titles.filter((t) => /^\d+\.\d+$/.test(t)),
        live: (
          await root
            .locator('.hxp-current-version')
            .innerText()
            .catch(() => '')
        ).replace(/\s+/g, ' '),
        restore: menus.filter((m) => m.some((x) => /restore/i.test(x))).length,
        create: menus.filter((m) => m.some((x) => /create|new version/i.test(x))).length,
        menus,
        empty: /no (previous )?versions/i.test(text) ? text.slice(0, 120) : '',
        text: text.slice(0, 300),
      };
    },
  },
};

/**
 * Confirmed against the components on feature/nxsat-308-identity-guard at 23d60bb5d (NXSAT-644);
 * each group names the template it was read from. Expectations no selector can reach are recorded
 * in NXSAT-644 rather than worked around here. Change only this object.
 */
const NXS = {
  id: 'nxs',
  upstream: false,
  label: 'nxs- components from libs/shared/satori-components',
  knownGaps: new Set(),
  browse: (path) => `/#/browse${path}`,
  crumbHref: (path) => `#/browse${path}`,
  async present(page, h) {
    await h.goTo(`/#/browse${ROOT}`);
    return (await page.locator('nxs-document-list').count()) > 0;
  },
  // document-list/document-list.component.html (mat-table: CdkRow and CdkHeaderCell set the roles,
  // MatSortHeader's container is the role="button"), pager/pager.component.html,
  // empty-state and error-state; scoped to the list so the tree's error state is never read.
  list: {
    rows: 'nxs-document-list tbody tr[role="row"]',
    // The title cell also holds the type icon, whose ligature is text; the open button is the title.
    title: '.nxs-document-list__open',
    headers:
      'nxs-document-list th[role="columnheader"]:not(.nxs-document-list__select):not(.nxs-document-list__actions)',
    headerControl: (label) =>
      `nxs-document-list th[role="columnheader"]:has-text("${label}") [role="button"]`,
    checkbox: 'mat-checkbox',
    selectAll: 'nxs-document-list thead mat-checkbox input',
    next: 'nxs-document-list [aria-label="Next page"], nxs-pager [aria-label="Next page"]',
    previous:
      'nxs-document-list [aria-label="Previous page"], nxs-pager [aria-label="Previous page"]',
    range: 'nxs-pager .nxs-pager__range',
    empty: 'nxs-document-list nxs-empty-state',
    error: 'nxs-document-list nxs-error-state',
    retry: 'nxs-document-list nxs-error-state button',
    failPattern: '**/@children**',
  },
  // document-tree/document-tree.component.html, mounted by nav-drawer.component.html. Only the
  // chevron toggles; the rest of a row opens the folder. A failed level is reported in a treeitem
  // row of its own, which is not a document, so it is not a node.
  tree: {
    node: 'nxs-document-tree [role="treeitem"]:not(.nxs-document-tree__item--error)',
    label: '.nxs-document-tree__label',
    toggle: (label) =>
      `nxs-document-tree .nxs-document-tree__row:has(> .nxs-document-tree__label:text-is("${label}")) .nxs-document-tree__arrow`,
    region: 'nxs-document-tree',
    // BrowseService.getNavTreeChildren asks the tree_children page provider, not @children.
    failPattern: '**/search/pp/tree_children/execute**',
  },
  // breadcrumbs/breadcrumbs.component.ts: the selector is plural.
  breadcrumb: { items: 'nxs-breadcrumbs nav li', nav: 'nxs-breadcrumbs nav' },
  // permissions-panel/permissions-panel.component.html: one table row per entry, no tabs, and its
  // save outcome is reported inside the panel rather than in a snack bar.
  permissions: {
    root: 'nxs-permissions-panel',
    async open(page, h, path) {
      await h.goTo(`/#/browse${path}`);
      await page.locator('[role="tab"]').filter({ hasText: 'Permissions' }).first().click();
      await page.waitForTimeout(2500);
    },
    async showTab(page, label) {
      const tab = page.locator('nxs-permissions-panel [role="tab"]').filter({ hasText: label });
      if (await tab.count()) await tab.first().click();
      await page.waitForTimeout(800);
    },
    rows: 'nxs-permissions-panel tr[role="row"]',
    accessControl: 'mat-select',
    options: '.cdk-overlay-container mat-option',
    save: 'nxs-permissions-panel button',
    feedback:
      'nxs-permissions-panel .nxs-permissions-panel__status, nxs-permissions-panel .nxs-permissions-panel__alert, mat-snack-bar-container, nxs-toast',
  },
  // libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts: there is no nxs- viewer;
  // the document page renders lib-document-viewer, reached from the row's open button.
  viewer: {
    root: 'lib-document-viewer',
    async open(page, A, title) {
      await page
        .locator(A.list.rows)
        .filter({ hasText: title })
        .first()
        .locator('.nxs-document-list__open')
        .first()
        .click();
      await page.waitForTimeout(5000);
    },
    async close(page) {
      await page.goBack();
      await page.waitForTimeout(1500);
    },
  },
  // properties-panel/properties-panel.component.html, on the document page's details panel.
  properties: {
    provenance: 'nxs-properties-panel',
    root: 'nxs-properties-panel',
    async open(page, h, uid) {
      await h.goToDoc(uid);
      await page.waitForTimeout(2500);
    },
  },
  // manage-versions/manage-versions.component.html: the versions are a mat-menu, rendered in the
  // overlay only once the trigger is pressed. A document without versions has no trigger.
  versions: {
    provenance: 'nxs-manage-versions',
    root: 'nxs-manage-versions',
    async open(page, h, uid) {
      await page.keyboard.press('Escape'); // a menu left open by the previous read
      await h.goToDoc(uid);
      await page.waitForTimeout(2500);
      const trigger = page.locator('nxs-manage-versions .nxs-manage-versions__trigger');
      if (await trigger.count()) {
        await trigger.first().click().catch(leaveItToTheNextCheck);
        await page.waitForTimeout(1500);
      }
    },
    async read(page) {
      const root = page.locator('nxs-manage-versions').first();
      const hasMenu =
        (await root.locator('.nxs-manage-versions__trigger').count()) > 0 &&
        (await page.locator('.cdk-overlay-container .nxs-manage-versions__menu').count()) > 0;
      const menu = page.locator('.cdk-overlay-container .nxs-manage-versions__menu').first();
      const scope = hasMenu ? menu : root;
      const rootText = (await root.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const text = hasMenu
        ? (await menu.innerText().catch(() => '')).replace(/\s+/g, ' ')
        : rootText;
      return {
        labels: hasMenu
          ? (
              await menu
                .locator('.nxs-manage-versions__version .nxs-manage-versions__number')
                .allInnerTexts()
                .catch(() => [])
            ).map((t) => t.trim())
          : [],
        live: rootText.match(/1\.0\+|current version/i)?.[0] ?? '',
        restore: await scope.getByRole('menuitem', { name: /restore/i }).count(),
        create: await scope.locator('.nxs-manage-versions__create:not([disabled])').count(),
        empty: /no (previous )?versions/i.test(text) ? text.slice(0, 120) : '',
        text: text.slice(0, 300),
      };
    },
  },
  // search/search.html (table view: a CSS-grid div.result-list, not nxs-document-list) and the
  // filters drawer's search-filters.component.html, which the nav drawer mounts outside lib-search.
  search: {
    route: '/#/search',
    input: 'nxs-search-filters input[type="search"]',
    rows: 'lib-search .result-list .list-row',
    title: '.row-name-text',
    next: 'lib-search [aria-label="Next page"]',
    count: 'lib-search .results-count',
    none: 'lib-search .results-empty',
    error: 'lib-search nxs-error-state',
    failPattern: '**/search/**',
  },
};

/**
 * Negative control: the upstream surface judged against the parity targets. Every gap check must
 * fail here — that is what proves the after-half cannot pass by behaving like upstream.
 */
const ADF_HX_AS_TARGET = { ...ADF_HX, id: 'adf-hx-as-target', knownGaps: new Set() };

const SURFACES = {
  'adf-hx': ADF_HX,
  'adf-hx-remount': ADF_HX_REMOUNT,
  'adf-hx-as-target': ADF_HX_AS_TARGET,
  nxs: NXS,
};

// ── Small readers. ARIA first, so most assertions do not care which primitive renders. ──────────

async function readRows(page, rowsSel, titleSel) {
  return page
    .$$eval(
      rowsSel,
      (rows, title) =>
        rows.map((r) => ({
          title: (r.querySelector(title)?.textContent ?? '').trim(),
          selected: r.getAttribute('aria-selected') === 'true',
          name: r.getAttribute('aria-label'),
          tabindex: r.getAttribute('tabindex'),
        })),
      titleSel,
    )
    .catch(() => []);
}

async function readHeaders(page, A) {
  return page
    .$$eval(A.list.headers, (hs) =>
      hs.map((h) => ({
        label: (h.getAttribute('aria-label') ?? h.textContent ?? '').trim(),
        sort: h.getAttribute('aria-sort'),
        // `tabIndex` rather than the attribute, so a native button counts; the resize handle does not.
        focusable: [h, ...h.querySelectorAll('*')].filter(
          (e) => e.tabIndex >= 0 && !e.disabled && e.getAttribute('role') !== 'slider',
        ).length,
      })),
    )
    .catch(() => []);
}

async function readTree(page, A) {
  return page
    .$$eval(
      A.tree.node,
      (nodes, labelSel) =>
        nodes.map((n) => ({
          label: (n.querySelector(labelSel)?.textContent ?? n.textContent ?? '').trim(),
          level: Number(n.getAttribute('aria-level')),
          expanded: n.getAttribute('aria-expanded'),
          current: n.getAttribute('aria-current'),
          selected: n.getAttribute('aria-selected'),
        })),
      A.tree.label,
    )
    .catch(() => []);
}

/** The children rendered directly under `label`, read from tree order and aria-level. */
function treeChildren(nodes, label) {
  const i = nodes.findIndex((n) => n.label === label);
  if (i < 0) return { found: false, level: NaN, expanded: null, children: [] };
  const level = nodes[i].level;
  const children = [];
  for (let j = i + 1; j < nodes.length && nodes[j].level > level; j++) {
    if (nodes[j].level === level + 1) children.push(nodes[j]);
  }
  return { found: true, level, expanded: nodes[i].expanded, children };
}

async function waitForList(page, A, timeout = 15_000) {
  await page
    .locator(`${A.list.rows}, ${A.list.empty}, ${A.list.error}`)
    .first()
    .waitFor({ state: 'visible', timeout })
    .catch(leaveItToTheNextCheck);
  await page.waitForTimeout(600);
}

/** Paged item titles from `from` to `to`, inclusive, in that direction. */
const titleRange = (from, to) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) =>
    pagedTitle(from < to ? from + i : from - i),
  );

/** Every rendered row, in order: endpoints alone would admit missing, duplicated or swapped rows. */
const sameOrder = (rows, titles) =>
  JSON.stringify(rows.map((r) => r.title)) === JSON.stringify(titles);

const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export default async function run(page, h, outDir) {
  const surfaceId = process.env['PARITY_SURFACE'] ?? 'adf-hx';
  const A = SURFACES[surfaceId];
  const runStart = Date.now();
  const marks = [];
  const mark = (name, edge) => marks.push({ name, edge, seconds: (Date.now() - runStart) / 1000 });

  /**
   * On an adf-hx surface, passes only when the documented wrong behaviour is affirmatively seen —
   * never merely because the correct one was not. On nxs, passes only when the correct one is.
   * The observation goes into the gap check's name because the runner keeps a detail only on failure,
   * and the before-half's report has to show what upstream actually did.
   */
  const gap = (id, { correct, wrongObserved, expect, observed }) =>
    A.knownGaps.has(id)
      ? h.check(
          `[known upstream gap reproduced] ${id}: upstream does not ${expect} — observed: ${observed}`,
          Boolean(wrongObserved) && !correct,
          `the documented upstream defect was not affirmatively observed — ${observed}`,
        )
      : h.check(`[parity target] ${id}: ${expect}`, correct, observed);

  /** Every request to the Nuxeo API, so claims about sort, paging and refusals are made at the wire. */
  const wire = [];
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/nuxeo/api/v1/')) return;
    wire.push({
      method: res.request().method(),
      url: decodeURIComponent(url),
      raw: url,
      status: res.status(),
    });
  });
  /** A state's text only if it is visible: an attached but hidden template must not count. */
  const visibleText = async (selector) => {
    const el = page.locator(selector).first();
    if (!(await el.isVisible().catch(() => false))) return '';
    return el.innerText().catch(() => '');
  };
  const warnings = [];
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  /** Failures this run provokes on purpose. Health ignores exactly these, nothing broader. */
  const provoked = new Set();
  const fail500 = async (pattern) => {
    await page.route(pattern, (route) => {
      provoked.add(`HTTP 500 ${new URL(route.request().url()).pathname}`);
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          'entity-type': 'exception',
          status: 500,
          message: 'parity: simulated server error',
        }),
      });
    });
  };

  // ── 1. Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step(`Preconditions — surface "${surfaceId}" and the seeded parity fixture`);
  h.requirePrecondition(
    'PARITY_SURFACE names a known surface',
    Boolean(A),
    `"${surfaceId}" is not one of ${Object.keys(SURFACES).join(', ')}`,
  );
  h.requirePrecondition(
    'PARITY_USER_PASS is set',
    Boolean(process.env['PARITY_USER_PASS']),
    'export the same PARITY_USER_PASS the seed script used; the permission-denied steps sign in as parity-user',
  );
  const api = `${h.baseUrl}/nuxeo/api/v1`;
  const getJson = async (path, headers = {}) => {
    const res = await page.request
      .get(`${api}${path}`, { headers, failOnStatusCode: false })
      .catch(noAnswer);
    return { status: res?.status() ?? 0, data: res ? await res.json().catch(noAnswer) : null };
  };
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const childTitles = async (path) =>
    ((await getJson(`/path${enc(path)}/@children?pageSize=50`)).data?.entries ?? []).map(
      (e) => e.title,
    );
  const localAces = (acl) =>
    ((acl?.acl ?? []).find((a) => a.name === 'local')?.ace ?? []).map(
      (a) => `${a.username}:${a.permission}`,
    );
  const paged = await getJson(`/path${enc(PAGED.path)}/@children?pageSize=500`, {
    properties: 'dublincore',
  });
  const pagedEntries = paged.data?.entries ?? [];
  const contract = await getJson(`/path${enc(VERSIONS.doc)}`, { 'fetch-document': 'versionLabel' });
  const unversioned = await getJson(`/path${enc(VERSIONS.unversioned)}`, {
    'fetch-document': 'versionLabel',
  });
  const versionList = contract.data?.uid
    ? await page.request
        .post(`${api}/id/${contract.data.uid}/@op/Document.GetVersions`, {
          headers: { 'Content-Type': 'application/json', 'fetch-document': 'versionLabel' },
          data: { params: {}, context: {} },
          failOnStatusCode: false,
        })
        .then((r) => r.json())
        .catch(noAnswer)
    : null;
  const media = await getJson(`/path${enc(MEDIA.path)}/@children?pageSize=10`, {
    properties: 'file',
  });
  const mediaTypes = (media.data?.entries ?? [])
    .map((e) => `${e.title}:${e.properties?.['file:content']?.['mime-type']}`)
    .sort();
  const deepChildren = [];
  for (let n = 1; n <= DEEP_LEVELS; n++) deepChildren.push(await childTitles(deepPath(n)));
  const parityBasic = Buffer.from(`${ACL.user}:${process.env['PARITY_USER_PASS']}`).toString(
    'base64',
  );
  // Node's `fetch`, not `page.request`: the runner's `httpCredentials` use `send: 'always'`, which
  // replaces an explicit `Authorization` on `page.request`, so this asked who the *administrator*
  // was and the invariant could never hold (NXSAT-643). The guard's probe refuses a redirect and
  // bounds headers and body together, so a `/me` that never finishes fails this precondition.
  const parityMe = (await askThroughFetch(`${api}/me`, `Basic ${parityBasic}`)).body;
  // Every fixture a later step reads, so drift aborts here as precondition-not-met instead of
  // surfacing later as what would look like a component defect.
  const fixture = {
    'paged has Paged item 001-125': sameSet(
      pagedEntries.map((e) => e.title),
      Array.from({ length: PAGED.count }, (_, i) => pagedTitle(i + 1)),
    ),
    'every paged item carries the search token':
      pagedEntries.length === PAGED.count &&
      pagedEntries.every((e) =>
        String(e.properties?.['dc:description'] ?? '').includes(SEARCH.token),
      ),
    'the deep chain has its children at every level': deepChildren.every((titles, i) =>
      sameSet(titles, [
        `Deep L${i + 1} file`,
        `Deep L${i + 1} side`,
        ...(i + 1 < DEEP_LEVELS ? [deepTitle(i + 2)] : []),
      ]),
    ),
    'the acl folder holds AddChildren and ReadWrite': sameSet(
      localAces((await getJson(`/path${enc(ACL.path)}/@acl`)).data),
      ['parity-user:AddChildren', 'members:ReadWrite'],
    ),
    'the acl memo holds WriteVersion': sameSet(
      localAces((await getJson(`/path${enc(ACL.doc)}/@acl`)).data),
      ['parity-user:WriteVersion'],
    ),
    'the contract is 1.0+ with versions 0.1, 0.2, 1.0':
      contract.data?.versionLabel === VERSIONS.live &&
      sameSet(
        (versionList?.entries ?? []).map((e) => e.versionLabel),
        VERSIONS.labels,
      ),
    'the unversioned memo exists with no version':
      Boolean(unversioned.data?.uid) && ['0.0', ''].includes(unversioned.data?.versionLabel ?? ''),
    'the restricted folder holds Secret memo': sameSet(await childTitles(DENIED.path), [
      DENIED.doc,
    ]),
    'the empty folder is empty':
      (await getJson(`/path${enc(EMPTY.path)}/@children`)).status === 200 &&
      (await childTitles(EMPTY.path)).length === 0,
    'the media folder holds the four viewer fixtures':
      JSON.stringify(mediaTypes) ===
      JSON.stringify(
        [
          `${MEDIA.image}:image/png`,
          `${MEDIA.pdf}:application/pdf`,
          `${MEDIA.unknown}:application/octet-stream`,
          `${MEDIA.video}:video/webm`,
        ].sort(),
      ),
    'parity-user signs in with PARITY_USER_PASS': parityMe?.id === ACL.user,
  };
  const fixtureMisses = Object.entries(fixture)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  h.requirePrecondition(
    `the parity fixture holds everything the steps read (${Object.keys(fixture).length} invariants)`,
    fixtureMisses.length === 0,
    `not met: ${JSON.stringify(fixtureMisses)} — run seed-parity-data.mjs against this Nuxeo first`,
  );
  await h.login();
  h.requirePrecondition(
    `the ${surfaceId} surface renders on the browse route`,
    await A.present(page, h),
    {
      nxs: 'nxs-document-list is not rendered yet — the after-half cannot run before the components exist',
      'adf-hx-remount':
        'the Properties and Versions tabs are not on /browse-adf-hx — apply remount-sidebars.local.patch to the served checkout first',
    }[surfaceId] ??
      'hxp-document-list did not render on /browse-adf-hx — is the app served from a commit that still has the POC route?',
  );
  if (A.upstream) {
    const catalogue = await page.request
      .get(`${h.baseUrl}/assets/adf-core/i18n/en.json`, { failOnStatusCode: false })
      .catch(noAnswer);
    h.check(
      `${CTX} adf-core's translation catalogue is served, so upstream strings are not raw keys`,
      catalogue?.status() === 200,
      `HTTP ${catalogue?.status()}`,
    );
  }
  h.note(`surface: ${A.label}`);

  // ── 2. DocumentList: columns and default order ────────────────────────────────────────────────
  await h.step('DocumentList — columns and default order on a folder of 125 mixed children');
  await h.goTo(A.browse(PAGED.path));
  await waitForList(page, A);
  const headers0 = await readHeaders(page, A);
  const rows0 = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} column headers are Title, Modified, Last Contributor, in that order`,
    JSON.stringify(headers0.map((x) => x.label)) ===
      JSON.stringify(['Title', 'Modified', 'Last Contributor']),
    `rendered ${JSON.stringify(headers0.map((x) => x.label))}`,
  );
  h.check(
    `${LB} the first server page lists 50 rows, Paged item 001 to 050, by title ascending`,
    sameOrder(rows0, titleRange(1, 50)),
    `${rows0.length} rows, first ${rows0[0]?.title}, last ${rows0.at(-1)?.title}`,
  );
  const titleHeader0 = headers0.find((x) => x.label === 'Title');
  gap('list.aria-sort-initial', {
    correct:
      headers0.every((x) => !x.sort || x.sort === 'none') ||
      (titleHeader0?.sort === 'ascending' &&
        headers0.filter((x) => x !== titleHeader0).every((x) => !x.sort || x.sort === 'none')),
    wrongObserved: headers0.length === 3 && headers0.every((x) => x.sort === 'Descending'),
    expect: "report the opening order in aria-sort (title ascending, or 'none' everywhere)",
    observed: `aria-sort ${JSON.stringify(headers0.map((x) => `${x.label}=${x.sort}`))} while the rows are in title-ascending order`,
  });
  const typeMarks = await page
    .locator(
      `${A.list.rows} img, ${A.list.rows} mat-icon, ${A.list.rows} svg:not(.mdc-checkbox__checkmark)`,
    )
    .count();
  h.note(
    `type indicators rendered in the rows (icons): ${typeMarks}; the page holds 10 Folders, 10 Notes and 30 Files`,
  );
  await h.screenshot('list-default-columns');

  // ── 3. DocumentList: server sort ──────────────────────────────────────────────────────────────
  await h.step(
    'DocumentList — sort by Title descending reaches the server, and the header says so',
  );
  const titleControl = page.locator(A.list.headerControl('Title')).first();
  /** Clicks the Title header until the first row is `first`; the header cycles, so at most three. */
  const sortTitleUntilFirst = async (first) => {
    for (let i = 0; i < 3; i++) {
      const r = await readRows(page, A.list.rows, A.list.title);
      if (r[0]?.title === first) return;
      await titleControl.click();
      await page.waitForTimeout(2500);
    }
  };
  await sortTitleUntilFirst(pagedTitle(PAGED.count));
  const rowsDesc = await readRows(page, A.list.rows, A.list.title);
  const headersDesc = await readHeaders(page, A);
  const descRequest = wire.filter(
    (w) => /sortBy=dc:title/.test(w.url) && /sortOrder=desc/i.test(w.url),
  );
  h.check(
    `${LB} a request carried sortBy=dc:title and sortOrder=DESC, so the server ordered the rows`,
    descRequest.length > 0,
    `last list requests: ${JSON.stringify(
      wire
        .filter((w) => w.url.includes('sortBy'))
        .slice(-2)
        .map((w) => w.url.split('/api/v1')[1]),
    )}`,
  );
  h.check(
    `${LB} the rows read Paged item 125 down to 076`,
    sameOrder(rowsDesc, titleRange(125, 76)),
    `${rowsDesc.length} rows, first ${rowsDesc[0]?.title}, last ${rowsDesc.at(-1)?.title}`,
  );
  const titleDesc = headersDesc.find((x) => x.label === 'Title');
  gap('list.aria-sort-tokens', {
    correct:
      titleDesc?.sort === 'descending' &&
      headersDesc.filter((x) => x !== titleDesc).every((x) => !x.sort || x.sort === 'none'),
    wrongObserved:
      titleDesc?.sort === 'Descending' &&
      headersDesc.filter((x) => x !== titleDesc).every((x) => x.sort === 'None'),
    expect:
      "use the ARIA tokens: 'descending' on the sorted header and 'none' (or nothing) on the others",
    observed: `aria-sort ${JSON.stringify(headersDesc.map((x) => `${x.label}=${x.sort}`))}`,
  });
  const live = await page
    .$$eval('[aria-live="polite"], [aria-live="assertive"], .cdk-live-announcer-element', (els) =>
      els.map((e) => (e.textContent ?? '').trim()).filter(Boolean),
    )
    .catch(() => []);
  gap('list.sort-announced', {
    correct: live.some((t) => /title/i.test(t) && /desc/i.test(t)),
    wrongObserved: descRequest.length > 0 && !live.some((t) => /title/i.test(t)),
    expect: 'announce the new sort order through a live region',
    observed: `live regions read ${JSON.stringify(live.slice(0, 4))}`,
  });
  await h.screenshot('list-sorted-title-desc');

  await h.step('DocumentList — a sort header is reachable and operable by keyboard');
  h.check(
    `${LB} each of the three sortable headers holds exactly one keyboard-focusable sort control`,
    headersDesc.length === 3 && headersDesc.every((x) => x.focusable === 1),
    `focusable controls per header ${JSON.stringify(headersDesc.map((x) => `${x.label}:${x.focusable}`))}`,
  );
  const beforeKeySort = wire.length;
  await page.locator(A.list.headerControl('Modified')).first().focus();
  // The response itself, not a fixed sleep: a slow sorted page otherwise reads as "no request".
  const modifiedResponse = page
    .waitForResponse((r) => /sortBy=dc(%3A|:)modified/.test(r.url()), { timeout: 20_000 })
    .catch(noAnswer);
  await page.keyboard.press('Enter');
  await modifiedResponse;
  await waitForList(page, A);
  const keySort = wire.slice(beforeKeySort).filter((w) => /sortBy=dc:modified/.test(w.url));
  h.check(
    `${LB} Enter on the focused Modified header asks the server for sortBy=dc:modified`,
    keySort.length > 0,
    `requests after Enter: ${JSON.stringify(
      wire
        .slice(beforeKeySort)
        .map((w) => w.url.split('/api/v1')[1])
        .slice(0, 3),
    )}`,
  );
  const rowsByModified = await readRows(page, A.list.rows, A.list.title);
  // The server's answer to the very request the UI made, so the claim is "the UI shows the
  // server's dc:modified order" rather than "the first row changed".
  const replay = keySort.at(-1)
    ? await page.request
        .get(keySort.at(-1).raw, { failOnStatusCode: false })
        .then((r) => r.json())
        .catch(noAnswer)
    : null;
  const serverModifiedOrder = (replay?.entries ?? []).map((e) => e.title);
  h.check(
    `${LB} the rows are exactly the server's dc:modified page, in its order`,
    serverModifiedOrder.length === PAGED.pageSize && sameOrder(rowsByModified, serverModifiedOrder),
    `rendered ${JSON.stringify(rowsByModified.slice(0, 3).map((r) => r.title))}…, server ${JSON.stringify(serverModifiedOrder.slice(0, 3))}…`,
  );
  h.check(
    `${LB} modified order differs from title order (the fixture was created shuffled)`,
    rowsByModified.length === PAGED.pageSize &&
      rowsByModified[0]?.title !== pagedTitle(1) &&
      rowsByModified[0]?.title !== pagedTitle(125),
    `first row by modified: ${rowsByModified[0]?.title}`,
  );
  await h.screenshot('list-sorted-modified-by-keyboard');

  // ── 4. DocumentList: server paging ───────────────────────────────────────────────────────────
  await h.step('DocumentList — server paging to page 2 and to page 3, beyond the first two');
  await h.goTo(A.browse(EMPTY.path));
  await h.goTo(A.browse(PAGED.path));
  await waitForList(page, A);
  await sortTitleUntilFirst(pagedTitle(1));
  const next = page.locator(A.list.next).first();
  const beforeP2 = wire.length;
  await next.click();
  await page.waitForTimeout(2500);
  const p2 = await readRows(page, A.list.rows, A.list.title);
  const p2Range = await page
    .locator(A.list.range)
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    `${LB} page 2 was fetched from the server (currentPageIndex=1)`,
    wire.slice(beforeP2).some((w) => /currentPageIndex=1\b/.test(w.url)),
    JSON.stringify(
      wire
        .slice(beforeP2)
        .map((w) => w.url.split('/api/v1')[1])
        .slice(0, 2),
    ),
  );
  h.check(
    `${LB} page 2 lists Paged item 051 to 100`,
    sameOrder(p2, titleRange(51, 100)),
    `${p2.length} rows, ${p2[0]?.title} … ${p2.at(-1)?.title}`,
  );
  h.check(
    `${CTX} the pager reports the page 2 range`,
    /51\D+100/.test(p2Range),
    `pager read ${JSON.stringify(p2Range)}`,
  );
  const beforeP3 = wire.length;
  await next.click();
  await page.waitForTimeout(2500);
  const p3 = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} page 3 was fetched from the server (currentPageIndex=2)`,
    wire.slice(beforeP3).some((w) => /currentPageIndex=2\b/.test(w.url)),
    JSON.stringify(
      wire
        .slice(beforeP3)
        .map((w) => w.url.split('/api/v1')[1])
        .slice(0, 2),
    ),
  );
  h.check(
    `${LB} page 3 lists the last 25, Paged item 101 to 125`,
    sameOrder(p3, titleRange(101, 125)),
    `${p3.length} rows, ${p3[0]?.title} … ${p3.at(-1)?.title}`,
  );
  h.check(
    `${NEG} Next is disabled on the last page`,
    p3.length === 25 && (await next.isDisabled().catch(() => false)),
  );
  await h.screenshot('list-page-3-of-3');
  await page.locator(A.list.previous).first().click();
  await page.waitForTimeout(2500);
  const back = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} Previous returns to page 2`,
    back[0]?.title === pagedTitle(51) && back.length === 50,
    `${back[0]?.title}`,
  );

  // ── 5. DocumentList: selection ───────────────────────────────────────────────────────────────
  await h.step('DocumentList — single, multiple and range selection by pointer');
  await h.goTo(A.browse(EMPTY.path));
  await h.goTo(A.browse(PAGED.path));
  await waitForList(page, A);
  await sortTitleUntilFirst(pagedTitle(1));
  const rowLoc = (i) => page.locator(A.list.rows).nth(i);
  const selectedTitles = async () =>
    (await readRows(page, A.list.rows, A.list.title)).filter((r) => r.selected).map((r) => r.title);
  await rowLoc(1).locator(A.list.checkbox).first().click();
  await page.waitForTimeout(500);
  const single = await selectedTitles();
  h.check(
    `${LB} ticking row 2 selects exactly Paged item 002 (aria-selected)`,
    sameSet(single, [pagedTitle(2)]),
    JSON.stringify(single),
  );
  const bar1 = await page
    .locator('lib-selection-topbar')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    `${CTX} the shell selection bar counts one item`,
    /\b1 item\b/.test(bar1),
    JSON.stringify(bar1.slice(0, 60)),
  );
  await rowLoc(3).locator(A.list.checkbox).first().click();
  await page.waitForTimeout(500);
  const multi = await selectedTitles();
  h.check(
    `${LB} ticking row 4 as well selects 002 and 004`,
    sameSet(multi, [pagedTitle(2), pagedTitle(4)]),
    JSON.stringify(multi),
  );
  await rowLoc(6)
    .locator(A.list.checkbox)
    .first()
    .click({ modifiers: ['Shift'] });
  await page.waitForTimeout(500);
  const ranged = await selectedTitles();
  gap('list.range-select', {
    correct: sameSet(ranged, [2, 4, 5, 6, 7].map(pagedTitle)),
    wrongObserved: sameSet(ranged, [2, 4, 7].map(pagedTitle)),
    expect: 'extend the selection from the anchor with Shift+click (004 to 007)',
    observed: `selected after Shift+click on row 7: ${JSON.stringify(ranged)}`,
  });
  await h.screenshot('list-selection-multi-and-shift');

  await h.step('DocumentList — select all on the page, then clear');
  await page.locator(A.list.selectAll).first().click();
  await page.waitForTimeout(600);
  const all = await selectedTitles();
  h.check(
    `${LB} the header checkbox selects all 50 rows of the page`,
    all.length === 50,
    `${all.length} selected`,
  );
  await h.screenshot('list-select-all-on-page');
  await page.locator(A.list.selectAll).first().click();
  await page.waitForTimeout(600);
  const cleared = await selectedTitles();
  h.check(
    `${NEG} clicking it again clears the selection`,
    all.length === 50 && cleared.length === 0,
    `${cleared.length} still selected`,
  );

  await h.step('DocumentList — keyboard: Space selects, arrows move, every row has a name');
  const rowsK = await readRows(page, A.list.rows, A.list.title);
  // The computed name, from the accessibility tree: an absent or empty aria-label says nothing about
  // it, because a row can take its name from its cells. Read before any row is selected, since
  // selection adds a state word to the name.
  const rowNames = [];
  for (let i = 0; i < Math.min(5, rowsK.length); i++) {
    const snapshot = await rowLoc(i)
      .ariaSnapshot()
      .catch(() => '');
    rowNames.push({ title: rowsK[i].title, name: snapshot.match(/^- row "([^"]*)"/)?.[1] ?? null });
  }
  await rowLoc(0).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const afterSpace = await selectedTitles();
  h.check(
    `${LB} Space on the focused first row selects it`,
    sameSet(afterSpace, [pagedTitle(1)]),
    JSON.stringify(afterSpace),
  );
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  const focusedTitle = await page.evaluate(
    ({ rowsSel, titleSel }) => {
      const a = document.activeElement;
      const row = a?.closest(rowsSel.split(' ').at(-1)) ?? null;
      return row
        ? (row.querySelector(titleSel)?.textContent ?? '').trim()
        : `(focus on ${a?.tagName})`;
    },
    { rowsSel: A.list.rows, titleSel: A.list.title },
  );
  gap('list.arrow-keys', {
    correct: focusedTitle === pagedTitle(2),
    wrongObserved: focusedTitle === pagedTitle(1),
    expect: 'move focus to the next row on ArrowDown',
    observed: `focus after ArrowDown is on ${JSON.stringify(focusedTitle)}`,
  });
  gap('list.row-name', {
    correct: rowNames.length === 5 && rowNames.every((r) => r.name?.includes(r.title)),
    wrongObserved:
      rowNames.length === 5 &&
      rowNames.every((r) => r.name !== null && !r.name.includes(r.title)) &&
      new Set(rowNames.map((r) => r.name)).size === 1,
    expect: "give each row a computed accessible name that includes the document's title",
    observed: `computed names of the first five rows ${JSON.stringify(rowNames.map((r) => r.name))}`,
  });
  const tabStops = rowsK.filter((r) => r.tabindex === '0').length;
  gap('list.roving-tabindex', {
    correct: tabStops === 1,
    wrongObserved: rowsK.length === 50 && tabStops === 50,
    expect: 'keep a single row in the tab sequence (roving tabindex)',
    observed: `${tabStops} of ${rowsK.length} rows have tabindex=0`,
  });
  await h.screenshot('list-keyboard-space-selects');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  // ── 6. DocumentList: empty state ─────────────────────────────────────────────────────────────
  await h.step('DocumentList — empty folder shows an empty state, not a blank table');
  await h.goTo(A.browse(EMPTY.path));
  await waitForList(page, A);
  const emptyText = await visibleText(A.list.empty);
  const emptyRows = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} the empty state says the folder is empty`,
    /empty/i.test(emptyText),
    JSON.stringify(emptyText),
  );
  h.check(
    `${NEG} no rows are rendered`,
    /empty/i.test(emptyText) && emptyRows.length === 0,
    `${emptyRows.length} rows`,
  );
  await h.screenshot('list-empty-folder');

  // ── 7. DocumentTree ──────────────────────────────────────────────────────────────────────────
  await h.step('DocumentTree — expand by hand to six levels below the workspace (aria-level 10)');
  mark('tree', 'start');
  await h.goTo(A.browse(ROOT));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const warningsBeforeTree = warnings.length;
  const rootKids = treeChildren(await readTree(page, A), 'Parity fixtures');
  h.check(
    `${LB} the workspace node is expanded with its seven folders as children`,
    rootKids.found &&
      rootKids.expanded === 'true' &&
      sameSet(
        rootKids.children.map((c) => c.label),
        [
          ACL.title,
          deepTitle(1),
          'Empty folder',
          PAGED.title,
          DENIED.title,
          'Versions',
          'Viewer fixtures',
        ],
      ),
    `${JSON.stringify(rootKids.children.map((c) => c.label))} at level ${rootKids.level}, aria-expanded=${rootKids.expanded}`,
  );
  for (let n = 1; n <= DEEP_LEVELS; n++) {
    await page
      .locator(A.tree.toggle(deepTitle(n)))
      .first()
      .click()
      .catch(leaveItToTheNextCheck);
    await page
      .locator(A.tree.node)
      .filter({ hasText: `Deep L${n} side` })
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(leaveItToTheNextCheck);
    await page.waitForTimeout(400);
    const kids = treeChildren(await readTree(page, A), deepTitle(n));
    const want = n < DEEP_LEVELS ? [`Deep L${n} side`, deepTitle(n + 1)] : [`Deep L${n} side`];
    h.check(
      `${LB} expanding ${deepTitle(n).slice(0, 7)} renders its children at aria-level ${rootKids.level + n + 1}`,
      kids.found &&
        sameSet(
          kids.children.map((c) => c.label),
          want,
        ) &&
        kids.children.every((c) => c.level === rootKids.level + n + 1),
      `children ${JSON.stringify(kids.children.map((c) => `${c.level}:${c.label}`))}`,
    );
  }
  const expandedChain = (await readTree(page, A)).filter(
    (x) => /^Deep L\d( |$)/.test(x.label) && !/side$/.test(x.label),
  );
  h.check(
    `${LB} every node on the chain reports aria-expanded="true"`,
    expandedChain.length === DEEP_LEVELS && expandedChain.every((x) => x.expanded === 'true'),
    JSON.stringify(expandedChain.map((x) => `${x.label.slice(0, 7)}=${x.expanded}`)),
  );
  if (A.upstream) {
    const folderishSort = warnings
      .slice(warningsBeforeTree)
      .filter((w) => w.includes('sys_isFolderish desc'));
    h.check(
      `${CTX} upstream's tree still requests the folders-first sort Nuxeo cannot serve, and the bridge drops it`,
      folderishSort.length > 0,
      `${folderishSort.length} "Ignoring sort sys_isFolderish desc" warning(s) while expanding`,
    );
  }
  await h.screenshot('tree-expanded-to-depth');

  await h.step('DocumentTree — a fresh load deep-linked six levels down opens the whole branch');
  await h.goTo(A.browse(deepPath(DEEP_LEVELS)));
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator(A.tree.node)
    .filter({ hasText: 'Deep L6 side' })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(leaveItToTheNextCheck);
  await page.waitForTimeout(1500);
  const deepNodes = await readTree(page, A);
  const leaf = treeChildren(deepNodes, deepTitle(DEEP_LEVELS));
  h.check(
    `${LB} after page.reload() at the deep URL, Deep L6's child renders at aria-level ${rootKids.level + DEEP_LEVELS + 1}`,
    leaf.found &&
      leaf.children.length === 1 &&
      leaf.children[0].label === 'Deep L6 side' &&
      leaf.children[0].level === rootKids.level + DEEP_LEVELS + 1,
    JSON.stringify(leaf.children.map((c) => `${c.level}:${c.label}`)),
  );
  const chainOpen = deepNodes.filter(
    (x) => /^Deep L\d( |$)/.test(x.label) && !/side$/.test(x.label),
  );
  h.check(
    `${LB} every ancestor on the deep path is expanded`,
    chainOpen.length === DEEP_LEVELS && chainOpen.every((x) => x.expanded === 'true'),
    JSON.stringify(chainOpen.map((x) => `${x.label.slice(0, 7)}=${x.expanded}`)),
  );
  // Hit-testing along each label, so clipping by the drawer counts as not visible even though the
  // node is in the DOM and has a box. Measured before anything is focused, which would scroll it.
  const legibility = await page
    .$$eval(
      A.tree.node,
      (nodes, labelSel) =>
        nodes.map((n) => {
          const el = n.querySelector(labelSel) ?? n;
          const r = el.getBoundingClientRect();
          const y = r.top + r.height / 2;
          let hits = 0;
          let samples = 0;
          for (let x = r.left + 2; x <= r.right - 2; x += 3) {
            samples++;
            const hit = document.elementFromPoint(x, y);
            if (hit && el.contains(hit)) hits++;
          }
          return {
            label: (el.textContent ?? '').trim(),
            level: Number(n.getAttribute('aria-level')),
            visible: samples ? Math.round((hits / samples) * 100) / 100 : 0,
          };
        }),
      A.tree.label,
    )
    .catch(() => []);
  const deepest = legibility.filter((x) => x.level >= rootKids.level + 4);
  gap('tree.depth-legible', {
    correct: deepest.length >= 6 && deepest.every((x) => x.visible >= 0.9),
    wrongObserved: deepest.length >= 6 && deepest.some((x) => x.visible < 0.5),
    expect: 'keep labels legible at depth without horizontal scrolling',
    observed: `visible fraction of each label from aria-level ${rootKids.level + 4} down: ${JSON.stringify(deepest.map((x) => `${x.level}:${x.label.slice(0, 12)}=${x.visible}`))}`,
  });
  const currentNode = deepNodes.find((x) => x.label === deepTitle(DEEP_LEVELS));
  gap('tree.current-indicated', {
    correct:
      Boolean(currentNode) && (currentNode.selected === 'true' || Boolean(currentNode.current)),
    wrongObserved: Boolean(currentNode) && currentNode.selected !== 'true' && !currentNode.current,
    expect: 'mark the folder on screen with aria-selected or aria-current',
    observed: `Deep L6 node: ${JSON.stringify(currentNode ?? null)}`,
  });
  await h.screenshot('tree-deep-link-fresh-load');

  await h.step('DocumentTree — a server error while expanding a node');
  await h.goTo(A.browse(ROOT));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await fail500(A.tree.failPattern);
  const beforeTree500 = wire.length;
  await page.locator(A.tree.toggle(PAGED.title)).first().click().catch(leaveItToTheNextCheck);
  await page.waitForTimeout(3500);
  const tree500 = wire.slice(beforeTree500).filter((w) => w.status === 500);
  const pagedKids = treeChildren(await readTree(page, A), PAGED.title);
  // Visible ones only: a hidden template or container must not count as telling the user.
  let treeAlert = 0;
  const treeAlertCandidates = page.locator(
    `${A.tree.region} [role="alert"], ${A.tree.region} .error, ${A.tree.region} :text-matches("error|failed|could not", "i")`,
  );
  for (const candidate of await treeAlertCandidates.all()) {
    if (await candidate.isVisible().catch(() => false)) treeAlert++;
  }
  h.check(
    `${CTX} the children request was answered 500`,
    tree500.length > 0,
    `${tree500.length} request(s) failed`,
  );
  h.check(
    `${NEG} no children are invented for the failed node`,
    tree500.length > 0 && pagedKids.found && pagedKids.children.length === 0,
    `${pagedKids.children.length} children`,
  );
  gap('tree.load-error-shown', {
    correct: treeAlert > 0,
    wrongObserved: tree500.length > 0 && treeAlert === 0,
    expect: 'tell the user that a folder failed to load',
    observed: `${treeAlert} error indication(s) in the tree after a 500`,
  });
  await h.screenshot('tree-children-500-silent');
  await page.unroute(A.tree.failPattern);
  mark('tree', 'end');

  // ── 8. Breadcrumb ────────────────────────────────────────────────────────────────────────────
  await h.step('Breadcrumb — a ten-crumb path with an 80-character title');
  await h.goTo(A.browse(deepPath(DEEP_LEVELS)));
  await waitForList(page, A);
  const crumbs = await page
    .$$eval(A.breadcrumb.items, (lis) =>
      lis.map((li) => {
        const a = li.querySelector('a');
        const r = (a ?? li).getBoundingClientRect();
        const cs = a ? getComputedStyle(a) : null;
        return {
          text: (li.textContent ?? '').trim(),
          href: a?.getAttribute('href') ?? null,
          current: a?.getAttribute('aria-current') ?? li.getAttribute('aria-current'),
          width: Math.round(r.width),
          top: Math.round(r.top),
          title: a?.getAttribute('title') ?? li.getAttribute('title') ?? null,
          ellipsis:
            cs?.textOverflow === 'ellipsis' && (a?.scrollWidth ?? 0) > (a?.clientWidth ?? 0),
        };
      }),
    )
    .catch(() => []);
  const expectedCrumbs = [
    'Domain',
    'Workspaces',
    'Parity fixtures',
    ...Array.from({ length: DEEP_LEVELS }, (_, i) => deepTitle(i + 1)),
  ];
  h.check(
    `${LB} the crumbs after the root are the eight ancestors and the folder, in order`,
    JSON.stringify(crumbs.slice(1).map((c) => c.text)) === JSON.stringify(expectedCrumbs),
    JSON.stringify(crumbs.map((c) => c.text.slice(0, 20))),
  );
  const lastCrumb = crumbs.at(-1);
  h.check(
    `${LB} the folder on screen is the last crumb, marked aria-current and not a link`,
    Boolean(lastCrumb) &&
      lastCrumb.text === deepTitle(DEEP_LEVELS) &&
      ['location', 'page'].includes(lastCrumb.current) &&
      !lastCrumb.href,
    JSON.stringify(lastCrumb ?? null),
  );
  const ancestorPaths = [
    '/default-domain',
    '/default-domain/workspaces',
    ROOT,
    ...Array.from({ length: DEEP_LEVELS - 1 }, (_, i) => deepPath(i + 1)),
  ];
  const linksOk = crumbs.slice(1, -1).every((c, i) => c.href === A.crumbHref(ancestorPaths[i]));
  h.check(
    `${LB} every ancestor crumb below the root links to that ancestor's own browse URL`,
    crumbs.length === 10 && linksOk,
    JSON.stringify(crumbs.slice(1, -1).map((c) => c.href)),
  );
  const navBox = await page
    .locator(A.breadcrumb.nav)
    .first()
    .evaluate((n) => ({
      scroll: n.scrollWidth,
      client: n.clientWidth,
      label: n.getAttribute('aria-label'),
    }))
    .catch(() => ({ scroll: 0, client: 0, label: null }));
  const longCrumb = crumbs.find((c) => c.text.startsWith('Deep L5'));
  const lines = new Set(crumbs.map((c) => c.top)).size;
  h.check(
    `${CTX} the breadcrumb is a labelled navigation landmark`,
    Boolean(navBox.label),
    JSON.stringify(navBox.label),
  );
  h.note(
    `truncation, measured at 1440×900: the long crumb is ${longCrumb?.width}px wide, ellipsis=${longCrumb?.ellipsis}, ` +
      `title attribute=${JSON.stringify(longCrumb?.title)}; the trail spans ${lines} line(s); nav scrollWidth ${navBox.scroll} vs clientWidth ${navBox.client}`,
  );
  h.check(
    `${LB} the long title is reachable in full (rendered whole or exposed through a title attribute)`,
    Boolean(longCrumb) && (longCrumb.text === deepTitle(5) || longCrumb.title === deepTitle(5)),
    JSON.stringify(longCrumb ?? null),
  );
  gap('crumb.truncation', {
    correct:
      lines === 1 &&
      navBox.scroll <= navBox.client &&
      (!longCrumb?.ellipsis || longCrumb.title === deepTitle(5)),
    wrongObserved: Boolean(longCrumb) && lines > 1 && !longCrumb.ellipsis && !longCrumb.title,
    expect: 'keep a deep trail on one line, truncating a long crumb and exposing its full title',
    observed: `${lines} line(s); long crumb ${longCrumb?.width}px, ellipsis=${longCrumb?.ellipsis}, title=${JSON.stringify(longCrumb?.title)}`,
  });
  await h.screenshot('breadcrumb-deep-path');
  await page
    .locator(A.breadcrumb.items)
    .filter({ hasText: /^\s*Deep L3\s*$/ })
    .locator('a')
    .first()
    .click();
  await page.waitForTimeout(2500);
  await waitForList(page, A);
  const l3 = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} clicking the Deep L3 crumb opens Deep L3: its file, its side folder and Deep L4`,
    sameSet(
      l3.map((r) => r.title),
      ['Deep L3 file', 'Deep L3 side', 'Deep L4'],
    ),
    JSON.stringify(l3.map((r) => r.title)),
  );

  // ── 9. PropertiesPanel ───────────────────────────────────────────────────────────────────────
  await h.step(`PropertiesPanel — ${A.properties.provenance}`);
  await A.properties.open(page, h, contract.data?.uid);
  // Text plus form-control values: a read-only panel may render each value inside an input.
  const props = await page
    .locator(A.properties.root)
    .first()
    .evaluate((el) => ({
      text: (el.innerText ?? '').replace(/\s+/g, ' '),
      values: [...el.querySelectorAll('input, textarea')].map((i) => i.value).filter(Boolean),
      labels: [...el.querySelectorAll('mat-label, label, .doc-info-label')]
        .map((l) => (l.textContent ?? '').trim())
        .filter(Boolean),
    }))
    .catch(() => ({ text: '', values: [], labels: [] }));
  const propsText = `${props.text} ${props.values.join(' ')}`;
  h.check(
    `${LB} the panel shows the title "Versioned contract"`,
    propsText.includes(VERSIONS.docTitle),
    propsText.slice(0, 200),
  );
  h.check(
    `${LB} the panel shows the description "edited after approval"`,
    propsText.includes(VERSIONS.description),
    propsText.slice(0, 300),
  );
  h.check(
    `${LB} the panel shows the main file name`,
    propsText.includes(VERSIONS.fileName),
    propsText.slice(0, 300),
  );
  h.check(
    `${LB} the panel names the contributor`,
    propsText.includes('Administrator'),
    propsText.slice(0, 200),
  );
  gap('props.version-label', {
    correct: propsText.includes(VERSIONS.live),
    wrongObserved: propsText.includes(VERSIONS.docTitle) && !propsText.includes(VERSIONS.live),
    expect: 'show the live version label 1.0+',
    observed: `labels ${JSON.stringify(props.labels.slice(0, 30))}`,
  });
  gap('props.blob-rendered', {
    correct: propsText.includes(VERSIONS.docTitle) && !propsText.includes('[object Object]'),
    wrongObserved: propsText.includes('[object Object]'),
    expect: 'render the main file as a file, not as "[object Object]"',
    observed: `values ${JSON.stringify(props.values.slice(0, 12))}`,
  });
  const rawLabels = props.labels.filter((l) => /^[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+$/.test(l));
  gap('props.labels-translated', {
    correct: props.labels.length > 0 && rawLabels.length === 0,
    wrongObserved: rawLabels.length > 0,
    expect: 'label every field with readable text rather than a raw key',
    observed: `raw-key labels ${JSON.stringify(rawLabels.slice(0, 8))}`,
  });
  await h.screenshot('properties-panel');

  // ── 10. ManageVersions ───────────────────────────────────────────────────────────────────────
  await h.step(`ManageVersions — ${A.versions.provenance}`);
  await A.versions.open(page, h, contract.data?.uid);
  const v = await A.versions.read(page);
  h.check(
    `${LB} the three checked-in versions are listed: 1.0, 0.2 and 0.1`,
    sameSet(v.labels, VERSIONS.labels),
    `listed ${JSON.stringify(v.labels)}${v.text ? ` — ${v.text}` : ''}`,
  );
  h.note(`version order as rendered: ${JSON.stringify(v.labels)}`);
  h.check(
    `${LB} the live, checked-out version is identified`,
    /1\.0\+|current/i.test(v.live),
    JSON.stringify(v.live),
  );
  gap('versions.restore-offered', {
    correct: v.labels.length === 3 && v.restore >= 3,
    wrongObserved:
      v.labels.length === 3 &&
      v.restore === 0 &&
      Array.isArray(v.menus) &&
      v.menus.every((m) => m.length === 0),
    expect: 'offer a restore action on each listed version',
    observed: `${v.restore} restore control(s); version menus ${JSON.stringify(v.menus ?? null)}`,
  });
  gap('versions.create-offered', {
    correct: v.create >= 1,
    wrongObserved:
      v.labels.length === 3 &&
      v.create === 0 &&
      Array.isArray(v.menus) &&
      v.menus.every((m) => m.length === 0),
    expect: 'offer to create a version of a checked-out document',
    observed: `${v.create} create control(s)`,
  });
  h.note('restore is not clicked: it rewrites the live document and the remaining steps read it');
  await h.screenshot('versions-list');
  await A.versions.open(page, h, unversioned.data?.uid, 'Unversioned memo');
  const v0 = await A.versions.read(page);
  h.check(
    `${NEG} a document with no versions renders and lists no checked-in version`,
    v0.labels.length === 0 && (v0.create >= 1 || Boolean(v0.live) || Boolean(v0.empty)),
    JSON.stringify(v0),
  );
  gap('versions.none-explained', {
    correct: v0.create >= 1 || /no (previous )?versions/i.test(v0.empty),
    wrongObserved: Boolean(v0.live) && v0.create === 0 && !v0.empty,
    expect: 'say a document has no versions yet, or offer to create the first',
    observed: JSON.stringify({ live: v0.live, create: v0.create, empty: v0.empty }),
  });
  await h.screenshot('versions-none');

  // ── 11. PermissionsPanel ─────────────────────────────────────────────────────────────────────
  await h.step(
    'PermissionsPanel — an ACL holding AddChildren, outside Read / ReadWrite / Everything',
  );
  mark('permissions', 'start');
  await A.permissions.open(page, h, ACL.path);
  const permText = (
    await page
      .locator(A.permissions.root)
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  h.check(
    `${LB} the panel manages "ACL beyond three levels"`,
    permText.includes(ACL.title),
    permText.slice(0, 120),
  );
  const rowText = async () =>
    (
      await page
        .locator(A.permissions.rows)
        .allInnerTexts()
        .catch(() => [])
    ).map((t) => t.replace(/\s+/g, ' ').trim());
  await A.permissions.showTab(page, 'User Groups');
  const groupRows = await rowText();
  const membersRow = groupRows.find((t) => /members/i.test(t)) ?? '';
  h.check(
    `${LB} members shows inherited Read and its local Read & Write`,
    // Inherited is the column before the local one; a bare /Read/ would match "Read & Write" alone.
    /\bRead\b(?! &| and)[\s\S]*(Read & Write|ReadWrite|Read and write)/i.test(membersRow),
    JSON.stringify(groupRows),
  );
  await A.permissions.showTab(page, 'Individual Users');
  const userRows = await rowText();
  const parityRow = userRows.find((t) => t.includes(ACL.userLabel) || t.includes(ACL.user)) ?? '';
  h.check(`${LB} parity-user is listed`, parityRow.length > 0, JSON.stringify(userRows));
  gap('perm.non-expressible-shown', {
    correct: /add ?children/i.test(parityRow),
    wrongObserved: /Select Access/.test(parityRow) && !/add ?children/i.test(parityRow),
    expect: "show parity-user's local AddChildren permission",
    observed: `parity-user row reads ${JSON.stringify(parityRow)}`,
  });
  await h.screenshot('permissions-addchildren-not-shown');
  const parityControl = page
    .locator(A.permissions.rows)
    .filter({ hasText: ACL.userLabel })
    .locator(A.permissions.accessControl)
    .first();
  await parityControl.click().catch(leaveItToTheNextCheck);
  await page.waitForTimeout(800);
  const options = (
    await page
      .locator(A.permissions.options)
      .allInnerTexts()
      .catch(() => [])
  ).map((t) => t.replace(/\s+/g, ' ').trim());
  const grantable = options.filter((o) => !/^clear$/i.test(o));
  gap('perm.full-set', {
    correct:
      grantable.some((o) => /add ?children/i.test(o)) &&
      grantable.some((o) => /write ?version/i.test(o)),
    wrongObserved:
      grantable.length === 3 &&
      /^Read\b/.test(grantable[0]) &&
      /^Read & Write/.test(grantable[1]) &&
      /^Everything/.test(grantable[2]),
    expect:
      'offer the grantable permissions beyond the three levels, AddChildren and WriteVersion among them',
    observed: `offered ${JSON.stringify(options)}`,
  });
  await h.screenshot('permissions-three-levels-offered');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await h.step('PermissionsPanel — saving a change to another row of that ACL');
  await A.permissions.showTab(page, 'User Groups');
  const beforeSave = wire.length;
  await page
    .locator(A.permissions.rows)
    .filter({ hasText: /members/i })
    .locator(A.permissions.accessControl)
    .first()
    .click()
    .catch(leaveItToTheNextCheck);
  await page.waitForTimeout(600);
  await page
    .locator(A.permissions.options)
    .filter({ hasText: /^\s*Everything\s*$/ })
    .first()
    .click()
    .catch(leaveItToTheNextCheck);
  await page.waitForTimeout(600);
  await page
    .locator(A.permissions.save)
    .filter({ hasText: /^\s*Save\s*$/ })
    .first()
    .click()
    .catch(leaveItToTheNextCheck);
  await page.waitForTimeout(3500);
  const feedback = (
    await page
      .locator(A.permissions.feedback)
      .allInnerTexts()
      .catch(() => [])
  )
    .join(' ')
    .replace(/\s+/g, ' ');
  const afterAcl = localAces((await getJson(`/path${enc(ACL.path)}/@acl`)).data);
  const writes = wire.slice(beforeSave).filter((w) => w.method !== 'GET');
  h.check(
    `${LB} parity-user's AddChildren survives the save — nothing outside the panel's vocabulary is silently dropped`,
    afterAcl.includes('parity-user:AddChildren'),
    `local ACL after save ${JSON.stringify(afterAcl)}`,
  );
  const refused =
    /error/i.test(feedback) &&
    afterAcl.includes('members:ReadWrite') &&
    !afterAcl.includes('members:Everything');
  gap('perm.save-applied', {
    correct:
      afterAcl.includes('members:Everything') && afterAcl.includes('parity-user:AddChildren'),
    wrongObserved: refused && writes.length === 0,
    expect: 'apply a change to members while preserving the AddChildren entry',
    observed: `feedback ${JSON.stringify(feedback.slice(0, 120))}, ${writes.length} write request(s), ACL ${JSON.stringify(afterAcl)}`,
  });
  if (refused) {
    gap('perm.refusal-explained', {
      correct:
        /AddChildren|add children|cannot (be )?(shown|expressed)|unsupported permission/i.test(
          feedback,
        ),
      wrongObserved: /Error on updating permissions on this document/.test(feedback),
      expect: 'say why the save was refused (which entry it cannot express)',
      observed: JSON.stringify(feedback.slice(0, 160)),
    });
  } else {
    h.note(
      'the save was not refused, so whether a refusal explains itself is not observable on this surface',
    );
  }
  await h.screenshot('permissions-save-refused');
  if (feedback) {
    await page.waitForTimeout(8000);
    const lingering = await page.locator(A.permissions.feedback).count();
    h.note(
      `the save feedback is ${lingering ? 'still on screen' : 'gone'} 11.5 s after Save${lingering ? ' (no auto-dismiss); closed by hand so later shots are clean' : ''}`,
    );
    await page
      .locator(`${A.permissions.feedback} button`)
      .first()
      .click()
      .catch(leaveItToTheNextCheck);
    await page.waitForTimeout(600);
  }

  await h.step('PermissionsPanel — a document whose ACL grants WriteVersion');
  await A.permissions.open(page, h, ACL.doc);
  const docPanel = (
    await page
      .locator(A.permissions.root)
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  h.check(
    `${LB} the permissions panel opens for a document, not only for a folder`,
    docPanel.includes('ACL memo'),
    `the panel read ${JSON.stringify(docPanel.slice(0, 120))}`,
  );
  if (docPanel.includes('ACL memo')) {
    await A.permissions.showTab(page, 'Individual Users');
    const docRow = (await rowText()).find((t) => t.includes(ACL.userLabel)) ?? '';
    h.check(
      `${LB} parity-user is listed on the document`,
      docRow.length > 0,
      JSON.stringify(await rowText()),
    );
    gap('perm.non-expressible-shown', {
      correct: /write ?version/i.test(docRow),
      wrongObserved: /Select Access/.test(docRow) && !/write ?version/i.test(docRow),
      expect: "show parity-user's local WriteVersion permission on a document",
      observed: `parity-user row reads ${JSON.stringify(docRow)}`,
    });
    await h.screenshot('permissions-writeversion-not-shown');
  }
  mark('permissions', 'end');

  // ── 12. Viewer ───────────────────────────────────────────────────────────────────────────────
  await h.step('Viewer — PDF');
  await h.goTo(A.browse(MEDIA.path));
  await waitForList(page, A);
  const viewerState = async () => {
    const root = page.locator(A.viewer.root).first();
    const visible = await root.isVisible().catch(() => false);
    const state = await root
      .evaluate((el) => {
        const img = el.querySelector('img:not([src$=".svg"])');
        const vid = el.querySelector('video');
        return {
          text: (el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
          unknown: el.querySelectorAll('adf-viewer-unknown-format, nxs-viewer-fallback').length,
          canvas: el.querySelectorAll('canvas').length,
          // A canvas proves nothing on its own: a blank or failed renderer still creates one.
          painted: [...el.querySelectorAll('canvas')].filter((c) => {
            try {
              const ctx = c.getContext('2d');
              if (!ctx || !c.width || !c.height) return false;
              const { data } = ctx.getImageData(0, 0, c.width, c.height);
              for (let i = 4; i < data.length; i += 4 * 97) {
                if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
                  return true;
                }
              }
              return false;
            } catch {
              // A tainted or non-2d canvas cannot be read, so it does not count as painted.
              return false;
            }
          }).length,
          img: img
            ? { w: img.naturalWidth, h: img.naturalHeight, alt: img.getAttribute('alt') }
            : null,
          video: vid
            ? { ready: vid.readyState, duration: vid.duration, error: vid.error?.code ?? null }
            : null,
        };
      })
      .catch(noAnswer);
    return state ? { ...state, visible } : null;
  };
  const errorsBeforePdf = consoleErrors.length;
  await A.viewer.open(page, A, MEDIA.pdf);
  const pdf = await viewerState();
  h.check(
    `${CTX} the viewer opened, visibly, for the PDF`,
    Boolean(pdf?.visible),
    JSON.stringify(pdf),
  );
  gap('viewer.pdf', {
    correct:
      Boolean(pdf?.visible) &&
      (pdf.text.includes(MEDIA.pdfText) || pdf.painted > 0) &&
      pdf.unknown === 0,
    wrongObserved: Boolean(pdf) && pdf.painted === 0 && !pdf.text.includes(MEDIA.pdfText),
    expect: 'render the PDF (its text, or a canvas with the page painted on it)',
    observed: `${JSON.stringify(pdf)}`,
  });
  if (A.upstream) {
    h.check(
      `${CTX} adf-core reports why: its PDF viewer was never provided`,
      consoleErrors.slice(errorsBeforePdf).some((e) => e.includes('PDF viewer is not configured')),
      JSON.stringify(consoleErrors.slice(errorsBeforePdf).slice(0, 2)),
    );
  }
  await h.screenshot('viewer-pdf');
  await A.viewer.close(page, A, MEDIA.pdf);
  h.check(`${LB} the viewer closes again`, (await page.locator(A.viewer.root).count()) === 0);

  await h.step('Viewer — image');
  await A.viewer.open(page, A, MEDIA.image);
  const img = await viewerState();
  h.check(
    `${LB} the visible viewer's image is the fixture PNG, decoded at its intrinsic 480×270`,
    Boolean(img?.visible) && img?.img?.w === 480 && img?.img?.h === 270,
    JSON.stringify(img?.img ?? null),
  );
  gap('viewer.img-alt', {
    correct:
      Boolean(img?.img?.alt) &&
      (img.img.alt.toLowerCase().includes(MEDIA.image.toLowerCase()) ||
        /parity\.png/i.test(img.img.alt)),
    wrongObserved: img?.img?.alt === 'undefined',
    expect: 'give the rendered image an alt text naming the document',
    observed: `alt=${JSON.stringify(img?.img?.alt ?? null)}`,
  });
  await h.screenshot('viewer-image');
  await A.viewer.close(page, A, MEDIA.image);

  await h.step('Viewer — video (WebM)');
  await A.viewer.open(page, A, MEDIA.video);
  const vid = await viewerState();
  h.check(
    `${CTX} the viewer opened, visibly, for the video`,
    Boolean(vid?.visible),
    JSON.stringify(vid),
  );
  gap('viewer.video', {
    correct: Boolean(vid?.visible && vid.video) && vid.video.ready >= 1 && vid.video.duration > 3,
    wrongObserved: Boolean(vid) && !vid.video && vid.unknown > 0,
    expect: 'play the video',
    observed: JSON.stringify(vid),
  });
  await h.screenshot('viewer-video');
  await A.viewer.close(page, A, MEDIA.video);

  await h.step('Viewer — fallback for a format no viewer handles');
  await A.viewer.open(page, A, MEDIA.unknown);
  const unk = await viewerState();
  h.check(
    `${LB} the visible viewer shows the fallback for application/octet-stream`,
    Boolean(unk?.visible) && unk.unknown > 0,
    JSON.stringify(unk),
  );
  h.check(
    `${NEG} nothing is rendered as if it were an image, video or PDF`,
    Boolean(unk) && unk.unknown > 0 && !unk.img && !unk.video && unk.canvas === 0,
    JSON.stringify(unk),
  );
  h.note(
    `fallback wording: ${JSON.stringify(unk?.text ?? '')} — it suggests refreshing for a format that will never render`,
  );
  await h.screenshot('viewer-fallback');
  await A.viewer.close(page, A, MEDIA.unknown);

  // ── 13. Search listing ───────────────────────────────────────────────────────────────────────
  await h.step('Search listing — 125 hits paged 50 / 50 / 25');
  await h.goTo(A.search.route);
  const searchFor = async (term) => {
    await page.locator(A.search.input).first().fill(term);
    await page.waitForTimeout(3000);
    await page
      .locator(`${A.search.rows}, ${A.search.none}, ${A.search.error}`)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(leaveItToTheNextCheck);
    await page.waitForTimeout(500);
  };
  await searchFor(SEARCH.token);
  const s1 = await readRows(page, A.search.rows, A.search.title);
  const countText = await page
    .locator(A.search.count)
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    `${LB} the first page lists 50 hits, all of them paged items`,
    s1.length === 50 &&
      s1.every((r) => r.title.startsWith('Paged item')) &&
      (await page
        .locator(A.search.rows)
        .first()
        .isVisible()
        .catch(() => false)),
    `${s1.length} rows`,
  );
  h.check(`${CTX} the result count is 125`, /125/.test(countText), JSON.stringify(countText));
  await h.screenshot('search-results-page-1');
  await page.locator(A.search.next).first().click();
  await page.waitForTimeout(3000);
  const s2 = await readRows(page, A.search.rows, A.search.title);
  await page.locator(A.search.next).first().click();
  await page.waitForTimeout(3000);
  const s3 = await readRows(page, A.search.rows, A.search.title);
  const union = new Set([...s1, ...s2, ...s3].map((r) => r.title));
  h.check(
    `${LB} pages 2 and 3 hold 50 and 25 hits`,
    s2.length === 50 && s3.length === 25,
    `${s2.length} and ${s3.length}`,
  );
  h.check(
    `${LB} the three pages are disjoint and cover exactly Paged item 001 to 125`,
    sameSet(
      [...union],
      Array.from({ length: PAGED.count }, (_, i) => pagedTitle(i + 1)),
    ) && s1.length + s2.length + s3.length === PAGED.count,
    `${union.size} distinct titles across ${s1.length + s2.length + s3.length} rows`,
  );
  await h.screenshot('search-results-page-3');

  await h.step('Search listing — no results, and a match the administrator can see');
  await searchFor(SEARCH.none);
  const noneText = await visibleText(A.search.none);
  h.check(
    `${LB} an unmatched term says no results were found`,
    /no results/i.test(noneText),
    JSON.stringify(noneText),
  );
  h.check(
    `${NEG} and lists no rows`,
    /no results/i.test(noneText) &&
      (await readRows(page, A.search.rows, A.search.title)).length === 0,
  );
  await searchFor(SEARCH.secret);
  const adminSecret = await readRows(page, A.search.rows, A.search.title);
  h.check(
    `${CTX} as administrator, "${SEARCH.secret}" finds the restricted folder's Secret memo`,
    adminSecret.some((r) => r.title === DENIED.doc),
    JSON.stringify(adminSecret.map((r) => r.title)),
  );
  await h.screenshot('search-admin-sees-secret-memo');

  // ── 14. Failure: a 500 from Nuxeo on each listing ────────────────────────────────────────────
  await h.step('Failure — the folder listing answers 500');
  await fail500(A.list.failPattern);
  await h.goTo(A.browse(PAGED.path));
  await waitForList(page, A);
  const list500 = await visibleText(A.list.error);
  const rows500 = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} the listing shows an error state with a message`,
    list500.trim().length > 0,
    JSON.stringify(list500),
  );
  h.check(`${LB} the error state offers a retry`, (await page.locator(A.list.retry).count()) > 0);
  h.check(
    `${NEG} no rows are shown for the failed folder`,
    list500.trim().length > 0 && rows500.length === 0,
    `${rows500.length} rows`,
  );
  await h.screenshot('failure-list-500');
  await page.unroute(A.list.failPattern);
  await page.locator(A.list.retry).first().click().catch(leaveItToTheNextCheck);
  await waitForList(page, A);
  h.check(
    `${LB} retry recovers the 50 rows once the server answers`,
    (await readRows(page, A.list.rows, A.list.title)).length === 50,
  );

  await h.step('Failure — the search listing answers 500');
  await h.goTo(A.search.route);
  await fail500(A.search.failPattern);
  await searchFor(`${SEARCH.token}x`);
  const search500 = await visibleText(A.search.error);
  h.check(
    `${LB} search shows an error state with a message`,
    search500.trim().length > 0,
    JSON.stringify(search500),
  );
  h.check(
    `${NEG} and no stale results`,
    search500.trim().length > 0 &&
      (await readRows(page, A.search.rows, A.search.title)).length === 0,
  );
  gap('search.error-message', {
    correct:
      search500.trim().length > 0 && !/Http failure response|\/nuxeo\/api\//i.test(search500),
    wrongObserved:
      /Http failure response for/.test(search500) && /\/nuxeo\/api\/v1\/search/.test(search500),
    expect: 'show a user-facing message instead of the raw HTTP failure and query URL',
    observed: JSON.stringify(search500.slice(0, 160)),
  });
  await h.screenshot('failure-search-500');
  await page.unroute(A.search.failPattern);

  // ── 15. Failure: a permission-denied folder, as parity-user ──────────────────────────────────
  await h.step('Failure — parity-user opens a folder they cannot read');
  const basic = parityBasic;
  // Declared before the header and the session move, and awaited: the switch judges the
  // administrator session it is leaving before restarting the request window, so anything this
  // run read headerless up to here is refused rather than discarded with the window. The
  // restricted session must not be installed yet, or it is what the switch reads — and it would
  // be judged against the user it is replacing.
  await h.signedInAs(
    ACL.user,
    'the permission-denied steps read the fixture as the restricted user',
  );
  // Basic auth decides identity on every Nuxeo REST call (the API keeps no session), so forcing
  // the header switches the browser to parity-user for everything the app requests from here on.
  await page.route('**/nuxeo/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: `Basic ${basic}` } }),
  );
  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem('agentic_ui_signed_out');
    },
    {
      key: SESSION_KEY,
      value: JSON.stringify({
        kind: 'basic',
        username: ACL.user,
        basic,
        isAdministrator: false,
        groups: ['members'],
      }),
    },
  );
  await h.goTo(A.browse(ROOT));
  // `load`, not `networkidle`: the identity switch can leave a request in flight for long enough
  // to time the reload out, and the list wait below is what the next checks depend on.
  await page.reload({ waitUntil: 'load' });
  await waitForList(page, A);
  const me = await page.evaluate(
    (timeoutMs) =>
      // Not following a redirect: an opaque redirect has no JSON, so it answers null below. The
      // signal also aborts the body read, so a `/me` that never finishes answers null too.
      fetch('/nuxeo/api/v1/me', { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
        .then((r) => r.json())
        .then((j) => j.id)
        // Runs in the browser, where this module's helpers do not exist; null fails the check below.
        .catch(() => null),
    PROBE_TIMEOUT_MS,
  );
  h.check(
    `${CTX} the browser is now signed in to Nuxeo as parity-user`,
    me === ACL.user,
    `/me answered ${JSON.stringify(me)}`,
  );
  const asUser = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${LB} parity-user sees the workspace's six other folders`,
    sameSet(
      asUser.map((r) => r.title),
      [ACL.title, deepTitle(1), 'Empty folder', PAGED.title, 'Versions', 'Viewer fixtures'],
    ),
    JSON.stringify(asUser.map((r) => r.title)),
  );
  h.check(
    `${NEG} the restricted folder is not listed`,
    asUser.length > 0 && !asUser.some((r) => r.title === DENIED.title),
  );
  const userTree = treeChildren(await readTree(page, A), 'Parity fixtures');
  h.check(
    `${NEG} nor shown in the tree`,
    userTree.children.length > 0 && !userTree.children.some((c) => c.label === DENIED.title),
    JSON.stringify(userTree.children.map((c) => c.label)),
  );
  const beforeDenied = wire.length;
  await h.goTo(A.browse(DENIED.path));
  await waitForList(page, A);
  const deniedReq = wire
    .slice(beforeDenied)
    .find((w) => w.url.includes('/parity/denied') && w.status === 403);
  for (const w of wire.slice(beforeDenied).filter((x) => x.status === 403)) {
    provoked.add(`HTTP 403 ${new URL(w.url.replace(/ /g, '%20')).pathname}`);
  }
  const deniedText = await visibleText(A.list.error);
  const deniedRows = await readRows(page, A.list.rows, A.list.title);
  h.check(
    `${CTX} Nuxeo answered 403 for the restricted folder`,
    Boolean(deniedReq),
    JSON.stringify(
      wire
        .slice(beforeDenied)
        .map((w) => `${w.status} ${w.url.split('/api/v1')[1]}`)
        .slice(0, 3),
    ),
  );
  h.check(
    `${LB} the listing shows an error state rather than an empty folder`,
    deniedText.trim().length > 0,
    JSON.stringify(deniedText),
  );
  h.check(
    `${NEG} no content of the restricted folder is shown`,
    deniedText.trim().length > 0 &&
      deniedRows.length === 0 &&
      (await page.getByText(DENIED.doc).count()) === 0,
  );
  gap('denied.distinct-message', {
    correct:
      deniedText.trim() !== list500.trim() &&
      /permission|access|not allowed|forbidden/i.test(deniedText),
    wrongObserved: deniedText.trim().length > 0 && deniedText.trim() === list500.trim(),
    expect: 'tell a permission refusal apart from a server failure',
    observed: `403 reads ${JSON.stringify(deniedText.trim())}; 500 read ${JSON.stringify(list500.trim())}`,
  });
  const deniedCrumbs = (
    await page
      .locator(A.breadcrumb.items)
      .allInnerTexts()
      .catch(() => [])
  ).map((t) => t.trim());
  gap('denied.stale-breadcrumb', {
    correct: deniedCrumbs.at(-1) !== 'Parity fixtures',
    wrongObserved: deniedText.trim().length > 0 && deniedCrumbs.at(-1) === 'Parity fixtures',
    expect: 'drop the previous folder from the breadcrumb when the next one is refused',
    observed: `breadcrumb on the refused folder reads ${JSON.stringify(deniedCrumbs)}`,
  });
  await h.screenshot('failure-permission-denied-folder');

  await h.step('Failure — parity-user searching cannot find the restricted document');
  await h.goTo(A.search.route);
  await searchFor(SEARCH.secret);
  const userSecret = await readRows(page, A.search.rows, A.search.title);
  const userNone = await visibleText(A.search.none);
  h.check(
    `${LB} the search completed (a no-results state or result rows)`,
    userSecret.length > 0 || /no results/i.test(userNone),
    JSON.stringify(userNone),
  );
  h.check(
    `${NEG} Secret memo is not among parity-user's results`,
    adminSecret.some((r) => r.title === DENIED.doc) &&
      !userSecret.some((r) => r.title === DENIED.doc),
    JSON.stringify(userSecret.map((r) => r.title)),
  );
  await h.screenshot('failure-search-no-leak');
  await page.unroute('**/nuxeo/**');

  // ── 16. Health ───────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  await writeFile(
    resolve(outDir, 'video-marks.json'),
    `${JSON.stringify({ surface: surfaceId, marks }, null, 2)}\n`,
  );
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    ...provoked,
    /automation\/AI\./,
    // Knowledge Discovery operations; their packages are not installed on a stock throwaway.
    /automation\/Hyland(KnowledgeDiscovery|Ingest)\./,
    '/nuxeo/logout',
    // Under nx serve nothing answers the optional configuration files; the app tolerates it.
    'HTTP 404 /agentic-ui-config/bootstrap.json',
    'HTTP 404 /agentic-ui-config/manifest.json',
    'HTTP 404 /agentic-ui-config/layouts.json',
    // The bridge classifies ACL principals by probing /group/ first; users answer 404 there.
    /HTTP 404 \/nuxeo\/api\/v1\/group\//,
    // Recorded above as the viewer.pdf gap, with this message as its context check.
    'PDF viewer is not configured',
    /preventDefault inside passive event listener/,
  ]);
}
