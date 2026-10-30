---
name: fix-bug
description: >-
  End-to-end agentic playbook for fixing a Jira bug (NXSAT-<id>, NCO-<id>, NXENG-<id>) in the
  Nuxeo-Satori-UI Nx/Angular monorepo: runs fully autonomously end-to-end (YOLO mode, no
  confirmation gates), analyse the ticket + all comments, derive acceptance criteria when the
  ticket has none, take an isolated per-ticket workspace (own worktree, own ports and a
  ticket-scoped Nuxeo data root on the shared instance; a dedicated container only with
  --nuxeo own), reproduce and capture evidence (images AND videos) to
  ~/Desktop/agentic-ui-evidence/<TICKET-ID>/fix/ first, weigh the candidate fixes and record the
  choice, fix at the root cause, add a regression test, run an active blast-radius check and the
  full beta:gate, create a signed-commit PR, poll CI to green, close every review thread, then
  post the fix summary to Jira with attachments. Use when asked to fix a bug, a Jira bug ticket,
  "fix and raise PR", or take a defect to review.
---

# Fix a Nuxeo-Satori-UI bug — agentic, end-to-end

Drive the whole fix in **YOLO mode: run the entire workflow end-to-end without pausing for
confirmation between phases** — reproduce → decide → fix → validate → commit → push → open the PR
→ update the ticket → summarize. State the plan up front for the record, then keep going. The only
hard stops are the **Guardrails** at the bottom and the **Stop conditions** in Phase 3.5; YOLO
relaxes the _confirmation_ gates, not those. Track phases with a TODO list.

Delegate: review-comment mechanics to the [`pr-review-responder`](../../agents/pr-review-responder.md) subagent, new tests to
[`generate-tests`](../generate-tests.md), gate iteration to [`verify-gate`](../verify-gate/SKILL.md),
and accessibility / i18n / cross-browser validation to [`validate-fix`](../validate-fix/SKILL.md).

> **Building a feature, enhancement or new module rather than fixing a defect?** Use
> [`build-feature`](../build-feature/SKILL.md), which extends this skill — it inherits the
> workspace, gate, evidence, PR, CI and metrics phases and replaces the bug-shaped ones
> (reproduce, root cause, failing-first regression test) with design and layer placement,
> vertical-slice delivery and docs as deliverables.

> **Evidence is always captured in BOTH forms — screenshots (images) AND screen recordings
> (videos), before and after.** Never ask which format; always produce both.

> **Core rule — this repo has ONE base branch, `main`.** There is no maintenance base and no
> backport: one branch, one PR. Do not go looking for a second base.
> What is non-negotiable instead: **every fix ships with written acceptance criteria, a recorded
> choice of approach, a stated root cause, a regression test that fails before and passes after,
> a blast-radius check, and before/after evidence in both forms.**

Useful constants:

- Atlassian cloudId: `252cce86-035e-4b0e-abd2-3c002935632f` (site `hyland.atlassian.net`)
- Jira projects: `NXSAT` · `NCO` · `NXENG` — Upstream repo: `nuxeo/Nuxeo-Satori-UI` — base: `main`
- SonarCloud: org `nuxeo`, project key `nuxeo_agentic-ui-poc` — the key kept the repo's old name
- Shared dev infra you must **never** disturb: containers `nuxeo` (:8080) and `nuxeo-opensearch`
  (:9200), network `nuxeo-net`, and the primary checkout itself

## Time budget — how long this should take, and when to bail

There is no useful "time complexity" for a bug fix, but an unbounded agent run is worse than a
slow one. Budget the phases and **report any overrun rather than silently continuing**:

| Phase                                 | Budget  | On overrun                                                  |
| ------------------------------------- | ------- | ----------------------------------------------------------- |
| 1–1.6 ticket, workspace, expectations | ~20 min | `npm ci` and the image pull dominate; keep going            |
| 2 reproduce + before evidence         | ~30 min | **Cannot reproduce → stop and report.** Never fix blind.    |
| 3.5–4 decide + fix                    | ~45 min | Three failed attempts at a root cause → stop, per Phase 3.5 |
| 5 gate to green                       | ~30 min | Three attempts on one failure → stop (`verify-gate`)        |
| 7 CI poll                             | 45 min  | Hard cap — see Phase 7. Report what is still pending        |
| Whole run                             | ~3 h    | Report progress, the blocker, and what you need             |

Two loops are explicitly bounded: **fix ↔ evidence** (Phase 4, three iterations) and **gate**
(Phase 5, three attempts per failure). Nothing else may loop without a bound.

### Measure the run — one command per phase boundary

Budgets are guesses until they are measured. Mark every phase transition so the next run can be
compared against this one:

```bash
node scripts/agent-metrics.mjs start "$TICKET" --kind bug --model <the model you are>
node scripts/agent-metrics.mjs phase "$TICKET" <phase-id>    # at each phase below
node scripts/agent-metrics.mjs event "$TICKET" retry|gate-fail|stop-condition|evidence-rerun
node scripts/agent-metrics.mjs end   "$TICKET" --outcome pr-open|merged|blocked|abandoned
```

Phase ids are a fixed list and an unknown one is rejected: free-text phase names make runs
incomparable, and a table you cannot compare cannot tell you which phase to shorten. Each id
sits in one of four buckets, and **only `fix` is published**:

| bucket     | phases                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `fix`      | `ticket` `expected` `reproduce` `design` `decide` `scaffold` `fix` `regression-test` `docs` `blast-radius` `gate` `validate` |
| `evidence` | `evidence-before` `baseline` `verify-evidence`                                                                               |
| `review`   | `review`                                                                                                                     |
| `overhead` | `workspace` `pr` `ci` `jira` `cleanup`                                                                                       |

`review` is its own bucket, not part of `fix`. Review-loop work **is** fixing, but it lands
after the PR is open and the published row is now written there — so leaving it in `fix` meant
the page either waited for a loop that can run six rounds, or silently dropped the work done in
it. Calling it `overhead` would be the other lie. It is measured, printed locally, and excluded
from the published total, which makes `fix` **final at PR raise**.

`cleanup` covers the final summary only. **Teardown is not measured**: it happens after the
last mark, and `publish` has already run at Phase 6 — well before the workspace is removed,
which matters because removing it deletes the copy of the script inside it.

The shared page answers "how long do fixes take", so it gets the `fix` total alone. The first
row published wall clock — 4h 13m for a one-line change, 88% of it evidence capture and CI
polling — which is a number about the pipeline masquerading as a number about the work. All
three totals stay in the local report, which is where you look when a run felt slow.

**`publish` refuses until the `pr` phase is recorded**, and runs at Phase 6 rather than at
teardown. The published number is final once the PR is open — `review` is a bucket of its own —
and the PR is the artifact the row refers to, so a reader can always go and look at what the
row is about.

`end` prints the per-phase table. **Phase 6 publishes the row**, as soon as the PR exists.

