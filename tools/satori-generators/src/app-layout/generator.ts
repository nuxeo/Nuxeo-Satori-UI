import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { formatFiles, workspaceRoot, type Tree } from '@nx/devkit';

import {
  addLabels,
  appContributionSaid,
  contributeApp,
  contributeLayout,
  ID,
  listOption,
  parseJson,
  readAppPackage,
  schemaFor,
  writeJson,
  XPATH,
  humanize,
} from '../app-package/package-files';
import {
  readModel,
  schemasOf,
  type Model,
  type ModelProperty,
  type ModelSchema,
} from './content-model';

export interface AppLayoutSchema {
  package: string;
  type: string;
  model?: string;
  modelServer?: string;
  schemas?: string | string[];
  columns?: number;
  force?: boolean;
}

/** A document type's name, as a layout's path writes it (`layouts/<Type>/`). */
export const TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

/**
 * Nuxeo's own schemas, which nearly every document type carries: the title and dates, the icon and
 * size, the version, the main file and attachments, the tags and the full text. They are the
 * platform's, not the business record's, so they are left out unless `--schemas` names them.
 * Between them, the stock `File`, `Note` and `Folder` carry these, and `Note` its own `note` besides.
 */
export const NUXEO_SCHEMAS: readonly string[] = [
  'common',
  'dublincore',
  'uid',
  'file',
  'files',
  'facetedTag',
  'relatedtext',
];

/**
 * Each schema `available` has and `chosen` does not name, with its properties and why they are
 * left out, so that a generator's "Left out" names every property it does not write: Nuxeo's own,
 * left out unless `--schemas` names them, a file schema saying where its files are shown; and the
 * type's own, when `--schemas` names others. `written` is what it wrote all the same, such as the
 * title a form adds: not said.
 */
export function schemasLeftOut(
  model: Model,
  available: readonly string[],
  chosen: readonly string[],
  written: ReadonlySet<string> = new Set(),
): string[] {
  return available
    .filter((name) => !chosen.includes(name))
    .flatMap((name) => {
      const own = !NUXEO_SCHEMAS.includes(name);
      const schema = model.schemas.get(name) as ModelSchema | undefined;
      if (!schema)
        return [
          `the schema ${name}: ${own ? 'not named by --schemas' : "Nuxeo's own"}, which the model does not describe`,
        ];
      const properties = [...schema.properties.keys()]
        .map((property) => `${schema.prefix}:${property}`)
        .filter((xpath) => !written.has(xpath));
      if (properties.length === 0) return [];
      const why = own
        ? `in the schema ${name}, which --schemas does not name`
        : name === 'files'
          ? `in Nuxeo's own schema files, a record's attachments, which the document page's Attachments panel shows and adds; a "file-list" widget shows them on the record page, written by hand`
          : name === 'file'
            ? `in Nuxeo's own schema file, a record's main file, which its own view shows; an "image" or "file-list" widget shows it on the record page, written by hand`
            : `in Nuxeo's own schema ${name}, left out unless --schemas names it`;
      return [`${properties.join(', ')}: ${why}`];
    });
}

/** The subfield names an `address` widget's parts are read from, by part. */
const ADDRESS_PARTS: Readonly<Record<string, readonly string[]>> = {
  street: ['street', 'line1', 'address'],
  city: ['city', 'town'],
  postcode: ['postcode', 'zip', 'zipCode', 'postalCode'],
  country: ['country'],
};

const SCALAR = new Set(['string', 'long', 'double', 'boolean', 'date']);

type FieldEntry = string | { field: string; widget: string; parameters?: Record<string, unknown> };

/**
 * The entry that shows `xpath`, or why it is left out. A widget is written only where the model
 * says more than the property's type: a vocabulary, a document link, a table's columns, an
 * address's parts. Anything else is the bare name, which shows the property with the widget its
 * type picks, as version 1 does (layout-v2.md, section 2).
 */
