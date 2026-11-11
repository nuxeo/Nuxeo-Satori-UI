import { TestBed } from '@angular/core/testing';

import { DEFAULT_KE_CIC_OPERATIONS, KE_CIC_OPERATIONS } from './ke.config';

/**
 * `KeClientService`'s spec always provides `KE_CIC_OPERATIONS` explicitly, so the token's
 * `providedIn: 'root'` factory was never executed — `ke.config.ts` reported 100% statements
 * and 0% functions. This is the Layer 0 default every deployment that does not override the
 * token in `app.config.ts` actually runs on.
 */
describe('ke.config injection token', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [] });
  });

  it('resolves KE_CIC_OPERATIONS to the connector operation ids with no override', () => {
    const ops = TestBed.inject(KE_CIC_OPERATIONS);

    expect(ops).toBe(DEFAULT_KE_CIC_OPERATIONS);
    expect(ops).toEqual({
      enrich: 'HylandKnowledgeEnrichment.Enrich',
      sendForEnrichment: 'HylandKnowledgeEnrichment.SendForEnrichment',
      getEnrichmentResults: 'HylandKnowledgeEnrichment.GetEnrichmentResults',
      uploadFile: 'HylandKnowledgeEnrichment.UploadFile',
      invoke: 'HylandKnowledgeEnrichment.Invoke',
      configure: 'HylandKnowledgeEnrichment.Configure',
    });
  });
});
