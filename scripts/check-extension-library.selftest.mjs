#!/usr/bin/env node
/**
 * Negative controls for `libs/platform/guardrails/check-extension-library.mjs`, the guardrail we
 * ship to customers.
 *
 * It is run against our own reference library on every gate and CI run, which proves it passes on
 * a good library — never that it can fail on a bad one. These fixtures are customer-shaped
 * libraries in a temp directory, each broken in one way and expected red for that reason, plus
 * good ones expected green. Started with check 6, the component-contribution checks; the older
 * checks' controls are the ones their own doc comments describe as "verified against this script".
 *
 * Usage: node scripts/check-extension-library.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const GUARDRAIL = resolve(
  import.meta.dirname,
  '../libs/platform/guardrails/check-extension-library.mjs',
);
const failures = [];
let negative = 0;
let positive = 0;

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'customer-guardrail-selftest-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const result = spawnSync(process.execPath, [GUARDRAIL, dir], { encoding: 'utf8' });
    return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectRed(label, files, reason) {
  negative += 1;
  const { code, out } = run(files);
  if (code === 0) failures.push(`${label}: passed, but the library is broken on purpose.`);
  else if (!reason.test(out))
    failures.push(`${label}: failed, not for /${reason.source}/:\n${out}`);
}

function expectGreen(label, files, also) {
  positive += 1;
  const { code, out } = run(files);
  if (code !== 0) failures.push(`${label}: failed on a correct library:\n${out}`);
  else if (also && !also.test(out))
    failures.push(`${label}: passed, but without /${also.source}/:\n${out}`);
}

const panel = ({
  selector = 'acme-claims',
  className = 'AcmeClaimsComponent',
  implementsClause = '',
} = {}) =>
  "import { Component } from '@angular/core';\n" +
  `@Component({ selector: '${selector}', standalone: true, templateUrl: './claims.html' })\n` +
  `export class ${className}${implementsClause} {}\n`;

const extensions = (entry) =>
  "import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';\n" +
  'export const provideAcme = () =>\n' +
  '  provideSatoriExtensions({\n' +
  "    rules: { 'acme.rules.isLegal': () => false },\n" +
  "    failClosedRules: ['acme.rules.isLegal'],\n" +
  `    components: {\n      ${entry}\n    },\n` +
  '  });\n';

const LAZY =
  "'acme.panel.claims': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),";

const library = (overrides = {}) => ({
  'src/index.ts': "export { provideAcme } from './lib/extensions';\n",
  'src/lib/extensions.ts': extensions(LAZY),
  'src/lib/claims/claims.ts': panel(),
  'src/lib/extensions.spec.ts':
    "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
    "it('registers', () => expect(registry(ExtensionComponentRegistry).has('acme.panel.claims')).toBe(true));\n",
  ...overrides,
});

// ---------------------------------------------------------------- positives ----

expectGreen(
  'a lazily registered, tested, prefixed component',
  library(),
  /1 component registration\(s\)/,
);

expectGreen(
  'an eagerly registered component imported from a relative path',
  library({
    'src/lib/extensions.ts':
      "import { AcmeClaimsComponent } from './claims/claims';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'a component registered under a computed key and named by that key in a spec',
  library({
    'src/lib/extensions.ts':
      "export const IDS = { components: ['acme.panel.claims'] } as const;\n" +
      extensions(
        "[IDS.components[0]]: () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
      ),
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('registers', () => expect(r(ExtensionComponentRegistry).has(IDS.components[0])).toBe(true));\n",
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'an override of nxs.primitives.tag that implements NxsTagInputs',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      "import type { NxsTagInputs } from '@nuxeo-satori/platform/components';\n" +
      panel({ implementsClause: ' implements NxsTagInputs' }),
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('overrides', () => expect(r(ExtensionComponentRegistry).peek('nxs.primitives.tag')).toBe(AcmeClaimsComponent));\n",
  }),
);

const overrideSpec = (id) =>
  "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
  `it('overrides', () => expect(r(ExtensionComponentRegistry).peek('${id}')).toBe(AcmeClaimsComponent));\n`;
const TAG_CONTRACT = "import type { NxsTagInputs } from '@nuxeo-satori/platform/components';\n";

/** A library whose only ID is a platform primitive it overrides: no `acme.` ID to infer from. */
const primitiveOnly = (claims) => ({
  'src/index.ts': "export { provideAcme } from './lib/extensions';\n",
  'src/lib/extensions.ts':
    "import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';\n" +
    'export const provideAcme = () =>\n' +
    '  provideSatoriExtensions({\n' +
    "    components: { 'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent) },\n" +
    '  });\n',
  'src/lib/claims/claims.ts': claims,
  'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
});

