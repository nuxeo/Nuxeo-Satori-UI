# Satori Storybook on a private Pages site — draft for review

A proposal, not a live configuration. Nothing in this directory runs: the workflow is at
`workflows/pages.yml`, **not** under `.github/workflows/`, precisely so this repository does not
execute it. The files are laid out ready to copy into a new private repository once the shape is
agreed.

## Why a second repository at all

`nuxeo/agentic-ui-poc` is public (`gh repo view` → `"visibility":"PUBLIC"`). A repository gets one
Pages site, so anything served under `nuxeo.github.io/agentic-ui-poc/…` — any path, including a
tucked-away one — ships inside that public site's artifact and is readable by anyone. GitHub Pages
has no per-path access control.

The two Satori Storybooks bundle compiled `@hylandsoftware` modules, `--sat-*` tokens and Satori's
fonts. We may consume those; we may not redistribute them. That is what
`scripts/storybook-publication-gate.mjs` enforces in the public repository, and this proposal does
not touch it — the public site keeps serving the Material Storybook only, and the gate keeps
refusing everything else.

So: a separate **private** repository with its own Pages site, restricted by GitHub's Pages access
control to people who can read the repository. The `nuxeo` org is on the `enterprise` plan, so
that feature is available.

## The direction of travel

The private repository is a **publisher**, not a fork. It holds no product source. It checks out
the public repository at a ref, builds there, and deploys the result to its own Pages site.

The inverse — build in the public repository, push the output here — looks equivalent and is not.
It would route licensed bytes through a public repository's workflow artifact storage, which is
public, and it would mean storing a write token for this repository in a public one. The public
repository stays entirely out of it.

## Proposed repository

Suggested name `nuxeo/agentic-ui-satori-storybook`. Visibility **private**.

| File in this draft                    | Path in the new repository            | What it is                                         |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `workflows/pages.yml`                 | `.github/workflows/pages.yml`         | The only workflow: build, guard, deploy            |
| `scripts/assert-private.mjs`          | `scripts/assert-private.mjs`          | Fails closed unless repo **and** Pages are private |
| `scripts/assert-private.selftest.mjs` | `scripts/assert-private.selftest.mjs` | Twelve negative controls for that guard            |
| `scripts/assemble-site.mjs`           | `scripts/assemble-site.mjs`           | Lays both Storybooks out, writes the landing page  |
| `site/index.html`                     | `site/index.html`                     | Landing page template with provenance placeholders |
| `README.md`                           | `README.md`                           | This document, minus this table                    |

## The site it produces

```
/                      landing page — internal-only notice, source ref, commit, build time
/satori-theme/         satori-components:build-storybook:satori
/satori-components/    satori-components-satori:build-storybook:ci
```

Both Storybooks sit at sub-paths. That is already proven to work: the public site serves a
Storybook from the `/agentic-ui-poc/` sub-path today, so Storybook's relative asset paths handle
nesting.

The landing page is deliberately plain — system fonts, no external stylesheet, no webfont. The
Satori fonts belong to the builds it frames, not to the frame.

## The guard, and why it is the load-bearing part

Everything here rests on one fact: that this repository and its Pages site are private. That fact
is mutable, and the failure mode is silent and total — somebody flips the repository to public, or
Pages visibility resets, and the next scheduled run quietly publishes licensed assets to the open
internet. Nothing else in the pipeline would notice.

`scripts/assert-private.mjs` is the mirror image of the public repository's publication gate. That
one asks "does this build carry Satori?" and fails when it does. This one asks "is the destination
actually closed?" and fails when it is not. It asserts, against the GitHub API:

- `GET /repos/{owner}/{repo}` → `"private": true`
- `GET /repos/{owner}/{repo}/pages` → `"public": false`

The field names are confirmed against the live API, not assumed — `/pages` on the current public
site returns `"public": true` today. It runs in **both** jobs: in `build` before the artifact
leaves the runner, and again in `deploy`, which is the job that actually publishes, because
visibility can change between the two and a verdict from another runner a minute ago is not a
verdict now.

