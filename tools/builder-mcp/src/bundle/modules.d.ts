/**
 * The two modules the bundled runner imports that TypeScript cannot see: EJS, which Nx's
 * `generateFiles` renders with and which ships no types, and the table of generators `bundle.mjs`
 * writes when it bundles them.
 */
declare module 'ejs' {
  export function render(
    template: string,
    data: Record<string, unknown>,
    options: { readonly filename: string },
  ): string;
}

declare module 'satori:generators' {
  /** Each app generator's default export, by its name. */
  export const GENERATORS: Readonly<Record<string, (tree: unknown, options: unknown) => unknown>>;
}
