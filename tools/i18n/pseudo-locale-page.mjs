/**
 * The one place that makes a browser page render the `zz` pseudo-locale, and proves it did.
 *
 * Both audits need this and only one of them had it. `pseudo-locale-audit.mjs` was fixed to
 * intercept the Layer 0 config and assert the sentinel; `pseudo-locale-deep.mjs` was then wired
 * into `npm run i18n:audit` without it, so the deep pass — the one that opens dialogs and menus,
 * where a missed string is least likely to be noticed by hand — ran against the packaged `en`
 * default. Under English every string is plain ASCII prose, which is exactly what these audits
 * report as untranslated, so its findings were unreadable in both directions: a correctly keyed
 * string looked like a miss, and a real miss was indistinguishable from one.
 *
 * Two separate processes cannot share a browser, so sharing the SETUP is the only way both stay
 * correct when one is changed. That is the point of this module existing rather than the override
 * being copied.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requireNuxeoCredentials } from '../../scripts/beta-harness/nuxeo-credentials.mjs';

/** The Layer 0 config request the application makes at startup. */
export const BOOTSTRAP_ROUTE = '**/agentic-ui-config/bootstrap.json';

/**
 * The keys `apps/nuxeo-ui/src/app/auth` reads, and that `scripts/beta-harness/helpers.mjs` writes.
 *
 * Duplicated here rather than imported because `scripts/` and `tools/` are separate trees, and a
 * cross-tree import is a module-boundary violation. If the application renames either key, both
 * this file and the harness go silently non-authenticating — which is exactly the failure that let
 * `/#/administration` audit the dashboard for weeks, so it is worth knowing they are coupled.
 */
const SESSION_STORAGE_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_STORAGE_KEY = 'agentic_ui_signed_out';

/** `⟦` — it can only come from a generated `zz` catalogue, so seeing it proves one loaded. */
export const SENTINEL = '\u27E6';

const PACKAGED_BOOTSTRAP = join(
  process.cwd(),
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json',
);

/**
 * The configuration servlet's bootstrap response — the envelope the application accepts, and
 * nothing else — with our defaults and the language swapped, leaving branding and the rest alone.
 */
const bootstrapForPseudoLocale = () => {
  const config = JSON.parse(readFileSync(PACKAGED_BOOTSTRAP, 'utf8'));
  config.defaultLanguage = 'zz';
  // The default must also be advertised, or it is not selectable and the loader may refuse it.
  config.availableLanguages = [...new Set([...(config.availableLanguages ?? []), 'zz'])];
  return JSON.stringify({
    format: 'nuxeo-agentic-ui-config/1',
    layer: 'bootstrap',
    fragments: [
      {
        name: 'defaults',
        component: 'org.nuxeo.agentic.ui.config.defaults',
        bundle: 'org.nuxeo.agentic.ui.config.defaults',
        source: 'agentic-ui-config/bootstrap.defaults.json',
        content: config,
      },
    ],
    diagnostics: [],
  });
};

/** Serves `defaultLanguage: 'zz'` for every bootstrap request this page makes. */
export async function servePseudoLocale(page) {
  await page.route(BOOTSTRAP_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: bootstrapForPseudoLocale(),
    }),
  );
}

/** Whether the pseudo-locale has actually rendered on the page as it currently stands. */
export async function sentinelPresent(page) {
  return page.evaluate((mark) => document.body.innerText.includes(mark), SENTINEL);
}

/**
 * Refuses to let a run report a total it cannot support.
 *
 * Without the pseudo-locale active the "untranslated" count approaches the whole application, which
 * reads as a catastrophic result rather than a broken audit — the two failure modes produce
 * opposite conclusions from identical output. So this exits non-zero rather than printing a number
 * someone would quote.
 */
export function requireSentinel(seen, audit) {
  if (seen) return;
  console.error(
    `${audit}: the pseudo-locale never rendered — no \`${SENTINEL}\` appeared on any surface, so ` +
      'this run cannot tell an untranslated string from an unloaded catalogue and its count means ' +
      'nothing.\n' +
      '  - run `npm run i18n:pseudo` first, so the zz catalogues exist\n' +
      '  - check the dev server is serving them, and that BOOTSTRAP_ROUTE here still matches the ' +
      'URL the application fetches',
  );
  process.exit(1);
}

