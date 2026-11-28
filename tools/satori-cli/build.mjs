#!/usr/bin/env node
/**
 * Builds `@nuxeo/satori-cli` into `dist/tools/satori-cli/`: a folder `npm pack` makes the tool's
 * package from, which runs with Node alone, outside this repository.
 *
 *   node tools/satori-cli/build.mjs [--out <directory>]
 *
 * - **`satori.mjs`**, the command, and **`validator.mjs`**, the app definition's validator: each
 *   bundled by esbuild, which the lockfile already pins, from this repository's sources, into one
 *   file of plain JavaScript. The command is `scripts/package-pipeline/`, the steps
 *   `scripts/app-package.mjs` runs, and the validator is `libs/shared/app-definition/src/cli.ts`,
 *   the `main` that `bin.mjs` runs. Neither needs the TypeScript hook, nor anything installed.
 * - **One source for the two validators.** The server's, `nuxeo-agentic-core`'s
 *   `agentic-ui-validator/validator.js`, is built from the same library by
 *   `server-validator-build.mjs`. This build refuses to run when that file is not what the library
 *   builds now, so the tool's validator and the server's are always the same source's.
 * - **What it carries, byte for byte:** the `config-package` generator's builder, as
 *   `builder/build.mjs`, which step 4 runs on a package; the generator's scaffolder and its
 *   templates, as `config-package/`, which `create` runs; the schemas of both layers and of the app
 *   definition, as `schemas/`; and the platform's English catalogue, as `platform/en.json`.
 * - **What the upgrade check reads of the platform,** `platform/platform.json`: the platform as
 *   `readPlatform` reads this repository, its IDs, widgets, components, descriptors, menu prefix,
 *   version and catalogue keys, so that the tool's platform as it is is the one it was built from.
 * - **`package.json`**, this project's, with the files it ships, and `README.md`.
 *
 * Every module but the two entries is bundled with an `import.meta.url` of its own: esbuild gives
 * every module of a bundle the bundle's, which would make a "was I started directly?" guard, such
 * as `verify-package-zip.mjs`'s, run its command inside the tool's. The modules whose URL is
 * rewritten are listed, and a module from `node_modules` refuses the build: the tool has no
 * dependency.
 *
 * The output is the same bytes from the same sources. Exit codes: 0, built; 1, refused.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../../libs/shared/app-definition/src/typescript-hook.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const at = process.argv.indexOf('--out');
const OUT = resolve(
  at > 0 && process.argv[at + 1] ? process.argv[at + 1] : join(REPO, 'dist', 'tools', 'satori-cli'),
);
const GENERATOR = join(REPO, 'tools', 'satori-generators', 'src', 'config-package');
const DEFINITION = join(REPO, 'libs', 'shared', 'app-definition', 'src');

const { build } = await import('esbuild');
const { buildServerValidator, OUTPUT: SERVER_VALIDATOR } = await import(
  pathOf(DEFINITION, 'server-validator-build.mjs')
);
const { platformSnapshot, readPlatform } = await import(
  pathOf(REPO, 'scripts', 'package-pipeline', 'upgrade-check.mjs')
);

// One source: the server's validator is what the library builds now, or the tool is not built.
const serverValidator = await buildServerValidator();
if (!existsSync(SERVER_VALIDATOR) || readFileSync(SERVER_VALIDATOR, 'utf8') !== serverValidator) {
  console.error(
    `${relative(REPO, SERVER_VALIDATOR)} is not what libs/shared/app-definition builds now, so the tool's validator and the server's would come from different sources. Run npm run app-definition:server-validator and commit it, then build the tool.`,
  );
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** The modules whose `import.meta.url` the bundles rewrite, by their place in the repository. */
const rewritten = new Set();
/** Modules from node_modules, which the tool may not depend on. */
const dependencies = new Set();

