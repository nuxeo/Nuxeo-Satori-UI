#!/usr/bin/env node
/**
 * Controls for package signatures (`package-signature.mjs`, and `app-package-signature.mjs`, run as
 * a command), and for the CI wiring that signs and publishes (`app-packages.yml`).
 *
 * A verification only ever seen passing is an assertion. Each control here breaks one thing and
 * must see it refused, for its own reason; the sound package must pass. The packages are real: the
 * contracts kit, built by the pipeline at its version and at the next, in a scratch copy.
 *
 * - **An Ed25519 signature,** with keys made at run time and never written to the repository: a
 *   good one verifies, with what it records; refused are a changed byte in the zip, a changed
 *   statement, a key no trusted signer has, a trusted key's id on another key's signature, no
 *   signature, and a signature of another version three ways (beside the other version's zip, on
 *   its own zip renamed to the other version's name, and held to the other version by `--version`).
 *   The repository's own trusted signers, which list no key, refuse it too, and `--key` refuses a
 *   private key inside the repository.
 * - **A keyless signature,** checked by `gh attestation verify`, which is stood in for: a script on
 *   the PATH that holds the bundle to the identity a stand-in certificate in it names, as gh holds
 *   a real bundle to its certificate. So these controls prove what this repository's code does,
 *   the identity it pins and what it refuses before and after gh, and not Sigstore's cryptography,
 *   which is gh's: a real bundle is first checked on a tag build. Refused are a changed byte, a
 *   workflow that is not a trusted signer, a certificate of another repository's workflow under a
 *   predicate claiming the trusted one, a certificate of another version's tag, a self-hosted
 *   runner, a commit the certificate's run was not on, and no gh on the PATH. JSON lines, as
 *   `gh attestation download` writes them, pass by a genuine signature among a forged one and the
 *   provenance, and are refused when none is a package signature or every one is refused. With
 *   gh installed, every flag passed to it is one it has.
 * - **The skip logic of the `sign` job** (`ci-plan`): with an identity, on GitHub's runners, from the
 *   trusted workflow, it signs, and its predicate verifies once signed; with no identity, on a
 *   self-hosted runner, or from a fork, it skips with a warning and `sign=false`; on a branch, or
 *   on a tag naming another package, it refuses.
 * - **The workflow:** only the `sign` job holds an OIDC identity, its signing steps run only when
 *   `ci-plan` said so, and `publish` runs only when the zip was signed, with the verification before
 *   the publish. `publish` waits in the `marketplace-preprod` environment, the only job that names
 *   one or reads the Marketplace credentials, and checks a person had to approve before anything
 *   else. Each of those, broken in a copy of the workflow's text, is refused.
 * - **The approval gate** (`app-package-approval.mjs`), run as the workflow runs it with a stand-in
 *   for GitHub's answer: an environment with a team of reviewers, self-review prevented and no
 *   bypass passes. Refused are no environment, another one, one with no reviewer (as GitHub creates
 *   it), an empty list of reviewers, self-review allowed, an administrator bypass, an answer that
 *   says nothing of the bypass, and an answer that is not JSON.
 *
 * Node, git and `unzip`, as the pipeline needs, and no install: it runs in app-packages.yml's check
 * job, which has no node_modules. POSIX only, for the stand-in gh.
 *
 * Usage: node scripts/app-package-signature.selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OIDC_ISSUER,
  PREDICATE_TYPE,
  TRUSTED_SIGNERS,
  Usage,
  ghArguments,
  keyIdOf,
  readTrustedSigners,
  signStatement,
  signWithKey,
  statementFor,
  tagFor,
} from './package-signature.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO, 'scripts', 'app-package-signature.mjs');
const KIT = join(REPO, 'business-apps', 'packages', 'contracts-demo');
const WORKFLOW = join(REPO, '.github', 'workflows', 'app-packages.yml');
const APPROVAL = join(REPO, 'scripts', 'app-package-approval.mjs');
const APPROVAL_STEP = 'node scripts/app-package-approval.mjs --environment marketplace-preprod';
const TRUSTED_REPOSITORY = 'nuxeo/Nuxeo-Satori-UI';
const TRUSTED_WORKFLOW = '.github/workflows/app-packages.yml';
const COMMIT = 'c0ffee0000000000000000000000000000c0ffee';

const failures = [];
let negative = 0;
let positive = 0;

/** One control: `ok` is whether it held, `refusal` whether it is a negative one. */
function check(name, ok, detail, refusal = true) {
  if (refusal) negative += 1;
  else positive += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${refusal ? '[-]' : '[+]'} ${name}\n`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'app-package-signature-selftest-'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The command, with `env` added to this environment. */
function cli(args, env = {}) {
  const run = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: run.status,
    out: run.stdout,
    err: run.stderr,
    all: `${run.stdout}${run.stderr}`,
  };
}

/** A file of trusted signers in the scratch folder. */
function signersFile(label, signers) {
  const path = join(scratch, `${label}.signers.json`);
  writeFileSync(path, `${JSON.stringify({ signers }, null, 2)}\n`);
  return path;
}

/** An Ed25519 key pair made for this run, and its entry as a trusted signer. */
function runTimeKey(id) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey,
    keyId: keyIdOf(publicKey),
    entry: { id, kind: 'ed25519', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) },
  };
}

/** A copy of `path` in a folder of its own, under the same name, so a signature beside it is read. */
function copyInto(label, path) {
  const folder = join(scratch, 'copies', label);
  mkdirSync(folder, { recursive: true });
  const copy = join(folder, basename(path));
  copyFileSync(path, copy);
  return copy;
}

// ── The packages: the contracts kit, at its version and the next ────────────────────────────────
/** The kit built by the pipeline in a scratch copy, its version set to `version` when given. */
function built(label, version) {
  const directory = join(scratch, 'kits', label, basename(KIT));
  cpSync(KIT, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
  const current = /<package\b[^>]*\bversion="([^"]+)"/.exec(
    readFileSync(join(directory, 'package', 'package.xml'), 'utf8'),
  )?.[1];
  if (!current) throw new Error(`${KIT}'s package.xml declares no version`);
  if (version !== undefined) {
    for (const [file, from, to] of [
      ['package/package.xml', `version="${current}"`, `version="${version}"`],
      [
        'bundle/agentic-ui-config/app.json',
        `"packageVersion": "${current}"`,
        `"packageVersion": "${version}"`,
      ],
      ['bundle/META-INF/MANIFEST.MF', `Bundle-Version: ${current}`, `Bundle-Version: ${version}`],
    ]) {
      const path = join(directory, file);
      const text = readFileSync(path, 'utf8');
      if (!text.includes(from))
        throw new Error(`the control's version change does not apply to ${file}`);
      writeFileSync(path, text.replace(from, to));
    }
  }
  const out = join(scratch, 'zips', label);
  const platform = JSON.parse(
    readFileSync(join(REPO, 'libs', 'platform', 'package.json'), 'utf8'),
  ).version;
  const allowList = join(directory, 'deployment', 'build-allow-list.json');
  const run = spawnSync(
    process.execPath,
    [
      join(REPO, 'scripts', 'app-package.mjs'),
      directory,
      '--out',
      out,
      '--platform',
      platform,
      ...(existsSync(allowList) ? ['--allow-list', allowList] : []),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0)
    throw new Error(`the pipeline refused the control's kit:\n${run.stdout}${run.stderr}`);
  const zip = readdirSync(out).find((name) => name.endsWith('.zip'));
  return { zip: join(out, zip), version: version ?? current, name: basename(KIT) };
}

function nextVersion(version) {
  const [major, minor, patch] = version.split(/[.-]/);
  return `${major}.${minor}.${Number(patch) + 1}`;
}

// ── The trusted signers ─────────────────────────────────────────────────────────────────────────
function theTrustedSigners() {
  const repository = readTrustedSigners(TRUSTED_SIGNERS);
  check(
    "the repository's trusted signers are the app-packages workflow alone, and no key",
    repository.length === 1 &&
      repository[0].kind === 'github-workflow' &&
      repository[0].repository === TRUSTED_REPOSITORY &&
      repository[0].workflow === TRUSTED_WORKFLOW,
    JSON.stringify(repository),
    false,
  );
  const key = runTimeKey('a-key');
  const wrong = [
    ['an empty list', []],
    ['a kind it does not know', [{ id: 'x', kind: 'gpg', publicKey: key.entry.publicKey }]],
    ['two entries of one id', [key.entry, { ...key.entry }]],
    ['a field it does not read', [{ ...key.entry, trustedUntil: '2030-01-01' }]],
    [
      'an RSA key',
      [
        {
          id: 'rsa',
          kind: 'ed25519',
          publicKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
            type: 'spki',
            format: 'pem',
          }),
        },
      ],
    ],
    [
      'a workflow outside .github/workflows/',
      [
        {
          id: 'w',
          kind: 'github-workflow',
          repository: TRUSTED_REPOSITORY,
          workflow: 'app-packages.yml',
        },
      ],
    ],
  ];
  // A private key where the public key goes, which Node would otherwise read as its public half.
  wrong.push([
    'a private key where the public key goes',
    [
      {
        id: 'oops',
        kind: 'ed25519',
        publicKey: key.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
    ],
  ]);
  for (const [label, signers] of wrong) {
    let thrown = null;
    try {
      readTrustedSigners(signersFile(`wrong-${label.replace(/\W+/g, '-')}`, signers));
    } catch (error) {
      thrown = error;
    }
    check(
      `refused: trusted signers with ${label}, as the command's error`,
      thrown instanceof Usage,
      String(thrown),
    );
  }
}

