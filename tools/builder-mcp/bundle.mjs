/**
 * Bundles the Builder MCP server into a folder that runs with Node alone, outside this repository:
 * what `tools/satori-cli/build.mjs` calls to put `satori mcp` in `@nuxeo/satori-cli`.
 *
 *   await bundleServer({ out, repo })
 *
 * It writes, into `out`, beside the tool's own `satori.mjs`:
 *
 * - **`mcp.mjs`,** the server, `src/main.ts`, with the MCP SDK and zod bundled, and
 *   `SATORI_MCP_BUNDLE` defined, which makes `src/host.ts` the bundled host: the folder it is
 *   started in is the root, the pipeline is the tool's `satori build`, packages are written in
 *   `config-packages/`.
 * - **`mcp-generator.mjs`,** the generators' process, `src/bundle/run-generator.ts`, with the nine
 *   app generators of `tools/satori-generators`, the same sources, given `src/bundle/devkit.ts` for
 *   `@nx/devkit` and `src/bundle/tree.ts` for Nx's tree, with Prettier's standalone build and its
 *   plugins, and EJS, which Nx renders templates with.
 * - **`generators/`,** what the generators read outside a package, laid out as this repository
 *   lays it out, since they find it from their `workspaceRoot`: each one's `schema.json`, which the
 *   server holds options to; `app-package`'s templates; the `config-package` builder it copies; the
 *   platform's routes, which no app's address may be; the platform's version; and
 *   `formatting.json`, this repository's Prettier configuration as Prettier resolves it for each
 *   kind of file a generator writes.
 * - **`licenses/`,** the licence of each package bundled.
 *
 * Refused, and nothing is trusted: a bundled module from `node_modules` that is not one of the
 * packages listed for its bundle, so that neither carries Nx, `tsx` or anything else installed
 * but Nx's list of binary extensions; a bundled package with no licence file; and a formatting
 * configuration that is not the same for a file at every package path, which `formatting.json`,
 * resolved by kind of file, could not carry.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The generators `mcp-generator.mjs` carries: the write tools' list, `APP_GENERATORS`. */
const GENERATOR_LIST = /export const APP_GENERATORS = \[([^\]]*)\] as const;/;

/** What each bundle may take from `node_modules`, and nothing more. */
const ALLOWED = {
  'mcp.mjs': ['@modelcontextprotocol/core', '@modelcontextprotocol/server', 'zod'],
  'mcp-generator.mjs': ['@nx/devkit', 'ejs', 'prettier'],
};

/**
 * A bundled package that ships no licence file of its own, and the package of the same repository
 * and licence whose file is carried for it: @nx/devkit, whose one file bundled is Nx's list of
 * binary extensions, and nx, both of github.com/nrwl/nx, MIT.
 */
const LICENCE_OF = { '@nx/devkit': 'nx' };

/** What a generator reads outside a package, from the root it is given, by its place there. */
const CARRIED = [
  'libs/shared/app-definition/src/lib/platform-routes.ts',
  'tools/satori-generators/src/app-package/files',
  'tools/satori-generators/src/config-package/files/build.mjs__tmpl__',
];

/** The kinds of file a generator writes, whose formatting is resolved at build time. */
const EXTENSIONS = ['.json', '.md', '.mjs', '.js', '.ts', '.html', '.xml', '.xsd', '.MF', '.yml'];

