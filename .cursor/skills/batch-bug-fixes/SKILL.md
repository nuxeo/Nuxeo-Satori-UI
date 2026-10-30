---
name: batch-bug-fixes
description: >-
  Run many Nuxeo-Satori-UI bug fixes at once — one subagent per ticket, each in its own isolated
  workspace — by invoking the single-ticket fix-bug skill unchanged inside each of them. Resolves
  the batch from a Jira JQL/epic (parent = <EPIC>) or an explicit ticket list, plans capacity into
  waves that fit the machine, creates each workspace serially so git and the port allocator are
  never contended, launches the fixes in parallel, isolates failures so one bad ticket cannot end
  the batch, then reports per-ticket outcome and PR links. Use when asked to "fix all children of
  <epic>", "fix these 12 tickets", "run multiple bug fixes at once", "one agent per ticket", or to
  plan capacity for a batch of NXSAT-/NCO-/NXENG- tickets.
---

# Batch bug fixes

> **This skill is a wrapper. [`fix-bug`](../fix-bug/SKILL.md) is the function.**
>
> Read `fix-bug` if you have not. This file never restates its phases, never overrides one, and
> never asks a subagent to do a step differently. It resolves a list of tickets, decides how
> many can safely run at once, hands each to its own subagent, and collects what came back.
>
> **Do not edit `fix-bug/SKILL.md` for a batch run.** If a batch needs the single-ticket
> playbook to behave differently, the batch is wrong, not the playbook. The one thing a batch
> legitimately changes is _how many run at once_, and that lives here.

## Why a wrapper and not a bigger skill

A second copy of the fix playbook would drift from the first within a month, and the half that
was wrong would be the half nobody was reading. Every phase — the evidence story, the gate, the
review loop, the Jira write-back, the metrics — is identical whether one ticket is in flight or
twelve. The only thing that changes at twelve is **contention**, and contention is an
orchestration concern.

## What makes twelve tickets safe

Each ticket gets its own worktree, branch, dev-server port, proxy config, Nuxeo data root,
evidence directory and metrics log. That isolation is `new-ticket-workspace.sh`'s job and it
already existed for one ticket at a time. Three things do **not** isolate themselves, and this
skill exists mostly to handle them.

| Resource                                 | Status at N&nbsp;>&nbsp;10                  | How this skill handles it                   |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Worktree, branch, proxy, data root       | Isolated per ticket already                 | Nothing to do                               |
| Dev-server port                          | Isolated **only since the reservation fix** | See below — this was a real collision       |
| `node_modules`                           | Shared hardlinks, read-only                 | Never `npm install` in a workspace          |
| Shared Nuxeo container + OpenSearch      | Shared, per-ticket data root is the isolate | Keep the default; do not run N containers   |
| `git` object store, index, worktree list | Contended during **creation**               | Create workspaces **serially**              |
| `git stash` stack                        | Shared across every worktree                | `fix-bug` already bans it; never relax that |
| PR review findings record                | Confluence page; PUTs race on `version + 1` | No tracked file, but publish **serially**   |
| GitHub review requests                   | Rate-limited, and Copilot queues            | Stagger; never request N reviews at once    |

### The port collision, because it is the one that bit

`new-ticket-workspace.sh` used to pick a port by skipping whatever was **listening**. That is
true of a workspace in use and false of one merely created, so creating a batch before starting
any dev server assigned **every ticket port 4210** — deterministic, not a race. Measured on
twelve: one distinct port.

The loud symptom is the second `nx serve` failing to bind. The quiet one is worse: with a server
up on 4210, every other ticket's evidence commands point at it and capture **a different
ticket's app under their own ticket id**. Evidence attributed to the wrong fix is worse than no
evidence, because it is believed.

Ports are now reserved under `$WORKTREE_ROOT/.ports`, claimed under a lock, reclaimed when the
owning run is gone — **dead pid and no worktree**, not either alone — and released by
`--remove`. Both halves matter to a batch: ports are reserved before `git worktree add`, so
during creation a reservation names a directory that does not exist yet, and liveness judged
on the directory alone let the next creation reclaim it and hand out the same number. Guarded
by a self-test:

