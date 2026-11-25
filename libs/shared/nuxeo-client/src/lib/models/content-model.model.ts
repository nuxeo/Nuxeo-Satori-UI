/**
 * Nuxeo's content model as its `/config/*` endpoints describe it.
 *
 * Three endpoints, because no single one is complete:
 *
 * - `/config/types` → `{ doctypes, schemas }`. Doctypes carry `parent`, `facets` and the
 *   schema names they use. Its `schemas` map is a **flat** shape and covers only the 48
 *   schemas reachable from a doctype.
 * - `/config/facets` → every facet, with the schemas each contributes. A doctype's `facets`
 *   are names only, so this is the only way to know what a facet adds.
 * - `/config/schemas` → all 98 schemas in a **nested** shape (`{ name, @prefix, fields }`),
 *   including the ones only a facet reaches. This is the superset and the one to use.
 *
 * Measured against the local instance: 60 doctypes, 65 facets, 98 schemas, versus 48 schemas
 * in `/config/types`. Reading schemas from `/config/types` would silently omit fifty of them.
 */

/**
 * A field's type, or a nested definition for a complex one.
 *
 * Nuxeo answers a primitive as a bare string — `'string'`, `'date'`, `'long'`, `'double'`,
 * `'boolean'`, `'blob'`, `'string[]'` — and a complex field as an object carrying its own
 * `fields`, which nest arbitrarily deep.
 */
export type NuxeoFieldType = string | NuxeoComplexField;

export interface NuxeoComplexField {
  /** `'complex'` or `'complex[]'`. */
  type?: string;
  fields?: Record<string, NuxeoFieldType>;
}

/** One entry of `/config/schemas`. */
export interface NuxeoSchemaDefinition {
  name: string;
  /**
   * The property prefix, e.g. `dc` for `dublincore`.
   *
   * **Often empty.** `file`, `uid` and others report `''`, and Nuxeo then addresses their
   * properties by schema *name* — `file:content`, `uid:major_version`. Treat an empty prefix
   * as the schema name rather than as "no prefix".
   */
  '@prefix'?: string;
  fields?: Record<string, NuxeoFieldType>;
}

/** One entry of `/config/types`' `doctypes` map. */
export interface NuxeoDoctypeDefinition {
  /** The doctype this one extends, e.g. `Document` for `File`. */
  parent?: string;
  /**
   * Facet names — Nuxeo's mixins — its ancestors' included. What each facet contributes comes
   * from `/config/facets`.
   */
  facets?: string[];
  /**
   * Every schema a document of this type carries: its own, its ancestors' and its declared
   * facets'. Measured on the local instance: every doctype lists every schema of its parent (108
   * of 108 pairs) and of each facet it declares (67 of 67). A dynamic facet, added to one
   * document, is not here — the document's own read lists it.
   */
  schemas?: string[];
}

/** One entry of `/config/facets`. A facet contributing no schema has no `schemas` key at all. */
export interface NuxeoFacetDefinition {
  name: string;
  schemas?: NuxeoSchemaDefinition[];
}

/** `/config/types`. Its `schemas` are the flat shape; prefer `/config/schemas`. */
export interface NuxeoTypesConfig {
  doctypes?: Record<string, NuxeoDoctypeDefinition>;
  schemas?: Record<string, Record<string, NuxeoFieldType>>;
}

/** The three `/config/*` reads, resolved together. */
export interface NuxeoContentModel {
  doctypes: Record<string, NuxeoDoctypeDefinition>;
  facets: NuxeoFacetDefinition[];
  schemas: NuxeoSchemaDefinition[];
}
