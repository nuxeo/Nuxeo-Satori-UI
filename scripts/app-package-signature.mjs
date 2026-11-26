#!/usr/bin/env node
/**
 * Sign an app definition package's zip, verify one before it is published or installed, and decide
 * whether a tag build can sign (docs/business-apps/package-pipeline.md, section 9). What is signed
 * and what a verification holds a zip to are in `package-signature.mjs`, whose functions this runs.
 *
 *   node scripts/app-package-signature.mjs verify <zip> [--signature <file>]
 *     [--trusted-signers <file>] [--name <package>] [--version <version>] [--trusted-root <file>]
 *   node scripts/app-package-signature.mjs sign <zip> (--ephemeral-key --signers-out <file> | --key <file>)
 *     [--commit <sha>] [--out <file>]
 *   node scripts/app-package-signature.mjs ci-plan <zip> --predicate-out <file> [--trusted-signers <file>]
 *
 * - **`verify`** reads the signature beside the zip, `<zip>.sig.json`, unless `--signature` names
 *   another, and holds it to the trusted signers, `business-apps/trusted-signers.json` unless
 *   `--trusted-signers` names another file. `--name` and `--version` pin the package expected, as
 *   app-packages.yml pins the tag's. A keyless signature is checked with `gh attestation verify`,
 *   which fetches Sigstore's trusted root unless `--trusted-root` gives one, for a server offline.
 * - **`sign`** signs with an Ed25519 key, for a local run or a deployment's own key. With
 *   `--ephemeral-key` the key is made for this run and never written: its public half is written
 *   to `--signers-out`, as a trusted-signers file to verify with. `--key` reads a private key from a
 *   file, which must be outside the repository, where a key is one commit from being published.
 *   `--commit` is the commit the zip was built from, `git rev-parse HEAD` by default.
 * - **`ci-plan`** is app-packages.yml's `sign` job's decision: for a tag build of this package, on
 *   GitHub's runners, with an OIDC identity, by a workflow the trusted signers name, it writes the
 *   predicate to `--predicate-out` and `sign=true` to `$GITHUB_OUTPUT`; otherwise `sign=false`, a
 *   warning naming why, and the same in the job's summary, and the job neither signs nor publishes.
 *
 * It runs unconditionally, with no "was I started directly?" guard: one that misfired would exit 0
 * having verified nothing, and the workflow publishes on that exit code.
 *
 * Exit codes: 0, verified, signed, or `ci-plan` decided either way; 1, refused; 2, the command or
 * the trusted signers were wrong.
 */
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREDICATE_TYPE,
  Refusal,
  TRUSTED_SIGNERS,
  Usage,
  ciPlan,
  readTrustedSigners,
  signWithKey,
  signatureFileFor,
  verifySignature,
} from './package-signature.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = [
  'usage: node scripts/app-package-signature.mjs verify <zip> [--signature <file>] [--trusted-signers <file>]',
  '         [--name <package>] [--version <version>] [--trusted-root <file>]',
  '       node scripts/app-package-signature.mjs sign <zip> (--ephemeral-key --signers-out <file> | --key <file>)',
  '         [--commit <sha>] [--out <file>]',
  '       node scripts/app-package-signature.mjs ci-plan <zip> --predicate-out <file> [--trusted-signers <file>]',
].join('\n');

const VALUED = {
  verify: ['--signature', '--trusted-signers', '--name', '--version', '--trusted-root'],
  sign: ['--key', '--signers-out', '--commit', '--out'],
  'ci-plan': ['--predicate-out', '--trusted-signers'],
};
const FLAGS = { verify: [], sign: ['--ephemeral-key'], 'ci-plan': [] };

/** The command line, or a usage error: every option once, and none empty. */
function parse(argv) {
  const [command, zip, ...rest] = argv;
  if (!VALUED[command] || zip === undefined || zip === '' || zip.startsWith('--'))
    throw new Usage(USAGE);
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const key = arg.slice(2);
    if (options[key] !== undefined) throw new Usage(`${arg} is given twice.\n${USAGE}`);
    if (FLAGS[command].includes(arg)) options[key] = true;
    else if (
      VALUED[command].includes(arg) &&
      rest[index + 1] !== undefined &&
      rest[index + 1] !== '' &&
      !rest[index + 1].startsWith('--')
    )
      options[key] = rest[++index];
    else throw new Usage(`${arg} is not an option of ${command}, or has no value.\n${USAGE}`);
  }
  return { command, zip: resolve(zip), options };
}

/** A path as the log shows it: from here when it is below here, whole otherwise. */
const shown = (path) => {
  const near = relative(process.cwd(), path);
  return near === '' || near.startsWith('..') ? path : near;
};

function verify(zip, options) {
  const result = verifySignature({
    zip,
    signature: options.signature ? resolve(options.signature) : signatureFileFor(zip),
    trusted: readTrustedSigners(resolve(options['trusted-signers'] ?? TRUSTED_SIGNERS)),
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

function sign(zip, options) {
  if (Boolean(options.key) === Boolean(options['ephemeral-key']))
    throw new Usage(`give --ephemeral-key or --key, one of them.\n${USAGE}`);
  if (options['ephemeral-key'] && !options['signers-out'])
    throw new Usage(
      `--ephemeral-key needs --signers-out, where its public key is written as a trusted signer.\n${USAGE}`,
    );
  if (options.key && options['signers-out'])
    throw new Usage(
      `--signers-out is for --ephemeral-key; a key of your own is trusted where you list it.\n${USAGE}`,
    );
  let privateKey;
  if (options.key) {
    const path = resolve(options.key);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Usage(`--key ${options.key} is not a file.`);
    const real = realpathSync.native(path);
    const repository = realpathSync.native(REPO);
    if (real === repository || real.startsWith(repository + sep))
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
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
    commit = head.status === 0 ? head.stdout.trim() : '';
    if (!commit)
      throw new Usage(`git could not say which commit this is: give --commit.\n${USAGE}`);
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
          $comment: `A key made for one run of app-package-signature.mjs sign and not kept, so it signs nothing else: ${basename(zip)}'s signer.`,
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

/** The `sign` job's decision, written where the workflow reads it. */
function plan(zip, options) {
  if (!options['predicate-out']) throw new Usage(`ci-plan needs --predicate-out.\n${USAGE}`);
  const decided = ciPlan({
    zip,
    env: process.env,
    trusted: readTrustedSigners(resolve(options['trusted-signers'] ?? TRUSTED_SIGNERS)),
  });
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

let code;
try {
  const { command, zip, options } = parse(process.argv.slice(2));
  code =
    command === 'verify'
      ? verify(zip, options)
      : command === 'sign'
        ? sign(zip, options)
        : plan(zip, options);
} catch (error) {
  if (error instanceof Usage) {
    console.error(error.message);
    code = 2;
  } else if (error instanceof Refusal) {
    console.error(`Refused: ${error.message}`);
    code = 1;
  } else throw error;
}
process.exit(code);
