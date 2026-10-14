import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app.routes';
import { RETIRED_ROUTES } from './retired-routes';

@Component({ standalone: true, selector: 'app-test-page', template: '' })
class PageComponent {}

/** The two pages the retired routes hand over to, shaped as the application routes them. */
const HARNESS_ROUTES: Routes = [
  {
    path: '',
    children: [
      ...RETIRED_ROUTES,
      { path: 'browse', children: [{ path: '**', component: PageComponent }] },
      { path: 'search', component: PageComponent },
    ],
  },
];

describe('retired adf-hx routes', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(HARNESS_ROUTES)] });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  function landedOn(): { segments: string[]; query: Record<string, unknown> } {
    const tree = router.parseUrl(router.url);
    return {
      segments: tree.root.children['primary']?.segments.map((segment) => segment.path) ?? [],
      query: { ...tree.queryParams },
    };
  }

  it('sends /browse-adf-hx to /browse with its query string unchanged', async () => {
    await harness.navigateByUrl('/browse-adf-hx?fresh=1&view=cards');

    expect(router.url).toBe('/browse?fresh=1&view=cards');
  });

  it('opens the folder an old link named in ?path=, keeping every query parameter', async () => {
    await harness.navigateByUrl('/browse-adf-hx?path=%2Fdefault-domain%2Fworkspaces&fresh=1');

    expect(landedOn()).toEqual({
      segments: ['browse', 'default-domain', 'workspaces'],
      query: { path: '/default-domain/workspaces', fresh: '1' },
    });
  });

  it('encodes a folder name as browse links do, so browse decodes it back', async () => {
    await harness.navigateByUrl('/browse-adf-hx?path=%2Fdefault-domain%2FMy%20Folder%2F');

    expect(router.url.split('?')[0]).toBe('/browse/default-domain/My%20Folder');
    expect(landedOn().query).toEqual({ path: '/default-domain/My Folder/' });
  });

  it('opens the repository root when ?path= is repeated rather than guessing between them', async () => {
    await harness.navigateByUrl('/browse-adf-hx?path=%2Fa&path=%2Fb');

    expect(landedOn()).toEqual({ segments: ['browse'], query: { path: ['/a', '/b'] } });
  });

  it('sends /search-adf-hx to /search with its query string unchanged', async () => {
    await harness.navigateByUrl('/search-adf-hx?q=invoice&page=2');

    expect(router.url).toBe('/search?q=invoice&page=2');
  });

  it('sends a bare /search-adf-hx to /search', async () => {
    await harness.navigateByUrl('/search-adf-hx');

    expect(router.url).toBe('/search');
  });

  it('is routed by the application shell, where the old links arrive', () => {
    const shell = routes.find((route) => route.path === '' && route.children);

    for (const retired of RETIRED_ROUTES) {
      expect(shell?.children).toContain(retired);
    }
    // Nothing else may still claim either path, or it would be matched before the redirect.
    const claims = (path: string) => shell?.children?.filter((route) => route.path === path);
    expect(claims('browse-adf-hx')?.length).toBe(1);
    expect(claims('search-adf-hx')?.length).toBe(1);
  });
});
