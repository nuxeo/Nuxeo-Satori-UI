import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  folderName,
  migrateMany,
  RESULTS,
  SUMMARY_FORMAT,
  type BatchRequest,
  type BatchSummary,
} from './batch';
import { commandLine, main, type CliIo } from './cli';
import { migrateOne, shell, type Command } from './migrate';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';
import { writeZip } from './testing/zip-writer';

const UI = 'web/nuxeo.war/ui';
/** Past Vitest's 5 seconds: each test migrates several packages, some of them more than once. */
const SEVERAL_RUNS = 120_000;

/** The made-up packages, each a build of its own. */
const SOUND = syntheticPackage();
const CORPUS = syntheticPackage({ bundle: m2CorpusFiles() });
/** Its theme's brand colour is below WCAG 2.1 AA on its background: check 8 fails. */
const LOW_CONTRAST = syntheticPackage({
  bundle: {
    [`${UI}/themes/acme/theme.html`]:
      '<custom-style><style>html { --nuxeo-primary-color: #9e9e9e; --nuxeo-page-background: #ffffff; }</style></custom-style>',
  },
});
const NOT_A_ZIP = Buffer.from('Not an archive at all');
const ADDON = writeZip([
  { name: 'package.xml', data: '<package type="addon" name="acme-addon" version="1.0.0"/>' },
]);

interface Printed {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

const io = (): CliIo & { printed: () => Printed & { code: 0 } } => {
  let out = '';
  let err = '';
  return {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => readFileSync(path),
    printed: () => ({ code: 0, out, err }),
  };
};

/** The command line, as a person types it: several packages run asynchronously. */
async function run(argv: readonly string[]): Promise<Printed> {
  const given = io();
  const code = await commandLine(argv, given);
  return { ...given.printed(), code };
}

/** The batch itself, its steps run by another command than `main`, or its runs by another than `migrateOne`. */
async function runWith(
  request: BatchRequest,
  command: Command,
  one?: Parameters<typeof migrateMany>[3],
): Promise<Printed> {
  const given = io();
  const code = await migrateMany(request, given, command, one);
  return { ...given.printed(), code };
}

/** A new folder, holding these files. */
function folder(files: Readonly<Record<string, Buffer>> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'studio-batch-'));
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(join(directory, name, '..'), { recursive: true });
    writeFileSync(join(directory, name), data);
  }
  return directory;
}

/** A path for a run that does not exist yet. */
const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'studio-batch-out-')), 'run');

/** Every file under a directory, by its `/`-separated path there, with its text, `root` as `<out>`. */
function tree(directory: string, root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else
        files.set(
          relative(directory, path).split(sep).join('/'),
          readFileSync(path).toString('latin1').split(root).join('<out>'),
        );
    }
  };
  walk(directory);
  return files;
}

const summaryOf = (out: string): BatchSummary =>
  JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as BatchSummary;