> **Do not report a token count or a cost.** You cannot observe your own token usage, and a
> plausible figure printed next to measured ones gets believed. The metrics log records the
> account, model and UTC window instead, which is what Cursor's usage export needs to attribute
> spend. Say "not measured — join on the recorded window" rather than estimating.

### Filesystem layout — write only inside these roots

| What                                                          | Where                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Evidence (screenshots, videos, logs)                          | `~/Desktop/agentic-ui-evidence/<TICKET-ID>/fix/`       |
| Ticket workspace (worktree, node_modules, conf)               | `~/Desktop/Projects/agentic-ui-worktrees/<TICKET-ID>/` |
| Ticket-specific Playwright scenes file (**local by default**) | `scripts/collect-evidence/<TICKET-ID>.mjs`             |

> **Never create a folder directly on `~/Desktop`**, and **never put a worktree inside the repo**
> — a nested checkout with its own `node_modules` will be picked up by Nx and by `git add -A`.
> Evidence lives outside the repo on purpose and must never be committed; anything load-bearing
> belongs in `documentation/` or `docs/`.

## Setup check — first-time users

Before the first run on a new machine, verify the environment. If anything is missing, **pause and
walk the user through it** — do not silently continue past a missing prerequisite:

- **Atlassian MCP** authenticated (`atlassianUserInfo` succeeds). On `needsAuth`/403, run
  `mcp_auth` for the Atlassian namespace; confirm access to **NXSAT**/**NCO**/**NXENG**.
- **Jira token** for attachments: `~/.jira_email` and `~/.jira_token` exist. If absent, have the
  user create them — never accept a token pasted into chat.
- **GitHub CLI**: `gh auth status` logged in with push access to `nuxeo/Nuxeo-Satori-UI`.
- **Signed commits**: `git config commit.gpgsign` is `true`, `gpg.format=ssh`, key registered on
  GitHub as a **Signing Key** (distinct from an Authentication key).
- **Node 24** (`.nvmrc`) and `npm ci` done. On Node 25+ a built-in `localStorage` shadows jsdom's
  and a bare `nx test` fails on correct code — route verification through the gate.
- **Docker running**, with the shared `nuxeo` container present: the workspace script reads its
  image and licence from it.
- **Playwright**, installed **in the primary checkout** (`npm install --no-save @playwright/test
@axe-core/playwright && npx playwright install chromium`). Local-only and untracked, so it never
  touches the lock file — but it must exist before a workspace hardlinks `node_modules`, because
  you cannot safely `npm install` into a hardlinked tree afterwards.

## Phase 0 — Plan (non-blocking)

Restate the goal and list the phases below as a TODO list. **Show the plan, then immediately
proceed — do not wait for approval.** Re-plan on the fly if scope changes, or if Phase 1.6
contradicts the hypothesis.

## Phase 1 — Understand the ticket

- `getJiraIssue` (cloudId above, `issueIdOrKey=<TICKET>`, `fields:["*all"]` incl. `comment`).
  If Atlassian tools aren't listed, call `mcp_auth` first.
- Read the description **and every comment** — repro steps, expected vs actual, screenshots.
- Identify the affected app/lib and feature (AGENTS.md §2 and §6).
- Load context: `AGENTS.md`, `AGENTS/00-architecture.md`, `AGENTS/01-services.md`, and
  `AGENTS/08-bug-patterns.md` — check first whether this is an already-catalogued pattern.

### 1a — Derive the acceptance criteria when the ticket has none

Most bug tickets have no Acceptance Criteria, and a vague one is worse than none because it reads
as if it were a spec. **Do not stop, and do not silently invent them either.** Write them down:

1. If the ticket has AC, use them verbatim as the spec and quote them.
2. If not, **derive** them — from the reported symptom, the expected behaviour established in
   Phase 1.6, the existing unit tests for the area, and the surrounding code's evident intent.
   Derive what _should_ happen, rather than paraphrasing what the reporter said went wrong.
3. Print them as a numbered, testable list — each one something the regression test or the
   evidence capture can actually assert. "Works correctly" is not a criterion.
4. Mark each as `[from ticket]` or `[derived]`, and carry them into the PR body and the Jira
   comment so a human can challenge a derived one.
5. **If a criterion cannot be derived without a product decision** — two defensible behaviours and
   nothing in the ticket, the tests, the server or the code settles it — that is a Phase 3.5 stop
   condition. Do not pick one silently.

## Phase 1.5 — Take an isolated ticket workspace (before touching anything)

**Never work a ticket in the primary checkout, and never `git stash` to make room for it.** One
working tree can only be on one branch, so two agents in one clone fight over `HEAD`, over
`node_modules`, and over the stash stack — a global stack, where another agent can pop yours. The
single base branch does **not** remove this problem; it only removes the need for two bases.

Every ticket gets its own worktree, `node_modules`, dev-server port, proxy config and Nuxeo data
root:

```bash
export TICKET=NXSAT-<id>
bash .cursor/skills/fix-bug/scripts/new-ticket-workspace.sh "$TICKET"
. ~/Desktop/Projects/agentic-ui-worktrees/$TICKET/env.sh   # NX_WT, NX_PORT, NX_APP_PORT, NX_PROXY, EVID…
cd "$NX_WT"
npx nx serve nuxeo-ui --proxy-config "$NX_PROXY" --port "$NX_APP_PORT"
```

The script is idempotent — re-running reuses and re-prints the workspace. It:

- creates the worktree on `fix/<ticket-slug>` cut from `origin/main`;
- **hardlinks `node_modules`** from the primary checkout when the lockfile matches — 920 MB
  across 66k files, shared by inode, so it costs no disk and takes seconds instead of minutes.
  Falls back to `npm ci` when the lockfile differs. **Never run `npm install` in a hardlinked
  tree** — it would edit the primary checkout too;
- **shares the `nuxeo` container by default**, with a per-ticket data root at
  `/default-domain/workspaces/<TICKET>` so two tickets do not trip over each other's documents;
- writes `apps/nuxeo-ui/proxy.conf.ticket-<slug>.json`, because the tracked `proxy.conf.json`
  hardcodes `:8080`. Gitignored, so it cannot be committed.

### When the ticket needs its own Nuxeo

```bash
bash .cursor/skills/fix-bug/scripts/new-ticket-workspace.sh "$TICKET" --nuxeo own
```

Use `--nuxeo own` when the bug needs a **different package set or server config, a clean or empty
instance, a specific Nuxeo version, or destructive operations** (trash purge, reindex, admin
settings). Otherwise share. An extra container costs ~2 GB of RAM — the image layers are shared,
so disk is only the writable layer — and containers accumulate silently: this machine already
carries 24 GB of reclaimable images and 221 volumes.

`--nuxeo own` pulls the latest build of the shared instance's image, records the digest to
`$EVID/nuxeo-image.txt` so the evidence says which server produced it, reuses the licence (read
at run time, never written to disk), and joins `nuxeo-net` to share the OpenSearch node while
**namespacing every index by ticket** (`nuxeo-<slug>`, `nuxeo-<slug>-audit`) so it can never
write to the shared instance's indices.

