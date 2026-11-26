/**
 * An app definition package's signature, made after the pipeline builds its zip and checked before
 * anything publishes or installs it (docs/business-apps/package-pipeline.md, section 9). The
 * functions; `app-package-signature.mjs` is the command, and the release candidate imports
 * `verifySignature` to hold each kit to its signature.
 *
 * **What is signed.** An in-toto statement whose one subject is the zip, by its file name and its
 * SHA-256, and whose predicate records the package's name and version, the same SHA-256, the commit
 * it was built from, and who signed it. The signature is detached: a file beside the zip,
 * `<name>-<version>.zip.sig.json`, and the zip is not changed.
 *
 * **Two kinds of signer, one statement.**
 *
 * - **In CI, keyless.** On a tag `app-package/<name>/<version>`, app-packages.yml's `sign` job has
 *   `actions/attest` sign the statement through Sigstore, with a certificate that lasts minutes,
 *   issued to the run's GitHub OIDC identity: no key is kept anywhere. The signature is the Sigstore
 *   bundle it writes. `ciPlan` says whether the job can sign, and gives the predicate.
 * - **Anywhere else, an Ed25519 key,** with Node's crypto: a DSSE envelope over the statement
 *   (`signWithKey`). Locally and in the controls the key is made at run time and never written.
 *
 * **What `verifySignature` holds a zip to,** each a refusal of its own:
 *
 * - a signature, which is one JSON document: a Sigstore bundle or a DSSE envelope;
 * - a signer among the trusted signers (`readTrustedSigners`). An Ed25519 envelope is checked with
 *   the trusted key its key id names, never with a key the file carries. A Sigstore bundle is
 *   checked by `gh attestation verify`, the GitHub CLI's verifier, pinned to the trusted workflow's
 *   certificate identity for the package's own tag,
 *   `https://github.com/<repository>/<workflow>@refs/tags/app-package/<name>/<version>`, the OIDC
 *   issuer, the tag as the source ref, the predicate's commit as the source digest, this predicate
 *   type, and GitHub's own runners (`ghArguments`). Only the certificate binds who signed: the
 *   predicate's account of it must agree with it, and is never taken alone;
 * - the statement's subject: the zip's file name, and the SHA-256 of its bytes, so one changed byte
 *   is refused;
 * - the package and version the statement names: the zip's file name, the `package.xml` inside it,
 *   and the name and version the caller expects, so a signature of another version, or of another
 *   package, is refused, and so is a zip renamed to pass for another version.
 *
 * **What a signature does not say:** that the package is right, or approved. That is review, the
 * pipeline's checks and promotion after a person approves, which is still a proposal (section 9.2).
 */
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attribute, withoutCdata, withoutCommentsOrInstructions } from './verify-package-zip.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The allow-list of who may sign, unless `--trusted-signers` names another. */
export const TRUSTED_SIGNERS = join(REPO, 'business-apps', 'trusted-signers.json');
/** What this signature's predicate is, in the statement and in `gh attestation verify`. */
export const PREDICATE_TYPE = 'https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1';
const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const BUNDLE_MEDIA_TYPE = 'application/vnd.dev.sigstore.bundle';
/** Who issues a GitHub Actions run its identity, and the only host whose workflows are trusted. */
export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB = 'https://github.com';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const KINDS = ['github-workflow', 'ed25519'];

/** The signature file the pipeline writes beside a zip, and `verify` reads unless told another. */
export const signatureFileFor = (zip) => `${zip}.sig.json`;
/** The tag that publishes a package, and the only ref a workflow may sign it from. */
export const tagFor = (name, version) => `refs/tags/app-package/${name}/${version}`;

/** A command line or a trusted-signers file that is wrong: exit 2, not a refusal. */
export class Usage extends Error {}
/** A refusal: the package is not signed or not verified, exit 1. */
export class Refusal extends Error {}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** An Ed25519 public key's id: the SHA-256 of its SubjectPublicKeyInfo, as a hint the file carries. */
export const keyIdOf = (publicKey) =>
  `sha256:${sha256(publicKey.export({ type: 'spki', format: 'der' }))}`;

