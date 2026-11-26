import {
  chmodSync,
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
import { join, relative } from 'node:path';
import { main, type CliIo } from './cli';
import type { CheckResult } from './harness';
import { migrate, nextOut, SERVER_HALVES, type Command, type MigrateRequest } from './migrate';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';
import { writeZip } from './testing/zip-writer';

const UI = 'web/nuxeo.war/ui';
/** For a test that runs migrate over a whole package several times: past Vitest's 5 seconds under the gate's load. */
const SEVERAL_RUNS = 30_000;

// jsdom keeps every document a run parsed until the job that parsed it ends, and Vitest runs one
// synchronous test after another in one: a turn of the event loop after each lets them go.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
const ALLOW = Buffer.from(JSON.stringify({ operations: ['Claim.Approve'] }));

interface Printed {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Runs a command as the command line does: `files` first, then the disk, each read recorded. */
function run(
  argv: readonly string[],
  files: Readonly<Record<string, Buffer>> = {},
  reads: string[] = [],
): Printed {
  let out = '';
  let err = '';
  const io: CliIo = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => {
      reads.push(path);
      return Object.hasOwn(files, path) ? files[path] : readFileSync(path);
    },
  };
  return { code: main(argv, io), out, err };
}

/** `migrate` itself, given another command than `main` to run its steps. */
function migrateWith(request: MigrateRequest, command: Command): Printed {
  let out = '';
  let err = '';
  const io: CliIo = {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => readFileSync(path),
  };
  return { code: migrate(request, io, command), out, err };
}

/** A package written to a file of its own. */
function onDisk(data: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), 'studio-migrate-')), 'package.zip');
  writeFileSync(path, data);
  return path;
}

/** A path for a run that does not exist yet. */
const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'studio-migrate-')), 'run');

/** Every file under a directory, by its path there, with its bytes. */
function tree(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(directory, path), readFileSync(path).toString('base64'));
    }
  };
  walk(directory);
  return files;
}

/** Where a person keeps what each command prints, as migrate does. */
const PRINTED_INTO: Readonly<Record<string, string>> = {
  inventory: 'inventory.txt',
  convert: 'conversion.txt',
  check: 'check.txt',
  report: 'report.txt',
  decisions: 'decisions.txt',
};

/** The commands as a person types them, in order, each printing into its file of `out`. */
function byHand(
  out: string,
  commands: readonly (readonly string[])[],
  files: Readonly<Record<string, Buffer>>,
): Map<string, string> {
  mkdirSync(out, { recursive: true });
  for (const argv of commands) {
    const printed = run(argv, files);
    expect(printed.err).toBe('');
    writeFileSync(join(out, PRINTED_INTO[argv[0]]), printed.out);
  }
  const written = tree(out);
  // Out of the way, so that migrate writes to the very same paths, and prints them.
  renameSync(out, `${out}-by-hand`);
  return written;
}