function entryFor(
  xpath: string,
  prefix: string,
  property: ModelProperty,
  notes: string[],
): { entry: FieldEntry } | { left: string } {
  if (property.type === 'blob') {
    return {
      left: 'a file; an "image" or "file-list" widget shows one, written by hand',
    };
  }
  if (property.type === 'string' && property.directory) {
    return {
      entry: { field: xpath, widget: 'vocabulary', parameters: { directory: property.directory } },
    };
  }
  if (property.type === 'string' && property.document) {
    return { entry: { field: xpath, widget: 'document-link' } };
  }
  if (property.type === 'complex' && property.list) {
    // A cell is one line of text: a list, a complex value or a file in it is not a column.
    const columns: string[] = [];
    for (const [name, sub] of property.fields) {
      if (SCALAR.has(sub.type) && !sub.list && XPATH.test(`${prefix}:${name}`))
        columns.push(`${prefix}:${name}`);
      else notes.push(`"${name}" of ${xpath}: not a column a table shows as one line`);
    }
    return columns.length > 0
      ? { entry: { field: xpath, widget: 'table', parameters: { columns } } }
      : { entry: xpath };
  }
  if (property.type === 'complex') {
    const parts: Record<string, string> = {};
    for (const [part, names] of Object.entries(ADDRESS_PARTS)) {
      const found = names.find((name) => property.fields.get(name)?.type === 'string');
      if (found) parts[part] = found;
    }
    if (parts['street'] && parts['city']) {
      return { entry: { field: xpath, widget: 'address', parameters: { parts } } };
    }
  }
  return { entry: xpath };
}

