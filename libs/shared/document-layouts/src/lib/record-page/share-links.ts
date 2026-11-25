import {
  SHARE_LINK_ORIGINAL,
  SHARE_LINK_REFUSAL_REASONS,
  shareLinkViewItem,
  shareLinkViewTitle,
  type NuxeoDocument,
  type ShareLinkItem,
} from '@nuxeo/satori-platform/nuxeo-client';

/**
 * What a picture's share links offer and how the page says it (layout-v2.md, section 2, "Share
 * links"). The server, `nuxeo-agentic-assets`, holds every rule: these only build what is asked
 * and word what is answered.
 */

/** How many days ahead of today, in UTC, a link may end at the latest: the server's bound. */
export const SHARE_LINK_MAX_DAYS = 90;

/** How many days ahead of today a new link ends unless the user chooses another day. */
export const SHARE_LINK_DEFAULT_DAYS = 7;

/** How many items one link may list: the server's bound. */
export const SHARE_LINK_MAX_ITEMS = 10;

/** One item the page offers to share: its id for the server, and what the page calls it. */
export interface ShareableItem {
  readonly item: ShareLinkItem;
  /** A view's own title; `null` for the original, which the page names in the reader's language. */
  readonly title: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What the record offers to share: its original file, when it has one in `file:content`, then each
 * picture view that has a file and a title of its own, in the order Nuxeo lists them, each title
 * once. A view with no title is not offered: the server names a view by its title, and the
 * `View 3` the picture's views show for one is not one it has. Offering an item is not deciding
 * it: the server refuses what the asset's rights do not allow.
 */
export function shareableItems(document: NuxeoDocument): ShareableItem[] {
  const items: ShareableItem[] = isRecord(document.properties?.['file:content'])
    ? [{ item: SHARE_LINK_ORIGINAL, title: null }]
    : [];
  const views = document.properties?.['picture:views'];
  if (!Array.isArray(views)) return items;
  const seen = new Set<string>();
  for (const view of views) {
    if (!isRecord(view) || !isRecord(view['content'])) continue;
    const title = view['title'];
    if (typeof title !== 'string' || title.trim() === '' || seen.has(title)) continue;
    seen.add(title);
    items.push({ item: shareLinkViewItem(title), title });
  }
  return items;
}

/** A day as the server reads one, `YYYY-MM-DD`, from its parts. */
function day(year: number, month: number, date: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** Today's day in UTC, `days` days on, as the server counts a link's end. */
export function utcDay(today: Date, days = 0): string {
  const at = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days),
  );
  return day(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/**
 * A `YYYY-MM-DD` day as the date field holds one: that day at local midnight, so that the field
 * shows the same day whatever the reader's zone.
 */
export function fieldDate(value: string): Date {
  const [year, month, date] = value.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/** The day a date field holds, `YYYY-MM-DD`, from its local parts; `null` for none. */
export function fieldDay(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return day(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

/** Whether `end` is a day the server takes: today, in UTC, to {@link SHARE_LINK_MAX_DAYS} on. */
export function endInRange(end: string | null, today: Date): end is string {
  return end !== null && end >= utcDay(today) && end <= utcDay(today, SHARE_LINK_MAX_DAYS);
}

/** The translation key of the server's reason for refusing an item: a generic one for a code this build does not know. */
export function refusalKey(reason: string): string {
  return (SHARE_LINK_REFUSAL_REASONS as readonly string[]).includes(reason)
    ? `document-layouts.share-links.refused.${reason}`
    : 'document-layouts.share-links.refused.other';
}

/**
 * What the page calls an item a link lists: a view's title, as written, or `null` for the
 * original, which the page names in the reader's language. An item of a form this build does not
 * know is shown as the server wrote it.
 */
export function itemTitle(item: ShareLinkItem): string | null {
  if (item === SHARE_LINK_ORIGINAL) return null;
  return shareLinkViewTitle(item) ?? item;
}
