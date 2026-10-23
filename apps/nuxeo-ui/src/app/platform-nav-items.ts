import type { NavItemDescriptor } from '@nuxeo/satori-platform/extensions';
import type { SatNavigationItemWithIcon } from '@hylandsoftware/satori-ui/platform-nav';

/**
 * A nav entry in the shape Satori's platform nav renders.
 *
 * `id` is the registered extension ID and is the thing the drawer and the shell
 * key on. Before Phase 2 they keyed on `path`, which meant a manifest that
 * changed a route silently detached the entry from its drawer content.
 */
export interface AppNavItem extends SatNavigationItemWithIcon {
  readonly id: string;
  /**
   * Translation key for the entry's text, carried through from the descriptor.
   *
   * `label` stays populated with the English literal, because Satori's own nav type requires
   * it and because it is the fallback when no key resolves. Render sites prefer the key; see
   * `NavItemDescriptor.labelKey` for why this is a second field rather than a reinterpretation
   * of `label`.
   */
  readonly labelKey?: string;
  /** When true, clicking opens the side drawer instead of navigating directly. */
  readonly hasDrawer?: boolean;
}

export interface DrawerLinkItem {
  label: string;
  /** Translation key for `label`, preferred when it resolves. Same contract as `NavItemDescriptor`. */
  labelKey?: string;
  path: string;
}

/**
 * Adapt an extension descriptor to the shell's nav component.
 *
 * The descriptor type deliberately knows nothing about Satori — see
 * `NavItemDescriptor`. This function is the one place the two meet, so replacing
 * the nav component does not invalidate any customer's manifest.
 */
export function toAppNavItem(descriptor: NavItemDescriptor): AppNavItem {
  return {
    id: descriptor.id,
    label: descriptor.label,
    labelKey: descriptor.labelKey,
    path: descriptor.path,
    icon: descriptor.icon,
    hasDrawer: descriptor.hasDrawer,
  };
}

export const THEMES_SETTINGS_PATH = '/settings/themes';

export const SETTINGS_DRAWER_ITEMS: DrawerLinkItem[] = [
  { labelKey: 'drawer.settings-nuxeo-drive', label: 'Nuxeo Drive', path: '/settings/nuxeo-drive' },
  { labelKey: 'drawer.settings-profile', label: 'Profile', path: '/settings/profile' },
  {
    labelKey: 'drawer.settings-authorized-applications',
    label: 'Authorized Applications',
    path: '/settings/authorized-applications',
  },
  {
    labelKey: 'drawer.settings-cloud-services',
    label: 'Cloud Services',
    path: '/settings/cloud-services',
  },
  { labelKey: 'drawer.settings-themes', label: 'Themes', path: THEMES_SETTINGS_PATH },
];

/** Settings drawer links visible for the current theming feature flag. */
export function visibleSettingsDrawerItems(themingEnabled: boolean): DrawerLinkItem[] {
  return themingEnabled
    ? SETTINGS_DRAWER_ITEMS
    : SETTINGS_DRAWER_ITEMS.filter((item) => item.path !== THEMES_SETTINGS_PATH);
}

export const ADMINISTRATION_DRAWER_ITEMS: DrawerLinkItem[] = [
  {
    labelKey: 'drawer.administration-analytics',
    label: 'Analytics',
    path: '/administration/analytics',
  },
  {
    labelKey: 'drawer.administration-users-groups',
    label: 'Users & Groups',
    path: '/administration/users-groups',
  },
  {
    labelKey: 'drawer.administration-vocabularies',
    label: 'Vocabularies',
    path: '/administration/vocabularies',
  },
  { labelKey: 'drawer.administration-audit', label: 'Audit', path: '/administration/audit' },
  {
    labelKey: 'drawer.administration-cloud-services',
    label: 'Cloud Services',
    path: '/administration/cloud-services',
  },
  {
    labelKey: 'drawer.administration-nxql-search',
    label: 'NXQL Search',
    path: '/administration/nxql-search',
  },
];

/** Limited administration menu for `powerusers` (matches classic Web UI). */
export const POWERUSER_ADMINISTRATION_DRAWER_ITEMS: DrawerLinkItem[] = [
  {
    labelKey: 'drawer.administration-users-groups',
    label: 'Users & Groups',
    path: '/administration/users-groups',
  },
  {
    labelKey: 'drawer.administration-vocabularies',
    label: 'Vocabularies',
    path: '/administration/vocabularies',
  },
  { labelKey: 'drawer.administration-audit', label: 'Audit', path: '/administration/audit' },
];
