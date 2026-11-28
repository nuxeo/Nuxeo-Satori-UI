/**
 * Whether a package is ready for a person to release it, and what that person runs to release it
 * (docs/business-apps/package-pipeline.md, section 9). Publishing is a person's step: a tag
 * `app-package/<name>/<version>`, which CI builds again, signs and, here, publishes. This checks
 * everything that can be checked before the tag, and says the tag; it never makes one. One
 * implementation, which two commands run: `scripts/app-release-check.mjs` here, and
 * `satori release-check` (`tools/satori-cli`), each giving it its own pipeline and what follows the
 * tag; the Builder MCP server's `release_check` runs whichever of the two is its own.
 *
 *   <command> <package> [--previous <directory or zip>] [--json] [the pipeline's options]
 *
 * 1. **It builds and validates the package,** every step the pipeline takes, into a scratch folder
 *    that is then removed: the pipeline is the host's, run as a command, given the options as they
 *    are. A package that does not build is not ready.
 * 2. **With `--previous`,** the package as it was installed, the host's upgrade check holds it to
 *    that one, a configuration package as an app definition: what a customer may override or name
 *    is removed only with a migration note, and its version rises as far as that needs. Without
 *    it, the answer says its upgrade was not checked.
 * 3. **Its tag is not one git has.** The name and version are read from the `package.xml` of the zip
 *    just built, and `refs/tags/app-package/<name>/<version>` must not be a ref of the git
 *    repository the package is in. A tag pushed by someone else and not fetched is not seen, which
 *    the answer says; a package in no git repository cannot be tagged, and is not ready.
 * 4. **It prints the commands a person runs,** the tag and its push, and says that publishing is
 *    theirs.
 *
 * It never makes or pushes a tag, never calls the Marketplace, and reads no credential: git is
 * asked only for its top folder and for one ref. `--json` prints one JSON object instead of the
 * text, the pipeline's own output inside it.
 *
 * Exit codes: 0, ready; 1, not ready; 2, the command was wrong, or could not be run.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { packageOf } from '../package-signature.mjs';
import { gitTopLevel } from './signature-command.mjs';

const OUTPUT_LIMIT = 64 * 1024 * 1024;

/**
 * The command. `host` gives `usage`, said with every command-line error; `pipeline`, the command
 * that builds a package, before the package's own arguments, run with `--out`; `upgradeCheck`, the
 * command that holds a package to what it was, run with `<package> --previous <previous>`; `after`,
 * what happens once the tag is pushed, in a sentence; and `program`, how the answer names it.
 */
