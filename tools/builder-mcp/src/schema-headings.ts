/**
 * The headings a demo kit's Properties panel would show for its own schemas, held to its English
 * labels: what `kit-schema-labels.spec.ts`, in `libs/shared/document-layouts`, asks of every kit
 * under `business-apps/packages/`, said by the write tools as a warning rather than found later by
 * a unit test outside the pipeline (the moves kit's Phase 8 feedback, item 15).
 *
 * For a type with no `metadata` layout the panel generates a section for each schema it does not
 * already present, headed by the label `layout.schema.<schema>`, else by the schema's name made
 * readable, `damageclaim` as "Damageclaim" (layout-v2.md, section 1). So, as the spec reads it:
 * each type of the kit's own `content-model.json` with no `layouts/<Type>/metadata.layout.json`,
 * each schema that type lists, not one of {@link PRESENTED_SCHEMAS}, with a field, needs a text for
 * its key in `labels/en.json`. A package that ships no stand-in model is a customer's, whose
 * schemas are the server's: nothing is said.
 *
 * A warning, never a refusal: the pipeline does not ask for the heading, and the record page does
 * not use it.
 */

/**
 * The schemas the Properties panel presents already, which it generates no section for:
 * `PRESENTED_SCHEMAS` in `libs/shared/document-layouts/src/lib/resolve-layout.ts`, which this tool
 * may not import (its project's tags comment). The spec holds the two lists equal.
 */
export const PRESENTED_SCHEMAS: ReadonlySet<string> = new Set([
  'common',
  'dublincore',
  'uid',
  'file',
  'files',
  'note',
  'facetedTag',
  'relatedtext',
  'picture',
  'image_metadata',
  'iptc',
  'video',
  'audio',
  'collectionMember',
  'notification',
  'thumbnail',
]);

const CONFIG = 'bundle/agentic-ui-config';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parsed(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
}

/**
 * Each heading the package's Properties panel would generate with no text, as a warning, given the
 * package's files by their path inside it (`read` answers `undefined` for one it does not hold).
 * None for a package with no `content-model.json`, or one that cannot be read: the pipeline says
 * why it cannot.
 */
export function schemaHeadingWarnings(read: (path: string) => string | undefined): string[] {
  const model = parsed(read('content-model.json'));
  if (!isRecord(model) || !isRecord(model['doctypes']) || !Array.isArray(model['schemas']))
    return [];
  const labelsFile = parsed(read(`${CONFIG}/labels/en.json`));
  const labels = isRecord(labelsFile) && isRecord(labelsFile['labels']) ? labelsFile['labels'] : {};
  const withFields = new Set(
    model['schemas']
      .filter(isRecord)
      .filter((schema) => isRecord(schema['fields']) && Object.keys(schema['fields']).length > 0)
      .map((schema) => schema['name'])
      .filter((name): name is string => typeof name === 'string'),
  );
  const warnings: string[] = [];
  const said = new Set<string>();
  for (const [type, definition] of Object.entries(model['doctypes'])) {
    if (read(`${CONFIG}/layouts/${type}/metadata.layout.json`) !== undefined) continue;
    const schemas =
      isRecord(definition) && Array.isArray(definition['schemas']) ? definition['schemas'] : [];
    for (const schema of schemas) {
      if (typeof schema !== 'string' || PRESENTED_SCHEMAS.has(schema) || !withFields.has(schema))
        continue;
      const key = `layout.schema.${schema}`;
      const text = labels[key];
      if ((typeof text === 'string' && text.trim() !== '') || said.has(key)) continue;
      said.add(key);
      warnings.push(
        `${CONFIG}/labels/en.json has no text for ${key}, the heading of the ${type} type's ${schema} section in the Properties panel, which without it shows the schema's name made readable. Write the text in labels/en.json: kit-schema-labels.spec.ts fails a kit under business-apps/packages/ without it.`,
      );
    }
  }
  return warnings;
}
