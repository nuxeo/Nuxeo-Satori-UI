import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DocumentTypeSchema } from './layout.model';
import { generateLayout, humanize, readSchema, schemaLabelKey } from './resolve-layout';

// Every section heading the Properties panel generates for a business-apps kit's own types, held
// to the kit's English labels. With no `layout.schema.<schema>` text the heading is the schema's
// name made readable, which for a kit's schema is a raw name: the brand-assets kit's product page
// headed its section "Acmeproduct" until the kit named it (app-definition-v2.md, section 7).
//
// Each kit's types and their schemas are read from its `content-model.json`, the model the
// package pipeline holds the kit to, and sectioned by `generateLayout`, as the panel does. A type
// whose kit ships a `metadata` layout file is left out: that file names its own headings.

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const KITS = join(ROOT, 'business-apps', 'packages');
const CONFIG = join('bundle', 'agentic-ui-config');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every kit: a folder of business-apps/packages with an app definition. */
const kits = readdirSync(KITS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(KITS, entry.name, CONFIG, 'app.json')))
  .map((entry) => entry.name)
  .sort();

interface Heading {
  readonly type: string;
  readonly schema: string;
  readonly key: string;
  readonly text: string | undefined;
}

/** The generated headings of a kit's Properties panel, each with its English text, if any. */
function headingsOf(kit: string): Heading[] {
  const root = join(KITS, kit);
  const model = readJson(join(root, 'content-model.json'));
  const labelsFile = readJson(join(root, CONFIG, 'labels', 'en.json'));
  if (!isRecord(model) || !isRecord(model['doctypes']) || !Array.isArray(model['schemas']))
    throw new Error(`${kit}: content-model.json has no doctypes and schemas`);
  const labels = isRecord(labelsFile) && isRecord(labelsFile['labels']) ? labelsFile['labels'] : {};
  const schemas = new Map<string, DocumentTypeSchema>();
  for (const raw of model['schemas']) {
    const schema = readSchema(raw);
    if (schema) schemas.set(schema.name, schema);
  }
  const headings: Heading[] = [];
  for (const [type, definition] of Object.entries(model['doctypes'])) {
    if (existsSync(join(root, CONFIG, 'layouts', type, 'metadata.layout.json'))) continue;
    const names =
      isRecord(definition) && Array.isArray(definition['schemas']) ? definition['schemas'] : [];
    const own = names.map((name) => {
      const schema = typeof name === 'string' ? schemas.get(name) : undefined;
      // A schema the model names and does not define would drop its section unseen.
      if (!schema)
        throw new Error(
          `${kit}: ${type} names the schema ${String(name)}, which content-model.json does not define`,
        );
      return schema;
    });
    for (const section of generateLayout({ name: type, schemas: own }, 'metadata').sections) {
      const key = schemaLabelKey(section.id);
      const text = labels[key];
      headings.push({
        type,
        schema: section.id,
        key,
        text: typeof text === 'string' ? text : undefined,
      });
    }
  }
  return headings;
}

describe("the Properties panel's generated headings in each business-apps kit", () => {
  it('finds the kits', () => {
    expect(kits).toEqual(
      expect.arrayContaining([
        'brand-assets-demo',
        'contracts-demo',
        'controlled-documents-demo',
        'facilities-demo',
        'moves-demo',
        'payers-claims-demo',
        'records-demo',
      ]),
    );
  });

  it.each(kits)('%s names every schema section of its own types in its English labels', (kit) => {
    const headings = headingsOf(kit);
    // A kit whose types generate no section would pass with nothing checked.
    expect(headings.length).toBeGreaterThan(0);
    expect(
      headings.filter((heading) => !heading.text?.trim()).map((h) => `${h.type}: ${h.key}`),
    ).toEqual([]);
  });

  it('heads the brand-assets product\'s section from the kit, not as "Acmeproduct"', () => {
    const product = headingsOf('brand-assets-demo').find(
      (heading) => heading.type === 'AcmeProduct',
    );
    expect(product?.key).toBe('layout.schema.acmeproduct');
    expect(product?.text).toBeTruthy();
    expect(product?.text).not.toBe(humanize('acmeproduct'));
  });
});
