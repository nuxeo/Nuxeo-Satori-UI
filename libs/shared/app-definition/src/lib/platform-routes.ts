/**
 * The platform's own routes: the first segment of every path the application serves a page at,
 * as `apps/nuxeo-ui/src/app/app.routes.ts` declares them, the retired ones it still redirects
 * included. This is the one list of them (docs/business-apps/app-definition-v2.md, section 3).
 *
 * An app's address is where the shell is to open it, under the shell's own address, and is its id
 * when `app.json` gives none. One of these would be a page the platform has already: an app with
 * the id `contracts` and no address would take `/contracts`, the component showcase. So
 * `validateApp` refuses a written address that is one of them, and the command line says so of an
 * id with no address (`addressTakenById`), which the `app-package` generator never leaves out.
 *
 * `platform-routes.spec.ts` in `apps/nuxeo-ui` holds this list to the application's routes, both
 * ways: a route added there and not here, or kept here once removed there, fails it.
 */
export const PLATFORM_ROUTES: readonly string[] = [
  'administration',
  'browse',
  'browse-adf-hx',
  'clipboard',
  'collections',
  'contracts',
  'dashboard',
  'doc',
  'documents',
  'expired-queue',
  'favorites',
  'home',
  'knowledge-discovery',
  'login',
  'personal-space',
  'queues',
  'recently-viewed',
  'search',
  'search-adf-hx',
  'settings',
  'tasks',
  'trash',
];
