#!/usr/bin/env node
/**
 * Fail when the copies of `build.mjs` diverge from the generator template they came from.
 *
 *   node scripts/check-build-mjs-copies.mjs [--root <directory>]
 *
 * `tools/satori-generators/src/config-package/files/build.mjs__tmpl__` is what `create.mjs` and
 * the Nx generator write into every configuration package they scaffold, and
 * `config-packages/*​/build.mjs` are the two packages this repository scaffolded for itself. All
 * three are byte-identical, and until this check nothing compared them: `sync-derived.mjs` does
 * not cover them and no gate did. They agreed by discipline alone.
 *
 * That matters more than a duplicated file usually does, because the script is not glue. It
 * applies around 25 server-fidelity checks mirroring `ContributionRegistry` and `ConfigSnapshot`
 * in nuxeo-agentic-core — fragment layer and name rules, layout type and mode, asset naming and
 * the 2 MiB ceiling, the 1 MiB fragment ceiling, duplicate JSON keys, namespace-aware XML
 * well-formedness, `src` targets resolving to packaged files, symlink refusal, and the mandatory
 * `<require>org.nuxeo.agentic.ui.config.defaults</require>`. Nothing in Maven or Nuxeo CLI
 * performs any of them. A rule added to one copy and not the others means a package this
 * repository ships is checked less strictly than one a customer scaffolds, or the reverse, and
 * nothing says so.
 *
 * What this does NOT solve, and no gate inside this repository can: the script is copied *into*
 * every generated package, so a validation fix never reaches a package a customer already built.
 * That needs the validator split out of the generated output and depended on, which is NXSAT-679's
 * I6 — recorded here so the gate is not mistaken for the whole answer.
 *
 * The comparison is of raw bytes, which is only correct while the template carries no EJS tag:
 * `create.mjs` and Nx both render it, so a tag would make the written file differ from the
 * template on purpose and byte-identity would be the wrong question. A tag is therefore refused
 * with that reason rather than quietly compared, so whoever adds one is told to teach this check
 * to render first.
 *
 * Exit 0 when every copy matches, 1 when one diverges or the check cannot be made meaningfully,
 * 2 when the command line is wrong. `check-build-mjs-copies.selftest.mjs` perturbs a copy in a
 * fixture tree and requires this to go red for that copy, by name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** The file every copy is generated from, relative to the repository root. */
export const TEMPLATE = 'tools/satori-generators/src/config-package/files/build.mjs__tmpl__';

/** Where this repository's own configuration packages live. */
export const PACKAGES = 'config-packages';

/** A line long enough to be unreadable in a failure message is cut here. */
const EXCERPT = 100;

const excerpt = (line = '') =>
  line.length > EXCERPT ? `${line.slice(0, EXCERPT)}… (${line.length} characters)` : line;

/**
 * Where two files first differ, as a line number and both lines — "byte 48213 of 52110" tells
 * whoever reads the failure nothing they can act on.
 */
function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return {
        line: i + 1,
        template: left[i] === undefined ? '(end of file)' : excerpt(left[i]),
        copy: right[i] === undefined ? '(end of file)' : excerpt(right[i]),
      };
    }
  }
  // Equal line by line but not byte for byte: a trailing newline, or a line separator this split
  // does not treat as one. Reported rather than passed over.
  return { line: null, template: '', copy: '' };
}

/** `config-packages/<name>/build.mjs` for every package directory that has one. */
function copiesUnder(root) {
  const packages = join(root, PACKAGES);
  if (!statSync(packages, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${PACKAGES}/${entry.name}/build.mjs`)
    .filter((path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile())
    .sort();
}

/**
 * Compare every copy with the template. Returns the problems, each naming the copy and what it
 * diverged from; an empty array is a pass.
 */
export function checkCopies(root) {
  const problems = [];
  const templatePath = join(root, TEMPLATE);
  if (!statSync(templatePath, { throwIfNoEntry: false })?.isFile()) {
    return [`${TEMPLATE} does not exist, so there is nothing to compare the copies with.`];
  }
  const template = readFileSync(templatePath, 'utf8');

  if (template.includes('<%')) {
    problems.push(
      `${TEMPLATE} carries an EJS tag. create.mjs and the Nx generator render it, so a generated ` +
        'build.mjs would differ from the template on purpose and this byte comparison would be ' +
        'the wrong question. Teach this check to render the template as create.mjs does before ' +
        'adding one.',
    );
  }

  const copies = copiesUnder(root);
  if (copies.length === 0) {
    // A check that compares nothing passes for the same reason a check that compares everything
    // does, and only one of those is worth having.
    problems.push(
      `no ${PACKAGES}/*/build.mjs was found, so this check compared nothing. Either a package ` +
        'lost its build script, or this check is looking in the wrong place.',
    );
  }

  for (const path of copies) {
    const copy = readFileSync(join(root, path), 'utf8');
    if (copy === template) continue;
    const { line, template: expected, copy: found } = firstDifference(template, copy);
    problems.push(
      line === null
        ? `${path} differs from ${TEMPLATE} in bytes no line comparison shows — check line endings.`
        : `${path} diverged from ${TEMPLATE}, first at line ${line}:\n` +
            `      ${TEMPLATE} has: ${expected}\n` +
            `      ${path} has: ${found}`,
    );
  }

  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  try {
    // Defaults to the repository this script lives in, not the working directory, so the gate
    // gives the same verdict wherever it is invoked from. `--root` is for the selftest's fixtures.
    ({ values: options } = parseArgs({
      options: { root: { type: 'string', default: resolve(import.meta.dirname, '..') } },
    }));
  } catch (error) {
    console.error(
      `${error.message}\n\nUsage: node scripts/check-build-mjs-copies.mjs [--root <directory>]`,
    );
    process.exit(2);
  }
  const root = resolve(options.root);
  const problems = checkCopies(root);
  if (problems.length > 0) {
    console.error(`build.mjs copies: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  - ${problem}\n`);
    console.error(
      'Every configuration package carries its own copy of build.mjs, written from the generator\n' +
        'template. Change the template and copy it over each package, or revert the copy — the\n' +
        'server-fidelity checks in that script are the only ones anything performs.',
    );
    process.exit(1);
  }
  const count = copiesUnder(root).length;
  console.log(`build.mjs copies: ${count} copy(ies) match ${TEMPLATE}.`);
}
