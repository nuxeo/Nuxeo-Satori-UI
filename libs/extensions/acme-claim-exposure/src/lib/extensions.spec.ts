import { TestBed } from '@angular/core/testing';

import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';

import { ACME_CLAIM_EXPOSURE_PLUGIN_IDS, provideAcmeClaimExposurePlugin } from './extensions';

/** Asserted against the registry, so a registration that does nothing fails. */
describe('provideAcmeClaimExposurePlugin', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideAcmeClaimExposurePlugin()] }),
  );

  it('registers its component, and nothing it does not list', () => {
    const registry = TestBed.inject(ExtensionComponentRegistry);
    for (const id of ACME_CLAIM_EXPOSURE_PLUGIN_IDS.components) expect(registry.has(id)).toBe(true);
    expect(registry.registeredComponentIds().filter((id) => id.startsWith('acme.'))).toEqual([
      ...ACME_CLAIM_EXPOSURE_PLUGIN_IDS.components,
    ]);
  });
});
