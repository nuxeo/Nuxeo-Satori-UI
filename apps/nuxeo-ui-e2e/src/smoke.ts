/**
 * The smoke subset: the tests every pull request into `main`, `integration/**` and `staging/**`
 * runs against the hosted Nuxeo (`.github/workflows/e2e-smoke.yml`), on Chromium, before it merges.
 * The nightly run (`e2e-nightly.yml`) still runs the whole suite on Chromium and WebKit.
 *
 * A test is in the subset when it carries this tag, `test('…', SMOKE, async …)`, and the workflow
 * selects it with `--grep @smoke`. Chosen so that a pull request cannot break the current app's
 * main paths unnoticed, in about two minutes of tests rather than the nightly's five per engine:
 *
 * - **signing in:** the form, filled and submitted with no other credential in the browser, lands
 *   on the dashboard as the account typed into it; a signed-out visitor is sent to the sign-in
 *   page, which renders a control to submit; an anonymous visitor does not reach administration;
 *   and a session survives a real reload. Every other test here also runs through the `signedIn`
 *   fixture, whose identity guard asks Nuxeo who the app in the page is, before and after the test;
 * - **browsing:** the repository root lists its domain as a row, and opening it lists its children;
 * - **opening a document:** its title and path, and the Permissions, History and Publishing tabs;
 * - **searching:** the index answers with results, one Enter sends one search, and an apostrophe
 *   reaches Nuxeo as data, the injection guard;
 * - **writing:** a document trashed through the API is listed in the trash and restored from it,
 *   and a collection made for the test is opened. These two create documents, which carry the run's
 *   prefix and are trashed at the end of the run whatever happened (`e2e-data.ts`, `uniqueTitle`);
 * - **tasks and administration:** the tasks drawer agrees with the repository's count, and
 *   administration opens exactly for an account that has it.
 *
 * Left to the nightly: the accessibility checks of the sign-in form, the administration pages one
 * by one, the 41-document paging search (25 s, and it writes to a shared workspace), the other
 * cross-engine checks, which mean something only beside WebKit, and the negative cases.
 */
export const SMOKE = { tag: '@smoke' } as const;
