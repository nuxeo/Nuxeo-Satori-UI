import { formatFiles, type Tree } from '@nx/devkit';

import { cardId, loadModel, NUXEO_SCHEMAS, schemasLeftOut, TYPE } from '../app-layout/generator';
import { schemasOf, type ModelProperty, type ModelSchema } from '../app-layout/content-model';
import {
  addLabels,
  appContributionSaid,
  contributeApp,
  contributeLayout,
  humanize,
  listOption,
  readAppPackage,
  schemaFor,
  writeJson,
  XPATH,
} from '../app-package/package-files';

export interface AppFormSchema {
  package: string;
  type: string;
  mode?: string;
  model?: string;
  modelServer?: string;
  schemas?: string | string[];
  required?: string | string[];
  title?: boolean;
  force?: boolean;
}

/** The modes a form is drawn in: the Edit form, and the Create form for a new record. */
const FORM_MODES = ['edit', 'create'];

/** The record's name, which a form draws only when it lists it (layout-v2.md, section 11). */
const TITLE = 'dc:title';

type FieldEntry =
  | string
  | {
      field: string;
      widget?: string;
      parameters?: Record<string, unknown>;
      required?: true;
    };

/** Whether `property`, or a subfield of it at any depth, is a file. */
function holdsFile(property: ModelProperty): boolean {
  return property.type === 'blob' || [...property.fields.values()].some(holdsFile);
}

/**
 * The entry a form edits `xpath` with, or why it is left out. A form draws each input as the
 * property's type picks it, as version 1 does (layout-v2.md, section 11), so a widget is written
 * only where it changes the input: `vocabulary`, for a property bound to a directory, is a picker
 * of its entries. A `document-link`, an `address` or a `table` draws what the bare name does in a
 * form, so the bare name is written, and the console has nothing to say of it. A file, or a value
 * holding one, is changed in Attachments, not in a form.
 */
function entryFor(
  xpath: string,
  property: ModelProperty,
): { entry: FieldEntry } | { left: string } {
  if (holdsFile(property)) {
    return { left: 'a file, or a value holding one: files are changed in Attachments' };
  }
  if (property.type === 'string' && property.directory) {
    return {
      entry: { field: xpath, widget: 'vocabulary', parameters: { directory: property.directory } },
    };
  }
  return { entry: xpath };
}

/**
 * Write a version 2 form, `layouts/<Type>/<mode>.layout.json` in `edit` or `create` mode
 * (docs/business-apps/layout-v2.md), from the type's schemas in the server's content model, and
 * have the package's component contribute it, as `app-layout` does a record page.
 *
 * - **One card per schema**, as `app-layout` chooses them: the type's own and its facets', Nuxeo's
 *   own left out unless `--schemas` names them. A form's cards are its sections, under the same
 *   headings as the record page's, so their label keys are the record page's.
 * - **`dc:title` first,** when the type has Dublin Core and `--schemas` does not name it: a form
 *   draws only the fields it lists, and a record is named by its title. `--title=false` leaves it
 *   out.
 * - **`--required`** names the fields required whenever they are editable, `"required": true`. A
 *   rule in plain words, "required when the status is Terminated", is the next edit: `required` or
 *   `readOnlyWhen` with a registered rule.
 * - **No `columns`, no banners, no related records:** the validator refuses them in a form.
 *
 * The package pipeline, given the same model, holds the result to it.
 */
export default async function appFormGenerator(tree: Tree, options: AppFormSchema) {
  const pkg = readAppPackage(tree, options.package);
  if (!TYPE.test(options.type ?? '')) {
    throw new Error(`--type "${options.type}" must be a document type's name, such as Contract.`);
  }
  const mode = options.mode ?? 'edit';
  if (!FORM_MODES.includes(mode)) {
    throw new Error(
      `--mode "${mode}" is not a form's: edit, the Edit form, or create, the Create form. A record page is app-layout's.`,
    );
  }
  const required = listOption(options.required);
  const badRequired = required.find((xpath) => !XPATH.test(xpath));
  if (badRequired !== undefined) {
    throw new Error(`--required: "${badRequired}" is not a property, written <prefix>:<name>.`);
  }
  const file = `${pkg.config}/layouts/${options.type}/${mode}.layout.json`;
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
  const dublinCore = model.schemas.get('dublincore');
  const withTitle =
    options.title !== false &&
    !chosen.includes('dublincore') &&
    available.includes('dublincore') &&
    dublinCore?.prefix === 'dc' &&
    dublinCore.properties.has('title');

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
      const made = entryFor(xpath, definition);
      if ('left' in made) left.push(`${xpath}: ${made.left}`);
      else fields.push(made.entry);
    }
    if (fields.length === 0) {
      left.push(`the schema ${name}: nothing in it a form edits`);
      return [];
    }
    const id = cardId(name, taken);
    const labelKey = `${pkg.appId}.card.${keyType}.${id}`;
    labels[labelKey] = humanize(name);
    return [{ id, labelKey, fields }];
  });
  if (cards.length === 0) {
    throw new Error(`Nothing in ${chosen.join(', ')} can be edited:\n  ${left.join('\n  ')}`);
  }
  if (withTitle) cards[0].fields.unshift(TITLE);
  left.push(...schemasLeftOut(model, available, chosen, new Set(withTitle ? [TITLE] : [])));

  // `"required": true` on the fields --required names, each of which the form must list.
  const listed = new Set(
    cards.flatMap((card) =>
      card.fields.map((entry) => (typeof entry === 'string' ? entry : entry.field)),
    ),
  );
  const missing = required.filter((xpath) => !listed.has(xpath));
  if (missing.length > 0) {
    throw new Error(
      `--required names ${missing.join(', ')}, which the form does not list: it lists ${[...listed].join(', ')}.`,
    );
  }
  for (const card of cards) {
    card.fields = card.fields.map((entry) => {
      const xpath = typeof entry === 'string' ? entry : entry.field;
      if (!required.includes(xpath)) return entry;
      return typeof entry === 'string'
        ? { field: xpath, required: true }
        : { ...entry, required: true };
    });
  }

  // First, since it may refuse: nothing is written before it has.
  contributeLayout(tree, pkg, options.type, mode);
  writeJson(tree, file, {
    $schema: schemaFor(file, 'layout-v2.schema.json'),
    version: 2,
    cards,
  });
  const kept = addLabels(tree, pkg, labels);
  const app = contributeApp(tree, pkg, { create: false });

  await formatFiles(tree);

  return () => {
    console.log(`
Wrote ${file}

  Type:     ${options.type}, the ${mode === 'edit' ? 'Edit' : 'Create'} form, from ${from}
  Cards:    ${cards.map((card) => `${card.id} (${card.fields.length})`).join(', ')}
  Required: ${required.length === 0 ? 'none' : required.join(', ')}
  Left out: ${left.length === 0 ? 'nothing' : `${left.length}\n    ${left.join('\n    ')}`}
${kept.length > 0 ? `\n  Kept the text labels/en.json already had for ${kept.join(', ')}\n` : ''}${appContributionSaid(pkg, app, { absent: false })}
${pkg.component} contributes it. A field rule in plain words is the next edit: "required" or
"readOnlyWhen" with a registered rule (layout-v2.md, section 5). Check it against the same model:

  npm run app-package -- ${pkg.root} --platform <platform version> --model <content-model.json>
`);
  };
}
