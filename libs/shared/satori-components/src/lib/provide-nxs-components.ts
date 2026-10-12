import type { EnvironmentProviders } from '@angular/core';
import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';

import { NxsAvatarComponent } from './avatar/avatar.component';
import { NxsBreadcrumbsComponent } from './breadcrumbs/breadcrumbs.component';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { NxsRichTooltipComponent } from './rich-tooltip/rich-tooltip.component';
import { NxsTagComponent } from './tag/tag.component';

/**
 * Register the library's components by ID, on Material. Needs no Satori.
 *
 * Registration goes through `provideSatoriExtensions`, so it layers like every other contribution:
 * in provider order, later wins per ID. List it **before** `provideNxsSatoriComponents()` from
 * `@nuxeo-satori/platform/components-satori`, which re-registers the four `NXS_PRIMITIVE_IDS` on
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
    },
  });
}
