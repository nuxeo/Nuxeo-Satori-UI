import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_BOOTSTRAP_CONFIG } from './bootstrap-config';
import { DEFAULT_APP_RUNTIME_MANIFEST } from './runtime-manifest';

/**
 * The JSON schemas the `config-package` generator writes into every customer package.
 *
 * They refuse unknown keys, because the application ignores one silently and a typo would
 * otherwise ship as a change that does nothing. That makes a key added here and not there worse
 * than a gap: a customer's editor would mark the new, valid key as an error. So the schemas are
 * held to the defaults, which name every key the merge functions read.
 */
const SCHEMAS = resolve(
  __dirname,
  '../../../../../tools/satori-generators/src/config-package/files/schema',
);

interface Schema {
  $ref?: string;
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  definitions?: Record<string, Schema>;
}

function schema(name: string): Schema {
  return JSON.parse(readFileSync(resolve(SCHEMAS, `${name}.schema.json__tmpl__`), 'utf8'));
}

/** Follow a local `#/definitions/…` reference, the only kind these schemas use within a file. */
function deref(root: Schema, node: Schema): Schema {
  const name = node.$ref?.startsWith('#/definitions/') ? node.$ref.slice(14) : undefined;
  return name ? (root.definitions?.[name] ?? {}) : node;
}

const keys = (value: object = {}, except: string[] = []) =>
  Object.keys(value)
    .filter((key) => !except.includes(key))
    .sort();

describe('the configuration package schemas', () => {
  const bootstrap = schema('bootstrap');
  const manifest = schema('manifest');

  it('list every bootstrap key the application reads, and no other', () => {
    // `presales` is read by `readPresales`, not merged, so it has no default.
    expect(keys(bootstrap.properties, ['$schema', 'presales'])).toEqual(
      keys(DEFAULT_APP_BOOTSTRAP_CONFIG),
    );
    for (const section of ['branding', 'integrations', 'session', 'sso'] as const) {
      const definition = deref(bootstrap, bootstrap.properties?.[section] ?? {});
      expect(keys(definition.properties), section).toEqual(
        keys(DEFAULT_APP_BOOTSTRAP_CONFIG[section]),
      );
    }
  });

  it('hold a preset to the same keys as a fragment', () => {
    const preset = bootstrap.properties?.['presales']?.properties?.['presets']
      ?.additionalProperties as Schema;
    const overlay = deref(bootstrap, preset.properties?.['bootstrap'] ?? {});
    expect(overlay.additionalProperties).toBe(false);
    expect(keys(overlay.properties)).toEqual(keys(DEFAULT_APP_BOOTSTRAP_CONFIG));
    expect(preset.properties?.['manifest']?.$ref).toBe('manifest.schema.json');
  });

  it('list every manifest key the application reads, and no other', () => {
    // `extensions` is the source key that becomes `extensionLayers` once merged.
    expect(keys(manifest.properties, ['$schema', 'extensions'])).toEqual(
      keys(DEFAULT_APP_RUNTIME_MANIFEST, ['extensionLayers']),
    );
  });
});
