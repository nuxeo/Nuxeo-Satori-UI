import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  pipelineEnvironment,
  platformVersion,
  runNode,
  validatePackage,
  within,
} from './validate-package.ts';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';

const DEMO = join(REPO_ROOT, 'business-apps', 'packages', 'payers-claims-demo');
const scratch = mkdtempSync(join(tmpdir(), 'builder-mcp-spec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the demo package, without its build output, changed by `change`. */
function demoWith(name: string, change: (root: string) => void = () => undefined): string {
  const root = join(scratch, name);
  cpSync(DEMO, root, { recursive: true, filter: (source) => relative(DEMO, source) !== 'dist' });
  change(root);
  return root;
}

function edit(file: string, from: string, to: string): void {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${file} has no ${from}`);
  writeFileSync(file, text.replace(from, to));
}

function everyFile(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

/** The scratch copies are outside the repository, so the tests name their folder as a root. */
const SCRATCH = { roots: [REPO_ROOT, scratch] };

// The stopping tests' child processes run code that is fixed here. What varies, a marker's path and
// the code a child passes on, goes in as `process.argv`, never spliced into the source: a value
// quoted with `JSON.stringify` into code that runs is code construction (CodeQL's
// js/bad-code-sanitization), whatever the value.

/** Writes the file named by its first argument, a second and a half after it starts. */
const GRANDCHILD = "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'x'), 1500)";

/**
 * Starts a grandchild running the code of its second argument, with its first argument passed on,
 * then waits a minute: a pipeline that started something and has not ended.
 */
const SPAWN_GRANDCHILD =
  "require('child_process').spawn(process.execPath, ['-e', process.argv[2], process.argv[1]], { stdio: 'ignore' }); setTimeout(() => {}, 60000);";

/**
 * A server that runs a pipeline through `runNode` and says so: its arguments are the module that
 * exports `runNode`, then the pipeline's own arguments, in `SPAWN_GRANDCHILD`'s order.
 */
const SERVER_RUNNING_A_PIPELINE =
  "const [module, marker, spawnCode, grandchild] = process.argv.slice(1); const { runNode } = await import(module); runNode(['-e', spawnCode, marker, grandchild], 60000); setTimeout(() => process.stdout.write('started'), 300);";

const LAYOUT = join('bundle', 'agentic-ui-config', 'layouts', 'Claim', 'view.layout.json');

describe.skipIf(!PIPELINE_TESTS_RUN)(
  'validatePackage (the pipeline needs unzip, which a Windows runner lacks)',
  () => {
    it('unpacks the zip in a folder of its own, made where it is told, and removed', async () => {
      // The pipeline's step 5 unpacks the zip into the temporary folder it is given: here, one
      // inside workIn, which a watcher sees made there; and afterwards workIn is empty again.
      const workIn = join(scratch, 'work-in');
      mkdirSync(workIn);
      const seen: string[] = [];
      const watcher = watch(workIn, { recursive: true }, (_, name) => {
        if (name) seen.push(String(name));
      });
      try {
        const check = await validatePackage(
          { directory: demoWith('work-in-package') },
          { ...SCRATCH, workIn },
        );
        expect(check.passed).toBe(true);
        await new Promise((done) => setTimeout(done, 200));
      } finally {
        watcher.close();
      }
      expect(
        seen.some((name) =>
          /builder-mcp-package-[^/\\]+[/\\]tmp[/\\]verify-package-zip-/.test(name),
        ),
      ).toBe(true);
      expect(
        seen.some((name) =>
          /builder-mcp-package-[^/\\]+[/\\]out[/\\]payers-claims-demo-/.test(name),
        ),
      ).toBe(true);
      expect(readdirSync(workIn)).toEqual([]);
    });

    it('passes the demo package, as CI does, writing nothing into it', async () => {
      const root = demoWith('sound');
      const before = everyFile(root);
      // The default, the system's temporary folder, pointed at one of this test's own: the real one
      // is shared with the other spec files, which run the pipeline at the same time, so a folder
      // one of them has just made would read as this run's leftover.
      const workIn = join(scratch, 'sound-work');
      mkdirSync(workIn);
      const saved = {
        TMPDIR: process.env['TMPDIR'],
        TEMP: process.env['TEMP'],
        TMP: process.env['TMP'],
      };
      for (const key of Object.keys(saved)) process.env[key] = workIn;
      let check;
      try {
        expect(tmpdir()).toBe(workIn);
        check = await validatePackage({ directory: root }, SCRATCH);
      } finally {
        for (const [key, value] of Object.entries(saved))
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
      }
      expect(check.passed).toBe(true);
      expect(check.exitCode).toBe(0);
      expect(check.refusedAt).toBeNull();
      expect(check.findings).toEqual([]);
      expect(check.zip?.name).toMatch(/^payers-claims-demo-.+\.zip$/);
      expect(check.zip?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(check.command).toContain(`--platform ${platformVersion()}`);
      expect(everyFile(root)).toEqual(before);
      // The folder the zip went to is gone too.
      expect(readdirSync(workIn)).toEqual([]);
    });

    it("names the file, the place and the widget for phase 0's demo step 1", async () => {
      const root = demoWith('calendar', (copy) =>
        edit(join(copy, LAYOUT), '"widget": "document-link"', '"widget": "calendar"'),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.passed).toBe(false);
      expect(check.refusedAt).toEqual({
        step: 2,
        reason: 'the app definition has findings, listed above.',
      });
      expect(check.findings).toEqual([
        {
          file: 'bundle/agentic-ui-config/layouts/Claim/view.layout.json',
          place: 'cards[0].fields[1].widget',
          message: 'the widget "calendar" is not registered',
          kind: 'unknown',
        },
      ]);
      expect(check.zip).toBeNull();
    });

    // The tutorial's deliberate mistake: a misspelt property. The kit ships a stand-in model and the
    // content-model.json that describes it, so the pipeline holds it to that by default, as CI does.
    it("refuses a misspelt property, held to the package's own content model as CI is", async () => {
      const root = demoWith('misspelt', (copy) =>
        edit(join(copy, LAYOUT), '"claim:number",', '"claim:numbr",'),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.passed).toBe(false);
      expect(check.asCi).toBe(true);
      expect(check.refusedAt?.step).toBe(2);
      expect(check.findings).toEqual([
        {
          file: 'bundle/agentic-ui-config/layouts/Claim/view.layout.json',
          place: 'cards[0].fields[0]',
          message: '"claim:numbr" is not a property of the type "Claim" or of its facets',
          kind: 'unknown',
        },
      ]);
      expect(check.stdout).toContain(
        "The content model is the package's own content-model.json, since the package ships a stand-in model and no --model was given.",
      );
    });

    it('names the file and the key of a label key with no text', async () => {
      const root = demoWith('label', (copy) =>
        edit(join(copy, LAYOUT), '"labelKey": "payers.card.claim"', '"labelKey": "payers.card.x"'),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.passed).toBe(false);
      expect(check.findings).toEqual([
        {
          file: 'bundle/agentic-ui-config/layouts/Claim/view.layout.json',
          place: 'cards[0].labelKey',
          message:
            'the label key "payers.card.x" has no text in labels/en.json, or in the platform\'s catalogue',
          kind: 'unknown',
        },
      ]);
    });

    it("names the queue and the facet whose aggregate the package's page provider lacks", async () => {
      const root = demoWith('facet', (copy) =>
        edit(
          join(copy, 'bundle', 'agentic-ui-config', 'queues', 'unassigned-claims.json'),
          '"aggregate": "claim_status_agg"',
          '"aggregate": "claim_state_agg"',
        ),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.passed).toBe(false);
      expect(check.refusedAt).toEqual({
        step: 2,
        reason:
          'a facet or a figure names an aggregate its page provider does not define, listed above.',
      });
      expect(check.findings).toEqual([
        {
          file: 'bundle/agentic-ui-config/queues/unassigned-claims.json',
          place: 'facets[0].aggregate',
          message:
            'the page provider "payers_unassigned_claims", defined in OSGI-INF/payers-claims-demo-model.xml, has no aggregate "claim_state_agg": it defines claim_status_agg',
          kind: 'unknown',
        },
      ]);
    });

    it('refuses a builder that is not the reviewed one, before running it', async () => {
      const root = demoWith('builder', (copy) =>
        writeFileSync(
          join(copy, 'build.mjs'),
          `${readFileSync(join(copy, 'build.mjs'), 'utf8')}\n// changed\n`,
        ),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.passed).toBe(false);
      expect(check.refusedAt?.step).toBe(1);
      expect(check.refusedAt?.reason).toContain("build.mjs is not the generator's");
    });

    it('refuses versions that disagree, at step 3', async () => {
      const root = demoWith('version', (copy) =>
        edit(
          join(copy, 'bundle', 'agentic-ui-config', 'app.json'),
          '"packageVersion": "',
          '"packageVersion": "9',
        ),
      );
      const check = await validatePackage({ directory: root }, SCRATCH);
      expect(check.refusedAt?.step).toBe(3);
      expect(check.refusedAt?.reason).toContain('They are one version');
    });

    it("holds app.json's platform range to the version it is given", async () => {
      const check = await validatePackage(
        { directory: demoWith('platform'), platform: '99.0.0' },
        SCRATCH,
      );
      expect(check.passed).toBe(false);
      expect(check.refusedAt?.step).toBe(2);
      expect(check.findings.map((finding) => finding.file)).toContain(
        'bundle/agentic-ui-config/app.json',
      );
    });

    it('says when a folder or a file it was given is not there', async () => {
      await expect(validatePackage({ directory: join(scratch, 'none') }, SCRATCH)).rejects.toThrow(
        'directory: ',
      );
      await expect(validatePackage({ directory: join(scratch, 'none') }, SCRATCH)).rejects.toThrow(
        'does not exist',
      );
      await expect(
        validatePackage(
          { directory: demoWith('allow-list'), allowList: join(scratch, 'none.json') },
          SCRATCH,
        ),
      ).rejects.toThrow('allowList: ');
      const file = join(scratch, 'a-file.json');
      writeFileSync(file, '{}');
      await expect(validatePackage({ directory: file }, SCRATCH)).rejects.toThrow(
        'is not a folder',
      );
    });

    it('says when it ran as CI runs it, and when it was given more', async () => {
      const root = demoWith('departs');
      const asCi = await validatePackage({ directory: root }, SCRATCH);
      expect(asCi).toMatchObject({ asCi: true, departsFromCi: [] });
      const allowList = join(scratch, 'allow-list.json');
      writeFileSync(allowList, JSON.stringify({ operations: [] }));
      const given = await validatePackage(
        { directory: root, allowList, platform: '0.9.0' },
        SCRATCH,
      );
      expect(given).toMatchObject({ asCi: false, departsFromCi: ['allowList', 'platform'] });
      expect(given.command).toContain('--allow-list <file>');
    });

    it('refuses an empty platform, which the pipeline would take as none and check nothing', async () => {
      await expect(
        validatePackage({ directory: demoWith('empty-platform'), platform: '' }, SCRATCH),
      ).rejects.toThrow('is not a version');
    });
  },
);

