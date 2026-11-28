/**
 * Check 3, model (docs/business-apps/studio-migration.md, section 6): every field, vocabulary,
 * page provider and type the conversion names exists, and every widget it names shows its
 * property's type. A task form's variable is held to its step's and its workflow's variables
 * schemas.
 *
 * Without a server, the package's own model is all there is to hold it against
 * (`model.ts`), and that part is checked in full: a field of one of the package's schemas that the
 * schema lacks fails here. What the package does not define rests on the platform's own model,
 * Dublin Core and the stock types, vocabularies and page providers, which only the migration
 * server can confirm, through `/config/types`, `/config/schemas`, the directories and the page
 * provider definitions. Those names are listed, and the check counts as run in part. Lab mode
 * (`lab-server.ts`) confirms them on a server: {@link checkModelParts} gives them as data.
 */
import { PACKAGED_WIDGETS, isRecord } from '@agentic-ui/shared/app-definition';
import { fieldOf, layoutFields, listColumns, parametersOf, widgetOf } from './app-walk';
import { own } from './catalogue';
import type { CheckOutcome, HarnessInput } from './harness';
import { packageModel, schemasOfType, type PackageModel } from './model';

/**
 * A name the conversion rests on that the package does not define, so the platform's, which only a
 * server can confirm: a property of a schema the package does not hold, with the widget that shows
 * it and the type whose layout names it; a type; a vocabulary; a page provider; or a task's
 * variable that only one of its step's and its workflow's variables schemas could hold.
 */
export type PlatformName =
  | {
      readonly kind: 'property';
      readonly xpath: string;
      readonly widget: string | null;
      readonly type: string | null;
      readonly where: string;
    }
  | { readonly kind: 'type'; readonly name: string }
  | { readonly kind: 'vocabulary'; readonly name: string }
  | { readonly kind: 'page provider'; readonly name: string }
  | {
      readonly kind: 'variable';
      readonly xpath: string;
      readonly workflow: string;
      readonly step: string;
      readonly widget: string | null;
      readonly where: string;
    };

/** How check 3 names a platform name in its list: as it has always printed it. */
export function platformLabel(name: PlatformName): string {
  switch (name.kind) {
    case 'property':
      return name.xpath;
    case 'variable':
      return `${name.xpath} of ${name.workflow}.${name.step}`;
    default:
      return `the ${name.kind} ${name.name}`;
  }
}

/** What check 3 finds without a server, and the platform's names it could not confirm. */
export interface ModelParts {
  readonly findings: readonly string[];
  /** Each name in the order first met; a property once for each widget and type that name it. */
  readonly platform: readonly PlatformName[];
  readonly model: PackageModel;
}

export function checkModel(input: HarnessInput): CheckOutcome {
  const { findings, platform } = checkModelParts(input);
  const labels = [...new Set(platform.map(platformLabel))];
  return {
    findings,
    ...(labels.length > 0
      ? {
          rest: `${labels.length} ${labels.length === 1 ? 'name rests' : 'names rest'} on the platform's own model, which only a server can confirm, such as the migration server, in lab mode: ${listed(labels)}`,
        }
      : {}),
  };
}

