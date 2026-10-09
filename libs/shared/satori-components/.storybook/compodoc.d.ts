/**
 * Compodoc's output, written by the `compodocArgs` in `project.json` before every Storybook run and
 * gitignored. A checkout where Storybook has never run has none, so `typecheck` reads the import as
 * this instead.
 */
declare module '*/documentation.json' {
  const documentation: {
    readonly components: readonly {
      readonly name: string;
      readonly inputsClass?: readonly { readonly name: string; readonly required?: boolean }[];
    }[];
  };
  export default documentation;
}
