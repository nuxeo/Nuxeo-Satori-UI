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

const installXml = (file = '${package.root}/install/bundles', todir = '${env.bundles}') =>
  file === null
    ? '<install>\n</install>\n'
    : `<install>\n  <update file="${file}" todir="${todir}" />\n</install>\n`;

const DEFAULTS_REQUIRE = '  <require>org.nuxeo.agentic.ui.config.defaults</require>\n';

const componentXml = ({
  require = true,
  requireText = DEFAULTS_REQUIRE,
  srcs = ['agentic-ui-config/bootstrap.json'],
  body = '',
  comment = '',
} = {}) =>
  '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
  (require ? requireText : '') +
  '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
  srcs
    .map((src) => `    <fragment name="acme-config" layer="bootstrap" src="${src}" />\n`)
    .join('') +
  body +
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

// ---- forms a valid package may take that an earlier version of this check rejected (PR #542
// review). Each of these builds cleanly through `build.mjs`, so failing it here would be a CI
// failure on a correct package — the one kind nobody can act on. ----

for (const [variant, requireText] of [
  [
    'whitespace before the closing bracket of both tags',
    '  <require >org.nuxeo.agentic.ui.config.defaults</require >\n',
  ],
  [
    'its text on its own indented line',
    '  <require>\n    org.nuxeo.agentic.ui.config.defaults\n  </require>\n',
  ],
  ['a tab around the text', '  <require>\torg.nuxeo.agentic.ui.config.defaults\t</require>\n'],
  [
    'CRLF line endings inside the element',
    '  <require>\r\n    org.nuxeo.agentic.ui.config.defaults\r\n  </require>\n',
  ],
]) {
  expectGreen(`a <require> with ${variant}`, {
    jar: jarFiles({ [COMPONENT]: componentXml({ requireText }) }),
  });
}

expectGreen('a fragment carrying its JSON inline, with no src at all', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: [],
      body:
        '    <fragment name="acme-config" layer="bootstrap">\n' +
        '      <json>{"branding":{"applicationTitle":"Acme"}}</json>\n' +
        '    </fragment>\n',
    }),
    'agentic-ui-config/bootstrap.json': undefined,
  }),
});

expectGreen('a layout contribution, which is a contribution like any other', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: [],
      body: '    <layout type="Claim" mode="view" src="agentic-ui-config/claim.layout.json" />\n',
    }),
    'agentic-ui-config/claim.layout.json': '{"fields":[]}',
  }),
});

expectGreen('a disabled fragment, whose src the server never resolves', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      body: '    <fragment name="defaults" layer="manifest" enabled="false" src="gone.json" />\n',
    }),
  }),
});

expectGreen('an install.xml that names the jar itself rather than its directory', {
  install: installXml(`\${package.root}/install/bundles/${NAME}.jar`),
});

expectGreen('an install.xml with other updates beside the one that deploys the bundle', {
  install:
    '<install>\n' +
    '  <update file="${package.root}/install/bundles" todir="${env.bundles}" />\n' +
    '  <update file="${package.root}/package.xml" todir="${env.data}" />\n' +
    '</install>\n',
});

// ---- second review round (PR #542): XML forms `build.mjs` reads and this did not ----

expectGreen('a processing instruction whose content looks like a contribution', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      comment: '',
      body: '    <?note <asset name="logo.svg" src="gone.svg" /> ?>\n',
    }),
  }),
});

expectGreen('a CDATA section whose text looks like a contribution', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      body: '    <![CDATA[ <asset name="logo.svg" src="gone.svg" /> ]]>\n',
    }),
  }),
});

expectGreen('an element name that merely begins with a contribution name', {
  jar: jarFiles({
    [COMPONENT]: componentXml({ body: '    <fragment-legacy src="gone.json" />\n' }),
  }),
});

expectGreen('an attribute value containing a greater-than sign', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: [],
      body:
        '    <fragment name="a&gt;b" layer="bootstrap" ' +
        'src="agentic-ui-config/bootstrap.json" />\n',
    }),
  }),
});