// ── An Ed25519 signature ────────────────────────────────────────────────────────────────────────
function keySignatures(current, next) {
  const signers = join(scratch, 'run-time.signers.json');
  const signed = cli([
    'sign',
    current.zip,
    '--ephemeral-key',
    '--signers-out',
    signers,
    '--commit',
    COMMIT,
  ]);
  const signature = `${current.zip}.sig.json`;
  check(
    'signed with a key made at run time: the signature beside the zip, and its public half as a trusted signer',
    signed.status === 0 && existsSync(signature) && readTrustedSigners(signers).length === 1,
    signed.all,
    false,
  );
  // The private half is in no file: the scratch folder holds the zip, its checksum, its signature and
  // the public half, and nothing written carries a private key.
  const written = readdirSync(dirname(current.zip)).sort();
  check(
    'the run-time key: its private half is in neither file written, and nothing but the signature and the public half is',
    JSON.stringify(written) ===
      JSON.stringify(
        [basename(current.zip), `${basename(current.zip)}.sha256`, basename(signature)].sort(),
      ) &&
      !/PRIVATE/.test(readFileSync(signers, 'utf8')) &&
      !/PRIVATE/.test(readFileSync(signature, 'utf8')),
    written.join(', '),
    false,
  );

  const good = cli([
    'verify',
    current.zip,
    '--trusted-signers',
    signers,
    '--name',
    current.name,
    '--version',
    current.version,
  ]);
  const [{ id }] = readTrustedSigners(signers);
  check(
    'verified: the good package, with what it records',
    good.status === 0 &&
      good.out.includes(
        `${current.name} ${current.version}, sha256 ${sha256(current.zip)}, built from ${COMMIT}`,
      ) &&
      good.out.includes(`signed by ${id}`) &&
      / Verified\.$/m.test(good.out),
    good.all,
    false,
  );
  const statement = JSON.parse(
    Buffer.from(JSON.parse(readFileSync(signature, 'utf8')).payload, 'base64').toString('utf8'),
  );
  check(
    'the statement records the package, the version, the digest, the commit and the signer',
    statement.subject.length === 1 &&
      statement.subject[0].name === basename(current.zip) &&
      statement.subject[0].digest.sha256 === sha256(current.zip) &&
      statement.predicateType === PREDICATE_TYPE &&
      statement.predicate.package === current.name &&
      statement.predicate.version === current.version &&
      statement.predicate.sha256 === sha256(current.zip) &&
      statement.predicate.commit === COMMIT &&
      statement.predicate.signer.kind === 'ed25519' &&
      statement.predicate.signer.keyId === readTrustedSigners(signers)[0].keyId,
    JSON.stringify(statement.predicate),
    false,
  );

  // One changed byte in the zip: a copy beside a copy of its signature.
  const changed = copyInto('changed-byte', current.zip);
  copyFileSync(signature, `${changed}.sig.json`);
  const bytes = readFileSync(changed);
  bytes[bytes.length - 30] ^= 0x01;
  writeFileSync(changed, bytes);
  const byte = cli(['verify', changed, '--trusted-signers', signers]);
  check(
    'refused: one changed byte in the zip',
    byte.status === 1 &&
      /SHA-256 is [0-9a-f]{64}, and the signature is over [0-9a-f]{64}: the zip is not the one signed/.test(
        byte.err,
      ),
    byte.all,
  );

  // The statement changed after it was signed: another commit, the signature kept.
  const edited = copyInto('changed-statement', current.zip);
  const envelope = JSON.parse(readFileSync(signature, 'utf8'));
  const altered = { ...statement, predicate: { ...statement.predicate, commit: 'f'.repeat(40) } };
  writeFileSync(
    `${edited}.sig.json`,
    JSON.stringify({
      ...envelope,
      payload: Buffer.from(JSON.stringify(altered)).toString('base64'),
    }),
  );
  const statementChanged = cli(['verify', edited, '--trusted-signers', signers]);
  check(
    'refused: the statement changed after it was signed',
    statementChanged.status === 1 &&
      /does not verify with the trusted key/.test(statementChanged.err),
    statementChanged.all,
  );

  // A wrong signer: another key, which no trusted signer has.
  const other = runTimeKey('another-key');
  const byOther = copyInto('other-key', current.zip);
  writeFileSync(
    `${byOther}.sig.json`,
    JSON.stringify(signWithKey({ zip: byOther, privateKey: other.privateKey, commit: COMMIT })),
  );
  const wrongSigner = cli(['verify', byOther, '--trusted-signers', signers]);
  check(
    'refused: a signature by a key no trusted signer has',
    wrongSigner.status === 1 &&
      new RegExp(
        `signed by the key ${other.keyId}, which is none of the trusted signers' keys`,
      ).test(wrongSigner.err),
    wrongSigner.all,
  );
  // The same key's signature passing for the trusted one: its key id changed to the trusted key's.
  const spoofed = copyInto('spoofed-key-id', current.zip);
  const theirs = signWithKey({ zip: spoofed, privateKey: other.privateKey, commit: COMMIT });
  const trustedKeyId = readTrustedSigners(signers)[0].keyId;
  writeFileSync(
    `${spoofed}.sig.json`,
    JSON.stringify({ ...theirs, signatures: [{ ...theirs.signatures[0], keyid: trustedKeyId }] }),
  );
  const spoof = cli(['verify', spoofed, '--trusted-signers', signers]);
  check(
    "refused: another key's signature under the trusted key's id",
    spoof.status === 1 && /does not verify with the trusted key/.test(spoof.err),
    spoof.all,
  );
  // And by the repository's own trusted signers, which list no key at all.
  const repository = cli(['verify', current.zip]);
  check(
    "refused: a run-time key's signature, by the repository's trusted signers",
    repository.status === 1 && /none of the trusted signers' keys/.test(repository.err),
    repository.all,
  );

  // A signature entry that is not an object: refused with a reason, not a stack trace.
  const nullEntry = copyInto('null-signature-entry', current.zip);
  writeFileSync(
    `${nullEntry}.sig.json`,
    JSON.stringify({ ...JSON.parse(readFileSync(signature, 'utf8')), signatures: [null] }),
  );
  const entry = cli(['verify', nullEntry, '--trusted-signers', signers]);
  check(
    'refused: a signature entry that is not an object, exit 1 and no stack trace',
    entry.status === 1 &&
      /is not an object with a "sig"/.test(entry.err) &&
      !/TypeError/.test(entry.err),
    entry.all,
  );

  // No signature.
  const unsigned = copyInto('unsigned', current.zip);
  const missing = cli(['verify', unsigned, '--trusted-signers', signers]);
  check(
    'refused: no signature',
    missing.status === 1 && /is not signed: there is no signature at /.test(missing.err),
    missing.all,
  );

  // Replayed from another version: this version's signature beside the next version's zip.
  const replayed = copyInto('replay-beside-next', next.zip);
  copyFileSync(signature, `${replayed}.sig.json`);
  const beside = cli(['verify', replayed, '--trusted-signers', signers]);
  check(
    "refused: one version's signature beside another version's zip",
    beside.status === 1 &&
      beside.err.includes(
        `the signature is for ${basename(current.zip)}, and this is ${basename(next.zip)}`,
      ) &&
      /the zip is not the one signed/.test(beside.err),
    beside.all,
  );
  // This version's zip and signature, renamed to pass for the next version.
  const renamed = join(scratch, 'copies', 'replay-renamed', basename(next.zip));
  mkdirSync(dirname(renamed), { recursive: true });
  copyFileSync(current.zip, renamed);
  copyFileSync(signature, `${renamed}.sig.json`);
  const asNext = cli(['verify', renamed, '--trusted-signers', signers]);
  check(
    "refused: one version's zip and signature, renamed to pass for the next version",
    asNext.status === 1 &&
      asNext.err.includes(
        `the signature is for ${current.name} ${current.version}, and the zip is named ${basename(next.zip)}`,
      ),
    asNext.all,
  );
  // Held to the version the operator expects.
  const pinned = cli([
    'verify',
    current.zip,
    '--trusted-signers',
    signers,
    '--version',
    next.version,
  ]);
  check(
    'refused: a signature of the version before, held to the version expected',
    pinned.status === 1 &&
      pinned.err.includes(
        `the signature is for ${current.name} ${current.version}, not ${next.version}`,
      ),
    pinned.all,
  );
  // A trusted signer's statement naming the next version over this version's bytes, renamed to
  // match: everything the statement says agrees with itself, and the zip's package.xml does not.
  const misnamed = join(scratch, 'copies', 'signed-as-next', basename(next.zip));
  mkdirSync(dirname(misnamed), { recursive: true });
  copyFileSync(current.zip, misnamed);
  const trustedKey = runTimeKey('trusted-key');
  writeFileSync(
    `${misnamed}.sig.json`,
    JSON.stringify(
      signStatement(
        statementFor({
          zip: misnamed,
          name: next.name,
          version: next.version,
          digest: sha256(misnamed),
          commit: COMMIT,
          signer: { kind: 'ed25519', keyId: trustedKey.keyId },
        }),
        trustedKey.privateKey,
      ),
    ),
  );
  const misnamedRun = cli([
    'verify',
    misnamed,
    '--trusted-signers',
    signersFile('trusted-key', [trustedKey.entry]),
  ]);
  check(
    "refused: a trusted signer's statement naming a version the zip's package.xml does not declare",
    misnamedRun.status === 1 &&
      misnamedRun.err.includes(
        `package.xml declares ${current.name} ${current.version}, and the signature names ${next.name} ${next.version}`,
      ),
    misnamedRun.all,
  );

  // A key of one's own: outside the repository it signs; inside it, it is refused before it is read.
  const own = runTimeKey('own-key');
  const keyFile = join(scratch, 'own-key.pem');
  writeFileSync(keyFile, own.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const ownZip = copyInto('own-key', current.zip);
  const withOwn = cli(['sign', ownZip, '--key', keyFile, '--commit', COMMIT]);
  const ownVerified = cli(['verify', ownZip, '--trusted-signers', signersFile('own', [own.entry])]);
  check(
    'signed with a key from a file outside the repository, and verified by its public half',
    withOwn.status === 0 && ownVerified.status === 0,
    `${withOwn.all}${ownVerified.all}`,
    false,
  );
  const inRepository = join(REPO, 'scripts', `app-package-signature-selftest-${process.pid}.pem`);
  writeFileSync(inRepository, 'not a key: the command must refuse the place before it reads it\n');
  try {
    const refusedKey = cli(['sign', ownZip, '--key', inRepository, '--commit', COMMIT]);
    check(
      'refused: a private key inside the repository, exit 2',
      refusedKey.status === 2 &&
        /inside the repository, where a private key is one commit from being published/.test(
          refusedKey.err,
        ),
      refusedKey.all,
    );
  } finally {
    rmSync(inRepository, { force: true });
  }
}

// ── A keyless signature, with gh stood in for ───────────────────────────────────────────────────
const bin = join(scratch, 'bin');
const ghLog = join(scratch, 'gh.log');

/** A `gh` on a PATH of its own that holds a bundle to its stand-in certificate, as gh holds a real one. */
function standInGh() {
  mkdirSync(bin, { recursive: true });
  const script = join(scratch, 'stand-in-gh.mjs');
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
appendFileSync(process.env.STAND_IN_GH_LOG, JSON.stringify(args) + '\\n');
const refuse = (why) => { process.stderr.write('stand-in gh: ' + why + '\\n'); process.exit(1); };
if (args[0] !== 'attestation' || args[1] !== 'verify') refuse('only attestation verify is stood in for');
const flag = (name) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const bundle = JSON.parse(readFileSync(flag('--bundle'), 'utf8'));
const cert = JSON.parse(Buffer.from(bundle.verificationMaterial.certificate.rawBytes, 'base64').toString('utf8'));
const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
const digest = createHash('sha256').update(readFileSync(args[2])).digest('hex');
if (!statement.subject.some((subject) => subject.digest && subject.digest.sha256 === digest)) refuse('the artifact is no subject of the statement');
for (const [option, field] of [['--cert-identity', 'san'], ['--cert-oidc-issuer', 'issuer'], ['--source-ref', 'sourceRef'], ['--source-digest', 'sourceDigest'], ['--repo', 'repository']])
  if (flag(option) !== cert[field]) refuse(option + ' ' + flag(option) + ' is not the certificate\\'s ' + cert[field]);
if (flag('--predicate-type') !== statement.predicateType) refuse('the predicate type is not ' + flag('--predicate-type'));
if (cert.selfHosted && args.includes('--deny-self-hosted-runners')) refuse('signed on a self-hosted runner');
`,
  );
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(gh, 0o755);
}

const ghEnv = () => ({ PATH: `${bin}${delimiter}${process.env.PATH}`, STAND_IN_GH_LOG: ghLog });
const ghCalls = () =>
  existsSync(ghLog)
    ? readFileSync(ghLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** A stand-in certificate, as Fulcio would issue it to the trusted workflow's run on `tag`. */
function certificateFor(tag, overrides = {}) {
  return {
    san: `https://github.com/${TRUSTED_REPOSITORY}/${TRUSTED_WORKFLOW}@${tag}`,
    issuer: OIDC_ISSUER,
    sourceRef: tag,
    sourceDigest: COMMIT,
    repository: TRUSTED_REPOSITORY,
    selfHosted: false,
    ...overrides,
  };
}

/** The predicate the trusted workflow's run writes for `pkg`, as `ci-plan` writes it. */
function workflowPredicate(pkg, overrides = {}) {
  return {
    ...statementFor({
      zip: pkg.zip,
      name: pkg.name,
      version: pkg.version,
      digest: sha256(pkg.zip),
      commit: COMMIT,
      signer: {
        kind: 'github-workflow',
        repository: TRUSTED_REPOSITORY,
        workflow: TRUSTED_WORKFLOW,
        ref: tagFor(pkg.name, pkg.version),
        run: `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/1/attempts/1`,
      },
    }).predicate,
    ...overrides,
  };
}

/** A bundle as `actions/attest` writes one, for `zip` and `predicate`, with a stand-in certificate. */
function bundleFor(zip, predicate, certificate) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: basename(zip), digest: { sha256: sha256(zip) } }],
    predicateType: PREDICATE_TYPE,
    predicate,
  };
  return `${JSON.stringify({
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: Buffer.from(JSON.stringify(certificate)).toString('base64') },
    },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ sig: Buffer.from('a stand-in signature').toString('base64') }],
    },
  })}\n`;
}

