/**
 * The single-package `migrate`, held to what it printed and wrote before many packages could be
 * given in one run: `testing/migrate-single.golden.json` was written by this spec on the code of
 * `staging/enterprise-grade-app` at 7912b146e, before the batch was built, and the batch must not
 * change a byte of it.
 *
 * For each run on the made-up packages: its exit code, a SHA-256 of what it printed on each stream,
 * and one of every file it wrote. Each text is compared as written but for what differs from one
 * machine or one run to the next, which is replaced by a name in angle brackets before it is
 * hashed: the run's directories, the bundle's SHA-256, which follows the zlib that deflated the
 * made-up jar, and the platform's version range in `app.json`, which follows libs/platform.
 *
 * A change meant to change what a single run prints or writes writes the file again, and the
 * pull request says why:
 *
 *   UPDATE_MIGRATE_GOLDEN=1 npx vitest run --config tools/studio-migration/vitest.config.mts \
 *     tools/studio-migration/src/migrate-single.spec.ts
 *
 * Not on Windows: every file names its full paths, and there a path's separators and the quoting
 * `migrate` gives it differ. The comparisons with the commands run by hand, in migrate.spec.ts,
 * hold on every system.
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { main, type CliIo } from './cli';
import { packageBuildOf } from './convert';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';
import { writeZip } from './testing/zip-writer';

const GOLDEN = join(__dirname, 'testing', 'migrate-single.golden.json');
const UPDATE = process.env['UPDATE_MIGRATE_GOLDEN'] === '1';
const UI = 'web/nuxeo.war/ui';
/** Past Vitest's 5 seconds: some runs migrate a package twice. */
const SEVERAL_RUNS = 60_000;

// jsdom keeps every document a run parsed until the job that parsed it ends, and Vitest runs one
// synchronous test after another in one: a turn of the event loop after each lets them go.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

interface Recorded {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every file the run wrote, by its path under the run's directory, `/`-separated. */
  readonly files: Readonly<Record<string, string>>;
}

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** What differs between machines and runs, each by its name. */
type Volatile = readonly (readonly [string, string])[];

function normalised(text: string, volatile: Volatile): string {
  let result = text;
  // The longest first, so that a directory is never replaced inside a longer one.
  for (const [value, name] of [...volatile].sort(([a], [b]) => b.length - a.length))
    if (value !== '') result = result.split(value).join(name);
  return result;
}

/** The bundle's SHA-256 of a package, and the 12 characters a message gives of it. */
function bundleOf(data: Buffer): Volatile {
  const { bundle } = packageBuildOf(readStudioPackage(data));
  return [
    [bundle, '<bundle>'],
    [bundle.slice(0, 12), '<bundle12>'],
  ];
}

function filesUnder(directory: string, volatile: Volatile): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string): void => {
    let names: string[];
    try {
      names = readdirSync(folder).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const data = readFileSync(path);
        const key = relative(directory, path).split(sep).join('/');
        // Text is compared as written, less what is volatile; anything else, byte for byte.
        files[key] = key.endsWith('.png')
          ? sha(data)
          : sha(normalised(data.toString('utf8'), volatile));
      }
    }
  };
  walk(directory);
  return files;
}

/** A path for a run that does not exist yet. */
const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'studio-migrate-single-')), 'run');

function migrateRun(
  argv: readonly string[],
  given: Readonly<Record<string, Buffer>>,
  out: string,
  volatile: Volatile,
): Recorded {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    out: (text) => (stdout += text),
    err: (text) => (stderr += text),
    readFile: (path) => (Object.hasOwn(given, path) ? given[path] : readFileSync(path)),
  };
  const code = main(argv, io);
  // The platform's range is read from what the run wrote, where it wrote one.
  let platform: Volatile = [];
  try {
    const app = JSON.parse(readFileSync(join(out, 'conversion', 'app', 'app.json'), 'utf8')) as {
      platform?: string;
    };
    if (typeof app.platform === 'string') platform = [[app.platform, '<platform>']];
  } catch {
    // No conversion was written.
  }
  const all = [...volatile, ...platform];
  return {
    code,
    stdout: sha(normalised(stdout, all)),
    stderr: sha(normalised(stderr, all)),
    files: filesUnder(out, all),
  };
}

