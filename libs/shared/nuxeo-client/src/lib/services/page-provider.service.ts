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
  /**
   * The buckets chosen in the provider's aggregates, by aggregate id: each sent as a parameter
   * named after the aggregate, its bucket keys a JSON array, as the search page sends its filters.
   * Nuxeo keeps the records in any of one aggregate's chosen buckets, and in all the aggregates
   * chosen in, and returns each aggregate's buckets and its `selection` with the results. An
   * aggregate with no key chosen is not sent.
   */
  readonly aggregates?: Readonly<Record<string, readonly string[]>>;
}

/**
 * One page of a page provider's results. A provider the search index serves also returns its
 * aggregates, by id, each with its `buckets`; one that queries the repository returns none, or
 * `null`. They are left as the server writes them: each aggregate type has its own shape.
 */
export interface PageProviderResults extends NuxeoDocumentList {
  readonly aggregations?: Readonly<Record<string, unknown>> | null;
}

/**
 * A page provider's name, as the validator of app definitions accepts one: a letter first, so
 * that neither `.` nor `..` can stand in a path.
 */
const PAGE_PROVIDER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** Whether `name` can be a page provider's: see {@link PAGE_PROVIDER}. */
export function isPageProviderName(name: string): boolean {
  return PAGE_PROVIDER.test(name);
}

/** Nuxeo reads a page size of 0 as no limit, so a page is 1 to this many records. */
const MAX_PAGE_SIZE = 1000;

/** A property as a sort names it. Nuxeo splits `sortBy` on commas, so a comma cannot be in one. */
const SORT_FIELD = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * An aggregate as a request may name one: letters, digits and `_`, as Nuxeo's own are named
 * (`dc_creator_agg`). Neither `.` nor `-`, which the server's rendering parameters use
 * (`enrichers.document`, `fetch-document`).
 */
const AGGREGATE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

/**
 * The parameters the search endpoint, or the rendering of its response, reads for itself
 * (`QueryExecutor` and `RenderingContextWebUtils`). An aggregate of one of these names would
 * replace the page, the order or the properties of every row rather than filter.
 */
const RESERVED_PARAMETERS: ReadonlySet<string> = new Set([
  'query',
  'pageSize',
  'currentPageIndex',
  'offset',
  'maxResults',
  'sortBy',
  'sortOrder',
  'queryParams',
  'quickFilters',
  'highlight',
  'properties',
  'depth',
  'embed',
]);

/** Whether a request may filter on the aggregate `name`: see {@link PageProviderRequest.aggregates}. */
export function isAggregateParameter(name: string): boolean {
  return AGGREGATE.test(name) && !RESERVED_PARAMETERS.has(name);
}

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
   * Errors, without a request, for a name that is not a page provider's, a page size outside 1 to
   * 1000, a sort that is not a property and a direction, or an aggregate that
   * {@link isAggregateParameter} refuses; otherwise as the request does.
   */
  execute(name: string, request: PageProviderRequest): Observable<PageProviderResults> {
    if (!PAGE_PROVIDER.test(name)) {
      return throwError(() => new Error(`"${name}" is not the name of a page provider`));
    }
    if (
      !Number.isInteger(request.pageSize) ||
      request.pageSize < 1 ||
      request.pageSize > MAX_PAGE_SIZE
    ) {
      return throwError(
        () => new Error(`a page is 1 to ${MAX_PAGE_SIZE} records, not ${String(request.pageSize)}`),
      );
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
    const aggregates = Object.entries(request.aggregates ?? {}).filter(
      ([, keys]) => keys.length > 0,
    );
    const refused = aggregates.find(([aggregate]) => !isAggregateParameter(aggregate));
    if (refused) {
      return throwError(
        () =>
          new Error(
            `"${refused[0]}" cannot be sent as an aggregate: it is not a name of letters, digits and _, or the search reads it for itself`,
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
    for (const [aggregate, keys] of aggregates) {
      params = params.set(aggregate, JSON.stringify(keys));
    }
    return this.api.get<PageProviderResults>(
      `/nuxeo/api/v1/search/pp/${encodeURIComponent(name)}/execute`,
      params,
      { properties: request.properties ?? '*', 'enrichers.document': 'permissions' },
    );
  }
}