/** Verify a copy of `pkg`'s zip signed by `bundle`, with the repository's trusted signers. */
function keyless(label, pkg, bundle, { env = ghEnv(), zip = pkg.zip, change } = {}) {
  const copy = copyInto(`keyless-${label}`, zip);
  if (change) writeFileSync(copy, change(readFileSync(copy)));
  writeFileSync(`${copy}.sig.json`, bundle);
  rmSync(ghLog, { force: true });
  return {
    ...cli(['verify', copy, '--name', pkg.name, '--version', pkg.version], env),
    copy,
    calls: ghCalls(),
  };
}

function keylessSignatures(current, next) {
  standInGh();
  const tag = tagFor(current.name, current.version);
  const good = keyless(
    'good',
    current,
    bundleFor(current.zip, workflowPredicate(current), certificateFor(tag)),
  );
  const expected = ghArguments({
    zip: good.copy,
    bundle: '<the bundle>',
    signer: { repository: TRUSTED_REPOSITORY, workflow: TRUSTED_WORKFLOW },
    name: current.name,
    version: current.version,
    commit: COMMIT,
  });
  const [call] = good.calls;
  check(
    'verified: a keyless signature by the trusted workflow, for its own tag, with the stand-in gh given exactly the pinned identity',
    good.status === 0 &&
      / Verified\.$/m.test(good.out) &&
      good.calls.length === 1 &&
      JSON.stringify(
        call.map((arg, index) => (call[index - 1] === '--bundle' ? '<the bundle>' : arg)),
      ) === JSON.stringify(expected) &&
      call.includes(`https://github.com/${TRUSTED_REPOSITORY}/${TRUSTED_WORKFLOW}@${tag}`) &&
      call.includes('--deny-self-hosted-runners'),
    `${good.all} ${JSON.stringify(good.calls)}`,
    false,
  );

  const byte = keyless(
    'changed-byte',
    current,
    bundleFor(current.zip, workflowPredicate(current), certificateFor(tag)),
    {
      change: (bytes) => {
        bytes[bytes.length - 30] ^= 0x01;
        return bytes;
      },
    },
  );
  check(
    'refused: one changed byte in the zip, before gh is asked',
    byte.status === 1 && /the zip is not the one signed/.test(byte.err) && byte.calls.length === 0,
    byte.all,
  );

  const fork = 'someone/Nuxeo-Satori-UI';
  const untrusted = keyless(
    'untrusted-workflow',
    current,
    bundleFor(
      current.zip,
      workflowPredicate(current, {
        signer: { ...workflowPredicate(current).signer, repository: fork },
      }),
      certificateFor(tag, {
        repository: fork,
        san: `https://github.com/${fork}/${TRUSTED_WORKFLOW}@${tag}`,
      }),
    ),
  );
  check(
    'refused: a workflow that is not a trusted signer, before gh is asked',
    untrusted.status === 1 &&
      /which is not a trusted signer/.test(untrusted.err) &&
      untrusted.calls.length === 0,
    untrusted.all,
  );
  // The predicate is the run's own word: a fork's run that claims to be the trusted workflow is
  // caught by its certificate, which gh holds to the identity pinned.
  const claims = keyless(
    'fork-claiming-trusted',
    current,
    bundleFor(
      current.zip,
      workflowPredicate(current),
      certificateFor(tag, {
        repository: fork,
        san: `https://github.com/${fork}/${TRUSTED_WORKFLOW}@${tag}`,
      }),
    ),
  );
  check(
    "refused: another repository's certificate under a predicate claiming the trusted workflow, by the stand-in gh",
    claims.status === 1 &&
      /gh attestation verify refused the signature/.test(claims.err) &&
      /--cert-identity/.test(claims.err),
    claims.all,
  );

  // Replayed from another version: the next version's zip, under a predicate naming it, signed by
  // the run for this version's tag, whose certificate names this version's tag.
  const replay = keyless(
    'replay-other-tag',
    next,
    bundleFor(next.zip, workflowPredicate(next), certificateFor(tag)),
  );
  check(
    "refused: a signature from another version's tag run, by the stand-in gh",
    replay.status === 1 && /gh attestation verify refused the signature/.test(replay.err),
    replay.all,
  );
  // And this version's own signature beside the next version's zip, before gh is asked.
  const beside = keyless(
    'replay-beside-next',
    next,
    bundleFor(current.zip, workflowPredicate(current), certificateFor(tag)),
  );
  check(
    "refused: one version's keyless signature beside another version's zip, before gh is asked",
    beside.status === 1 &&
      /the zip is not the one signed/.test(beside.err) &&
      beside.calls.length === 0,
    beside.all,
  );
  // The predicate's own account of its run must agree: one that says it ran for another tag is
  // refused, though the certificate, which gh checks, names the right one.
  const otherRef = keyless(
    'predicate-other-ref',
    current,
    bundleFor(
      current.zip,
      workflowPredicate(current, {
        signer: { ...workflowPredicate(current).signer, ref: tagFor(current.name, next.version) },
      }),
      certificateFor(tag),
    ),
  );
  check(
    'refused: a predicate saying its run was for another tag, before gh is asked',
    otherRef.status === 1 &&
      /was signed by a run for .*, not for its own tag/.test(otherRef.err) &&
      otherRef.calls.length === 0,
    otherRef.all,
  );

  // The predicate's commit is bound by the certificate: one the run did not build from is refused.
  const otherCommit = keyless(
    'other-commit',
    current,
    bundleFor(
      current.zip,
      workflowPredicate(current),
      certificateFor(tag, { sourceDigest: 'b'.repeat(40) }),
    ),
  );
  check(
    "refused: a predicate naming a commit the certificate's run was not on, by the stand-in gh",
    otherCommit.status === 1 && /--source-digest/.test(otherCommit.err),
    otherCommit.all,
  );

  // JSON lines, as `gh attestation download` writes them: the provenance, and the signatures.
  const provenance = JSON.stringify({
    ...JSON.parse(bundleFor(current.zip, { buildDefinition: {} }, certificateFor(tag))),
    dsseEnvelope: {
      payload: Buffer.from(
        JSON.stringify({
          _type: 'https://in-toto.io/Statement/v1',
          subject: [{ name: basename(current.zip), digest: { sha256: sha256(current.zip) } }],
          predicateType: 'https://slsa.dev/provenance/v1',
          predicate: {},
        }),
      ).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ sig: 'c3RhbmQtaW4=' }],
    },
  });
  const genuine = bundleFor(current.zip, workflowPredicate(current), certificateFor(tag)).trim();
  const forged = bundleFor(
    current.zip,
    workflowPredicate(current),
    certificateFor(tag, {
      repository: fork,
      san: `https://github.com/${fork}/${TRUSTED_WORKFLOW}@${tag}`,
    }),
  ).trim();
  const lines = keyless('json-lines', current, `${provenance}\n${forged}\n${genuine}\n`);
  check(
    "verified: JSON lines of the provenance and two signatures, one of them a fork's, by the genuine one",
    lines.status === 0 && / Verified\.$/m.test(lines.out) && lines.calls.length === 2,
    `${lines.all} ${lines.calls.length}`,
    false,
  );
  const noneOfOurs = keyless(
    'json-lines-provenance-only',
    current,
    `${provenance}\n${provenance}\n`,
  );
  check(
    'refused: JSON lines holding no package signature, only the provenance',
    noneOfOurs.status === 1 &&
      /none is a package signature/.test(noneOfOurs.err) &&
      noneOfOurs.calls.length === 0,
    noneOfOurs.all,
  );
  const allForged = keyless('json-lines-forged', current, `${provenance}\n${forged}\n${forged}\n`);
  check(
    'refused: JSON lines whose every signature is refused, each by its line',
    allForged.status === 1 &&
      /line 2: gh attestation verify refused/.test(allForged.err) &&
      /line 3: gh attestation verify refused/.test(allForged.err),
    allForged.all,
  );

  const selfHosted = keyless(
    'self-hosted',
    current,
    bundleFor(current.zip, workflowPredicate(current), certificateFor(tag, { selfHosted: true })),
  );
  check(
    'refused: a signature made on a self-hosted runner, by the stand-in gh',
    selfHosted.status === 1 && /self-hosted/.test(selfHosted.err),
    selfHosted.all,
  );

  const empty = join(scratch, 'no-gh');
  mkdirSync(empty, { recursive: true });
  const noGh = keyless(
    'no-gh',
    current,
    bundleFor(current.zip, workflowPredicate(current), certificateFor(tag)),
    {
      env: { PATH: empty },
    },
  );
  check(
    'refused: no gh on the PATH, rather than passed',
    noGh.status === 1 && /gh could not be run \(ENOENT\)/.test(noGh.err),
    noGh.all,
  );

  // The flags themselves, against the GitHub CLI installed, when there is one.
  const help = spawnSync('gh', ['attestation', 'verify', '--help'], { encoding: 'utf8' });
  if (help.error || help.status !== 0) {
    process.stdout.write(
      'skip      the installed gh: none on the PATH, so its flags are not compared here\n',
    );
  } else {
    const flags = expected.filter((arg) => arg.startsWith('--'));
    const missing = flags.filter((flag) => !new RegExp(`\\s${flag}\\b`).test(help.stdout));
    check(
      `every flag the verification gives gh is one the installed gh has (${flags.length})`,
      missing.length === 0,
      missing.join(', '),
      false,
    );
    check(
      'refused: a flag gh does not have is not found in its help',
      !/\s--no-such-flag\b/.test(help.stdout),
      'found',
    );
  }
}

