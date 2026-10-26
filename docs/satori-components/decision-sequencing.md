# Decision: build the Satori components alongside ADF, not remove ADF first

**Status:** decided 2026-10-08 · **Ticket:** [NXSAT-308](https://hyland.atlassian.net/browse/NXSAT-308) ·
**Question:** plan section 13, question 1 ("build-alongside or remove-first")

**Decision: build-alongside.** The trigger for removing ADF first did not fire. All five ADF-side packages
still download from GitHub Packages with a fresh cache, and nobody has said package access is being
withdrawn. The plan's section 11 order stands: ADF is removed last, in the removal commit.

So `/browse-adf-hx` stays as a parallel route while the `nxs-` components are built. The removal commit
then deletes it and re-enables `app.navbar.browse` on `/browse`, as the NXSAT-308 plan decided on
2026-10-07.

The order is safe only if the "before" half of the parity evidence is captured early (section 4). That
evidence is the one thing that cannot be produced after access is lost.

## 1. What was decided between

- **Build-alongside:** keep ADF installed while the `nxs-` components are built, and remove it in the
  removal commit. The product's current Browse (`/browse-adf-hx`) keeps working until its replacement
  is ready, and the upstream components can be captured live as the "before" half of the parity
  evidence.
- **Remove-first:** right after the backup branch and the `adf-extensions` reimplementation, delete
  the five packages, both POC routes and the bridge, and run everything on top of today's hand-written
  `/browse`.

The agreed trigger for remove-first: any `npm ci` or tarball failure on `@alfresco/adf-hx-content-services`,
`@alfresco/adf-core`, `@alfresco/adf-extensions`, `@alfresco/js-api` or `@hylandsoftware/hxcs-js-client`,
or confirmation from the access owner that **package** access (not source access or support) is being
withdrawn.

## 2. Measurement, 2026-10-08 07:28 UTC

### 2.1 A green CI run on `main` does not show the registry still serves the packages

The last three CI runs on `main` passed, the newest being run `37738622066` on `70b4bb202`. **None of
them fetched an ADF tarball from GitHub Packages.** In all three, `actions/setup-node` restored the same
npm cache (`Cache hit for: node-cache-Linux-x64-npm-de850e…`, 284 MB). The cache key is a hash of
`package-lock.json`, so while the lockfile is unchanged, a revoked token would leave CI green.

That last sentence was tested rather than assumed. A scratch project with a lockfile entry for
`@alfresco/adf-hx-content-services@7.20.0-automate.292` was installed with `npm ci` on npm 10.8.2,
the version CI runs:

| Run | npm cache | Token   | Requests to GitHub Packages | Result             |
| --- | --------- | ------- | --------------------------- | ------------------ |
| 1   | empty     | real    | 1                           | installed          |
| 2   | warm      | invalid | **0**                       | **installed**      |
| 3   | empty     | invalid | 2                           | failed with `E401` |

Run 2 is the CI situation after a revocation: the install succeeds without asking the registry. Run 3
shows the same lockfile does fail once the cache is gone.

The last cold install on `main` was run `37446837500`, on 2026-10-06 10:00 UTC for `40d52405c`, the
most recent lockfile change. Its log reads `npm cache is not found`, and its `npm ci` added 1,650
packages. That is the latest proof that **the CI secret** had package access.

### 2.2 Tarballs, fetched with an empty cache

Each tarball was fetched with `npm pack <pkg>@<pinned version>` from a scratch directory, using the
repository's `.npmrc`, `SATORI_GH_READONLY_TOKEN` from the environment, and
`--cache <empty dir> --prefer-online`, so that nothing could be served from a cache. This is **this
machine's token, not the CI secret.**

| Package                             | Pinned version        | Result   | Bytes   | Integrity vs `package-lock.json` |
| ----------------------------------- | --------------------- | -------- | ------- | -------------------------------- |
| `@alfresco/adf-hx-content-services` | `7.20.0-automate.292` | HTTP 200 | 379,417 | matches                          |
| `@hylandsoftware/hxcs-js-client`    | `2.0.111`             | HTTP 200 | 147,410 | matches                          |
| `@alfresco/adf-core`                | `9.0.0`               | HTTP 200 | 924,425 | matches                          |
| `@alfresco/adf-extensions`          | `9.0.0`               | HTTP 200 | 30,927  | matches                          |
| `@alfresco/js-api`                  | `10.0.0`              | HTTP 200 | 592,491 | matches                          |
| `@hylandsoftware/satori-ui`         | `0.2.0`               | HTTP 200 | 113,998 | matches                          |

The two packages that exist only on GitHub Packages were also fetched from the exact `resolved` URL in
the lockfile, which is what `npm ci` downloads:

| Package                             | With the token          | Without a token (negative control) | Public npm |
| ----------------------------------- | ----------------------- | ---------------------------------- | ---------- |
| `@alfresco/adf-hx-content-services` | HTTP 200, 379,417 bytes | HTTP 401                           | HTTP 404   |
| `@hylandsoftware/hxcs-js-client`    | HTTP 200, 147,410 bytes | HTTP 401                           | HTTP 404   |

The 401 without a token shows the check can fail. The 404 on public npm confirms what the plan
recorded: relocking onto public npm could rescue `adf-core`, `adf-extensions` and `js-api`, but not
the upstream components or `hxcs-js-client`.

The token was never printed. A scan of every evidence file for its value found none.

## 3. Why build-alongside

- **The trigger is not met.** Every package downloads, and the integrity of each matches the lock.
- **Build-alongside keeps the product's Browse working.** `app.navbar.browse` is disabled on `main`, and
  the Browse entry users get is `/browse-adf-hx`. Removing ADF first would replace the upstream tree, list
  and permissions panel with today's hand-written `/browse` until the `nxs-` versions land. As measured
  in the [table-primitive decision](decision-table-primitive.md), that page renders only the first 50
  children and has sort headers a keyboard cannot reach.
- **It can be reversed until the removal commit.** If access goes mid-plan, the plan switches to
  remove-first then. The only thing that cannot be recovered afterwards is the parity "before" evidence,
  which section 4 deals with first.

## 4. What the next wave must do

1. **Capture the parity "before" evidence first, while ADF still installs.** These are the two known upstream
   failures from plan section 10. Not captured here:
   - the upstream document tree on `/browse-adf-hx` rendering children at depth (three or more levels);
   - the upstream permissions panel on a document whose ACL holds a permission outside
     `Read`/`ReadWrite`/`Everything`, for example `Write` or `AddChildren`.

   The backup branch keeps the source, but not the ability to install it. Once access is gone, this
   evidence cannot be produced.

2. **Add a cold-cache install canary.** The npm cache hides a revoked token until the lockfile next
   changes. A scheduled job that runs `npm ci` with an empty cache, or downloads the five tarballs with
   the CI secret, would report a withdrawal the day it happens. This is proposed, not implemented here;
   it belongs to the CI-gates workstream.
3. **Treat any 401, 403 or 404 on these packages as the remove-first trigger**, whether it comes from
   CI, a fresh worktree or the canary. Do not retry it away.

## 5. When to reverse this

Switch to remove-first (plan section 13, question 1, second option) if any of the following happens:

- `npm ci` or a tarball download fails on any of the five packages;
- the canary in section 4 fails;
- the access owner confirms that package access is being withdrawn.

In that case the parity "before" capture moves to the front, if it has not run yet, and `Remove` moves
to just after the backup branch and the `adf-extensions` reimplementation.
