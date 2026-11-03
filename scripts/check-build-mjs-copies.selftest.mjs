#!/usr/bin/env node
/**
 * Negative controls for `check-build-mjs-copies.mjs`.
 *
 * On `main` the three copies match, so every run of that gate is green — which proves it passes on
 * an unbroken tree and never that it can fail on a broken one. A gate nobody has watched go red is
 * an assertion, not evidence. These fixtures are small trees in a temp directory, each diverged in
 * one way, and each is required to go red naming the copy that diverged and the file it diverged
 * from — not just "files differ".
 *
 * Usage: node scripts/check-build-mjs-copies.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PACKAGES, TEMPLATE } from './check-build-mjs-copies.mjs';

const GATE = resolve(import.meta.dirname, 'check-build-mjs-copies.mjs');
const failures = [];
let negative = 0;
let positive = 0;

/** A stand-in for the real script: the shape matters here, not the 850 lines. */
const SCRIPT = [
  '#!/usr/bin/env node',
  '/** Build this configuration package. */',
  'const MAX_JSON_BYTES = 1024 * 1024;',
  'const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;',
  'export function build() {}',
  '',
].join('\n');

/** A tree of `path -> contents`; `undefined` leaves the file out. */
function run(files) {
  const root = mkdtempSync(join(tmpdir(), 'build-mjs-copies-selftest-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      if (body === undefined) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    const result = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8' });
    return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectRed(label, files, reason) {
  negative += 1;
  const { code, out } = run(files);
  if (code === 0) failures.push(`${label}: passed, but the tree is diverged on purpose.`);
  else if (!reason.test(out))
    failures.push(`${label}: failed, not for /${reason.source}/:\n${out}`);
}

function expectGreen(label, files, also) {
  positive += 1;
  const { code, out } = run(files);
  if (code !== 0) failures.push(`${label}: failed on a tree whose copies match:\n${out}`);
  else if (also && !also.test(out))
    failures.push(`${label}: passed, but without /${also.source}/:\n${out}`);
}

/** The template plus one copy per named package, all identical unless an override says otherwise. */
const tree = (packages = ['presales-demo', 'satori-beta'], overrides = {}) => ({
  [TEMPLATE]: SCRIPT,
  ...Object.fromEntries(packages.map((name) => [`${PACKAGES}/${name}/build.mjs`, SCRIPT])),
  ...overrides,
});

// ---------------------------------------------------------------- positives ----

expectGreen('three identical copies', tree(), /2 copy\(ies\) match/);

expectGreen(
  'a package directory with no build.mjs is not counted as a copy',
  tree(['presales-demo', 'satori-beta'], { [`${PACKAGES}/notes/README.md`]: '# notes\n' }),
  /2 copy\(ies\) match/,
);

expectGreen(
  'a single copy still satisfies the check',
  tree(['presales-demo']),
  /1 copy\(ies\) match/,
);

// ---------------------------------------------------------------- negatives ----

expectRed(
  'one byte changed in one copy',
  tree(['presales-demo', 'satori-beta'], {
    [`${PACKAGES}/satori-beta/build.mjs`]: SCRIPT.replace('1024 * 1024', '2048 * 1024'),
  }),
  /config-packages\/satori-beta\/build\.mjs diverged from .*build\.mjs__tmpl__, first at line 3/,
);

expectRed(
  'the copy that diverged is named, and the one that did not is not',
  tree(['presales-demo', 'satori-beta'], {
    [`${PACKAGES}/satori-beta/build.mjs`]: SCRIPT.replace('1024 * 1024', '2048 * 1024'),
  }),
  /^(?:(?!presales-demo\/build\.mjs diverged)[\s\S])*$/,
);

expectRed(
  'a validation rule added to the template and not to the packages',
  tree(['presales-demo', 'satori-beta'], {
    [TEMPLATE]: SCRIPT.replace('export function', 'const MODE = /^[a-z]+$/;\nexport function'),
  }),
  /presales-demo\/build\.mjs diverged[\s\S]*satori-beta\/build\.mjs diverged/,
);

expectRed(
  'a trailing newline dropped from a copy',
  tree(['presales-demo'], { [`${PACKAGES}/presales-demo/build.mjs`]: SCRIPT.trimEnd() }),
  /presales-demo\/build\.mjs diverged[\s\S]*end of file/,
);

expectRed(
  'a copy with Windows line endings',
  tree(['presales-demo'], {
    [`${PACKAGES}/presales-demo/build.mjs`]: SCRIPT.replaceAll('\n', '\r\n'),
  }),
  /presales-demo\/build\.mjs diverged/,
);

expectRed(
  'an EJS tag in the template, which would make byte comparison the wrong question',
  tree(['presales-demo'], { [TEMPLATE]: `${SCRIPT}// <%= name %>\n` }),
  /carries an EJS tag[\s\S]*Teach this check to render/,
);

expectRed(
  'no config package at all, so the check would compare nothing',
  { [TEMPLATE]: SCRIPT },
  /compared nothing/,
);

expectRed(
  'a config-packages directory with no build script in it',
  { [TEMPLATE]: SCRIPT, [`${PACKAGES}/notes/README.md`]: '# notes\n' },
  /compared nothing/,
);

expectRed(
  'the template missing, so there is nothing to compare against',
  { [`${PACKAGES}/presales-demo/build.mjs`]: SCRIPT },
  /does not exist, so there is nothing to compare/,
);

// ------------------------------------------------------------------- report ----

console.log(
  `check-build-mjs-copies selftest: ${negative + positive} controls — ${negative} negative ` +
    `(a diverged copy must go red, naming it), ${positive} positive.`,
);
if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}
console.log('All controls behaved as required.');
