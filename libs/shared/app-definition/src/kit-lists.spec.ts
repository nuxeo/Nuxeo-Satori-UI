import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PARITY, REPO, kitNames } from './server-validator-build.mjs';

// The lists of kits kept outside a kit's own folder, held to the folders: a new kit left out of
// one was left out in silence (the moves kit's Phase 8 feedback, item 16). The server validator's
// parity corpus takes its kits from the folders, and its committed copy must have them all; the
// administrator's guide names each kit in its table of packages and its table of groups, and
// links its README.

const KITS = join(REPO, 'business-apps', 'packages');
const GUIDE = join(REPO, 'docs', 'business-apps', 'administrator-guide.md');
const CONFIG = join('bundle', 'agentic-ui-config');

/** The kits a parity corpus, as committed, has: its `kits` and each case's. */
function corpusKits(corpus: string): Set<string> {
  const parsed = JSON.parse(corpus) as { kits: Record<string, unknown>; cases: { kit: string }[] };
  return new Set([...Object.keys(parsed.kits), ...parsed.cases.map((each) => each.kit)]);
}

/**
 * The rows of the guide's table under `heading`, each as its first cell: the table that follows
 * the heading line, up to the first line that is not one of its rows.
 */
function firstCells(guide: string, heading: string): string[] {
  const lines = guide.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`the guide has no heading "${heading}"`);
  const table = lines.slice(start + 1).findIndex((line) => line.startsWith('|'));
  if (table === -1) throw new Error(`the guide has no table under "${heading}"`);
  const rows: string[] = [];
  for (const line of lines.slice(start + 1 + table)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|')[1].trim());
  }
  // Its header and the line under it are not rows.
  return rows.slice(2);
}

/** A kit's package name, from its `package.xml`, and its app's id, from its `app.json`. */
function namesOf(root: string, kit: string): { packageName: string; appId: string } {
  const descriptor = readFileSync(join(root, kit, 'package', 'package.xml'), 'utf8');
  const packageName = /<package\s[^>]*name="([^"]+)"/.exec(descriptor)?.[1];
  const app = JSON.parse(readFileSync(join(root, kit, CONFIG, 'app.json'), 'utf8')) as {
    id?: unknown;
  };
  if (!packageName || typeof app.id !== 'string') throw new Error(`${kit}: no name or no app id`);
  return { packageName, appId: app.id };
}

/** What the guide leaves out of each kit, by kit: its package, its app's groups, its README. */
function missingFromGuide(root: string, kits: readonly string[], guide: string): string[] {
  const packages = firstCells(guide, '## 1. What there is to install');
  const groups = firstCells(guide, "### The app registry's groups");
  return kits.flatMap((kit) => {
    const { packageName, appId } = namesOf(root, kit);
    const missing: string[] = [];
    if (!packages.some((cell) => cell === `\`${packageName}\``))
      missing.push(`${kit}: no row for \`${packageName}\` in section 1's table of packages`);
    if (!groups.some((cell) => cell.split(',')[0].trim() === `\`${appId}\``))
      missing.push(
        `${kit}: no row for the app \`${appId}\` in the table of the app registry's groups`,
      );
    if (!guide.includes(`(../../business-apps/packages/${kit}/README.md)`))
      missing.push(`${kit}: its README is not linked`);
    return missing;
  });
}

/**
 * Every kit the guide lists: each folder of `root` with an app definition, a model of its own or
 * not. The corpus takes only those with a model, which its cases are held to (`kitNames`).
 */
function appFolders(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, entry.name, CONFIG, 'app.json')),
    )
    .map((entry) => entry.name)
    .sort();
}

describe('every list of kits kept outside the kits', () => {
  const kits = kitNames();

  it('finds the kits, from their folders', () => {
    expect(appFolders(KITS)).toEqual(expect.arrayContaining(kits));
    expect(kits).toEqual(
      expect.arrayContaining([
        'brand-assets-demo',
        'contracts-demo',
        'facilities-demo',
        'moves-demo',
        'onboarding-demo',
        'payers-claims-demo',
        'pc-claims-demo',
        'vehicle-titles-demo',
      ]),
    );
  });

  it('has every kit in the parity corpus as committed', () => {
    const held = corpusKits(readFileSync(PARITY, 'utf8'));
    expect(kits.filter((kit) => !held.has(kit))).toEqual([]);
  });

  it("has every kit in the administrator's guide, one on a server's model too", () => {
    expect(missingFromGuide(KITS, appFolders(KITS), readFileSync(GUIDE, 'utf8'))).toEqual([]);
  });

  describe('a new kit, left out of each list, is found', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'kit-lists-'));
      // A kit: a folder with an app definition and a content model.
      for (const [kit, id] of [
        ['alpha-demo', 'alpha'],
        ['new-demo', 'newest'],
      ]) {
        mkdirSync(join(root, kit, CONFIG), { recursive: true });
        mkdirSync(join(root, kit, 'package'), { recursive: true });
        writeFileSync(join(root, kit, CONFIG, 'app.json'), JSON.stringify({ id }));
        writeFileSync(join(root, kit, 'content-model.json'), '{}');
        writeFileSync(
          join(root, kit, 'package', 'package.xml'),
          `<package type="addon" name="${kit}" version="0.1.0"></package>`,
        );
      }
      // A kit on a server's model: no content model of its own, so in no corpus, but in the guide.
      mkdirSync(join(root, 'server-app', CONFIG), { recursive: true });
      mkdirSync(join(root, 'server-app', 'package'), { recursive: true });
      writeFileSync(join(root, 'server-app', CONFIG, 'app.json'), JSON.stringify({ id: 'served' }));
      writeFileSync(
        join(root, 'server-app', 'package', 'package.xml'),
        '<package type="addon" name="server-app" version="0.1.0"></package>',
      );
      // Not a kit: no app definition.
      mkdirSync(join(root, 'demo-server'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('by the corpus, which takes every folder holding an app definition and a model', () => {
      expect(kitNames(root)).toEqual(['alpha-demo', 'new-demo']);
      const committed = JSON.stringify({ kits: { 'alpha-demo': {} }, cases: [] });
      const held = corpusKits(committed);
      expect(kitNames(root).filter((kit) => !held.has(kit))).toEqual(['new-demo']);
    });

    it('by the guide, in each table and among the READMEs', () => {
      const guide = [
        '## 1. What there is to install',
        '',
        '| Package | What it is |',
        '| ------- | ---------- |',
        '| `alpha-demo` | A kit |',
        '',
        '[alpha](../../business-apps/packages/alpha-demo/README.md)',
        '',
        "### The app registry's groups",
        '',
        '| App, and its address | Groups |',
        '| -------------------- | ------ |',
        '| `alpha`, at `alpha-desk` | `alpha-team` |',
        '',
      ].join('\n');
      expect(appFolders(root)).toEqual(['alpha-demo', 'new-demo', 'server-app']);
      expect(missingFromGuide(root, appFolders(root), guide)).toEqual([
        "new-demo: no row for `new-demo` in section 1's table of packages",
        "new-demo: no row for the app `newest` in the table of the app registry's groups",
        'new-demo: its README is not linked',
        "server-app: no row for `server-app` in section 1's table of packages",
        "server-app: no row for the app `served` in the table of the app registry's groups",
        'server-app: its README is not linked',
      ]);
    });
  });
});
