import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  pipelineEnvironment,
  platformVersion,
  runNode,
  validatePackage,
} from './validate-package.ts';

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

function leftovers(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('builder-mcp-package-'));
}

/** The scratch copies are outside the repository, so the tests name their folder as a root. */
const SCRATCH = { roots: [REPO_ROOT, scratch] };

const LAYOUT = join('bundle', 'agentic-ui-config', 'layouts', 'Claim', 'view.layout.json');

describe('validatePackage', () => {
  it('passes the demo package, as CI does, writing nothing into it', async () => {
    const root = demoWith('sound');
    const before = everyFile(root);
    const left = leftovers();
    const check = await validatePackage({ directory: root }, SCRATCH);
    expect(check.passed).toBe(true);
    expect(check.exitCode).toBe(0);
    expect(check.refusedAt).toBeNull();
    expect(check.findings).toEqual([]);
    expect(check.zip?.name).toMatch(/^payers-claims-demo-.+\.zip$/);
    expect(check.zip?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(check.command).toContain(`--platform ${platformVersion()}`);
    expect(everyFile(root)).toEqual(before);
    // The temporary folder the zip went to is gone too.
    expect(leftovers()).toEqual(left);
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
    await expect(validatePackage({ directory: file }, SCRATCH)).rejects.toThrow('is not a folder');
  });

  it('says when it ran as CI runs it, and when it was given more', async () => {
    const root = demoWith('departs');
    const asCi = await validatePackage({ directory: root }, SCRATCH);
    expect(asCi).toMatchObject({ asCi: true, departsFromCi: [] });
    const allowList = join(scratch, 'allow-list.json');
    writeFileSync(allowList, JSON.stringify({ operations: [] }));
    const given = await validatePackage({ directory: root, allowList, platform: '0.9.0' }, SCRATCH);
    expect(given).toMatchObject({ asCi: false, departsFromCi: ['allowList', 'platform'] });
    expect(given.command).toContain('--allow-list <file>');
  });

  it('refuses an empty platform, which the pipeline would take as none and check nothing', async () => {
    await expect(
      validatePackage({ directory: demoWith('empty-platform'), platform: '' }, SCRATCH),
    ).rejects.toThrow('is not a version');
  });
});

describe('what validatePackage may read', () => {
  it('refuses a folder or a file outside the repository, so nothing there is quoted back', async () => {
    const root = demoWith('outside');
    // The default root is the repository, and the scratch copy is not in it.
    await expect(validatePackage({ directory: root })).rejects.toThrow('outside the repository');
    const secret = join(scratch, 'secret.txt');
    writeFileSync(secret, 'not JSON, and not for the agent');
    await expect(
      validatePackage({
        directory: 'business-apps/packages/payers-claims-demo',
        allowList: secret,
      }),
    ).rejects.toThrow(/^allowList: .* is outside the repository, and is not read\.$/);
  });

  it('follows a link before deciding, so a link inside cannot reach out', async () => {
    const inside = join(scratch, 'inside');
    mkdirSync(inside, { recursive: true });
    const outsideFile = join(scratch, 'outside.json');
    writeFileSync(outsideFile, '{}');
    const link = join(inside, 'link.json');
    if (!existsSync(link)) symlinkSync(outsideFile, link);
    await expect(
      validatePackage({ directory: inside, allowList: link }, { roots: [inside] }),
    ).rejects.toThrow(/^allowList: .* is outside the repository/);
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
      const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500)`;
      const run = await runNode(
        [
          '-e',
          `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setTimeout(() => {}, 60000);`,
        ],
        500,
      );
      expect(run.failure).toContain('was stopped');
      await new Promise((done) => setTimeout(done, 2500));
      expect(existsSync(marker)).toBe(false);
    },
    10_000,
  );
});
