/**
 * The beta harness's demo steps a server run of a release candidate would execute, listed without
 * running any of them (`scripts/release-candidate.mjs`, docs/business-apps/package-pipeline.md,
 * section 11).
 *
 * A kit's demo is a steps file under `scripts/beta-harness/steps/` that names the kit's folder.
 * Each one declares what a server run of it needs, `export const serverRun`, beside the
 * preconditions that hold the run to it: the kit, the seeds to run first, who `NUXEO_USER` must be,
 * who else it signs in as, in the browser or through the REST API, and what else must be in place. The rest is read from the
 * file's source, so it cannot disagree with what the file does:
 *
 * - its steps, the labels of its `h.step(...)` calls in the order they are written, a template's
 *   substitutions shown as written;
 * - the environment it reads, each `process.env['X']` or `process.env.X`, and `NUXEO_USER` and
 *   `NUXEO_PASS`, which the runner always requires of a file that sends credentials;
 * - and for each seed, the environment that reads.
 *
 * The declaration is read by importing the steps file, as the runner does to read
 * `skipHttpCredentials`: its module code runs, and reads the kit's files, and its `run` does not.
 * The source is parsed with acorn, which the repository's own assertion audit uses.
 *
 * What this does not do: run a step, reach a server, or say a step would pass. A step inside a loop
 * or a condition is listed once, where it is written.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A kit's folder as a steps file names it: `join(REPO, 'business-apps', 'packages', '<kit>')`. */
const NAMED_KIT = /['"]business-apps['"]\s*,\s*['"]packages['"]\s*,\s*['"]([A-Za-z0-9._-]+)['"]/g;

/** The steps files that name one of `kits`, by file name, with the kits each names. */
export function kitStepsFiles(stepsDir, kits) {
  const files = [];
  for (const name of readdirSync(stepsDir).sort()) {
    if (!name.endsWith('.mjs') || name.endsWith('.selftest.mjs') || name.startsWith('_')) continue;
    const source = readFileSync(join(stepsDir, name), 'utf8');
    const named = [...new Set([...source.matchAll(NAMED_KIT)].map(([, kit]) => kit))].filter(
      (kit) => kits.includes(kit),
    );
    if (named.length > 0) files.push({ file: join(stepsDir, name), source, kits: named });
  }
  return files;
}

/** The text a call's first argument is written as: a string, or a template with its `${...}`. */
function labelOf(node, source) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') {
    let text = '';
    node.quasis.forEach((quasi, index) => {
      text += quasi.value.cooked ?? quasi.value.raw;
      const expression = node.expressions[index];
      if (expression) text += `\${${source.slice(expression.start, expression.end)}}`;
    });
    return text;
  }
  return node ? `(${source.slice(node.start, node.end)})` : '(no label)';
}

/** Every node of an acorn tree, in source order. */
function* nodesOf(node) {
  if (node === null || typeof node !== 'object') return;
  if (typeof node.type === 'string') yield node;
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) yield* nodesOf(child);
    else if (value && typeof value === 'object') yield* nodesOf(value);
  }
}

/** `process.env` itself, as a member expression. */
const isProcessEnv = (node) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.object.type === 'Identifier' &&
  node.object.name === 'process' &&
  node.property.type === 'Identifier' &&
  node.property.name === 'env';

/**
 * What a module's source does that the listing reports: the labels of its `h.step(...)` calls, the
 * environment variables it reads by name, and whether it asks for the run's credentials. `parse`
 * is acorn's.
 */
export function readSource(source, parse) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const steps = [];
  const environment = new Set();
  let credentials = false;
  for (const node of nodesOf(tree)) {
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'h' &&
        callee.property.name === 'step'
      )
        steps.push({ label: labelOf(node.arguments[0], source), at: node.start });
      if (callee.type === 'Identifier' && callee.name === 'requireStepCredentials')
        credentials = true;
    }
    if (node.type === 'MemberExpression' && isProcessEnv(node.object)) {
      if (
        node.computed &&
        node.property.type === 'Literal' &&
        typeof node.property.value === 'string'
      )
        environment.add(node.property.value);
      else if (!node.computed && node.property.type === 'Identifier')
        environment.add(node.property.name);
    }
  }
  steps.sort((a, b) => a.at - b.at);
  return {
    steps: steps.map((step) => step.label),
    environment: [...environment].sort(),
    credentials,
  };
}

/** Why a declared `serverRun` cannot be listed, or `null`. */
function declarationProblem(serverRun, named) {
  if (serverRun === null || typeof serverRun !== 'object') return 'exports no serverRun';
  if (!named.includes(serverRun.kit))
    return `declares the kit ${JSON.stringify(serverRun.kit)}, and names ${named.join(', ')}`;
  if (!Array.isArray(serverRun.seeds) || !serverRun.seeds.every((seed) => typeof seed === 'string'))
    return 'declares no list of seeds';
  if (
    typeof serverRun.runAs?.who !== 'string' ||
    !Array.isArray(serverRun.runAs?.users) ||
    !serverRun.runAs.users.every((user) => typeof user === 'string' && user !== '')
  )
    return 'declares no runAs: { users, who }';
  if (
    !Array.isArray(serverRun.signsInAs) ||
    !serverRun.signsInAs.every((user) => typeof user === 'string' && user !== '')
  )
    return 'declares no list of users it signs in as';
  if (!Array.isArray(serverRun.needs)) return 'declares no list of what it needs';
  return null;
}