// ── The sign job's skip logic ───────────────────────────────────────────────────────────────────
function theCiPlan(current) {
  const tag = tagFor(current.name, current.version);
  const identity = {
    GITHUB_REF: tag,
    GITHUB_REPOSITORY: TRUSTED_REPOSITORY,
    GITHUB_WORKFLOW_REF: `${TRUSTED_REPOSITORY}/${TRUSTED_WORKFLOW}@${tag}`,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_SHA: COMMIT,
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    RUNNER_ENVIRONMENT: 'github-hosted',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.invalid/a-stand-in',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'a-stand-in',
  };
  let run = 0;
  const plan = (env) => {
    run += 1;
    const folder = join(scratch, 'ci-plan', String(run));
    mkdirSync(folder, { recursive: true });
    const files = {
      output: join(folder, 'output'),
      summary: join(folder, 'summary'),
      predicate: join(folder, 'predicate.json'),
    };
    // The variables of the run this control itself is in are not read.
    const cleared = Object.fromEntries(Object.keys(identity).map((name) => [name, '']));
    const result = cli(['ci-plan', current.zip, '--predicate-out', files.predicate], {
      ...cleared,
      ...env,
      GITHUB_OUTPUT: files.output,
      GITHUB_STEP_SUMMARY: files.summary,
    });
    const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
    return {
      ...result,
      output: read(files.output),
      summary: read(files.summary),
      predicate: files.predicate,
    };
  };

  const signs = plan(identity);
  const predicate = existsSync(signs.predicate)
    ? JSON.parse(readFileSync(signs.predicate, 'utf8'))
    : {};
  check(
    'ci-plan signs: a tag build of the package, on GitHub, with an identity, by the trusted workflow',
    signs.status === 0 &&
      /^sign=true$/m.test(signs.output) &&
      signs.output.includes(`predicate-type=${PREDICATE_TYPE}`) &&
      signs.output.includes(`predicate-path=${signs.predicate}`) &&
      predicate.package === current.name &&
      predicate.version === current.version &&
      predicate.sha256 === sha256(current.zip) &&
      predicate.commit === COMMIT &&
      predicate.signer?.repository === TRUSTED_REPOSITORY &&
      predicate.signer?.workflow === TRUSTED_WORKFLOW &&
      predicate.signer?.ref === tag &&
      predicate.signer?.run ===
        `https://github.com/${TRUSTED_REPOSITORY}/actions/runs/42/attempts/1`,
    `${signs.all} ${signs.output} ${JSON.stringify(predicate)}`,
    false,
  );
  // What it wrote, signed as actions/attest signs it, is what the verification takes.
  const roundTrip = keyless(
    'ci-plan-predicate',
    current,
    bundleFor(current.zip, predicate, certificateFor(tag)),
  );
  check(
    "ci-plan's predicate, signed for its tag, verifies",
    roundTrip.status === 0,
    roundTrip.all,
    false,
  );

  const skips = [
    [
      'no OIDC identity',
      { ...identity, ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
      /has no OIDC identity/,
    ],
    ['a self-hosted runner', { ...identity, RUNNER_ENVIRONMENT: 'self-hosted' }, /self-hosted/],
    [
      "a fork's run",
      {
        ...identity,
        GITHUB_REPOSITORY: 'someone/Nuxeo-Satori-UI',
        GITHUB_WORKFLOW_REF: `someone/Nuxeo-Satori-UI/${TRUSTED_WORKFLOW}@${tag}`,
      },
      /is not a trusted signer/,
    ],
    [
      'another server',
      { ...identity, GITHUB_SERVER_URL: 'https://github.example.com' },
      /only github\.com's workflows/,
    ],
  ];
  for (const [label, env, reason] of skips) {
    const skipped = plan(env);
    check(
      `ci-plan skips, with a warning and sign=false: ${label}`,
      skipped.status === 0 &&
        /^sign=false$/m.test(skipped.output) &&
        !/sign=true/.test(skipped.output) &&
        /^::warning title=Not signed, not published::/m.test(skipped.out) &&
        reason.test(skipped.out) &&
        /Not signed, not published/.test(skipped.summary) &&
        !existsSync(skipped.predicate),
      `${skipped.all} ${skipped.output}`,
    );
  }
  const refusals = [
    [
      'a branch build',
      { ...identity, GITHUB_REF: 'refs/heads/main' },
      /is not a tag app-package\/<name>\/<version>/,
    ],
    [
      'a tag naming another version',
      { ...identity, GITHUB_REF: tagFor(current.name, '9.9.9') },
      /does not name/,
    ],
  ];
  for (const [label, env, reason] of refusals) {
    const refused = plan(env);
    check(
      `ci-plan refuses, exit 1, with nothing written: ${label}`,
      refused.status === 1 &&
        reason.test(refused.err) &&
        refused.output === '' &&
        !existsSync(refused.predicate),
      refused.all,
    );
  }
}

// ── The workflow ────────────────────────────────────────────────────────────────────────────────
/**
 * The jobs of a workflow's text: each one's name and its lines. Read by indentation, which is how
 * this repository writes its workflows: a job is a key two spaces in under `jobs:`. A comment is
 * not read, since the header's own account of the permissions names them.
 */
function jobsOf(text) {
  const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const start = lines.findIndex((line) => line === 'jobs:');
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) jobs.set((current = header[1]), []);
    else if (current !== null) jobs.get(current).push(line);
  }
  return { head: lines.slice(0, start), jobs };
}

