#!/usr/bin/env node
/**
 * Negative controls for `verify-package-zip.mjs`.
 *
 * That script runs in CI on packages `build.mjs` just wrote, which are correct, so every run of it
 * is green — and a check only ever seen green is an assertion. These fixtures are packages broken
 * in one way each, and every one is required to go red for its own reason, so a check that stopped
 * looking at a property is caught here rather than the first time a customer's package is wrong.
 *
 * The fixtures are written by the small store-only zip writer below rather than by `build.mjs`,
 * because most of these shapes are ones `build.mjs` refuses to produce — which is the point: this
 * check exists for packages that did not come from it, and for the day it has a bug.
 *
 * Usage: node scripts/verify-package-zip.selftest.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { verifyPackageZip } from './verify-package-zip.mjs';

const failures = [];
let negative = 0;
let positive = 0;

// ------------------------------------------------------------ a zip writer ----
//
// Store-only (method 0): no deflate, so there is nothing here that could mask a problem in the
// writer under test. `unzip` reads stored entries exactly as it reads deflated ones.

const DOS_TIME = 0x6000; // 12:00:00
const DOS_DATE = 0x5a21; // 2025-01-01

/** A zip of `name -> Buffer|string`, written to `path`. An entry whose body is undefined is left out. */
function writeZip(path, files) {
  const present = Object.entries(files).filter(([, body]) => body !== undefined && body !== null);
  const entries = [];
  const locals = [];
  let offset = 0;
  for (const [name, body] of present) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(present.length, 8);
  end.writeUInt16LE(present.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, directory, end]));
}

// ---------------------------------------------------------------- fixtures ----

const NAME = 'acme-config';
const VERSION = '1.0.0';
const COMPONENT = 'OSGI-INF/acme-config-config.xml';

const packageXml = (overrides = {}) => {
  const {
    type = 'addon',
    name = NAME,
    version = VERSION,
    dependency = 'nuxeo-agentic-ui:2026.0.2',
  } = overrides;
  return (
    `<package type="${type}" name="${name}" version="${version}">\n` +
    `  <title>Acme</title>\n  <vendor>Acme</vendor>\n` +
    (dependency
      ? `  <dependencies>\n    <package>${dependency}</package>\n  </dependencies>\n`
      : '') +
    '</package>\n'
  );
};

const installXml = (file = '${package.root}/install/bundles') =>
  file === null
    ? '<install>\n</install>\n'
    : `<install>\n  <update file="${file}" todir="\${env.bundles}" />\n</install>\n`;

const componentXml = ({
  require = true,
  srcs = ['agentic-ui-config/bootstrap.json'],
  comment = '',
} = {}) =>
  '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
  (require ? '  <require>org.nuxeo.agentic.ui.config.defaults</require>\n' : '') +
  '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
  srcs
    .map((src) => `    <fragment name="acme-config" layer="bootstrap" src="${src}" />\n`)
    .join('') +
  (comment ? `    <!-- ${comment} -->\n` : '') +
  '  </extension>\n</component>\n';

const manifest = (component = COMPONENT, wrapped = false) =>
  'Manifest-Version: 1.0\nBundle-ManifestVersion: 1\nBundle-Name: acme-config\n' +
  (wrapped
    ? `Nuxeo-Component: ${component.slice(0, 8)}\n ${component.slice(8)}\n`
    : `Nuxeo-Component: ${component}\n`);

/** A jar as `build.mjs` packages it, with the given overrides applied to its entries. */
const jarFiles = (overrides = {}) => ({
  'META-INF/MANIFEST.MF': manifest(),
  [COMPONENT]: componentXml(),
  'agentic-ui-config/bootstrap.json': '{"applicationTitle":"Acme"}',
  ...overrides,
});

const scratch = mkdtempSync(join(tmpdir(), 'verify-package-zip-selftest-'));
let serial = 0;

/**
 * Write a package zip from the parts, apply `mutate` to the finished file, and verify it.
 * `jar: null` leaves the bundle out; `zipName` overrides the file name the check reads.
 */
function check({
  pkg = packageXml(),
  install = installXml(),
  jar = jarFiles(),
  jars,
  zipName,
  mutate,
}) {
  const dir = join(scratch, `case-${(serial += 1)}`);
  mkdirSync(dir, { recursive: true });
  const bundles = {};
  for (const [path, files] of Object.entries(
    jars ?? (jar ? { [`install/bundles/${NAME}.jar`]: jar } : {}),
  )) {
    const inner = join(dir, `${path.replaceAll('/', '_')}`);
    writeZip(inner, files);
    bundles[path] = readFileSync(inner);
  }
  const archive = join(dir, zipName ?? `${NAME}-${VERSION}.zip`);
  writeZip(archive, { 'package.xml': pkg, 'install.xml': install, ...bundles });
  if (mutate) mutate(archive);
  return verifyPackageZip(archive);
}

function expectRed(label, parts, reason) {
  negative += 1;
  const problems = check(parts);
  if (problems.length === 0)
    failures.push(`${label}: passed, but the package is broken on purpose.`);
  else if (!problems.some((p) => reason.test(p)))
    failures.push(`${label}: failed, not for /${reason.source}/:\n  ${problems.join('\n  ')}`);
}

function expectGreen(label, parts) {
  positive += 1;
  const problems = check(parts);
  if (problems.length > 0)
    failures.push(`${label}: failed on a well-formed package:\n  ${problems.join('\n  ')}`);
}

// ---------------------------------------------------------------- positives ----

expectGreen('a well-formed configuration package', {});

expectGreen('a Nuxeo-Component header wrapped across two lines, as the jar tool writes it', {
  jar: jarFiles({ 'META-INF/MANIFEST.MF': manifest(COMPONENT, true) }),
});