export async function bundleServer({ out, repo }) {
  const { build } = await import('esbuild');
  const prettier = await import('prettier');
  const source = join(HERE, 'src');
  const writes = readFileSync(join(source, 'package-writes.ts'), 'utf8');
  const listed = GENERATOR_LIST.exec(writes)?.[1];
  const generators = [...(listed ?? '').matchAll(/'([a-z-]+)'/g)].map(([, name]) => name);
  if (generators.length === 0)
    throw new Error(
      'src/package-writes.ts has no APP_GENERATORS list, so no generator would be carried.',
    );
  const generatorSources = join(repo, 'tools', 'satori-generators', 'src');

  const bundled = {};
  for (const [file, entry, plugins] of [
    ['mcp.mjs', join(source, 'main.ts'), []],
    [
      'mcp-generator.mjs',
      join(source, 'bundle', 'run-generator.ts'),
      [
        devkitPlugin(join(source, 'bundle', 'devkit.ts'), repo),
        generatorsPlugin(generatorSources, generators),
      ],
    ],
  ]) {
    const result = await build({
      entryPoints: [entry],
      outfile: join(out, file),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'warning',
      metafile: true,
      // From the repository, wherever the build is run: the bytes, and the paths in their
      // comments, are the same from any folder.
      absWorkingDir: repo,
      define: { SATORI_MCP_BUNDLE: 'true' },
      // CommonJS bundled into an ES module calls `require` for Node's own modules.
      banner: {
        js: "import { createRequire as satoriRequire } from 'node:module';\nconst require = satoriRequire(import.meta.url);",
      },
      plugins,
    });
    const packages = new Set();
    for (const input of Object.keys(result.metafile.inputs)) {
      const parts = input.split(/[\\/]/);
      const at = parts.lastIndexOf('node_modules');
      if (at < 0) continue;
      const name = parts[at + 1]?.startsWith('@')
        ? `${parts[at + 1]}/${parts[at + 2]}`
        : parts[at + 1];
      packages.add(name);
    }
    const extra = [...packages].filter((name) => !ALLOWED[file].includes(name)).sort();
    if (extra.length > 0)
      throw new Error(
        `${file} would bundle ${extra.join(', ')}, which it may not: it takes ${ALLOWED[file].join(', ')} and nothing else installed.`,
      );
    bundled[file] = [...packages].sort();
  }

  // What the generators read outside a package.
  const carried = join(out, 'generators');
  for (const place of CARRIED)
    cpSync(join(repo, ...place.split('/')), join(carried, ...place.split('/')), {
      recursive: true,
    });
  for (const generator of generators)
    cpSync(
      join(generatorSources, generator, 'schema.json'),
      join(carried, 'tools', 'satori-generators', 'src', generator, 'schema.json'),
    );
  const platform = JSON.parse(readFileSync(join(repo, 'libs', 'platform', 'package.json'), 'utf8'));
  mkdirSync(join(carried, 'libs', 'platform'), { recursive: true });
  writeFileSync(
    join(carried, 'libs', 'platform', 'package.json'),
    `${JSON.stringify({ name: platform.name, version: platform.version }, null, 2)}\n`,
  );
  writeFileSync(
    join(carried, 'formatting.json'),
    `${JSON.stringify(await formatting(prettier, repo), null, 2)}\n`,
  );

  // The licence of each package bundled.
  const licenses = join(out, 'licenses');
  mkdirSync(licenses, { recursive: true });
  const notices = (folder) =>
    readdirSync(folder).filter((entry) => /^(licen[cs]e|notice|third-party-notices)/i.test(entry));
  const manifestOf = (folder) => JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  for (const name of [...new Set(Object.values(bundled).flat())].sort()) {
    const folder = join(repo, 'node_modules', ...name.split('/'));
    const { version, license, repository } = manifestOf(folder);
    let from = folder;
    let files = notices(folder);
    if (!files.some((entry) => /^licen[cs]e/i.test(entry)) && Object.hasOwn(LICENCE_OF, name)) {
      // Its repository's licence, as a package of the same repository and licence ships it.
      from = join(repo, 'node_modules', ...LICENCE_OF[name].split('/'));
      const other = manifestOf(from);
      if (other.license !== license || other.repository?.url !== repository?.url)
        throw new Error(
          `${name} ships no licence file, and ${LICENCE_OF[name]}, whose licence it was to carry, is not of its repository and licence.`,
        );
      files = notices(from);
    }
    if (!files.some((entry) => /^licen[cs]e/i.test(entry)))
      throw new Error(`${name} is bundled and has no licence file in ${relative(repo, folder)}.`);
    const text = files
      .sort()
      .map((entry) => `--- ${entry} ---\n\n${readFileSync(join(from, entry), 'utf8').trim()}\n`)
      .join('\n');
    const shipped =
      from === folder
        ? ''
        : `It ships no licence file: this is its repository's, ${repository.url}, as ${LICENCE_OF[name]} ships it.\n\n`;
    writeFileSync(
      join(licenses, `${name.replace('/', '__')}.txt`),
      `${name} ${version} (${license})\n\n${shipped}${text}`,
    );
  }
  return { generators, bundled };
}

