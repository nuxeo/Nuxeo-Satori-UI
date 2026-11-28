/**
 * What `@nuxeo/satori-cli`'s tarball is: the fields of its published `package.json`, the files it
 * ships, the registry it is published to, and what a tarball of it may not hold. `build.mjs` writes
 * the published `package.json` from these; `pack-check.mjs` holds a packed one to them, in the
 * selftest and in `.github/workflows/publish-satori-cli.yml` before anything is published.
 */

/** Nuxeo's npm registry, which `@nuxeo/satori-platform` is published to too, and reads without a token. */
export const REGISTRY = 'https://packages.nuxeo.com/repository/npm-public/';

/**
 * The fields of the project's `package.json` the published one is given, in this order, and no
 * other: not `private`, which keeps the project's folder of sources from being published, and no
 * `scripts`, `dependencies` or `devDependencies`, so that installing the tool runs nothing of it and
 * fetches nothing else.
 */
export const PUBLISHED_FIELDS = [
  'name',
  'version',
  'description',
  'keywords',
  'license',
  'repository',
  'homepage',
  'type',
  'bin',
  'engines',
  'publishConfig',
];

/** The files the tool ships, its `files`: each is what `build.mjs` writes or carries. */
export const PUBLISHED_FILES = [
  'satori.mjs',
  'validator.mjs',
  'builder/',
  'config-package/',
  'schemas/',
  'platform/',
  'templates/',
  'agents/',
  'mcp.mjs',
  'mcp-generator.mjs',
  'generators/',
  'licenses/',
  'LICENSE',
  'README.md',
];

/** A path the tarball may not hold, and what it would be. */
const REFUSED_PATHS = [
  [/(?:^|\/)node_modules\//, 'a file of node_modules'],
  [/\.map$/, 'a source map'],
  [
    /(?:^|\/)(?:__fixtures__|fixtures?|__tests__|tests?|__snapshots__|e2e)\//,
    'a test or a fixture',
  ],
  [/\.(?:spec|test|stories)\.[cm]?[jt]sx?$/, 'a test'],
  [/(?:^|\/)\.(?:npmrc|env(?:\.[^/]*)?|git|DS_Store)(?:$|\/)/, "a working copy's hidden file"],
  [/\.(?:pem|key|p12|pfx|tgz|zip)$/, 'a key or an archive'],
];

/**
 * Text shaped like a secret, which no file of the tool may hold. Each pattern names the shape, not
 * a value: a key is generated, and a token assembled, at run time by the controls that plant one.
 */
const SECRET_SHAPES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'an npm token'],
  [/_authToken\s*=\s*(?!\$\{)[^\s'"`]+/, 'a registry token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
];

/**
 * What is wrong with a packed tarball, `[]` when nothing is. `pack` is one entry of
 * `npm pack --dry-run --json`, `{ files: [{ path, size, mode }] }`; `manifest` the `package.json` it
 * packs; `read(path)` the text of a packed file; `places` the folders of the machine that built it,
 * which no file may name.
 */
export function packProblems(pack, manifest, read, places = []) {
  const problems = [];
  const paths = pack.files.map((file) => file.path);

  // The published package.json.
  if ('private' in manifest) problems.push('package.json is "private", so it cannot be published.');
  if (manifest.name !== '@nuxeo/satori-cli')
    problems.push(`package.json names ${manifest.name}, not @nuxeo/satori-cli.`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? ''))
    problems.push(`package.json's version, ${manifest.version}, is not a version.`);
  // Exactly these two: a `tag` there would publish under it, whatever the workflow's --tag says.
  if (
    JSON.stringify(manifest.publishConfig) !==
    JSON.stringify({ access: 'public', registry: REGISTRY })
  )
    problems.push(
      `package.json's publishConfig is ${JSON.stringify(manifest.publishConfig)}, not { access: "public", registry: "${REGISTRY}" }.`,
    );
  if (manifest.engines?.node !== '>=24')
    problems.push(`package.json's engines.node is ${manifest.engines?.node}, not >=24.`);
  if (typeof manifest.license !== 'string' || manifest.license === '')
    problems.push('package.json names no licence.');
  if (
    manifest.license === 'Apache-2.0' &&
    !/Apache License\s+Version 2\.0, January 2004/.test(
      pack.files.some((file) => file.path === 'LICENSE') ? read('LICENSE') : '',
    )
  )
    problems.push("package.json names Apache-2.0, and LICENSE is not that licence's text.");
  if (manifest.bin?.satori !== 'satori.mjs' || Object.keys(manifest.bin ?? {}).length !== 1)
    problems.push(
      `package.json's bin is ${JSON.stringify(manifest.bin)}, not { satori: "satori.mjs" }.`,
    );
  for (const field of [
    'scripts',
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundleDependencies',
    'bundledDependencies',
  ])
    if (field in manifest)
      problems.push(
        `package.json has ${field}: the tool runs nothing when it is installed, and depends on nothing.`,
      );
  const extra = Object.keys(manifest).filter(
    (field) => field !== 'files' && !PUBLISHED_FIELDS.includes(field),
  );
  if (extra.length > 0)
    problems.push(`package.json has fields not published: ${extra.join(', ')}.`);
  if (JSON.stringify(manifest.files) !== JSON.stringify(PUBLISHED_FILES))
    problems.push(`package.json's files are ${JSON.stringify(manifest.files)}, not the tool's.`);

  // What is packed: what files names, and package.json, nothing else, and each of them.
  for (const path of paths) {
    const listed =
      path === 'package.json' ||
      PUBLISHED_FILES.some((entry) =>
        entry.endsWith('/') ? path.startsWith(entry) : path === entry,
      );
    if (!listed) problems.push(`${path} is packed, and is none of the files the tool ships.`);
    for (const [pattern, what] of REFUSED_PATHS)
      if (pattern.test(path)) problems.push(`${path} is packed, and is ${what}.`);
  }
  for (const entry of PUBLISHED_FILES)
    if (!paths.some((path) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry)))
      problems.push(`${entry} is not packed.`);
  const bin = paths.includes('satori.mjs') ? read('satori.mjs') : '';
  if (!bin.startsWith('#!/usr/bin/env node\n'))
    problems.push('satori.mjs, the bin, does not start with #!/usr/bin/env node.');
  // The registry's reader has no checkout: a link by a path of this repository leads nowhere.
  const readme = paths.includes('README.md') ? read('README.md') : '';
  const relative = [...readme.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:https:\/\/|#|mailto:)/.test(target));
  if (relative.length > 0)
    problems.push(
      `README.md links to ${relative.slice(0, 3).join(', ')}, which lead nowhere on the registry: link by https://.`,
    );

  // What the files say: nothing secret, and nothing of the machine that built them.
  for (const path of paths) {
    const text = read(path);
    for (const [pattern, what] of SECRET_SHAPES)
      if (pattern.test(text)) problems.push(`${path} holds text shaped like ${what}.`);
    for (const place of places)
      if (place.length > 1 && text.includes(place))
        problems.push(`${path} names ${place}, a folder of the machine that built it.`);
  }
  return problems;
}