// Single-quoted attributes. XML gives both quote styles equal standing and `build.mjs` reads both
// — `/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g`. Reading only double quotes failed in both
// directions at once, so there is a control for each.
expectGreen('package.xml with single-quoted attributes', {
  pkg:
    "<package type='addon' name='acme-config' version='1.0.0'>\n" +
    '  <dependencies>\n    <package>nuxeo-agentic-ui:2026.0.2</package>\n  </dependencies>\n' +
    '</package>\n',
});

expectGreen('install.xml with single-quoted attributes', {
  install:
    '<install>\n' +
    "  <update file='${package.root}/install/bundles' todir='${env.bundles}' />\n" +
    '</install>\n',
});

expectGreen("a disabled entry written enabled='false', whose src the server never resolves", {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      body: '    <fragment name="defaults" layer="manifest" enabled=\'false\' src="gone.json" />\n',
    }),
  }),
});

expectRed(
  "a single-quoted src='…' naming a file the jar does not hold",
  {
    jar: jarFiles({
      [COMPONENT]: componentXml({
        srcs: [],
        body: '    <fragment name="acme-config" layer="bootstrap" src=\'gone.json\' />\n',
      }),
    }),
  },
  /names <fragment src="gone\.json">, which the jar does not hold/,
);

// A comma-separated `Nuxeo-Component` is a list, and `build.mjs` reads it as one. A customer whose
// package grew past JSON carries a second component beside the configuration one.
const SECOND = 'OSGI-INF/acme-operations.xml';
const unrelatedComponent =
  '<?xml version="1.0"?>\n<component name="acme.config.operations" version="1.0">\n' +
  '  <extension target="org.nuxeo.ecm.core.operation.OperationServiceComponent" point="operations">\n' +
  '    <operation class="com.acme.ExportClaim" />\n' +
  '  </extension>\n</component>\n';

expectGreen('two components, one contributing configuration and one unrelated', {
  jar: jarFiles({
    'META-INF/MANIFEST.MF': manifest(`${COMPONENT}, ${SECOND}`),
    [SECOND]: unrelatedComponent,
  }),
});

expectRed(
  'a second component path the jar does not hold',
  { jar: jarFiles({ 'META-INF/MANIFEST.MF': manifest(`${COMPONENT}, OSGI-INF/missing.xml`) }) },
  /names Nuxeo-Component OSGI-INF\/missing\.xml, which is not in the jar/,
);

expectRed(
  'of two components, the one that contributes configuration lacks the <require>',
  {
    jar: jarFiles({
      'META-INF/MANIFEST.MF': manifest(`${COMPONENT}, ${SECOND}`),
      [COMPONENT]: componentXml({ require: false }),
      [SECOND]: unrelatedComponent,
    }),
  },
  new RegExp(`${COMPONENT.replaceAll('.', '\\.').replaceAll('/', '\\/')} does not <require>`),
);

expectRed(
  'two components and neither contributes anything',
  {
    jar: jarFiles({
      'META-INF/MANIFEST.MF': manifest(`${COMPONENT}, ${SECOND}`),
      [COMPONENT]: componentXml({ srcs: [] }),
      [SECOND]: unrelatedComponent,
    }),
  },
  /has no <fragment>, <layout> or <asset>/,
);

// ---- third review round (PR #542): attributes read whole, and contributions counted where the
// server would actually read them ----

expectGreen('a src naming its file through a character reference', {
  jar: jarFiles({
    [COMPONENT]: componentXml({ srcs: ['agentic-ui-config/bootstr&#97;p.json'] }),
  }),
});

expectGreen('a src padded with spaces, which is the same path', {
  jar: jarFiles({ [COMPONENT]: componentXml({ srcs: ['  agentic-ui-config/bootstrap.json  '] }) }),
});

expectGreen('an attribute whose name merely ends with one being looked for', {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: [],
      body:
        '    <fragment name="acme-config" layer="bootstrap" data-src="gone.json" ' +
        'src="agentic-ui-config/bootstrap.json" />\n',
    }),
  }),
});

