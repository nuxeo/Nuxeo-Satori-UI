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
          `${E2E_BASE_URL}${ME_PATH}`,
          username,
          'page.request',
        ),
      ],
      `before "${testInfo.title}"`,
    );

    const foreignApiOrigins = watchNuxeoApiOrigins(page, E2E_BASE_URL);

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
          `${E2E_BASE_URL}${ME_PATH}`,
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
 * A child of `/default-domain` that the browse root lists, discovered from the API.
 *
 * Discovering it rather than hardcoding `'Root'` is the point of the helper, and it was right.
 * The query was not: it asked for `ecm:path = '/default-domain' AND ecm:primaryType =
 * 'WorkspaceRoot'`, and no document can satisfy both — `ecm:path =` is exact match,
 * `/default-domain` is a `Domain`, and every `WorkspaceRoot` sits one level below it at
 * `<domain>/workspaces`. It returned zero rows on every instance, so the helper threw and the
 * five specs calling it errored. `STARTSWITH` is the predicate that expresses "below the
 * domain".
 *
 * The depth is then **checked**, not assumed. `STARTSWITH` would also match a `WorkspaceRoot`
 * nested further down, which the browse root does not list — so the helper would hand back a
 * title that is genuinely in the repository and genuinely not on the page, and the spec would
 * fail pointing at the wrong thing.
 */
export async function aRootChild(api: APIRequestContext): Promise<{ uid: string; title: string }> {
  const response = await api.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
    params: {
      query:
        "SELECT * FROM Document WHERE ecm:path STARTSWITH '/default-domain' " +
        "AND ecm:primaryType = 'WorkspaceRoot'",
      pageSize: 20,
    },
    headers: { 'X-NXproperties': '*' },
  });

  if (!response.ok()) throw new Error(`API query failed: ${response.status()}`);

  const body = await response.json();
  const directChildren = (body.entries ?? []).filter((entry: { path?: string }) =>
    /^\/default-domain\/[^/]+$/.test(entry.path ?? ''),
  );

  if (directChildren.length === 0) {
    throw new Error(
      `No WorkspaceRoot directly under /default-domain (the query matched ` +
        `${(body.entries ?? []).length} document(s) at other depths). A stock Nuxeo has one at ` +
        `/default-domain/workspaces; without it the browse-root specs have no repository data ` +
        `to assert and would pass vacuously.`,
    );
  }

  return {
    uid: directChildren[0].uid,
    title: directChildren[0].title,
  };
}
