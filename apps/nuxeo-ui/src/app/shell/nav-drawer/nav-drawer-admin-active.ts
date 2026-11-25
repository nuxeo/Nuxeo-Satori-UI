import { LAYOUT_DESIGNER_PATH } from '../../platform-nav-items';

/** The administration entries whose pages have pages of their own below them. */
const WITH_PAGES_BELOW: readonly string[] = ['/administration/users-groups', LAYOUT_DESIGNER_PATH];

/**
 * Whether the administration drawer marks the entry at `path` as the page open, for the router's
 * `url`: that page itself, or for an entry with pages below it, one of those, such as a user's
 * page under Users & Groups, or the layout designer's queues under Layout Designer. A free
 * function beside `drawerDueKey`, so that it is testable without standing up the drawer.
 */
export function adminDrawerPathActive(url: string, path: string): boolean {
  const page = url.split('?')[0];
  if (WITH_PAGES_BELOW.includes(path)) return page === path || page.startsWith(`${path}/`);
  return page === path;
}
