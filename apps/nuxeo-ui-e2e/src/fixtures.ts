import { test as base, expect, request, type APIRequestContext, type Page } from '@playwright/test';

import {
  assertIdentity,
  checkPageIdentity,
  checkRequestIdentity,
  ME_PATH,
  watchNuxeoApiOrigins,
} from '../../../scripts/beta-harness/identity-guard.mjs';
import { nuxeoCredentials } from './nuxeo-credentials';

/**
 * The session shape `AuthService` writes after a successful sign-in.
 *
 * Injected rather than driven through the sign-in UI, for two reasons. Every spec would
 * otherwise re-test the same form, making the sign-in path the slowest and most repeated
 * assertion in the suite; and the real deployment authenticates through SSO, which cannot
 * be driven here at all. The sign-in form has its own spec — `auth.spec.ts` — so the path
 * is covered once, deliberately, instead of incidentally everywhere.
 */
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

function sessionFor(username: string, password: string) {
  return {
    kind: 'basic',
    username,
    basic: Buffer.from(`${username}:${password}`).toString('base64'),
    isAdministrator: username.toLowerCase() === 'administrator',
    groups: [] as string[],
  };
}

export const test = base.extend<{ signedIn: Page }>({
  /**
   * A page that is already past the route guard.
   *
   * `addInitScript` rather than `storageState`: Playwright's `storageState` persists
   * cookies and **localStorage** only, and this app keeps its session in `sessionStorage`.
   * A `storageState` fixture would look right, run, and leave every spec signed out — the
   * kind of green that is worse than a red. `addInitScript` runs before page scripts on
   * every navigation in the context, which is what makes it survive the reloads these
   * specs perform.
   *
   * The identity guard (NXSAT-643, `scripts/beta-harness/identity-guard.mjs`) runs at both
   * ends. Before: cookies cleared, so a guest session cannot be adopted, and `page.request`
   * asked who it runs as. After: `page.request` asked again, and Nuxeo asked who the app in the
   * page is, the way the app asks and replayed from Node.
   * A test whose result was obtained as `Anonymous` or as anyone else fails, even if every
   * assertion in it passed — on a guest-enabled Nuxeo, a render assertion passes either way.
   */
  signedIn: async ({ page }, use, testInfo) => {
    // Through the same helper as every other caller. These two lines each carried a `??`
    // fallback on the user AND the password — the working default pair, compiled into the
    // repository, which is the exact construction `.cursor/rules/security.mdc` forbids. The
    // docblock on `nuxeoCredentials` already described that fallback as removed while it
    // survived here.
    const { username, password } = nuxeoCredentials();

    await page.context().clearCookies();
    assertIdentity(
      [
        await checkRequestIdentity(
          page.request,
          new URL(ME_PATH, E2E_BASE_URL).href,
          username,
          'page.request',
        ),
      ],
      `before "${testInfo.title}"`,
    );

    const foreignApiOrigins = watchNuxeoApiOrigins(page, E2E_BASE_URL);

    // NXSAT-708 vacuity control, opt-in and off by default.
    //
    // `E2E_STARVE_APP=1` makes every data call the **app in the page** sends answer
    // healthily-but-empty: HTTP 200, well-formed, zero rows. Discovery is untouched —
    // `newNuxeoApiContext()` uses its own `request.newContext()`, which `page.route` cannot
    // reach — so a spec still knows which document it expected to see.
    //
    // A spec whose assertion really reads repository data must then fail at its own
    // `expect()`. A spec that still PASSES is asserting something that survives an empty
    // repository, which is the defect the negative control exists to find and, since
    // NXSAT-643's guard began failing the wrong-password run in setup, can no longer find.
    //
    // `/me` is let through deliberately: the guard below probes it to confirm the page is
    // still the expected user. Starving it would move the failure into this fixture, which
    // is exactly the hook-shaped failure that made the credential-based control unmeasurable.
    if (process.env['E2E_STARVE_APP'] === '1') {
      await page.route('**/nuxeo/api/**', async (route) => {
        // `continue()`, not `fallback()`: there is no second handler to fall back to, and
        // "send this one to the network" is what is meant.
        if (route.request().url().includes('/api/v1/me')) return route.continue();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            'entity-type': 'documents',
            entries: [],
            resultsCount: 0,
            pageSize: 40,
            currentPageIndex: 0,
            numberOfPages: 0,
            isNextPageAvailable: false,
          }),
        });
      });
    }

    await page.addInitScript(
      ({ key, signedOutKey, value }) => {
        sessionStorage.setItem(key, value);
        sessionStorage.removeItem(signedOutKey);
      },
      {
        key: SESSION_KEY,
        signedOutKey: SIGNED_OUT_KEY,
        value: JSON.stringify(sessionFor(username, password)),
      },
    );

    await use(page);

    // A test that already failed keeps its own error; the guard would only bury it.
    if (testInfo.status !== testInfo.expectedStatus) return;
    // Both channels again: `page.request` shares the browser's cookie jar, so a guest cookie the
    // test picked up can move it as well as the app.
    assertIdentity(
      [
        await checkRequestIdentity(
          page.request,
          new URL(ME_PATH, E2E_BASE_URL).href,
          username,
          'page.request',
        ),
        await checkPageIdentity(page, username, new URL(E2E_BASE_URL).origin, {
          foreignApiOrigins,
        }),
      ],
      `after "${testInfo.title}"`,
    );
  },
});