export function checkModelParts({ pkg, inventory, conversion }: HarnessInput): ModelParts {
  const model = packageModel(pkg, inventory);
  const findings: string[] = [];
  const platformNames = new Map<string, PlatformName>();
  const platform = {
    add: (name: PlatformName): void => {
      const key = JSON.stringify({ ...name, where: undefined });
      if (!platformNames.has(key)) platformNames.set(key, name);
    },
  };
  const facetSchemas = new Set([...model.facets.values()].flat());

  const property = (
    where: string,
    xpath: string,
    widget: string | null,
    type: string | null,
  ): void => {
    const colon = xpath.indexOf(':');
    const prefix = xpath.slice(0, colon);
    const name = xpath.slice(colon + 1);
    const schema = model.schemas.get(prefix);
    if (!schema) {
      platform.add({ kind: 'property', xpath, widget, type, where });
      return;
    }
    if (!schema.read) {
      findings.push(
        `${where}: ${xpath} cannot be checked, because the schema ${schema.name}'s file cannot be read`,
      );
      return;
    }
    const fieldType = schema.fields.get(name);
    if (fieldType === undefined) {
      findings.push(
        `${where}: the schema ${schema.name} has no field ${name}, so ${xpath} does not exist`,
      );
      return;
    }
    if (type !== null) {
      const schemas = schemasOfType(model, type);
      if (schemas !== null && !schemas.has(schema.name) && !facetSchemas.has(schema.name))
        findings.push(
          `${where}: the type ${type} has no ${schema.name} schema, so it has no ${xpath}`,
        );
    }
    if (widget !== null) {
      const definition = own(PACKAGED_WIDGETS, widget);
      if (definition && !definition.accepts.includes(fieldType))
        findings.push(
          `${where}: the ${widget} widget does not show ${xpath}, which is a ${fieldType}`,
        );
    }
  };
  const entry = (where: string, value: unknown, type: string | null): void => {
    const xpath = fieldOf(value);
    if (xpath === null || !xpath.includes(':')) return;
    const widget = widgetOf(value);
    property(where, xpath, widget, type);
    const directory = parametersOf(value)['directory'];
    if (widget === 'vocabulary' && typeof directory === 'string') vocabulary(directory);
  };
  const vocabulary = (name: string): void => {
    if (!model.directories.has(name)) platform.add({ kind: 'vocabulary', name });
  };
  const provider = (where: string, name: unknown): void => {
    if (typeof name !== 'string') return;
    if (!model.pageProviders.has(name)) platform.add({ kind: 'page provider', name });
  };

  /**
   * A task form's field: a variable of its step or its workflow, `var:<name>`, held to their
   * variables schemas, `var_<step>` and `var_<workflow>`, when the package holds them.
   */
  const variable = (where: string, value: unknown, workflow: string, step: string): void => {
    const xpath = fieldOf(value);
    if (xpath === null || !xpath.startsWith('var:')) {
      entry(where, value, null);
      return;
    }
    const name = xpath.slice('var:'.length);
    const wanted = [`var_${step}`, `var_${workflow}`];
    const schemas = [...model.schemas.values()].filter((schema) => wanted.includes(schema.name));
    const unread = schemas.find((schema) => !schema.read);
    if (unread) {
      findings.push(
        `${where}: ${xpath} cannot be checked, because the schema ${unread.name}'s file cannot be read`,
      );
      return;
    }
    const holder = schemas.find((schema) => schema.fields.has(name));
    if (!holder) {
      if (schemas.length === wanted.length)
        findings.push(
          `${where}: neither var_${step} nor var_${workflow} has a variable ${name}, so ${xpath} does not exist`,
        );
      else
        platform.add({ kind: 'variable', xpath, workflow, step, widget: widgetOf(value), where });
      return;
    }
    const widget = widgetOf(value);
    const fieldType = holder.fields.get(name);
    const definition = widget === null ? undefined : own(PACKAGED_WIDGETS, widget);
    if (definition && fieldType !== undefined && !definition.accepts.includes(fieldType))
      findings.push(
        `${where}: the ${widget} widget does not show ${xpath}, which is a ${fieldType}`,
      );
    const directory = parametersOf(value)['directory'];
    if (widget === 'vocabulary' && typeof directory === 'string') vocabulary(directory);
  };

  for (const [path, file] of Object.entries(conversion.app)) {
    const task = /^tasks\/([^/.]+)\.([^/.]+)\.layout\.json$/.exec(path);
    if (task) {
      for (const field of layoutFields(file))
        variable(`${path} ${field.at}`, field.entry, task[1], task[2]);
      continue;
    }
    const layout = /^layouts\/([^/]+)\/[^/]+\.layout\.json$/.exec(path);
    if (layout) {
      const type = layout[1];
      if (!model.types.has(type)) platform.add({ kind: 'type', name: type });
      for (const field of layoutFields(file)) entry(`${path} ${field.at}`, field.entry, type);
      // A card of related records: its page provider, its columns, of the records it lists, and
      // each property of the open record it sends; the repository's own, `ecm:`, are no schema's.
      for (const { at, related } of relatedCards(file)) {
        provider(`${path} ${at}`, related['pageProvider']);
        listColumns(related).forEach((column) =>
          entry(`${path} ${at}.${column.at}`, column.entry, null),
        );
        (Array.isArray(related['parameters']) ? related['parameters'] : []).forEach(
          (parameter, index) => {
            if (isRecord(parameter) && fieldOf(parameter)?.startsWith('ecm:') !== true)
              entry(`${path} ${at}.parameters.${index}`, parameter, type);
          },
        );
      }
      continue;
    }
    if (path.startsWith('queues/')) {
      if (isRecord(file)) provider(path, file['pageProvider']);
      for (const column of listColumns(file)) entry(`${path} ${column.at}`, column.entry, null);
      const sort = isRecord(file) && Array.isArray(file['sort']) ? file['sort'] : [];
      sort.forEach((item, index) => entry(`${path} sort.${index}`, item, null));
      continue;
    }
    if (path === 'actions.json' && isRecord(file) && Array.isArray(file['actions'])) {
      file['actions'].forEach((action, index) => {
        // Only `{ "field": … }` names a property: a literal text is a literal, colon or not.
        for (const [name, value] of Object.entries(parametersOf(action)))
          if (isRecord(value)) entry(`${path} actions.${index}.parameters.${name}`, value, null);
      });
    }
  }

  // A contribution or schema that cannot be read leaves its part of the model unknown, and what it
  // would have defined would otherwise be taken for the platform's.
  findings.push(...model.problems.map((problem) => `the model: ${problem}`));
  return { findings, platform: [...platformNames.values()], model };
}

/** Each card of related records of a layout file, its own or a tab's, with where it is. */
function relatedCards(
  file: unknown,
): { readonly at: string; readonly related: Record<string, unknown> }[] {
  const found: { at: string; related: Record<string, unknown> }[] = [];
  if (!isRecord(file)) return found;
  const cards = (list: unknown, at: string): void =>
    (Array.isArray(list) ? list : []).forEach((card, index) => {
      if (isRecord(card) && isRecord(card['related']))
        found.push({ at: `${at}cards.${index}.related`, related: card['related'] });
    });
  cards(file['cards'], '');
  (Array.isArray(file['tabs']) ? file['tabs'] : []).forEach((tab, index) => {
    if (isRecord(tab)) cards(tab['cards'], `tabs.${index}.`);
  });
  return found;
}

/** A list for a line of text: the first few, and how many more. */
export function listed(items: readonly string[], shown = 6): string {
  const head = items.slice(0, shown).join(', ');
  return items.length > shown ? `${head}, and ${items.length - shown} more` : head;
}