/** A job's `permissions:` entries, as `name: value`. */
function permissionsOf(lines) {
  const at = lines.findIndex((line) => /^ {4}permissions:\s*$/.test(line));
  if (at < 0) return [];
  const entries = [];
  for (const line of lines.slice(at + 1)) {
    const entry = /^ {6}([a-z-]+):\s*(\S+)/.exec(line);
    if (!entry) break;
    entries.push(`${entry[1]}: ${entry[2]}`);
  }
  return entries;
}

/** A job's steps, each as its text. */
function stepsOf(lines) {
  const steps = [];
  for (const line of lines) {
    if (/^ {6}- /.test(line)) steps.push(line);
    else if (steps.length > 0 && /^ {8}/.test(line)) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/** What is wrong with app-packages.yml's signing and publishing, as the controls hold it. */
function workflowProblems(text) {
  const problems = [];
  const { head, jobs } = jobsOf(text);
  if (head.some((line) => /id-token|attestations/.test(line)))
    problems.push('the workflow grants id-token or attestations to every job');
  for (const [name, lines] of jobs)
    if (name !== 'sign' && lines.some((line) => /id-token:/.test(line)))
      problems.push(`the job ${name} has id-token, which only sign needs`);
  const sign = jobs.get('sign');
  const publish = jobs.get('publish');
  if (!sign || !publish) return [...problems, 'there is no sign job and publish job'];
  const signPermissions = permissionsOf(sign).sort().join(', ');
  if (signPermissions !== 'attestations: write, contents: read, id-token: write')
    problems.push(`sign's permissions are ${signPermissions}`);
  if (sign.some((line) => /secrets\./.test(line))) problems.push('sign reads a secret');
  if (!sign.some((line) => /^ {6}signed: \$\{\{ steps\.plan\.outputs\.sign \}\}$/.test(line)))
    problems.push("sign's output signed is not ci-plan's decision");
  const signSteps = stepsOf(sign);
  const planStep = signSteps.findIndex(
    (step) => /id: plan\b/.test(step) && /app-package-signature\.mjs ci-plan/.test(step),
  );
  if (planStep < 0) problems.push('sign has no step plan running ci-plan');
  const gated = /\n {8}if: steps\.plan\.outputs\.sign == 'true'(\n|$)/;
  const attest = signSteps.findIndex((step) => /uses: actions\/attest@/.test(step));
  for (const [index, step] of signSteps.entries())
    if (
      /uses: actions\/attest(-build-provenance)?@|app-package-signature\.mjs verify|upload-artifact/.test(
        step,
      ) &&
      !gated.test(step)
    )
      problems.push(`sign's step ${index + 1} runs whether or not ci-plan said to sign`);
  if (attest < 0 || attest < planStep) problems.push('sign does not attest after ci-plan');
  if (
    !signSteps.some(
      (step, index) => index > attest && /app-package-signature\.mjs verify/.test(step),
    )
  )
    problems.push('sign does not verify the signature it made');
  const publishIf = publish.find((line) => /^ {4}if:/.test(line)) ?? '';
  if (!/needs\.sign\.outputs\.signed == 'true'/.test(publishIf))
    problems.push('publish runs whether or not the zip was signed');
  const publishPermissions = permissionsOf(publish).join(', ');
  if (publishPermissions !== 'contents: read')
    problems.push(`publish's permissions are ${publishPermissions || "the workflow's"}`);
  const publishSteps = stepsOf(publish);
  const verify = publishSteps.findIndex((step) => /app-package-signature\.mjs verify/.test(step));
  const nos = publishSteps.findIndex((step) => /nos-publish@/.test(step));
  if (nos < 0) problems.push('publish does not publish');
  if (verify < 0 || verify > nos)
    problems.push('publish does not verify the signature before it publishes');
  // The approval: publish waits in the one environment, by a name no input can change, and its
  // first act is to check that waiting meant a person had to approve.
  if (!publish.some((line) => line === '    environment: marketplace-preprod'))
    problems.push('publish does not wait in the marketplace-preprod environment for an approval');
  for (const [name, lines] of jobs)
    if (name !== 'publish' && lines.some((line) => /^ {4}environment:/.test(line)))
      problems.push(`the job ${name} names an environment, which only publish does`);
  for (const [name, lines] of jobs)
    if (name !== 'publish' && lines.some((line) => /secrets\.CONNECT_/.test(line)))
      problems.push(`the job ${name} reads the Marketplace credentials, which only publish does`);
  const approval = publishSteps.findIndex((step) => step.includes(APPROVAL_STEP));
  const firstSecret = publishSteps.findIndex((step) => /secrets\./.test(step));
  if (approval < 0) problems.push('publish does not check that a person had to approve');
  else {
    const step = publishSteps[approval];
    if (!new RegExp(`\\n {8}run: ${APPROVAL_STEP}$`).test(step))
      problems.push('publish checks the approval against something other than GitHub');
    if (/\n {8}if:|continue-on-error/.test(step))
      problems.push('the approval check may be skipped');
    if (
      approval > publishSteps.findIndex((each) => /uses: actions\/download-artifact@/.test(each)) ||
      (firstSecret >= 0 && approval > firstSecret) ||
      approval > nos
    )
      problems.push('publish checks the approval after it has begun');
  }
  for (const [job, steps] of [
    ['sign', signSteps],
    ['publish', publishSteps],
  ])
    for (const step of steps.filter((each) => /app-package-signature\.mjs verify/.test(each)))
      if (!step.includes('--name "${named%%/*}" --version "${named#*/}"'))
        problems.push(`${job} verifies without pinning the tag's name and version`);
  return problems;
}

function theWorkflow() {
  const text = readFileSync(WORKFLOW, 'utf8');
  const sound = workflowProblems(text);
  check(
    'app-packages.yml: only sign has an identity, and publish runs on a verified signature',
    sound.length === 0,
    sound.join('; '),
    false,
  );
  const breaks = [
    [
      'publish runs unsigned',
      (t) => t.replace(/ && needs\.sign\.outputs\.signed == 'true'/, ''),
      /publish runs whether or not the zip was signed/,
    ],
    [
      'publish given an identity',
      (t) =>
        t.replace(
          /(\n {2}publish:[\s\S]*?\n {4}permissions:\n {6}contents: read)/,
          '$1\n      id-token: write',
        ),
      /the job publish has id-token/,
    ],
    [
      'publish verifying after it publishes',
      (t) => {
        const { jobs } = jobsOf(t);
        const steps = stepsOf(jobs.get('publish'));
        const verify = steps.find((step) => /app-package-signature\.mjs verify/.test(step));
        return t
          .replace(`${verify}\n`, '')
          .replace(/(\n {6}- name: Publish[^\n]*\n(?: {8}[^\n]*\n)*)/, `$1${verify}\n`);
      },
      /does not verify the signature before it publishes/,
    ],
    [
      'the attestation made whatever ci-plan said',
      (t) =>
        t.replace(
          /(- name: Sign the zip\n(?: {8}[^\n]*\n)*?) {8}if: steps\.plan\.outputs\.sign == 'true'\n/,
          '$1',
        ),
      /runs whether or not ci-plan said to sign/,
    ],
    [
      "publish verifying without the tag's version",
      (t) => {
        const { jobs } = jobsOf(t);
        const step = stepsOf(jobs.get('publish')).find((each) =>
          /app-package-signature\.mjs verify/.test(each),
        );
        return t.replace(step, step.replace(' --version "${named#*/}"', ''));
      },
      /publish verifies without pinning the tag's name and version/,
    ],
    [
      'publish not waiting in an environment',
      (t) => t.replace(/\n {4}environment: marketplace-preprod\n/, '\n'),
      /does not wait in the marketplace-preprod environment/,
    ],
    [
      'publish waiting in another environment',
      (t) =>
        t.replace(
          '    environment: marketplace-preprod',
          '    environment: marketplace-preprod-open',
        ),
      /does not wait in the marketplace-preprod environment/,
    ],
    [
      'an environment an input names',
      (t) =>
        t.replace(
          '    environment: marketplace-preprod',
          '    environment: ${{ github.event.inputs.environment }}',
        ),
      /does not wait in the marketplace-preprod environment/,
    ],
    [
      'the environment on sign',
      (t) =>
        t.replace(
          /(\n {2}sign:\n(?: {4}[^\n]*\n)*? {4}runs-on: ubuntu-latest\n)/,
          '$1    environment: marketplace-preprod\n',
        ),
      /the job sign names an environment/,
    ],
    [
      'the credentials read by the check job',
      (t) =>
        t.replace(
          /(\n {2}check:\n(?: {4}[^\n]*\n)*? {4}runs-on: ubuntu-latest\n)/,
          '$1    env:\n      LEAK: ${{ secrets.CONNECT_PREPROD_PASSWORD }}\n',
        ),
      /the job check reads the Marketplace credentials/,
    ],
    [
      'no approval check',
      (t) =>
        t.replace(
          /\n {6}- name: Check a person had to approve this publish\n {8}run: [^\n]*\n/,
          '\n',
        ),
      /does not check that a person had to approve/,
    ],
    [
      'the approval checked against a stand-in',
      (t) =>
        t.replace(
          `run: ${APPROVAL_STEP}`,
          `run: ${APPROVAL_STEP} --environment-json approved.json`,
        ),
      /something other than GitHub/,
    ],
    [
      'the approval check skippable',
      (t) =>
        t.replace(
          '      - name: Check a person had to approve this publish\n',
          "      - name: Check a person had to approve this publish\n        if: github.run_attempt == '1'\n",
        ),
      /approval check may be skipped/,
    ],
    [
      'the approval checked after the publish',
      (t) => {
        const { jobs } = jobsOf(t);
        const steps = stepsOf(jobs.get('publish'));
        const gate = steps.find((step) => step.includes(APPROVAL_STEP));
        return `${t.replace(`${gate}\n`, '').replace(/\n$/, '')}\n\n${gate}\n`;
      },
      /checks the approval after it has begun/,
    ],
    [
      'every job given an identity',
      (t) =>
        t.replace(
          /^permissions:\n {2}contents: read$/m,
          'permissions:\n  contents: read\n  id-token: write',
        ),
      /grants id-token or attestations to every job/,
    ],
  ];
  for (const [label, edit, reason] of breaks) {
    const broken = edit(text);
    const problems = workflowProblems(broken);
    check(
      `refused: app-packages.yml with ${label}`,
      broken !== text && problems.some((problem) => reason.test(problem)),
      problems.join('; ') || 'no problem found',
    );
  }
}

// ── The approval gate ──────────────────────────────────────────────────────────────────────────
/** GitHub's answer for an environment, as `GET /repos/{repo}/environments/{name}` gives it. */
function anEnvironment(overrides = {}) {
  return {
    name: 'marketplace-preprod',
    can_admins_bypass: false,
    protection_rules: [
      { type: 'branch_policy' },
      {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [{ type: 'Team', reviewer: { slug: 'app-package-approvers' } }],
      },
    ],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    ...overrides,
  };
}

function approval(answer) {
  const file = join(scratch, `environment-${negative + positive}.json`);
  writeFileSync(file, typeof answer === 'string' ? answer : JSON.stringify(answer));
  const run = spawnSync(
    process.execPath,
    [APPROVAL, '--environment', 'marketplace-preprod', '--environment-json', file],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } },
  );
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

function theApprovalGate() {
  const sound = approval(anEnvironment());
  check(
    'approval: a team of reviewers, self-review prevented, no bypass, so a person had to approve',
    sound.status === 0 && /team app-package-approvers/.test(sound.out),
    sound.out,
    false,
  );
  const open = approval(anEnvironment({ deployment_branch_policy: null }));
  check(
    'approval: any branch may deploy, which is said and not refused, the workflow holding it to tags',
    open.status === 0 && /::notice title=Approval gate::/.test(open.out),
    open.out,
    false,
  );
  const onlyBranches = anEnvironment().protection_rules.filter(
    (rule) => rule.type !== 'required_reviewers',
  );
  for (const [label, answer, reason] of [
    ['no environment', { message: 'Not Found' }, /does not exist/],
    ['another environment', anEnvironment({ name: 'github-pages' }), /does not exist/],
    [
      'an environment with no reviewer, as GitHub creates one and as it stood on 28 November 2026',
      anEnvironment({ protection_rules: onlyBranches, can_admins_bypass: true }),
      /requires no reviewer/,
    ],
    [
      'an empty list of reviewers',
      anEnvironment({
        protection_rules: [
          { type: 'required_reviewers', prevent_self_review: true, reviewers: [] },
        ],
      }),
      /requires no reviewer/,
    ],
    [
      'self-review allowed',
      anEnvironment({
        protection_rules: [{ ...anEnvironment().protection_rules[1], prevent_self_review: false }],
      }),
      /does not prevent self-review/,
    ],
    ['an administrator bypass', anEnvironment({ can_admins_bypass: true }), /bypass its rules/],
    [
      'an answer silent on the bypass',
      anEnvironment({ can_admins_bypass: undefined }),
      /bypass its rules/,
    ],
    [
      'an answer that is not JSON',
      '<html>rate limited</html>',
      /could not be read, so nothing is published/,
    ],
  ]) {
    const result = approval(answer);
    check(
      `refused, not published: ${label}`,
      result.status === 1 &&
        reason.test(result.out) &&
        /::error title=Not published::/.test(result.out),
      result.out,
    );
  }
}

try {
  const current = built('current');
  const next = built('next', nextVersion(current.version));
  theTrustedSigners();
  keySignatures(current, next);
  keylessSignatures(current, next);
  theCiPlan(current);
  theWorkflow();
  theApprovalGate();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `\n${negative} negative and ${positive} positive controls, ${failures.length} failed.\n`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