**Parallel-safety rules that follow:**

- Run everything from `$NX_WT`; never git-write in the primary checkout.
- Never `git stash`. To set changes aside use `git diff > /tmp/$TICKET.patch`.
- Never kill by pattern (`pkill -f node`, `docker rm` on a container you did not create) — those
  match another agent's run. Kill only PIDs you started and only your own `$NX_CONTAINER`.
- **Budget parallelism.** Sharing Nuxeo and hardlinking modules makes a workspace nearly free, so
  the limit is dev servers and CPU — four or five concurrent tickets. Each `--nuxeo own` ticket
  costs ~2 GB of RAM on top and pulls that ceiling down fast.
- If the primary checkout is dirty when you arrive, **leave it alone** — you never need it clean.

## Phase 1.6 — Establish the expected behaviour

Before you can call something a defect you need a defensible statement of what correct is.
**Do not infer it from the symptom, and do not infer it from REST documentation alone** — docs
describe what an endpoint accepts, not what this application should render.

Work through these in order and stop at the first that settles it:

1. **The existing tests for the area.** A spec that encodes the intended behaviour is the
   strongest source, because someone wrote it down deliberately. `rg` the owning service and
   component for their `.spec.ts` and read what they assert.
2. **The Nuxeo server itself.** For anything about data, permissions, audit entries or
   renditions, ask the server rather than guessing — it is the authority on its own responses:

   ```bash
   curl -s -u "$NUXEO_USER:$NUXEO_PASS" "$NX_URL/api/v1/id/<uid>?enrichers.document=permissions" | jq .
   ```

   Record the actual response in the evidence folder. A behaviour argued from memory of an API
   is the most common way a "fix" ends up encoding a second bug.

3. **Adjacent implementations in this repo.** The same problem is usually solved somewhere
   already — another feature module, another service method. Consistency with our own codebase
   is a real argument; inconsistency with it is a real defect.
4. **The product documentation** in `documentation/20-product/` for intended behaviour, and
   `AGENTS/02-nuxeo-apis.md` for the endpoint and enricher contracts.

**Record what you found and which source settled it**, citing the file, test or response. If
none of them settles it, the expected behaviour is a product decision — that is a Phase 3.5
stop condition, not something to resolve by picking the reading that is easiest to implement.

## Phase 2 — Reproduce + capture evidence (first hands-on step)

**Reproduce the bug before writing any code.** The workspace is already on the branch cut from
`origin/main`, so the repro reflects released behaviour.

```bash
node scripts/agent-metrics.mjs phase "$TICKET" reproduce   # confirming the defect is fix work
```

> **Reproduce autonomously (no confirmation).** Everything runs against `$NX_URL`. By default
> that is the **shared** `nuxeo` instance — the isolation is `$NX_DATA_ROOT`
> (`/default-domain/workspaces/<TICKET>`), so create and seed your documents there and do not
> treat repository-wide operations as isolated. Only under `--nuxeo own` (Phase 1.5) is
> `$NX_URL` a container of your own.
>
> **Always capture BOTH images and videos**, before _and_ after. Never ask which format.

**If you cannot reproduce it, stop and report.** A fix for a bug you never saw fail cannot be
verified by the after-capture, and "it looks right now" is how a non-fix ships. Say what you tried,
what you saw instead, and what you need — a document UID, a permission, a data shape.

### Capture a story, not a pile of screenshots

Evidence here is a **narrative with assertions**, produced by `scripts/collect-evidence/` (see
its `README.md`). A scenes file is written once and run twice — unfixed, then fixed — and the
report step combines the halves into side-by-side comparisons.

Playwright is **deliberately untracked** — local-only DX tooling kept out of the lock file so it
never perturbs the CI install. It is a **one-time, per-machine** setup, and it must happen in the
**primary checkout**, never in a ticket workspace:

```bash
node -e "require.resolve('@playwright/test')" 2>/dev/null && echo available || echo missing
# only if missing — note the cd: a workspace's node_modules is hardlinked, and npm writing
# into it can reach through into the primary checkout.
(cd ~/Desktop/Projects/agentic-ui-poc \
   && npm install --no-save @playwright/test @axe-core/playwright \
   && npx playwright install chromium)
```

Then re-create the workspace so it links the new packages
(`new-ticket-workspace.sh "$TICKET" --remove --force` then without `--remove`). The workspace
script warns at creation time if Playwright is absent, so you find this out before the repro is
set up rather than after.

That download is ~150 MB on a first-time machine and can take several minutes. Two notes:

- **It needs a display.** The runner is headed by default so the team can watch. Over SSH or in a
  container there is none — say so and stop rather than silently producing no evidence.
- **If the browser download fails** (proxy, offline, disk), do not fall back to prose. Report it
  and stop: the before/after capture is the only proof this workflow produces, and Phase 4a's
  verification loop depends on it.

Copy the template and write the scenes:

```bash
cp scripts/collect-evidence/TEMPLATE.scenes.mjs scripts/collect-evidence/$TICKET.mjs
```

Each scene declares `act`, `title`, `intent`, `criterion` and a `run()`. The **three acts** are
Setup (what the user was trying to do — the reviewer was not in the ticket), the Behaviour, and
the Proof. Then capture the first half:

**Mark the boundary here.** `reproduce` is in the `fix` bucket and `evidence-before` is not, so
leaving `reproduce` open through the capture puts the capture straight back into the published
fix total — which is the one thing the buckets exist to separate:

```bash
node scripts/agent-metrics.mjs phase "$TICKET" evidence-before

APP_URL="$APP_URL" EVIDENCE_PHASE=before NUXEO_DOC_UID=<uid> \
  npm run evidence:collect -- "$TICKET" scripts/collect-evidence/$TICKET.mjs
```

**Write the same file for both halves.** Never branch on `EVIDENCE_PHASE` inside a scene: the two
runs must perform identical actions, or the comparison is illustration rather than evidence.

Four rules the tooling enforces, so a capture cannot quietly stop proving anything — **a red here
is a defect in the evidence, and you fix it before reading the result**:

| Rule                                                                | Why                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| All three acts must be present                                      | A screenshot without context proves nothing to someone new to the ticket           |
| Every scene names a `criterion` from Phase 1a                       | "It looked right" is the claim this artifact replaces                              |
| Every scene must **assert** something                               | Screenshots show the app rendered _something_, not the right thing                 |
| A byte-identical before/after pair fails **unless a check flipped** | Identical images prove nothing alone; an invisible fix is proved by its assertions |

**Point at the thing you changed.** A recording of an app is not a demonstration of a fix —
the viewer has no idea which part of the screen to watch. Spotlight the element the scene is
about, and the eye goes to the right place while the caption explains it:

```js
{
  act: 2,
  title: 'Read the landmark name a screen reader would announce',
  criterion: 'AC-1',
  spotlight: { selector: 'aside.properties-panel', label: 'Properties sidebar' },
  async run(page, h) { /* … */ },
}
```

