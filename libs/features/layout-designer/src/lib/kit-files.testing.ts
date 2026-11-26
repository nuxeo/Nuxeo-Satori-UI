/**
 * Test support, not part of the library: every hand-written file of every kit that the designer
 * opens, read from `business-apps/packages` as the repository holds it. A kit is a folder there
 * with an app definition, `bundle/agentic-ui-config/app.json`, so that a kit added later is walked
 * too; the designer's files in it are each type's record page, edit form and create form,
 * `layouts/<Type>/<view|edit|create>.layout.json`, and its queues, `queues/<id>.json`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DESIGNED_MODES, type DesignedMode } from './layout-designer.service';

/** The repository's root. */
export const REPOSITORY = join(import.meta.dirname, '..', '..', '..', '..', '..');

const PACKAGES = 'business-apps/packages';
const CONFIG = 'bundle/agentic-ui-config';

export interface KitFile {
  readonly kit: string;
  /** Where the file is, from the repository's root, with `/` between folders. */
  readonly path: string;
  /** The file's bytes, as text. */
  readonly text: string;
  /** What the designer opens it as: a type's file in a mode, or a queue by its id. */
  readonly opens:
    | { readonly kind: 'layout'; readonly type: string; readonly mode: DesignedMode }
    | { readonly kind: 'queue'; readonly id: string };
}

const folders = (path: string): string[] =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

const filesIn = (path: string): string[] =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    : [];

/** Every kit, by its folder's name. */
export function kits(): string[] {
  return folders(join(REPOSITORY, PACKAGES)).filter((kit) =>
    existsSync(join(REPOSITORY, PACKAGES, kit, CONFIG, 'app.json')),
  );
}

/** A kit's file, read, by its path from the kit's folder; `null` when the kit has none there. */
export function kitText(kit: string, path: string): string | null {
  const file = join(REPOSITORY, PACKAGES, kit, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Every file of every kit that the designer opens, in the order of their kits and paths. */
export function kitFiles(): KitFile[] {
  return kits().flatMap((kit) => {
    const config = `${PACKAGES}/${kit}/${CONFIG}`;
    const read = (path: string): string => readFileSync(join(REPOSITORY, path), 'utf8');
    const layouts = folders(join(REPOSITORY, config, 'layouts')).flatMap((type) =>
      DESIGNED_MODES.flatMap((mode): KitFile[] => {
        const path = `${config}/layouts/${type}/${mode}.layout.json`;
        return existsSync(join(REPOSITORY, path))
          ? [{ kit, path, text: read(path), opens: { kind: 'layout', type, mode } }]
          : [];
      }),
    );
    const queues = filesIn(join(REPOSITORY, config, 'queues'))
      .filter((name) => name.endsWith('.json'))
      .map((name): KitFile => {
        const path = `${config}/queues/${name}`;
        return { kit, path, text: read(path), opens: { kind: 'queue', id: name.slice(0, -5) } };
      });
    return [...layouts, ...queues];
  });
}

/**
 * The kits' files the designer cannot write byte for byte, by path, and why. Each is Prettier's
 * own layout with one or more objects its author wrote across lines though they fit on one, which
 * Prettier keeps as written (`objectWrap: "preserve"`, its default, which `.prettierrc` keeps). The
 * server serves the designer a file's JSON value, never its text, so that choice is not in what it
 * reads: it writes those objects on one line, as Prettier lays out the same value afresh. Never
 * changed to fit the designer.
 */
export const NOT_BYTE_FOR_BYTE: Readonly<Record<string, string>> = {
  'business-apps/packages/contracts-demo/bundle/agentic-ui-config/queues/up-for-renewal.json':
    'its one sort, { "field": "contract:end", "order": "asc" }, is written across four lines',
  'business-apps/packages/controlled-documents-demo/bundle/agentic-ui-config/queues/current.json':
    'its one sort, { "field": "docctl:number", "order": "asc" }, is written across four lines',
  'business-apps/packages/facilities-demo/bundle/agentic-ui-config/layouts/WorkOrder/edit.layout.json':
    'four required fields, such as { "field": "dc:title", "required": true }, are each written across four lines',
  'business-apps/packages/facilities-demo/bundle/agentic-ui-config/queues/open-work-orders.json':
    'its one sort, { "field": "wo:due", "order": "asc" }, is written across four lines',
  'business-apps/packages/moves-demo/bundle/agentic-ui-config/layouts/DamageClaim/view.layout.json':
    'two fields, such as { "field": "dmg:move", "widget": "document-link", "parameters": … }, are each written across five lines',
  'business-apps/packages/moves-demo/bundle/agentic-ui-config/layouts/DamageClaim/edit.layout.json':
    'one field, { "field": "dmg:amountClaimed", "widget": "currency", "parameters": … }, is written across five lines',
  'business-apps/packages/moves-demo/bundle/agentic-ui-config/queues/moves-this-week.json':
    'its one sort, { "field": "move:loadDate", "order": "asc" }, is written across four lines',
  'business-apps/packages/moves-demo/bundle/agentic-ui-config/queues/open-claims.json':
    'its one sort, { "field": "dmg:filedOn", "order": "asc" }, is written across four lines',
  'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/layouts/Case/view.layout.json':
    'its history card, { "id": "history", "labelKey": …, "timeline": { "pageSize": 10 } }, is written across five lines',
  'business-apps/packages/records-demo/bundle/agentic-ui-config/queues/awaiting-approval.json':
    'its one sort, { "field": "drun:startedAt", "order": "asc" }, is written across four lines',
  'business-apps/packages/records-demo/bundle/agentic-ui-config/queues/certificates.json':
    'its one sort, { "field": "dcert:disposedAt", "order": "desc" }, is written across four lines',
};
