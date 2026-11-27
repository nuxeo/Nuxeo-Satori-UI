/**
 * The reviewer's approval of the report (docs/business-apps/studio-migration.md, sections 5 and
 * 8): `approve` records who approved the report and its decisions, when, and the SHA-256 of what
 * they approved; readiness needs one whose digests are those of the conversion as it is now, so
 * any change voids it; and no run approves itself: `approve` needs a person at a terminal, named,
 * and no other command writes an approval. Its controls, `APPROVAL_MUTATIONS`, are seen failing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPROVAL_FILE,
  APPROVAL_FORMAT,
  approvalDigest,
  digestsOf,
  holdApproval,
} from './approval';
import { loadCatalogue } from './catalogue';
import { main, type CliIo } from './cli';
import { packageBuildOf, readConversion } from './convert';
import { runHarness } from './harness';
import { inventory } from './inventory';
import { APPROVAL_MUTATIONS, MutationError } from './mutations';
import { summarise } from './report';
import { readStudioPackage } from './studio-package';
import { syntheticPackage } from './testing/synthetic-package';

const PACKAGE = syntheticPackage();
const FILES: Readonly<Record<string, Buffer>> = { 'acme.zip': PACKAGE };
const AT = new Date('2026-11-27T10:00:00.000Z');
/** Past Vitest's 5 seconds: the fixture migrates the package twice. */
const SEVERAL_RUNS = 60_000;

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

/** A person at a terminal, typing `typed`, and what they were asked. */
function person(typed: (question: string) => string | null): {
  readonly terminal: NonNullable<CliIo['terminal']>;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    terminal: {
      ask: (question) => {
        asked.push(question);
        return typed(question);
      },
    },
  };
}

function run(
  argv: readonly string[],
  extra: Partial<Pick<CliIo, 'terminal' | 'now'>> = {},
): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = main(argv, {
    out: (text) => (out += text),
    err: (text) => (err += text),
    readFile: (path) => (Object.hasOwn(FILES, path) ? FILES[path] : readFileSync(path)),
    ...extra,
  });
  return { code, out, err };
}

const fresh = (): string => join(mkdtempSync(join(tmpdir(), 'studio-approve-')), 'run');

