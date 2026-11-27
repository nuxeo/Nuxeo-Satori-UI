import { Injectable, inject } from '@angular/core';
import { NuxeoApiBase, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import type { Observable } from 'rxjs';

/** The operation the element's `nuxeo-operation` ran. */
export const ESCALATE_OPERATION = 'Claim.Escalate';

/**
 * The one request the custom element `acme-claim-escalate` sent: `Claim.Escalate` on the claim,
 * with its `reason`, as `<nuxeo-operation op="Claim.Escalate" input="[[document.uid]]"
 * params="[[_params(reason)]]">` did. Through the app's own HTTP service, so it goes to the app's
 * Nuxeo with the app's credentials, and nowhere else.
 *
 * Whether the operation may run is the server's to decide: hiding the button is not a control.
 */
@Injectable({ providedIn: 'root' })
export class ClaimEscalationService {
  private readonly api = inject(NuxeoApiBase);

  escalate(uid: string, reason: string): Observable<NuxeoDocument> {
    return this.api.post<NuxeoDocument>(`/nuxeo/api/v1/automation/${ESCALATE_OPERATION}`, {
      input: `doc:${uid}`,
      params: { reason },
      context: {},
    });
  }
}
