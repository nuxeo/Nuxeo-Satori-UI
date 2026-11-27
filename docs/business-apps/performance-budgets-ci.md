# Performance budgets in CI

Phase 10 of the [development plan](development-plan.md) builds "performance budgets in CI". This
page sets them, says why each limit is where it is, and says how a pull request is held to them.
The asset library's own budget at 100,000 assets, phase 5's, is
[performance-budget.md](performance-budget.md); it runs on demand, and these run on every pull
request into a staging branch.

It is a proposal, decided without the team as part of the phase 10 work: change a limit here and in
[`budgets.json`](../../scripts/beta-harness/performance-budgets/budgets.json) together, with its
reasoning. The offline selftest fails when the two differ.

## The short version

- **In the browser:** three pages, each opened five times cold in Chromium against a stand-in for
  the server, judged on the median of the five: the home page, a queue's first page, and a record
  page's first render.
- **The bundles:** the initial bundle, and each lazy chunk the build makes, in bytes as built.
- **When a budget is exceeded,** the check fails and says which, with the number and the budget:
  `over budget: queue.firstPageMs is 2,600 ms, budget 2,500 ms`.
- **Where:** the `performance-budgets` job of the `CI` workflow, which runs on every pull request
  into `main`, `integration/**` and `staging/**`.
- **The guard:** the job lowers every budget below what it measured, one at a time, and requires
  each to fail; and it runs each check once more with one budget lowered, and requires it to exit 1.

```bash
npx nx run nuxeo-ui:build:production --stats-json   # the build, with esbuild's metafile
npm run beta:budgets-selftest                       # offline: no browser, no build
npm run beta:bundle-budgets -- --report /tmp/bundles.json
npm run beta:page-budgets -- --skip-build --report /tmp/pages.json
npm run beta:budgets-controls -- --bundles /tmp/bundles.json --pages /tmp/pages.json --run-checks
```