```bash
bash .cursor/skills/fix-bug/scripts/port-reservation.selftest.sh   # 11 checks
```

Run it if you touch the allocator. Its first assertion is what makes it worth having: fed the
old algorithm, twelve workspaces produce **one** distinct port, so the check discriminates
rather than merely passing. Run against a script that has no reservation functions at all it
refuses to run, by design — a test that silently exercises nothing is the failure mode being
avoided.

## Phase B0 — Resolve the batch

Either form is accepted.

**From Jira** — an epic's children, or any JQL. Use the Atlassian MCP:

```
parent = NXSAT-900 AND statusCategory != Done ORDER BY priority DESC
```

**From a list** — exactly as given, deduplicated. A ticket appearing twice would put two agents
on one worktree, branch and port, and the second would inherit the first's half-finished state
rather than fail cleanly; the planner rejects it.

Print the resolved list with each ticket's summary and priority **before** planning, so a
mis-typed JQL is caught while it costs nothing.

## Phase B1 — Plan capacity

```bash
node .cursor/skills/batch-bug-fixes/scripts/plan-batch.mjs <TICKET…> [--concurrency N]
```

It refuses the batch — exit 1 — when a prerequisite would fail every workspace anyway: wrong
Node major, Playwright missing from the primary checkout, credentials unexported, shared Nuxeo
down, `gh` unauthenticated, or too few free ports for one wave. It warns, without blocking, when
`package-lock.json` is dirty (no hardlinking, so `npm ci` per ticket — the dominant cost of a
large batch) or `origin` is an hour stale.

Concurrency is auto-derived from CPU and RAM and capped at 8. **The per-ticket memory figure is
an estimate, not a measurement**, and the planner says so in its own output; measure it on your
hardware and pass `--per-ticket-gb` if you care. Do not raise `--concurrency` past the auto
figure to go faster — a swapping machine fails the runs that are already mid-fix, and those are
the expensive ones to lose.

**Stop and report if the plan blocks.** Do not create workspaces anyway.

## Phase B2 — Create wave workspaces, serially

```bash
for T in <wave tickets>; do
  bash .cursor/skills/fix-bug/scripts/new-ticket-workspace.sh "$T"
done
```

**Serially, and before any subagent starts.** Concurrent `git worktree add` contends on the
index and the worktree list in one shared object store, and the port lock serialises allocation
anyway — so parallel creation buys nothing and risks a half-made workspace. Creation is seconds
per ticket when `node_modules` hardlinks.

Then confirm the thing that used to be broken, because it is cheap and it is the whole premise:

```bash
for T in <wave tickets>; do
  printf '%s -> %s\n' "$T" "$(sed -n 's/^export NX_APP_PORT="\([0-9]*\)".*/\1/p' \
    "$HOME/Desktop/Projects/agentic-ui-worktrees/$T/env.sh")"
done | sort -k3 | awk '{print} {p[$3]++} END{for(k in p) if(p[k]>1) {print "COLLISION on port " k; exit 1}}'
```

If two tickets share a port, **stop the wave**. Do not start the agents and hope.

## Phase B3 — One subagent per ticket

One `Task` per ticket, launched in the background, all of a wave together. Each subagent runs
`fix-bug` end to end, autonomously, exactly as if it were the only ticket. Give it the ticket,
its workspace, and nothing else to decide:

```
Follow .cursor/skills/fix-bug/SKILL.md end to end, autonomously, for <TICKET>.

Your workspace already exists — do not create or remove one:
  worktree   ~/Desktop/Projects/agentic-ui-worktrees/<TICKET>
  env        source that worktree's env.sh before anything else; it sets NX_APP_PORT,
             NX_PROXY and NX_WT
  nuxeo      the shared container, data root /default-domain/workspaces/<TICKET>

Run every command from $NX_WT. Use only your own dev-server port. Do not touch another
ticket's worktree, branch, port or data root. Never `git stash` — the stack is shared with
every other agent in this batch. Never `npm install` — node_modules is hardlinked.

Do not run `pr-review-analysis publish`; the batch owns that. Everything else in fix-bug
applies unchanged, including the gate, the review loop to a zero round, the Jira write-back
and `agent-metrics`.

Report back: outcome (pr-open | blocked | abandoned), PR number and URL, the gate verdict,
what you changed at the root cause, and anything you deliberately left open.
```

