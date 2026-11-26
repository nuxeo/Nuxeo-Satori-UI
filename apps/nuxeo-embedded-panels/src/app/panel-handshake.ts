/**
 * The handshake between a panel and the page that shows it, through `postMessage`
 * (docs/business-apps/embedded-panels.md, "The handshake"). The token never travels in an
 * attribute, a URL or storage: the page answers the panel's `ready` with a `token` message, and the
 * panel takes it only from a window and an origin the server's configuration names for the host.
 */

/** The panel's message: it is ready for a token, or its token has expired and it needs another. */
export const READY = 'nuxeo-record-panel:ready';

/** The page's answer: the token for this panel. */
export const TOKEN = 'nuxeo-record-panel:token';

/** What the panel sends when the server refused its token as expired: a fresh one is wanted. */
export const EXPIRED = 'nuxeo-record-panel:token-expired';

/** A host's id, as the server registers one. */
export const HOST_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** Longer than any token the server issues, short enough that a large message is never kept. */
export const MAX_TOKEN_LENGTH = 4096;

/** Three base64url segments: the shape of the JSON Web Token the server issues. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** What the panel posts to its page. */
export interface PanelMessage {
  readonly type: typeof READY | typeof EXPIRED;
  /** This panel's own id, random, so that a page with several panels answers each. */
  readonly panel: string;
  readonly host: string;
  readonly recordId: string;
}

/** A message as the panel receives it: what `MessageEvent` carries that it reads. */
export interface ReceivedMessage {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

/** What a token message must come from, and be for. */
export interface Expected {
  readonly panel: string;
  /** The host's origins, as the server's configuration names them. */
  readonly origins: ReadonlySet<string>;
  /** The windows a token may come from: the page's own, and its parent when it is framed. */
  readonly sources: readonly unknown[];
}

export function isJwtShaped(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH && JWT_SHAPE.test(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The token a message gives this panel, or `null` for any message that is not one: from another
 * origin than the host's, from a window other than the page or its parent, such as an iframe the
 * page shows, for another panel, or not a token. Nothing of a refused message is kept.
 */
export function tokenFromMessage(message: ReceivedMessage, expected: Expected): string | null {
  if (!expected.origins.has(message.origin)) return null;
  if (!expected.sources.includes(message.source)) return null;
  const data = message.data;
  if (!isRecord(data) || data['type'] !== TOKEN || data['panel'] !== expected.panel) return null;
  return isJwtShaped(data['token']) ? data['token'] : null;
}

/**
 * Where the panel's messages go: its page, at its own origin; and its parent, at each of the host's
 * origins, when the page is framed, so that only a parent on one of them receives it.
 */
export function messageTargets(
  view: Window,
  origins: ReadonlySet<string>,
): readonly { readonly target: Window; readonly origin: string }[] {
  const targets = [{ target: view, origin: view.location.origin }];
  if (view.parent && view.parent !== view) {
    for (const origin of origins) targets.push({ target: view.parent, origin });
  }
  return targets;
}

/** A host's origins as the server answers them, or `null` for an answer that is not one. */
export function originsOf(body: unknown, host: string): ReadonlySet<string> | null {
  if (!isRecord(body) || body['host'] !== host || !Array.isArray(body['origins'])) return null;
  const origins = body['origins'].filter(
    (origin): origin is string => typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin),
  );
  return origins.length > 0 ? new Set(origins) : null;
}
