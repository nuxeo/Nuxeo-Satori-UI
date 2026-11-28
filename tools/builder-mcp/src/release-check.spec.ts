/**
 * `release_check`, as this repository runs it: `scripts/app-release-check.mjs`, the check
 * `satori release-check` shares, on copies of a kit in scratch git repositories of their own, so no
 * tag is ever looked for or made in this checkout. A package that is ready answers its tag and the
 * commands a person runs, and the check makes no tag; one whose version is tagged already, one that
 * does not build, and one in no git repository, are each not ready, for their own reason.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';
import { REPO_ROOT, releaseCheck } from './validate-package.ts';

const KIT = join(REPO_ROOT, 'business-apps', 'packages', 'contracts-demo');
const scratch = mkdtempSync(join(tmpdir(), 'builder-mcp-release-spec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** git in `cwd`, as a person with no configuration of their own would run it. */
function git(cwd: string, ...args: string[]) {
  return spawnSync(
    'git',
    [
      '-c',
      'user.name=Release Check Spec',
      '-c',
      'user.email=spec@example.invalid',
      // A person's own signing settings would sign, or fail to, what is only a scratch commit.
      '-c',
      'commit.gpgSign=false',
      '-c',
      'tag.gpgSign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

/** A copy of the kit in `kits/` of a new folder, a git repository with it committed unless not. */
function repositoryWithKit(name: string, committed = true): string {
  const root = join(scratch, name);
  const kit = join(root, 'kits', 'contracts-demo');
  mkdirSync(join(root, 'kits'), { recursive: true });
  cpSync(KIT, kit, { recursive: true, filter: (source) => relative(KIT, source) !== 'dist' });
  if (committed) {
    expect(git(root, 'init', '--quiet').status).toBe(0);
    expect(git(root, 'add', '.').status).toBe(0);
    expect(git(root, 'commit', '--quiet', '-m', 'the kit').status).toBe(0);
  }
  return kit;
}

const version = /version="([^"]+)"/.exec(
  readFileSync(join(KIT, 'package', 'package.xml'), 'utf8'),
)?.[1];
const tag = `app-package/contracts-demo/${version}`;

describe.skipIf(!PIPELINE_TESTS_RUN)('release_check', () => {
  it('answers a package that is ready with its tag and the commands, and makes no tag', async () => {
    const kit = repositoryWithKit('ready');
    const check = await releaseCheck({ directory: kit }, { roots: [scratch] });
    expect(check.reasons).toEqual([]);
    expect(check.ready).toBe(true);
    expect(check.built).toBe(true);
    expect(check.tagged).toBe(false);
    expect(check.tag).toBe(tag);
    expect(check.commands).toEqual([`git tag ${tag}`, `git push origin ${tag}`]);
    expect(check.note).toContain("Publishing is a person's step");
    expect(check.command).toContain('node scripts/app-release-check.mjs');
    // Its upgrade was not checked, which it says, since no previous was given.
    expect(check.unchecked.join(' ')).toContain('its upgrade from the version installed');
    expect(git(join(scratch, 'ready'), 'tag', '--list').stdout).toBe('');
  });

  it('refuses a version that is tagged already', async () => {
    const kit = repositoryWithKit('tagged');
    const tagged = git(join(scratch, 'tagged'), 'tag', tag);
    expect(tagged.status, tagged.stderr).toBe(0);
    const check = await releaseCheck({ directory: kit }, { roots: [scratch] });
    expect(check.ready).toBe(false);
    expect(check.built).toBe(true);
    expect(check.tagged).toBe(true);
    expect(check.commands).toEqual([]);
    expect(check.reasons.join(' ')).toContain(`${tag} is a tag already`);
  });

  it('refuses a package that does not build', async () => {
    const kit = repositoryWithKit('broken');
    const layout = join(kit, 'bundle', 'agentic-ui-config', 'app.json');
    const app = JSON.parse(readFileSync(layout, 'utf8')) as Record<string, unknown>;
    writeFileSync(layout, `${JSON.stringify({ ...app, bogus: true }, null, 2)}\n`);
    const check = await releaseCheck({ directory: kit }, { roots: [scratch] });
    expect(check.ready).toBe(false);
    expect(check.built).toBe(false);
    expect(check.tag).toBeNull();
    expect(check.reasons.join(' ')).toContain('it does not build');
    expect(check.output.join('\n')).toContain('"bogus" is not a key');
  });

  it('refuses a package in no git repository, whose tag cannot be checked', async () => {
    const kit = repositoryWithKit('loose', false);
    const check = await releaseCheck({ directory: kit }, { roots: [scratch] });
    expect(check.ready).toBe(false);
    expect(check.built).toBe(true);
    expect(check.reasons.join(' ')).toContain('it is in no git repository');
  });

  it('reads only inside its roots', async () => {
    await expect(releaseCheck({ directory: KIT }, { roots: [scratch] })).rejects.toThrow(
      'is outside the repository',
    );
  });
});
