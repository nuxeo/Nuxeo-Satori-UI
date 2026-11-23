import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT, platformVersion, validatePackage } from './validate-package.ts';

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

const LAYOUT = join('bundle', 'agentic-ui-config', 'layouts', 'Claim', 'view.layout.json');

describe('validatePackage', () => {
  it('passes the demo package, as CI does, writing nothing into it', async () => {
    const root = demoWith('sound');
    const before = everyFile(root);
    const left = leftovers();
    const check = await validatePackage({ directory: root });
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
    const check = await validatePackage({ directory: root });
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
    const check = await validatePackage({ directory: root });
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
    const check = await validatePackage({ directory: root });
    expect(check.refusedAt?.step).toBe(3);
    expect(check.refusedAt?.reason).toContain('They are one version');
  });

  it("holds app.json's platform range to the version it is given", async () => {
    const check = await validatePackage({ directory: demoWith('platform'), platform: '99.0.0' });
    expect(check.passed).toBe(false);
    expect(check.refusedAt?.step).toBe(2);
    expect(check.findings.map((finding) => finding.file)).toContain(
      'bundle/agentic-ui-config/app.json',
    );
  });

  it('says when a folder or a file it was given is not there', async () => {
    await expect(validatePackage({ directory: join(scratch, 'none') })).rejects.toThrow(
      'is not a folder',
    );
    await expect(
      validatePackage({ directory: demoWith('allow-list'), allowList: join(scratch, 'none.json') }),
    ).rejects.toThrow('allowList');
  });
});