export function releaseCheckCommand(argv, host) {
  const json = argv.includes('--json');
  const given = argv.filter((arg) => arg !== '--json');
  if (argv.length - given.length > 1 || given.length === 0 || given[0].startsWith('-')) {
    console.error(host.usage);
    return 2;
  }
  for (const refused of ['--out', '--tag'])
    if (given.includes(refused)) {
      console.error(
        `${refused} is not taken: the check writes nothing, and the tag is the person's to make.\n${host.usage}`,
      );
      return 2;
    }
  const [directory, ...rest] = given;
  const at = rest.indexOf('--previous');
  if (
    at >= 0 &&
    (rest[at + 1] === undefined ||
      rest[at + 1].startsWith('-') ||
      rest.lastIndexOf('--previous') !== at)
  ) {
    console.error(`--previous takes one package, a folder or its zip, once.\n${host.usage}`);
    return 2;
  }
  const previous = at >= 0 ? rest[at + 1] : null;
  // The build is given every option but --previous, which the upgrade check is given instead.
  const options = at >= 0 ? [...rest.slice(0, at), ...rest.slice(at + 2)] : rest;
  const reasons = [];
  const unchecked = [
    'a tag pushed by someone else that this clone has not fetched: run git fetch --tags first',
  ];
  const answer = {
    ready: false,
    package: directory,
    name: null,
    version: null,
    tag: null,
    built: false,
    previous,
    tagged: null,
    reasons,
    unchecked,
    commands: [],
    output: [],
    note: '',
  };

  const scratch = mkdtempSync(join(tmpdir(), 'satori-release-check-'));
  try {
    const [program, ...prefix] = host.pipeline;
    const built = spawnSync(program, [...prefix, directory, ...options, '--out', scratch], {
      encoding: 'utf8',
      maxBuffer: OUTPUT_LIMIT,
      stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (json) answer.output = lines(`${built.stdout ?? ''}\n${built.stderr ?? ''}`);
    if (built.error || built.status === 2) {
      if (!json)
        console.error(
          `${host.program}: the package could not be built: ${built.error?.message ?? 'the pipeline was called wrongly, as it says above'}.`,
        );
      return finish(json, { ...answer, note: 'The check could not be run.' }, 2);
    }
    if (built.status !== 0) {
      reasons.push(
        `it does not build: the pipeline refused it (exit ${built.status}), as its output says`,
      );
      return finish(json, answer, 1, host);
    }
    answer.built = true;
    const zips = readdirSync(scratch).filter((name) => name.endsWith('.zip'));
    const declared = zips.length === 1 ? packageOf(join(scratch, zips[0])) : null;
    if (declared === null) {
      reasons.push('the zip it built names no package and version in its package.xml');
      return finish(json, answer, 1, host);
    }
    answer.name = declared.name;
    answer.version = declared.version;
    answer.tag = `app-package/${declared.name}/${declared.version}`;
    if (previous === null)
      unchecked.unshift(
        'its upgrade from the version installed, which --previous <directory or zip> holds it to',
      );
    else {
      const [checker, ...checking] = host.upgradeCheck;
      const held = spawnSync(checker, [...checking, directory, '--previous', previous], {
        encoding: 'utf8',
        maxBuffer: OUTPUT_LIMIT,
        stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      });
      if (json) answer.output.push(...lines(`${held.stdout ?? ''}\n${held.stderr ?? ''}`));
      if (held.error || held.status === 2) {
        if (!json)
          console.error(
            `${host.program}: the upgrade check could not be made: ${held.error?.message ?? 'as it says above'}.`,
          );
        return finish(json, { ...answer, note: 'The upgrade check could not be made.' }, 2);
      }
      if (held.status !== 0) {
        reasons.push(
          `it does not keep what ${previous} had: the upgrade check refused it, as its output says`,
        );
        return finish(json, answer, 1, host);
      }
    }

    const repository = gitTopLevel(resolve(directory));
    if (repository === null) {
      reasons.push(
        `it is in no git repository, so ${answer.tag} cannot be checked, and a person tags it with git`,
      );
      return finish(json, answer, 1, host);
    }
    const ref = spawnSync('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${answer.tag}`], {
      cwd: repository,
      encoding: 'utf8',
    });
    if (ref.error) {
      reasons.push(`git could not be run (${ref.error.message}), so ${answer.tag} was not checked`);
      return finish(json, answer, 1, host);
    }
    answer.tagged = ref.status === 0;
    if (answer.tagged) {
      reasons.push(
        `${answer.tag} is a tag already: ${declared.version} was released, so raise the version in package/package.xml, and with an app definition in app.json and the manifest`,
      );
      return finish(json, answer, 1, host);
    }
    answer.ready = true;
    answer.commands = [`git tag ${answer.tag}`, `git push origin ${answer.tag}`];
    return finish(json, answer, 0, host, relative(repository, resolve(directory)) || '.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The answer, as text or as JSON, and its exit code. */
function finish(json, answer, code, host, shown) {
  const note =
    answer.note ||
    `${answer.ready ? 'Ready. ' : ''}Publishing is a person's step: once the change is merged, on the merged commit, a person runs the tag and its push${answer.ready ? ' above' : ''}. ${host?.after ?? ''} Nothing was tagged, pushed or published, and no credential was read.`;
  const said = { ...answer, note: note.replace(/\s+/g, ' ').trim() };
  if (json) {
    process.stdout.write(`${JSON.stringify(said)}\n`);
    return code;
  }
  if (code === 2) return code;
  const name = answer.name ? `${answer.name} ${answer.version}` : answer.package;
  if (answer.ready)
    process.stdout.write(
      `${host.program}: ${name}, ${shown}, builds and passes every step, and ${answer.tag} is not a tag here.${
        answer.previous === null
          ? ' Its upgrade was not checked: give --previous, the package as it is installed.'
          : ` It keeps what ${answer.previous} had, as far as its version says.`
      }

Publishing is a person's step. Once the change is merged, on the merged commit:

${answer.commands.map((command) => `  ${command}`).join('\n')}

${host.after} This check tagged nothing, pushed nothing, published nothing, and read no credential.
Not checked: ${answer.unchecked.join('; ')}.
`,
    );
  else {
    console.error(`${host.program}: ${name} is not ready to release:`);
    for (const reason of answer.reasons) console.error(`  - ${reason}`);
    console.error("Publishing is a person's step; nothing was tagged, pushed or published.");
  }
  return code;
}

function lines(text) {
  return text.split(/\r?\n/).filter((line) => line !== '');
}