It fails closed. A non-200, an absent field, a non-boolean, no token, Pages not configured — every
one of those is a failure. "Nothing was checked" is never "nothing was wrong".

### Evidence it fails on purpose

`scripts/assert-private.selftest.mjs` drives it through twelve fabricated refusals and asserts the
single safe combination is the only pass. Run already, in this worktree:

```
assert-private.selftest: PASS — 12 refusals and 1 pass, all as intended.
```

And against the live API on a genuinely public repository, which it must refuse:

```
$ GITHUB_TOKEN=… node scripts/assert-private.mjs nuxeo/agentic-ui-poc
  [FAIL] nuxeo/agentic-ui-poc is PUBLIC. …
  [FAIL] The Pages site of nuxeo/agentic-ui-poc is PUBLIC ("public": true). …
assert-private: FAIL — … Nothing was published.      (exit 1)
```

`scripts/assemble-site.mjs` carries the smaller version of the same idea: it asserts each build
really is a Storybook — `index.html`, `iframe.html`, and an `index.json` listing at least one
entry — before copying it. A renamed `outputDir` otherwise copies nothing, the deploy succeeds, and
the site is an empty shell nobody notices until they open it.

Driven through fixtures rather than a real Angular build, it was seen to refuse: a Storybook
directory that does not exist, one missing `iframe.html`, two valid shells whose `index.json` lists
no entries (the blank-site case), and a missing landing-page template. Each exits 1 and writes
nothing at all — every check runs before the first byte is copied. The positive control copies both
Storybooks, substitutes every placeholder, and renders the provenance footer and both cards.

The leftover-placeholder check earned its place during this draft: it caught the template's own
HTML comment, which spelled a placeholder out in prose and so looked unsubstituted. The comment was
reworded; the check was not weakened.

What has **not** been run is the real thing — two Angular Storybook builds against installed
`@hylandsoftware` packages. That needs the repository to exist and takes a CI run.

## Setup, once the shape is agreed

These need repository-admin rights, so they are yours to run, not mine:

1. Create `nuxeo/agentic-ui-satori-storybook`, **private**. Copy in the files per the table above.
2. Add a `SATORI_GH_READONLY_TOKEN` secret, or share the existing org-level secret with the new
   repository. Nothing else is needed — the source checkout needs no token, being public.
3. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. **Before** setting visibility, dispatch the workflow once. It should fail at
   `Assert the destination is private` with "no Pages site is configured" or `"public": true`.
   That is the guard being seen to fail on purpose, on the real repository, for free.
5. Settings → Pages → Visibility: **Private**. Dispatch again; it should deploy.
6. Note the site URL GitHub assigns. An access-controlled site gets its own host, not a path under
   the public site — confirm the exact URL at this point rather than predicting it.

## What is not yet verified

- **`pages: read` on `GITHUB_TOKEN`.** The guard reads the Pages config, and I have granted the
  build job `pages: read` for it. Whether the job token is accepted on that endpoint cannot be
  tested without the repository existing. If step 4 fails with a 403 rather than a visibility
  complaint, the fix is to read visibility from `GET /repos/{owner}/{repo}` alone — `private` is
  the field that actually gates access — and drop the `/pages` assertion to a warning. The guard
  already distinguishes those two failures by message.
- **Build time and cost.** Two Storybook builds plus Compodoc, no Nx cache, on a weekly schedule.
  Worth watching once and then deciding whether weekly is right.

## One thing worth knowing separately

The public repository's `storybook-pages.yml` triggers on `push` to `integration/nxsat-308`. That
branch no longer exists on the remote, and `main` now carries both Storybook configurations, so
that workflow has no automatic trigger any more and the public site is only as fresh as its last
manual dispatch. That is the `TODO(NXSAT-649)` in its header. It is a separate change from this
one, and not something to fold in here.

## The decision that is not technical

Hosting these builds where every Hyland org member can read them is still distribution, just a
narrow and internal kind. It is a much easier question than publishing publicly — the audience is
inside Hyland, consuming a Hyland product — but it is the Satori package owners' call, not an
engineering one. Worth one message to them before step 1, so the answer is on the record.
