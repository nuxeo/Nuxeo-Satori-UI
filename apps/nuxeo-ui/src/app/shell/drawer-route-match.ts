import type { AppNavItem } from '../platform-nav-items';

/**
 * The nav item whose drawer belongs to `path`, or `null`.
 *
 * Extracted from `AppShellComponent` because the decision is pure — a path and a list in,
 * one item out — while the component it lived in needs the router, the extension registry
 * and a dozen services to instantiate. Keeping it here means the matching rules below can
 * be asserted directly instead of through a shell fixture.
 *
 * A nav item owns its own path and everything beneath it, so `/browse/some/folder` still
 * resolves to the browse drawer. The separator is required: without it a sibling route that
 * differs only by suffix would match the `/browse` item by prefix and open the wrong tree, as
 * the retired `/browse-adf-hx` did while it had a drawer of its own.
 */
export function drawerItemForPath(
  navItems: readonly AppNavItem[],
  path: string,
): AppNavItem | null {
  return (
    navItems.find(
      (item) => item.hasDrawer && (path === item.path || path.startsWith(`${item.path}/`)),
    ) ?? null
  );
}

/**
 * The drawer to open after a navigation to `path`, or `null` to leave the side nav as it is.
 *
 * The route opens a drawer only when the user has none open: that is a deep link, a reload, or a
 * browser back, which arrive with nothing open and should show the section the route belongs to.
 * An open drawer is never replaced. The user chose it and is working from its list, so opening a
 * document from Favorites and then following the document's breadcrumb, which leads into
 * `/browse/...`, must not swap Favorites for the Browse tree. The Personal Space drawer is the
 * same case: its route redirects into `/browse/...`, and the Browse tree must not take it over.
 *
 * `active` being the item that already owns the route returns `null` even when its drawer is
 * closed: re-setting it would reopen a drawer the user has just closed.
 */
export function drawerToOpenForRoute(
  navItems: readonly AppNavItem[],
  path: string,
  active: AppNavItem | null,
  open: boolean,
): AppNavItem | null {
  if (open && active) return null;
  const owner = drawerItemForPath(navItems, path);
  return owner && active?.path !== owner.path ? owner : null;
}
