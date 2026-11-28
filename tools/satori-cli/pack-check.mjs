#!/usr/bin/env node
/**
 * Holds the tool's built folder to what its tarball may be, before anything is published:
 *
 *   node tools/satori-cli/pack-check.mjs <built folder>      dist/tools/satori-cli, say
 *
 * It asks npm what it would pack, `npm pack --dry-run --json`, from a folder of its own so that no
 * `.npmrc` of this repository is read, and then `published.mjs`'s `packProblems`: the published
 * `package.json` is public, names the Nuxeo registry, its bin, Node 24, a licence, and no script or
 * dependency; what is packed is the files the tool ships and nothing else, no source map, test,
 * fixture, key, archive, hidden file or file of `node_modules`; and no file holds text shaped like a
 * secret, or names this repository's folder or the home folder of the user who built it. It prints
 * each file with its size, then the tarball's.
 *
 * Run by the selftest, which sees each of its refusals, and by `publish-satori-cli.yml`'s build job.
 * Exit codes: 0, it may be published; 1, it may not; 2, it could not be checked.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnToolSync } from '../../scripts/beta-harness/package-command.mjs';
import { packProblems } from './published.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [folder, ...extra] = process.argv.slice(2);
if (folder === undefined || extra.length > 0) {
  console.error('usage: node tools/satori-cli/pack-check.mjs <built folder>');
  process.exit(2);
}
const built = resolve(folder);
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(built, 'package.json'), 'utf8'));
} catch (error) {
  console.error(`${folder} has no package.json to read: ${error.message}`);
  process.exit(2);
}

const away = mkdtempSync(join(tmpdir(), 'satori-cli-pack-check-'));
let pack;
try {
  const listed = spawnToolSync('npm', ['pack', built, '--dry-run', '--json'], {
    cwd: away,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    console.error(`npm pack --dry-run exited ${listed.status}:\n${listed.stderr ?? listed.error}`);
    process.exit(2);
  }
  [pack] = JSON.parse(listed.stdout);
} finally {
  rmSync(away, { recursive: true, force: true });
}

for (const file of pack.files) console.log(`${String(file.size).padStart(9)}  ${file.path}`);
console.log(
  `${pack.filename}: ${pack.entryCount} files, ${pack.size} bytes packed, ${pack.unpackedSize} unpacked.`,
);
const problems = packProblems(
  pack,
  manifest,
  (path) => readFileSync(join(built, ...path.split('/')), 'utf8'),
  [REPO.replace(/[\\/]$/, ''), homedir()],
);
if (problems.length > 0) {
  console.error(`\n${manifest.name}@${manifest.version} may not be published:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(
  `${manifest.name}@${manifest.version} may be published: its tarball holds what the tool ships, and nothing else.`,
);
