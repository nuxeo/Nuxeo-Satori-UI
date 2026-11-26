import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESENTED_SCHEMAS, schemaHeadingWarnings } from './schema-headings.ts';
import { REPO_ROOT } from './validate-package.ts';

const CONFIG = 'bundle/agentic-ui-config';

/** The manifest and the component of a stand-in model, which registers a type of its own. */
const STAND_IN = {
  'bundle/META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nNuxeo-Component: OSGI-INF/model.xml\n',
  'bundle/OSGI-INF/model.xml':
    '<component name="x.model"><extension target="org.nuxeo.ecm.core.schema.TypeService" point="doctype"><doctype name="DamageClaim" extends="Document" /></extension></component>',
};

/** A demo kit's files, by their path inside it: a text as it is, anything else as JSON. */
const files =
  (held: Record<string, unknown>, standIn = true) =>
  (path: string): string | undefined => {
    const all: Record<string, unknown> = standIn ? { ...STAND_IN, ...held } : held;
    if (!(path in all)) return undefined;
    return typeof all[path] === 'string' ? (all[path] as string) : JSON.stringify(all[path]);
  };

const MODEL = {
  doctypes: {
    DamageClaim: { parent: 'Document', facets: [], schemas: ['common', 'files', 'damageclaim'] },
    Empty: { parent: 'Document', facets: [], schemas: ['nothing'] },
  },
  facets: [],
  schemas: [
    { name: 'common', fields: { icon: 'string' } },
    { name: 'files', fields: { files: { type: 'complex[]', fields: { file: 'blob' } } } },
    { name: 'damageclaim', prefix: 'dmg', fields: { number: 'string' } },
    { name: 'nothing', fields: {} },
  ],
};

describe('schemaHeadingWarnings', () => {
  it("warns of each of a kit's own schemas whose Properties heading has no text", () => {
    const warnings = schemaHeadingWarnings(
      files({ 'content-model.json': MODEL, [`${CONFIG}/labels/en.json`]: { labels: {} } }),
    );
    // Not common or files, which the panel presents already; not a schema with no field.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('has no text for layout.schema.damageclaim');
    expect(warnings[0]).toContain("the DamageClaim type's damageclaim section");
  });

  it('says nothing once the text is there, or for a type with a metadata layout', () => {
    const labels = { labels: { 'layout.schema.damageclaim': 'Damage claim' } };
    expect(
      schemaHeadingWarnings(
        files({ 'content-model.json': MODEL, [`${CONFIG}/labels/en.json`]: labels }),
      ),
    ).toEqual([]);
    expect(
      schemaHeadingWarnings(
        files({
          'content-model.json': MODEL,
          [`${CONFIG}/labels/en.json`]: { labels: { 'layout.schema.damageclaim': ' ' } },
          [`${CONFIG}/layouts/DamageClaim/metadata.layout.json`]: { version: 1 },
        }),
      ),
    ).toEqual([]);
  });

  it("says nothing for a package on a server's model, which ships none of its own", () => {
    expect(schemaHeadingWarnings(files({ [`${CONFIG}/labels/en.json`]: { labels: {} } }))).toEqual(
      [],
    );
    // A content-model.json with no type of the package's own behind it describes a server.
    expect(
      schemaHeadingWarnings(
        files({ 'content-model.json': MODEL, [`${CONFIG}/labels/en.json`]: { labels: {} } }, false),
      ),
    ).toEqual([]);
  });

  it("presents the schemas the Properties panel presents, as document-layouts' own list", () => {
    const source = readFileSync(
      join(REPO_ROOT, 'libs', 'shared', 'document-layouts', 'src', 'lib', 'resolve-layout.ts'),
      'utf8',
    );
    const list = /export const PRESENTED_SCHEMAS[^=]*= new Set\(\[([\s\S]*?)\]\)/.exec(source);
    if (!list) throw new Error('resolve-layout.ts has no PRESENTED_SCHEMAS');
    const theirs = [...list[1].matchAll(/'([^']+)'/g)].map(([, name]) => name);
    expect(theirs.length).toBeGreaterThan(0);
    expect([...PRESENTED_SCHEMAS].sort()).toEqual(theirs.sort());
  });

  it('finds every kit under business-apps/packages/ with its headings written, as the spec does', () => {
    const kits = join(REPO_ROOT, 'business-apps', 'packages');
    const found = readdirSync(kits).filter((kit) =>
      existsSync(join(kits, kit, CONFIG, 'app.json')),
    );
    expect(found).toContain('moves-demo');
    for (const kit of found) {
      const read = (path: string): string | undefined => {
        try {
          return readFileSync(join(kits, kit, ...path.split('/')), 'utf8');
        } catch {
          return undefined;
        }
      };
      expect(schemaHeadingWarnings(read), kit).toEqual([]);
    }
  });
});