/** Fills in every decision of a decisions.json. */
function fill(path: string): void {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  for (const item of file.decisions) {
    item.owner = 'Migration lead';
    // A proposal is accepted or rejected, for a reason; a reported item is decided in words.
    item.decision = item.outcome === 'proposed' ? 'accept' : 'Rebuilt by hand';
    if (item.outcome === 'proposed') item.reason = 'The host has the function it calls';
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

const ALLOW = Buffer.from(JSON.stringify({ operations: ['Claim.Approve'] }));
const PACKAGES = {
  synthetic: (): Buffer => syntheticPackage(),
  m2: (): Buffer => syntheticPackage({ bundle: m2CorpusFiles() }),
};

/** Each run of the single-package command, by name: what it is given, and the directories it names. */
const SCENARIOS: Readonly<Record<string, () => Recorded>> = {
  ...Object.fromEntries(
    Object.entries(PACKAGES).flatMap(([name, make]) =>
      (
        [
          ['', []],
          [', with an allow-list', ['--allow-list', 'allow.json']],
        ] as const
      ).map(([label, allow]) => [
        `${name}${label}`,
        (): Recorded => {
          const data = make();
          const out = fresh();
          return migrateRun(
            ['migrate', 'acme.zip', '--out', out, ...allow],
            { 'acme.zip': data, 'allow.json': ALLOW },
            out,
            [[out, '<out>'], ...bundleOf(data)],
          );
        },
      ]),
    ),
  ),
  ...Object.fromEntries(
    Object.entries(PACKAGES).map(([name, make]) => [
      `${name}, carrying the decisions of an earlier run`,
      (): Recorded => {
        const data = make();
        const files = { 'acme.zip': data, 'allow.json': ALLOW };
        const earlier = fresh();
        expect(main(['migrate', 'acme.zip', '--out', earlier], quiet(files))).toBe(0);
        fill(join(earlier, 'conversion', 'decisions.json'));
        const out = fresh();
        return migrateRun(['migrate', 'acme.zip', '--out', out, '--from', earlier], files, out, [
          [out, '<out>'],
          [earlier, '<earlier>'],
          ...bundleOf(data),
        ]);
      },
    ]),
  ),
  'refused: --out holds an earlier run': () => {
    const data = PACKAGES.synthetic();
    const files = { 'acme.zip': data };
    const out = fresh();
    expect(main(['migrate', 'acme.zip', '--out', out], quiet(files))).toBe(0);
    const again = migrateRun(['migrate', 'acme.zip', '--out', out], files, out, [
      [out, '<out>'],
      ...bundleOf(data),
    ]);
    return { ...again, files: {} };
  },
  'refused: not a Studio package': () => {
    const out = fresh();
    return migrateRun(
      ['migrate', 'addon.zip', '--out', out],
      {
        'addon.zip': writeZip([
          {
            name: 'package.xml',
            data: '<package type="addon" name="acme-addon" version="1.0.0"/>',
          },
        ]),
      },
      out,
      [[out, '<out>']],
    );
  },
  'refused: a package that cannot be read': () => {
    const out = fresh();
    return migrateRun(['migrate', join(tmpdir(), 'no-such-package.zip'), '--out', out], {}, out, [
      [out, '<out>'],
      [tmpdir(), '<tmp>'],
    ]);
  },
  'refused: an allow-list that is not one': () => {
    const out = fresh();
    const data = PACKAGES.synthetic();
    return migrateRun(
      ['migrate', 'acme.zip', '--out', out, '--allow-list', 'bad.json'],
      { 'acme.zip': data, 'bad.json': Buffer.from('["Claim.Approve"]') },
      out,
      [[out, '<out>']],
    );
  },
  'refused at the conversion': () => {
    const data = syntheticPackage({
      bundle: {
        [`${UI}/themes/acme brand/theme.html`]:
          '<custom-style><style>html { --nuxeo-primary-color: #00796b; }</style></custom-style>',
      },
      without: [`${UI}/themes/acme/theme.html`, `${UI}/themes/acme/logo.png`],
    });
    const out = fresh();
    return migrateRun(['migrate', 'acme.zip', '--out', out], { 'acme.zip': data }, out, [
      [out, '<out>'],
      ...bundleOf(data),
    ]);
  },
  // Since decisions carry to a new build by their constructs' identities, another build of the
  // package carries them, where it was refused at its decisions step before.
  'carried to another build: --from an earlier build': () => {
    const first = PACKAGES.synthetic();
    const earlier = fresh();
    expect(main(['migrate', 'acme.zip', '--out', earlier], quiet({ 'acme.zip': first }))).toBe(0);
    fill(join(earlier, 'conversion', 'decisions.json'));
    const other = PACKAGES.m2();
    const out = fresh();
    return migrateRun(
      ['migrate', 'other.zip', '--out', out, '--from', earlier],
      { 'other.zip': other },
      out,
      [[out, '<out>'], [earlier, '<earlier>'], ...bundleOf(first), ...bundleOf(other)],
    );
  },
  'refused: --from another package': () => {
    const earlier = fresh();
    expect(
      main(['migrate', 'acme.zip', '--out', earlier], quiet({ 'acme.zip': PACKAGES.synthetic() })),
    ).toBe(0);
    const decisions = join(earlier, 'conversion', 'decisions.json');
    const file = JSON.parse(readFileSync(decisions, 'utf8'));
    const other = join(dirname(earlier), 'other.json');
    writeFileSync(other, JSON.stringify({ ...file, package: { ...file.package, name: 'Other' } }));
    const data = PACKAGES.synthetic();
    const out = fresh();
    return migrateRun(
      ['migrate', 'acme.zip', '--out', out, '--from', other],
      { 'acme.zip': data },
      out,
      [[out, '<out>'], [dirname(earlier), '<earlier>'], ...bundleOf(data)],
    );
  },
  'refused: --out is a file': () => {
    const out = join(mkdtempSync(join(tmpdir(), 'studio-migrate-single-')), 'run');
    writeFileSync(out, 'a file');
    const refused = migrateRun(
      ['migrate', 'acme.zip', '--out', out],
      { 'acme.zip': PACKAGES.synthetic() },
      out,
      [[out, '<out>']],
    );
    return { ...refused, files: {} };
  },
  'refused: --from holds no decisions.json': () => {
    const out = fresh();
    const nowhere = mkdtempSync(join(tmpdir(), 'studio-migrate-single-'));
    return migrateRun(
      ['migrate', 'acme.zip', '--out', out, '--from', nowhere],
      { 'acme.zip': PACKAGES.synthetic() },
      out,
      [
        [out, '<out>'],
        [nowhere, '<nowhere>'],
      ],
    );
  },
  'an empty --out, which is new enough': () => {
    const data = PACKAGES.synthetic();
    const out = mkdtempSync(join(tmpdir(), 'studio-migrate-single-'));
    return migrateRun(['migrate', 'acme.zip', '--out', out], { 'acme.zip': data }, out, [
      [out, '<out>'],
      ...bundleOf(data),
    ]);
  },
  'a check fails': () => {
    const data = syntheticPackage({
      bundle: {
        [`${UI}/themes/acme/theme.html`]:
          '<custom-style><style>html { --nuxeo-primary-color: #9e9e9e; --nuxeo-page-background: #ffffff; }</style></custom-style>',
      },
    });
    const out = fresh();
    return migrateRun(['migrate', 'acme.zip', '--out', out], { 'acme.zip': data }, out, [
      [out, '<out>'],
      ...bundleOf(data),
    ]);
  },
};

/** An io that keeps nothing, for a run a scenario needs before the one it records. */
function quiet(given: Readonly<Record<string, Buffer>>): CliIo {
  return {
    out: () => undefined,
    err: () => undefined,
    readFile: (path) => (Object.hasOwn(given, path) ? given[path] : readFileSync(path)),
  };
}

describe.skipIf(process.platform === 'win32')(
  'migrate on one package, held to what it printed and wrote before the batch',
  () => {
    const golden: Record<string, Recorded> = UPDATE
      ? {}
      : (JSON.parse(readFileSync(GOLDEN, 'utf8')) as { scenarios: Record<string, Recorded> })
          .scenarios;

    it.each(Object.keys(SCENARIOS))(
      '%s',
      (name) => {
        const recorded = SCENARIOS[name]();
        if (UPDATE) {
          golden[name] = recorded;
          return;
        }
        expect(recorded).toEqual(golden[name]);
      },
      SEVERAL_RUNS,
    );

    it('holds every scenario the golden file holds, and no other', () => {
      if (UPDATE) {
        mkdirSync(join(__dirname, 'testing'), { recursive: true });
        writeFileSync(
          GOLDEN,
          `${JSON.stringify(
            {
              about:
                'What the single-package migrate printed and wrote, as SHA-256s: migrate-single.spec.ts says how it is made, and when to make it again.',
              scenarios: golden,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }
      expect(Object.keys(golden).sort()).toEqual(Object.keys(SCENARIOS).sort());
    });
  },
);