The page budgets need Playwright, installed with `--no-save` as the
[beta harness](../../scripts/beta-harness/README.md#prerequisites) says, and no Nuxeo and no
credentials.

## In the browser

[`pages.mjs`](../../scripts/beta-harness/performance-budgets/pages.mjs) serves the production build
with the asset performance check's stand-in
([performance-budget.md](performance-budget.md), "How it is measured"): the brand assets kit's
configuration, 100,000 synthetic assets, each answer after its stated latency, over the same
emulated office network, a 40 ms round trip and 10 Mbit/s each way. To it, the check adds a home of
three cards over the library's page provider: a count, its rights buckets and one bucket. Each page
is opened five times, interleaved, home, queue, record and again, each in a new browser context
with nothing cached, and each time is the page's own clock from navigation to what the page is for:

- **the home page,** `/#/home`: every card drawn with its figure, none still loading;
- **a queue's first page,** `/#/queues/library`: its 50 rows drawn, the first being the asset the
  server puts first;
- **a record page's first render,** `/#/doc/<the library's first asset>`: the asset's title in the
  page's heading and the layout's first card drawn.

**Why the median of five.** One run slowed by a garbage collection, or by a busy runner, does not
fail the check; three of five slowed do. A regression that slows every load moves the median at
once. The count of runs is odd, so that the median is one run's own time: `--runs` refuses an even
one. A page that did not draw in a run counts as not measured, and its median then fails.

The run fails, whatever its times, if a page threw, asked for something the stand-in has no answer
for, or asked a host other than the stand-in and the shell's icon font, which is not resolved.

<!-- table: pages -->

| Measure                | Budget  | Why there                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.firstRenderMs`   | 2500 ms | Web Vitals' "good" largest contentful paint: the cards' figures are what a person opens the home for. Measured at 1512 ms (below) on a laptop, so a regression of a second is caught, with room for a CI runner slower than that laptop; the job's own numbers are below.                 |
| `queue.firstPageMs`    | 2500 ms | The same, and the asset library's own budget for its first page, `library.firstPageMs` ([performance-budget.md](performance-budget.md)). Measured at 1700 ms.                                                                                                                             |
| `record.firstRenderMs` | 3000 ms | The record page loads the document page's code, the largest lazy chunk at 465 kB, and its vocabularies, so half a second more than the other two; within Web Vitals' "needs improvement" band, which ends at 4 seconds, so a page that has fallen into "poor" fails. Measured at 1813 ms. |

## The bundles

[`bundles.mjs`](../../scripts/beta-harness/performance-budgets/bundles.mjs) reads the production
build and the metafile the build writes beside it with `--stats-json`,
`dist/nuxeo-ui/browser-stats.json`, which says which source file each output was made for and what
each output imports:

- **the initial bundle:** `main-<hash>.js`, every chunk it imports statically, transitively, and the
  global stylesheet, which is what Angular's own "Initial total" counts;
- **each lazy chunk:** each output made for a dynamic import, a route's `loadChildren` or
  `loadComponent` or another `import()`, with every chunk it imports statically that is not in the
  initial bundle: what opening it costs beyond the first load. It is named by the source it was
  made for: `feature:<library>` for a feature library's entry, with the file for a second entry,
  `app:<path>` for the app's own, below `apps/nuxeo-ui/src/app`.

Sizes are the files' bytes on disk, not compressed: deterministic, and what Angular's own budgets
count. The compressed size is in the report, for reading.

**A lazy chunk with no budget fails,** so a new feature, or a new lazy route, cannot ship without
one; **a budget for a chunk the build no longer makes fails too**, so the table cannot keep a line
that holds nothing.

**The rule for each limit.** The initial bundle: a tenth over what it was measured at. Angular's
own error, in `angular.json`, is at 4 MB, so it would let 0.9 MB more in unseen, and its warning,
2.5 MB, is passed already; a tenth is about 300 kB, a large new dependency made eager. Each lazy
chunk: a fifth over what it was measured at, rounded up to the next kibibyte, and 4 KiB at least,
so that a placeholder page is not failed by a sentence. A pull request that needs more raises the
line here and in `budgets.json`, with its reason.

<!-- table: bundles -->

| Chunk                                                               | Budget          | Measured        |
| ------------------------------------------------------------------- | --------------- | --------------- |
| `initialBytes`                                                      | 3,436,544 bytes | 3,123,605 bytes |
| `app:business-apps.actions`                                         | 4,096 bytes     | 787 bytes       |
| `app:business-apps.menu`                                            | 56,320 bytes    | 46,084 bytes    |
| `app:business-apps.routes`                                          | 53,248 bytes    | 44,126 bytes    |
| `app:dashboard/dashboard-page`                                      | 32,768 bytes    | 26,512 bytes    |
| `app:extensions/bulk-action.services`                               | 7,168 bytes     | 5,131 bytes     |
| `app:features/contracts/contracts-page`                             | 4,096 bytes     | 327 bytes       |
| `app:login/login-page`                                              | 25,600 bytes    | 20,686 bytes    |
| `app:not-found-page`                                                | 4,096 bytes     | 1,262 bytes     |
| `app:personal-space/personal-space-page`                            | 4,096 bytes     | 2,322 bytes     |
| `app:placeholder-page`                                              | 4,096 bytes     | 542 bytes       |
| `app:settings/authorized-applications/authorized-applications-page` | 5,120 bytes     | 3,897 bytes     |
| `app:settings/cloud-services/cloud-services-page`                   | 6,144 bytes     | 4,724 bytes     |
| `app:settings/nuxeo-drive/nuxeo-drive-page`                         | 10,240 bytes    | 8,299 bytes     |
| `app:settings/profile/profile-page`                                 | 23,552 bytes    | 19,491 bytes    |
| `app:settings/themes/themes-page`                                   | 7,168 bytes     | 5,911 bytes     |
| `app:shell/app-shell`                                               | 260,096 bytes   | 216,619 bytes   |
| `feature:administration`                                            | 158,720 bytes   | 132,237 bytes   |
| `feature:assets/asset-search-results`                               | 44,032 bytes    | 35,894 bytes    |
| `feature:assets/assets-drawer`                                      | 32,768 bytes    | 26,950 bytes    |
| `feature:browse`                                                    | 224,256 bytes   | 186,269 bytes   |
| `feature:capture`                                                   | 55,296 bytes    | 45,437 bytes    |
| `feature:collections`                                               | 57,344 bytes    | 47,002 bytes    |
| `feature:document-detail`                                           | 558,080 bytes   | 464,877 bytes   |
| `feature:knowledge-discovery`                                       | 90,112 bytes    | 74,945 bytes    |
| `feature:layout-designer`                                           | 181,248 bytes   | 151,023 bytes   |
| `feature:search`                                                    | 81,920 bytes    | 67,683 bytes    |
| `feature:tasks`                                                     | 26,624 bytes    | 21,658 bytes    |
| `feature:trash`                                                     | 49,152 bytes    | 40,293 bytes    |

The `verify` job's older "Check bundle size" step, 6 MiB of all the JavaScript and CSS, stays as it
is: it counts every file the build makes, these count what a person's browser fetches and when.

## In CI

The `performance-budgets` job of [`ci.yml`](../../.github/workflows/ci.yml), on every pull request
into `main`, `integration/**` and `staging/**`, and on every push the workflow takes:

1. the production build, with its metafile;
2. the selftest, offline: the judgement failing with both numbers, the reading of a metafile, the
   controls, these tables against `budgets.json`, and this job's own steps;
3. the bundle budgets;
4. Playwright and Chromium, at the version `a11y/versions.mjs` pins, installed with `--no-save`, so
   the lockfile and `npm ci` are untouched;
5. the page budgets;
6. **the guard:** every budget lowered on purpose below its own measured number, one at a time, and
   seen failing with that number and that budget; then each check run once more with a budget
   lowered, `initialBytes` to one byte below and `queue.firstPageMs` to 1 ms, and seen exiting 1;
7. the reports, uploaded as the run's `performance-budgets` artifact.

The job needs nothing but what every job of the workflow has: the read-only package token, through
the setup action. It adds no permission and no secret.

**It blocks a merge only as a required check.** The workflow has no job that gathers the others, so
each is required by name in the branch's ruleset, which an administrator of the repository sets:
`performance-budgets` is to be added there for `staging/**`, `integration/**` and `main`. Until it is,
a red job is seen on the pull request, and does not stop the merge. This work changes no ruleset.

## Measured on 27 November 2026, locally

On an Apple Silicon Mac, Chromium 153 headless, the network above, no CPU slowdown, the branch that
added these budgets with no changes on top. Not a CI runner's numbers: those are in the job's
report, its `performance-budgets` artifact, on every run.

| Measure                | Median of five | The five                     |
| ---------------------- | -------------- | ---------------------------- |
| `home.firstRenderMs`   | 1512 ms        | 1500, 1501, 1512, 1513, 1533 |
| `queue.firstPageMs`    | 1700 ms        | 1696, 1698, 1700, 1700, 1702 |
| `record.firstRenderMs` | 1813 ms        | 1801, 1805, 1813, 1813, 1813 |

The guard, the same day, locally, as the job runs it on every run: all 29 bundle budgets and all 3 page budgets, each lowered to one below
its number, failed the judgement with that number and that budget, and each set at its own number
passed; `bundles.mjs --lower initialBytes=3123604` said "over budget: initialBytes is 3,123,605
bytes, budget 3,123,604 bytes" and exited 1; `pages.mjs --lower queue.firstPageMs=1` said "over
budget: queue.firstPageMs is 1,701 ms, budget 1 ms" and exited 1.

## What this does not measure

- **The server.** The stand-in answers after stated latencies, as the asset library's budget
  says; a real Nuxeo's time needs a server, which CI does not have.
- **A slow machine.** The runner is what it is; no CPU slowdown is emulated, so these hold the app's
  own regressions, not its speed on a customer's oldest laptop.
- **Every page.** Three pages, on one kit's configuration. A queue or a record page of another kit,
  with other cards, costs what its own layout costs.
- **Interaction after the first render:** paging, facets, an open after the first. The asset
  library's budget measures those, on demand.
