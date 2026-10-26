/**
 * NXSAT-227 — i18n: the accessible-name fix, and the Layer 0 language key doing something visible.
 *
 * Run:  npm run beta:evidence -- nxsat-227-i18n
 *
 * ## What this file is built to prove, and what it deliberately does not
 *
 * It proves three things:
 *
 *   1. No control anywhere in the shell is named with a raw translation key — read off the
 *      rendered DOM, not off a catalogue file. That is the acceptance criterion, and it is the
 *      one an audit would check.
 *   2. The document tree's folder toggle has a real accessible name. This is the W13 defect: the
 *      catalogue holds `DOCUMENT_TREE.TOGGLE_ARIA-LABEL` and upstream asks for the same key with
 *      a trailing space, so before the alias every toggle was announced as
 *      `DOCUMENT_TREE.TOGGLE_ARIA-LABEL <folder name>`.
 *   3. Setting the Layer 0 `defaultLanguage` key to `fr` renders French chrome after a reload,
 *      with no rebuild. Without this the key is configuration that changes nothing.
 *
 * ## Two traps this file is shaped around
 *
 * **The reload is the assertion.** `withHashLocation()` makes `page.goto('/#/x')` a
 * same-document navigation, so `APP_INITIALIZER` does not re-run and a swapped `defaultLanguage`
 * is never read. A locale check written without `page.reload()` passes on the *English* app and
 * certifies nothing. `AGENTS/11-beta-program.md` §3 records this costing a previous run six
 * false failures. Every language switch below goes through `reloadApp`.
 *
 * **The bootstrap route must be registered before the first navigation and must answer
 * `no-store`.** Registered later, the browser serves the already-cached `bootstrap.json` and the
 * interception is never seen.
 *
 * ## Not covered
 *
 * RTL is out of scope (NXSAT-227 open decision Q3, tracked as DS-2277), so no mirrored layout is
 * asserted. Date, number and currency formatting are untouched — `LOCALE_ID` is not wired to the
 * selected language, so a French UI still renders English-formatted dates. Neither is a gap this
 * capture hides; both are recorded in `docs/i18n-localization-plan.md`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { configResponse } from '../config-response.mjs';

const BOOTSTRAP_ROUTE = '**/agentic-ui-config/bootstrap.json';

/**
 * A locale no catalogue ships, used by the last step to prove the tolerant path.
 *
 * Named once because it appears in three places — the bootstrap swap, the console-error
 * suppression and the step label — and a suppression that drifted from the locale it excuses
 * would silently hide a real missing catalogue.
 */
const UNSHIPPED_LOCALE = 'xx';

/**
 * Console errors this environment produces regardless of the change under test.
 *
 * The manifest 404 is the tolerant path working as designed: under `nx serve` nothing answers
 * `agentic-ui-config/manifest.json` unless a developer has put a file there, the application
 * falls back to its packaged defaults, and the browser logs an entry for the missing file whether
 * or not the application handled it. `phase-1-config.mjs` asserts the present and absent manifest cases separately and
 * suppresses the same set for the same reason.
 *
 * The AI operations 500 because the `AI.*` marketplace package is not installed here — recorded
 * in `CLAUDE.md` as expected, not a client defect.
 */
const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/manifest.json',
  // `GET /api/v1/group/Administrator` 404s because `Administrator` is a user, not a group. It
  // appears only once the adf-hx nav drawer is opened, comes from upstream's user resolution,
  // and has nothing to do with translation. Suppressed rather than left to fail a capture it is
  // not about — but it is a real 404 on every drawer open and worth a ticket of its own.
  '/nuxeo/api/v1/group/Administrator',
  // The five catalogue 404s that step 7 **induces on purpose** by asking for a locale no
  // catalogue ships. They are the tolerant path working: `AppTranslateLoader` answers each
  // failed folder fetch with `{}` and the app renders English. The browser still logs a console
  // entry for a 404 whether or not the application handled it.
  //
  // Narrowed to this one locale rather than `/i18n/` — a missing `fr.json` must still fail, and
  // a blanket pattern would have hidden exactly the defect this capture exists to catch.
  `/i18n/${UNSHIPPED_LOCALE}.json`,
];

/** Visible label naming the global search (NXENG-798); placeholder is no longer the accessible name. */
const HEADER_SEARCH_LABEL = 'label.header-search-label[for="global-header-search-input"]';

async function headerSearchVisibleLabel(page, h) {
  const locator = page.locator(HEADER_SEARCH_LABEL);
  const painted = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const { width, height } = el.getBoundingClientRect();
    return {
      text: (el.textContent ?? '').trim(),
      display: style.display,
      visibility: style.visibility,
      opacity: Number.parseFloat(style.opacity),
      width,
      height,
    };
  });

  h.check(
    'the global search label is visibly painted, not merely present in the DOM',
    painted.display !== 'none' &&
      painted.visibility !== 'hidden' &&
      painted.opacity > 0 &&
      painted.width > 0 &&
      painted.height > 0,
    `display=${painted.display} visibility=${painted.visibility} opacity=${painted.opacity} ` +
      `box=${painted.width}x${painted.height} text=${JSON.stringify(painted.text.slice(0, 40))}`,
  );

  return painted.text;
}

