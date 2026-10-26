import type { EnvironmentProviders } from '@angular/core';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';

import { NxsAvatarComponent } from './avatar/avatar.component';
import { NxsBreadcrumbsComponent } from './breadcrumbs/breadcrumbs.component';
import { NxsErrorStateComponent } from './error-state/error-state.component';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { NxsRichTooltipComponent } from './rich-tooltip/rich-tooltip.component';
import { NxsTagComponent } from './tag/tag.component';
// satori:import:components — `satori-component` inserts above this line

/**
 * Register the library's components by ID, on Material. Needs no Satori.
 *
 * **SVG Icon Registration**: The Material implementations use `<mat-icon svgIcon="...">` for icons,
 * which requires SVG registration via `MatIconRegistry`. For Satori hosts, `provideSatori()` from
 * `@hylandsoftware/satori-ui/providers` handles this automatically. For Material-only hosts (those
 * not using Satori), register icons by calling `provideSatori({ theme: false })` to get only icon
 * registration, or register them manually via `MatIconRegistry.addSvgIconSetLiteral()` with
 * `SATORI_ICONS` from `@hylandsoftware/satori-icons`.
 *
 * Registration goes through `provideSatoriExtensions`, so it layers like every other contribution:
 * in provider order, later wins per ID. List it **before** `provideNxsSatoriComponents()` from
 * `@nuxeo/satori-platform/components-satori`, which re-registers four of the `NXS_PRIMITIVE_IDS` on
 * Satori, and before your own `provideSatoriExtensions(...)` calls, so an override of yours wins:
 *
 * ```ts
 * providers: [
 *   provideNxsComponents(),
 *   provideNxsSatoriComponents(), // only with access to @hylandsoftware/satori-ui
 *   provideSatoriExtensions({ components: { 'nxs.primitives.tag': () => import('./acme-tag').then((m) => m.AcmeTag) } }),
 * ];
 * ```
 */
export function provideNxsComponents(): EnvironmentProviders {
  return provideSatoriExtensions({
    components: {
      [NXS_PRIMITIVE_IDS.avatar]: NxsAvatarComponent,
      [NXS_PRIMITIVE_IDS.breadcrumbs]: NxsBreadcrumbsComponent,
      [NXS_PRIMITIVE_IDS.tag]: NxsTagComponent,
      [NXS_PRIMITIVE_IDS.richTooltip]: NxsRichTooltipComponent,
      [NXS_PRIMITIVE_IDS.errorState]: NxsErrorStateComponent,
      // satori:register:components — `satori-component` inserts above this line
    },
  });
}
