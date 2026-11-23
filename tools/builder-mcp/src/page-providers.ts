/**
 * Page providers: the server's named searches, which a queue or a related-records card names
 * (docs/business-apps/app-definition-v2.md, section 4; layout-v2.md, section 7).
 *
 * - **Their names** come from the management API, `GET /management/page-providers`, which lists
 *   every page provider the server has registered. Nuxeo serves it only to an administrator, and
 *   a deployment may close it, so a refusal is reported as it is, with what to do instead.
 * - **One definition** comes from `GET /search/pp/<name>`. A page provider is written one of two
 *   ways, and both are read:
 *   - a `pattern`, an NXQL query whose `?` are filled in order;
 *   - a `whereClause`: a `fixedPart`, which may hold `?` too, and predicates, each binding a
 *     property to fields of a search document.
 *
 *   A queue's or a card's `parameters` are positional, so the count of `?` outside quoted strings
 *   is worked out and given. The predicates are listed with the property each one filters.
 */
import { NuxeoError, segment, type NuxeoReads } from './nuxeo.ts';
import { isRecord, list, notFound, record, text, texts, type JsonRecord } from './shapes.ts';

/** The class Nuxeo uses for a page provider answered from the search index. */
const INDEXED = 'org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider';

export async function listPageProviders(nuxeo: NuxeoReads, query: string | undefined) {
  let answer: unknown;
  try {
    answer = await nuxeo.get('/management/page-providers');
  } catch (error) {
    if (
      error instanceof NuxeoError &&
      error.status !== null &&
      [401, 403, 404].includes(error.status)
    )
      throw new NuxeoError(
        `${error.message}. The list of page providers comes from Nuxeo's management API, which` +
          ' this server or this user may not be allowed to read. describe_page_provider still' +
          ' reads one definition by its name.',
        error.status,
      );
    throw error;
  }
  const wanted = query?.toLowerCase();
  const all = list(answer, '/management/page-providers')
    .filter(isRecord)
    .map((entry) => {
      const kind = text(entry['class']);
      return {
        name: text(entry['name']) ?? '',
        class: kind,
        indexed: kind === INDEXED,
        maxPageSize: typeof entry['maxPageSize'] === 'number' ? entry['maxPageSize'] : null,
      };
    })
    .filter((entry) => entry.name !== '')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = wanted ? all.filter((entry) => entry.name.toLowerCase().includes(wanted)) : all;
  return {
    total: all.length,
    matched: shown.length,
    pageProviders: shown,
    note:
      'indexed: true means the search index answers it, and the index lags: a list that must show' +
      ' a write just made should not use one (AGENTS/11-beta-program.md, section 3).',
  };
}

export async function describePageProvider(nuxeo: NuxeoReads, name: string) {
  let answer: unknown;
  try {
    answer = await nuxeo.get(`/search/pp/${segment(name)}`);
  } catch (error) {
    if (!(error instanceof NuxeoError) || error.status !== 404) throw error;
    answer = null;
  }
  // Nuxeo 2025 answers a name it does not have `200` with the body `null`, not `404`.
  if (answer === null) {
    let names: string[] = [];
    try {
      names = (await listPageProviders(nuxeo, undefined)).pageProviders.map((entry) => entry.name);
    } catch {
      // The suggestions are a help; without the management API there are none.
    }
    throw notFound('page provider', name, names);
  }
  return describeDefinition(record(answer, `/search/pp/${name}`));
}

/** A page provider's definition, as a builder needs it: what fills it, what it sorts and counts. */
export function describeDefinition(definition: JsonRecord) {
  const pattern = text(definition['pattern']);
  const where = isRecord(definition['whereClause']) ? definition['whereClause'] : null;
  const fixedPart = where ? text(where['fixedPart']) : null;
  const predicates =
    where && Array.isArray(where['predicates']) ? where['predicates'].filter(isRecord) : [];
  const positional = countParameters(pattern ?? '') + countParameters(fixedPart ?? '');
  return {
    name: text(definition['name']),
    enabled: definition['enabled'] !== false,
    query:
      pattern !== null
        ? { pattern }
        : {
            fixedPart,
            ...(where && text(where['selectStatement'])
              ? { select: text(where['selectStatement']) }
              : {}),
          },
    parameters: {
      positional,
      ...(predicates.length
        ? {
            searchDocumentType: text(definition['searchDocumentType']),
            predicates: predicates.map((predicate) => ({
              property: text(predicate['parameter']),
              operator: text(predicate['operator']),
              from: (Array.isArray(predicate['values']) ? predicate['values'] : [])
                .filter(isRecord)
                .map(
                  (value) =>
                    text(value['xpath']) ??
                    [text(value['schema']), text(value['name'])].filter(Boolean).join(':'),
                ),
            })),
          }
        : {}),
      ...(Array.isArray(definition['queryParameters']) && definition['queryParameters'].length
        ? { defaults: definition['queryParameters'] }
        : {}),
      note:
        "A queue's or a related-records card's parameters fill the ? of the " +
        (pattern !== null ? 'pattern' : 'fixed part') +
        ' in order; a ? inside quotes is not one.' +
        (predicates.length
          ? ' The predicates are filled from a search document, not from those parameters.'
          : ''),
    },
    pageSize: typeof definition['pageSize'] === 'number' ? definition['pageSize'] : null,
    maxPageSize: typeof definition['maxPageSize'] === 'number' ? definition['maxPageSize'] : null,
    pageSizeOptions: Array.isArray(definition['pageSizeOptions'])
      ? definition['pageSizeOptions']
      : [],
    sortable: definition['sortable'] !== false,
    sort: sortsOf(definition['sortInfos']),
    aggregates: (Array.isArray(definition['aggregates']) ? definition['aggregates'] : [])
      .filter(isRecord)
      .map((aggregate) => ({
        id: text(aggregate['id']),
        type: text(aggregate['type']),
        field: text(aggregate['documentField']),
        ...(isRecord(aggregate['properties']) && Object.keys(aggregate['properties']).length
          ? { properties: aggregate['properties'] }
          : {}),
        ...(keysOf(aggregate['ranges']).length ? { ranges: keysOf(aggregate['ranges']) } : {}),
        ...(keysOf(aggregate['dateRanges']).length
          ? { dateRanges: keysOf(aggregate['dateRanges']) }
          : {}),
      })),
    quickFilters: (Array.isArray(definition['quickFilters']) ? definition['quickFilters'] : [])
      .filter(isRecord)
      .map((filter) => ({
        name: text(filter['name']),
        clause: text(filter['clause']),
        sort: sortsOf(filter['sortInfos']),
      })),
  };
}

function sortsOf(value: unknown) {
  return (Array.isArray(value) ? value : []).filter(isRecord).map((sort) => ({
    field: text(sort['sortColumn']),
    order: sort['sortAscending'] === false ? 'desc' : 'asc',
  }));
}

function keysOf(value: unknown): string[] {
  return texts((Array.isArray(value) ? value : []).filter(isRecord).map((range) => range['key']));
}

/** The `?` of an NXQL fragment outside quoted strings, which Nuxeo replaces in order. */
export function countParameters(nxql: string): number {
  let count = 0;
  let quote: string | null = null;
  for (let index = 0; index < nxql.length; index++) {
    const character = nxql[index];
    if (quote !== null) {
      if (character === '\\') index++;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === '?') count++;
  }
  return count;
}