/** A card id from a schema's name: the name, when it is an id, else its letters and digits. */
export function cardId(schema: string, taken: Set<string>): string {
  const base = ID.test(schema)
    ? schema
    : schema.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || 'card';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * The server's address as a message may show it: its origin and path, without a user, a password,
 * a query or a fragment, which an address given by mistake may carry.
 */
function addressShown(server: string): string {
  try {
    const url = new URL(server);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'the server';
  }
}

/**
 * The content model from `--model`, a file `npm run app-package:model` exported, or read live
 * from `--model-server` by that same export, with `NUXEO_USER` and `NUXEO_PASS` from the
 * environment. The export is this repository's (`scripts/app-package-model.mjs`): its credentials
 * go in a header only, never over plain HTTP to another machine, and never after a redirect. The
 * file it writes is removed once read.
 */
export async function loadModel(
  options: Pick<AppLayoutSchema, 'model' | 'modelServer'>,
): Promise<{ model: Model; from: string }> {
  if ((options.model === undefined) === (options.modelServer === undefined)) {
    throw new Error(
      'Give the content model one way: --model <file>, as `npm run app-package:model` exports it, or --modelServer <address> to read it live.',
    );
  }
  if (options.model !== undefined) {
    const file = isAbsolute(options.model) ? options.model : resolve(workspaceRoot, options.model);
    if (!existsSync(file)) throw new Error(`--model ${options.model} does not exist.`);
    return {
      model: readModel(parseJson(readFileSync(file, 'utf-8'), options.model), options.model),
      from: options.model,
    };
  }
  const server = options.modelServer as string;
  const shown = addressShown(server);
  const exporter = join(workspaceRoot, 'scripts', 'app-package-model.mjs');
  if (!existsSync(exporter)) {
    throw new Error(
      `--modelServer reads the model with this repository's ${exporter}, which this workspace does not have. Export it where you can, and pass --model.`,
    );
  }
  const scratch = mkdtempSync(join(tmpdir(), 'app-layout-model-'));
  try {
    const out = join(scratch, 'content-model.json');
    try {
      await promisify(execFile)(process.execPath, [exporter, '--server', server, '--out', out], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      // The export's own messages, which never quote the address it was given nor the
      // credentials. Not the error's own message: that is the command line, address included.
      const failure = error as { code?: number; stderr?: string; stdout?: string };
      const said = `${failure.stderr ?? ''}${failure.stdout ?? ''}`.trim() || 'it said nothing';
      throw new Error(
        `The content model of ${shown} was not read (exit ${failure.code}):\n${said}`,
      );
    }
    return {
      model: readModel(parseJson(readFileSync(out, 'utf-8'), shown), shown),
      from: shown,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Write a version 2 `view` layout, the record page of one document type
 * (docs/business-apps/layout-v2.md), from the type's schemas in the server's content model.
 *
 * - **One card per schema**, its fields the schema's properties, in the model's order. Nuxeo's own
 *   schemas (`NUXEO_SCHEMAS`) are left out unless `--schemas` names them; `--schemas` names
 *   exactly the schemas to show, in order.
 * - **A widget only where the model says more than the type:** a property bound to a directory is
 *   a `vocabulary`, a document's id a `document-link`, a list of complex values a `table` over its
 *   simple subfields, and a complex value with a street and a city an `address`. Files are left
 *   out.
 * - **Every property left out is said, and why,** under "Left out": a file, a name a layout
 *   cannot write, each property of Nuxeo's own schemas, a record's attachments among them, and
 *   each of a schema `--schemas` does not name.
 * - **The component contributes it**, from `agentic-ui-config/layouts/<Type>/view.layout.json`,
 *   which is where the package pipeline reads it and the only place it accepts.
 * - **Each card's heading** is a label key, with its English text added to `labels/en.json`.
 *
 * What it writes is a start: rules, computations, related records and the widgets a person picks
 * (`currency`, `status-badge`, `phone`) are the next edit. The package pipeline, given the same
 * model, holds the result to it.
 */
export default async function appLayoutGenerator(tree: Tree, options: AppLayoutSchema) {
  const pkg = readAppPackage(tree, options.package);
  if (!TYPE.test(options.type ?? '')) {
    throw new Error(`--type "${options.type}" must be a document type's name, such as Contract.`);
  }
  const columns = options.columns;
  if (columns !== undefined && (!Number.isInteger(columns) || columns < 1 || columns > 3)) {
    throw new Error(`--columns ${columns} must be 1, 2 or 3.`);
  }
  const file = `${pkg.config}/layouts/${options.type}/view.layout.json`;
  if (tree.exists(file) && !options.force) {
    throw new Error(`${file} already exists. Pass --force to write it again from the model.`);
  }

  const { model, from } = await loadModel(options);
  const type = model.types.get(options.type);
  if (!type) {
    const near = [...model.types.keys()].filter(
      (name) => name.toLowerCase() === options.type.toLowerCase(),
    );
    throw new Error(
      `The content model ${from} has no document type "${options.type}"` +
        (near.length > 0 ? `; did you mean ${near.join(' or ')}?` : '.'),
    );
  }
  const available = schemasOf(model, type);
  const named = listOption(options.schemas);
  const unknown = named.filter((schema) => !available.includes(schema));
  if (unknown.length > 0) {
    throw new Error(
      `${options.type} has no schema ${unknown.map((s) => `"${s}"`).join(', ')}; it has ${available.join(', ')}.`,
    );
  }
  const chosen =
    named.length > 0 ? named : available.filter((schema) => !NUXEO_SCHEMAS.includes(schema));
  if (chosen.length === 0) {
    throw new Error(
      `${options.type} has only Nuxeo's own schemas (${available.join(', ')}). Name the ones to show with --schemas.`,
    );
  }

  const left: string[] = [];
  const taken = new Set<string>();
  const labels: Record<string, string> = {};
  const keyType = options.type.charAt(0).toLowerCase() + options.type.slice(1);
  const cards = chosen.flatMap((name) => {
    const schema = model.schemas.get(name) as ModelSchema | undefined;
    if (!schema) {
      left.push(`the schema ${name}: the model does not describe it`);
      return [];
    }
    const fields: FieldEntry[] = [];
    for (const [property, definition] of schema.properties) {
      const xpath = `${schema.prefix}:${property}`;
      if (!XPATH.test(xpath)) {
        left.push(`${xpath}: not a name a layout can write`);
        continue;
      }
      const made = entryFor(xpath, schema.prefix, definition, left);
      if ('left' in made) left.push(`${xpath}: ${made.left}`);
      else fields.push(made.entry);
    }
    if (fields.length === 0) {
      left.push(`the schema ${name}: nothing in it to show`);
      return [];
    }
    const id = cardId(name, taken);
    const labelKey = `${pkg.appId}.card.${keyType}.${id}`;
    labels[labelKey] = humanize(name);
    return [{ id, labelKey, fields }];
  });
  if (cards.length === 0) {
    throw new Error(`Nothing in ${chosen.join(', ')} can be shown:\n  ${left.join('\n  ')}`);
  }
  left.push(...schemasLeftOut(model, available, chosen));

  // First, since it may refuse: nothing is written before it has.
  contributeLayout(tree, pkg, options.type, 'view');
  const layoutColumns = columns ?? Math.min(2, cards.length);
  writeJson(tree, file, {
    $schema: schemaFor(file, 'layout-v2.schema.json'),
    version: 2,
    ...(layoutColumns > 1 ? { columns: layoutColumns } : {}),
    cards,
  });
  const kept = addLabels(tree, pkg, labels);
  // labels/en.json is a file the app registry serves: named, if the component contributes the app.
  const app = contributeApp(tree, pkg, { create: false });

  await formatFiles(tree);

  return () => {
    console.log(`
Wrote ${file}

  Type:     ${options.type}, from ${from}
  Cards:    ${cards.map((card) => `${card.id} (${card.fields.length})`).join(', ')}
  Left out: ${left.length === 0 ? 'nothing' : `${left.length}\n    ${left.join('\n    ')}`}
${kept.length > 0 ? `\n  Kept the text labels/en.json already had for ${kept.join(', ')}\n` : ''}${appContributionSaid(pkg, app, { absent: false })}
${pkg.component} contributes it. Check it against the same model:

  npm run app-package -- ${pkg.root} --platform <platform version> --model <content-model.json>
`);
  };
}
