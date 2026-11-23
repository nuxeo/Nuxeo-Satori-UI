/**
 * Check 3, model (docs/business-apps/studio-migration.md, section 6): every field, vocabulary,
 * page provider and type the conversion names exists, and every widget it names shows its
 * property's type.
 *
 * Without a server, the package's own model is all there is to hold it against
 * (`model.ts`), and that part is checked in full: a field of one of the package's schemas that the
 * schema lacks fails here. What the package does not define rests on the platform's own model,
 * Dublin Core and the stock types, vocabularies and page providers, which only the migration
 * server can confirm, through `/config/types`, `/config/schemas`, the directories and the page
 * provider definitions. Those names are listed, and the check counts as run in part.
 */
import { PACKAGED_WIDGETS, isRecord } from '@agentic-ui/shared/app-definition';
import { fieldOf, layoutFields, listColumns, parametersOf, widgetOf } from './app-walk';
import { own } from './catalogue';
import type { CheckOutcome, HarnessInput } from './harness';
import { packageModel, schemasOfType } from './model';

export function checkModel({ pkg, inventory, conversion }: HarnessInput): CheckOutcome {
  const model = packageModel(pkg, inventory);
  const findings: string[] = [];
  const platform = new Set<string>();
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
      platform.add(xpath);
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
    if (!model.directories.has(name)) platform.add(`the vocabulary ${name}`);
  };
  const provider = (where: string, name: unknown): void => {
    if (typeof name !== 'string') return;
    if (!model.pageProviders.has(name)) platform.add(`the page provider ${name}`);
  };

  for (const [path, file] of Object.entries(conversion.app)) {
    const layout = /^layouts\/([^/]+)\/[^/]+\.layout\.json$/.exec(path);
    if (layout) {
      const type = layout[1];
      if (!model.types.has(type)) platform.add(`the type ${type}`);
      for (const field of layoutFields(file)) entry(`${path} ${field.at}`, field.entry, type);
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
  return {
    findings,
    ...(platform.size > 0
      ? {
          rest: `${platform.size} ${platform.size === 1 ? 'name rests' : 'names rest'} on the platform's own model, which only the migration server can confirm: ${listed([...platform])}`,
        }
      : {}),
  };
}

/** A list for a line of text: the first few, and how many more. */
export function listed(items: readonly string[], shown = 6): string {
  const head = items.slice(0, shown).join(', ');
  return items.length > shown ? `${head}, and ${items.length - shown} more` : head;
}
