import { Injectable, inject } from '@angular/core';
import { type Observable, map } from 'rxjs';

import { NuxeoApiBase } from './nuxeo-api-base';

/**
 * The Automation operations of `nuxeo-agentic-assets` for an asset's share links
 * (nuxeo-agentic-assets/README.md, "Share links"). Each one takes the asset as its input, and the
 * server holds every rule: who may manage the links (`WriteSecurity` on the asset), what a link
 * lists, until when, and what it serves.
 */
export const SHARE_LINK_OPERATIONS = {
  create: 'ShareLink.Create',
  list: 'ShareLink.List',
  revoke: 'ShareLink.Revoke',
  downloads: 'ShareLink.Downloads',
} as const;

/** What a link is now: open, past its end day, or revoked. */
export type ShareLinkState = 'active' | 'expired' | 'revoked';

const STATES: readonly ShareLinkState[] = ['active', 'expired', 'revoked'];

/**
 * Why the server refused to create a link for one item, with the rights codes of the
 * `assetRights` enricher, and `no-such-rendition` for an item the asset does not have.
 */
export const SHARE_LINK_REFUSAL_REASONS = [
  'not-cleared',
  'rights-ended',
  'channel-not-covered',
  'policy-error',
  'no-such-rendition',
] as const;

export type ShareLinkRefusalReason = (typeof SHARE_LINK_REFUSAL_REASONS)[number];

/**
 * An item a link lists: `original`, the asset's original file, or `view:<title>`, one of its
 * picture views by its exact title.
 */
export type ShareLinkItem = string;

/** The item for the asset's original file. */
export const SHARE_LINK_ORIGINAL: ShareLinkItem = 'original';

/** The item for a picture view, by its exact `picture:views/<n>/title`. */
export function shareLinkViewItem(title: string): ShareLinkItem {
  return `view:${title}`;
}

/** The title an item names, for a view; `null` for the original or anything else. */
export function shareLinkViewTitle(item: ShareLinkItem): string | null {
  return item.startsWith('view:') && item.length > 'view:'.length
    ? item.slice('view:'.length)
    : null;
}

/**
 * A share link as the server lists it. Its `id` is the SHA-256 of its token, never the token: the
 * server keeps no token, and gives it once, to whoever created the link.
 */
export interface ShareLink {
  readonly id: string;
  readonly document: string;
  readonly renditions: readonly ShareLinkItem[];
  /** The link's last day, `YYYY-MM-DD`, in UTC. */
  readonly end: string;
  /** When it was created: an ISO instant. */
  readonly created: string;
  readonly createdBy: string;
  /** When it was revoked, or `null`. */
  readonly revoked: string | null;
  readonly revokedBy: string | null;
  readonly state: ShareLinkState;
}

/** One item served through a link. */
export interface ShareLinkDownload {
  /** An ISO instant. */
  readonly time: string;
  /** The link's id. */
  readonly link: string;
  readonly rendition: ShareLinkItem;
}

export interface ShareLinkDownloads {
  /** Newest first. */
  readonly downloads: readonly ShareLinkDownload[];
  /** Whether the server holds more than it sent: it sends 200 at most. */
  readonly truncated: boolean;
}

/** One item the server would not create a link for, and why. No link was created. */
export interface ShareLinkRefusal {
  readonly rendition: ShareLinkItem;
  /** One of {@link SHARE_LINK_REFUSAL_REASONS}, or a code this build does not know. */
  readonly reason: string;
}

/**
 * What `ShareLink.Create` answered: the link, with its token and the path it opens at, given this
 * once and nowhere else; or the items it refused, and no link.
 */
export type CreatedShareLink =
  | {
      readonly kind: 'created';
      readonly link: ShareLink;
      /** The link's secret. Shown once, never stored, logged or sent anywhere by the client. */
      readonly token: string;
      /** Where the link opens, on this server: a path, such as `/nuxeo/agentic-share/<token>/`. */
      readonly path: string;
    }
  | { readonly kind: 'refused'; readonly refused: readonly ShareLinkRefusal[] };

/** A link's id: the SHA-256 of its token, in lowercase hexadecimal. */
export const SHARE_LINK_ID = /^[0-9a-f]{64}$/;

/** A token as the server makes one: URL-safe Base64, with no padding. */
const TOKEN = /^[A-Za-z0-9_-]{22,128}$/;

/** A day, as the server writes a link's end. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** An answer that is not of the operation's shape: a failed call, status 500, never a guess. */
function malformed(operation: string): Error {
  return Object.assign(new Error(`${operation} gave an answer that is not of its shape`), {
    status: 500,
  });
}

/** A link, held to its shape; `null` for anything else. */
export function shareLinkOf(value: unknown): ShareLink | null {
  if (!isRecord(value)) return null;
  const { id, document, renditions, end, created, createdBy, revoked, revokedBy, state } = value;
  if (
    typeof id !== 'string' ||
    !SHARE_LINK_ID.test(id) ||
    !isText(document) ||
    !Array.isArray(renditions) ||
    !renditions.every(isText) ||
    typeof end !== 'string' ||
    !DAY.test(end) ||
    !isText(created) ||
    typeof createdBy !== 'string' ||
    !(revoked === null || isText(revoked)) ||
    !(revokedBy === null || typeof revokedBy === 'string') ||
    !STATES.includes(state as ShareLinkState)
  )
    return null;
  return {
    id,
    document,
    renditions: [...renditions],
    end,
    created,
    createdBy,
    revoked,
    revokedBy,
    state: state as ShareLinkState,
  };
}