/** The servlet's bootstrap response with only our defaults, served verbatim for the English pass. */
const PACKAGED_BOOTSTRAP = configResponse('bootstrap');

/**
 * A raw translation key rendered where a human-readable string belongs.
 *
 * Both our own lowercase dotted keys and upstream's SCREAMING_CASE ones: `nav.refresh` and
 * `DOCUMENT_TREE.TOGGLE_ARIA-LABEL`. Anchored, so a sentence that merely contains a dotted word
 * does not match, and it requires at least two dot-separated segments so a filename like
 * `report.pdf` is not mistaken for a key.
 */
const RAW_KEY = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;

/**
 * A raw key CONCATENATED with user text, which is the shape the originating defect had.
 *
 * `DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined` fails the anchored pattern above, because of the
 * folder name appended to it — so the all-route sweep stayed green on the exact regression
 * this capture was written for, and only the separate tree assertion caught it.
 *
 * SCREAMING_CASE only, and deliberately so. Upstream's keys look like this and no English
 * sentence does; our own lowercase keys are matched by identity against the catalogue
 * instead, below, which is exact rather than shaped.
 */
const EMBEDDED_RAW_KEY = /\b[A-Z][A-Z0-9_]*(\.[A-Z0-9_-]+)+\b/;

/**
 * Our own keys, by identity rather than by shape.
 *
 * `nav.refresh` and `report.pdf` are structurally identical — a word, a dot, a word — so no
 * regex can separate a catalogue key from a filename, and the anchored pattern above reported
 * `report.pdf` as a raw key while its comment claimed it did not. Reading the catalogue makes
 * the question exact: a string IS a raw key when the catalogue has that key.
 */
/**
 * The app catalogue flattened to dotted keys, as ngx-translate resolves them.
 *
 * Both the key list and the VALUES, because an assertion about a rendered string should compare
 * against the string a translator edits rather than a literal copied into this file. The tree
 * toggle's expected name is built from `nav.tree.toggle` for that reason.
 */
const APP_CATALOGUE = (() => {
  const catalogue = JSON.parse(
    readFileSync(resolve(process.cwd(), 'apps/nuxeo-ui/public/i18n/en.json'), 'utf8'),
  );
  const flat = {};
  (function walk(node, prefix) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') flat[path] = value;
      else if (value && typeof value === 'object') walk(value, path);
    }
  })(catalogue, '');
  return flat;
})();

const OUR_KEYS = Object.keys(APP_CATALOGUE);

/** Routes the shell reaches without needing a document id. */
const ROUTES = [
  '/#/browse',
  '/#/search',
  '/#/documents',
  '/#/collections',
  '/#/tasks',
  '/#/trash',
  '/#/settings/themes',
  '/#/browse-adf-hx',
];

/** Forces a full document reload so `APP_INITIALIZER` re-reads configuration. */
async function reloadApp(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

/**
 * Every accessible name and visible label on the page that is a raw translation key.
 *
 * Reads `aria-label`, `title` and the text of leaf elements. Leaf elements only, because an
 * ancestor's `textContent` concatenates its children and would never match an anchored pattern —
 * an earlier DOM-based version of this check passed while the defect was present for exactly
 * that reason, which is recorded in `phase-6-a11y.mjs`.
 */
async function rawKeysOnPage(page) {
  return page.evaluate(
    ({ embedded, ourKeys }) => {
      // Defined INSIDE the callback: `page.evaluate` serialises this function and runs it in
      // the browser, where nothing from module scope exists. The previous revision referenced
      // an `isRawKey` that was never defined anywhere, so the first call threw a
      // ReferenceError — caught in review, because I verified the matching logic in isolation
      // and never ran the harness.
      const embeddedPattern = new RegExp(embedded);
      const keys = new Set(ourKeys);
      /** Exact for our keys, shaped for upstream's, and either may be concatenated with text. */
      const isRawKey = (value) =>
        keys.has(value) ||
        embeddedPattern.test(value) ||
        value.split(/\s+/).some((word) => keys.has(word));

      const offences = [];

      // `placeholder` and `alt` as well as `aria-label` and `title`.
      //
      // The AI assistant input is still placeholder-named; global header search (NXENG-798) uses a
      // visible `<label>` instead. A raw key in either naming path is a raw key announced as the
      // control's name — and this attribute sweep still does not read `<label>` text, while the
      // unnamed-control check below deliberately accepts a placeholder AS a name. `alt` is included
      // for the same reason: it is the accessible name of an image.
      for (const element of document.querySelectorAll(
        '[aria-label], [title], [placeholder], [alt]',
      )) {
        for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
          const value = element.getAttribute(attribute);
          if (value && isRawKey(value.trim())) {
            offences.push(`${element.tagName.toLowerCase()}[${attribute}]="${value.trim()}"`);
          }
        }
      }

      // Elements whose text content is code, not words. `<style>` is a leaf element, so the
      // sweep read whole stylesheets as candidate labels — and adf-hx's breadcrumb ships an
      // inline SVG chevron whose path data is `M0.229292 0.234315C-0.0751287 …`. `M0` matches
      // `[A-Z][A-Z0-9_]*` and `.229292` matches `\.[A-Z0-9_-]+`, so every SVG path command in
      // every stylesheet was reported as a raw translation key. Two routes failed on it while
      // nothing was wrong with either.
      //
      // This is why the harness has to be RUN: the pattern is correct, the scope was not, and
      // no amount of reasoning about the regex in isolation would have shown it.
      const NOT_TEXT = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT', 'TITLE']);

      // Every TEXT NODE, not every leaf element.
      //
      // The leaf-element rule was there because an ancestor's `textContent` concatenates its
      // children, which no anchored pattern could match. But it also skipped any element that has
      // children, and the commonest shape in this application is exactly that:
      //
      //   <button><mat-icon>refresh</mat-icon> nav.refresh</button>
      //
      // The label is a direct text node beside an icon element, so the button was never scanned
      // and the raw key rendered with every route still green. Walking text nodes keeps the reason
      // the restriction existed — each node is examined on its own, never concatenated with a
      // sibling — while losing the blind spot.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          NOT_TEXT.has(node.parentElement?.tagName ?? '')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.nodeValue ?? '').trim();
        if (text && isRawKey(text)) {
          const owner = node.parentElement?.tagName.toLowerCase() ?? 'text';
          offences.push(`${owner} text="${text}"`);
        }
      }

      // Both patterns, because the concatenated form is the shape the originating defect had
      // and the anchored one cannot match it.
      return [...new Set(offences)];
    },
    { embedded: EMBEDDED_RAW_KEY.source, ourKeys: OUR_KEYS },
  );
}