/**
 * The demo steps of every kit in `kits` (`[{ name, directory, version }]`, `directory` the kit's
 * folder under `business-apps/packages`), or the problems that stop them being listed: a steps file
 * that names a kit and declares no `serverRun`, or declares it for another kit, and a seed it names
 * that the kit does not have. A listing that left such a file out would say a kit's demo is shorter
 * than it is. `repo` is the repository's root, so that paths are shown from it.
 */
export async function demoSteps({ repo, stepsDir, kits }) {
  let parse;
  try {
    ({ parse } = await import('acorn'));
  } catch {
    return {
      problems: ['acorn is not installed, so the steps files cannot be read: run npm ci first.'],
      listing: [],
    };
  }
  const shown = (path) => relative(repo, path).split(sep).join('/');
  const directories = kits.map((kit) => basename(kit.directory));
  const problems = [];
  const files = [];
  for (const { file, source, kits: named } of kitStepsFiles(stepsDir, directories)) {
    let serverRun = null;
    try {
      ({ serverRun = null } = await import(pathToFileURL(file).href));
    } catch (error) {
      problems.push(`${shown(file)} could not be imported to read its serverRun: ${error.message}`);
      continue;
    }
    const problem = declarationProblem(serverRun, named);
    if (problem !== null) {
      problems.push(
        `${shown(file)} names the kit ${named.join(', ')} and ${problem}. Declare export const serverRun = { kit, seeds, runAs: { users, who }, signsInAs, needs } beside its preconditions, as the other kit demos do.`,
      );
      continue;
    }
    const read = readSource(source, parse);
    const kit = kits.find((each) => basename(each.directory) === serverRun.kit);
    const seeds = [];
    for (const seed of serverRun.seeds) {
      const path = join(kit.directory, seed);
      if (!existsSync(path)) {
        problems.push(
          `${shown(file)} needs the seed ${seed}, and ${shown(kit.directory)} has none.`,
        );
        continue;
      }
      seeds.push({
        file: shown(path),
        environment: readSource(readFileSync(path, 'utf8'), parse).environment,
      });
    }
    const environment = new Set(read.environment);
    if (read.credentials) for (const name of ['NUXEO_USER', 'NUXEO_PASS']) environment.add(name);
    files.push({
      kit: serverRun.kit,
      file: shown(file),
      seeds,
      runAs: serverRun.runAs,
      signsInAs: serverRun.signsInAs,
      environment: [...environment].sort(),
      needs: serverRun.needs,
      steps: read.steps,
    });
  }
  const listing = kits.map((kit) => ({
    kit: basename(kit.directory),
    name: kit.name,
    version: kit.version,
    files: files.filter((each) => each.kit === basename(kit.directory)),
  }));
  return { problems, listing };
}

/** The listing as Markdown, for `DEMO-STEPS.md` and the run's log. */
export function demoStepsMarkdown(listing) {
  const lines = [
    '# Demo steps a server run would execute',
    '',
    'Listed from the beta harness steps files, not run. Each runs as `npm run beta:evidence -- <file>`, ' +
      'on a server with the kit installed from this candidate and its seeds run first.',
    '',
  ];
  for (const kit of listing) {
    lines.push(`## ${kit.name} ${kit.version}`, '');
    if (kit.files.length === 0) {
      lines.push(
        `No steps file names this kit, so a server run executes no demo steps for it.`,
        '',
      );
      continue;
    }
    for (const each of kit.files) {
      const users = each.runAs.users.length > 0 ? `${each.runAs.users.join(' or ')}: ` : '';
      lines.push(`### ${each.file}`, '');
      lines.push(
        `- **Seeds, first:** ${
          each.seeds.length === 0
            ? 'none'
            : each.seeds
                .map(
                  (seed) =>
                    `\`node ${seed.file}\`, which reads ${seed.environment.join(', ') || 'no environment'}`,
                )
                .join('; ')
        }`,
      );
      lines.push(`- **NUXEO_USER:** ${users}${each.runAs.who}`);
      lines.push(
        `- **Also signs in as**, in the browser or through the REST API: ${each.signsInAs.join(', ') || 'no one else'}`,
      );
      lines.push(`- **Environment it reads:** ${each.environment.join(', ') || 'none'}`);
      lines.push(`- **Needs:** ${each.needs.join('; ') || 'nothing else'}`);
      // Bullets, not numbers: most labels carry the demo script's own step numbers.
      lines.push(`- **Steps, in the order written:**`);
      for (const step of each.steps) lines.push(`  - ${step}`);
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
