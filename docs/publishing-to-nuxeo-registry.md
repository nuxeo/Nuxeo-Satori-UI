# Publishing the Satori platform to the `@nuxeo` registry

**Status:** planned, **deliberately not executed**. Nothing in this repo publishes
anything today, and `libs/platform/package.json` still carries `"private": true`.
This is the runbook for the final deployment stage, once the end-to-end plan is
working locally.
**Audience:** whoever cuts the first Beta release.
**Supersedes** the scope recommendation in `docs/publish-readiness.md` §1 — see
[What I got wrong earlier](#what-i-got-wrong-earlier).

---

## 1. Decision: `@nuxeo` on the Nuxeo Nexus registry

```
scope     @nuxeo
registry  https://packages.nuxeo.com/repository/npm-public/
```

This is not a new arrangement — it is exactly what `nuxeo-elements` already does, and
the reason it is the right answer is the read side:

|                           | Nuxeo Nexus `npm-public` | GitHub Packages      | Public npm            |
| ------------------------- | ------------------------ | -------------------- | --------------------- |
| **Install**               | **anonymous, no token**  | token required       | anonymous             |
| **Publish**               | `NPM_PACKAGES_TOKEN`     | `GITHUB_TOKEN` / PAT | npm org rights        |
| **Scope owned today**     | yes — `@nuxeo`           | `@hylandsoftware`    | `@nuxeo`, legacy only |
| **Precedent in this org** | `nuxeo-elements`, live   | `adf-hx` consumption | 3.x era, abandoned    |

Verified against the live registry, unauthenticated:

```console
$ npm view @nuxeo/nuxeo-ui-elements version \
    --registry=https://packages.nuxeo.com/repository/npm-public/
2025.18.0

$ curl -sIL .../nuxeo-ui-elements-2025.18.0.tgz
HTTP 200, 8,532,038 bytes
```

**A customer needs one `.npmrc` line and no credentials.** That is a materially better
Beta story than a token-gated registry, and it is why this supersedes the earlier
GitHub Packages recommendation.

### What I got wrong earlier

`docs/publish-readiness.md` §1 recommended GitHub Packages and described `@nuxeo` as
"an existing, owned public scope" on npmjs. Both need correcting:

- **`@nuxeo` publishes to Nuxeo Nexus, not public npm.** `nuxeo-elements/.npmrc` maps
  the scope to `packages.nuxeo.com`, and every publish step in its workflows targets
  that host.
- **Public npm has only a legacy `@nuxeo/nuxeo-ui-elements@3.0.13`**, from the 3.x era.
  The live line is `2025.18.0`. Reading `npm view` against npmjs and concluding the
  scope was actively published there was the error — the version number was the tell,
  and I did not check it.

---

## 2. Secrets

Exactly one, and it already exists in the `nuxeo-elements` repository.

| Secret               | Used as           | Purpose                | Who holds it        |
| -------------------- | ----------------- | ---------------------- | ------------------- |
| `NPM_PACKAGES_TOKEN` | `NODE_AUTH_TOKEN` | publish to Nuxeo Nexus | WebUI / Nuxeo infra |

Two more appear in the `nuxeo-elements` release pipeline and are **only** needed if we
replicate its full promote flow:

| Secret            | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `GIT_ADMIN_TOKEN` | push version-bump commits and tags to a protected branch      |
| `GITHUB_TOKEN`    | create the GitHub Release (provided automatically by Actions) |

**Nothing new has to be provisioned** for a first publish beyond granting this repo
access to `NPM_PACKAGES_TOKEN` at the org level. No npm org registration, no new
registry, no signing keys.

### How the token reaches npm

Never written to a committed `.npmrc`. `actions/setup-node` generates a runner-local
one from `registry-url` + `scope`, and reads `NODE_AUTH_TOKEN` at publish time:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 22
    registry-url: 'https://packages.nuxeo.com/repository/npm-public/'
    scope: '@nuxeo'

- name: Publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_PACKAGES_TOKEN }}
  run: npm publish dist/libs/platform --tag SNAPSHOT
