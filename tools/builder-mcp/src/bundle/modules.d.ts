/**
 * The modules the bundled runner imports that TypeScript cannot see: EJS, which Nx's
 * `generateFiles` renders with and which ships no types; Nx's list of binary extensions, which
 * `bundle.mjs` resolves by its path; and the table of generators `bundle.mjs` writes.
 */
declare module 'ejs' {
  export function render(
    template: string,
    data: Record<string, unknown>,
    options: { readonly filename: string },
  ): string;
}

declare module 'satori:binary-extensions' {
  /** Nx's own `isBinaryPath`, from @nx/devkit, which `bundle.mjs` bundles alone of @nx/devkit. */
  export function isBinaryPath(path: string): boolean;
}

declare module 'satori:generators' {
  /** Each app generator's default export, by its name. */
  export const GENERATORS: Readonly<Record<string, (tree: unknown, options: unknown) => unknown>>;
}