Three rules for the wrapper while a wave runs:

- **Never hand a subagent a phase to skip.** A batch that cuts the gate or the evidence is a
  batch of unverified fixes, which is worse than fewer fixes.
- **Failures are isolated.** A ticket that blocks or fails is recorded and the wave continues.
  Only a shared-resource failure — Nuxeo down, disk full, `origin` unreachable — stops the batch,
  because that one will fail every remaining ticket identically.
- **Do not poll the agents in a tight loop.** Each ticket's own CI polling is already bounded by
  `fix-bug`; wrapping that in a second busy loop just burns context.

## Phase B4 — Close the wave, then the next

When every subagent in a wave has returned, tear down only the workspaces whose tickets
finished, then create the next wave's. Teardown releases the port reservation, which is what
keeps a long batch inside the 4210+ range:

```bash
bash .cursor/skills/fix-bug/scripts/new-ticket-workspace.sh "$T" --remove
```

`--remove` refuses to discard uncommitted work without `--force`. **Do not reach for `--force`
to tidy up a batch** — uncommitted work in a finished ticket's worktree means that ticket did
not finish, whatever it reported. Read it first.

## Phase B5 — Serial tail: publishing the review findings

Still serial, but no longer for the reason it used to be. Subagents do not publish; do it here,
once, after the batch:

```bash
node scripts/pr-review-analysis.mjs harvest <pr> …            # per PR that drew comments
node scripts/pr-review-analysis.mjs publish <file.jsonl>      # once, serially
```

### Why serial, and why there is no branch any more

`publish` writes **no tracked file** — the findings go to the Confluence analysis page and
nowhere else. So there is nothing to stage, nothing to commit, and no batch-corpus branch: this
phase can run from any checkout, including a ticket worktree, and it cannot dirty one.

It is serial because the page is updated with an optimistic version number: each PUT sends
`version + 1` read at the start of the call, so two concurrent publishes race and one is
rejected. One at a time, and re-running a file is safe — rows already on the page are skipped
on their finding identity.

This phase used to open a `docs/review-corpus-<batch-id>` branch and a pull request of its own,
because `publish` wrote the corpus plus the pre-PR skill and its two mirrors, and those changes
could not be pushed onto a ticket PR that had already earned a clean review round. That whole
problem is gone with the files.

## Phase B6 — Report the batch

Per ticket: outcome, PR link, gate verdict, one line on the root cause, and anything left open.
Then the totals, and — the part worth reading — **what recurred**. Several tickets fixed at the
same layer, or the same reviewer class raised across several PRs, is a finding about the codebase
that no single ticket's report can show. That is the argument for batching at all.

Report per-ticket time from each run's own `agent-metrics` output. **Do not add them up into a
batch duration.** Concurrent work does not sum, and a total would read as effort spent when it
is mostly overlap.

## Guardrails

`fix-bug`'s guardrails hold inside every subagent, unchanged. These are the wrapper's own:

- **Never edit `fix-bug/SKILL.md` to make a batch work.** Fix the orchestration instead.
- **Never run two agents on one ticket.** The planner rejects duplicates; do not work around it.
- **Never create workspaces concurrently.** Serial creation, parallel work.
- **Never raise `--concurrency` past the plan to hit a deadline.** Swapping loses in-flight fixes.
- **Never `--nuxeo own` across a large batch.** A container is ~2 GB; twelve is the machine.
- **Never let a subagent publish the findings record.** Serial tail, in the wrapper: concurrent
  PUTs race on the page's optimistic `version + 1`. There is no corpus branch to publish on —
  `publish` writes no tracked file, so nothing can land on a ticket PR either way.
- **Stop the whole batch** only for a shared-resource failure. Everything else is per-ticket.
- **Report a ticket's real outcome.** `pr-open` is not `merged`, and a blocked ticket in a batch
  of twelve is easy to lose in a summary that leads with eleven successes.