// Single quotes inside a double-quoted value are ordinary characters, so this is one attribute
// whose value happens to read like another. An unanchored search finds the inner one first.
expectGreen("another attribute's value that literally contains src='…'", {
  jar: jarFiles({
    [COMPONENT]: componentXml({
      srcs: [],
      body:
        '    <fragment name="see src=\'gone.json\' here" layer="bootstrap" ' +
        'src="agentic-ui-config/bootstrap.json" />\n',
    }),
  }),
});

expectGreen('a dependency written with whitespace before the closing bracket', {
  pkg:
    '<package type="addon" name="acme-config" version="1.0.0">\n' +
    '  <dependencies>\n    <package >nuxeo-agentic-ui:2026.0.2</package>\n  </dependencies>\n' +
    '</package>\n',
});

// `enabled="tr&#117;e"` is enabled. Read literally it is a disabled entry, and a disabled entry's
// `src` is never resolved — so this was a silent miss, not a visible failure.
expectRed(
  'an enabled attribute written with a character reference, over a src the jar does not hold',
  {
    jar: jarFiles({
      [COMPONENT]: componentXml({
        srcs: [],
        body:
          '    <fragment name="acme-config" layer="bootstrap" enabled="tr&#117;e" ' +
          'src="gone.json" />\n',
      }),
    }),
  },
  /names <fragment src="gone\.json">, which the jar does not hold/,
);

// The count decides whether the package configures anything, so it has to be taken where the
// server would read it. A fragment under a mistyped target or point registers nothing.
const underExtension = (attrs, inner) =>
  '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
  DEFAULTS_REQUIRE +
  `  <extension ${attrs}>\n${inner}  </extension>\n</component>\n`;

const FRAGMENT =
  '    <fragment name="acme-config" layer="bootstrap" src="agentic-ui-config/bootstrap.json" />\n';

expectRed(
  'a fragment under an extension targeting something else',
  {
    jar: jarFiles({
      [COMPONENT]: underExtension('target="org.nuxeo.ecm.other" point="configuration"', FRAGMENT),
    }),
  },
  /has no <fragment>, <layout> or <asset>/,
);

expectRed(
  'a fragment under the right target but a point that does not exist',
  {
    jar: jarFiles({
      [COMPONENT]: underExtension(
        'target="org.nuxeo.agentic.ui.config" point="configurations"',
        FRAGMENT,
      ),
    }),
  },
  /has no <fragment>, <layout> or <asset>/,
);

expectGreen('a fragment under the Satori configuration extension, beside an unrelated one', {
  jar: jarFiles({
    [COMPONENT]:
      '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
      DEFAULTS_REQUIRE +
      '  <extension target="org.nuxeo.ecm.core.event.EventServiceComponent" point="listener">\n' +
      '    <listener name="acme" class="com.acme.Listener" />\n' +
      '  </extension>\n' +
      '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
      FRAGMENT +
      '  </extension>\n</component>\n',
  }),
});

// ---- fourth review round (PR #542): self-closing extensions, and components over 1 MiB ----

// A self-closing `<extension … />` has no `</extension>` of its own. A matcher that pairs the two
// in one expression reaches past it to the next extension's closing tag, which breaks both ways.
const EMPTY_UNRELATED =
  '  <extension target="org.nuxeo.ecm.core.event.EventServiceComponent" point="listener" />\n';
const EMPTY_SATORI = '  <extension target="org.nuxeo.agentic.ui.config" point="configuration" />\n';
const UNRELATED_WITH_FRAGMENTS =
  '  <extension target="org.nuxeo.ecm.other" point="configuration">\n' +
  '    <fragment name="acme-config" layer="bootstrap" src="agentic-ui-config/bootstrap.json" />\n' +
  '  </extension>\n';
const SATORI_WITH_FRAGMENT =
  '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
  '    <fragment name="acme-config" layer="bootstrap" src="agentic-ui-config/bootstrap.json" />\n' +
  '  </extension>\n';
