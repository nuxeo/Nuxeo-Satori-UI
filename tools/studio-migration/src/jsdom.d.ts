/**
 * The part of jsdom this tool uses. jsdom is a dev dependency of the workspace but `@types/jsdom`
 * is not, and adding it would change the lockfile for two members; declaring them here keeps the
 * project strict instead of reading jsdom as `any`.
 */
declare module 'jsdom' {
  /** Receives what the page would log. One that is forwarded nowhere prints nothing. */
  export class VirtualConsole {
    forwardTo(console: Console): this;
  }

  export interface ConstructorOptions {
    readonly contentType?: string;
    readonly virtualConsole?: VirtualConsole;
    /**
     * `outside-only` lets the caller run its own script with `window.eval`, and still runs none the
     * markup holds: lab mode's spec runs the script it sends the page, never a package's.
     */
    readonly runScripts?: 'outside-only';
  }

  export class JSDOM {
    constructor(markup?: string, options?: ConstructorOptions);
    /** With `runScripts: 'outside-only'`, it has `eval`, which runs a script in the page. */
    readonly window: Window & { eval(script: string): unknown };
  }
}