function fill(path: string): void {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  for (const item of file.decisions) {
    item.owner = 'Migration lead';
    item.decision = item.outcome === 'proposed' ? 'accept' : 'Rebuilt by hand';
    if (item.outcome === 'proposed') item.reason = 'The host has the function it calls';
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** A run of the made-up package with every decision made, and the conversion made with them. */
function decidedRun(): string {
  const first = fresh();
  expect(run(['migrate', 'acme.zip', '--out', first]).code).toBe(0);
  fill(join(first, 'conversion', 'decisions.json'));
  const second = fresh();
  expect(run(['migrate', 'acme.zip', '--out', second, '--from', first]).code).toBe(0);
  return join(second, 'conversion');
}

/** The digest a person reads on the screen, and types the start of. */
const shownDigest = (conversion: string): string =>
  approvalDigest(digestsOf(readConversion(conversion)));

const verdict = (conversion: string): readonly string[] => {
  const pkg = readStudioPackage(PACKAGE);
  return runHarness({
    pkg,
    inventory: inventory(pkg),
    catalogue: loadCatalogue(),
    conversion: readConversion(conversion),
  }).blockers;
};

const NO_ONE =
  'no one has approved the report and its decisions: a person does, with the approve command, once every decision is made';

describe('approving the report', () => {
  it(
    'records who approved it, when, and the SHA-256 of the report, the decisions and the files approved',
    () => {
      const conversion = decidedRun();
      expect(verdict(conversion)).toContain(NO_ONE);
      const digest = shownDigest(conversion);
      const { terminal, asked } = person(() => digest.slice(0, 8));
      const approved = run(['approve', 'acme.zip', conversion, '--by', 'Dana Reviewer'], {
        terminal,
        now: () => AT,
      });
      expect(approved).toMatchObject({ code: 0, err: '' });
      expect(asked).toEqual([
        'Type the first 8 characters of "together" to approve it as Dana Reviewer: ',
      ]);
      expect(approved.out).toContain(`  together        ${digest}\n`);
      expect(approved.out).toContain(
        `Approved by Dana Reviewer at 2026-11-27T10:00:00.000Z: wrote ${join(conversion, APPROVAL_FILE)}.\n`,
      );
      const written = JSON.parse(readFileSync(join(conversion, APPROVAL_FILE), 'utf8'));
      const digests = digestsOf({ ...readConversion(conversion), approval: undefined });
      expect(written).toEqual({
        format: APPROVAL_FORMAT,
        approvedBy: 'Dana Reviewer',
        approvedAt: '2026-11-27T10:00:00.000Z',
        package: packageBuildOf(readStudioPackage(PACKAGE)),
        report: digests.report,
        decisions: digests.decisions,
        files: digests.files,
      });
      expect(digests.report).toMatch(/^[0-9a-f]{64}$/);
      // The report.json and decisions.json as written, byte for byte, are what was approved.
      const sha = (path: string): string =>
        createHash('sha256').update(readFileSync(path)).digest('hex');
      expect(written.report).toBe(sha(join(conversion, 'report.json')));
      expect(written.decisions).toBe(sha(join(conversion, 'decisions.json')));
      // Readiness takes it, and the report says so.
      expect(verdict(conversion).filter((line) => /approv/.test(line))).toEqual([]);
      const pkg = readStudioPackage(PACKAGE);
      expect(
        summarise({
          pkg,
          inventory: inventory(pkg),
          catalogue: loadCatalogue(),
          conversion: readConversion(conversion),
        }).approval,
      ).toEqual({
        approved: true,
        by: 'Dana Reviewer',
        at: '2026-11-27T10:00:00.000Z',
        findings: [],
      });
      // It is never written over.
      const again = run(['approve', 'acme.zip', conversion, '--by', 'Someone else'], { terminal });
      expect(again.code).toBe(1);
      expect(again.err).toMatch(/holds approval\.json already, which is never written over/);
    },
    SEVERAL_RUNS,
  );

  it(
    'is void once anything it approved changes, and readiness and the report say so',
    () => {
      const conversion = decidedRun();
      const digest = shownDigest(conversion);
      const { terminal } = person(() => digest.slice(0, 8));
      expect(
        run(['approve', 'acme.zip', conversion, '--by', 'Dana Reviewer'], {
          terminal,
          now: () => AT,
        }).code,
      ).toBe(0);
      const changes: [string, (path: string) => void, string][] = [
        [
          'decisions.json',
          (path) => {
            const file = JSON.parse(readFileSync(path, 'utf8'));
            file.decisions[0].decision = 'Decided otherwise';
            writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
          },
          'decisions.json has changed since',
        ],
        [
          'report.json',
          (path) => writeFileSync(path, readFileSync(path, 'utf8').replace('"M1"', '"M1 "')),
          'report.json has changed since',
        ],
        [
          'app/labels/fr.json',
          (path) =>
            writeFileSync(path, readFileSync(path, 'utf8').replace('Sinistres', 'Dossiers')),
          "the conversion's files have changed since",
        ],
      ];
      for (const [file, change, said] of changes) {
        const copy = fresh();
        cpSync(conversion, copy, { recursive: true });
        // The copy, as it was approved: only the change below differs.
        expect(verdict(copy).filter((line) => /approv/.test(line))).toEqual([]);
        change(join(copy, ...file.split('/')));
        expect(verdict(copy)).toContain(
          `the approval by Dana Reviewer at 2026-11-27T10:00:00.000Z is void: ${said}, so a person approves again`,
        );
      }
    },
    SEVERAL_RUNS,
  );

  it(
    'refuses, writing nothing, with no terminal, no name, a decision still to make, or a digest not typed back',
    () => {
      const conversion = decidedRun();
      const digest = shownDigest(conversion);
      const right = person(() => digest.slice(0, 8)).terminal;
      // No terminal: a script, a pipeline, an agent's run.
      const none = run(['approve', 'acme.zip', conversion, '--by', 'Dana Reviewer']);
      expect(none.code).toBe(1);
      expect(none.err).toMatch(
        /^approve records a person's approval, typed at a terminal, and there is none here/,
      );
      // No name, or a blank one.
      expect(run(['approve', 'acme.zip', conversion], { terminal: right }).code).toBe(2);
      for (const name of ['   ', '\u200b \u200b']) {
        const blank = run(['approve', 'acme.zip', conversion, '--by', name], { terminal: right });
        expect(blank.code).toBe(1);
        expect(blank.err).toMatch(/^an approval names the person who approves, in --by/);
      }
      // The digest not typed back, or nothing typed.
      for (const typed of ['00000000', null, ''])
        expect(
          run(['approve', 'acme.zip', conversion, '--by', 'Dana Reviewer'], {
            terminal: person(() => typed).terminal,
          }).code,
        ).toBe(1);
      expect(existsSync(join(conversion, APPROVAL_FILE))).toBe(false);
      // A decision still to make: a first run, whose decisions are blank.
      const first = fresh();
      expect(run(['migrate', 'acme.zip', '--out', first]).code).toBe(0);
      const early = run(
        ['approve', 'acme.zip', join(first, 'conversion'), '--by', 'Dana Reviewer'],
        { terminal: person(() => shownDigest(join(first, 'conversion')).slice(0, 8)).terminal },
      );
      expect(early.code).toBe(1);
      expect(early.err).toMatch(/still has decisions to make.*Nothing was written/);
      expect(existsSync(join(first, 'conversion', APPROVAL_FILE))).toBe(false);
    },
    SEVERAL_RUNS,
  );

  it(
    'is never written by migrate, however decided its run',
    () => {
      const conversion = decidedRun();
      expect(readdirSync(conversion)).not.toContain(APPROVAL_FILE);
      expect(verdict(conversion)).toContain(NO_ONE);
    },
    SEVERAL_RUNS,
  );

  it(
    'refuses in a real shell whose input is no terminal, as an agent’s or a pipeline’s is',
    () => {
      const conversion = decidedRun();
      const package_ = join(mkdtempSync(join(tmpdir(), 'studio-approve-')), 'acme.zip');
      writeFileSync(package_, PACKAGE);
      const cli = join(__dirname, 'cli.ts');
      const ran = spawnSync(
        process.execPath,
        [require.resolve('tsx/cli'), cli, 'approve', package_, conversion, '--by', 'An agent'],
        {
          input: `${shownDigest(conversion).slice(0, 8)}\n`,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '--no-experimental-webstorage' },
        },
      );
      expect(ran.status).toBe(1);
      expect(ran.stderr).toMatch(/typed at a terminal, and there is none here/);
      expect(existsSync(join(conversion, APPROVAL_FILE))).toBe(false);
    },
    SEVERAL_RUNS,
  );
});

describe('each deliberate breakage of the approval voids it', () => {
  it(
    'applies each to an approved conversion, and readiness names the approval void',
    () => {
      const conversion = decidedRun();
      const digest = shownDigest(conversion);
      expect(
        run(['approve', 'acme.zip', conversion, '--by', 'Dana Reviewer'], {
          terminal: person(() => digest.slice(0, 8)).terminal,
          now: () => AT,
        }).code,
      ).toBe(0);
      const approved = readConversion(conversion);
      const build = packageBuildOf(readStudioPackage(PACKAGE));
      expect(holdApproval(approved, build)).toMatchObject({ approved: true, findings: [] });
      const pristine = JSON.stringify(approved);
      const said: Record<string, string> = {
        'approve-other-report': 'report.json has changed since',
        'change-after-approval': 'decisions.json has changed since',
      };
      expect(APPROVAL_MUTATIONS.map((mutation) => mutation.name).sort()).toEqual(
        Object.keys(said).sort(),
      );
      for (const mutation of APPROVAL_MUTATIONS) {
        const broken = mutation.apply(approved).conversion;
        expect(JSON.stringify(approved)).toBe(pristine);
        expect(holdApproval(broken, build).findings).toEqual([
          `the approval by Dana Reviewer at 2026-11-27T10:00:00.000Z is void: ${said[mutation.name]}, so a person approves again`,
        ]);
        // Written with `mutate`, as a person would apply it, and checked from the disk.
        const copy = fresh();
        expect(run(['mutate', conversion, mutation.name, copy]).out).toContain(
          'what stands in the way of readiness must now show it',
        );
        expect(verdict(copy)).toContain(
          `the approval by Dana Reviewer at 2026-11-27T10:00:00.000Z is void: ${said[mutation.name]}, so a person approves again`,
        );
        // Unbroken, the copy's approval holds: the control is what voids it.
        expect(() => mutation.apply({ ...approved, approval: undefined })).toThrow(MutationError);
      }
    },
    SEVERAL_RUNS,
  );

  it(
    'names an approval that is not one, names no one, or is of another build',
    () => {
      const pkg = readStudioPackage(PACKAGE);
      const conversion = readConversion(decidedRun());
      const build = packageBuildOf(pkg);
      const approval = {
        format: APPROVAL_FORMAT,
        approvedBy: 'Dana Reviewer',
        approvedAt: AT.toISOString(),
        package: build,
        ...digestsOf(conversion),
      };
      const held = (value: unknown, given = build): readonly string[] =>
        holdApproval({ ...conversion, approval: value }, given).findings;
      expect(held(approval)).toEqual([]);
      expect(held({ ...approval, format: 'something else' })).toEqual([
        'approval.json is not a studio-migration-approval/1 file, so it approves nothing',
      ]);
      for (const approvedBy of [' ', '\u200b'])
        expect(held({ ...approval, approvedBy })).toEqual([
          'approval.json names no one who approved it, or no time, so it approves nothing',
        ]);
      expect(held({ ...approval, approvedAt: 'yesterday' })).toEqual([
        'approval.json names no one who approved it, or no time, so it approves nothing',
      ]);
      expect(held(approval, { ...build, version: '1.1.0' })[0]).toMatch(
        /^approval\.json approves a report of Acme-Claims 1\.0\.0, bundle [0-9a-f]{12}, not of the package given, Acme-Claims 1\.1\.0/,
      );
    },
    SEVERAL_RUNS,
  );
});
