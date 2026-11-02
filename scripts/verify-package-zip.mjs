#!/usr/bin/env node
/**
 * Check that a configuration package zip is the shape `nuxeoctl mp-install` requires.
 *
 *   node scripts/verify-package-zip.mjs <zip>
 *
 * `build.mjs` writes zip records, CRC-32s and deflate streams by hand, and it checks the package
 * *source* thoroughly — but nothing reads back what it wrote. This does, with `unzip`, which is an
 * implementation that had no part in writing it: a CRC the writer computed and the writer verified
 * proves nothing about the bytes a third program will read.
 *
 * **What this asserts, exactly, so it is not read as more:** that the zip opens, that its entries
 * pass an independent integrity check, that `package.xml` and `install.xml` are where the
 * installer looks for them, that the package name and version the zip is named after are the ones
 * `package.xml` declares, that every path `install.xml` copies exists in the zip, and that the
 * bundle inside is a readable jar whose `Nuxeo-Component` and fragment `src` targets resolve to
 * entries that are actually in it.
 *
 * **What it does not assert.** It does not install anything. No Nuxeo server runs, so nothing here
 * says the server accepted the package, resolved its `nuxeo-agentic-ui` dependency, or served the
 * fragments. Proving that needs a server and a Marketplace account — the credentials this whole
 * path exists to avoid — so it is deliberately out of scope here and named rather than implied.
 * `beta-demo-runbook.md` is where a real install is exercised, by a person, against a real server.
 *
 * Exit 0 when the zip is well formed, 1 when it is not, 2 when the command line is wrong or
 * `unzip` is unavailable. `verify-package-zip.selftest.mjs` corrupts each property in turn and
 * requires this to go red for that property.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where `install.xml` refers to the root of the unpacked package. */
const PACKAGE_ROOT = '${package.root}/';

