/**
 * NXSAT-723 — every address that identifies no page reaches the not-found page.
 *
 * The ticket reported a blank page for an unmatched address; the catch-all `**` route fixed
 * that. What it could not fix is an address whose *prefix* matches: `/doc` consumes the `doc`
 * segment, leaves nothing for the feature's only child (`:uid`) to match, and a parent that
 * matched with no child to activate is a **successful navigation with an empty outlet** — not
 * a no-match the router can fall through to `**`. Measured before the fix: the header and the
 * nav rail, and no page.
 *
 * These tests drive the application's **own** shell children rather than a hand-written mirror,
 * so a route reordered or removed in `app.routes.ts` fails them. Two substitutions are made and
 * both are narrow:
 *
 * - `canActivate` is dropped. The guards resolve `AuthService` over HTTP, which is a different
 *   subject; route *matching* is what is under test here.
 * - the document-detail feature's **paths** are the real ones, resolved from the production
 *   `loadChildren`; only the component each one activates is swapped for a stub, so the heavy
 *   feature component is never instantiated.
 *
 * The second substitution used to hardcode `:uid` instead of resolving the loader, which meant
 * the `/doc/:uid` and `/doc/a/b` tests would have passed against a loader that returned nothing
 * at all — the drift protection this header claims was not enforced anywhere (caught in review
 * on PR #510). `resolves the feature's real child paths` below is what now enforces it.
 */
import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, type Route, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app.routes';
import { NotFoundPageComponent } from './not-found-page.component';
import { testTranslateModule } from './i18n/translate-testing';

@Component({
  standalone: true,
  selector: 'app-stub-document-detail',
  changeDetection: ChangeDetectionStrategy.Eager,
  // External even for a four-word test double: `AGENTS/03-angular-conventions.md` says
  // "ALWAYS external — never inline template" without carving out tests, and CLAUDE.md
  // repeats it among the non-negotiable conventions.
  templateUrl: './not-found-route.stub.html',
})
class StubDocumentDetailComponent {}

/** The route the application actually serves its pages from. */
const shell = routes.find((route) => route.path === '' && route.children);

/** Every `doc` route the shell declares, in the order the router will try them. */
const docRoutes = (shell?.children ?? []).filter((route) => route.path === 'doc');

/** The guards resolve `AuthService` over HTTP; route *matching* is what is under test. */
function withoutGuards(route: Route): Route {
  const copy = { ...route };
  delete copy.canActivate;
  return copy;
}

/**
 * The document-detail feature's child routes, resolved from the **production** loader — so a
 * loader that returned an empty or unrelated table cannot leave these tests passing.
 */
async function realDocChildren(): Promise<Routes> {
  const feature = docRoutes.find((route) => route.loadChildren);
  const loaded = await (feature?.loadChildren as () => Promise<Routes>)();
  return loaded;
}

/** Keeps the real paths; activates a stub so the feature component is never instantiated. */
function withStubComponent(route: Route): Route {
  const copy: Route = { ...route, component: StubDocumentDetailComponent };
  delete copy.loadComponent;
  return copy;
}

function harnessChildren(docChildren: Routes): Routes {
  return (shell?.children ?? []).map((route) => {
    if (route.path === 'doc' && route.loadChildren) {
      return { path: 'doc', children: docChildren.map(withStubComponent) } satisfies Route;
    }
    return withoutGuards(route);
  });
}

describe('not-found routing', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    const docChildren = await realDocChildren();

    TestBed.configureTestingModule({
      imports: [testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([{ path: '', children: harnessChildren(docChildren) }]),
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it('shows the not-found page for an address that matches nothing', async () => {
    // The address from the ticket. `navigateByUrl` throws unless the activated component is of
    // the given type; the returned instance is asserted too so the spec states an expectation
    // rather than relying only on the throw.
    const page = await harness.navigateByUrl('/qa-nowhere', NotFoundPageComponent);

    expect(page).toBeInstanceOf(NotFoundPageComponent);
  });

  it('shows the not-found page for /doc with no document id', async () => {
    await harness.navigateByUrl('/doc', NotFoundPageComponent);

    const text = (harness.routeNativeElement?.textContent ?? '').trim();
    // Rendered, rather than merely activated: the defect was a page with nothing on it.
    expect(text.length).toBeGreaterThan(0);
  });

  it('shows the not-found page for /doc with a leftover segment', async () => {
    // A segment the child cannot consume *is* a no-match, so this one reached `**` already.
    const page = await harness.navigateByUrl('/doc/a/b', NotFoundPageComponent);

    expect(page).toBeInstanceOf(NotFoundPageComponent);
  });

  it('still opens a document when the address carries an id', async () => {
    // The guard on the fix: `pathMatch: 'full'` is what keeps the bare-`doc` route off this one.
    const page = await harness.navigateByUrl(
      '/doc/4eb18e1a-89d6-4647-a9b1-8fa2a2db8fb8',
      StubDocumentDetailComponent,
    );

    expect(page).toBeInstanceOf(StubDocumentDetailComponent);
  });

  it("resolves the feature's real child paths, so the stub cannot stand in for a lost table", async () => {
    const children = await realDocChildren();

    // What makes the two tests above mean anything. The harness swaps each child's component
    // but keeps its path, so a production loader that returned nothing — or stopped taking a
    // single segment — would otherwise leave `/doc/:uid` and `/doc/a/b` passing against a table
    // this spec had invented. Asserting the exact paths is deliberate: a child added here
    // changes which addresses fall through to `**`, and that should be read, not absorbed.
    expect(children.map((route) => route.path)).toEqual([':uid']);
  });

  it('declares the bare-doc route before the one that loads the feature', () => {
    expect(docRoutes.length).toBe(2);

    const [bare, feature] = docRoutes;
    // Order and `pathMatch` are the whole mechanism: either one wrong and `/doc/:uid` breaks or
    // `/doc` goes back to rendering nothing.
    expect(bare.pathMatch).toBe('full');
    expect(bare.loadComponent).toBeDefined();
    expect(feature.pathMatch).toBeUndefined();
    expect(feature.loadChildren).toBeDefined();
  });

  it('points the bare-doc route at the same page an unmatched address gets', async () => {
    const [bare] = docRoutes;
    const wildcard = (shell?.children ?? []).find((route) => route.path === '**');

    // Resolved, not compared by reference: a route pointing at some *other* "not found" page
    // would satisfy a shape check and still be the wrong page.
    const loaded = await (bare.loadComponent as () => Promise<unknown>)();
    const wildcardLoaded = await (wildcard?.loadComponent as () => Promise<unknown>)();

    expect(loaded).toBe(NotFoundPageComponent);
    expect(wildcardLoaded).toBe(NotFoundPageComponent);
  });
});
