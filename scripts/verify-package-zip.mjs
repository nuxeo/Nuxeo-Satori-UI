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
 * `package.xml` declares, that every path `install.xml` copies exists in the zip and that one of
 * them deploys the bundle into `${env.bundles}`, and that the bundle is a readable jar whose
 * `Nuxeo-Component`, `<require>` and contribution `src` targets resolve to entries in it.
 *
 * **Where it stops, on purpose.** It does not check that a contribution with no `src` carries a
 * body: reading inline `<json>` means parsing element content, which `build.mjs` already does
 * properly against the source. This reads the packaged bytes for the things a build cannot see —
 * what survived into the zip, and whether the installer puts it where Nuxeo looks.
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

/** The only directory Nuxeo scans for bundles; `install.xml` names it through this variable. */
const BUNDLES_DIR = '${env.bundles}';

/**
 * XML whitespace, as the specification defines `S`: space, tab, CR, LF and nothing else.
 *
 * Used instead of `\s` deliberately. `\s` in JavaScript also matches U+00A0 and the other Unicode
 * spaces, which are **not** XML whitespace — `<require\u00a0>` is not a well-formed start tag, and
 * accepting it here would pass a component the server's parser refuses.
 */
const S = '[ \\t\\r\\n]*';

/** The component every configuration package must register after; `build.mjs` names it too. */
const DEFAULTS_COMPONENT = 'org.nuxeo.agentic.ui.config.defaults';

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
 * The body of a start tag, matched as XML rather than as "everything up to the next `>`".
 *
 * `[^>]*` ends a tag at the first `>`, including one inside a quoted attribute value, and would
 * read `<fragment name="a>b" src="x.json"/>` as a tag with no `src`. The lookahead stops
 * `<fragment-legacy` and `<assets` being read as `<fragment` and `<asset`, which `\b` does not.
 * This is the shape `build.mjs` matches its own contributions with; the two agree by construction.
 */
const TAG = '(?=[ \\t\\r\\n/>])((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>';

/**
 * XML without its comments and processing instructions, with CDATA sections kept whole.
 *
 * Three things a scan that looks only for comments gets wrong, all of them confirmed against
 * `build.mjs`, which strips exactly these before looking at anything:
 *
 * - The generated component ships a commented-out `<asset>` as the example of how to add one. Read
 *   as live, every correct package fails with a missing-asset error.
 * - A processing instruction's content is not markup. `<?note <asset src="gone.svg" /> ?>` is a
 *   valid component that the server contributes nothing from, and would fail the same way.
 * - Inside CDATA, `<!--` and `<?` are text. A section is therefore kept whole here and blanked by
 *   `withoutCdata` later, so markup is never matched inside character data and never stripped out
 *   of it either.
 *
 * Repeated until stable rather than scanned once. A single pass over
 * `<!<!-- -->-- <require>…</require> -->` removes the inner `<!-- -->` and leaves a residue that
 * reads as a live `<require>`, which is `js/incomplete-multi-character-sanitization` and is the
 * false pass that matters most here. `build.mjs` can scan once because it rejects malformed XML
 * first with a real parser; this script has no such parser, so the loop is its substitute. Each
 * pass can only shorten the string, so it terminates.
 *
 * The limit, stated rather than implied: on malformed XML the loop errs towards seeing *less*
 * markup. For the `<require>` and contribution checks that means reporting a problem, which is
 * safe. For resolving a `src` it means a check skipped. Malformed XML is refused by `build.mjs`
 * upstream and will not load on the server either, so this script is not the thing standing
 * between that package and a user.
 */
