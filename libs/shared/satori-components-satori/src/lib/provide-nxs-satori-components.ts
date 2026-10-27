import type { EnvironmentProviders } from '@angular/core';
import type { SatAvatarCategory, SatAvatarSize } from '@hylandsoftware/satori-ui/avatar';
import type { SatTagCategory, SatTagStatus } from '@hylandsoftware/satori-ui/tag';
import {
  NXS_PRIMITIVE_IDS,
  type NxsAvatarColor,
  type NxsAvatarSize,
  type NxsTagColor,
  type NxsTagStatus,
} from '@nuxeo/satori-platform/components';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';

import { NxsSatoriActionBarComponent } from './action-bar/satori-action-bar.component';
import { NxsSatoriAvatarComponent } from './avatar/satori-avatar.component';
import { NxsSatoriBreadcrumbsComponent } from './breadcrumbs/satori-breadcrumbs.component';
import { NxsSatoriErrorStateComponent } from './error-state/satori-error-state.component';
import { NxsSatoriRichTooltipComponent } from './rich-tooltip/satori-rich-tooltip.component';
import { NxsSatoriStatusTagComponent } from './status-tag/satori-status-tag.component';
import { NxsSatoriTabsComponent } from './tabs/satori-tabs.component';
import { NxsSatoriTagComponent } from './tag/satori-tag.component';

/**
 * Re-register the avatar, breadcrumbs, tag, status tag, rich tooltip, error state, tabs and action
 * bar `NXS_PRIMITIVE_IDS` on Satori, over the Material implementations `provideNxsComponents()`
 * registered.
 *
 * Satori-if-available, Material otherwise, decided by which providers an application lists — not
 * at build time and not by a runtime probe. This entry point is the only one in the package that
 * imports `@hylandsoftware/satori-ui`, an optional peer, so an application without GitHub Packages
 * access never imports it and still gets every ID from `@nuxeo/satori-platform/components`.
 *
 * List it after `provideNxsComponents()`, because later registrations win. The Satori components
 * also need what any Satori host provides: `provideSatori()` from
 * `@hylandsoftware/satori-ui/providers` for the theme and icons, and Satori's `sat.*` catalogue in
 * ngx-translate — `provideAndConfigureSatoriTranslations` from `@hylandsoftware/satori-ui/translations`,
 * or seeded into your own loader as `apps/nuxeo-ui` does. Without the catalogue, the breadcrumbs'
 * landmark and the tooltip's close hint render as raw keys.
 */
export function provideNxsSatoriComponents(): EnvironmentProviders {
  return provideSatoriExtensions({
    components: {
      [NXS_PRIMITIVE_IDS.avatar]: NxsSatoriAvatarComponent,
      [NXS_PRIMITIVE_IDS.breadcrumbs]: NxsSatoriBreadcrumbsComponent,
      [NXS_PRIMITIVE_IDS.tag]: NxsSatoriTagComponent,
      [NXS_PRIMITIVE_IDS.statusTag]: NxsSatoriStatusTagComponent,
      [NXS_PRIMITIVE_IDS.richTooltip]: NxsSatoriRichTooltipComponent,
      [NXS_PRIMITIVE_IDS.errorState]: NxsSatoriErrorStateComponent,
      [NXS_PRIMITIVE_IDS.tabs]: NxsSatoriTabsComponent,
      [NXS_PRIMITIVE_IDS.actionBar]: NxsSatoriActionBarComponent,
    },
  });
}

/**
 * The base library's value types equal Satori's, in both directions, at compile time.
 *
 * `/components` may not import Satori, so it declares the unions itself and this entry point —
 * the one that may — proves they still match: a colour or size added or removed on either side
 * fails `typecheck` here. Tuple-wrapped so the comparison is not distributive, and `false` rather
 * than `never` in the else branch, because `never` satisfies `extends true`.
 */
type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type NxsSatoriValueContract = [
  Assert<Same<NxsAvatarColor, SatAvatarCategory>>,
  Assert<Same<NxsAvatarSize, SatAvatarSize>>,
  Assert<Same<NxsTagColor, SatTagCategory>>,
  Assert<Same<NxsTagStatus, SatTagStatus>>,
];