```

Note `nuxeo-elements` leaf packages carry **no `publishConfig`** — the registry comes
from `.npmrc` and, in `promote.yaml`, an explicit `--@nuxeo:registry=` flag on the
publish command. Follow that convention rather than adding `publishConfig`, so there is
one way registries are chosen in this org rather than two.

---

## 3. How `nuxeo-elements` versions and releases

Worth copying, because it solves problems we would otherwise rediscover.

### Version scheme

Calendar-based, not semver-marketing: `2025.19.0-SNAPSHOT` on the development branch,
where `19` is the release train. Held in `lerna.json` and every workspace
`package.json`, kept in step by `lerna version --force-publish`.

### Three dist-tags, three audiences

| dist-tag   | Produced by                   | Version shape       | Consumer                  |
| ---------- | ----------------------------- | ------------------- | ------------------------- |
| `SNAPSHOT` | `main.yaml`, every push       | `2025.19.0-rc.14`   | integration builds        |
| `alpha`    | `alpha.yaml`, manual dispatch | `2025.19.0-alpha.2` | work-in-progress branches |
| `latest`   | `promote.yaml`, manual        | `2025.18.0`         | customers                 |

Live tags on the registry right now:

```
latest: 2025.18.0   SNAPSHOT: 2025.19.0-rc.14   alpha: 2025.19.0-alpha.2
```

**`latest` is only ever moved by a deliberate promotion.** Continuous builds publish
under `SNAPSHOT`, so an unfinished commit can never become what `npm install` resolves.
This is the single most important property to copy.

### The tag-namespace trap, already solved

`main.yaml` derives the next RC by globbing git tags `v${version}*`. `alpha.yaml`
therefore tags **without** the `v` prefix (`2025.19.0-alpha.2`, not `v...`), precisely
so alpha builds cannot be picked up as RCs and corrupt RC numbering. Any fourth
pipeline must respect that namespace split.

### Promotion

`promote.yaml` is `workflow_dispatch` with a version input, and it:

1. strips `-rc.N` → `2025.19.0`
2. sets the version across all packages
3. tags `v2025.19.0`, pushes, creates a GitHub Release
4. **publishes `--dry-run` first, then for real** — two steps, same command
5. bumps the reference branch to the next `-SNAPSHOT`

It also takes a `dryRun` input that skips pushing and publishing entirely.

---

## 4. Our situation is simpler in one way, harder in another

**Simpler:** one package. `nuxeo-elements` runs lerna across five workspaces with
`--force-publish` to keep versions aligned. We publish `dist/libs/platform` and need no
lerna, no workspace version syncing, no `--ignore` list.

**Harder:** we publish a **build artifact**, not the source directory.
`nuxeo-elements` publishes its workspace folders as-is, so `npm version` in the repo is
the published version. Ours is generated by ng-packagr into `dist/libs/platform/`, so:

- the version must be set in `libs/platform/package.json` **before** `nx build platform`
- `npm publish` targets `dist/libs/platform`, not the repo root
- `"private": true` must be removed from the source `package.json`, and ng-packagr
  copies that field through to the artifact — which is exactly what blocks an
  accidental publish today

---

## 5. Runbook — first Beta publish

Do this at the **final deployment stage**, not before.

### 5.1 Rename the scope (one-off)

`@nuxeo/satori-platform` → `@nuxeo/satori-platform`. Two authored files plus a
mechanical rename:

1. `libs/platform/package.json` — the `name` field
2. `tsconfig.base.json` — five alias keys
3. 190 import specifiers across ~148 files — the same find-and-replace already done
   once when moving off `@agentic-ui/shared/*`

Then:

```bash
npx nx build platform
npm run beta:api -- --update          # names change, so the snapshot must be regenerated
npx nx run-many -t typecheck build test --all --skip-nx-cache
```

> `fork-simulation` fails if no tsconfig alias matches the built package name, rather
> than silently compiling against the source tree. A half-finished rename cannot look
> green.

### 5.2 Decide the version scheme

Recommendation: **adopt the calendar scheme**, so a customer running Web UI
`2025.19.0` and the Satori platform is not reconciling two unrelated version spaces.

Open question for whoever does this: is the platform versioned **with** the Nuxeo
release train, or independently as `0.x` while the API moves? Beta argues for `0.x`;
alignment argues for the train. This is a product decision, not a technical one.

### 5.3 Unblock publishing

In `libs/platform/package.json`:

```diff
- "name": "@nuxeo/satori-platform",
+ "name": "@nuxeo/satori-platform",
- "private": true,
+ "version": "<agreed version>",
```

Add to the repo `.npmrc`, alongside the existing `@hylandsoftware` lines:

```
@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/
```

Harmless before publishing — it only changes where `@nuxeo` packages are _resolved_
from, and we consume none today.

### 5.4 Verify before publishing

```bash
npx nx build platform
npm run beta:gate -- --phase release        # 11/11, includes api-surface + fork-simulation
npm publish dist/libs/platform --dry-run    # inspect name, version, files, registry
```

The dry run is the last checkpoint. Confirm it reports `@nuxeo/satori-platform`, the
intended version, the resolved registry, and the file list.

### 5.5 Publish under a pre-release tag

**Never publish the first build as `latest`:**

```bash
npm publish dist/libs/platform --tag alpha \
  --@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/
```

Then install it somewhere clean and check the fork story end to end:

```bash
npm install @nuxeo/satori-platform@alpha
```

`latest` moves only when a promotion is deliberate.

### 5.6 A CI workflow, when it is wanted

Deliberately not written yet — a workflow that publishes to the wrong registry or the
wrong dist-tag is worse than none. When it is, model it on `alpha.yaml`: manual
dispatch, `setup-node` with `registry-url` + `scope`, `NODE_AUTH_TOKEN` from
`NPM_PACKAGES_TOKEN`, publish under a pre-release dist-tag.

---

## 6. What is already proven, and what is not

Everything except the network call:

| Claim                                       | Evidence                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builds a real package                       | `npx nx build platform` → `dist/libs/platform`                                                                                                                                                                                                                                                                    |
| Every `exports` subpath resolves            | `npm run beta:publishable` finds every `exports` target in the packed copy, all 8 subpaths including `/components-satori`; `npm run beta:installable` resolves the root and five entry points in a scratch install with no credentials, but not `/components-satori`, whose import needs the optional Satori peer |
| Published types are consumable              | customer-shaped `probe.ts` typechecks against the **installed** `.d.ts`                                                                                                                                                                                                                                           |
| A real app compiles against published types | `npm run beta:fork`                                                                                                                                                                                                                                                                                               |
| The surface cannot drift unnoticed          | `npm run beta:api` — 2026 lines of signatures, watched failing                                                                                                                                                                                                                                                    |
| Peers declared                              | 10, all reachable specifiers accounted for                                                                                                                                                                                                                                                                        |

**Peer installability — proven for the required peers only.** `npm run beta:installable`
installs the built tarball from public npm with no credentials, so `@angular/material` and the
other required peers resolve at the versions we declare, and requires the same install to fail
once the optional `@hylandsoftware/satori-ui` peer is made required. Not proven: that optional
peer, which needs GitHub Packages access, and an install of a published version rather than the
tarball. §5.5 is where that gets found out, which is why the first publish must be `alpha`.

---

## References

- Reference pipeline: `nuxeo-elements/.github/workflows/{alpha,main,promote}.yaml`
- Reference registry config: `nuxeo-elements/.npmrc`
- Scope decision background: `docs/publish-readiness.md`
- Package: `libs/platform/README.md`
- Phase 4 record: `docs/phase-4-publishable-platform.md`