or `await h.spotlight('aside.properties-panel', { label: 'Properties sidebar' })` inside the
scene when the moment matters — the declarative form applies after `run()`, so the outline is
on screen for the hold, which is the part a viewer pauses on.

It draws a bright outline on the live element and dims the rest, and it **colours itself from
the half being captured**: red while the defect is on screen, green once it is fixed. That is
not overridable — you neither branch on `EVIDENCE_PHASE` nor can contradict it. A selector
that matches nothing **fails the run**: a recording that points at nothing is worse than one
that points at nothing on purpose.

**It never reaches a screenshot.** Like the caption banner it is hidden for every `shot()`,
because the before/after pair audit compares raw bytes and an overlay would make every pair
differ for a reason unrelated to the fix. Stills stay clean; `evidence:story` still draws its
own callouts on annotated _copies_ afterwards.

Gotchas:

- **Auth needs both mechanisms.** `h.login()` injects the session the route guard reads and the
  app's interceptor turns into the Basic header on its XHRs; the runner's `httpCredentials`
  (`send: 'always'`) authenticate `page.request`. Nuxeo with guests enabled never challenges, so
  a missing half does not 403 — it runs as `Anonymous` and looks green. The phase runner's
  identity guard rejects that at every step boundary (NXSAT-643); `await h.step(...)`.
- **Hash routing.** `withHashLocation()` makes `goto('/#/x')` same-document, so anything asserting
  a **reloaded** app needs an explicit `page.reload()` or `APP_INITIALIZER` never re-runs.
- **Probe the DOM, not the pixels.** A change inheriting theme colours makes before/after stills
  near-identical — which the pair audit will fail you for. Assert the attribute, text or request.
- **State limits with `h.note()`**, not by omission. It records the gap without inflating the
  check count, and it appears in the story.

## Phase 3 — Branch

The workspace already created `fix/<ticket-slug>` from `origin/main`. Nothing to do unless you
want a different name (`AGENTS/06-git-workflow.md`). The Jira id goes in the commit and PR title
(`fix(NXSAT-123): …`), not necessarily the branch name. **Never work on `main`.**

## Phase 3.5 — Decide the approach, in writing

Most bugs have more than one defensible fix, and YOLO removed the human who used to pick. So make
the choice explicit instead of letting the first idea win by default.

**Enumerate at least two candidate fixes** and print a short comparison before writing code:

| For each candidate, state                                                             |
| ------------------------------------------------------------------------------------- |
| Where it lives — which layer (component / service / bridge / manifest) and which file |
| What it costs — blast radius, new public API, new dependency, migration               |
| How it fails — what it does _not_ fix, and what it could break                        |
| Whether the expected behaviour established in Phase 1.6 settles it                    |

Then pick one and **state why in one sentence**. Prefer, in order: the fix at the true root cause
over one at the symptom; the smaller blast radius; the one consistent with how this repo already
solves the same problem elsewhere; the one needing no public API change. A fix in `libs/shared/` is consumed by all eight features — that is
rarely "minimal" just because the diff is small.

### Stop conditions — ask a human rather than choosing

- Two defensible behaviours and nothing in the ticket, the tests, the server or the code settles
  it (Phase 1a step 5).
- The fix would widen the public API, or expose an adf-hx type through it.
- The fix touches `install.xml`, marketplace packaging, or a registered extension ID — a
  registered ID is a published contract.
- The fix contradicts a verified fact in `AGENTS/11-beta-program.md` §3.
- The root cause is in a dependency rather than this repo.
- Three distinct attempts have failed to locate the root cause.

## Phase 4 — Fix (no new induced issues)

> **Fix autonomously (no confirmation)** once the bug is reproduced, the before-evidence captured,
> and the approach recorded. Still **print the root cause first** — file, function, line, and _why_
> it misbehaves — so it lands in the record before any change.

- Make the **minimal** change consistent with the approach you chose, at the root cause.
- Follow the conventions strictly:
  - `AGENTS/03-angular-conventions.md` — `standalone: true`, `inject()` not constructor DI,
    `signal()` not `BehaviorSubject` for UI state, `takeUntilDestroyed()` on every `.subscribe()`,
    `templateUrl` always.
  - `AGENTS/07-security.md` — credentials from environment only; never `<img [src]>` bound to
    authenticated Nuxeo content (fetch via service → blob URL); revoke every
    `URL.createObjectURL()` in `ngOnDestroy`.
  - `AGENTS/08-bug-patterns.md` — do not re-introduce a catalogued defect.
- Respect `scripts/review-guardrails.mjs`: no hardcoded colours in new `.scss`/`.html` (use
  `--mat-sys-*` / `--kd-*` tokens), every `createObjectURL` paired with `revokeObjectURL`, no
  `as unknown as` / `as never`, and any new `@nx/vitest:test` project has a config + specs.
- **Never cross-feature imports** — shared logic goes in `libs/shared/`, and a new library needs
  `scope:`/`type:` tags before it can import anything.
- **adf-hx types must never appear in our public API** — nothing imports adf-hx since its bridge
  was removed with the POC routes (NXSAT-635); do not reintroduce it.
- Keep the diff focused — do not bundle unrelated files.

### 4a — Verify against the evidence, and loop if it is not fixed

Capture the second half with the **same scenes file**, then build the comparison:

```bash
APP_URL="$APP_URL" EVIDENCE_PHASE=after NUXEO_DOC_UID=<uid> \
  npm run evidence:collect -- "$TICKET" scripts/collect-evidence/$TICKET.mjs
npm run evidence:story -- "$TICKET"
```

`evidence:story` writes `$EVID/STORY.md` (both halves, images inlined — paste this into Jira),
`contact-sheet.png` (one image for the PR body), `diptychs/` and `annotated/`. It **exits
non-zero** when the comparison does not support the claim, and says which of these it is:

- the BEFORE capture passed everything, so the bug did not reproduce or the scenes assert the
  fixed behaviour;
- the AFTER capture is not `pass`;
- a before/after pair is byte-identical **and no assertion changed between the halves**
  (when a check did flip, the change is simply not visual and the pair is a stated limitation);
- no scene appears in both halves, so nothing is actually compared.

Then:

- `evidence:story` green and every Phase 1a criterion asserted → go to Phase 4b.
- A criterion still failing → **return to Phase 4** (or Phase 3.5 if the approach was wrong).
  **Three iterations maximum**, then stop and report what you changed each time, what the story
  still shows, and your hypothesis.
- `evidence:story` red → fix the **evidence** first. A comparison that cannot fail cannot support
  a claim, and a red here is not a reason to re-edit the fix.

### 4b — Regression test

Add a unit test that **fails before the fix and passes after** — run it against the unfixed code
first and watch it go red, because a test that never failed is not a regression test
(`AGENTS/05-test-standards.md`, the `generate-tests` skill):

