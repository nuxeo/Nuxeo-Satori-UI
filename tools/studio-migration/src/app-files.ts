/**
 * The app definition a conversion writes under `app/`, and the names the converter and the
 * harness both give its files: the files of docs/business-apps/app-definition-v2.md, section 1.
 *
 * The harness finds a converted file by the name the package's own construct gives it, worked
 * out here from the inventory, never by asking the conversion's report where it put it.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import type { DashboardCard, SearchLayout } from './inventory';
import type { StudioPackage } from './studio-package';

/** A label as Web UI writes it: literal text, or `[[i18n('key')]]`, a translation key. */
const I18N = /^\s*\[\[\s*i18n\(\s*(['"])([^'"]+)\1\s*\)\s*\]\]\s*$/;

/** An app definition's ids (app-definition-v2.md, section 2). */
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The layout modes the app has, and the version each is written in. */
export const LAYOUT_VERSION: Readonly<Record<string, 1 | 2>> = {
  view: 2,
  metadata: 1,
  edit: 1,
  create: 1,
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

/** `{ label }` for literal text, `{ labelKey }` for an `i18n` key, nothing for none. */
export function labelOf(
  text: string | null,
): { readonly label: string } | { readonly labelKey: string } | Record<string, never> {
  if (text === null) return {};
  const key = I18N.exec(text)?.[2];
  if (key !== undefined) return { labelKey: key };
  const label = text.replace(/\s+/g, ' ').trim();
  return label === '' ? {} : { label };
}

/** A name made of an id's characters: what is not one becomes `-`, and it starts with a letter. */
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

/** The id an action converted from a slot contribution takes: `<app id>.<contribution name>`. */
export function actionIdOf(appId: string, contribution: string): string {
  return `${appId}.${contribution.replace(/[^A-Za-z0-9._-]+/g, '-')}`.slice(0, 64);
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
