import { InjectionToken } from '@angular/core';

/**
 * Knowledge Enrichment automation ops exposed by the Hyland Content
 * Intelligence Connector (`nuxeo-labs-content-intelligence-connector`).
 *
 * We currently use the synchronous `HylandKnowledgeEnrichment.Enrich` op from
 * the browser. It accepts multipart input with a blob part named `input` and a
 * JSON request part named `request`, letting Angular route KE calls through the
 * existing authenticated Nuxeo session without shipping tenant secrets to the
 * browser.
 */
export interface KeCicOperations {
  enrich: string;
  sendForEnrichment: string;
  getEnrichmentResults: string;
  uploadFile: string;
  invoke: string;
  configure: string;
}

export const DEFAULT_KE_CIC_OPERATIONS: KeCicOperations = {
  enrich: 'HylandKnowledgeEnrichment.Enrich',
  sendForEnrichment: 'HylandKnowledgeEnrichment.SendForEnrichment',
  getEnrichmentResults: 'HylandKnowledgeEnrichment.GetEnrichmentResults',
  uploadFile: 'HylandKnowledgeEnrichment.UploadFile',
  invoke: 'HylandKnowledgeEnrichment.Invoke',
  configure: 'HylandKnowledgeEnrichment.Configure',
};

export const KE_CIC_OPERATIONS = new InjectionToken<KeCicOperations>('KE_CIC_OPERATIONS', {
  providedIn: 'root',
  factory: () => DEFAULT_KE_CIC_OPERATIONS,
});
