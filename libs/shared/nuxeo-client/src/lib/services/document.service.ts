import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { NuxeoDocument, NuxeoDocumentList } from '../models/document.model';
import {
  RECENTLY_EDITED_QUERY,
  RECENTLY_VIEWED_QUERY,
  EXPIRED_DOCUMENTS_QUERY,
} from '../queries/nxql-queries';
import { escapeNxqlLiteral } from '../utils/nxql.utils';
import { NuxeoApiBase } from './nuxeo-api-base';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly api = inject(NuxeoApiBase);

  getRecentlyEdited(pageSize = 10): Observable<NuxeoDocumentList> {
    return this.api.nxqlSearch(RECENTLY_EDITED_QUERY, pageSize);
  }

  /**
   * What the app lists as recently viewed: the records the user created or edited last, the most
   * recently modified first. Nuxeo records no read of a record, so this is what there is to go on.
   *
   * @param types only records of these document types, such as `Contract`; every type when left
   *   out or empty
   */
  getRecentlyViewed(
    userId: string,
    pageSize = 10,
    types: readonly string[] = [],
  ): Observable<NuxeoDocumentList> {
    // Escaped, because the id lands inside a quoted literal: `o'brien` was HTTP 400 on Nuxeo.
    // A replacer function, because a replacement string reads `$&` and `$'` in the id as patterns.
    const user = escapeNxqlLiteral(userId);
    let query = RECENTLY_VIEWED_QUERY.replace(/\{user\}/g, () => user);
    if (types.length > 0) {
      // Each type escaped too: a name is a literal here, as the user is.
      const listed = types.map((type) => `'${escapeNxqlLiteral(type)}'`).join(', ');
      query = query.replace(' ORDER BY ', () => ` AND ecm:primaryType IN (${listed}) ORDER BY `);
    }
    return this.api.nxqlSearch(query, pageSize);
  }

  getExpiredDocuments(pageSize = 20): Observable<NuxeoDocumentList> {
    const now = new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
    const query = EXPIRED_DOCUMENTS_QUERY.replace('{now}', now);
    return this.api.nxqlSearch(query, pageSize);
  }

  getById(docId: string): Observable<NuxeoDocument> {
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${docId}`);
  }
}
