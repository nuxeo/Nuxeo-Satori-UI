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
  readonly methodsClass?: readonly CompodocMethod[];
}

export interface CompodocInterface {
  readonly name: string;
  readonly rawdescription?: string;
  readonly properties?: readonly CompodocMember[];
}

/** One public method of a service or component, as Compodoc reports it. */
export interface CompodocMethod {
  readonly name: string;
  readonly args?: readonly {
    readonly name: string;
    readonly type?: string;
    readonly optional?: boolean;
    readonly defaultValue?: string;
  }[];
  readonly returnType?: string;
  readonly rawdescription?: string;
}

export interface CompodocInjectable {
  readonly name: string;
  readonly rawdescription?: string;
  readonly methods?: readonly CompodocMethod[];
}

/** The parts of Compodoc's `documentation.json` the Docs pages read. */
export interface CompodocJson {
  readonly components: readonly CompodocComponent[];
  readonly interfaces?: readonly CompodocInterface[];
  readonly injectables?: readonly CompodocInjectable[];
}

/**
 * Compodoc's output for the library, written by the project's `compodoc` target, which
 * `typecheck`, `test`, `storybook` and `build-storybook` run first. TypeScript checks the JSON Compodoc
 * wrote against this shape, so a field the pages read that Compodoc writes differently fails
 * `typecheck` rather than rendering an empty column.
 */
export const compodoc: CompodocJson = documentation;
