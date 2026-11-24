/**
 * Per-type layouts: what a configuration package contributes, and what the panel renders.
 *
 * A layout is chosen per document type and mode, as in Nuxeo Web UI. A package contributes one
 * through `org.nuxeo.agentic.ui.config` (`<layout type="Claim" mode="metadata" src="…"/>`); with
 * none, the layout is generated from the type's own schemas and those the document's dynamic
 * facets add. A contributed layout replaces the generated one whole — nothing is merged.
 */

/**
 * The modes a version 1 file is rendered in: `metadata` read-only in the Properties panel, `edit`
 * and `create` as forms. An `edit` or `create` file may be version 2 too, read in `form-layout/`;
 * a `metadata` one may not. `view` is layout version 2 only, the record page, and has its own
 * reader in `record-page/`; a `documentView` entry still takes the View tab before it.
 */
export type LayoutMode = 'metadata' | 'edit' | 'create';

export type LayoutDisplay = 'sections' | 'tabs';

/**
 * What a schema allows a value to be, from the constraints Nuxeo reports on the field:
 * `PatternConstraint`, `LengthConstraint` and `NumericIntervalConstraint`. A bound is inclusive
 * unless its `…Inclusive` flag says otherwise.
 */
export interface LayoutFieldConstraints {
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minimumInclusive?: boolean;
  readonly maximumInclusive?: boolean;
}

/**
 * A field's type as `/config/types/<type>` and `/config/schemas/<name>` describe it when asked
 * for `fetch-schema: fields`.
 */
export interface LayoutFieldType {
  /** `string`, `date`, `long`, `double`, `boolean`, `blob` or `complex`, each possibly ending in `[]`. */
  readonly type: string;
  /** The vocabulary a `directoryResolver` binds the value — or each item of a list — to. */
  readonly directory?: string;
  /**
   * The value, or each item of a list, names a document by its id: a `documentResolver` that
   * stores one, `store` `id` or `idOnly` as Nuxeo reports it. One that stores a path does not set
   * it. The Properties panel shows such a value as the linked record's title.
   */
  readonly documentReference?: true;
  /** A complex field's sub-fields, by their bare names. */
  readonly fields?: Readonly<Record<string, LayoutFieldType>>;
  /** The schema declares it not nullable (`NotNullConstraint`), or a layout file marks it required. */
  readonly required?: boolean;
  readonly constraints?: LayoutFieldConstraints;
}

export interface DocumentTypeSchema {
  readonly name: string;
  /** The property prefix; the schema name when Nuxeo reports none, as it does for `file`. */
  readonly prefix: string;
  readonly fields: Readonly<Record<string, LayoutFieldType>>;
}

/** A schema a document reports carrying, as the `schemas` of its own read list it. */
export interface DocumentSchemaRef {
  readonly name: string;
  readonly prefix: string;
}

export interface DocumentTypeDefinition {
  readonly name: string;
  readonly schemas: readonly DocumentTypeSchema[];
}

/** A label a reader sees: a literal, else the first translation key that resolves, else `fallback`. */
export interface LayoutLabel {
  readonly literal?: string;
  readonly keys: readonly string[];
  readonly fallback: string | null;
}

export interface LayoutField {
  /** `<prefix>:<name>`, the property key on the document. */
  readonly xpath: string;
  readonly label: LayoutLabel;
  readonly definition: LayoutFieldType;
}

export interface LayoutSection {
  readonly id: string;
  readonly label: LayoutLabel;
  readonly fields: readonly LayoutField[];
}

export interface ResolvedLayout {
  readonly type: string;
  readonly mode: LayoutMode;
  readonly source: 'generated' | 'contributed';
  readonly display: LayoutDisplay;
  readonly sections: readonly LayoutSection[];
}