/** `ShareLink.List`'s answer: its links, each held to its shape. */
export function shareLinkListOf(body: unknown): ShareLink[] {
  if (!isRecord(body) || !Array.isArray(body['links'])) throw malformed(SHARE_LINK_OPERATIONS.list);
  return body['links'].map((each) => {
    const link = shareLinkOf(each);
    if (!link) throw malformed(SHARE_LINK_OPERATIONS.list);
    return link;
  });
}

/**
 * Whether `path` is a path on this server: one `/` then not another, so neither an address of
 * another server (`//host/…`, `https://…`) nor anything a browser would read as one (a backslash).
 */
function isServerPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !/[\\\s]/.test(path);
}

/** `ShareLink.Create`'s answer, held to one of its two shapes. */
export function createdShareLinkOf(body: unknown): CreatedShareLink {
  if (!isRecord(body)) throw malformed(SHARE_LINK_OPERATIONS.create);
  if ('refused' in body) {
    const refused = body['refused'];
    if (!Array.isArray(refused) || refused.length === 0 || 'link' in body || 'token' in body)
      throw malformed(SHARE_LINK_OPERATIONS.create);
    return {
      kind: 'refused',
      refused: refused.map((each) => {
        if (!isRecord(each) || !isText(each['rendition']) || !isText(each['reason']))
          throw malformed(SHARE_LINK_OPERATIONS.create);
        return { rendition: each['rendition'], reason: each['reason'] };
      }),
    };
  }
  const link = shareLinkOf(body['link']);
  const { token, path } = body;
  if (
    !link ||
    typeof token !== 'string' ||
    !TOKEN.test(token) ||
    typeof path !== 'string' ||
    !isServerPath(path) ||
    // The path is the link's own: the token it was given with is in it.
    !path.includes(`/${token}`)
  )
    throw malformed(SHARE_LINK_OPERATIONS.create);
  return { kind: 'created', link, token, path };
}

/** `ShareLink.Downloads`' answer, held to its shape. */
export function shareLinkDownloadsOf(body: unknown): ShareLinkDownloads {
  if (
    !isRecord(body) ||
    !Array.isArray(body['downloads']) ||
    typeof body['truncated'] !== 'boolean'
  )
    throw malformed(SHARE_LINK_OPERATIONS.downloads);
  return {
    truncated: body['truncated'],
    downloads: body['downloads'].map((each) => {
      if (
        !isRecord(each) ||
        !isText(each['time']) ||
        typeof each['link'] !== 'string' ||
        !SHARE_LINK_ID.test(each['link']) ||
        !isText(each['rendition'])
      )
        throw malformed(SHARE_LINK_OPERATIONS.downloads);
      return { time: each['time'], link: each['link'], rendition: each['rendition'] };
    }),
  };
}

/**
 * The address a created link opens at: this page's origin and the server's path. Never another
 * origin: `null` for a path that is not one on this server (`isServerPath`), which is what keeps a
 * path from naming another host; `null` too for an origin that is not an address.
 */
export function shareLinkUrl(path: string, origin: string): string | null {
  if (!isServerPath(path)) return null;
  try {
    return new URL(path, origin).href;
  } catch {
    return null;
  }
}

/** A link's short name, as the page and the server's watermark print it: its id's first 8. */
export function shareLinkLabel(id: string): string {
  return id.slice(0, 8);
}

/**
 * An asset's share links, through `nuxeo-agentic-assets`' operations. The client checks nothing
 * the server decides: a call the user may not make answers 403, and the caller says so or shows
 * nothing. Offering a control, or not, is not the security control.
 */
@Injectable({ providedIn: 'root' })
export class ShareLinkService {
  private readonly api = inject(NuxeoApiBase);

  /** The asset's links, newest first. 403 when the user may not manage them. */
  list(uid: string): Observable<ShareLink[]> {
    return this.call(SHARE_LINK_OPERATIONS.list, uid, {}).pipe(map(shareLinkListOf));
  }

  /**
   * A new link for these items, until `end`, a `YYYY-MM-DD` day in UTC, its last. The answer's
   * token is given this once: show it, and keep it nowhere.
   */
  create(uid: string, items: readonly ShareLinkItem[], end: string): Observable<CreatedShareLink> {
    return this.call(SHARE_LINK_OPERATIONS.create, uid, { renditions: [...items], end }).pipe(
      map(createdShareLinkOf),
    );
  }

  /** Revokes one of the asset's links, at once. The answer is the link, revoked. */
  revoke(uid: string, link: string): Observable<ShareLink> {
    return this.call(SHARE_LINK_OPERATIONS.revoke, uid, { link }).pipe(
      map((body) => {
        const revoked = isRecord(body) ? shareLinkOf(body['link']) : null;
        if (!revoked) throw malformed(SHARE_LINK_OPERATIONS.revoke);
        return revoked;
      }),
    );
  }

  /** What the asset's links served, newest first. */
  downloads(uid: string): Observable<ShareLinkDownloads> {
    return this.call(SHARE_LINK_OPERATIONS.downloads, uid, {}).pipe(map(shareLinkDownloadsOf));
  }

  private call(
    operation: string,
    uid: string,
    params: Record<string, unknown>,
  ): Observable<unknown> {
    return this.api.post<unknown>(`/nuxeo/api/v1/automation/${operation}`, {
      params,
      context: {},
      input: `doc:${uid}`,
    });
  }
}