expectGreen('a component naming an asset as well as a fragment', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: ['agentic-ui-config/bootstrap.json', 'agentic-ui-config/assets/logo.svg'],
    }),
    'agentic-ui-config/assets/logo.svg': '<svg/>',
  }),
});

// The generated component ships exactly this: a commented-out `<asset>` showing how to add one.
// Read as live, it fails every correct package — which is how this control came to exist.
expectGreen('a commented-out asset, which the generator writes as the example', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      comment: '<asset name="logo.svg" src="agentic-ui-config/assets/logo.svg" />',
    }),
  }),
});

// ---------------------------------------------------------------- negatives ----

expectRed(
  'a <require> that is commented out, which the server does not act on either',
  {
    jar: jarFiles({
      [COMPONENT]: componentXml({
        require: false,
        comment: '<require>org.nuxeo.agentic.ui.config.defaults</require>',
      }),
    }),
  },
  /does not <require> org\.nuxeo\.agentic\.ui\.config\.defaults/,
);

// Removing comments in one pass leaves a residue here that reads as a live `<require>`:
// `<!<!-- -->-- …` loses the inner `<!-- -->` and the remainder begins `<!--`. CodeQL names the
// class (`js/incomplete-multi-character-sanitization`); this is what it costs in this script.
expectRed(
  'a <require> hidden inside a comment that a single stripping pass would reassemble',
  {
    jar: jarFiles({
      [COMPONENT]:
        '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
        '  <!<!-- -->-- <require>org.nuxeo.agentic.ui.config.defaults</require> -->\n' +
        '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        '    <fragment name="acme-config" layer="bootstrap" src="agentic-ui-config/bootstrap.json" />\n' +
        '  </extension>\n</component>\n',
    }),
  },
  /does not <require> org\.nuxeo\.agentic\.ui\.config\.defaults/,
);

expectRed(
  'a byte flipped inside an entry, which breaks its CRC',
  {
    mutate: (archive) => {
      const bytes = readFileSync(archive);
      // Inside package.xml's stored data: past the first local header and its name.
      bytes[60] ^= 0xff;
      writeFileSync(archive, bytes);
    },
  },
  /did not pass `unzip -t`/,
);

expectRed('no package.xml', { pkg: null }, /has no package\.xml/);
expectRed('no install.xml', { install: null }, /has no install\.xml/);

expectRed(
  'a zip named for a version package.xml does not declare',
  { zipName: `${NAME}-9.9.9.zip` },
  /named for neither the package name nor the version/,
);

expectRed(
  'a zip named for a package.xml name it does not declare',
  { zipName: `other-${VERSION}.zip` },
  /named for neither the package name nor the version/,
);

expectRed(
  'a package that is not an addon',
  { pkg: packageXml({ type: 'hotfix' }) },
  /a configuration package is an addon/,
);

expectRed(
  'a package that does not depend on nuxeo-agentic-ui',
  { pkg: packageXml({ dependency: null }) },
  /does not depend on nuxeo-agentic-ui/,
);

expectRed(
  'a package depending on something else entirely',
  { pkg: packageXml({ dependency: 'nuxeo-web-ui:2025.0.0' }) },
  /does not depend on nuxeo-agentic-ui/,
);

expectRed(
  'an install.xml that copies nothing',
  { install: installXml(null) },
  /installing the package copies nothing/,
);

expectRed(
  'an install.xml that copies a path the zip does not hold',
  { install: installXml('${package.root}/install/bundlez') },
  /the zip holds no install\/bundlez/,
);

expectRed(
  'an install.xml that copies from outside the package root',
  { install: installXml('/etc/nuxeo') },
  /which is not under \$\{package\.root\}/,
);

expectRed('no bundle jar at all', { jar: null }, /holds 0 jar\(s\) under install\/bundles/);

expectRed(
  'two bundle jars, so which one carries the configuration is not decided here',
  { jars: { 'install/bundles/a.jar': jarFiles(), 'install/bundles/b.jar': jarFiles() } },
  /holds 2 jar\(s\) under install\/bundles/,
);

expectRed(
  'a jar with no manifest',
  { jar: jarFiles({ 'META-INF/MANIFEST.MF': undefined }) },
  /has no META-INF\/MANIFEST\.MF/,
);

expectRed(
  'a manifest with no Nuxeo-Component header',
  {
    jar: jarFiles({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nBundle-Name: acme-config\n' }),
  },
  /no Nuxeo-Component header/,
);

expectRed(
  'a Nuxeo-Component naming a file that is not in the jar',
  { jar: jarFiles({ 'META-INF/MANIFEST.MF': manifest('OSGI-INF/missing.xml') }) },
  /names Nuxeo-Component OSGI-INF\/missing\.xml, which is not in the jar/,
);

expectRed(
  "a component that does not <require> Satori's defaults",
  { jar: jarFiles({ [COMPONENT]: componentXml({ require: false }) }) },
  /does not <require> org\.nuxeo\.agentic\.ui\.config\.defaults/,
);

expectRed(
  'a component naming a fragment src the jar does not hold',
  { jar: jarFiles({ [COMPONENT]: componentXml({ srcs: ['agentic-ui-config/bootstrap.jsno'] }) }) },
  /names src="agentic-ui-config\/bootstrap\.jsno", which the jar does not hold/,
);

expectRed(
  'a component with no fragment at all',
  { jar: jarFiles({ [COMPONENT]: componentXml({ srcs: [] }) }) },
  /names no fragment src/,
);

// ------------------------------------------------------------------- report ----

rmSync(scratch, { recursive: true, force: true });

console.log(
  `verify-package-zip selftest: ${negative + positive} controls — ${negative} negative ` +
    `(a broken package must go red, for the stated reason), ${positive} positive.`,
);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