export { expect };

/**
 * Assert the app rendered the surface rather than an error or empty state.
 *
 * `toBeVisible` on the feature component alone is not enough: an authentication failure
 * renders the component with no rows, which is visible and proves nothing. So every
 * critical-path spec asserts a piece of **repository data**, which can only be there if the
 * XHR was authenticated and Nuxeo answered.
 */
export async function expectSurfaceWithData(page: Page, selector: string, text: string | RegExp) {
  const host = page.locator(selector);
  await expect(host, `${selector} should render`).toBeVisible();
  await expect(host, `${selector} should show repository data, not an empty state`).toContainText(
    text,
  );
}

/**
 * Assert the text appears in a **row** of a listing surface, not merely somewhere inside it.
 *
 * `expectSurfaceWithData` searches the whole surface, which is sound wherever the surface's
 * own empty state cannot contain the expected text. On `lib-browse` it can: the empty state
 * reads "Open Sections, Templates, or Workspaces, then create content inside those folders",
 * and `aRootChild()` returns one of exactly those three titles in a stock repository. So the
 * assertion matched the instructions telling the user the folder was empty. Measured against
 * an app served an empty repository (NXSAT-708): 0 rows, "0 results" on screen, and the
 * assertion green — under a message reading "should show repository data, not an empty state".
 *
 * A row is only rendered for a document, so scoping to rows cannot pass on an empty state.
 * `tbody tr` rather than `getByRole('row')`, because that role also matches the **header**
 * row — so a title colliding with a column name ("Title", "Modified") would have passed on
 * the header and reintroduced the same defect one row higher. A surface with no `tbody`
 * matches nothing and fails loudly, which is the safe direction for a check like this.
 *
 * Used where the surface's empty copy and its data can collide; `expectSurfaceWithData`
 * remains correct for document detail and search, where the starved run shows it failing.
 */
export async function expectRowWithData(page: Page, selector: string, text: string | RegExp) {
  const host = page.locator(selector);
  await expect(host, `${selector} should render`).toBeVisible();
  await expect(
    host.locator('tbody tr').filter({ hasText: text }).first(),
    `${selector} should list "${text}" as a row, not merely mention it in an empty state`,
  ).toBeVisible();
}

export const E2E_BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';

/**
 * Nuxeo credentials from the environment, with **no** fallback.
 *
 * Re-exported from `./nuxeo-credentials` rather than defined here. The docblock that stood in
 * this place claimed this file was "the one place either value is read"; review showed it was
 * not — `playwright.config.ts` read both with its own `??` fallback pair — and a config cannot
 * import this module without evaluating `base.extend(...)` at config-load time. See
 * `nuxeo-credentials.ts` for why the helper is its own module.
 */
export { nuxeoCredentials };

/**
 * An authenticated request context against the served app, which proxies `/nuxeo` onward.
 *
 * The `Authorization` header is set **explicitly** rather than left to `httpCredentials`, and
 * that is the difference between this helper working and not. Playwright sends
 * `httpCredentials` in response to a `401` challenge; this Nuxeo answers an unauthenticated
 * query with **HTTP 200, `resultsCount: 0` and no `WWW-Authenticate` header at all**, so no
 * challenge is ever issued, the credentials are never sent, and the query runs as Anonymous.
 *
 * Verified directly: the same NXQL that returns every `WorkspaceRoot` with a Basic header
 * returns `200` with zero entries without one. Both copies of `aRootChild` relied on
 * `httpCredentials`, so even with a valid predicate they would have found nothing — and
 * "200 with no rows" is exactly the shape that makes a repository-data assertion vacuous.
 *
 * ## Why the identity is then checked rather than assumed
 *
 * Setting the header is not the same as the header working, and no status code distinguishes
 * the two: Nuxeo answers as `Anonymous` with `200`. Nor is an empty result a reliable tell —
 * measured on a populated instance, the `WorkspaceRoot` query above returns `resultsCount: 0`
 * anonymously, but `SELECT * FROM Document WHERE ecm:primaryType = 'File'` returns
 * `resultsCount: 1` against `1154` authenticated. A spec discovering a fixture through the
 * second query gets a document, a title and a green assertion while running as the wrong
 * user. So the identity is asserted once, here, against `/nuxeo/api/v1/me`, which is the only
 * response that names who the request ran as.
 */
