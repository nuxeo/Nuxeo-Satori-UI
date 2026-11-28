/**
 * Signing a package's zip and verifying one, as commands (docs/business-apps/package-pipeline.md,
 * section 9). One implementation, which two commands run: `scripts/app-package-signature.mjs`
 * here, and `satori sign` and `satori verify` (`tools/satori-cli`), each giving
 * `signatureCommand` what is its own: its usage, the repository a key must be kept out of and git
 * runs in, and the trusted signers it reads unless told another file, or none. What is signed and
 * what a verification holds a zip to are `package-signature.mjs`'s.
 *
 *   verify <zip> [--signature <file>] [--trusted-signers <file>] [--name <package>]
 *     [--version <version>] [--trusted-root <file>]
 *   sign <zip> (--ephemeral-key --signers-out <file> | --key <file>) [--commit <sha>] [--out <file>]
 *   ci-plan <zip> --predicate-out <file> [--trusted-signers <file>]
 *
 * - **`verify`** reads the signature beside the zip, `<zip>.sig.json`, unless `--signature` names
 *   another, and holds it to the trusted signers. `--name` and `--version` pin the package
 *   expected. A keyless signature is checked with `gh attestation verify`, which fetches
 *   Sigstore's trusted root unless `--trusted-root` gives one, for a server offline.
 * - **`sign`** signs with an Ed25519 key. With `--ephemeral-key` the key is made for this run and
 *   never written: its public half is written to `--signers-out`, as a trusted-signers file to
 *   verify with. `--key` reads a private key from a file, which must be outside the repository,
 *   where a key is one commit from being published. `--commit` is the commit the zip was built
 *   from, `git rev-parse HEAD` in the repository by default, refused when anything is uncommitted.
 * - **`ci-plan`** is a CI job's decision whether to sign keyless: for a tag build of this package,
 *   on GitHub's runners, with an OIDC identity, by a workflow the trusted signers name, it writes
 *   the predicate to `--predicate-out` and `sign=true` to `$GITHUB_OUTPUT`, for `actions/attest` to
 *   sign through Sigstore with the run's identity; otherwise `sign=false`, a warning naming why,
 *   and the same in the job's summary.
 *
 * Exit codes: 0, verified, signed, or `ci-plan` decided either way; 1, refused; 2, the command or
 * the trusted signers were wrong. Anything else is thrown, for the caller's own crash to show.
 */
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

import {
  PREDICATE_TYPE,
  Refusal,
  Usage,
  ciPlan,
  readTrustedSigners,
  signWithKey,
  signatureFileFor,
  verifySignature,
} from '../package-signature.mjs';

const VALUED = {
  verify: ['--signature', '--trusted-signers', '--name', '--version', '--trusted-root'],
  sign: ['--key', '--signers-out', '--commit', '--out'],
  'ci-plan': ['--predicate-out', '--trusted-signers'],
};
const FLAGS = { verify: [], sign: ['--ephemeral-key'], 'ci-plan': [] };

/**
 * The command, `argv` being `<verify|sign|ci-plan> <zip> [options]`. `host` gives:
 *
 * - `usage`, said with every command-line error;
 * - `program`, how the command is named in what it writes, such as the ephemeral key's comment;
 * - `repository`, the folder git runs in for the commit, and that a `--key` must be outside;
 * - `trustedSigners`, the file read unless `--trusted-signers` names another, or `null`, when it
 *   must be given.
 */