/** The bootstrap response with a customer package setting `defaultLanguage`, and nothing else. */
function bootstrapWithLanguage(language) {
  return configResponse('bootstrap', { customer: [{ defaultLanguage: language }] });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  let bootstrapBody = PACKAGED_BOOTSTRAP;
  /**
   * Every `defaultLanguage` the interception actually served, in order.
   *
   * Instrumentation that earns its place: "the placeholder is French" failing tells you the
   * locale did not apply but not whether the swap reached the browser at all. This separates a
   * broken interception from a broken language switch, and it makes the reload falsifiable —
   * if `page.reload()` were removed, this list would stop growing.
   */
  const servedLanguages = [];

  await page.route(BOOTSTRAP_ROUTE, (route) => {
    servedLanguages.push(JSON.parse(bootstrapBody).fragments.at(-1).content.defaultLanguage);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: bootstrapBody,
    });
  });

  // ---------------------------------------------------------------------------
  await h.step('The packaged English application renders no raw translation keys');
  await h.login();
  await h.expectVisible('app shell rendered', 'app-shell');

  const shellKeys = await rawKeysOnPage(page);
  h.check(
    'no raw translation key is rendered on the shell',
    shellKeys.length === 0,
    shellKeys.join('\n      '),
  );
  await h.screenshot('en-shell-no-raw-keys');

  // ---------------------------------------------------------------------------
  await h.step('The document tree toggle has a real accessible name, not the raw key');
  // The tree lives in the app shell's nav drawer and only mounts when the route is entered
  // through the platform nav item, because the shell owns the drawer state — a direct `goTo`
  // renders the page with no drawer and therefore no tree. `AGENTS/11-beta-program.md` §3
  // records this, and a first run of this file asserted against zero toggle buttons because it
  // navigated straight to the URL.
  await h.goTo('/#/browse');
  await page.waitForTimeout(1200);
  const navEntry = page
    .locator('a,button')
    .filter({ hasText: /adf-hx/i })
    .first();
  h.check('the platform nav offers the adf-hx entry', (await navEntry.count()) > 0);
  await navEntry.click().catch(() => {});
  await page.waitForTimeout(3000);
  await h.expectVisible('the nav drawer mounted', 'hxp-browse-nav-drawer');
  await h.expectVisible('the upstream document tree rendered', 'hxp-document-tree');

  // Zero toggles would make every name assertion below vacuously true, so the count is asserted
  // before the names are read.
  const toggles = page.locator('hxp-document-tree button[aria-label]');
  const toggleCount = await toggles.count();
  h.check(
    'the document tree rendered at least one folder toggle to inspect',
    toggleCount > 0,
    `found ${toggleCount} toggle button(s) in hxp-document-tree`,
  );

  if (toggleCount > 0) {
    const names = await toggles.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );
    // BOTH patterns, the anchored one and the embedded one.
    //
    // The anchored pattern alone could not match `DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined`, which is
    // the shape of the regression this whole step is named after — the key is concatenated with the
    // folder name, so it is never the entire value. And the three checks below accept it too: the
    // name contains the row's label, contains no `undefined`, and is not empty. So the check called
    // "no folder toggle is announced with a raw translation key" passed on precisely the raw
    // translation key it was written for, and only the separate all-route sweep would have caught
    // it — the sweep that uses both patterns, which is where these come from.
    const rawNames = names.filter(
      (name) => RAW_KEY.test(name.trim()) || EMBEDDED_RAW_KEY.test(name.trim()),
    );
    h.check(
      'no folder toggle is announced with a raw translation key',
      rawNames.length === 0,
      rawNames.join(', '),
    );
    // Compared against the row's own rendered label, NOT `startsWith('Toggle')`.
    //
    // The prefix form passed on `Toggleundefined`, which is what every toggle actually announced
    // for two rounds: upstream binds `… + node.name` and its node wrapper has no `name`, so the
    // name was the verb followed by the string "undefined". This check is the reason that shipped
    // unnoticed — it asserted the beginning of the name and the defect was in the end of it.
    //
    // Reading the folder's label from the row and requiring the whole accessible name to contain
    // it ties the assertion to the thing a screen-reader user needs: which folder this toggle
    // opens. `Toggleundefined` and `Toggle ` both fail it.
    const toggleNames = await page.locator('hxp-document-tree mat-tree-node').evaluateAll((rows) =>
      rows
        .map((row) => ({
          label: (row.querySelector('.hxp-node-container')?.textContent ?? '').trim(),
          name: (
            row.querySelector('button[matTreeNodeToggle]')?.getAttribute('aria-label') ?? ''
          ).trim(),
        }))
        .filter((entry) => entry.label !== '' && entry.name !== ''),
    );
    h.check(
      'the tree rendered at least one labelled row to compare against',
      toggleNames.length > 0,
      `${toggleNames.length} row(s) had both a visible label and a named toggle`,
    );
    // The COMPLETE expected name, built from the catalogue, not `includes(label)`.
    //
    // Containment alone accepts a name that is only the folder — if `nav.tree.toggle` were reduced
    // to `{{ name }}`, the action word would vanish from every toggle and this check would still
    // pass, because the label is still in there. The claim being made is `Toggle <folder>`, so the
    // assertion compares the whole string. `OUR_KEYS` already reads the catalogue, so the expected
    // value comes from the same file a translator edits rather than from a literal here.
    const toggleTemplate = APP_CATALOGUE['nav.tree.toggle'];
    // The template needs the placeholder AND an action word, checked separately from the rendered
    // comparison below.
    //
    // Deriving the expectation from the catalogue makes the DOM comparison self-consistent: reduce
    // `nav.tree.toggle` to `{{ name }}` and the expectation shrinks with it, so the action word can
    // disappear from every toggle in the application and the comparison still passes. Verified by
    // doing exactly that — 38/38, with the prefix gone. So the catalogue value itself is asserted
    // here: a name that is only the folder name does not say what the control DOES, which is the
    // whole point of an accessible name on an icon button.
    const toggleWords = (toggleTemplate ?? '').replace('{{ name }}', ' ').trim();
    h.check(
      'nav.tree.toggle carries both the folder placeholder and an action word',
      typeof toggleTemplate === 'string' &&
        toggleTemplate.includes('{{ name }}') &&
        (toggleWords.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= 2,
      `nav.tree.toggle = ${JSON.stringify(toggleTemplate)}, words beside the placeholder: ` +
        `${JSON.stringify(toggleWords)}`,
    );
    const expectedName = (label) => (toggleTemplate ?? '').replace('{{ name }}', label).trim();
    const unnamed = toggleNames.filter((entry) => entry.name !== expectedName(entry.label));
    h.check(
      "every folder toggle's accessible name is exactly the catalogue's Toggle <folder>",
      toggleNames.length > 0 && unnamed.length === 0,
      unnamed
        .map((entry) => `expected=${expectedName(entry.label)} actual=${entry.name}`)
        .join(' | '),
    );
    h.check(
      'no folder toggle is announced with the literal word undefined',
      names.every((name) => !/undefined/i.test(name)),
      names.join(' | '),
    );
    h.check(
      'no folder toggle has an empty accessible name',
      names.every((name) => name.trim() !== ''),
      `${names.filter((name) => name.trim() === '').length} empty of ${names.length}`,
    );
  }
  await h.screenshot('en-document-tree-toggle-accessible-name');

  // ---------------------------------------------------------------------------
  await h.step('No interactive control in the shell has an empty accessible name');
  // The regression test for finding 4.6: a blank `aria-label` on a control is a control with no
  // accessible name — axe `button-name`, critical — and it is invisible without a screen reader.
  //
  // Scoped to interactive elements, and that scope is the honest one rather than a convenient
  // one. A broad sweep also catches upstream's `<adf-datatable-row aria-label="">`, which is a
  // row and not a control, so it cannot fail `button-name` and is not what 4.6 was about. Those
  // rows belong to the ARIA problems already reported as upstream finding 1.2; failing this
  // capture on them would attribute upstream's debt to this change and make the check unusable
  // on any page rendering a document list.
  // `a[href]`, not `a`. An anchor without an `href` is not a link: it is not focusable, exposes no
  // link role, and axe's `link-name` rule does not apply to it. The broad `a` selector reported one
  // such anchor in the shell as unnamed, which is a finding nobody can act on — there is nothing to
  // name. Matching axe's own scope keeps the check's verdict comparable with the axe step's.
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"]';
  const blanks = await page.evaluate((selector) => {
    const offenders = [];
    for (const element of document.querySelectorAll(selector)) {
      if (!element.hasAttribute('aria-label')) continue;
      if ((element.getAttribute('aria-label') ?? '').trim() !== '') continue;
      offenders.push(`${element.tagName.toLowerCase()}.${element.className || '(no class)'}`);
    }
    return offenders;
  }, INTERACTIVE);
  h.check(
    'no interactive control carries an empty aria-label',
    blanks.length === 0,
    blanks.join(', '),
  );

  // A control with NO `aria-label` at all, and nothing else naming it either.
  //
  // The check above only inspects controls that HAVE the attribute, while the step's title claims
  // to sweep for missing accessible names — so an icon-only button with no ARIA and no text passed
  // it. That is not hypothetical: it is precisely how the app shell's own navigation-tree folder
  // toggles kept no accessible name at all through this entire ticket, on every route, until an
  // axe scan in French found them. A check narrower than its own name is how that happens.
  //
  // This approximates the accessible-name computation rather than implementing it. An element is
  // unnamed when nothing in HTML-AAM's order names it: no non-empty `aria-label`, no resolvable
  // `aria-labelledby`, no associated `<label>`, no `title`, no `placeholder` on a form control,
  // and no visible text of its own.
  //
  // `mat-icon` ligature text is excluded because Angular Material marks those `aria-hidden`, which
  // is the exact trap the nav-drawer toggle fell into — the button looked like it had text and
  // announced nothing.
  //
  // The first version of this omitted `placeholder` and `<label>`, and reported the global search
  // box, the adf-hx toolbar filter and the AI chat input as unnamed. All three are named, by
  // placeholder, which HTML-AAM accepts for a form control and axe agrees with — the French axe
  // scan in step 5 passes on the same page. A check stricter than the standard it cites produces
  // failures nobody can act on, and a capture that cannot go green gets bypassed. axe remains the
  // authority; this exists to catch the case axe cannot, a name that is present but is a raw key.
  const unnamed = await page.evaluate((selector) => {
    const named = (value) => (value ?? '').trim() !== '';
    const offenders = [];
    for (const element of document.querySelectorAll(selector)) {
      if (named(element.getAttribute('aria-label'))) continue;
      if (named(element.getAttribute('title'))) continue;
      if (named(element.getAttribute('placeholder'))) continue;
      if (element.getAttribute('aria-hidden') === 'true') continue;
      if (element.hasAttribute('hidden') || element.closest('[aria-hidden="true"]')) continue;

      // `aria-labelledby` only counts if the ids it points at exist and carry text. A dangling
      // reference names nothing, and is a defect this would otherwise call a pass.
      const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id))
        .filter((target) => named(target?.textContent));
      if (labelledBy.length > 0) continue;

      // A `<label for>` or a wrapping `<label>`, which is how a form control is usually named.
      const id = element.getAttribute('id');
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      if (named(explicit?.textContent) || named(element.closest('label')?.textContent)) continue;

      // Text the user would hear, with anything `aria-hidden` removed — icon ligatures included.
      const clone = element.cloneNode(true);
      for (const hidden of clone.querySelectorAll('[aria-hidden="true"], mat-icon, .mat-icon')) {
        hidden.remove();
      }
      if (named(clone.textContent)) continue;

      offenders.push(
        `<${element.tagName.toLowerCase()} class="${element.className || ''}">` +
          (element.getAttribute('href') !== null ? ` href=${element.getAttribute('href')}` : ''),
      );
    }
    return [...new Set(offenders)];
  }, INTERACTIVE);
  h.check(
    'no interactive control is left with no accessible name at all',
    unnamed.length === 0,
    unnamed.join(', '),
  );
  h.note(
    'Upstream emits `<adf-datatable-row aria-label="">` on document-list rows. Those are not ' +
      'controls, so they cannot fail axe `button-name`; they are part of the DataTable ARIA ' +
      'problems already reported as finding 1.2 in docs/adf-hx-upstream-findings.md, and this ' +
      'step deliberately does not fail on them.',
  );

  // ---------------------------------------------------------------------------
  await h.step('Every shell route is free of raw translation keys');
  const offendingRoutes = [];
  const unreachedRoutes = [];
  for (const route of ROUTES) {
    await h.goTo(route);
    await page.waitForTimeout(1200);

    // Confirm the route actually arrived before reading anything off it.
    //
    // `goTo` is `page.goto`, and a route that redirects to a clean shell — or to an error page
    // with no key-shaped text — leaves the key scan with nothing to find and passes. Eight
    // vacuous passes read exactly like eight surfaces checked. The hash is what the router
    // resolved to, so comparing it catches a redirect; `main` having content catches an empty
    // error page.
    const landed = await page.evaluate(() => ({
      hash: window.location.hash,
      rendered: (document.querySelector('main')?.textContent ?? '').trim().length,
    }));
    // `window.location.hash` is `#/browse`; the route in ROUTES is `/#/browse`. Comparing
    // them directly failed every route, which would have turned the check I added to stop
    // vacuous passes into a permanent red — the opposite mistake, and just as useless.
    //
    // The route itself, or a child of it. Not a bare `startsWith`: `/#/browse` is a prefix of
    // `/#/browse-adf-hx`, so a redirect between those two siblings would have satisfied it.
    // Requiring the next character to be `/` keeps the sibling out while admitting a child.
    //
    // A child has to be admitted because `/#/tasks` selects the first task and lands on
    // `#/tasks/<uid>`. The exact-match version of this check called that "unreached" and went
    // red on a route that had rendered perfectly — which is the second time a check added here
    // to stop vacuous passes became a false failure instead. Both directions have to be tried.
    const expected = route.replace(/^\//, '');
    const actual = landed.hash.split('?')[0].replace(/\/$/, '');
    const arrived = actual === expected || actual.startsWith(`${expected}/`);
    if (!arrived || landed.rendered === 0) {
      unreachedRoutes.push(
        `${route}: landed on ${landed.hash || '(no hash)'} with ${landed.rendered} char(s)`,
      );
      continue;
    }

    const found = await rawKeysOnPage(page);
    if (found.length > 0) offendingRoutes.push(`${route}: ${found.join(', ')}`);
  }
  h.check(
    `all ${ROUTES.length} shell routes were reached, so the scan below is not vacuous`,
    unreachedRoutes.length === 0,
    unreachedRoutes.join('\n      '),
  );
  h.check(
    `all ${ROUTES.length} shell routes render no raw translation key`,
    offendingRoutes.length === 0,
    offendingRoutes.join('\n      '),
  );

  // ---------------------------------------------------------------------------
  await h.step('Layer 0 defaultLanguage: fr renders French chrome after a reload');
  bootstrapBody = bootstrapWithLanguage('fr');
  // Back to a plain route first: the earlier steps left the adf-hx nav drawer open, and a
  // drawer full of upstream inputs is not what the header assertions are about.
  await h.goTo('/#/browse');
  const servedBeforeFrench = servedLanguages.length;
  await reloadApp(page);
  await h.expectVisible('app shell rendered in French pass', 'app-shell');

  h.check(
    'the reload really re-fetched the configuration, and it said fr',
    servedLanguages.length > servedBeforeFrench &&
      servedLanguages[servedLanguages.length - 1] === 'fr',
    `served so far: ${JSON.stringify(servedLanguages)}`,
  );

  const frenchSearchLabel = await headerSearchVisibleLabel(page, h);
  h.check(
    'the global search visible label is French',
    frenchSearchLabel === 'Rechercher des documents, des utilisateurs ou des groupes',
    `label was "${frenchSearchLabel}"`,
  );

  const frenchAssistant = await page
    .locator('[aria-label="Assistant IA"]')
    .count()
    .catch(() => 0);
  h.check(
    'the assistant button is announced in French',
    frenchAssistant > 0,
    `found ${frenchAssistant} element(s) with the French accessible name`,
  );

  const frenchKeys = await rawKeysOnPage(page);
  h.check(
    'the French application renders no raw translation key either',
    frenchKeys.length === 0,
    frenchKeys.join('\n      '),
  );

  // The AI assistant's empty-state suggestions: the button LABEL was translated and the string
  // it sent was not.
  //
  // The template set `aiChatInput` to a hard-coded English sentence and called `sendAiMessage()`,
  // so a French user clicked "Quels documents ont été modifiés aujourd'hui ?" and watched their
  // own turn appear in the transcript as "What documents were modified today?" — which is also
  // what went to the backend, and what the backend would have answered in. A translated label
  // over an untranslated payload, and no static check can see it: both strings are legitimate,
  // one is just in the wrong language. Found in review.
  //
  // Asserted through the DOM rather than in a unit test on purpose. The defect lived in the gap
  // between the template's label and the template's click handler, and a unit test calling
  // `sendAiSuggestion` directly would have passed against the broken template.
  await page.locator('[aria-label="Assistant IA"]').first().click();
  await page.waitForTimeout(800);
  const suggestion = page.locator('button.ai-chat-suggestion').first();
  const suggestionLabel = (await suggestion.innerText().catch(() => '')).trim();
  h.check(
    'a French suggestion button is offered to click',
    suggestionLabel.length > 0 && suggestionLabel !== 'What documents were modified today?',
    `first suggestion read ${JSON.stringify(suggestionLabel)}`,
  );
  await suggestion.click();
  await page.waitForTimeout(1200);
  const sentMessage = (
    await page
      .locator('.ai-chat-msg.user')
      .first()
      .innerText()
      .catch(() => '')
  ).trim();
  h.check(
    'clicking a suggestion sends the French string, not the English one behind the label',
    sentMessage === suggestionLabel,
    `button said ${JSON.stringify(suggestionLabel)} but the message sent was ` +
      `${JSON.stringify(sentMessage)}`,
  );
  await h.screenshot('fr-ai-suggestion-sends-french');
  // Close the panel again: it overlays the header, and the axe scan below is about the shell.
  await page.locator('[aria-label="Fermer la conversation"]').first().click();
  await page.waitForTimeout(500);

  // Promised by the test plan's own table in `docs/i18n-localization-plan.md` and, until this
  // round, not actually called anywhere in this file — the recorded evidence claimed a French
  // axe pass it had never made. Caught in review.
  //
  // No `ignore` list, deliberately. Phase 6 scans these surfaces in English and passes with
  // `KNOWN_VIOLATIONS` empty, so anything axe finds here is something the French pass
  // introduced: an accessible name that resolved to a key, a translated label that no longer
  // matches its control, a string long enough to break a contrast-bearing layout. An ignore
  // list would let exactly those through.
  // `failOn` every impact, because the check's NAME promises every WCAG 2.1 AA violation and the
  // helper defaults to serious and critical only. The comment above said "anything axe finds here is
  // something the French pass introduced" while a minor or moderate finding would have produced a
  // PASS — the check claiming more than it enforced, which is the defect class this review has spent
  // ten rounds on. Either the name narrows or the verdict widens; the verdict is the honest one,
  // because the claim this step exists to make is that translation introduced no violation at all.
  await h.expectNoA11yViolations('French shell has no WCAG 2.1 AA violations', {
    failOn: ['minor', 'moderate', 'serious', 'critical'],
  });
  await h.screenshot('fr-shell-french-chrome');

  // ---------------------------------------------------------------------------
  await h.step('French survives an adf-hx surface, which is where it used to silently revert');
  // The regression test for W14, and the gap this capture originally had.
  //
  // adf-core's `TranslationService` reads the locale from its own `UserPreferencesService` and
  // calls `translate.use(...)` on the shared ngx-translate instance when it constructs. So the
  // language chosen from `defaultLanguage` held on the seven ordinary shell routes and reverted
  // to English the moment any adf-hx surface rendered — the `/#/browse-adf-hx` route or the
  // adf-hx nav drawer — with no page reload involved.
  //
  // The earlier version of this file asserted French **only after navigating to `/#/browse`**,
  // which is precisely the navigation that avoids the defect. It passed 25/25 with the bug
  // live. That is why this step drives the adf-hx surfaces explicitly rather than trusting the
  // shell.
  await h.goTo('/#/browse-adf-hx');
  await page.waitForTimeout(3000);
  await h.expectVisible('the adf-hx POC route rendered', 'lib-browse-adf-hx-poc');

  const adfHxRouteSearchLabel = await headerSearchVisibleLabel(page, h);
  h.check(
    'the adf-hx route keeps the configured language',
    adfHxRouteSearchLabel === frenchSearchLabel,
    `shell was "${frenchSearchLabel}", adf-hx route is "${adfHxRouteSearchLabel}"`,
  );

  // Upstream's own catalogue should now resolve in French too — it ships `fr`, and before the
  // fix it was being fetched as `en`. The tree root is upstream's `DOCUMENT_TREE.ROOT`.
  const treeRoot = await page
    .locator('hxp-document-tree')
    .first()
    .innerText()
    .catch(() => '');
  h.check(
    'upstream adf-hx strings resolve in the configured language, not English',
    treeRoot.includes('Accueil'),
    `tree text was ${JSON.stringify(treeRoot.slice(0, 80))} — expected upstream's French root`,
  );
  await h.screenshot('fr-adf-hx-surface-keeps-french');

  // ---------------------------------------------------------------------------
  await h.step('German is a second locale, so the switch is not a one-off fixture');
  bootstrapBody = bootstrapWithLanguage('de');
  await reloadApp(page);
  await h.expectVisible('app shell rendered in German pass', 'app-shell');

  const germanSearchLabel = await headerSearchVisibleLabel(page, h);
  h.check(
    'the global search visible label is German',
    germanSearchLabel === 'Dokumente, Benutzer oder Gruppen suchen',
    `label was "${germanSearchLabel}"`,
  );
  h.check(
    'the German and French visible labels differ, so the catalogue is really being chosen',
    germanSearchLabel !== frenchSearchLabel,
    `fr="${frenchSearchLabel}" de="${germanSearchLabel}"`,
  );
  await h.screenshot('de-shell-german-chrome');

  // ---------------------------------------------------------------------------
  await h.step('An unknown locale degrades to English rather than to raw keys');
  // The tolerance claim: a customer who sets a language we ship no catalogue for must get a
  // working application, not a page of keys.
  //
  // On production browse, and navigated there BEFORE the reload so the whole step measures one
  // surface. Step 6 left the page on `/#/browse-adf-hx` and steps 7 and 8 only reloaded, so the
  // date assertion below was looking for `td.cell-modified` on a route that renders upstream's
  // document list instead — no cells, and its own vacuity guard went red. The adf-hx surface is
  // covered by step 4 and step 6; this step is about the fallback path.
  bootstrapBody = bootstrapWithLanguage(UNSHIPPED_LOCALE);
  await h.goTo('/#/browse');
  await reloadApp(page);
  await h.expectVisible('app shell rendered for an unknown locale', 'app-shell');

  const fallbackKeys = await rawKeysOnPage(page);
  h.check(
    'an unshipped locale renders no raw translation key',
    fallbackKeys.length === 0,
    fallbackKeys.join('\n      '),
  );
  const fallbackSearchLabel = await headerSearchVisibleLabel(page, h);
  h.check(
    'an unshipped locale falls back to the English string',
    fallbackSearchLabel === 'Search documents, users or groups',
    `label was "${fallbackSearchLabel}"`,
  );

  // Strings degrading is only half of tolerant. Angular's date, number and currency pipes throw
  // `NG0701` for a locale with no registered data rather than degrading, so an unshipped locale
  // used to give English text and a broken date in every list — eleven `InvalidPipeArgument`
  // errors on one pass. Strings were fine throughout, which is what made it easy to miss.
  //
  // Asserted here rather than left to the console-error step because that step's suppression
  // list would have been the tempting place to put it, and suppressing it would have hidden a
  // real product defect behind a capture that reported PASS.
  // Asserted on a rendered date, not on the absence of an error string.
  //
  // The first version checked that the page text did not contain `InvalidPipeArgument`, which
  // it never would: Angular logs a pipe exception to the console and leaves the binding EMPTY.
  // So the check passed with every date cell blank — the precise failure it was written to
  // catch. The console-error step still runs as a separate diagnostic.
  // On the adf-hx surface, and that choice is the whole assertion.
  //
  // This used to read `lib-browse td.cell-modified`, which binds `{{ doc.lastModified | date }}` —
  // Angular's own `DatePipe`, with no locale argument, so it formats with `LOCALE_ID`. Nothing
  // provides `LOCALE_ID` from configuration, so those cells are `en-US` whatever the configured
  // language is. The guard this step exists to exercise writes adf-core's
  // `UserPreferenceValues.Locale`, which Angular's `DatePipe` never reads — so deleting the guard
  // left production browse's dates untouched and this check green. It could not fail on its subject.
  //
  // `.adf-cell-date` is adf-core's `LocalizedDatePipe`, which does read that preference, and is
  // where the eleven `InvalidPipeArgument` errors were measured in the first place.
  await h.goTo('/#/browse-adf-hx');
  await page.waitForTimeout(4000);
  const renderedDates = await page
    .locator('.adf-cell-date')
    .allInnerTexts()
    .catch(() => []);
  const nonEmptyDates = renderedDates.map((text) => text.trim()).filter(Boolean);
  h.check(
    'the unshipped locale rendered at least one date cell to judge',
    renderedDates.length > 0,
    'no date cell was found, so the assertion below would be vacuous',
  );
  h.check(
    'an unshipped locale still renders dates rather than leaving them blank',
    renderedDates.length > 0 && nonEmptyDates.length === renderedDates.length,
    `${renderedDates.length - nonEmptyDates.length} of ${renderedDates.length} date cell(s) ` +
      'were empty, which is what an NG0701 pipe failure looks like in the DOM',
  );
  await h.screenshot('xx-shell-falls-back-to-english');

  h.note(
    'Read the French and German screenshots as proof of the MECHANISM, not of a localised ' +
      'application. Extraction is scoped to apps/nuxeo-ui shell chrome, so the header search ' +
      'is French while the nav item labels, the document-list column headers and the adf-hx ' +
      'browse toolbar are still English — those strings live in libs/ and are NXSAT-284. ' +
      'Anyone looking at the screenshot will notice; this says so first.',
  );
  h.note(
    'RTL is not exercised: it is out of scope for NXSAT-227 (open decision Q3) and tracked ' +
      'against DS-2277. Nothing here asserts a mirrored layout.',
  );
  h.note(
    'Date, number and currency formatting are not localised. LOCALE_ID is not wired to the ' +
      'selected language, so the French and German passes still render English-formatted dates. ' +
      'Recorded as known debt in docs/i18n-localization-plan.md.',
  );
  h.note(
    'The fr and de catalogues in this run are developer-supplied bootstrap translations, not ' +
      'translation-crew output. Crowdin is the source of truth for every non-English locale ' +
      'once the project exists (slice S6); these prove the mechanism, not the wording.',
  );

  // ---------------------------------------------------------------------------
  await h.step('Health');
  bootstrapBody = PACKAGED_BOOTSTRAP;
  await reloadApp(page);
  h.check(
    'the configuration was re-fetched on every language switch',
    servedLanguages.length >= 5,
    `served: ${JSON.stringify(servedLanguages)}`,
  );
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