/** Fills in every decision of a decisions.json. */
function fill(path: string): void {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  for (const item of file.decisions) {
    item.owner = 'Migration lead';
    item.decision = 'Rebuilt by hand';
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

describe('migrate, given several packages', () => {
  it(
    'runs each into a folder of its own, byte for byte as migrate runs that package alone, and keeps what each printed',
    async () => {
      const given = folder({ 'claims.zip': SOUND, 'policies.zip': CORPUS });
      const out = fresh();
      const batch = await run([
        'migrate',
        join(given, 'claims.zip'),
        join(given, 'policies.zip'),
        '--out',
        out,
      ]);
      expect(batch).toMatchObject({ code: 0, err: '' });
      expect(readdirSync(out).sort()).toEqual([
        'packages',
        'printed',
        'summary.json',
        'summary.txt',
      ]);
      expect(readdirSync(join(out, 'packages')).sort()).toEqual(['claims', 'policies']);

      // Each package on its own, into the very folder the batch gave it, the batch moved away.
      renameSync(out, `${out}-batch`);
      for (const name of ['claims', 'policies']) {
        const alone = await run([
          'migrate',
          join(given, `${name}.zip`),
          '--out',
          join(out, 'packages', name),
        ]);
        expect(alone.code).toBe(0);
        // Both were written at the same path, so they name the same one.
        expect(tree(join(`${out}-batch`, 'packages', name), out)).toEqual(
          tree(join(out, 'packages', name), out),
        );
        // What it printed is what that run prints, in the order printed.
        expect(readFileSync(join(`${out}-batch`, 'printed', `${name}.txt`), 'utf8')).toBe(
          alone.out + alone.err,
        );
      }
    },
    SEVERAL_RUNS,
  );

  it(
    "gives every package the deployment's allow-list, as a run of that package alone is given it",
    async () => {
      const given = folder({
        'claims.zip': SOUND,
        'policies.zip': CORPUS,
        'allow.json': Buffer.from(JSON.stringify({ operations: ['Claim.Approve'] })),
      });
      const allow = join(given, 'allow.json');
      const out = fresh();
      const batch = await run(['migrate', given, '--out', out, '--allow-list', allow]);
      expect(batch.code).toBe(0);
      expect(summaryOf(out).allowList).toBe(allow);
      // The made-up package's button runs Claim.Approve: with the list, it becomes an action.
      expect(existsSync(join(out, 'packages', 'claims', 'conversion', 'app', 'actions.json'))).toBe(
        true,
      );
      renameSync(out, `${out}-batch`);
      for (const name of ['claims', 'policies']) {
        const alone = await run([
          'migrate',
          join(given, `${name}.zip`),
          '--out',
          join(out, 'packages', name),
          '--allow-list',
          allow,
        ]);
        expect(alone.code).toBe(0);
        expect(tree(join(`${out}-batch`, 'packages', name), out)).toEqual(
          tree(join(out, 'packages', name), out),
        );
      }
      expect(batch.out).toContain(` --allow-list ${shell(allow)} --from `);
    },
    SEVERAL_RUNS,
  );

  it(
    'writes a summary of every package: its result, its constructs by outcome as its report counts them, and its report',
    async () => {
      const given = folder({
        'a-claims.zip': SOUND,
        'b-policies.zip': CORPUS,
        'c-theme.zip': LOW_CONTRAST,
        'd-addon.zip': ADDON,
      });
      const out = fresh();
      const batch = await run(['migrate', given, '--out', out]);
      // What it prints is the summary, byte for byte.
      expect(batch.out).toBe(readFileSync(join(out, 'summary.txt'), 'utf8'));
      const summary = summaryOf(out);
      expect(summary).toMatchObject({ format: SUMMARY_FORMAT, out, allowList: null, from: null });
      expect(summary.packages.map((entry) => [entry.number, entry.given, entry.result])).toEqual([
        [1, join(given, 'a-claims.zip'), 'not ready'],
        [2, join(given, 'b-policies.zip'), 'not ready'],
        [3, join(given, 'c-theme.zip'), 'check failed'],
        [4, join(given, 'd-addon.zip'), 'stopped'],
      ]);
      for (const entry of summary.packages.slice(0, 3)) {
        // Its counts are its report's own `all` row.
        const report = readFileSync(join(out, entry.report as string), 'utf8');
        const all = /\n {2}all +(.+)\n/.exec(report)?.[1].trim().split(/ +/).map(Number);
        const headings = /\n {2}kind +(.+)\n/.exec(report)?.[1].trim().split(/ +/) ?? [];
        const counts = entry.constructs as NonNullable<typeof entry.constructs>;
        expect(all).toBeDefined();
        headings.forEach((heading, index) =>
          expect([heading, counts[heading as keyof typeof counts]]).toEqual([
            heading,
            all?.[index],
          ]),
        );
        expect(batch.out).toContain(`\n     The report: ${join(out, entry.report as string)}\n`);
        expect(batch.out).toContain(
          `\n     ${counts.total} constructs: converted ${counts.converted}, `,
        );
      }
      expect(summary.packages[2]).toMatchObject({ checksFailed: [8], exitCode: 1 });
      expect(batch.out).toContain(`\n3. ${join(given, 'c-theme.zip')}: check 8 failed\n`);
      expect(summary.packages[3]).toMatchObject({
        stoppedAt: { step: 1, title: 'The inventory' },
        package: null,
        report: null,
        constructs: null,
        folder: null,
        printed: 'printed/d-addon.txt',
      });
      expect(readFileSync(join(out, 'printed', 'd-addon.txt'), 'utf8')).toContain(
        'package.xml declares a "addon" package, not a Studio package',
      );
      expect(batch.out).toContain(
        `\n4. ${join(given, 'd-addon.zip')}: stopped at step 1, the inventory\n`,
      );
      expect(batch.out).toMatch(
        /\nSummary: 4 packages given, 4 run\n {2}ready +0\n {2}not ready, and no check failed +2\n {2}a check failed +1\n {2}stopped +1\nThe worst: stopped\. Exit code 1\.\n/,
      );
      expect(batch.out).toContain('\n  1. Package 4 stopped: read what it printed');
      expect(batch.out).toContain('\n  2. Package 3 failed a check: read what the checks found');
      expect(batch.out).toContain(
        `carrying them: npm run studio-migration -- migrate ${shell(given)} --out ${shell(`${out}-2`)} --from ${shell(out)}\n`,
      );
    },
    SEVERAL_RUNS,
  );

  describe('keeps each package to itself', () => {
    it(
      'a broken package among sound ones: it stops, and changes nothing the others write or print',
      async () => {
        const sound = folder({ 'claims.zip': SOUND, 'policies.zip': CORPUS });
        const broken = folder({
          'claims.zip': SOUND,
          'damaged.zip': NOT_A_ZIP,
          'mistaken.zip': ADDON,
          'policies.zip': CORPUS,
        });
        const without = fresh();
        expect((await run(['migrate', sound, '--out', without])).code).toBe(0);
        const among = fresh();
        const ran = await run(['migrate', broken, '--out', among]);
        expect(ran.code).toBe(1);
        expect(summaryOf(among).packages.map((entry) => entry.result)).toEqual([
          'not ready',
          'stopped',
          'stopped',
          'not ready',
        ]);
        for (const name of ['claims', 'policies']) {
          expect(tree(join(among, 'packages', name), among)).toEqual(
            tree(join(without, 'packages', name), without),
          );
          // Each names its package by the folder it was given in, which differs.
          expect(
            readFileSync(join(among, 'printed', `${name}.txt`), 'utf8')
              .split(among)
              .join('<out>')
              .split(broken)
              .join('<in>'),
          ).toBe(
            readFileSync(join(without, 'printed', `${name}.txt`), 'utf8')
              .split(without)
              .join('<out>')
              .split(sound)
              .join('<in>'),
          );
        }
      },
      SEVERAL_RUNS,
    );

    it(
      'a package whose check fails, or whose run meets a defect, ends alone, and the next runs as it would have',
      async () => {
        const given = folder({ 'a.zip': LOW_CONTRAST, 'b.zip': SOUND, 'c.zip': CORPUS });
        const alone = fresh();
        expect(
          (await run(['migrate', join(given, 'b.zip'), join(given, 'c.zip'), '--out', alone])).code,
        ).toBe(0);
        // A command whose report step throws for package a: a defect of the tool, in one run.
        const throwing: Command = (argv, given) => {
          if (argv[0] === 'report' && argv[1].endsWith('a.zip')) throw new Error('a defect');
          return main(argv, given);
        };
        const out = fresh();
        const ran = await runWith(
          { packages: [join(given, 'a.zip'), join(given, 'b.zip'), join(given, 'c.zip')], out },
          throwing,
        );
        expect(ran.code).toBe(1);
        const [a] = summaryOf(out).packages;
        expect(a).toMatchObject({ result: 'stopped', stoppedAt: { step: 4, title: 'The report' } });
        expect(readFileSync(join(out, 'printed', 'a.txt'), 'utf8')).toContain('Error: a defect');
        for (const name of ['b', 'c'])
          expect(tree(join(out, 'packages', name), out)).toEqual(
            tree(join(alone, 'packages', name), alone),
          );

        // And a check that fails ends that package alone too.
        const failing = fresh();
        const checked = await run(['migrate', given, '--out', failing]);
        expect(checked.code).toBe(1);
        expect(summaryOf(failing).packages.map((entry) => entry.result)).toEqual([
          'check failed',
          'not ready',
          'not ready',
        ]);
        for (const name of ['b', 'c'])
          expect(tree(join(failing, 'packages', name), failing)).toEqual(
            tree(join(alone, 'packages', name), alone),
          );
      },
      SEVERAL_RUNS,
    );

    it(
      'a defect outside every step of a run ends that package alone, and says it was a defect',
      async () => {
        const given = folder({ 'a.zip': SOUND, 'b.zip': CORPUS });
        const alone = fresh();
        expect(
          (await run(['migrate', join(given, 'b.zip'), join(given, 'b.zip'), '--out', alone])).code,
        ).toBe(0);
        // The run of one package itself throws for package a, outside any of its steps.
        const throwing: typeof migrateOne = (request, given, command) => {
          if (request.package.endsWith('a.zip')) throw new Error('a defect outside every step');
          return migrateOne(request, given, command);
        };
        const out = fresh();
        const ran = await runWith(
          { packages: [join(given, 'a.zip'), join(given, 'b.zip')], out },
          main,
          throwing,
        );
        expect(ran.code).toBe(1);
        const [a, b] = summaryOf(out).packages;
        expect(a).toMatchObject({
          result: 'stopped',
          defect: true,
          stoppedAt: { step: 0, title: null },
        });
        expect(ran.out).toContain(
          `\n1. ${join(given, 'a.zip')}: stopped by a defect of the tool\n`,
        );
        expect(readFileSync(join(out, 'printed', 'a.txt'), 'utf8')).toContain(
          'Error: a defect outside every step',
        );
        expect(b).toMatchObject({ result: 'not ready' });
        expect(tree(join(out, 'packages', 'b'), out)).toEqual(
          tree(join(alone, 'packages', 'b'), alone),
        );
      },
      SEVERAL_RUNS,
    );

    it(
      'lets the event loop turn after each package, so that what its run parsed is freed before the next',
      async () => {
        const given = folder({ 'a.zip': SOUND, 'b.zip': CORPUS, 'c.zip': LOW_CONTRAST });
        let turns = 0;
        const seen: number[] = [];
        // Each run counts the turns before it, and asks for one more.
        const counting: typeof migrateOne = (request, given, command) => {
          seen.push(turns);
          setImmediate(() => turns++);
          return migrateOne(request, given, command);
        };
        await runWith({ packages: [given], out: fresh() }, main, counting);
        expect(seen).toEqual([0, 1, 2]);
      },
      SEVERAL_RUNS,
    );

    it(
      'reads each package once, and gives its run those bytes',
      async () => {
        const given = folder({ 'a.zip': SOUND, 'b.zip': CORPUS });
        const reads: string[] = [];
        const counting: CliIo = {
          out: () => undefined,
          err: () => undefined,
          readFile: (path) => {
            reads.push(path);
            return readFileSync(path);
          },
        };
        expect(await migrateMany({ packages: [given], out: fresh() }, counting, main)).toBe(0);
        for (const name of ['a.zip', 'b.zip'])
          expect(reads.filter((path) => path === join(given, name))).toHaveLength(1);
      },
      SEVERAL_RUNS,
    );
  });

  describe('its exit code, the worst of its packages', () => {
    it.each([
      [
        'every package ran, and no check failed',
        { 'a.zip': SOUND, 'b.zip': CORPUS },
        0,
        'not ready',
      ],
      ['a check failed in one', { 'a.zip': SOUND, 'b.zip': LOW_CONTRAST }, 1, 'check failed'],
      [
        'one stopped, another failed a check',
        { 'a.zip': NOT_A_ZIP, 'b.zip': LOW_CONTRAST, 'c.zip': SOUND },
        1,
        'stopped',
      ],
      ['one stopped', { 'a.zip': SOUND, 'b.zip': ADDON }, 1, 'stopped'],
    ] as const)(
      '%s',
      async (_, files, code, worst) => {
        const out = fresh();
        expect((await run(['migrate', folder(files), '--out', out])).code).toBe(code);
        expect(summaryOf(out)).toMatchObject({ exitCode: code, worst });
      },
      SEVERAL_RUNS,
    );

    it('orders its results best first, as the worst is found', async () => {
      expect(RESULTS).toEqual(['ready', 'not ready', 'check failed', 'stopped']);
    });

    it('refuses, before writing anything, an --out that holds files, a folder of no package, an allow-list or an earlier run it cannot use, and exits 1', async () => {
      const given = folder({
        'a.zip': SOUND,
        'b.zip': CORPUS,
        'bad.json': Buffer.from('["Claim.Approve"]'),
      });
      const holding = folder({ 'note.txt': Buffer.from('mine') });
      const empty = folder({ 'notes.txt': Buffer.from('no package here'), '.hidden.zip': SOUND });
      const single = fresh();
      expect((await run(['migrate', join(given, 'a.zip'), '--out', single])).code).toBe(0);
      for (const [argv, problem] of [
        [[given, '--out', holding], `${holding} already holds files`],
        [[empty, '--out', fresh()], `the folder ${empty} holds no .zip file`],
        [
          [given, '--out', fresh(), '--allow-list', join(given, 'bad.json')],
          'is not one it can use',
        ],
        [
          [given, '--out', fresh(), '--from', single],
          `${single} is not an earlier run of several packages`,
        ],
        [
          [given, '--out', fresh(), '--from', join(fresh(), 'nowhere')],
          'is not an earlier run of several packages',
        ],
      ] as const) {
        const out = argv[argv.indexOf('--out') + 1];
        const before = existsSync(out) ? readdirSync(out) : null;
        const refused = await run(['migrate', ...argv]);
        expect(refused).toMatchObject({ code: 1, out: '' });
        expect(refused.err).toContain(problem);
        expect(refused.err).toContain('Nothing was written.');
        expect(existsSync(out) ? readdirSync(out) : null).toEqual(before);
      }
    });

    it('exits 2 when the command is wrong: several packages and no --out', async () => {
      const given = folder({ 'a.zip': SOUND });
      for (const argv of [
        ['migrate', join(given, 'a.zip'), join(given, 'a.zip')],
        ['migrate', given],
        ['migrate', given, '--out'],
      ]) {
        const wrong = await run(argv);
        expect(wrong.code).toBe(2);
        expect(wrong.err).toContain(
          '\n  studio-migration migrate <package.zip or folder>... --out <new-directory>',
        );
      }
    });
  });

  describe('duplicates', () => {
    it(
      'runs the same package once, however it is named or given, and says so',
      async () => {
        const given = folder({ 'claims.zip': SOUND, 'copy-of-claims.zip': SOUND });
        const out = fresh();
        const ran = await run([
          'migrate',
          join(given, 'claims.zip'),
          given,
          join(given, 'claims.zip'),
          '--out',
          out,
        ]);
        expect(ran.code).toBe(0);
        const { packages } = summaryOf(out);
        expect(
          packages.map((entry) => [entry.given, entry.result, entry.sameAs, entry.folder]),
        ).toEqual([
          [join(given, 'claims.zip'), 'not ready', undefined, 'packages/claims'],
          [join(given, 'claims.zip'), 'the same package', 1, null],
          [join(given, 'copy-of-claims.zip'), 'the same package', 1, null],
          [join(given, 'claims.zip'), 'the same package', 1, null],
        ]);
        expect(readdirSync(join(out, 'packages'))).toEqual(['claims']);
        expect(ran.out).toContain(
          `\n3. ${join(given, 'copy-of-claims.zip')}: the same package as 1, byte for byte, so it was not run again\n`,
        );
        expect(ran.out).toContain(
          '\nSummary: 4 packages given, 1 run, and 3 the same as another\n',
        );
      },
      SEVERAL_RUNS,
    );

    it(
      'gives two files of one name their own folders, told apart as a file system that ignores case would',
      async () => {
        // Three folders, as one cannot hold two names that differ by case alone on every system.
        const one = folder({ 'claims.zip': SOUND });
        const two = folder({ 'Claims.ZIP': CORPUS });
        const three = folder({ 'claims.zip': LOW_CONTRAST });
        const out = fresh();
        await run(['migrate', one, two, three, '--out', out]);
        const { packages, sameNameAndVersion } = summaryOf(out);
        expect(packages.map((entry) => [entry.result, entry.folder])).toEqual([
          ['not ready', 'packages/claims'],
          ['not ready', 'packages/Claims-2'],
          ['check failed', 'packages/claims-3'],
        ]);
        expect(readdirSync(join(out, 'packages')).sort()).toEqual([
          'Claims-2',
          'claims',
          'claims-3',
        ]);
        // One name and version from different bytes: each runs, and the summary says so.
        expect(sameNameAndVersion).toEqual([{ package: 'Acme-Claims 1.0.0', numbers: [1, 2, 3] }]);
        expect(readFileSync(join(out, 'summary.txt'), 'utf8')).toContain(
          '\nOne name and version, different bytes: 1, 2 and 3 each declare Acme-Claims 1.0.0, most often as builds of it.',
        );
      },
      SEVERAL_RUNS,
    );

    it('names folders with what a file name holds on every system, numbered past those taken', async () => {
      const taken = new Set<string>();
      expect(
        [
          '/a/claims.zip',
          '/b/CLAIMS.zip',
          '/c/claims-2.zip',
          '/d/my claims (1).zip',
          '/e/.zip',
          '/f/..zip',
          '/g/CON.zip',
          '/h/claims..zip',
          '/i/nul.txt.zip',
          '/j/Lpt9.zip',
          '/k/com10.zip',
        ].map((path) => folderName(path, taken)),
      ).toEqual([
        'claims',
        'CLAIMS-2',
        'claims-2-2',
        'my-claims--1-',
        'package',
        'package-2',
        // Windows keeps these names for its devices, and drops a name's last dots.
        '_CON',
        'claims-3',
        '_nul.txt',
        '_Lpt9',
        'com10',
      ]);
    });
  });

  it(
    'takes the .zip files of a folder in the order of their names, and lists what else it holds',
    async () => {
      const given = folder({
        'b.zip': CORPUS,
        'A.zip': SOUND,
        'notes.txt': Buffer.from('notes'),
        '.DS_Store': Buffer.from('the system’s'),
        '._b.zip': Buffer.from('a Mac’s attributes of b.zip'),
        'old/c.zip': SOUND,
      });
      const out = fresh();
      const ran = await run(['migrate', given, '--out', out]);
      expect(ran.code).toBe(0);
      const summary = summaryOf(out);
      expect(summary.packages.map((entry) => entry.given)).toEqual([
        join(given, 'A.zip'),
        join(given, 'b.zip'),
      ]);
      expect(summary.leftOut).toEqual([{ folder: given, entries: ['notes.txt', 'old'] }]);
      expect(ran.out).toContain(`\nLeft out of ${given}, as no .zip file: notes.txt, old\n`);
    },
    SEVERAL_RUNS,
  );

  it(
    'carries each package its own decisions from an earlier run of several, by its build, and says where none were',
    async () => {
      const given = folder({ 'claims.zip': SOUND, 'policies.zip': CORPUS });
      // An earlier run of several: the claims package alone, its decisions filled in.
      const first = fresh();
      expect(
        (
          await run([
            'migrate',
            join(given, 'claims.zip'),
            join(given, 'claims.zip'),
            '--out',
            first,
          ])
        ).code,
      ).toBe(0);
      fill(join(first, 'packages', 'claims', 'conversion', 'decisions.json'));
      const before = tree(first, first);

      // The policies package first now, and the claims package renamed: matched by its build.
      const renamed = folder({ 'claims-renamed.zip': SOUND });
      const out = fresh();
      const ran = await run([
        'migrate',
        join(given, 'policies.zip'),
        join(renamed, 'claims-renamed.zip'),
        '--out',
        out,
        '--from',
        first,
      ]);
      expect(ran.code).toBe(0);
      const [policies, claims] = summaryOf(out).packages;
      expect(policies).toMatchObject({ carriedFrom: null });
      expect(claims).toMatchObject({
        carriedFrom: 'packages/claims',
        folder: 'packages/claims-renamed',
      });
      expect(claims.constructs?.decided).toBe(claims.constructs?.reported);
      expect(policies.constructs?.decided).toBe(0);
      expect(ran.out).toContain(
        `\n     Carried what still holds of the decisions of ${join(first, 'packages', 'claims')}\n`,
      );
      expect(ran.out).toContain(
        `\n     Nothing carried: ${first} holds no decisions for this package as it is now, so they start again\n`,
      );
      // The earlier run is only read.
      expect(tree(first, first)).toEqual(before);
      // As by hand: the same package on its own, carrying that run's decisions.
      const alone = fresh();
      expect(
        (
          await run([
            'migrate',
            join(renamed, 'claims-renamed.zip'),
            '--out',
            alone,
            '--from',
            join(first, 'packages', 'claims'),
          ])
        ).code,
      ).toBe(0);
      expect(
        readFileSync(
          join(out, 'packages', 'claims-renamed', 'conversion', 'decisions.json'),
          'utf8',
        ),
      ).toBe(readFileSync(join(alone, 'conversion', 'decisions.json'), 'utf8'));
    },
    SEVERAL_RUNS,
  );

  it(
    'carries by the build when the bytes differ, as a run of one package does, and refuses a summary that lists no packages',
    async () => {
      // The same build, zipped with one more file beside its bundle: other bytes, the same build.
      const rezipped = syntheticPackage({ package: { 'notes.txt': 'kept beside the bundle' } });
      const given = folder({ 'claims.zip': SOUND });
      const first = fresh();
      expect((await run(['migrate', given, '--out', first])).code).toBe(0);
      fill(join(first, 'packages', 'claims', 'conversion', 'decisions.json'));
      const again = folder({ 'claims.zip': rezipped });
      const out = fresh();
      const ran = await run(['migrate', again, '--out', out, '--from', first]);
      expect(ran.code).toBe(0);
      const [claims] = summaryOf(out).packages;
      expect(claims).toMatchObject({ carriedFrom: 'packages/claims' });
      expect(claims.sha256).not.toBe(summaryOf(first).packages[0].sha256);
      expect(claims.build).toEqual(summaryOf(first).packages[0].build);
      expect(claims.constructs?.decided).toBeGreaterThan(0);

      const listless = fresh();
      mkdirSync(listless, { recursive: true });
      writeFileSync(join(listless, 'summary.json'), JSON.stringify({ format: SUMMARY_FORMAT }));
      const refused = await run(['migrate', again, '--out', fresh(), '--from', listless]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('lists no packages. Nothing was written.');
    },
    SEVERAL_RUNS,
  );

  it(
    'says a package it cannot read cannot be read, and runs the others',
    async () => {
      const given = folder({ 'claims.zip': SOUND });
      const missing = join(given, 'no-such-package.zip');
      const out = fresh();
      const ran = await run(['migrate', join(given, 'claims.zip'), missing, '--out', out]);
      expect(ran.code).toBe(1);
      expect(ran.out).toContain(
        `\n2. ${missing}: stopped before its first step\n     It cannot be read, and nothing was written for it\n`,
      );
      expect(readFileSync(join(out, 'printed', 'no-such-package.txt'), 'utf8')).toContain(
        `the package ${missing} cannot be read: ENOENT`,
      );
      expect(summaryOf(out).packages[0]).toMatchObject({ result: 'not ready' });
    },
    SEVERAL_RUNS,
  );

  it(
    'runs one package file as it always ran, and one folder as several',
    async () => {
      const given = folder({ 'claims.zip': SOUND });
      const one = fresh();
      expect((await run(['migrate', join(given, 'claims.zip'), '--out', one])).code).toBe(0);
      expect(existsSync(join(one, 'report.txt'))).toBe(true);
      expect(existsSync(join(one, 'summary.txt'))).toBe(false);
      const many = fresh();
      expect((await run(['migrate', given, '--out', many])).code).toBe(0);
      expect(existsSync(join(many, 'summary.txt'))).toBe(true);
      expect(existsSync(join(many, 'packages', 'claims', 'report.txt'))).toBe(true);
    },
    SEVERAL_RUNS,
  );
});