function withoutCommentsOrInstructions(xml) {
  const CLOSE = { '<!--': '-->', '<?': '?>', '<![CDATA[': ']]>' };
  const strip = (text) => {
    const next = /<!--|<\?|<!\[CDATA\[/g;
    let out = '';
    let at = 0;
    for (;;) {
      next.lastIndex = at;
      const match = next.exec(text);
      if (!match) return out + text.slice(at);
      const close = CLOSE[match[0]];
      const end = text.indexOf(close, match.index + match[0].length);
      const stop = end < 0 ? text.length : end + close.length;
      // A CDATA section is content: kept whole, and blanked later by `withoutCdata`.
      out += text.slice(at, match[0] === '<![CDATA[' ? stop : match.index);
      at = stop;
    }
  };
  let out = xml;
  let previous;
  do {
    previous = out;
    out = strip(out);
  } while (out !== previous);
  return out;
}

/** The same XML with every CDATA section blanked, so markup is never matched inside text. */
const withoutCdata = (xml) =>
  xml.replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, (section) => ' '.repeat(section.length));

/**
 * One attribute of a start tag's body, in either quote style.
 *
 * XML gives `"` and `'` equal standing and `build.mjs` reads both. Reading only double quotes
 * fails in both directions at once: `src='missing.json'` looks like a contribution with no `src`
 * and its file is never resolved, while `enabled='false'` looks enabled and its `src` is demanded.
 */
function attributeOf(tag, name) {
  const match = new RegExp(`\\b${name}${S}=${S}(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

/** An attribute of the first element with this tag name. */
function attribute(xml, name, attributeName) {
  const tag = new RegExp(`<${name}${TAG}`).exec(xml);
  return tag ? attributeOf(tag[1], attributeName) : null;
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

  const read = (entry) =>
    withoutCdata(
      withoutCommentsOrInstructions(unzip(['-p', archive, entry]).stdout.toString('utf8')),
    );
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

  // 4. The bundle has to be in the zip before anything can ask where `install.xml` puts it.
  const jars = entries.filter(
    (entry) => entry.startsWith('install/bundles/') && entry.endsWith('.jar'),
  );
  if (jars.length !== 1) {
    problem(
      `the zip holds ${jars.length} jar(s) under install/bundles/; a configuration package has one.`,
    );
    return problems;
  }

  // 5. What `install.xml` copies, and where to. Two different ways to install nothing:
  //    naming a path the zip does not hold, and deploying the bundle somewhere Nuxeo does not
  //    scan. Both leave `nuxeoctl mp-install` reporting success over a package that contributes
  //    no configuration, which is the whole class of failure this script exists for.
  const updates = [...installXml.matchAll(new RegExp(`<update${TAG}`, 'g'))].map(([, tag]) => ({
    file: attributeOf(tag, 'file'),
    todir: attributeOf(tag, 'todir')?.trim() ?? null,
  }));
  if (updates.length === 0) {
    problem('install.xml has no <update file="…">, so installing the package copies nothing.');
  }
  for (const { file } of updates) {
    if (file === null) {
      problem('install.xml has an <update> with no file= attribute, which copies nothing.');
      continue;
    }
    if (!file.startsWith(PACKAGE_ROOT)) {
      problem(`install.xml copies "${file}", which is not under ${PACKAGE_ROOT}.`);
      continue;
    }
    const path = file.slice(PACKAGE_ROOT.length);
    if (!entries.some((entry) => entry === path || entry.startsWith(`${path}/`))) {
      problem(`install.xml copies "${file}", and the zip holds no ${path}.`);
    }
  }

  // The jar specifically, into the directory Nuxeo scans for bundles. An `<update>` may name the
  // jar itself or a directory holding it — the generated one names `install/bundles` — so a
  // covering path counts either way. Without this, an install.xml that copies only `package.xml`,
  // or copies the bundle to `${env.data}`, satisfies every check above while Nuxeo never loads
  // the bundle and the package's fragments never reach the server.
  const deploysBundle = updates.some(
    ({ file, todir }) =>
      todir === BUNDLES_DIR &&
      file !== null &&
      file.startsWith(PACKAGE_ROOT) &&
      (jars[0] === file.slice(PACKAGE_ROOT.length) ||
        jars[0].startsWith(`${file.slice(PACKAGE_ROOT.length)}/`)),
  );
  if (!deploysBundle) {
    const where = updates
      .filter(({ todir }) => todir !== null)
      .map(({ todir }) => todir)
      .join(', ');
    problem(
      `install.xml has no <update> that copies ${jars[0]} into todir="${BUNDLES_DIR}"` +
        `${where ? `, only into ${where}` : ''}. Nuxeo loads bundles from there and nowhere ` +
        'else, so the package would install and contribute no configuration.',
    );
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
    // `Nuxeo-Component` is a comma-separated list, and `build.mjs` reads it as one —
    // `.split(',').map(trim).filter(Boolean)`, then a loop. Treating the whole header as a single
    // file name rejects a bundle that carries a configuration component beside an unrelated one,
    // which is a legitimate shape for a customer whose package grew past JSON.
    const componentPaths = (/^Nuxeo-Component:\s*(.+?)\s*$/m.exec(headers)?.[1] ?? '')
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean);
    if (componentPaths.length === 0) {
      problem(`${manifest} has no Nuxeo-Component header, so the bundle contributes nothing.`);
      return problems;
    }

    // 6. Each component's contributions, resolved against the jar. `build.mjs` checks these
    //    against the source directory; this checks them against what was actually packaged.
    //
    //    Scoped per component, and the `<require>` demanded only of the ones that contribute
    //    configuration — `build.mjs` gates it on the same condition, an `<extension>` whose
    //    `target` is `org.nuxeo.agentic.ui.config`. Demanding it of every component would fail a
    //    bundle whose second component is an Automation operation or a listener, which has no
    //    reason to require Satori's defaults and no fragments to order against them.
    const requiresDefaults = new RegExp(
      `<require${S}>${S}${DEFAULTS_COMPONENT.replaceAll('.', '\\.')}${S}</require${S}>`,
    );
    const CONTRIBUTION = new RegExp(`<(fragment|layout|asset)${TAG}`, 'g');
    const EXTENSION = new RegExp(`<extension${TAG}`, 'g');
    let contributionCount = 0;

    for (const componentPath of componentPaths) {
      if (!inJar.includes(posix.normalize(componentPath))) {
        problem(`${manifest} names Nuxeo-Component ${componentPath}, which is not in the jar.`);
        continue;
      }
      const componentXml = withoutCdata(
        withoutCommentsOrInstructions(
          spawnSync('unzip', ['-p', jar, componentPath], { encoding: 'utf8' }).stdout,
        ),
      );

      const contributes = [...componentXml.matchAll(EXTENSION)].some(
        ([, tag]) => attributeOf(tag, 'target') === 'org.nuxeo.agentic.ui.config',
      );
      // Matched as XML rather than as a string. `<require >…</require >` and an element whose
      // text sits on its own indented line are well-formed, the server reads them, and
      // `build.mjs` accepts them — its own test is
      // `/<require[ \t\n]*>[ \t\n]*…[ \t\n]*<\/require[ \t\n]*>/`. An exact `includes()` here
      // would have failed a package that built cleanly, which is the one kind of CI failure
      // nobody can act on.
      if (contributes && !requiresDefaults.test(componentXml)) {
        problem(
          `${componentPath} does not <require> ${DEFAULTS_COMPONENT}, so its fragments ` +
            "may register before Satori's own and lose to them.",
        );
      }

      // A contribution is a `<fragment>`, `<layout>` or `<asset>`, whatever form its body takes.
      // Counting `src` attributes instead would reject a package whose fragments carry their JSON
      // inline — `<fragment …><json>…</json></fragment>` — which `build.mjs` accepts and which
      // the server reads exactly like a `src` one. `src` is resolved only where one exists.
      for (const [, element, tag] of componentXml.matchAll(CONTRIBUTION)) {
        contributionCount += 1;
        const src = attributeOf(tag, 'src');
        const enabled = attributeOf(tag, 'enabled');
        // A disabled entry removes an earlier contribution and carries no body, so the server
        // never resolves its `src`; `build.mjs` skips it for the same reason. Requiring the file
        // here would fail a package whose only job is to switch one of ours off.
        if (src === null || (enabled !== null && enabled.toLowerCase() !== 'true')) continue;
        if (!inJar.includes(posix.normalize(src))) {
          problem(`${componentPath} names <${element} src="${src}">, which the jar does not hold.`);
        }
      }
    }

    // Across every component, not within each: a bundle may legitimately carry one that
    // contributes configuration and one that does not.
    if (contributionCount === 0) {
      problem(
        `${componentPaths.join(', ')} has no <fragment>, <layout> or <asset>, so the package ` +
          'contributes no configuration.',
      );
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
      `and install.xml present and consistent, the bundle deployed into ${BUNDLES_DIR}, the jar ` +
      'readable and its component resolved.\n' +
      'Not asserted: that a Nuxeo server installed it. No server runs here.',
  );
}
