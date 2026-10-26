import { InjectionToken, inject } from '@angular/core';

/** Directory name, relative to the application bundle's parent, the configuration is served from. */
export const APP_CONFIG_DIRECTORY = 'agentic-ui-config';

export const APP_BOOTSTRAP_CONFIG_FILE = 'bootstrap.json';

export const APP_MANIFEST_CONFIG_FILE = 'manifest.json';

/**
 * Resolve the bootstrap configuration URL as a **sibling** of the application bundle rather than
 * a file inside it.
 *
 * Production base href is `/nuxeo/agentic-ui/`, giving `/nuxeo/agentic-ui-config/bootstrap.json`,
 * which the configuration servlet in `nuxeo-agentic-core` answers with the bootstrap fragments
 * every installed package contributed. Nothing on the server's disk is served at that path.
 *
 * Under `nx serve` the base href is `/`, where `../` clamps to the root and gives
 * `/agentic-ui-config/bootstrap.json`, served from the gitignored
 * `apps/nuxeo-ui/public/agentic-ui-config/` when a developer puts a response there.
 *
 * @param baseUri normally `document.baseURI`
 */
export function resolveBootstrapConfigUrl(baseUri: string): string {
  const url = new URL(`../${APP_CONFIG_DIRECTORY}/${APP_BOOTSTRAP_CONFIG_FILE}`, baseUri);
  return `${url.pathname}${url.search}`;
}

/** The manifest response, served beside the bootstrap one. */
export function resolveManifestConfigUrl(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}${APP_MANIFEST_CONFIG_FILE}`;
}

/**
 * Where the bootstrap configuration is fetched from. Overridable so tests and
 * alternative deployment layouts do not have to fake `document.baseURI`.
 */
export const APP_BOOTSTRAP_CONFIG_URL = new InjectionToken<string>('APP_BOOTSTRAP_CONFIG_URL', {
  providedIn: 'root',
  factory: () => resolveBootstrapConfigUrl(document.baseURI),
});

/** Where the manifest is fetched from: beside the bootstrap response unless overridden. */
export const APP_MANIFEST_CONFIG_URL = new InjectionToken<string>('APP_MANIFEST_CONFIG_URL', {
  providedIn: 'root',
  factory: () => resolveManifestConfigUrl(inject(APP_BOOTSTRAP_CONFIG_URL)),
});