/** DSSE's pre-authentication encoding: what an envelope's signature is over. */
function pae(type, body) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `, 'utf8'),
    body,
  ]);
}

/** Base64 that decodes to exactly what it says, or `null`: Node's decoder skips what it cannot read. */
function strictBase64(text) {
  if (typeof text !== 'string' || text === '') return null;
  const bytes = Buffer.from(text, 'base64');
  const again = bytes.toString('base64');
  return again === text || again.replace(/=+$/, '') === text.replace(/=+$/, '') ? bytes : null;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The trusted signers in `file`: who may sign a package. Strict, since it is the policy: an entry of
 * a kind this does not know, a field it does not read, two entries of one id, or a key that is not
 * an Ed25519 public key, makes the file wrong rather than skipped.
 */
export function readTrustedSigners(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Usage(
      `the trusted signers, ${file}, could not be read (${error.code ?? error.message}).`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Usage(`the trusted signers, ${file}, are not JSON: ${error.message}`);
  }
  const wrong = (why) => new Usage(`the trusted signers, ${file}: ${why}`);
  if (!isObject(parsed) || !Array.isArray(parsed.signers))
    throw wrong('it is not an object with a "signers" list.');
  for (const key of Object.keys(parsed))
    if (key !== 'signers' && key !== '$comment') throw wrong(`"${key}" is not read here.`);
  if (parsed.signers.length === 0) throw wrong('it names no signer, so nothing could be verified.');
  const ids = new Set();
  return parsed.signers.map((entry, index) => {
    const at = `signers[${index}]`;
    if (!isObject(entry)) throw wrong(`${at} is not an object.`);
    if (typeof entry.id !== 'string' || !NAME.test(entry.id))
      throw wrong(`${at} has no id of letters, digits, ".", "_" and "-".`);
    if (ids.has(entry.id)) throw wrong(`${at}: the id ${entry.id} is given twice.`);
    ids.add(entry.id);
    if (!KINDS.includes(entry.kind))
      throw wrong(`${at} (${entry.id}): the kind "${entry.kind}" is none of ${KINDS.join(', ')}.`);
    const fields = entry.kind === 'github-workflow' ? ['repository', 'workflow'] : ['publicKey'];
    for (const key of Object.keys(entry))
      if (!['id', 'kind', '$comment', ...fields].includes(key))
        throw wrong(`${at} (${entry.id}): "${key}" is not read for a ${entry.kind} signer.`);
    if (entry.kind === 'github-workflow') {
      if (typeof entry.repository !== 'string' || !REPOSITORY.test(entry.repository))
        throw wrong(`${at} (${entry.id}): "repository" is not <owner>/<repository>.`);
      if (typeof entry.workflow !== 'string' || !WORKFLOW.test(entry.workflow))
        throw wrong(`${at} (${entry.id}): "workflow" is not a file under .github/workflows/.`);
      return {
        id: entry.id,
        kind: entry.kind,
        repository: entry.repository,
        workflow: entry.workflow,
      };
    }
    let publicKey;
    try {
      publicKey = createPublicKey(entry.publicKey);
    } catch (error) {
      throw wrong(`${at} (${entry.id}): "publicKey" is not a public key (${error.message}).`);
    }
    if (publicKey.asymmetricKeyType !== 'ed25519')
      throw wrong(`${at} (${entry.id}): the key is ${publicKey.asymmetricKeyType}, not Ed25519.`);
    return { id: entry.id, kind: entry.kind, publicKey, keyId: keyIdOf(publicKey) };
  });
}

/** Run `unzip` on a zip's one entry; `null` when it cannot be read. */
function unzipEntry(zip, entry) {
  const result = spawnSync('unzip', ['-p', zip, entry], { maxBuffer: 16 * 1024 * 1024 });
  if (result.error)
    throw new Usage(
      `unzip could not be run (${result.error.message}), and package.xml is read with it.`,
    );
  return result.status === 0 ? result.stdout.toString('utf8') : null;
}

/** The name and version a package zip's `package.xml` declares, or `null` when it declares none. */
export function packageOf(zip) {
  const text = unzipEntry(zip, 'package.xml');
  if (text === null) return null;
  const xml = withoutCdata(withoutCommentsOrInstructions(text.replace(/^\uFEFF/, '')));
  const name = attribute(xml, 'package', 'name');
  const version = attribute(xml, 'package', 'version');
  return name && version ? { name, version } : null;
}

/** A zip's bytes, or a refusal when there is no file there. */
function zipBytes(zip) {
  if (!statSync(zip, { throwIfNoEntry: false })?.isFile()) return null;
  return readFileSync(zip);
}

/**
 * The statement a package's signature is over. `signer` is who signs, as the predicate records it:
 * `{ kind: 'ed25519', keyId }`, or the workflow run's `{ kind: 'github-workflow', repository,
 * workflow, ref, run }`.
 */
export function statementFor({ zip, name, version, digest, commit, signer }) {
  return {
    _type: STATEMENT_TYPE,
    subject: [{ name: basename(zip), digest: { sha256: digest } }],
    predicateType: PREDICATE_TYPE,
    predicate: { package: name, version, sha256: digest, commit, signer },
  };
}

/** What the zip says of itself, and its digest, for a statement: refused when it is not a package. */
function describeZip(zip) {
  const bytes = zipBytes(zip);
  if (bytes === null) throw new Refusal(`${zip} is not a file.`);
  const declared = packageOf(zip);
  if (declared === null)
    throw new Refusal(
      `${basename(zip)} has no package.xml that names the package and its version.`,
    );
  if (basename(zip) !== `${declared.name}-${declared.version}.zip`)
    throw new Refusal(
      `${basename(zip)} is not named for the package its package.xml declares, ${declared.name}-${declared.version}.zip.`,
    );
  return { ...declared, digest: sha256(bytes) };
}

/** Sign `zip` with an Ed25519 private key: the DSSE envelope, as the signature file holds it. */
export function signWithKey({ zip, privateKey, commit }) {
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Usage(
      `the key is ${privateKey.asymmetricKeyType}, and a package is signed with Ed25519.`,
    );
  if (!COMMIT.test(commit ?? ''))
    throw new Usage(`the commit "${commit}" is not a full commit id.`);
  const { name, version, digest } = describeZip(zip);
  const keyId = keyIdOf(createPublicKey(privateKey));
  return signStatement(
    statementFor({ zip, name, version, digest, commit, signer: { kind: 'ed25519', keyId } }),
    privateKey,
  );
}

/**
 * A DSSE envelope of `statement`, signed with an Ed25519 key, whatever the statement says: the
 * controls sign statements the pipeline would never write, to see the verification refuse them.
 */
export function signStatement(statement, privateKey) {
  const payload = Buffer.from(JSON.stringify(statement), 'utf8');
  return {
    payloadType: PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [
      {
        keyid: keyIdOf(createPublicKey(privateKey)),
        sig: signBytes(null, pae(PAYLOAD_TYPE, payload), privateKey).toString('base64'),
      },
    ],
  };
}

/**
 * Whether a tag build can sign `zip`, and the predicate it signs, from the job's environment: the
 * skip logic of app-packages.yml's `sign` job. Refused, exit 1, when the job is not a tag build of
 * this package: its `if:` should have kept it from running. Skipped, with the reason, when the job
 * has no OIDC identity, runs on a runner that is not GitHub's, or is not a trusted signer (a fork's
 * run, say): a signature made there would be refused by every verification.
 */
export function ciPlan({ zip, env, trusted }) {
  const ref = env.GITHUB_REF ?? '';
  const match = /^refs\/tags\/app-package\/([^/]+)\/([^/]+)$/.exec(ref);
  if (!match)
    throw new Refusal(
      `${ref || 'no GITHUB_REF'} is not a tag app-package/<name>/<version>; only a tag build signs.`,
    );
  const { name, version, digest } = describeZip(zip);
  if (match[1] !== name || match[2] !== version)
    throw new Refusal(
      `the tag ${ref.slice('refs/tags/'.length)} does not name ${basename(zip)}'s package, ${name} ${version}.`,
    );
  const skip = (reason) => ({ sign: false, reason });
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    return skip(
      'this job has no OIDC identity to sign with: the workflow does not grant it id-token: write, or the run cannot have one',
    );
  if ((env.GITHUB_SERVER_URL || GITHUB) !== GITHUB)
    return skip(
      `this run is on ${env.GITHUB_SERVER_URL}, and only github.com's workflows are trusted signers`,
    );
  if (env.RUNNER_ENVIRONMENT !== 'github-hosted')
    return skip(
      `this job runs on a ${env.RUNNER_ENVIRONMENT || 'runner that does not say what it is'}, and a signature from anything but GitHub's own runners is refused`,
    );
  const repository = env.GITHUB_REPOSITORY ?? '';
  const signer = trusted.find(
    (each) =>
      each.kind === 'github-workflow' &&
      each.repository === repository &&
      env.GITHUB_WORKFLOW_REF === `${each.repository}/${each.workflow}@${ref}`,
  );
  if (!signer)
    return skip(
      `this workflow, ${env.GITHUB_WORKFLOW_REF || 'unnamed'}, is not a trusted signer, so a signature made here would be refused`,
    );
  const commit = env.GITHUB_SHA ?? '';
  if (!COMMIT.test(commit)) throw new Refusal(`GITHUB_SHA, "${commit}", is not a full commit id.`);
  const run = `${GITHUB}/${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  return {
    sign: true,
    signer: signer.id,
    predicate: statementFor({
      zip,
      name,
      version,
      digest,
      commit,
      signer: { kind: 'github-workflow', repository, workflow: signer.workflow, ref, run },
    }).predicate,
  };
}

/** The arguments `gh attestation verify` is given for a keyless signature. Exported for the controls. */
export function ghArguments({ zip, bundle, signer, name, version, commit, trustedRoot }) {
  const ref = tagFor(name, version);
  return [
    'attestation',
    'verify',
    zip,
    '--bundle',
    bundle,
    '--repo',
    signer.repository,
    '--cert-identity',
    `${GITHUB}/${signer.repository}/${signer.workflow}@${ref}`,
    '--cert-oidc-issuer',
    OIDC_ISSUER,
    '--source-ref',
    ref,
    '--source-digest',
    commit,
    '--predicate-type',
    PREDICATE_TYPE,
    '--deny-self-hosted-runners',
    ...(trustedRoot ? ['--custom-trusted-root', trustedRoot] : []),
  ];
}

/**
 * Verify `zip` against its signature and the trusted signers. Returns `{ ok: true, record }`, with
 * what the signature records and the trusted signer's id, or `{ ok: false, problems }`.
 *
 * `env` is the environment `gh` is started with, for a keyless signature; `gh` the command.
 */
export function verifySignature({
  zip,
  signature = signatureFileFor(zip),
  trusted,
  name,
  version,
  trustedRoot,
  env = process.env,
  gh = 'gh',
}) {
  const problems = [];
  const bytes = zipBytes(zip);
  if (bytes === null) return { ok: false, problems: [`${zip} is not a file.`] };
  const digest = sha256(bytes);
  if (!statSync(signature, { throwIfNoEntry: false })?.isFile())
    return {
      ok: false,
      problems: [`${basename(zip)} is not signed: there is no signature at ${signature}.`],
    };
  const signatureBytes = readFileSync(signature);
  let document;
  try {
    document = JSON.parse(signatureBytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { ok: false, problems: [`${signature} is not one JSON document: ${error.message}`] };
  }
  const isBundle =
    isObject(document) &&
    typeof document.mediaType === 'string' &&
    document.mediaType.startsWith(BUNDLE_MEDIA_TYPE);
  const envelope = isBundle ? document.dsseEnvelope : document;
  if (!isObject(envelope) || !Array.isArray(envelope.signatures))
    return {
      ok: false,
      problems: [
        `${signature} is neither a Sigstore bundle of a DSSE envelope nor a DSSE envelope.`,
      ],
    };
  if (envelope.payloadType !== PAYLOAD_TYPE)
    return {
      ok: false,
      problems: [`${signature} signs a ${envelope.payloadType}, not an in-toto statement.`],
    };
  const payload = strictBase64(envelope.payload);
  let statement = null;
  try {
    statement = payload === null ? null : JSON.parse(payload.toString('utf8'));
  } catch {
    statement = null;
  }
  if (!isObject(statement) || !isObject(statement.predicate))
    return { ok: false, problems: [`${signature}'s payload is not a statement this can read.`] };
  const { predicate } = statement;

  // What the statement says, against the zip and what the caller expects.
  if (statement._type !== STATEMENT_TYPE)
    problems.push(`the statement is a ${statement._type}, not ${STATEMENT_TYPE}.`);
  if (statement.predicateType !== PREDICATE_TYPE)
    problems.push(
      `the statement's predicate is a ${statement.predicateType}, not a package signature, ${PREDICATE_TYPE}.`,
    );
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  if (subjects.length !== 1)
    problems.push(
      `the statement has ${subjects.length} subjects, and a package signature has one.`,
    );
  else {
    const [subject] = subjects;
    if (subject?.name !== basename(zip))
      problems.push(`the signature is for ${subject?.name}, and this is ${basename(zip)}.`);
    if (subject?.digest?.sha256 !== digest)
      problems.push(
        `${basename(zip)}'s SHA-256 is ${digest}, and the signature is over ${subject?.digest?.sha256}: the zip is not the one signed.`,
      );
  }
  if (predicate.sha256 !== subjects[0]?.digest?.sha256)
    problems.push('the predicate records another SHA-256 than its subject.');
  if (
    typeof predicate.package !== 'string' ||
    !NAME.test(predicate.package) ||
    typeof predicate.version !== 'string' ||
    !VERSION.test(predicate.version)
  )
    problems.push('the predicate names no package and version.');
  else {
    if (basename(zip) !== `${predicate.package}-${predicate.version}.zip`)
      problems.push(
        `the signature is for ${predicate.package} ${predicate.version}, and the zip is named ${basename(zip)}.`,
      );
    if (name !== undefined && predicate.package !== name)
      problems.push(`the signature is for the package ${predicate.package}, not ${name}.`);
    if (version !== undefined && predicate.version !== version)
      problems.push(
        `the signature is for ${predicate.package} ${predicate.version}, not ${version}.`,
      );
  }
  if (!COMMIT.test(predicate.commit ?? ''))
    problems.push('the predicate records no full commit id.');
  if (envelope.signatures.length !== 1)
    problems.push(
      `${signature} carries ${envelope.signatures.length} signatures, and a package's carries one.`,
    );

  // Who signed: a trusted signer, by the signature itself, not by what the predicate says.
  let signer = null;
  const claimed = isObject(predicate.signer) ? predicate.signer : {};
  if (!isBundle) {
    const [{ keyid, sig } = {}] = envelope.signatures;
    signer = trusted.find((each) => each.kind === 'ed25519' && each.keyId === keyid) ?? null;
    if (signer === null) {
      problems.push(
        `${basename(zip)} is signed by the key ${keyid}, which is none of the trusted signers' keys.`,
      );
    } else {
      const signed = strictBase64(sig);
      if (
        signed === null ||
        !verifyBytes(null, pae(PAYLOAD_TYPE, payload), signer.publicKey, signed)
      )
        problems.push(
          `the signature does not verify with the trusted key ${signer.id} (${signer.keyId}): the statement was changed after it was signed, or another key signed it.`,
        );
      if (claimed.kind !== 'ed25519' || claimed.keyId !== signer.keyId)
        problems.push(
          `the predicate says it was signed by ${claimed.kind} ${claimed.keyId ?? claimed.workflow}, not by the key that signed it.`,
        );
    }
  } else {
    signer =
      trusted.find(
        (each) =>
          each.kind === 'github-workflow' &&
          each.repository === claimed.repository &&
          each.workflow === claimed.workflow,
      ) ?? null;
    if (claimed.kind !== 'github-workflow' || signer === null)
      problems.push(
        `${basename(zip)} says it was signed by ${claimed.repository ?? 'no repository'}'s ${claimed.workflow ?? 'no workflow'}, which is not a trusted signer.`,
      );
    else if (claimed.ref !== tagFor(predicate.package, predicate.version))
      problems.push(
        `${basename(zip)} was signed by a run for ${claimed.ref}, not for its own tag, ${tagFor(predicate.package, predicate.version)}.`,
      );
    if (problems.length === 0) {
      // The bundle's bytes as read here, in a folder of this run's, so gh checks what was read.
      const scratch = mkdtempSync(join(tmpdir(), 'app-package-signature-'));
      try {
        const bundle = join(scratch, 'bundle.json');
        writeFileSync(bundle, signatureBytes);
        const checked = spawnSync(
          gh,
          ghArguments({
            zip: resolve(zip),
            bundle,
            signer,
            name: predicate.package,
            version: predicate.version,
            commit: predicate.commit,
            trustedRoot: trustedRoot && resolve(trustedRoot),
          }),
          { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 },
        );
        if (checked.error)
          problems.push(
            `gh could not be run (${checked.error.code ?? checked.error.message}), and a keyless signature is checked with it: install the GitHub CLI, https://cli.github.com.`,
          );
        else if (checked.status !== 0)
          problems.push(
            `gh attestation verify refused the signature (exit ${checked.status}): ${(checked.stderr || checked.stdout).trim()}`,
          );
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  }

  // The zip's own word, once the signature holds: a signer that named another package is refused.
  if (problems.length === 0) {
    const declared = packageOf(zip);
    if (declared?.name !== predicate.package || declared?.version !== predicate.version)
      problems.push(
        `${basename(zip)}'s package.xml declares ${declared ? `${declared.name} ${declared.version}` : 'no package'}, and the signature names ${predicate.package} ${predicate.version}.`,
      );
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    record: {
      package: predicate.package,
      version: predicate.version,
      sha256: digest,
      commit: predicate.commit,
      signer: signer.id,
      kind: signer.kind,
      ...(signer.kind === 'ed25519'
        ? { keyId: signer.keyId }
        : {
            workflow: `${signer.repository}/${signer.workflow}`,
            ref: claimed.ref,
            run: claimed.run ?? null,
          }),
    },
  };
}
