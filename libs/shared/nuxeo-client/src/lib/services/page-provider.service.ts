import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';

import type { NuxeoDocumentList } from '../models/document.model';
import { NuxeoApiBase } from './nuxeo-api-base';

/** One key of a page provider's order: a property, `<prefix>:<name>`, and a direction. */
export interface PageProviderSort {
  readonly field: string;
  readonly order: 'asc' | 'desc';
}

/** What one page of a page provider's results is asked with. */
export interface PageProviderRequest {
  /**
   * The provider's parameters, in order. Each is sent as a `queryParams` value of its own, which
   * Nuxeo reads whole, commas and all. Nuxeo replaces `$currentUser` with the signed-in user's
   * name, on the server.
   */
  readonly parameters?: readonly string[];
  /** 1 to 1000. */
  readonly pageSize: number;
  /** From 0. */
  readonly pageIndex?: number;
  /** The order, first key first. Absent or empty, the provider's own. */
  readonly sort?: readonly PageProviderSort[];
  /** The schemas each row carries, as the `properties` header names them. Every one by default. */
  readonly properties?: string;
}

/** A page provider's name, as the server defines one. */
const PAGE_PROVIDER = /^[A-Za-z0-9_.-]+$/;

/** A property as a sort names it. Nuxeo splits `sortBy` on commas, so a comma cannot be in one. */
const SORT_FIELD = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Runs a page provider: a search defined on the server, which binds its own parameters, so the
 * client never writes a query. The records it returns are those the user may read; nothing here
 * widens or narrows that.
 */
@Injectable({ providedIn: 'root' })
export class PageProviderService {
  private readonly api = inject(NuxeoApiBase);

  /**
   * One page of `name`'s results. Each row carries the `permissions` enricher, without which a
   * row action's rule such as `app.rules.canWrite` answers false.
   *
   * Errors, without a request, for a name that is not a page provider's or a sort that is not a
   * property and a direction; otherwise as the request does.
   */
  execute(name: string, request: PageProviderRequest): Observable<NuxeoDocumentList> {
    if (!PAGE_PROVIDER.test(name)) {
      return throwError(() => new Error(`"${name}" is not the name of a page provider`));
    }
    const sort = request.sort ?? [];
    const wrong = sort.find(
      (key) => !SORT_FIELD.test(key.field) || (key.order !== 'asc' && key.order !== 'desc'),
    );
    if (wrong) {
      return throwError(
        () =>
          new Error(
            `a page provider sorts by <prefix>:<name> asc or desc, not ${JSON.stringify(wrong)}`,
          ),
      );
    }
    let params = new HttpParams()
      .set('pageSize', request.pageSize)
      .set('currentPageIndex', request.pageIndex ?? 0);
    for (const parameter of request.parameters ?? []) {
      params = params.append('queryParams', parameter);
    }
    if (sort.length > 0) {
      params = params
        .set('sortBy', sort.map((key) => key.field).join(','))
        .set('sortOrder', sort.map((key) => key.order).join(','));
    }
    return this.api.get<NuxeoDocumentList>(
      `/nuxeo/api/v1/search/pp/${encodeURIComponent(name)}/execute`,
      params,
      { properties: request.properties ?? '*', 'enrichers.document': 'permissions' },
    );
  }
}
