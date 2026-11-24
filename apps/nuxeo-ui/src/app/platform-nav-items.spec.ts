import {
  navGroup,
  THEMES_SETTINGS_PATH,
  visibleSettingsDrawerItems,
  type DrawerLinkItem,
} from './platform-nav-items';

describe('visibleSettingsDrawerItems', () => {
  it('includes Themes when theming is enabled', () => {
    const paths = visibleSettingsDrawerItems(true).map((item: DrawerLinkItem) => item.path);
    expect(paths).toContain(THEMES_SETTINGS_PATH);
  });

  it('omits Themes when theming is disabled', () => {
    const paths = visibleSettingsDrawerItems(false).map((item: DrawerLinkItem) => item.path);
    expect(paths).not.toContain(THEMES_SETTINGS_PATH);
  });
});

describe('navigation groups', () => {
  it('separates content, personal, work, administration and trash', () => {
    expect(
      [
        'dashboard',
        'browse',
        'assets',
        'collections',
        'personalSpace',
        'recentlyViewed',
        'favorites',
        'clipboard',
        'configurableView',
        'tasks',
        'expiredQueue',
        'administration',
        'trash',
      ].map((id) => navGroup('app.navbar.' + id)),
    ).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 4]);
  });
  it('keeps extension entries in the content group by default', () => {
    expect(navGroup('customer.nav.reports')).toBe(0);
  });
});