/** Fills in every decision of a decisions.json. */
function fill(path: string): void {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  for (const item of file.decisions) {
    item.owner = 'Migration lead';
    item.decision = 'Rebuilt by hand';
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

describe.each([
  ['the made-up package', (): Buffer => syntheticPackage()],
  [
    "the made-up package with M2's corpus",
    (): Buffer => syntheticPackage({ bundle: m2CorpusFiles() }),
  ],
])('migrate, on %s', (_, make) => {
  const files = { 'acme.zip': make(), 'allow.json': ALLOW };

  it.each([
    ['without an allow-list', []],
    ['with an allow-list', ['--allow-list', 'allow.json']],
  ])(
    'writes what each command prints by hand, byte for byte, %s',
    (__, allow) => {
      const out = fresh();
      const conversion = join(out, 'conversion');
      const hand = byHand(
        out,
        [
          ['inventory', 'acme.zip'],
          ['convert', 'acme.zip', conversion, ...allow],
          ['check', 'acme.zip', conversion, ...allow],
          ['report', 'acme.zip', conversion, ...allow],
          ['decisions', 'acme.zip', conversion],
        ],
        files,
      );

      const migrated = run(['migrate', 'acme.zip', '--out', out, ...allow], files);
      expect(migrated).toMatchObject({ code: 0, err: '' });
      expect(tree(out)).toEqual(hand);
      expect([...hand.keys()]).toEqual(
        expect.arrayContaining([
          'inventory.txt',
          'conversion.txt',
          'check.txt',
          'report.txt',
          'decisions.txt',
          join('conversion', 'report.json'),
          join('conversion', 'decisions.json'),
          join('conversion', 'app', 'app.json'),
        ]),
      );
      expect(migrated.out).toMatch(
        /^Migrating acme\.zip into .*\n\n1\. The inventory: done.*\n2\. The conversion: done[^]*\n3\. The checks that need no server: done, and no check failed;.*\n4\. The report: done.*\n5\. The decisions to fill in: done[^]*\nVerdict: not ready\. What stands in the way:\n/,
      );
      expect(migrated.out).toContain(
        `\n  2. In ${join(conversion, 'decisions.json')}, write for each reported item still without them who owns it`,
      );
      expect(migrated.out).toContain(
        `\n  3. To see your decisions counted, run again into a new directory, carrying them: npm run studio-migration -- migrate acme.zip --out ${out}-2${allow.length ? ' --allow-list allow.json' : ''} --from ${out}\n`,
      );
      // Check 10 holds the actions to the allow-list convert was given, so it never runs in part.
      expect(migrated.out).not.toContain('- 10 Package');
      // The scaffold, written last, changes nothing the checks and the report print.
      for (const command of ['check', 'report'])
        expect(run([command, 'acme.zip', conversion, ...allow], files).out).toBe(
          readFileSync(join(out, PRINTED_INTO[command]), 'utf8'),
        );
    },
    SEVERAL_RUNS,
  );

  it(
    'carries the decisions of an earlier run before the checks, as by hand, and leaves that run as it was',
    () => {
      const earlier = fresh();
      expect(run(['migrate', 'acme.zip', '--out', earlier], files).code).toBe(0);
      const decisions = join(earlier, 'conversion', 'decisions.json');
      fill(decisions);
      const before = tree(earlier);

      const out = fresh();
      const conversion = join(out, 'conversion');
      const hand = byHand(
        out,
        [
          ['inventory', 'acme.zip'],
          ['convert', 'acme.zip', conversion],
          ['decisions', 'acme.zip', conversion, '--from', decisions],
          ['check', 'acme.zip', conversion],
          ['report', 'acme.zip', conversion],
        ],
        files,
      );
      const migrated = run(['migrate', 'acme.zip', '--out', out, '--from', earlier], files);
      expect(migrated).toMatchObject({ code: 0, err: '' });
      expect(tree(out)).toEqual(hand);
      expect(tree(earlier)).toEqual(before);
      expect(migrated.out).toMatch(
        /\n3\. The decisions, carried: done[^]*\n4\. The checks that need no server: done.*\n5\. The report: done/,
      );
      // Counted by the checks and the report, which ran after them, and nothing is left to do with them.
      expect(readFileSync(join(out, 'check.txt'), 'utf8')).not.toMatch(/reported items? ha/);
      expect(migrated.out).toContain(
        '\n  2. Every reported item has an owner and a decision: none is left to fill in.\n',
      );
      expect(migrated.out).not.toContain('To see your decisions counted');
      expect(readFileSync(join(out, 'report.txt'), 'utf8')).toMatch(
        /Decisions needed: (\d+) reported items, \1 of them decided/,
      );
    },
    SEVERAL_RUNS,
  );

  it(
    'carries a decision whose owner is spaces alone, and still asks for it',
    () => {
      const spaced = fresh();
      expect(run(['migrate', 'acme.zip', '--out', spaced], files).code).toBe(0);
      const spacedFile = join(spaced, 'conversion', 'decisions.json');
      fill(spacedFile);
      const blanked = JSON.parse(readFileSync(spacedFile, 'utf8'));
      blanked.decisions[0].owner = '   ';
      writeFileSync(spacedFile, JSON.stringify(blanked));
      const again = fresh();
      const carried = run(['migrate', 'acme.zip', '--out', again, '--from', spaced], files);
      expect(readFileSync(join(again, 'decisions.txt'), 'utf8')).toMatch(
        /reported items, 1 of them still without an owner or a decision\n/,
      );
      expect(carried.out).toContain('To see your decisions counted');
      expect(carried.out).not.toContain('none is left to fill in');
    },
    SEVERAL_RUNS,
  );

  it(
    'carries the same from the decisions.json itself, or the conversion holding it',
    () => {
      const earlier = fresh();
      expect(run(['migrate', 'acme.zip', '--out', earlier], files).code).toBe(0);
      const decisions = join(earlier, 'conversion', 'decisions.json');
      fill(decisions);
      const out = fresh();
      expect(run(['migrate', 'acme.zip', '--out', out, '--from', earlier], files).code).toBe(0);
      for (const from of [decisions, join(earlier, 'conversion')]) {
        const again = fresh();
        expect(run(['migrate', 'acme.zip', '--out', again, '--from', from], files).code).toBe(0);
        expect(readFileSync(join(again, 'conversion', 'decisions.json'), 'utf8')).toBe(
          readFileSync(join(out, 'conversion', 'decisions.json'), 'utf8'),
        );
      }
    },
    SEVERAL_RUNS,
  );
});

describe('migrate, its negative controls', () => {
  const files = { 'acme.zip': syntheticPackage(), 'allow.json': ALLOW };

  it('refuses a package that is not a Studio package at the inventory, and writes nothing', () => {
    for (const [name, data, reason] of [
      [
        'addon.zip',
        writeZip([
          {
            name: 'package.xml',
            data: '<package type="addon" name="acme-addon" version="1.0.0"/>',
          },
        ]),
        'addon.zip: package.xml declares a "addon" package, not a Studio package',
      ],
      [
        'readme.zip',
        writeZip([{ name: 'README.md', data: 'Not a package' }]),
        'readme.zip: not a Nuxeo package: there is no package.xml at its root',
      ],
      ['notes.zip', Buffer.from('Not an archive at all'), 'notes.zip: not a ZIP archive'],
    ] as const) {
      const out = fresh();
      const refused = run(['migrate', name, '--out', out], { [name]: data });
      expect(refused.code).toBe(1);
      expect(refused.out).toBe(`Migrating ${name} into ${out}\n\n1. The inventory: refused\n`);
      expect(refused.err).toContain(`\n   ${reason}`);
      expect(refused.err).toContain(
        'Stopped at step 1, the inventory: the 4 steps after it did not run.',
      );
      expect(refused.err).toContain(`Nothing was written, so ${out} can be given to --out again.`);
      expect(refused.err).toContain(
        'What to do: give migrate the package exactly as Studio builds it for your project',
      );
      expect(existsSync(out)).toBe(false);
      // The inventory, by hand, refuses it the same way.
      expect(run(['inventory', name], { [name]: data })).toMatchObject({ code: 1, out: '' });
    }
  });

  it('stops at a step that refuses, runs nothing after it, and says what to do', () => {
    // A theme folder whose name cannot be a file name on every system: the conversion refuses.
    const pkg = syntheticPackage({
      bundle: {
        [`${UI}/themes/acme brand/theme.html`]:
          '<custom-style><style>html { --nuxeo-primary-color: #00796b; }</style></custom-style>',
      },
      without: [`${UI}/themes/acme/theme.html`, `${UI}/themes/acme/logo.png`],
    });
    const out = fresh();
    const refused = run(['migrate', 'acme.zip', '--out', out], { 'acme.zip': pkg });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/\n1\. The inventory: done.*\n2\. The conversion: refused\n$/);
    expect(refused.err).toContain(
      '"themes/acme brand.json" cannot be a file name on every system, so the conversion cannot be written',
    );
    expect(refused.err).toContain(
      'Stopped at step 2, the conversion: the 3 steps after it did not run.',
    );
    expect(refused.err).toContain(
      `Written before it stopped: ${join(out, 'inventory.txt')}. migrate never writes over a run`,
    );
    expect(refused.err).toContain('What to do: where the reason names a file');
    expect(readdirSync(out)).toEqual(['inventory.txt']);
    // By hand, the conversion refuses it the same way.
    const byHandConversion = run(['convert', 'acme.zip', fresh()], { 'acme.zip': pkg });
    expect(byHandConversion.code).toBe(1);
    expect(refused.err).toContain(byHandConversion.err.trimEnd());
  });

  it('stops at the decisions, before the checks, when --from holds the decisions of another build', () => {
    const earlier = fresh();
    expect(run(['migrate', 'acme.zip', '--out', earlier], files).code).toBe(0);
    const out = fresh();
    const refused = run(['migrate', 'other.zip', '--out', out, '--from', earlier], {
      'other.zip': syntheticPackage({ bundle: m2CorpusFiles() }),
    });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/\n3\. The decisions, carried: refused\n$/);
    expect(refused.err).toMatch(
      /is for Acme-Claims 1\.0\.0, bundle [0-9a-f]{12}, and the package given is Acme-Claims 1\.0\.0, bundle [0-9a-f]{12}, so none of it is taken/,
    );
    expect(refused.err).toContain(
      'Stopped at step 3, the decisions, carried: the 2 steps after it',
    );
    expect(refused.err).toContain('cannot be carried to this package');
    expect(readdirSync(out).sort()).toEqual(['conversion', 'conversion.txt', 'inventory.txt']);
    expect(existsSync(join(out, 'conversion', 'decisions.json'))).toBe(false);
  });

  it('never writes over an earlier run, its decisions among them', () => {
    const out = fresh();
    expect(run(['migrate', 'acme.zip', '--out', out], files).code).toBe(0);
    fill(join(out, 'conversion', 'decisions.json'));
    const before = tree(out);

    const again = run(['migrate', 'acme.zip', '--out', out], files);
    expect(again).toEqual({
      code: 1,
      out: '',
      err:
        `migrate: ${out} already holds files, perhaps an earlier run, and migrate never writes over one. Nothing was written.\n\n` +
        `What to do: give --out a new directory, such as ${out}-2. To carry the decisions you made in ${out}, add --from ${out}.\n`,
    });
    expect(tree(out)).toEqual(before);

    const file = join(mkdtempSync(join(tmpdir(), 'studio-migrate-')), 'run');
    writeFileSync(file, 'a file');
    expect(run(['migrate', 'acme.zip', '--out', file], files)).toMatchObject({
      code: 1,
      err: expect.stringContaining(`${file} is a file, not a directory. Nothing was written.`),
    });
    expect(readFileSync(file, 'utf8')).toBe('a file');
    expect(run(['migrate', 'acme.zip', '--out', ''], files)).toMatchObject({
      code: 1,
      err: expect.stringContaining('--out names no directory. Nothing was written.'),
    });
    // An empty directory is new enough.
    const empty = mkdtempSync(join(tmpdir(), 'studio-migrate-'));
    expect(run(['migrate', 'acme.zip', '--out', empty], files).code).toBe(0);
  });

  it('writes no file where one appeared during the run', () => {
    const out = fresh();
    // A command that, once the conversion is written, puts a file where the checks' output goes.
    const racing: Command = (argv, io) => {
      const code = main(argv, io);
      if (argv[0] === 'convert') writeFileSync(join(out, 'check.txt'), 'someone else');
      return code;
    };
    const stopped = migrateWith({ package: onDisk(files['acme.zip']), out }, racing);
    expect(stopped.code).toBe(1);
    expect(stopped.out).toMatch(/\n3\. The checks that need no server: refused\n$/);
    expect(stopped.err).toContain(`${join(out, 'check.txt')} cannot be written: EEXIST`);
    expect(readFileSync(join(out, 'check.txt'), 'utf8')).toBe('someone else');
    expect(existsSync(join(out, 'report.txt'))).toBe(false);
  });

  it('refuses, before writing anything, a package, an allow-list or an earlier run it cannot use', () => {
    const given = { ...files, 'bad.json': Buffer.from('["Claim.Approve"]') };
    for (const [argv, problem] of [
      [['missing.zip'], 'the package missing.zip cannot be read: ENOENT'],
      [
        ['acme.zip', '--allow-list', 'missing.json'],
        'the allow-list missing.json is not one it can use: ENOENT',
      ],
      [
        ['acme.zip', '--allow-list', 'bad.json'],
        'the allow-list bad.json is not one it can use: bad.json: an allow-list is { "operations": [ <operation id>, ... ] }',
      ],
      [
        ['acme.zip', '--from', join(fresh(), 'nowhere')],
        'holds no decisions.json migrate can read',
      ],
    ] as const) {
      const out = fresh();
      const refused = run(['migrate', argv[0], '--out', out, ...argv.slice(1)], given);
      expect(refused.code).toBe(1);
      expect(refused.out).toBe('');
      expect(refused.err).toContain(problem);
      expect(refused.err).toContain('Nothing was written.');
      expect(existsSync(out)).toBe(false);
    }
  });

  it('carries on past a check that fails, to the report and the decisions, and exits 1', () => {
    // A brand colour below WCAG 2.1 AA on the theme's own background: check 8 fails.
    const pkg = syntheticPackage({
      bundle: {
        [`${UI}/themes/acme/theme.html`]:
          '<custom-style><style>html { --nuxeo-primary-color: #9e9e9e; --nuxeo-page-background: #ffffff; }</style></custom-style>',
      },
    });
    const out = fresh();
    const migrated = run(['migrate', 'acme.zip', '--out', out], { 'acme.zip': pkg });
    expect(migrated.code).toBe(1);
    expect(migrated.err).toBe('');
    expect(migrated.out).toContain(
      '\n3. The checks that need no server: done, and check 8 failed;',
    );
    expect(migrated.out).toContain('\n4. The report: done');
    expect(migrated.out).toContain('\n5. The decisions to fill in: done');
    expect(migrated.out).toContain(
      '\n  1. Check 8 (Theme) failed: the conversion is not right as it stands.',
    );
    expect(readFileSync(join(out, 'report.txt'), 'utf8')).toMatch(/\n {2} 8 {2}Theme +FAIL\n/);
    // By hand, the check exits 1 and prints the same.
    const checked = run(['check', 'acme.zip', join(out, 'conversion')], { 'acme.zip': pkg });
    expect(checked.code).toBe(1);
    expect(readFileSync(join(out, 'check.txt'), 'utf8')).toBe(checked.out);
  });

  it('only reads the package, and reads it once, so every step is given the same bytes', () => {
    const folder = mkdtempSync(join(tmpdir(), 'studio-migrate-'));
    const path = join(folder, 'acme.zip');
    writeFileSync(path, syntheticPackage());
    chmodSync(path, 0o444);
    const before = { bytes: readFileSync(path), modified: statSync(path).mtimeMs };
    const reads: string[] = [];
    const out = fresh();
    expect(run(['migrate', path, '--out', out], {}, reads).code).toBe(0);
    expect(reads.filter((read) => read === path)).toHaveLength(1);
    expect(readFileSync(path).equals(before.bytes)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(before.modified);
    expect(readdirSync(folder)).toEqual(['acme.zip']);
  });

  it('stops at a step that throws, as a defect of the tool, and runs nothing after it', () => {
    const out = fresh();
    const stopped = migrateWith({ package: onDisk(files['acme.zip']), out }, (argv, io) => {
      if (argv[0] === 'report') throw new Error('a defect');
      return main(argv, io);
    });
    expect(stopped.code).toBe(1);
    expect(stopped.out).toMatch(/\n4\. The report: refused\n$/);
    expect(stopped.err).toContain('Error: a defect');
    expect(stopped.err).toContain('This is a defect in this tool, not a mistake in your package');
    expect(existsSync(join(out, 'conversion', 'decisions.json'))).toBe(false);
  });

  it('gives the steps --out in full, and prints it so, however it was given', () => {
    const out = fresh();
    const given = relative(process.cwd(), out);
    const migrated = run(['migrate', 'acme.zip', '--out', given], files);
    expect(migrated.code).toBe(0);
    expect(given).not.toBe(out);
    expect(migrated.out).toContain(`Migrating acme.zip into ${out}\n`);
    expect(readFileSync(join(out, 'conversion.txt'), 'utf8')).toMatch(
      new RegExp(
        `^Converted Acme-Claims 1\\.0\\.0 into ${join(out, 'conversion').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`,
      ),
    );
  });

  it('exits 2 without a package or --out, or with an option it does not take', () => {
    for (const argv of [
      ['migrate', 'acme.zip'],
      ['migrate', '--out', fresh()],
      ['migrate', 'acme.zip', '--out'],
      ['migrate', 'acme.zip', '--out', fresh(), '--json'],
      ['migrate', 'acme.zip', 'more.zip', '--out', fresh()],
    ]) {
      const { code, err } = run(argv, files);
      expect(code).toBe(2);
      expect(err).toMatch(/^usage:[^]*\n {2}studio-migration migrate <package\.zip> --out /);
    }
  });
});

describe('migrate, on what still needs a server', () => {
  const files = { 'acme.zip': syntheticPackage({ bundle: m2CorpusFiles() }) };

  it('names each check whose server half did not run, why it needs the lab server, and what did not run', () => {
    const { out } = run(['migrate', 'acme.zip', '--out', fresh()], files);
    expect(out).toContain('\nChecks that still need the migration lab server:\n');
    for (const [number, name] of [
      [3, 'Model'],
      [5, 'Conditions'],
      [6, 'What people see'],
      [7, 'What the server is asked'],
    ] as const)
      expect(out).toMatch(
        new RegExp(
          `\\n {2}- ${number} ${name}: its server half ${SERVER_HALVES[number].replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}\\.\\n {6}This run: [^\\n]*migration server[^\\n]*\\.\\n`,
        ),
      );
    expect(out).toContain(
      '\nChecks that did not run whole, for another reason:\n  - 9 Plugins: not run: It tests the plugins that replace custom elements, in M3.\n      Nothing to do now',
    );
    expect(out).toContain(
      'The checks that need the lab server cannot be run from here: ask your Nuxeo contact',
    );
  });

  it('lists only the checks that still have a half to run, a failed one among them', () => {
    const check = (
      number: number,
      status: CheckResult['status'],
      reason?: string,
    ): CheckResult => ({
      number,
      name: `Check ${number}`,
      status,
      findings: status === 'fail' ? ['found'] : [],
      ...(reason ? { reason } : {}),
    });
    const checks = [
      check(3, 'fail', 'the model half needs the migration server'),
      check(5, 'pass'),
      check(6, 'partial', 'the values half needs the migration server'),
      check(7, 'pass'),
      check(9, 'not run', 'it waits for M3'),
    ];
    const printing: Command = (argv, io) => {
      io.out(`${argv[0]}\n`);
      if (argv[0] !== 'check') return 0;
      io.checked?.({ checks, ready: false, blockers: ['check 3 failed'] });
      return 1;
    };
    const { code, out } = migrateWith(
      { package: onDisk(syntheticPackage()), out: fresh() },
      printing,
    );
    expect(code).toBe(1);
    expect(out).toContain('\n  - 3 Check 3: its server half');
    expect(out).toContain('\n  - 6 Check 6: its server half');
    expect(out).not.toContain('- 5 Check 5');
    expect(out).not.toContain('- 7 Check 7');
    expect(out).toContain('\n  - 9 Check 9: not run: it waits for M3.\n');
    expect(out).toContain('\n  1. Check 3 (Check 3) failed');
  });

  it('suggests the next free directory for the next run', () => {
    const folder = mkdtempSync(join(tmpdir(), 'studio-migrate-'));
    expect(nextOut(join(folder, 'run'))).toBe(join(folder, 'run-2'));
    expect(nextOut(`${join(folder, 'run')}/`)).toBe(join(folder, 'run-2'));
    mkdirSync(join(folder, 'run-2'));
    expect(nextOut(join(folder, 'run'))).toBe(join(folder, 'run-3'));
    expect(nextOut(join(folder, 'run-2'))).toBe(join(folder, 'run-3'));
  });
});