describe('what validatePackage may read', () => {
  it('refuses a folder or a file outside the repository, so nothing there is quoted back', async () => {
    const root = demoWith('outside');
    // The default root is the repository, and the scratch copy is not in it.
    await expect(validatePackage({ directory: root })).rejects.toThrow('outside the repository');
    const secret = join(scratch, 'secret.json');
    writeFileSync(secret, '{ "not": "for the agent" }');
    await expect(
      validatePackage({
        directory: 'business-apps/packages/payers-claims-demo',
        allowList: secret,
      }),
    ).rejects.toThrow(/^allowList: .* is outside the repository, and is not read\.$/);
  });

  it('answers the same for a path outside whether or not it exists', () => {
    const roots = [REPO_ROOT];
    const there = within(join(scratch, 'secret.json'), roots);
    const missing = within(join(scratch, 'no-such-file.json'), roots);
    expect(there).toEqual({
      problem: `${join(scratch, 'secret.json')} is outside the repository, and is not read.`,
    });
    expect(missing).toEqual({
      problem: `${join(scratch, 'no-such-file.json')} is outside the repository, and is not read.`,
    });
  });

  it('refuses a hidden folder or file, which version control keeps out', () => {
    for (const path of [
      '.git/config',
      '.claude/launch.json',
      'business-apps/packages/.hidden/x.json',
    ])
      expect(within(path, [REPO_ROOT]), path).toEqual({
        problem: `${path} is a hidden folder or file, or is in one, and is not read.`,
      });
  });

  it('follows no link: in the path to a file, or anywhere in the package', async () => {
    const inside = join(scratch, 'inside');
    mkdirSync(inside, { recursive: true });
    const outsideFile = join(scratch, 'outside.json');
    writeFileSync(outsideFile, '{}');
    const link = join(inside, 'link.json');
    if (!existsSync(link)) symlinkSync(outsideFile, link);
    expect(within(link, [inside])).toEqual({
      problem: `${link} goes through a link, which is not followed.`,
    });
    const linkedFolder = join(inside, 'linked');
    if (!existsSync(linkedFolder)) symlinkSync(scratch, linkedFolder);
    expect(within(join(linkedFolder, 'outside.json'), [inside])).toEqual({
      problem: `${join(linkedFolder, 'outside.json')} goes through a link, which is not followed.`,
    });
    // A package whose own file is a link: the validator would read wherever it points.
    const root = demoWith('linked-actions', (copy) => {
      const actions = join(copy, 'bundle', 'agentic-ui-config', 'actions.json');
      rmSync(actions);
      symlinkSync(outsideFile, actions);
    });
    await expect(validatePackage({ directory: root }, SCRATCH)).rejects.toThrow(
      'holds a link, bundle/agentic-ui-config/actions.json, which is not followed',
    );
  });

  it('counts a hard link as a link: its other name can be anywhere on the volume', async () => {
    const elsewhere = join(scratch, 'hard-original.json');
    writeFileSync(elsewhere, '{}');
    const root = demoWith('hard-linked-actions', (copy) => {
      const actions = join(copy, 'bundle', 'agentic-ui-config', 'actions.json');
      rmSync(actions);
      linkSync(elsewhere, actions);
    });
    await expect(validatePackage({ directory: root }, SCRATCH)).rejects.toThrow(
      'holds a link, bundle/agentic-ui-config/actions.json, which is not followed',
    );
    const inside = join(scratch, 'hard-inside');
    mkdirSync(inside, { recursive: true });
    const named = join(inside, 'allow-list.json');
    if (!existsSync(named)) linkSync(elsewhere, named);
    expect(within(named, [inside])).toEqual({
      problem: `${named} goes through a link, which is not followed.`,
    });
  });

  it('takes an allow-list or a registered file only as a JSON file', async () => {
    const text = join(scratch, 'allow-list.txt');
    writeFileSync(text, 'operations');
    await expect(
      validatePackage({ directory: demoWith('text-allow-list'), allowList: text }, SCRATCH),
    ).rejects.toThrow('allowList: ');
    await expect(
      validatePackage({ directory: demoWith('text-allow-list-2'), registered: text }, SCRATCH),
    ).rejects.toThrow('is not a JSON file');
  });
});