expectGreen(
  'a library that only overrides a primitive keeps its own selector prefix',
  primitiveOnly(
    TAG_CONTRACT + panel({ selector: 'acme-tag', implementsClause: ' implements NxsTagInputs' }),
  ),
  /1 component registration\(s\)/,
);

expectGreen(
  'an eager registration of a default-imported class is warned about, not skipped',
  library({
    'src/lib/extensions.ts':
      "import AcmeClaimsComponent from './claims/claims';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
  }),
  /registers the component 'acme\.panel\.claims' in a shape this check does not read/,
);

expectGreen(
  'an eager registration of a class declared in the same file is warned about, not skipped',
  library({
    'src/lib/extensions.ts':
      'class AcmeInlineComponent {}\n' + extensions("'acme.panel.claims': AcmeInlineComponent,"),
  }),
  /registers the component 'acme\.panel\.claims' in a shape this check does not read/,
);

const BARREL_LAZY =
  "'acme.panel.claims': () => import('./claims').then((m) => m.AcmeClaimsComponent),";

expectGreen(
  'a lazy import of a barrel that re-exports the class',
  library({
    'src/lib/extensions.ts': extensions(BARREL_LAZY),
    'src/lib/claims/index.ts': "export { AcmeClaimsComponent } from './claims';\n",
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  "an eager import through a barrel's `export *`",
  library({
    'src/lib/extensions.ts':
      "import { AcmeClaimsComponent } from './claims';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
    'src/lib/claims/index.ts': "export * from './claims';\n",
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'an eager import under an alias',
  library({
    'src/lib/extensions.ts':
      "import { ClaimsPanelComponent as AcmeClaimsComponent } from './claims/claims';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
    'src/lib/claims/claims.ts': panel({ className: 'ClaimsPanelComponent' }),
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'a components object with plain keys is not read as registrations',
  library({
    'src/lib/layout.ts':
      "import { AcmeHeaderComponent } from './header';\n" +
      'export const LAYOUT = { components: { header: AcmeHeaderComponent } };\n',
    'src/lib/header.ts': panel({ selector: 'app-header', className: 'AcmeHeaderComponent' }),
  }),
  /1 component registration\(s\)/,
);

const component = (className, selector, implementsClause = '') =>
  `@Component({ selector: '${selector}', standalone: true, templateUrl: './claims.html' })\n` +
  `export class ${className}${implementsClause} {}\n`;
const ANGULAR = "import { Component } from '@angular/core';\n";

expectGreen(
  "the registered class's own selector, not one declared above it",
  library({
    'src/lib/claims/claims.ts':
      ANGULAR +
      component('NxsLookalikeComponent', 'nxs-lookalike') +
      component('AcmeClaimsComponent', 'acme-claims'),
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'a component with no selector, which the outlet can still create',
  library({
    'src/lib/claims/claims.ts':
      ANGULAR +
      "@Component({ standalone: true, templateUrl: './claims.html' })\n" +
      'export class AcmeClaimsComponent {}\n',
  }),
  /1 component registration\(s\)/,
);

expectGreen(
  'an override implementing the platform contract under an alias',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      "import type { NxsTagInputs as PlatformTagInputs } from '@nuxeo-satori/platform/components';\n" +
      ANGULAR +
      component('AcmeClaimsComponent', 'acme-claims', ' implements PlatformTagInputs'),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
);

expectGreen(
  'an override implementing the platform contract through a namespace import',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      "import type * as platform from '@nuxeo-satori/platform/components';\n" +
      ANGULAR +
      component('AcmeClaimsComponent', 'acme-claims', ' implements platform.NxsTagInputs'),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
);

// ---------------------------------------------------------------- negatives ----

const specNaming = (body) =>
  "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" + body;

expectRed(
  'a spec naming only a longer ID that begins with the registered one',
  library({
    'src/lib/extensions.spec.ts': specNaming(
      "it('registers', () => expect(r(ExtensionComponentRegistry).has('acme.panel.claimsExtra')).toBe(true));\n",
    ),
  }),
  /registers 'acme\.panel\.claims' \(`AcmeClaimsComponent`\), and no spec names it/,
);

expectRed(
  'a spec naming only a longer class that begins with the registered one',
  library({
    'src/lib/extensions.spec.ts': specNaming(
      'class AcmeClaimsComponentFake {}\n' +
        "it('overrides', () => expect(r(ExtensionComponentRegistry).peek('acme.other.thing')).toBe(AcmeClaimsComponentFake));\n",
    ),
  }),
  /and no spec names it/,
);

expectRed(
  "a spec naming only a longer expression that ends with the registration's key",
  library({
    'src/lib/extensions.ts':
      "export const IDS = { components: ['acme.panel.claims'] } as const;\n" +
      extensions(
        "[IDS.components[0]]: () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
      ),
    'src/lib/extensions.spec.ts': specNaming(
      "it('registers', () => expect(r(ExtensionComponentRegistry).has(OTHER_IDS.components[0])).toBe(true));\n",
    ),
  }),
  /and no spec names it/,
);

expectRed(
  'a registered class with no @Component',
  library({ 'src/lib/claims/claims.ts': 'export class AcmeClaimsComponent {}\n' }),
  /as `AcmeClaimsComponent`, which .*claims\.ts declares without `@Component`/,
);

expectRed(
  'a registered class with no @Component, below a decorated one',
  library({
    'src/lib/claims/claims.ts':
      ANGULAR +
      component('AcmeOtherComponent', 'acme-other') +
      'export class AcmeClaimsComponent {}\n',
  }),
  /declares without `@Component`/,
);

expectRed(
  "a platform selector on the registered class, an owner's on one declared above it",
  library({
    'src/lib/claims/claims.ts':
      ANGULAR +
      component('AcmeHelperComponent', 'acme-helper') +
      component('AcmeClaimsComponent', 'nxs-claims'),
  }),
  /declares selector `nxs-claims`\. Use your owner prefix, `acme-`/,
);

expectRed(
  'an override that aliases the platform contract away and implements a local same-named one',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      "import type { NxsTagInputs as PlatformTagInputs } from '@nuxeo-satori/platform/components';\n" +
      'interface NxsTagInputs {}\n' +
      ANGULAR +
      component('AcmeClaimsComponent', 'acme-claims', ' implements NxsTagInputs'),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
  /does not implement `NxsTagInputs` from '@nuxeo-satori\/platform\/components'/,
);

expectRed(
  'a typed contributions constant in a file of its own, with a wrong path',
  library({
    'src/lib/contributions.ts':
      "import type { SatoriExtensionContributions } from '@nuxeo-satori/platform/extensions';\n" +
      'export const ACME_CONTRIBUTIONS: SatoriExtensionContributions = {\n' +
      "  rules: { 'acme.rules.isLegal': () => false },\n" +
      "  failClosedRules: ['acme.rules.isLegal'],\n" +
      "  components: { 'acme.panel.claims': () => import('./claim/claims').then((m) => m.AcmeClaimsComponent) },\n" +
      '};\n',
    'src/lib/extensions.ts':
      "import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';\n" +
      "import { ACME_CONTRIBUTIONS } from './contributions';\n" +
      'export const provideAcme = () => provideSatoriExtensions(ACME_CONTRIBUTIONS);\n',
  }),
  /contributions\.ts registers 'acme\.panel\.claims' from '\.\/claim\/claims', which is not a file/,
);

expectRed(
  'a component re-exported through a barrel, under the platform selector prefix',
  library({
    'src/lib/extensions.ts': extensions(BARREL_LAZY),
    'src/lib/claims/index.ts': "export { AcmeClaimsComponent } from './claims';\n",
    'src/lib/claims/claims.ts': panel({ selector: 'nxs-claims' }),
  }),
  /claims\/claims\.ts declares selector `nxs-claims`/,
);

expectRed(
  'an aliased import of a name the file does not export',
  library({
    'src/lib/extensions.ts':
      "import { AcmeClaimComponent as AcmeClaimsComponent } from './claims/claims';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
  }),
  /as `AcmeClaimComponent`, which .*claims\.ts does not export/,
);

expectRed(
  'a barrel that re-exports the class as a type only',
  library({
    'src/lib/extensions.ts': extensions(BARREL_LAZY),
    'src/lib/claims/index.ts': "export type { AcmeClaimsComponent } from './claims';\n",
  }),
  /as `AcmeClaimsComponent`, which .*claims\/index\.ts does not export/,
);

expectRed(
  'a cycle of star re-exports that never reaches the class',
  library({
    'src/lib/extensions.ts': extensions(BARREL_LAZY),
    'src/lib/claims/index.ts': "export * from './more';\n",
    'src/lib/claims/more.ts': "export * from './index';\n",
  }),
  /as `AcmeClaimsComponent`, which .*claims\/index\.ts does not export/,
);

expectRed(
  'an override re-exported through a barrel that does not implement its contract',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/index.ts': "export { AcmeClaimsComponent } from './claims';\n",
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
  /but `AcmeClaimsComponent` does not implement `NxsTagInputs`/,
);

expectRed(
  'a library that only overrides a primitive, under the platform selector prefix',
  primitiveOnly(
    TAG_CONTRACT + panel({ selector: 'nxs-tag', implementsClause: ' implements NxsTagInputs' }),
  ),
  /declares selector `nxs-tag`\. Use your owner prefix:/,
);

expectRed(
  'an override implementing a same-named interface declared locally',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      'interface NxsTagInputs {}\n' + panel({ implementsClause: ' implements NxsTagInputs' }),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
  /does not implement `NxsTagInputs` from '@nuxeo-satori\/platform\/components'/,
);

expectRed(
  'an override implementing a same-named interface from another package',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      "import type { NxsTagInputs } from '@acme/design';\n" +
      panel({ implementsClause: ' implements NxsTagInputs' }),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag'),
  }),
  /does not implement `NxsTagInputs` from '@nuxeo-satori\/platform\/components'/,
);

expectRed(
  "an override of an ID that only begins with a primitive's",
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag.extra': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts':
      TAG_CONTRACT + panel({ implementsClause: ' implements NxsTagInputs' }),
    'src/lib/extensions.spec.ts': overrideSpec('nxs.primitives.tag.extra'),
  }),
  /the platform has no `nxs\.primitives\.tag\.extra` to override/,
);

expectRed(
  'a lazy import of a file that does not exist',
  library({
    'src/lib/extensions.ts': extensions(
      "'acme.panel.claims': () => import('./claim/claims').then((m) => m.AcmeClaimsComponent),",
    ),
  }),
  /registers 'acme\.panel\.claims' from '\.\/claim\/claims', which is not a file in this library/,
);

expectRed(
  'a lazy import naming a class the file does not export',
  library({
    'src/lib/extensions.ts': extensions(
      "'acme.panel.claims': () => import('./claims/claims').then((m) => m.AcmeClaimComponent),",
    ),
  }),
  /as `AcmeClaimComponent`, which .*claims\.ts does not export/,
);

expectRed(
  'a registered component no spec names',
  library({
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('has a registry', () => expect(ExtensionComponentRegistry).toBeDefined());\n",
  }),
  /registers 'acme\.panel\.claims' \(`AcmeClaimsComponent`\), and no spec names it/,
);

expectRed(
  'a component named only in a spec comment',
  library({
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "// TODO: assert 'acme.panel.claims' and AcmeClaimsComponent\n" +
      "it('has a registry', () => expect(ExtensionComponentRegistry).toBeDefined());\n",
  }),
  /and no spec names it/,
);

for (const prefix of ['nxs', 'lib', 'sat']) {
  expectRed(
    `a component selector under the platform's \`${prefix}-\` prefix`,
    library({ 'src/lib/claims/claims.ts': panel({ selector: `${prefix}-claims` }) }),
    new RegExp(`declares selector \`${prefix}-claims\`\\. Use your owner prefix, \`acme-\``),
  );
}

expectRed(
  'an override of nxs.primitives.tag that does not implement NxsTagInputs',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.tag': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('overrides', () => expect(r(ExtensionComponentRegistry).peek('nxs.primitives.tag')).toBe(AcmeClaimsComponent));\n",
  }),
  /overriding a platform primitive, but `AcmeClaimsComponent` does not implement `NxsTagInputs`/,
);

expectRed(
  'an override implementing the wrong primitive contract',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.avatar': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/claims/claims.ts': panel({ implementsClause: ' implements NxsTagInputs' }),
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('overrides', () => expect(r(ExtensionComponentRegistry).peek('nxs.primitives.avatar')).toBe(AcmeClaimsComponent));\n",
  }),
  /does not implement `NxsAvatarInputs`/,
);

expectRed(
  'an override of a primitive the platform does not have',
  library({
    'src/lib/extensions.ts': extensions(
      "'nxs.primitives.chip': () => import('./claims/claims').then((m) => m.AcmeClaimsComponent),",
    ),
    'src/lib/extensions.spec.ts':
      "import { ExtensionComponentRegistry } from '@nuxeo-satori/platform/extensions';\n" +
      "it('overrides', () => expect(r(ExtensionComponentRegistry).has('nxs.primitives.chip')).toBe(true));\n",
  }),
  /the platform has no `nxs\.primitives\.chip` to override/,
);

expectRed(
  'an eager registration whose import names a missing file',
  library({
    'src/lib/extensions.ts':
      "import { AcmeClaimsComponent } from './claims/missing';\n" +
      extensions("'acme.panel.claims': AcmeClaimsComponent,"),
  }),
  /from '\.\/claims\/missing', which is not a file in this library/,
);

// ------------------------------------------------------------------- report ----

console.log(
  `check-extension-library selftest: ${negative + positive} controls — ${negative} negative ` +
    `(a broken library must go red, for the stated reason), ${positive} positive.`,
);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