```bash
npx nx test <project>              # e.g. npx nx test document-detail
```

## Phase 4.5 — Blast-radius check (active, before the gate)

Documenting the blast radius in the final summary is too late to act on it. Do the search now:

1. **Find every consumer** of what you changed — `rg` for the symbol, the method, the model, the
   i18n key, the CSS token, the registered ID. A `libs/shared/` change reaches all eight features.
2. **Run their tests**, not just the ones `nx affected` picked: `npx nx test <each consumer>`. If
   the dependency graph disagrees with your `rg` results, trust `rg` and investigate the gap.
3. **Exercise the adjacent behaviours** in the same component — pagination, sorting, filtering,
   selection, counts, empty states, read-only/permission variants. Note which you actually
   exercised; do not claim the ones you did not.
4. **Check the extension surface**: did you change a registered ID, a manifest-addressable rule,
   action, route, nav item, or the adf-hx bridge boundary? Those are published contracts.
5. **Record the result** — it becomes section 6 of the Phase 9 summary. Only list something as
   unaffected once you have actually checked it.

## Phase 5 — Validate locally (gate before any push)

Run the gate this repo actually trusts. While iterating, use the fast inner loop; before pushing,
run the **full** gate with no `--gates` filter:

```bash
npm run beta:gate -- --gates guardrails,lint      # seconds — after every meaningful edit
npm run beta:gate                                 # full run before pushing
```

An unfiltered run executes **every gate in `ALL_GATES`** (the verdict line prints the count)
cheapest-first — `node`, `lockfile` and the dependency-tree pair, `supply-chain`,
`code-scanning`, `guardrails`, sanitizers, `assertions`, then affected `lint`, `test`, `build`,
`typecheck`, `spec-types`, `bundle`, `api-surface`, the packaging gates and the drift gates
(`reference-drift`, `agent-mirror`), with each gate's self-test beside it. It stops at the first
failure. `dependency-tree` passes while listing the ADF packages still in the tree — that list is
the NXSAT-308 removal backlog, not something your fix introduced. Expect the run to take a while;
that is the cost of the two traps it catches that `review:preflight` does not:

- **`test` does not typecheck.** Vitest strips types through esbuild, so a green test run is not
  type safety. Only `build` and `typecheck` catch a `TS` error, and they run late.
- **Nothing except the `lockfile` gate checks that `package-lock.json` will install.** CI was red
  for the whole of Phase 2 while every local gate was green. Revert incidental lockfile churn, and **never run a
  bare `npm install` and commit the result** — on macOS it prunes optional platform entries Linux
  needs and `npm ci` then refuses the tree.

Only a run with **no** `--gates` filter can be cited. A filtered run reports `pass-partial`; read
`gates.notRequested` before quoting anything. A run in which a gate did not run reports
`pass-incomplete`; read `gates.notRun`. Use [`verify-gate`](../verify-gate/SKILL.md) to
iterate: fix only the first reported failure, no speculative batching, three attempts then stop.

### 5a — Coverage

The DoD requires a unit test for every new service method, and `AGENTS/05-test-standards.md` sets
the thresholds: **80%+ lines** on `libs/shared/nuxeo-client/src/lib/services/`, **60%+** on feature
components with business logic, **100%** on utility functions.

```bash
npx nx test <project> --coverage      # the projects you touched
npm run beta:coverage                 # the repo's coverage gate
```

Report the numbers. If your change lowered coverage on a touched project, add the missing test
rather than noting the dip — and cover the **error path**, not just the happy path.

### 5b — Hand off the wider validation

Accessibility, i18n, RTL and cross-browser checks are **not** in this skill — they live in
[`validate-fix`](../validate-fix/SKILL.md), which runs against the same workspace and evidence
folder. Run it before pushing: `a11y.yml` fires on every push to `fix/**`, so an a11y regression
you did not check locally becomes a red PR.

> **No manual-verification pause.** In YOLO mode do not stop to ask a human to click through it —
> the before/after capture already proves the fix. Write the numbered **"Steps to verify the fix"**
> into the Phase 9 summary and the Jira comment so a human can re-verify later.

## Phase 6 — Commit (signed) + raise the PR

This is the "fix and raise PR" trigger.

> **Commit + push + open the PR autonomously (no confirmation).** The Guardrails still apply.

- **Signed commits are required.** Confirm with `git log -1 --format='%G?'` → `G`.
- Conventional Commit, lowercase, present tense, Jira id, why-focused body:

  ```bash
  git add <the fix + the test + any docs the DoD names>      # only these, no churn
  # NOT the scenes file, and no other harness artifact — see Recommended extras. Stage it
  # only if no unit test can cover the behaviour, and say so in the PR.
  git commit -m "fix(NXSAT-123): <concise description>"
  git push -u origin HEAD
  ```

  Never `--no-verify`. Confirm the per-ticket proxy config and conf dir are **not** staged.

- **Self-review before you open it.** The reviewer on this repo has been right 57 times out of
  57, and 36 of those were three classes a grep cannot see. Run the floor, then work the four
  comparisons in [`pre-pr-review`](../pre-pr-review/SKILL.md) — each one holds two artifacts
  that should agree next to each other, which is the only way to see your own blind spot:

  ```bash
  npm run review:pre-pr      # exits non-zero on a mechanisable defect
  ```

- Open the PR against `main`, pushing to `origin`, **never a fork**:

  ```bash
  gh pr create --repo nuxeo/Nuxeo-Satori-UI --base main \
    --title "fix(NXSAT-123): <summary>" \
    --body "$(cat .github/PULL_REQUEST_TEMPLATE.md)"
  ```

  Fill every template section — including the acceptance criteria from Phase 1a (marked
  `[from ticket]` / `[derived]`), the approach you chose and why, and the blast-radius findings.
  Embed the before/after screenshots. Tick checklist items only once true.

- Confirm the commit is **Verified**:
  `gh api repos/nuxeo/Nuxeo-Satori-UI/commits/<sha> --jq '.commit.verification'`. `unknown_key`
  means the key is registered for authentication but not as a **Signing Key** — fix on GitHub, no
  re-push needed.