/**
 * Whether a string the audit found is text a user reads.
 *
 * This lived in both audits as a byte-identical copy of
 * `/^[A-Za-z][A-Za-z0-9 ,.'&()\/-]{2,}$/`, and that pattern silently discarded every string
 * containing `?`, `!`, `:`, `"`, `%` or `\u2026`, or starting with a digit. The instrument used to
 * claim "everything remaining is accounted for" could not see `Are you sure?`, `Company:`,
 * `50% complete` or `Loading\u2026` — which is exactly the punctuation an interface is full of, and
 * the reason this pull request kept reporting itself complete for eight review rounds.
 *
 * It is now permissive by default and exclusion is done by ORIGIN — the data containers and the
 * instance-data list — not by spelling. A filter that admits text through a punctuation allowlist
 * cannot be audited, because what it drops is invisible.
 *
 * The pseudo-locale is what separates signal from noise here: anything catalogue-sourced comes back
 * wrapped in `\u27E6\u2026\u27E7`, so a string WITHOUT the sentinel is by definition not from a
 * catalogue. Keeping every such string and filtering by where it renders is the honest order.
 */
export const looksLikeUiText = (text) => {
  // Strip COMPLETE `⟦…⟧` spans and judge what is left, rather than rejecting the whole string.
  //
  // Rejecting on `includes(SENTINEL)` hid the primary target. `⟦Šáṽë⟧ untranslated suffix` and
  // `Delete ⟦Ḟïłë⟧ now` both returned false, so every MIXED-language string — a keyed fragment
  // beside a hard-coded one, which is the concatenation class this audit exists to expose — was
  // invisible. That is a worse filter than the punctuation allowlist it replaced: the old one
  // dropped strings that happened to contain `?`, this one dropped the ones we were looking for.
  const remaining = text.replace(/\u27E6[^\u27E7]*\u27E7/g, ' ').trim();
  if (remaining.length < 3) return false;
  // At least three ASCII letters, so pure numbers, dates, ids and punctuation runs are not prose.
  return (remaining.match(/[A-Za-z]/g) ?? []).length >= 3;
};

/**
 * Whether a page ended up where it was sent.
 *
 * `authGuard` redirects an unauthenticated user to `/login` and `adminGuard` sends a non-admin to
 * `/dashboard`, silently. Measured on this instance: the audit runs as `Anonymous`, so eight of the
 * nine routes resolve but `/#/administration` lands on `/#/dashboard` — and every finding attributed
 * to administration was really the dashboard, counted a second time under the wrong name. The global
 * sentinel cannot catch it, because the page it was redirected TO renders the pseudo-locale too.
 */
export function routeReached(page, requested) {
  const landed = page.url().replace(/^https?:\/\/[^/]+/, '');
  const wanted = requested.replace(/^#?\/?#?/, '').replace(/^\//, '');
  return { ok: landed.includes(wanted), landed };
}

/**
 * Signs the audit in, so a guarded route is actually reachable.
 *
 * Neither audit authenticated. Both still resolved eight of nine routes, because the dev proxy
 * supplies credentials for the API — but the APPLICATION saw no session and fell back to
 * `Anonymous`, so `adminGuard` bounced `/#/administration` to `/#/dashboard` and every finding
 * there was the dashboard's, counted twice under the wrong name.
 *
 * This writes the same `sessionStorage` shape `scripts/beta-harness/helpers.mjs` writes, because a
 * second way of constructing a session is a second thing to keep in step. The page is reloaded
 * afterwards: `withHashLocation()` makes a `goto('/#/x')` same-document, so `APP_INITIALIZER` would
 * not otherwise re-run and the session would not be picked up.
 *
 * Credentials from `NUXEO_USER` / `NUXEO_PASS`, with no default: unset, this throws rather than
 * signing in as the local Docker administrator, which both halves used to fall back to
 * (NXSAT-649). Both audits check first and exit 2, so this is the backstop, not the message.
 */
export async function signIn(page, baseUrl) {
  const { username: user, password: pass } = requireNuxeoCredentials(
    'sign the pseudo-locale audit in',
  );

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(
    ({ key, value, signedOutKey }) => {
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(signedOutKey);
    },
    {
      key: SESSION_STORAGE_KEY,
      signedOutKey: SIGNED_OUT_STORAGE_KEY,
      value: JSON.stringify({
        kind: 'basic',
        username: user,
        basic: Buffer.from(`${user}:${pass}`).toString('base64'),
        isAdministrator: user.toLowerCase() === 'administrator',
        groups: [],
      }),
    },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return user;
}