for (const [entry, file] of [
  [join(HERE, 'src', 'satori.mjs'), 'satori.mjs'],
  [join(HERE, 'src', 'validator.mjs'), 'validator.mjs'],
]) {
  const result = await build({
    entryPoints: [entry],
    outfile: join(OUT, file),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
    plugins: [ownUrls(entry)],
  });
  for (const input of Object.keys(result.metafile.inputs))
    if (input.split(/[\\/]/).includes('node_modules')) dependencies.add(input);
}
if (dependencies.size > 0) {
  console.error(
    `The tool would bundle what is installed, and it has no dependency: ${[...dependencies].sort().join(', ')}.`,
  );
  process.exit(1);
}

// What it carries, byte for byte.
mkdirSync(join(OUT, 'builder'), { recursive: true });
cpSync(join(GENERATOR, 'files', 'build.mjs__tmpl__'), join(OUT, 'builder', 'build.mjs'));
cpSync(join(GENERATOR, 'create.mjs'), join(OUT, 'config-package', 'create.mjs'));
cpSync(join(GENERATOR, 'files'), join(OUT, 'config-package', 'files'), { recursive: true });
mkdirSync(join(OUT, 'schemas'), { recursive: true });
for (const layer of ['bootstrap', 'manifest'])
  cpSync(
    join(GENERATOR, 'files', 'schema', `${layer}.schema.json__tmpl__`),
    join(OUT, 'schemas', `${layer}.schema.json`),
  );
for (const schema of readdirSync(DEFINITION)
  .filter((name) => name.endsWith('.schema.json'))
  .sort())
  cpSync(join(DEFINITION, schema), join(OUT, 'schemas', schema));
mkdirSync(join(OUT, 'platform'), { recursive: true });
cpSync(
  join(REPO, 'apps', 'nuxeo-ui', 'public', 'i18n', 'en.json'),
  join(OUT, 'platform', 'en.json'),
);
cpSync(join(HERE, 'templates'), join(OUT, 'templates'), { recursive: true });
cpSync(join(HERE, 'README.md'), join(OUT, 'README.md'));

// The platform as it is, for the upgrade check.
const platform = await readPlatform(REPO);
if (platform.missing.length > 0) {
  console.error(`The platform's sources are not all here: ${platform.missing.join(', ')}.`);
  process.exit(1);
}
writeFileSync(
  join(OUT, 'platform', 'platform.json'),
  `${JSON.stringify(platformSnapshot(platform), null, 1)}\n`,
);

const manifest = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
writeFileSync(
  join(OUT, 'package.json'),
  `${JSON.stringify(
    {
      ...manifest,
      files: [
        'satori.mjs',
        'validator.mjs',
        'builder/',
        'config-package/',
        'schemas/',
        'platform/',
        'templates/',
        'README.md',
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Built @nuxeo/satori-cli ${manifest.version} in ${relative(process.cwd(), OUT) || '.'}, for the platform ${platform.version}. ` +
    `import.meta.url given its own module's place in: ${[...rewritten].sort().join(', ') || 'none'}.`,
);

/**
 * An esbuild plugin giving every bundled module but `entry` an `import.meta.url` of its own: its
 * place in the repository, under the bundle's folder, which names no file the tool runs.
 */
function ownUrls(entry) {
  return {
    name: 'own-import-meta-url',
    setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?js|ts)$/ }, (args) => {
        if (args.path === entry || args.path.split(sep).includes('node_modules')) return undefined;
        const text = readFileSync(args.path, 'utf8');
        if (!text.includes('import.meta.url')) return undefined;
        const place = relative(REPO, args.path).split(sep).join('/');
        rewritten.add(place);
        return {
          contents: text.replaceAll(
            'import.meta.url',
            `new URL(${JSON.stringify(`./bundled/${place}`)}, import.meta.url).href`,
          ),
          loader: args.path.endsWith('.ts') ? 'ts' : 'js',
        };
      });
    },
  };
}

function pathOf(...parts) {
  return pathToFileURL(resolve(...parts)).href;
}
