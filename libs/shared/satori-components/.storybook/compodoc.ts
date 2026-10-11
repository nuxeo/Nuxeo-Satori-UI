import documentation from '../documentation.json';

/** One input, output or interface property, as Compodoc reports it. */
export interface CompodocMember {
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string;
  /** `input.required()`, for an input. */
  readonly required?: boolean;
  /** A `?` property, for an interface. */
  readonly optional?: boolean;
  /** The member's JSDoc, as written. */
  readonly rawdescription?: string;
}

export interface CompodocComponent {
  readonly name: string;
  readonly selector?: string;
  readonly inputsClass?: readonly CompodocMember[];
  readonly outputsClass?: readonly CompodocMember[];
}

export interface CompodocInterface {
  readonly name: string;
  readonly rawdescription?: string;
  readonly properties?: readonly CompodocMember[];
}

/** The parts of Compodoc's `documentation.json` the Docs pages read. */
export interface CompodocJson {
  readonly components: readonly CompodocComponent[];
  readonly interfaces?: readonly CompodocInterface[];
}

/**
 * Compodoc's output for the library, written by the project's `compodoc` target, which
 * `typecheck`, `storybook` and `build-storybook` run first. TypeScript infers the JSON's type
 * from whatever Compodoc last wrote, so it is read through this one shape instead.
 */
export const compodoc = documentation as unknown as CompodocJson;
