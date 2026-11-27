# Tutorial: sign and verify a package before installing it

For an administrator about to install a kit, and for whoever assembles a release: how a kit's zip
is signed, how to check that the zip you hold is the one that was signed, for the version you mean
to install, and what the release candidate refuses. The design is
[package-pipeline.md](../package-pipeline.md), section 9.1, and section 11 for the release
candidate; the administrator's check is [administrator-guide.md](../administrator-guide.md),
section 3, "Checking a kit before you install it".

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5` with nothing uncommitted, on macOS with Node 24.22.1, Maven and the GitHub CLI 2.83.1:
every command below but the two marked **Not run**, in the order given. The outputs quoted are that
run's, trimmed, with a key's fingerprint written `<…>`. No Nuxeo server was involved, and nothing
was tagged, signed for real or published.

## What is built, and what is not

From package-pipeline.md, section 9:

- **Built:** signing, keyless through Sigstore in the `app-packages.yml` workflow for a tag, or with
  an Ed25519 key; the verification, `npm run app-package:signature -- verify`; and the release
  candidate's check of every kit's signature, given `--signatures`.
- **Not yet run on a tag.** No `app-package/*` tag has been pushed, so **no kit has been signed**,
  and the verification of a keyless signature has run only against a stand-in for `gh` in the
  controls, never on a bundle Sigstore issued.
- **Not built:** promotion to production after a person approves (section 9.2, a proposal); a
  ruleset for who may push `app-package/*` tags; a check on the server. **Nothing on a server checks
  a signature:** the check is the administrator's, before `nuxeoctl mp-install`.
- **Not signed by this pipeline:** the server packages, `nuxeo-agentic-ui` and the add-ons.
- **What a signature says:** which run built the zip, from which commit. Not that the kit is right,
  or approved.

## 1. Build the zip

```bash
npm run app-package -- business-apps/packages/vehicle-titles-demo --platform 0.2.0
```

```text
vehicle-titles-demo 0.1.0: checked, built and verified: business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip, sha256 c451afe3…0e168
```

The build is reproducible: the same commit gives the same bytes, which is what lets the release
candidate hold a kit it builds to a signature made at the kit's tag.

## 2. Sign it, with a key made for the run

CI has no key to sign with: a tag's run signs keyless. Locally, `--ephemeral-key` makes an Ed25519
key for the run, never writes its private half, and writes its public half as a trusted-signers
file to verify with:

```bash
mkdir -p /tmp/signing-demo
npm run app-package:signature -- sign business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip \
  --ephemeral-key --signers-out /tmp/signing-demo/signers.json
```

```text
Its public half, as a trusted signer, run-time-key-<…>: /tmp/signing-demo/signers.json.
vehicle-titles-demo-0.1.0.zip signed by sha256:<…>, from d1f315cf52f39458753d82c1942bd7dc5445e8c0: business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip.sig.json.
```

- **The signature is detached,** `<name>-<version>.zip.sig.json` beside the zip, and the zip is not
  changed. It is an in-toto statement naming the zip by its file name and SHA-256, the package, its
  version, the commit and the signer.
- **The commit is `git rev-parse HEAD`** only when the working tree has nothing uncommitted, an
  untracked file included. Otherwise `sign` stops, "the working tree has uncommitted changes, so
  … may not be what the zip was built from: give --commit", and you name the commit the zip was
  built from with `--commit`.
- **`--key <file>`** signs with a key of your own instead, and refuses one inside the repository.

## 3. Verify it, and see it refused

**The sound zip,** against the run's key:

```bash
npm run app-package:signature -- verify business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip \
  --trusted-signers /tmp/signing-demo/signers.json
```

```text
vehicle-titles-demo-0.1.0.zip: vehicle-titles-demo 0.1.0, sha256 c451afe3…0e168, built from d1f315cf52f39458753d82c1942bd7dc5445e8c0, signed by run-time-key-<…> (sha256:<…>). Verified.
```

It exits 0 when the zip is verified, 1 when it is refused, with each reason, and 2 when the command
or the trusted signers are wrong. Each refusal below exited 1.

**The repository's trusted signers,** which `verify` uses when given no `--trusted-signers`: they
name the `app-packages.yml` workflow of `nuxeo/Nuxeo-Satori-UI`, and no key
([`business-apps/trusted-signers.json`](../../../business-apps/trusted-signers.json)):

```bash
npm run app-package:signature -- verify business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip \
  --name vehicle-titles-demo --version 0.1.0
```

```text
vehicle-titles-demo-0.1.0.zip is refused:
  - vehicle-titles-demo-0.1.0.zip is signed by the key sha256:<…>, which is none of the trusted signers' keys.
```

**Held to another version** than the one signed:

```bash
npm run app-package:signature -- verify business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip \
  --trusted-signers /tmp/signing-demo/signers.json --version 0.1.1
```

```text
vehicle-titles-demo-0.1.0.zip is refused:
  - the signature is for vehicle-titles-demo 0.1.0, not 0.1.1.
```

**One byte changed,** in a copy beside its signature:

```bash
mkdir -p /tmp/signing-demo/changed
cp business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip \
  business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip.sig.json /tmp/signing-demo/changed/
printf 'x' >> /tmp/signing-demo/changed/vehicle-titles-demo-0.1.0.zip
npm run app-package:signature -- verify /tmp/signing-demo/changed/vehicle-titles-demo-0.1.0.zip \
  --trusted-signers /tmp/signing-demo/signers.json
```

```text
vehicle-titles-demo-0.1.0.zip is refused:
  - vehicle-titles-demo-0.1.0.zip's SHA-256 is 06d01b9f…9505, and the signature is over c451afe3…0e168: the zip is not the one signed.
```

The verification also holds the zip to the `package.xml` inside it, so another version's signature
is refused beside this version's zip, or on its own zip renamed to pass for this one. The controls
hold each case, and more, with keys made at run time:

```bash
npm run app-package:signature-selftest
```

```text
43 negative and 12 positive controls, 0 failed.
```

## 4. A kit released by its tag: the administrator's check

**Not run: no kit has been signed yet.** When a kit is released by its tag
`app-package/<name>/<version>`, the `app-packages.yml` workflow signs it keyless. Before
`nuxeoctl mp-install`, check the zip you hold with the GitHub CLI, which reads the signature from
the repository's attestations, the certificate's identity pinned whole to that workflow's run for
that tag (administrator-guide.md, section 3):

```bash
gh attestation verify payers-claims-demo-0.7.0.zip --repo nuxeo/Nuxeo-Satori-UI \
  --predicate-type https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1 \
  --cert-identity https://github.com/nuxeo/Nuxeo-Satori-UI/.github/workflows/app-packages.yml@refs/tags/app-package/payers-claims-demo/0.7.0 \
  --source-ref refs/tags/app-package/payers-claims-demo/0.7.0 --deny-self-hosted-runners
```

Or with the signature beside the zip, from a clone: the tag run's artifact `app-package-signature`
for 30 days, or the repository's attestations downloaded and renamed, then
`npm run app-package:signature -- verify <zip> --name <name> --version <version>`, which also holds
the zip to its `package.xml` and the signer to the trusted signers. A GitHub CLI that lacks one of
the flags refuses it as unknown, and checks nothing.

What neither sees: **a tag moved since the release.** A tag deleted and pushed again on another
commit signs another zip of the same version, and both pass, until a ruleset forbids moving these
tags. Keep the SHA-256 of each version you install, and refuse a zip of the same version with
another.

## 5. What the release candidate refuses

The release candidate builds every kit, the client and the server packages, offline, and checks
them as a set (package-pipeline.md, section 11). It refuses to start unless it is told how to treat
the kits' signatures:

```bash
node scripts/release-candidate.mjs --out /tmp/signing-demo/rc --since origin/staging/enterprise-grade-app
```

```text
Give --signatures <folder>, to hold each kit to its signature, or --unsigned-kits, to take kits no tag has signed.
```

That exits 2. **With `--signatures`,** stage 2 holds each kit's zip, built there, to its own
signature, against the trusted signers. Given an empty folder:

```bash
mkdir -p /tmp/signing-demo/no-signatures
npm run release-candidate -- --out /tmp/signing-demo/rc --since origin/staging/enterprise-grade-app \
  --signatures /tmp/signing-demo/no-signatures
```

```text
vehicle-titles-demo 0.1.0: checked, built and verified: /tmp/signing-demo/rc/kits/vehicle-titles-demo-0.1.0.zip, sha256 c451afe3…0e168
vehicle-titles-demo: not taken, for its signature, /tmp/signing-demo/no-signatures/vehicle-titles-demo-0.1.0.zip.sig.json:
  - vehicle-titles-demo-0.1.0.zip is not signed: there is no signature at /tmp/signing-demo/no-signatures/vehicle-titles-demo-0.1.0.zip.sig.json.
The release candidate is refused: stage 2: 11 kit(s) not signed by a trusted signer over the zip built here: brand-assets-demo 0.2.5, contracts-demo 0.2.1, controlled-documents-demo 0.3.0, facilities-demo 0.1.1, media-demo 0.2.0, moves-demo 0.3.0, onboarding-demo 0.2.0, payers-claims-demo 0.7.0, pc-claims-demo 0.2.0, records-demo 0.2.0, vehicle-titles-demo 0.1.0, as above.
/tmp/signing-demo/rc is removed: it was this run's, and holds no candidate.
```

It exits 1, and removes the folder it made, so that no half-built candidate looks like a whole one.
**With the vehicle kit's signature from step 2,** and the run's key as the trusted signer:

```bash
mkdir -p /tmp/signing-demo/one-signature
cp business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip.sig.json /tmp/signing-demo/one-signature/
npm run release-candidate -- --out /tmp/signing-demo/rc --since origin/staging/enterprise-grade-app \
  --signatures /tmp/signing-demo/one-signature --trusted-signers /tmp/signing-demo/signers.json
```

```text
vehicle-titles-demo: signed by run-time-key-<…>, from d1f315cf52f3, over the zip built here.
The release candidate is refused: stage 2: 10 kit(s) not signed by a trusted signer over the zip built here: brand-assets-demo 0.2.5, … records-demo 0.2.0, as above.
```

The vehicle kit is taken; the other ten are not, and the candidate stops at stage 2, before it
builds the client or runs Maven. Besides a missing signature, stage 2 refuses a kit signed by no
trusted signer, one whose signature is over other bytes or for another version, and one signed from
a commit that neither the candidate's history nor `origin/main` holds: a tag on a commit never
merged. Its controls break each check once:

```bash
npm run release-candidate:selftest
```

```text
53 negative and 16 positive controls, 0 failed.
```

**Not run here: `--unsigned-kits`,** which takes kits no tag has signed and goes on to build the
client and the server packages. That is what the `release-candidate.yml` workflow gives on every
push to a `staging/**` branch, since no kit has a tag; its manifest and release note say the kits
were not held to signatures. The later stages refuse two kits that register the same name, a
dependency the candidate does not hold, and a deployed client that is not the one built.

**Not run here: an install.** The candidate proves the set holds together on paper; that Nuxeo
installs it and the server starts with it is the demo server's, which has not run against Docker
(package-pipeline.md, section 11, "What a server-side release run would add").

## Cleaning up

Remove `/tmp/signing-demo`, and the signature step 2 wrote beside the zip, in the kit's `dist/`,
which git ignores.
