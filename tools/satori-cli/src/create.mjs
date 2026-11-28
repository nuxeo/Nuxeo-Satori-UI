/**
 * `satori create <directory> --name <name> --owner <prefix>`: a customer's configuration repository,
 * as docs/business-apps/extension-model.md, section 5, draws it, with a first package that builds.
 *
 *   <directory>/
 *     package.json                 the tool as a dev dependency, pinned, and its two commands
 *     .npmrc                       the registry @nuxeo/satori-cli is installed from, Nuxeo's
 *     AGENTS.md                    the repository's own part, then the tool's section
 *     .cursor/ .claude/ .agent/    the app builder skill, satori-app-builder
 *     .mcp.json, .cursor/mcp.json  the MCP server, satori mcp, with nothing secret in it
 *     .gitignore
 *     .github/workflows/satori.yml satori validate and satori build on every pull request, and a
 *                                  keyless signature for a tag once trusted-signers.json says who
 *     config-packages/<name>/      the first package: Layer 0, Layer 1, its component, package.xml
 *
 * The package is the `config-package` generator's, written by the generator's own scaffolder, the
 * `create.mjs` this tool carries beside it with its templates: the same files, the same refusals of
 * a name Satori itself uses, a name Windows reserves or an owner that is not one, and the same
 * messages. So nothing here repeats one of its rules. Only its `project.json`, which is Nx's and
 * means nothing in a repository without Nx, is not kept.
 *
 * The repository's own files are this tool's templates, `templates/`, with the package's name, the
 * repository's and the tool's version put in. The agent files are `satori agents sync`'s, run on
 * the new repository, so that `create` and a later `sync` write the same bytes. Nothing is written
 * until the generator has accepted the name and the owner, and nothing is written over: the
 * directory must be new, or empty.
 *
 * Not written, and said: promotion in the workflow, and who may sign, which decision M leaves open.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { agentsCommand } from './agents.mjs';

const USAGE =
  'usage: satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]';

/** The repository's files, from `templates/`, each with what is put into it. */
const FILES = [
  ['package.json', 'package.json'],
  // Named without its dot, as gitignore is: npm never packs a file named .npmrc.
  ['npmrc', '.npmrc'],
  ['AGENTS.md', 'AGENTS.md'],
  ['gitignore', '.gitignore'],
  ['satori.yml', join('.github', 'workflows', 'satori.yml')],
];

/**
 * The command: `args` read, the package written by the generator's scaffolder, then the repository's
 * files. `context.here` is where the tool is, `context.version` its version.
 */
export function createCommand(args, { here, version }) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (['--name', '--owner', '--title', '--vendor'].includes(arg)) {
      if (value === undefined || value === '' || value.startsWith('--')) {
        console.error(`${arg} needs a value.\n${USAGE}`);
        return 2;
      }
      options[arg.slice(2)] = value;
      index++;
    } else if (arg.startsWith('-')) {
      console.error(USAGE);
      return 2;
    } else positionals.push(arg);
  }
  if (positionals.length !== 1 || !options.name || !options.owner) {
    console.error(USAGE);
    return 2;
  }
  const directory = resolve(positionals[0]);
  const entry = lstatSync(directory, { throwIfNoEntry: false });
  if (entry && (!entry.isDirectory() || readdirSync(directory).length > 0)) {
    console.error(
      `${positionals[0]} is ${entry.isDirectory() ? 'not empty' : 'not a folder'}: create writes a new repository, and writes over nothing.`,
    );
    return 1;
  }
  const made = !entry;
  if (made) mkdirSync(directory, { recursive: true });

  // The package, by the generator's own scaffolder: every check of the name and the owner is its.
  const scaffolded = spawnSync(
    process.execPath,
    [
      join(here, 'config-package', 'create.mjs'),
      options.name,
      `--owner=${options.owner}`,
      ...(options.title === undefined ? [] : ['--title', options.title]),
      ...(options.vendor === undefined ? [] : ['--vendor', options.vendor]),
      '--directory',
      'config-packages',
    ],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (scaffolded.status !== 0) {
    process.stderr.write(scaffolded.stderr ?? '');
    process.stderr.write(scaffolded.stdout ?? '');
    // It writes nothing until every option is checked, so the folder made for it is empty.
    if (made && readdirSync(directory).length === 0) rmdirSync(directory);
    console.error(`satori create: nothing was written.`);
    return scaffolded.status === 2 ? 2 : 1;
  }
  const projectJson = join(directory, 'config-packages', options.name, 'project.json');
  if (existsSync(projectJson)) unlinkSync(projectJson);

  const repository = /^[a-z0-9][a-z0-9._-]*$/.test(basename(directory))
    ? basename(directory)
    : `${options.name}-repository`;
  const values = { name: options.name, repository, version };
  for (const [template, target] of FILES) {
    const text = readFileSync(join(here, 'templates', template), 'utf8').replace(
      /\{\{(name|repository|version)\}\}/g,
      (_, key) => values[key],
    );
    mkdirSync(dirname(join(directory, target)), { recursive: true });
    writeFileSync(join(directory, target), text);
  }
  // The agent files, as satori agents sync writes them: the same bytes a later sync keeps.
  const synced = agentsCommand(['sync', directory], { here, version });
  if (synced !== 0) {
    console.error('satori create: the agent files could not be written.');
    return 1;
  }

  process.stdout.write(`Created ${positionals[0]}, a configuration repository:

  config-packages/${options.name}/    the first package, from the config-package generator
  AGENTS.md                    yours, then the tool's section: the commands and the rules
  .cursor/ .claude/ .agent/    the app builder skill, satori-app-builder, for any AI IDE
  .mcp.json, .cursor/mcp.json  the MCP server, satori mcp, reading the server from the environment
  .github/workflows/satori.yml validate and build on every pull request; sign a tag once
                               trusted-signers.json names the workflow
  package.json                 @nuxeo/satori-cli ${version}, as a dev dependency
  .npmrc                       where npm finds it: Nuxeo's registry, which needs no token

Install the tool, and commit package-lock.json, which the workflow's npm ci installs from:

  npm install

Then check and build the package, with package.json's scripts, which run the tool npm installed:

  npm run validate
  npm run build

After every upgrade of the tool, run satori agents sync, and commit what it writes: the workflow
checks it with satori agents sync --check. Not written by this version: promotion, and who may sign
for a deployment, which decision M leaves open.
`);
  return 0;
}
