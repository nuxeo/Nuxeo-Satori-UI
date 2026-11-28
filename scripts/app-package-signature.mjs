#!/usr/bin/env node
/**
 * Sign an app definition package's zip, verify one before it is published or installed, and decide
 * whether a tag build can sign (docs/business-apps/package-pipeline.md, section 9). The command is
 * `package-pipeline/signature-command.mjs`'s, which `satori sign` and `satori verify` run too; this
 * gives it this repository, and its trusted signers. What is signed and what a verification holds
 * a zip to are in `package-signature.mjs`.
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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRUSTED_SIGNERS } from './package-signature.mjs';
import { signatureCommand } from './package-pipeline/signature-command.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = [
  'usage: node scripts/app-package-signature.mjs verify <zip> [--signature <file>] [--trusted-signers <file>]',
  '         [--name <package>] [--version <version>] [--trusted-root <file>]',
  '       node scripts/app-package-signature.mjs sign <zip> (--ephemeral-key --signers-out <file> | --key <file>)',
  '         [--commit <sha>] [--out <file>]',
  '       node scripts/app-package-signature.mjs ci-plan <zip> --predicate-out <file> [--trusted-signers <file>]',
].join('\n');

process.exit(
  signatureCommand(process.argv.slice(2), {
    usage: USAGE,
    program: 'app-package-signature.mjs',
    repository: REPO,
    trustedSigners: TRUSTED_SIGNERS,
  }),
);