/**
 * This repository's Prettier configuration as the generators' process in this repository sees
 * it: a tree root holding a copy of `.prettierrc` and `.editorconfig`, as `runGenerator` makes one,
 * resolved for a file of each kind, and for any other.
 */
async function formatting(prettier, repo) {
  const root = mkdtempSync(join(tmpdir(), 'satori-mcp-formatting-'));
  try {
    for (const file of ['.prettierrc', '.editorconfig']) cpSync(join(repo, file), join(root, file));
    const resolve = (place, name) =>
      prettier.resolveConfig(join(root, ...place.split('/'), name), { editorconfig: true });
    const byExtension = {};
    for (const extension of EXTENSIONS)
      byExtension[extension] = await resolve('package', `file${extension}`);
    const otherwise = await resolve('package', 'file');
    // A configuration scoped to a folder would format a package's file by where the package is,
    // which a configuration by kind of file cannot say: refused, rather than carried wrong.
    for (const place of ['business-apps/packages/kit', 'config-packages/kit/bundle', 'x/y/z'])
      for (const extension of [...EXTENSIONS, ''])
        if (
          JSON.stringify(await resolve(place, `file${extension}`)) !==
          JSON.stringify(extension === '' ? otherwise : byExtension[extension])
        )
          throw new Error(
            `the Prettier configuration formats a file${extension} under ${place} otherwise than elsewhere, which formatting.json, by kind of file, cannot carry.`,
          );
    return { prettier: prettier.version, byExtension, otherwise };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * `@nx/devkit`, for the generators: the bundle's own, `devkit.ts`. And EJS as Nx loads it, with
 * `require`: its CommonJS build, which its package's `import` condition would not give.
 */
function devkitPlugin(devkit, repo) {
  return {
    name: 'satori-devkit',
    setup(build) {
      build.onResolve({ filter: /^@nx\/devkit$/ }, () => ({ path: devkit }));
      build.onResolve({ filter: /^ejs$/ }, () => ({
        path: join(repo, 'node_modules', 'ejs', 'lib', 'cjs', 'ejs.js'),
      }));
      // Nx's list of binary extensions, its one file of @nx/devkit bundled, by its path.
      build.onResolve({ filter: /^satori:binary-extensions$/ }, () => ({
        path: join(
          repo,
          'node_modules',
          '@nx',
          'devkit',
          'dist',
          'src',
          'utils',
          'binary-extensions.js',
        ),
      }));
    },
  };
}

/** `satori:generators`: each app generator's default export, by name, from this repository. */
function generatorsPlugin(sources, generators) {
  return {
    name: 'satori-generators',
    setup(build) {
      build.onResolve({ filter: /^satori:generators$/ }, () => ({
        path: 'generators',
        namespace: 'satori',
      }));
      build.onLoad({ filter: /.*/, namespace: 'satori' }, () => ({
        contents: [
          ...generators.map(
            (name, index) =>
              `import generator${index} from ${JSON.stringify(join(sources, name, 'generator.ts').split(sep).join('/'))};`,
          ),
          `export const GENERATORS = Object.freeze({ ${generators.map((name, index) => `${JSON.stringify(name)}: generator${index}`).join(', ')} });`,
        ].join('\n'),
        loader: 'js',
        resolveDir: sources,
      }));
    },
  };
}