/** Run `unzip` and return its output; a non-zero exit is the caller's to interpret. */
function unzip(args) {
  const result = spawnSync('unzip', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { code: null, stdout: Buffer.alloc(0), text: '', error: result.error };
  return {
    code: result.status,
    stdout: result.stdout,
    text: `${result.stdout.toString('utf8')}\n${result.stderr.toString('utf8')}`,
  };
}

/** The entry names in an archive, as `unzip -Z1` lists them. */
function entriesOf(archive) {
  const { code, text } = unzip(['-Z1', archive]);
  if (code !== 0) return null;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * XML with its comments removed.
 *
 * The generated component file ships a commented-out `<asset>` as the example of how to add one,
 * so a scan that does not do this reports every package as naming an asset it does not hold — and
 * the mirror of that mistake is worse: a `<require>` someone commented out would satisfy the check
 * below while the server ignored it.
 *
 * Removed repeatedly, not once, which is `js/incomplete-multi-character-sanitization` and was
 * flagged by CodeQL on the single-pass version. One pass over `<!<!-- -->-- <require>…</require>
 * -->` removes the inner `<!-- -->` and leaves a residue that reads as a live `<require>` — the
 * exact false pass the paragraph above calls the worse mistake. Each pass can only shorten the
 * string, so the loop terminates.
 */
function withoutComments(xml) {
  let out = xml;
  let previous;
  do {
    previous = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
  } while (out !== previous);
  return out;
}

/** An attribute of the first element with this tag — enough for these two small, generated files. */
function attribute(xml, tag, name) {
  const element = new RegExp(`<${tag}\\b[^>]*>`).exec(xml)?.[0];
  return element ? (new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(element)?.[1] ?? null) : null;
}

/**
 * Check one package zip. Returns the problems; an empty array is a pass.
 *
 * Takes the archive apart in a temp directory rather than in place, so nothing here can write into
 * a workspace or follow a path out of the zip into one.
 */
export function verifyPackageZip(archive) {
  const problems = [];
  const problem = (message) => problems.push(message);

  if (!existsSync(archive)) return [`${archive} does not exist.`];

  // 1. Integrity, by a reader that did not write it. `-t` inflates every entry and compares the
  //    CRC-32 in the record with the one it computes.
  const integrity = unzip(['-t', archive]);
  if (integrity.error) {
    throw Object.assign(new Error(`unzip is not available: ${integrity.error.message}`), {
      usage: true,
    });
  }
  if (integrity.code !== 0) {
    return [`${archive} did not pass \`unzip -t\`:\n${integrity.text.trim()}`];
  }

  const entries = entriesOf(archive);
  if (entries === null) return [`${archive} could not be listed by \`unzip -Z1\`.`];

  // 2. The two files `nuxeoctl` reads, at the root of the package and nowhere else.
  for (const required of ['package.xml', 'install.xml']) {
    if (!entries.includes(required)) {
      problem(`${archive} has no ${required} at its root; the installer reads it from there.`);
    }
  }
  if (problems.length > 0) return problems;

  const read = (entry) => withoutComments(unzip(['-p', archive, entry]).stdout.toString('utf8'));
  const packageXml = read('package.xml');
  const installXml = read('install.xml');

  // 3. Name and version, and the file name built from them. `nuxeoctl` keys an upgrade on the
  //    pair in `package.xml`, so a zip named after a different pair misleads whoever ships it.
  const name = attribute(packageXml, 'package', 'name');
  const version = attribute(packageXml, 'package', 'version');
  const type = attribute(packageXml, 'package', 'type');
  if (!name || !version) {
    problem('package.xml declares no name= or no version= on its <package> element.');
  } else if (basename(archive) !== `${name}-${version}.zip`) {
    problem(
      `${basename(archive)} is named for neither the package name nor the version package.xml ` +
        `declares: expected ${name}-${version}.zip.`,
    );
  }
  if (type !== 'addon') {
    problem(
      `package.xml declares type="${type ?? '(none)'}"; a configuration package is an addon.`,
    );
  }
  if (!/<package>\s*nuxeo-agentic-ui:/.test(packageXml)) {
    problem(
      'package.xml does not depend on nuxeo-agentic-ui. Without it the server has no ' +
        'org.nuxeo.agentic.ui.config.defaults to register after, and the bundle fails to start.',
    );
  }

  // 4. Everything `install.xml` copies has to be in the zip, or the install copies nothing and
  //    reports success. `file` may name a directory, so an entry *under* it counts.
  const updates = [...installXml.matchAll(/<update\b[^>]*\bfile\s*=\s*"([^"]*)"/g)].map(
    ([, value]) => value,
  );
  if (updates.length === 0) {
    problem('install.xml has no <update file="…">, so installing the package copies nothing.');
  }
  for (const value of updates) {
    if (!value.startsWith(PACKAGE_ROOT)) {
      problem(`install.xml copies "${value}", which is not under ${PACKAGE_ROOT}.`);
      continue;
    }
    const path = value.slice(PACKAGE_ROOT.length);
    if (!entries.some((entry) => entry === path || entry.startsWith(`${path}/`))) {
      problem(`install.xml copies "${value}", and the zip holds no ${path}.`);
    }
  }

  // 5. The bundle itself. Everything above can hold while the jar is empty or unreadable, in which
  //    case the package installs, starts nothing, and contributes no configuration.
  const jars = entries.filter(
    (entry) => entry.startsWith('install/bundles/') && entry.endsWith('.jar'),
  );
  if (jars.length !== 1) {
    problem(
      `the zip holds ${jars.length} jar(s) under install/bundles/; a configuration package has one.`,
    );
    return problems;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'verify-package-zip-'));
  try {
    if (unzip(['-o', '-q', archive, jars[0], '-d', scratch]).code !== 0) {
      problem(`${jars[0]} could not be extracted from the zip.`);
      return problems;
    }
    const jar = join(scratch, jars[0]);
    if (unzip(['-t', jar]).code !== 0) {
      problem(`${jars[0]} is not a readable jar.`);
      return problems;
    }
    const inJar = entriesOf(jar) ?? [];
    const manifest = 'META-INF/MANIFEST.MF';
    if (!inJar.includes(manifest)) {
      problem(`${jars[0]} has no ${manifest}, so Nuxeo does not load it as a bundle.`);
      return problems;
    }
    // Manifest headers wrap at 72 bytes with a leading space on the continuation; unwrapped here
    // because a long component path is exactly where that happens.
    const headers = spawnSync('unzip', ['-p', jar, manifest], { encoding: 'utf8' }).stdout.replace(
      /\r?\n /g,
      '',
    );
    const component = /^Nuxeo-Component:\s*(.+)$/m.exec(headers)?.[1]?.trim();
    if (!component) {
      problem(`${manifest} has no Nuxeo-Component header, so the bundle contributes nothing.`);
      return problems;
    }
    if (!inJar.includes(component)) {
      problem(`${manifest} names Nuxeo-Component ${component}, which is not in the jar.`);
      return problems;
    }

    // 6. The component's fragments and assets, resolved against the jar. `build.mjs` checks this
    //    against the source directory; this checks it against what was actually packaged.
    const componentXml = withoutComments(
      spawnSync('unzip', ['-p', jar, component], { encoding: 'utf8' }).stdout,
    );
    if (!componentXml.includes('<require>org.nuxeo.agentic.ui.config.defaults</require>')) {
      problem(
        `${component} does not <require> org.nuxeo.agentic.ui.config.defaults, so its fragments ` +
          "may register before Satori's own and lose to them.",
      );
    }
    const srcs = [...componentXml.matchAll(/<(?:fragment|asset)\b[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(
      ([, value]) => value,
    );
    if (srcs.length === 0) {
      problem(`${component} names no fragment src, so the package contributes no configuration.`);
    }
    for (const src of srcs) {
      if (!inJar.includes(posix.normalize(src))) {
        problem(`${component} names src="${src}", which the jar does not hold.`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive] = process.argv.slice(2);
  if (!archive) {
    console.error('Usage: node scripts/verify-package-zip.mjs <zip>');
    process.exit(2);
  }
  let problems;
  try {
    problems = verifyPackageZip(archive);
  } catch (error) {
    console.error(error.message);
    process.exit(error.usage ? 2 : 1);
  }
  if (problems.length > 0) {
    console.error(`${basename(archive)}: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }
  console.log(
    `${basename(archive)}: a well-formed Nuxeo Package — entries verified by unzip, package.xml ` +
      'and install.xml present and consistent, bundle jar readable and its component resolved.\n' +
      'Not asserted: that a Nuxeo server installed it. No server runs here.',
  );
}
