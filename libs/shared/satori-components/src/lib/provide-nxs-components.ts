import type { EnvironmentProviders } from '@angular/core';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';

import { NxsAvatarComponent } from './avatar/avatar.component';
import { NxsBannerComponent } from './banner/banner.component';
import { NxsBreadcrumbsComponent } from './breadcrumbs/breadcrumbs.component';
import { NxsChipSetComponent } from './chip-set/chip-set.component';
import { NxsCardComponent } from './card/card.component';
import { NxsDocumentToolbarComponent } from './document-toolbar/document-toolbar.component';
import { NxsEmptyStateComponent } from './empty-state/empty-state.component';
import { NxsErrorStateComponent } from './error-state/error-state.component';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { NxsRichTooltipComponent } from './rich-tooltip/rich-tooltip.component';
import { NxsStatusTagComponent } from './status-tag/status-tag.component';
import { NxsTabsComponent } from './tabs/tabs.component';
import { NxsTagComponent } from './tag/tag.component';
// satori:import:components — `satori-component` inserts above this line

/**
 * Register the library's components by ID, on Material. Needs no Satori.
 *
 * **SVG Icon Registration**: The Material implementations use `<mat-icon svgIcon="...">` for icons,
 * which requires SVG registration via `MatIconRegistry`. For Satori hosts, `provideSatori()` handles
 * this automatically. For Material-only hosts, register icons by calling
 * `provideSatori({ theme: false })` for icon-only registration, or register them manually via
 * `MatIconRegistry.addSvgIconSetLiteral()` with the Satori icon set.
 *
 * Registration goes through `provideSatoriExtensions`, so it layers like every other contribution:
 * in provider order, later wins per ID. List it **before** `provideNxsSatoriComponents()` from
 * `components-satori`, which re-registers every `NXS_PRIMITIVE_IDS` entry on Satori, and
 * before your own `provideSatoriExtensions(...)` calls, so an override of yours wins.
 */
export function provideNxsComponents(): EnvironmentProviders {
  return provideSatoriExtensions({
    components: {
      [NXS_PRIMITIVE_IDS.avatar]: NxsAvatarComponent,
      [NXS_PRIMITIVE_IDS.breadcrumbs]: NxsBreadcrumbsComponent,
      [NXS_PRIMITIVE_IDS.tag]: NxsTagComponent,
      [NXS_PRIMITIVE_IDS.statusTag]: NxsStatusTagComponent,
      [NXS_PRIMITIVE_IDS.richTooltip]: NxsRichTooltipComponent,
      [NXS_PRIMITIVE_IDS.errorState]: NxsErrorStateComponent,
      [NXS_PRIMITIVE_IDS.banner]: NxsBannerComponent,
      [NXS_PRIMITIVE_IDS.chipSet]: NxsChipSetComponent,
      [NXS_PRIMITIVE_IDS.tabs]: NxsTabsComponent,
      [NXS_PRIMITIVE_IDS.actionBar]: NxsDocumentToolbarComponent,
      [NXS_PRIMITIVE_IDS.card]: NxsCardComponent,
      [NXS_PRIMITIVE_IDS.emptyState]: NxsEmptyStateComponent,
      // satori:register:components — `satori-component` inserts above this line
    },
  });
}
