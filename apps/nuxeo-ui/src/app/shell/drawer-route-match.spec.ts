import type { AppNavItem } from '../platform-nav-items';
import { drawerItemForPath, drawerToOpenForRoute } from './drawer-route-match';

function item(path: string, hasDrawer: boolean): AppNavItem {
  return { id: `app.navbar.${path.slice(1)}`, label: path, icon: 'folder', path, hasDrawer };
}

const NAV_ITEMS: readonly AppNavItem[] = [
  item('/browse', true),
  item('/browse-archive', true),
  item('/search', false),
];

describe('drawerItemForPath', () => {
  it('matches the item that owns the path exactly', () => {
    expect(drawerItemForPath(NAV_ITEMS, '/browse')?.path).toBe('/browse');
  });

  it('matches a child route to its owning item, so a deep link opens the tree', () => {
    expect(drawerItemForPath(NAV_ITEMS, '/browse/default-domain/workspaces')?.path).toBe('/browse');
  });

  it('does not match a sibling route that merely shares a prefix', () => {
    // The regression this guards: a bare `startsWith` gave the retired `/browse-adf-hx` the
    // `/browse` drawer, because the two routes differed only by suffix.
    expect(drawerItemForPath(NAV_ITEMS, '/browse-archive')?.path).toBe('/browse-archive');
    expect(drawerItemForPath(NAV_ITEMS, '/browse-archive/some-folder')?.path).toBe(
      '/browse-archive',
    );
  });

  it('returns null for a route whose nav item has no drawer', () => {
    expect(drawerItemForPath(NAV_ITEMS, '/search')).toBeNull();
  });

  it('returns null for a route with no nav item at all', () => {
    expect(drawerItemForPath(NAV_ITEMS, '/tasks')).toBeNull();
  });
});

/**
 * NXSAT-811 — the route opens a drawer only when none is open. A document opened from Favorites,
 * Clipboard, Recently viewed, Collections, Search, Assets or Tasks, followed by its breadcrumb,
 * leads into `/browse/...`, and it used to swap the open drawer for the Browse tree. The Personal
 * Space drawer is the same case: its route redirects into `/browse/...`.
 */
describe('drawerToOpenForRoute', () => {
  const FAVORITES = item('/favorites', true);
  const PERSONAL_SPACE = item('/personal-space', true);
  const BROWSE = item('/browse', true);
  const ITEMS: readonly AppNavItem[] = [BROWSE, FAVORITES, PERSONAL_SPACE, item('/search', false)];

  describe('with no drawer open: a deep link, a reload or a browser back', () => {
    it('opens the drawer that owns the route', () => {
      expect(drawerToOpenForRoute(ITEMS, '/browse/default-domain/workspaces', null, false)).toBe(
        BROWSE,
      );
      expect(drawerToOpenForRoute(ITEMS, '/favorites', null, false)).toBe(FAVORITES);
    });

    it('opens nothing for a route no drawer owns', () => {
      expect(drawerToOpenForRoute(ITEMS, '/doc/abc', null, false)).toBeNull();
      expect(drawerToOpenForRoute(ITEMS, '/search', null, false)).toBeNull();
    });
  });

  describe('with a drawer open', () => {
    it('keeps Favorites open when a breadcrumb leads into Browse', () => {
      expect(
        drawerToOpenForRoute(ITEMS, '/browse/default-domain/workspaces/QA', FAVORITES, true),
      ).toBeNull();
    });

    it('keeps Personal Space open when its route redirects into Browse', () => {
      expect(
        drawerToOpenForRoute(
          ITEMS,
          '/browse/default-domain/UserWorkspaces/me',
          PERSONAL_SPACE,
          true,
        ),
      ).toBeNull();
    });

    it('never replaces an open drawer with another that owns the route', () => {
      expect(drawerToOpenForRoute(ITEMS, '/favorites', BROWSE, true)).toBeNull();
      expect(drawerToOpenForRoute(ITEMS, '/browse', FAVORITES, true)).toBeNull();
    });

    it('leaves the drawer alone for a route no drawer owns', () => {
      expect(drawerToOpenForRoute(ITEMS, '/doc/abc', FAVORITES, true)).toBeNull();
    });
  });

  // The shell clears the chosen drawer when it closes one, so this state is not produced today;
  // these keep the older rule for it.
  describe('with a drawer chosen but not open', () => {
    it('does not set again a drawer that is already chosen for this route', () => {
      expect(drawerToOpenForRoute(ITEMS, '/browse/some/folder', BROWSE, false)).toBeNull();
    });

    it('opens the drawer a route belongs to when another drawer was the one chosen', () => {
      expect(drawerToOpenForRoute(ITEMS, '/browse/some/folder', FAVORITES, false)).toBe(BROWSE);
    });
  });
});
