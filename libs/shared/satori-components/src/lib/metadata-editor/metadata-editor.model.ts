/**
 * What a schema allows a value to be. Every bound is inclusive unless its `…Inclusive` flag is
 * `false`, as Nuxeo's `NumericIntervalConstraint` reports it.
 */
export interface NxsEditorConstraints {
  /** Matched against the whole value, as Nuxeo's `PatternConstraint` is. */
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minimumInclusive?: boolean;
  readonly maximumInclusive?: boolean;
}

/** A field's type, as Nuxeo's `/config/types` describes it with `fetch-schema: fields`. */
export interface NxsEditorFieldType {
  /** `string`, `long`, `integer`, `double`, `date`, `boolean`, `blob` or `complex`, each possibly ending in `[]`. */
  readonly type: string;
  /** The vocabulary the value, or each item of a list, is an entry of. */
  readonly directory?: string;
  /** A complex field's sub-fields, by their bare names. */
  readonly fields?: Readonly<Record<string, NxsEditorFieldType>>;
  readonly required?: boolean;
  readonly constraints?: NxsEditorConstraints;
}

/** One field of the form. */
export interface NxsEditorField {
  /** The property key on the document, `<prefix>:<name>`. */
  readonly xpath: string;
  /** What the field is called, already translated. */
  readonly label: string;
  readonly definition: NxsEditorFieldType;
  /** A text field taking several lines. Its value is kept as typed rather than trimmed. */
  readonly multiline?: boolean;
}

/** A group of fields under one heading, or one tab when the editor shows tabs. */
export interface NxsEditorSection {
  readonly id: string;
  /** Already translated. `null` renders the section with no heading. */
  readonly heading: string | null;
  readonly fields: readonly NxsEditorField[];
}

export type NxsEditorDisplay = 'sections' | 'tabs';

/** Property values by xpath, as a document's `properties` holds them. */
export type NxsEditorValues = Readonly<Record<string, unknown>>;