export async function newNuxeoApiContext(): Promise<APIRequestContext> {
  const { username, password } = nuxeoCredentials();
  const api = await request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });
  try {
    await expectAuthenticatedAs(api, username);
  } catch (error) {
    await api.dispose();
    throw error;
  }
  return api;
}

/**
 * Assert the context's requests actually run as `username`, not as `Anonymous`.
 *
 * `/nuxeo/api/v1/me` reports the authenticated principal, so it is the one check that can tell
 * a working `Authorization` header from an ignored one. Every other signal this suite has is
 * shared by both identities: the status is `200` either way, there is no `WWW-Authenticate`
 * to observe, and a non-empty result set only means *something* was readable.
 *
 * Throwing rather than `expect`ing so it is usable from `beforeAll`, where a failed assertion
 * would otherwise be reported against the first test rather than the fixture.
 */
export async function expectAuthenticatedAs(
  api: APIRequestContext,
  username: string,
): Promise<void> {
  // Through the shared guard's own probe (NXSAT-643), so the Playwright side and the `.mjs`
  // harnesses reject the same answers, a redirected `/me` included — this used to be its own copy.
  const report = await checkRequestIdentity(api, ME_PATH, username, 'the API context');
  if (!report.ok) {
    throw new Error(
      `The API context is NOT authenticated as ${username}: ${report.problem}. The ` +
        `Authorization header was not accepted, so every query this context makes runs with ` +
        `the wrong permissions — and still returns 200, which is why this is checked rather ` +
        `than inferred from a green result.`,
    );
  }
}

/**
 * A document the **browse root actually lists**, discovered from the API.
 *
 * Discovering it rather than hardcoding a title is the point of the helper, and that part was
 * always right. What it discovered was not.
 *
 * It used to return a `WorkspaceRoot` directly under `/default-domain` — `Workspaces` — while
 * claiming in this docblock to be "a child of `/default-domain` that the browse root lists".
 * The browse root lists the children of the repository root `/`, which in a stock instance is
 * the single `Domain` at `/default-domain`. `Workspaces` is one level below that and is never
 * a row on that screen. Measured at `integration/nxsat-308` @ 8badd9c8e: the browse root
 * renders exactly one body row, `Domain`, while this helper returned `Workspaces`.
 *
 * So every spec that asserted the returned title against `lib-browse` was green for the wrong
 * reason: the surface's empty state reads "Open Sections, Templates, or Workspaces, then
 * create content inside those folders", and `toContainText('Workspaces')` matched that
 * sentence. Four call sites, passing on the instructions that tell a user the folder is empty.
 * NXSAT-708 found it by serving the app an empty repository and watching them all stay green.
 *
 * The depth is **checked**, not assumed, for the same reason the previous version checked it:
 * a `Domain` nested deeper would be a title that is genuinely in the repository and genuinely
 * not on that screen, and the spec would fail pointing at the wrong thing.
 */
export async function aRootChild(api: APIRequestContext): Promise<{ uid: string; title: string }> {
  const response = await api.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
    params: {
      query: "SELECT * FROM Document WHERE ecm:primaryType = 'Domain' AND ecm:isTrashed = 0",
      pageSize: 20,
    },
    headers: { 'X-NXproperties': '*' },
  });

  if (!response.ok()) throw new Error(`API query failed: ${response.status()}`);

  const body = await response.json();
  const directChildren = (body.entries ?? []).filter((entry: { path?: string }) =>
    /^\/[^/]+$/.test(entry.path ?? ''),
  );

  if (directChildren.length === 0) {
    throw new Error(
      `No Domain directly under the repository root (the query matched ` +
        `${(body.entries ?? []).length} document(s) at other depths). A stock Nuxeo has one at ` +
        `/default-domain; without it the browse-root specs have no repository data to assert ` +
        `and would pass vacuously.`,
    );
  }

  return {
    uid: directChildren[0].uid,
    title: directChildren[0].title,
  };
}
