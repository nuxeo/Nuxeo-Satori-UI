/**
 * The app definition a conversion writes under `app/`, and the names the converter and the
 * harness both give its files: the files of docs/business-apps/app-definition-v2.md, section 1.
 *
 * The harness finds a converted file by the name the package's own construct gives it, worked
 * out here from the inventory, never by asking the conversion's report where it put it.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import type { DashboardCard, SearchLayout, SlotContribution } from './inventory';
import type { StudioPackage } from './studio-package';

/** A label as Web UI writes it: literal text, or `[[i18n('key')]]`, a translation key. */
const I18N = /^\s*\[\[\s*i18n\(\s*(['"])([^'"]+)\1\s*\)\s*\]\]\s*$/;

/** True when a value is bound to the page, `[[…]]` or `{{…}}`, rather than written. */
export function isBound(text: string): boolean {
  return /\[\[|\{\{/.test(text);
}

/** The largest page a list may ask for (layout-v2.md, section 7). */
export const PAGE_SIZE_LIMIT = 100;

/** The page size a queue keeps from a dashboard card: one from 1 to 100, or none. */
export function queuePageSize(card: Pick<DashboardCard, 'pageSize'>): number | null {
  return card.pageSize !== null && card.pageSize >= 1 && card.pageSize <= PAGE_SIZE_LIMIT
    ? card.pageSize
    : null;
}

/** An app definition's ids (app-definition-v2.md, section 2). */
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The layout modes the app has, and the version each is written in: version 2 wherever the app
 * draws it, the record page and the Edit and Create forms, so that a field, a layout block or a
 * tab under a condition there carries its rule. The Properties panel reads version 1 alone: the
 * app refuses version 2 in `metadata` mode (layout-v2.md, sections 10 and 11).
 */
export const LAYOUT_VERSION: Readonly<Record<string, 1 | 2>> = {
  view: 2,
  metadata: 1,
  edit: 2,
  create: 2,
};

export function layoutPath(type: string, mode: string): string {
  return `layouts/${type}/${mode}.layout.json`;
}

export function queuePath(id: string): string {
  return `queues/${id}.json`;
}

export function labelsPath(locale: string): string {
  return `labels/${locale}.json`;
}

/**
 * `{ label }` for literal text, `{ labelKey }` for an `i18n` key, and nothing for none, or for a
 * label bound to the page any other way, whose text only Web UI can work out: writing the
 * binding as text would show it as it is written.
 */
export function labelOf(
  text: string | null,
): { readonly label: string } | { readonly labelKey: string } | Record<string, never> {
  if (text === null) return {};
  const key = I18N.exec(text)?.[2];
  if (key !== undefined) return { labelKey: key };
  if (isBound(text)) return {};
  const label = text.replace(/\s+/g, ' ').trim();
  return label === '' ? {} : { label };
}

/**
 * A label Web UI translates as a key, as `nuxeo-operation-button`, `nuxeo-menu-icon` and
 * `nuxeo-page-item` render `[[i18n(label)]]`: a key the package translates is a `labelKey`, and any
 * other is shown as written, as Web UI shows a key no catalogue holds.
 */
export function translatedLabelOf(
  text: string | null,
  translated: ReadonlySet<string>,
): ReturnType<typeof labelOf> {
  return text !== null && translated.has(text.trim()) ? { labelKey: text.trim() } : labelOf(text);
}

/** A name made of an id's characters: what is not one becomes `-`, and it starts with a letter or digit. */
export function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '');
  return (cleaned || 'x').slice(0, 64);
}

/** The app's id: the package's name, in lower case, as app.json's `id` must be. */
export function appIdOf(pkg: Pick<StudioPackage, 'descriptor'>): string {
  const id = pkg.descriptor.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '');
  return id || 'migrated';
}

/** The queue a search screen's results become: its folder's name, `ui/search/<name>/`. */
export function searchQueueId(search: Pick<SearchLayout, 'path'>): string {
  const folder = search.path.slice(0, search.path.lastIndexOf('/'));
  return slug(folder.slice(folder.lastIndexOf('/') + 1));
}

/** The queue a dashboard card's list becomes: `home-<n>-<provider>`, by the card's place. */
export function homeQueueId(card: Pick<DashboardCard, 'provider'>, index: number): string {
  return slug(`home-${index + 1}-${card.provider ?? 'list'}`);
}

/**
 * The id an action converted from a slot contribution takes: `<app id>.<contribution name>`, or
 * `<app id>.action-<n>` for one with no name, `<n>` its place among the package's contributions.
 */
export function actionIdOf(appId: string, contribution: string, index: number): string {
  const name = contribution || `action-${index}`;
  return `${appId}.${name.replace(/[^A-Za-z0-9._-]+/g, '-')}`.slice(0, 64);
}

/**
 * Each slot contribution with its place in its file, from 1, as its construct's id counts it, and
 * its place in the package, which names an action for one with no name: two files' first unnamed
 * buttons must not share an id.
 */
export function placed(contributions: readonly SlotContribution[]): {
  readonly contribution: SlotContribution;
  readonly index: number;
  readonly overall: number;
}[] {
  const byFile = new Map<string, number>();
  return contributions.map((contribution, position) => {
    const index = (byFile.get(contribution.path) ?? 0) + 1;
    byFile.set(contribution.path, index);
    return { contribution, index, overall: position + 1 };
  });
}

/**
 * A Material Symbols name for a Web UI icon: `icons:3d-rotation` is `3d_rotation`. Only Polymer's
 * `icons` set shares Material's names; another set's icon has none.
 */
export function iconOf(icon: string | undefined): string | null {
  const match = /^icons:([a-z0-9-]+)$/.exec(icon?.trim() ?? '');
  return match ? match[1].replace(/-/g, '_') : null;
}

/** The texts of a version 2 labels file, or an empty record when it is not one. */
export function labelTexts(file: unknown): Readonly<Record<string, string>> {
  if (!isRecord(file) || !isRecord(file['labels'])) return {};
  const texts: Record<string, string> = {};
  for (const [key, text] of Object.entries(file['labels']))
    if (typeof text === 'string')
      Object.defineProperty(texts, key, {
        value: text,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return texts;
}