export function signatureCommand(argv, host) {
  try {
    const { command, zip, options } = parse(argv, host);
    return command === 'verify'
      ? verify(zip, options, host)
      : command === 'sign'
        ? sign(zip, options, host)
        : plan(zip, options, host);
  } catch (error) {
    if (error instanceof Usage) {
      console.error(error.message);
      return 2;
    }
    if (error instanceof Refusal) {
      console.error(`Refused: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

/** The command line, or a usage error: every option once, and none empty. */
function parse(argv, { usage }) {
  const [command, zip, ...rest] = argv;
  if (!Object.hasOwn(VALUED, command) || zip === undefined || zip === '' || zip.startsWith('--'))
    throw new Usage(usage);
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const key = arg.slice(2);
    if (options[key] !== undefined) throw new Usage(`${arg} is given twice.\n${usage}`);
    if (FLAGS[command].includes(arg)) options[key] = true;
    else if (
      VALUED[command].includes(arg) &&
      rest[index + 1] !== undefined &&
      rest[index + 1] !== '' &&
      !rest[index + 1].startsWith('--')
    )
      options[key] = rest[++index];
    else throw new Usage(`${arg} is not an option of ${command}, or has no value.\n${usage}`);
  }
  return { command, zip: resolve(zip), options };
}

/** The trusted signers: `--trusted-signers`, or the host's file, or a usage error when it has none. */
function trustedSignersOf(options, { trustedSigners, usage }) {
  const file = options['trusted-signers'] ?? trustedSigners;
  if (file === null || file === undefined)
    throw new Usage(
      `--trusted-signers is needed: the file of who may sign, which you keep. Nothing is trusted by default.\n${usage}`,
    );
  return readTrustedSigners(resolve(file));
}

/** A path as the log shows it: from here when it is below here, whole otherwise. */
const shown = (path) => {
  const near = relative(process.cwd(), path);
  return near === '' || near.startsWith('..') ? path : near;
};

function verify(zip, options, host) {
  const result = verifySignature({
    zip,
    signature: options.signature ? resolve(options.signature) : signatureFileFor(zip),
    trusted: trustedSignersOf(options, host),
    name: options.name,
    version: options.version,
    trustedRoot: options['trusted-root'],
  });
  if (!result.ok) {
    console.error(`${basename(zip)} is refused:`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  const { record } = result;
  process.stdout.write(
    `${basename(zip)}: ${record.package} ${record.version}, sha256 ${record.sha256}, built from ${record.commit}, ` +
      `signed by ${record.signer} (${record.kind === 'ed25519' ? record.keyId : `${record.workflow} for ${record.ref}`}). Verified.\n`,
  );
  return 0;
}

function sign(zip, options, { usage, program, repository }) {
  if (Boolean(options.key) === Boolean(options['ephemeral-key']))
    throw new Usage(`give --ephemeral-key or --key, one of them.\n${usage}`);
  if (options['ephemeral-key'] && !options['signers-out'])
    throw new Usage(
      `--ephemeral-key needs --signers-out, where its public key is written as a trusted signer.\n${usage}`,
    );
  if (options.key && options['signers-out'])
    throw new Usage(
      `--signers-out is for --ephemeral-key; a key of your own is trusted where you list it.\n${usage}`,
    );
  let privateKey;
  if (options.key) {
    const path = resolve(options.key);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Usage(`--key ${options.key} is not a file.`);
    const real = realpathSync.native(path);
    const inside = realpathSync.native(repository);
    if (real === inside || real.startsWith(inside + sep))
      throw new Usage(
        `--key ${options.key} is inside the repository, where a private key is one commit from being ` +
          'published. Keep it outside, or use --ephemeral-key.',
      );
    try {
      privateKey = createPrivateKey(readFileSync(path));
    } catch (error) {
      throw new Usage(`--key ${options.key} is not a private key (${error.message}).`);
    }
  } else {
    // Made for this run and never written: only its public half leaves the process.
    privateKey = generateKeyPairSync('ed25519').privateKey;
  }
  let commit = options.commit;
  if (commit === undefined) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' });
    commit = head.status === 0 ? head.stdout.trim() : '';
    if (!commit)
      throw new Usage(`git could not say which commit this is: give --commit.\n${usage}`);
    // HEAD is what the zip was built from only when nothing is uncommitted.
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: repository,
      encoding: 'utf8',
    });
    if (status.status !== 0 || status.stdout.trim() !== '')
      throw new Usage(
        `the working tree has uncommitted changes, so ${commit.slice(0, 12)} may not be what the zip was built from: give --commit.\n${usage}`,
      );
  }
  const envelope = signWithKey({ zip, privateKey, commit });
  const out = resolve(options.out ?? signatureFileFor(zip));
  writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`);
  const keyId = envelope.signatures[0].keyid;
  if (options['ephemeral-key']) {
    const signers = resolve(options['signers-out']);
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    const id = `run-time-key-${keyId.slice('sha256:'.length, 'sha256:'.length + 12)}`;
    writeFileSync(
      signers,
      `${JSON.stringify(
        {
          $comment: `A key made for one run of ${program} sign and not kept, so it signs nothing else: ${basename(zip)}'s signer.`,
          signers: [{ id, kind: 'ed25519', publicKey }],
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`Its public half, as a trusted signer, ${id}: ${shown(signers)}.\n`);
  }
  process.stdout.write(`${basename(zip)} signed by ${keyId}, from ${commit}: ${shown(out)}.\n`);
  return 0;
}

/** A CI job's decision, written where the workflow reads it. */
function plan(zip, options, host) {
  if (!options['predicate-out']) throw new Usage(`ci-plan needs --predicate-out.\n${host.usage}`);
  const decided = ciPlan({ zip, env: process.env, trusted: trustedSignersOf(options, host) });
  const output = (line) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  };
  if (!decided.sign) {
    const message = `${basename(zip)} is not signed, and so not published: ${decided.reason}.`;
    process.stdout.write(`::warning title=Not signed, not published::${message}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**Not signed, not published.** ${message}\n`,
      );
    output('sign=false');
    return 0;
  }
  const predicateOut = resolve(options['predicate-out']);
  writeFileSync(predicateOut, `${JSON.stringify(decided.predicate, null, 2)}\n`);
  output('sign=true');
  output(`predicate-type=${PREDICATE_TYPE}`);
  output(`predicate-path=${predicateOut}`);
  process.stdout.write(
    `${basename(zip)}: ${decided.predicate.package} ${decided.predicate.version}, sha256 ${decided.predicate.sha256}, ` +
      `from ${decided.predicate.commit}, to be signed by ${decided.signer} for ${decided.predicate.signer.ref}.\n`,
  );
  return 0;
}