- **Publish the time metric now the PR exists.** The `fix` total is complete at this point, so
  this is the earliest moment the number is both final and pointing at something a reader can
  open. Waiting until teardown held the row behind a review loop that can run six rounds:

  ```bash
  node scripts/agent-metrics.mjs phase   "$TICKET" pr
  node scripts/agent-metrics.mjs publish "$TICKET"
  ```

  It appends one row — **user, ticket id, time to fix, longest phase before PR** — to
  [Bug Fix/Feature Development Skill Performance](https://hyland.atlassian.net/wiki/x/nQFlAAE),
  authenticating as the engineer who ran it. It is idempotent on the ticket id, so a retry after
  a network failure cannot double-count the run. Everything after this point — CI, the review
  loop, the ticket update — is measured locally and **not** published.

## Phase 7 — Poll CI to green; fix or rerun

Poll **every 60 seconds, for at most 45 minutes**, reporting a compact table whenever a check
changes state:

```bash
gh pr view <pr> --repo nuxeo/Nuxeo-Satori-UI --json statusCheckRollup \
  --jq '[.statusCheckRollup[]|{name:(.name//.context),conclusion:(.conclusion//.state)}]'
```

Terminal is `SUCCESS`/`FAILURE`/`CANCELLED`/`SKIPPED`. **Terminal is not the same as green** —
keep going until every check is `SUCCESS`, or the cap is hit. At the cap, stop polling and report
exactly which checks are still pending; do **not** claim green. This PR runs more than `ci.yml`:
`sonarcloud`, `codeql`, `a11y`, `dependency-review`, `dead-code`, `build-marketplace`.

- Real failure → `gh run view <run-id> --log-failed`, fix on the branch, re-run the gate, push.
  Each push restarts the 45-minute budget once; a third restart means stop and report.
- Known flake that passes locally → `gh run rerun <run-id> --failed`, don't "fix" it.
- **Sonar surfaces new issues even when the Quality Gate passes** — fetch them per PR
  (`GET https://sonarcloud.io/api/issues/search?componentKeys=nuxeo_agentic-ui-poc&pullRequest=<pr>&resolved=false`,
  or the SonarQube MCP) alongside Copilot inline comments; fix both.

### 7a — The review loop: run it until a round returns nothing

A single pass is not enough. Measured over five pull requests in one day: **57 reviewer
comments, every one valid, across up to seven rounds on a single PR** — and three of them were
regressions of fixes made earlier in the same loop. A reviewer that finds nothing is the only
evidence that the previous round's fixes did not introduce anything.

Delegate each round to the [`pr-review-responder`](../../agents/pr-review-responder.md)
subagent — it paginates threads, reviewer summary bodies and conversation comments, judges each
on merit, verifies, replies citing the commit and resolves — then ask for a fresh review and go
again:

A clean round is **a new review that found nothing**, so the count has to be tied to a
specific review. Counting unresolved threads on a timer cannot express that: it reads zero
while the review is still running, and it never reaches zero once a thread is deliberately
left open. Snapshot the review id, wait for a **newer** one, then count only its findings.

```bash
PR=<pr>

# 1. resolve everything outstanding (the subagent), then snapshot and request
BEFORE=$(node scripts/pr-review-analysis.mjs latest-review "$PR") || exit 1
gh api -X POST "repos/nuxeo/Nuxeo-Satori-UI/pulls/$PR/requested_reviewers" \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'   # or the GitHub MCP request_copilot_review

# 2. poll for a review newer than the snapshot, capped at 10 minutes
for _ in $(seq 30); do
  NEW_REVIEW=$(node scripts/pr-review-analysis.mjs latest-review "$PR") || exit 1
  [ "$NEW_REVIEW" != "$BEFORE" ] && break
  sleep 20
done
if [ "$NEW_REVIEW" = "$BEFORE" ]; then
  echo "no new review arrived — the round is UNKNOWN, not clean"; exit 1
fi

# 3. the verdict, in the exit code: 0 clean, 1 findings, 2 usage, 3 could-not-tell
node scripts/pr-review-analysis.mjs round "$PR" "$NEW_REVIEW"
```

`3` is a separate code on purpose. An API failure exiting `1` would be indistinguishable from
"found something" — survivable, but it would leave `0` as the only code you could trust, and
every false-clean bug in this loop's history came from an error wearing a verdict's clothes.

**An id that matches no review on the PR is also `3`, not `0`.** `round` and `harvest --review`
both narrow their output to one review, so an unmatched id filters every finding away and the
empty result is identical to the one a clean round produces — no error, no exception, just a
reassuring zero. Both commands now resolve the id first and accept either id space GitHub gives
a review: the `PRR_…` node id `latest-review` prints, or the numeric REST `databaseId` from
`gh api …/reviews`. Passing the REST id used to print a clean round on a review that had
findings.

**Why this is a script and not four `gh` calls.** Every version of this written in shell grew
the same defect, three times, in three different places: a pipeline whose producer failed
reported a reassuring zero, because the last process in a pipe owns the exit status and
`wc -l`, `tail` and `grep -c` all succeed on no input. `grep -c` also **exits 1 when the count
is zero**, so the outcome you are hoping for aborts the loop under `set -e`. Verified:
`printf 'true\n' | grep -c false` prints `0` and exits 1. In Node an API failure throws out of
`execFileSync` and the command exits non-zero, so the failure cannot be read as a clean round
without anyone having to remember `pipefail`.

Four properties are load-bearing, and every earlier version of this section got at least one
of them wrong:

- **A new review id, not a `sleep`.** Waiting a fixed two minutes and counting threads reports
  zero whenever the review takes longer than the wait — a false clean round produced by the
  reviewer being slow. No new id means the round is unknown; say so and poll again.
- **Scoped to that review.** A thread left open because you disagree belongs to an earlier
  review, and a global count keeps counting it forever, so the loop can never exit on a PR
  that has one. Same for the `github-advanced-security` threads, which are not Copilot's.
- **Threads and the body.** Copilot's summary is submitted as `COMMENTED` and folds findings
  into a **"Suppressed comments"** block that never becomes a thread — three of the five
  findings on PR #182 were there, and all three were real. A thread-only count prints `0` and
  declares a clean round while the body holds the findings.
- **One classifier for the round and the harvest.** `round` is `harvestPr` filtered to the
  review, so the number that decides the exit and the rows that get recorded cannot disagree.
  They did: the shell test counted only bold `path:line` entries while the harvest also treats
  a non-empty body with no threads as a finding, so a round could exit clean on something the
  record called a miss minutes later.

**Exit when a round produces zero new comments.** Copilot does not `APPROVE`; a clean round is
the green signal. Bound it at **six rounds** — past that, stop and report what keeps recurring,
because a PR that will not converge is usually a design the reviewer is right to keep objecting
to. On the seventh round of one spotlight PR the findings were still real, and that was the
signal the feature was too intricate for its value.

Only leave a thread open if you disagree — then reply with the reasoning, and say so in the
final summary. An open thread does not block the exit, because the count above is scoped to
the newest review.

### 7b — Record why the reviewer caught what you did not

Harvest the round and classify it. This is the point of the loop: each comment is a defect that
got past the author, and the _class_ of miss is what a pre-PR review skill has to be built from.

**`publish` writes nothing to the repository — there is nothing to stage and nothing to
commit.** The findings go to the Confluence analysis page and only there. Run it per round, as
soon as you have classified that round's comments; unlike every other step in this loop it
cannot dirty the tree, so it can also be run after the final clean round without invalidating
the verdict.

It used to write four tracked files — the findings corpus plus the regenerated
`pre-pr-review/SKILL.md` and its two mirrors — which is why this section once told you to
publish _before_ the last round and commit the output with the fix. That put four files of
review bookkeeping into the diff of every PR that took a review round. Do not reinstate it;
`review:guardrails` fails a diff that does.

```bash
# --review scopes the harvest to this round. Without it you get every finding the PR has
# ever had, with the classifications blank again, and `publish` validates before it
# deduplicates — so round two would demand you re-classify everything already published.
node scripts/pr-review-analysis.mjs harvest <pr> --review "$NEW_REVIEW"
# fill in `category` and `whyMissed` on each row — one judgement per comment
node scripts/pr-review-analysis.mjs publish ~/Desktop/agentic-ui-evidence/pr-review-analysis/<stamp>-pr<pr>.jsonl
# nothing to `git add`; push the round's fixes and run the next round
```

`harvest` reads all three places GitHub keeps reviewer feedback — inline threads, the review
summary body including its suppressed findings, and PR conversation comments — and names the
file after the invocation, not the date, so classifying one batch cannot re-publish another.

Rows land on
[PR Review analysis by Copilot](https://hyland.atlassian.net/wiki/x/lwFlAAE). `publish` refuses
a row with either field blank, because a blank in the `whyMissed` column defeats the page, and
skips rows already on the page, so a re-run cannot duplicate them.

**"Careless" is never the answer.** Name the structural reason: a claim nobody re-read after the
code changed, a guarantee asserted in prose and not in code, a check that tested a proxy for the
thing in its own name. Those three classes are the bulk of everything found so far — `npm run
review:analysis -- stats` reads the current split off the page.

## Phase 7.5 — Update the ticket with the fix

> **Update the ticket autonomously (no confirmation)** once the PR is open and CI status is known.

Post the **structured fix-summary comment** (the Phase 9 sections) via `addCommentToJiraIssue`
(cloudId above, `contentFormat:"markdown"`). Include the acceptance criteria and which were
derived, the root cause, the files changed, the PR link, the gate and coverage numbers, the
reproduce and verify steps, and the recording filenames. Keep it honest — only say a file is
"attached" once it is.

> **Write real Markdown, not Jira wiki markup.** With `contentFormat:"markdown"` use `###`,
> `**bold**`, `-`/`1.`, and triple-backtick fences. Jira wiki syntax (`h3.`, `{code}`, `*bold*`)
> renders **literally**. To correct a comment, re-send with the same `commentId` rather than
> posting a duplicate.

**Attaching evidence — MCP can't do it.** The Atlassian MCP has no attachment tool, so binaries go
through the Jira REST endpoint. Credentials live outside the repo and must never be committed:
`~/.jira_email` and `~/.jira_token` (`chmod 600`; rotate at
https://id.atlassian.com/manage-profile/security/api-tokens if leaked).

**Attach evidence, not harness output.** Images and recordings only — the things a human
looks at. `STORY.md`, `manifest.json`, `chapters.vtt` and gate reports are the harness talking
to itself; they clutter the ticket and QA does not read them. Give each file a name that says
which half it is from: two files called `02-landmark-name.png` tell a reader nothing.

```bash
cd "$EVID"
U="$(cat ~/.jira_email):$(cat ~/.jira_token)"
# --fail-with-body, not bare -s: curl exits 0 on HTTP 4xx/5xx, so a rejected upload — a
# missing permission, a size limit — still printed the filename as if it had landed.
upload() {
  if curl -sS --fail-with-body -u "$U" -H "X-Atlassian-Token: no-check" \
       -F "file=@$1;filename=$2" \
       "https://hyland.atlassian.net/rest/api/3/issue/$TICKET/attachments" >/dev/null; then
    echo "  ok   $2"
  else
    echo "  FAIL $2" >&2; return 1
  fi
}
upload contact-sheet.png            "$TICKET-before-after.png"
upload before/$TICKET-before.webm   "$TICKET-before.webm"
upload after/$TICKET-after.webm     "$TICKET-after.webm"
# plus the diptych and any callout that carries the point, each renamed the same way
for half in before after; do
  for f in "$half"/*.png; do upload "$f" "$TICKET-$half-$(basename "${f%.png}" | sed 's/^[0-9]*-//').png"; done
done
```

Then confirm what actually landed, rather than assuming the uploads worked:

```bash
curl -s -u "$U" "https://hyland.atlassian.net/rest/api/3/issue/$TICKET?fields=attachment" \
  | python3 -c "import sys,json;[print(' ',a['filename']) for a in json.load(sys.stdin)['fields']['attachment']]"
```

If `~/.jira_token` is absent, have the user create it (`printf '%s' '<token>' > ~/.jira_token &&
chmod 600 ~/.jira_token`) rather than pasting it into chat. Drag-and-drop is the manual fallback.

### Link the PR on the ticket

A PR URL buried in a comment is not a link — the ticket's **Links** panel is where a reviewer,
QA or a release manager looks for it, and where Jira can show its status. Add it as a remote
link, not just prose:

`--fail-with-body` for the same reason as the uploads: bare `-s` exits 0 on HTTP 4xx/5xx, so
a rejected request would leave the Links panel empty while the run carried on believing the
link existed — and the Definition of Done checks for it.

```bash
curl -sS --fail-with-body -u "$U" -H "Content-Type: application/json" -X POST \
  "https://hyland.atlassian.net/rest/api/3/issue/$TICKET/remotelink" \
  -d "{\"globalId\":\"github-pr-<N>\",
       \"application\":{\"type\":\"com.github\",\"name\":\"GitHub\"},
       \"relationship\":\"fixed by\",
       \"object\":{\"url\":\"https://github.com/nuxeo/Nuxeo-Satori-UI/pull/<N>\",
                  \"title\":\"PR #<N> — <commit subject>\"}}"
```

`globalId` makes it idempotent: re-running updates the existing link instead of adding a
duplicate. The Atlassian MCP can read remote links (`getJiraIssueRemoteIssueLinks`) but cannot
create them, so this goes through REST like the attachments.

## Phase 8 — Definition of Done self-check

Evaluate AGENTS.md §7 and report it **in chat only** — this repo has no Ready-for-QA Confluence
checklist, so do not post this table to Jira. Produce a table (Item | Y/N/NA | Evidence):

full `beta:gate` green with `verdict: "pass"` and nothing in `skipped`/`notRequested`; coverage
thresholds met on touched projects; unit test for every new service method including its error
path; `validate-fix` run and clean; `docs/api-integrations.md` updated if a new Nuxeo endpoint was
called; `docs/ai-features.md` if AI behaviour changed; `AGENTS/01-services.md` if a service method
was added; `AGENTS/00-architecture.md` if architecture changed; PR on a `fix/*` branch; every
review thread replied to, and every accepted finding resolved — a thread may stay open only
where you disagree, and then only with the reasoning and the evidence in the reply and the
disagreement named in the final summary; the review loop run until a round returned zero
comments; the round harvested, classified and published to the PR review analysis page; the PR
added to the ticket's Links panel as a remote
link; before/after evidence in both forms attached to the ticket, images and recordings only,
each named for the half it came from; no harness artifact **attached**, and none **committed**
except a scenes file justified in the PR because no unit test could cover the behaviour;
all checks `SUCCESS`; all commits Verified. Quote the gate verdict line rather than asserting it.

## Phase 9 — Final fix summary (always output)

End every run with one structured summary — printed in chat **and** posted to Jira (Phase 7.5).
Use exactly these sections, in this order:

1. **Issue** — the user-visible symptom and impact (1–2 sentences), with the ticket link.
2. **Acceptance criteria** — the numbered list from Phase 1a, each marked `[from ticket]` or
   `[derived]`, and how each was verified.
3. **Root cause** — what actually causes it (file / function / code path and why).
4. **Fix provided** — the approach chosen, the alternatives rejected and why, the files touched,
   and the PR link.
5. **Steps to reproduce the issue** — numbered and copy-pasteable. **Explicitly call out any
   environment setup required** — the Nuxeo image digest, KD/ingestion config, seed data created
   via REST/Automation, a document UID. If none, say "no environment changes required".
6. **Steps to verify the fix** — numbered: how to build and run the branch, the exact URL/screen,
   the actions, and the expected result vs the old behaviour.
7. **Areas that may be affected (impact / regression surface)** — the Phase 4.5 findings, so QA
   knows where to focus. Cover: other consumers of the touched code (searched, not assumed);
   adjacent behaviours in the same component and which you exercised; edge cases and scale (empty
   / 1-item / large sets, paging, special characters, permission variants, and anything
   deliberately out of scope); cross-cutting concerns (i18n, accessibility, theming, bundle size,
   the extension-manifest contract, the adf-hx bridge boundary); and **explicitly what was NOT
   affected**, listed only once actually checked.
8. **Verification numbers** — gate verdict, test pass count, coverage on touched projects,
   `validate-fix` result, CI state.
9. **Time** — the per-phase table from `agent-metrics report`, the longest phase before the PR, and total wall
   clock against the budget above. State cost as **not measured**, with the recorded join window;
   never estimate it.

Reference the evidence in both forms: `$EVID/before/` (`*.png` + `<TICKET>-before.webm`) and
`$EVID/after/` (`*.png` + `<TICKET>-after.webm`).

## Phase 10 — Clean up & report

**Close the metrics first, then tear down.** The row was already published in Phase 6; what is
left is the `end` mark and the local per-phase table. The teardown removes the worktree you are
standing in _and_ the copy of `scripts/agent-metrics.mjs` inside it, so running `end` afterwards
fails on a deleted directory:

```bash
node scripts/agent-metrics.mjs end "$TICKET" --outcome pr-open   # prints the per-phase table
cd "$REPO_ROOT"     # leave the worktree before deleting it
bash .cursor/skills/fix-bug/scripts/new-ticket-workspace.sh "$TICKET" --remove
```

**Record the outcome you actually observed.** This workflow opens and validates a PR; it does
not merge one. Use `pr-open` when you finish with the PR open, `merged` only if you watched it
merge, `blocked` if a stop condition ended the run, and `abandoned` if the work was dropped.
Publishing `merged` by default would make every row claim a delivery that had not happened.

The teardown removes the worktree — and the container and its indices too, if the ticket had its
own — and **keeps the evidence**. It refuses to delete uncommitted work unless you add `--force`,
and checks that before destroying anything. The shared `nuxeo` container and the ticket's Nuxeo
data root are left in place: the data root is cheap, and deleting it would destroy a repro
someone may still need. Then:

- Stop the dev server you started. Kill only PIDs you started — never `pkill -f node`.
- Never remove or disturb the shared `nuxeo` / `nuxeo-opensearch` containers, the `nuxeo-net`
  network, or another ticket's workspace.
- Leave the evidence in `$EVID` — it is the one thing that outlives the run. Never commit it.
- Report the PR's final CI state. If a long check (`codeql`, `sonarcloud`, `a11y`,
  `build-marketplace`) is still running, say so explicitly — do **not** claim green until it is.
- `publish` (run back in **Phase 6**, when the PR was opened) appended one row — **user, ticket
  id, time to fix, longest phase before PR** — to
  [Bug Fix/Feature Development Skill Performance](https://hyland.atlassian.net/wiki/x/nQFlAAE),
  authenticating as the engineer who ran it. **Time to fix is the `fix` bucket alone** — evidence
  capture, the review loop and all overhead are excluded, so the row answers how long the work
  took rather than how slow the pipeline is. The per-phase breakdown and the other three
  subtotals are **not** published; they stay in the local `metrics.jsonl`. Print that table in
  the final summary — `report` also names the longest phase before the PR, which is the column
  on the page and the one worth attacking next.

## Recommended extras (do these when applicable, still autonomously)

- **Commit product code only.** A pull request contains the fix, its tests, and the docs the
  Definition of Done names. It does **not** contain harness artifacts: `manifest.json`,
  `STORY.md`, `chapters.vtt`, screenshots, recordings or gate reports — those live in the
  evidence folder outside the repo and go on the ticket.

  The one exception is a **scenes file**, and only when no unit test can cover the behaviour —
  a visual regression, a cross-component interaction, something only a rendered browser can
  assert. Say so in the PR when you stage one.

  The rule used to be "always commit the scenes file, so the fix is re-verifiable later". That is
  what the regression test is for, and unlike a scenes file the test **runs in CI on every PR**.
  Nothing runs the scenes files: no workflow references `collect-evidence`, so a committed one is
  code that never executes and rots silently as selectors drift. Twenty-four had accumulated that
  way. On NXENG-915 the scenes file was 142 lines of a 168-line pull request whose actual fix was
  one line, which puts a reviewer's attention in the wrong place.

- **Update the docs the DoD names** in the same PR rather than a follow-up.
- **Attach the videos.** MCP can't attach — use the Phase 7.5 `curl`.
- **Add the bug to `AGENTS/08-bug-patterns.md`** if the root cause is a pattern likely to recur.

## Guardrails (these still hold in YOLO mode)

- Never commit to `main`; never force-push `main`; feature branches only (`--force-with-lease`).
- Never `--no-verify`. Never weaken, skip or `.only` a test to get green.
- Never commit secrets, `.env`, `node_modules`, evidence output, the per-ticket proxy config, or
  the copied `nuxeo-conf`. Never print the `NUXEO_CLID` or a Jira token.
- Never disturb the shared `nuxeo` containers, and never kill processes by a pattern that could
  match another agent's run.
- Never `git stash`, and never git-write in the primary checkout.
- Never run a bare `npm install` and commit the resulting lockfile.
- Never edit git config silently beyond the one-time signing setup.
- Keep the PR scoped to the single fix — never bundle unrelated files.
- Never claim a fix works from reasoning alone: the after-capture and the gate verdict are the
  only acceptable proof.
- YOLO relaxes _confirmation gates only_. It does not authorize destructive git operations,
  force-pushes to protected branches, committing secrets, or choosing past a Phase 3.5 stop
  condition.
