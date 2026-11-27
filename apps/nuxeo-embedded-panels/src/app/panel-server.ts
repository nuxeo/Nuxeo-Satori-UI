import { InjectionToken } from '@angular/core';

/**
 * Where the panel's files are served, below the Nuxeo server's context: the only address its
 * script is loaded from, `<server>/nuxeo/agentic-ui/embedded/v1/`.
 */
export const PANEL_PATH = '/nuxeo/agentic-ui/embedded/';

/** The Nuxeo server a panel talks to: the one its script was loaded from, and no other. */
export interface PanelServer {
  /** The server's origin, as `NUXEO_API_ORIGIN` takes it: `https://nuxeo.example.com`. */
  readonly origin: string;
  /** The folder the script was loaded from, ending in `/`: its translations and icons are beside it. */
  readonly base: string;
}

export const PANEL_SERVER = new InjectionToken<PanelServer>('PANEL_SERVER');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The server the panel's script was loaded from, by the script's own address (`import.meta.url`),
 * or `null` when that address is not one a panel is served at: below {@link PANEL_PATH}, over https,
 * or plain http on the loopback interface only, so that a token is never sent in the clear to
 * another machine. A host page names the record and the host; it never names the server, so it
 * cannot have the panel send the user's token anywhere else.
 */
export function panelServerOf(scriptUrl: string): PanelServer | null {
  let url: URL;
  try {
    url = new URL(scriptUrl);
  } catch {
    return null;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (
    !secure ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(PANEL_PATH)
  ) {
    return null;
  }
  const folder = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  return { origin: url.origin, base: `${url.origin}${folder}` };
}