describe('the pipeline process', () => {
  it('gets no credential from the environment, only where programs are', async () => {
    expect(
      pipelineEnvironment({
        PATH: '/bin',
        NUXEO_PASS: 'x',
        NUXEO_USER: 'y',
        SATORI_GH_READONLY_TOKEN: 'z',
      }),
    ).toEqual({ PATH: '/bin' });
    // Given a temporary folder, it is the temporary folder under every system's name for it, and
    // replaces the server's own.
    expect(
      pipelineEnvironment({ PATH: '/bin', TMPDIR: '/elsewhere', NUXEO_PASS: 'x' }, '/work'),
    ).toEqual({ PATH: '/bin', TMPDIR: '/work', TEMP: '/work', TMP: '/work' });
    const saved = process.env['NUXEO_PASS'];
    process.env['NUXEO_PASS'] = 'not-a-real-password';
    try {
      const run = await runNode(
        ['-e', 'process.stdout.write(String(process.env.NUXEO_PASS))'],
        30_000,
      );
      expect(run.stdout).toBe('undefined');
    } finally {
      if (saved === undefined) delete process.env['NUXEO_PASS'];
      else process.env['NUXEO_PASS'] = saved;
    }
  });

  it.skipIf(process.platform === 'win32')(
    'is stopped whole when it takes too long: what it started stops too',
    async () => {
      const marker = join(scratch, 'grandchild-wrote');
      const run = await runNode(['-e', SPAWN_GRANDCHILD, marker, GRANDCHILD], 500);
      expect(run.failure).toContain('was stopped');
      await new Promise((done) => setTimeout(done, 2500));
      expect(existsSync(marker)).toBe(false);
    },
    10_000,
  );

  it.skipIf(process.platform === 'win32')(
    'is stopped with the server: a signal to the server stops what it started',
    async () => {
      const marker = join(scratch, 'outlived-the-server');
      const module = new URL('./validate-package.ts', import.meta.url).href;
      // A server that starts a pipeline and says so, then is sent SIGTERM.
      const server = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          SERVER_RUNNING_A_PIPELINE,
          module,
          marker,
          SPAWN_GRANDCHILD,
          GRANDCHILD,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      await new Promise<void>((done) => server.stdout.once('data', () => done()));
      const ended = new Promise((done) => server.once('close', done));
      server.kill('SIGTERM');
      await ended;
      await new Promise((done) => setTimeout(done, 2500));
      expect(existsSync(marker)).toBe(false);
    },
    15_000,
  );
});