const componentOf = (inner) =>
  '<?xml version="1.0"?>\n<component name="acme.config.acme-config" version="1.0">\n' +
  DEFAULTS_REQUIRE +
  inner +
  '</component>\n';

expectGreen('an empty self-closing unrelated extension before a valid Satori one', {
  jar: jarFiles({ [COMPONENT]: componentOf(EMPTY_UNRELATED + SATORI_WITH_FRAGMENT) }),
});

expectRed(
  'an empty self-closing Satori extension before an unrelated one that has fragments',
  { jar: jarFiles({ [COMPONENT]: componentOf(EMPTY_SATORI + UNRELATED_WITH_FRAGMENTS) }) },
  /has no <fragment>, <layout> or <asset>/,
);

expectGreen('two self-closing Satori extensions around one that contributes', {
  jar: jarFiles({
    [COMPONENT]: componentOf(EMPTY_SATORI + SATORI_WITH_FRAGMENT + EMPTY_SATORI),
  }),
});

// `spawnSync`'s default output limit is 1 MiB and it truncates in silence. `build.mjs` allows a
// fragment of up to 1 MiB, so two large inline ones are a valid component well over that limit;
// truncated, its closing tags are cut off and it reads as malformed.
const bigFragment = (name) =>
  `    <fragment name="${name}" layer="bootstrap">\n` +
  `      <json>{"branding":{"applicationTitle":"${'A'.repeat(700 * 1024)}"}}</json>\n` +
  '    </fragment>\n';

expectGreen('a component whose inline fragments exceed the default child-output limit', {
  jar: jarFiles({
    [COMPONENT]: componentOf(
      '  <extension target="org.nuxeo.agentic.ui.config" point="configuration">\n' +
        bigFragment('acme-one') +
        bigFragment('acme-two') +
        '  </extension>\n',
    ),
    'agentic-ui-config/bootstrap.json': undefined,
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

// The gap the PR #542 review found: every path resolving is not the same as the bundle reaching
// the one directory Nuxeo scans. Both of these install cleanly and contribute nothing.
expectRed(
  'an install.xml that resolves, but copies only package.xml and never the bundle',
  { install: installXml('${package.root}/package.xml', '${env.data}') },
  /no <update> that copies install\/bundles\/.*\.jar into todir="\$\{env\.bundles\}"/,
);

expectRed(
  'an install.xml that copies the bundle to ${env.data} instead of ${env.bundles}',
  { install: installXml('${package.root}/install/bundles', '${env.data}') },
  /only into \$\{env\.data\}\. Nuxeo loads bundles from there and nowhere else/,
);

expectRed(
  'an install.xml whose update has no file= at all',
  { install: '<install>\n  <update todir="${env.bundles}" />\n</install>\n' },
  /an <update> with no file= attribute/,
);

expectRed(
  'a contribution src that resolves nowhere, on an entry that is explicitly enabled',
  {
    jar: jarFiles({
      [COMPONENT]: componentXml({
        srcs: [],
        body: '    <fragment name="acme-config" layer="bootstrap" enabled="true" src="gone.json" />\n',
      }),
    }),
  },
  /names <fragment src="gone\.json">, which the jar does not hold/,
);

expectRed(
  'a component with no contribution of any kind',
  { jar: jarFiles({ [COMPONENT]: componentXml({ srcs: [] }) }) },
  /has no <fragment>, <layout> or <asset>/,
);

// `\s` would accept this; XML does not. A start tag may be separated only by space, tab, CR or LF.
expectRed(
  'a <require> separated by a non-breaking space, which is not XML whitespace',
  {
    jar: jarFiles({
      [COMPONENT]: componentXml({
        requireText: '  <require\u00a0>org.nuxeo.agentic.ui.config.defaults</require>\n',
      }),
    }),
  },
  /does not <require> org\.nuxeo\.agentic\.ui\.config\.defaults/,
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
  /names <fragment src="agentic-ui-config\/bootstrap\.jsno">, which the jar does not hold/,
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
