import type { EnvironmentProviders } from '@angular/core';

import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';

/**
 * Every ID this plugin registers. IDs are a public contract: once a manifest places
 * `acme.components.claimEscalate`, renaming it is a breaking change.
 */
export const ACME_CLAIM_ESCALATE_PLUGIN_IDS = Object.freeze({
  components: [
    'acme.components.claimEscalate',
    // satori:ids:components — `nx g ...:extension-component` inserts here. Keep the marker.
  ],
} as const);

/**
 * The plugin of the custom element `acme-claim-escalate`: add it to an app's providers. Nothing
 * here runs until then, and the component shows only where a manifest places it.
 */
export function provideAcmeClaimEscalatePlugin(): EnvironmentProviders {
  return provideSatoriExtensions({
    components: {
      [ACME_CLAIM_ESCALATE_PLUGIN_IDS.components[0]]: () =>
        import('./acme-claim-escalate/acme-claim-escalate').then(
          (m) => m.AcmeClaimEscalateComponent,
        ),
      // satori:register:components
    },
  });
}
