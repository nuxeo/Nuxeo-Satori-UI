# Acceptance tests: the protocol

The [development plan](development-plan.md) closes four phases on a person doing something in a
set time. This page is how a facilitator runs each of those tests with a participant, measures it,
and decides it, so that the people who must run them can start.

| Test | Phase | The plan's "Done when"                                                                                                         | Time   | Steps file                                                                                         |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------- |
| A    | 1     | "a presales engineer rebuilds the Member page from an empty package in one day or less"                                        | 1 day  | `acceptance-payers`, `ACCEPTANCE_SCOPE=member`                                                     |
| B    | 2     | "rebuilds the Member, Claim and Case screens with no Angular code in two days or less, and a prospect would accept the result" | 2 days | `acceptance-payers`, `ACCEPTANCE_SCOPE=screens`, and the review form                               |
| C    | 3     | "someone outside the team builds a small app with the agent in a day, following the tutorial"                                  | 1 day  | None: the pipeline and a checklist ([section 5](#5-test-c-an-app-with-the-agent-in-a-day-phase-3)) |
| D    | 5     | "a presales engineer rebuilds the product and asset pages in two days or less"                                                 | 2 days | `acceptance-brand-assets`                                                                          |

The [plan](plan.md) defines the first: "a presales engineer rebuilds the Payers Member, Claim and
Case screens with no Angular code, in two days or less, and a prospect would accept the result"
(section 4), and proposes the second, one "that is not Payers and starts from files" (section 13).
Its section 7 asks for the tutorial "tested by someone outside the team".

**Status, 25 November 2026: no test has run.** No participant has been found, the
[demo server](../../business-apps/demo-server/README.md) has never been started, and the two steps
files have never run against a server: they were checked for syntax, by the harness's assertion
audit, and by their shared checks' offline controls ([section 7](#7-the-steps-files)). Test C also
waits for Claude seats approved under Hyland's AI use requirements (phase 3, "Needs").

## 1. Rules for every test

### Who is in the room

- **The facilitator** prepares the server and the checkout, gives the brief, keeps the clock and the
  log, answers questions by the rules below, and runs the checks at the end. Someone from the team.
- **The participant** does the task. Each test's section says who qualifies. Never a member of the
  squads ([development plan](development-plan.md), section 2), and never someone who has read the
  reference kit's files.
- **An observer**, optional, takes the log while the facilitator answers.
- **The product owner** reads the result. The plan's "Done means" names the product owner and the
  presales lead as the people who accept a phase's demo.

### What the participant may use

- **May:** the docs in [`docs/business-apps/`](README.md), [`docs/extension-reference.md`](../extension-reference.md),
  the app builder skill ([`.cursor/skills/app-builder/SKILL.md`](../../.cursor/skills/app-builder/SKILL.md)),
  the generators in [`tools/satori-generators`](../../tools/satori-generators), the package
  pipeline (`npm run app-package`), `npm run config:dev`, the Builder MCP server
  ([`tools/builder-mcp`](../../tools/builder-mcp/README.md)) and an agent that follows the skill, a
  text editor, a browser, the [clickable prototype](https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/),
  and the other kits under `business-apps/packages/` as worked examples, except the one the test
  rebuilds. An agent only with a seat approved under Hyland's AI use requirements, against a server
  holding fictional data only.
- **May not:** write Angular, TypeScript or any other code, or change anything outside their own
  package. Read the reference answer in any form: the reference kit's folder, its steps files under
  `scripts/beta-harness/steps/`, the acceptance steps files, its served configuration on the server
  (`/nuxeo/agentic-ui-config/` and `/nuxeo/agentic-ui-apps/`, through a browser's developer tools or
  otherwise), its files in git's history, and for tests A and B,
  [layout-v2.md](layout-v2.md)'s section 9, which is the reference Member page word for word.
  Anything else that holds the reference kit's files, in whole or in part, is out of bounds too:
  specs and selftests quote some of them. A participant who comes across one says so, and the
  facilitator logs it. **The docs' own examples stay allowed:** they use the Payers kit throughout,
  such as [app-definition-v2.md](app-definition-v2.md)'s queue in section 4 and
  [layout-v2.md](layout-v2.md)'s claims card in section 12, and every reader gets them. Section 9 alone
  is out, being the whole page.
- **The agent is held to the same rules.** Before its first prompt, the participant tells it: "Do not
  read `business-apps/packages/<the reference kit>`, the steps files under
  `scripts/beta-harness/steps/`, git's history of either, or anything outside this checkout." The
  last is the facilitator's own checkout beside it, which holds the reference kits throughout
  ([section 2](#two-checkouts-two-dev-servers)). The skill names the Payers kit as its worked
  example, so for tests A and B the agent will look for it. The facilitator reads the transcript
  afterwards for any read of the reference, by any tool.

**A read of the reference answer voids the test.** The result is then a copy, not a rebuild: the
log says what was read, when, and whether by the person or the agent.

### Keeping the reference out of reach

- **Out of the checkout.** At the start of the session, in the participant's checkout, the
  facilitator removes the reference kit, as the [tutorial](tutorial.md) does for its own. Git keeps
  it, and the checks at the end put it back:

  ```bash
  rm -r business-apps/packages/payers-claims-demo
  ```

  For test D, `business-apps/packages/brand-assets-demo`; for test C, the tutorial's own step does it.

- **Not on screen.** The expected result is the reference kit's pages, as pictures: the control run's
  screenshots (below), the prototype, and the target sheet in the test's section. Never its files,
  never the control run's `INDEX.md` or `manifest.json`, which name its cards, and never the Payers
  demo's `member-layout-file` screenshot, which shows the layout file.
- **The installed app shows the reference.** On a server with the kit installed, the app at
  `/nuxeo/agentic-ui/` draws the reference kit's pages, and the app registry serves its home, menu,
  queues and labels to the kit's groups. Under the dev server, a file the participant serves with
  `config:dev` wins over the registry's, and a file they do not serve comes from the registry
  ([`app-registry.service.ts`](../../libs/shared/app-registry/src/lib/app-registry.service.ts)): signed in
  as a Payers demo user, the participant sees the reference kit's home and queues until they serve
  their own. Layouts come from `config:dev` alone. Looking at those pages is allowed; reading the
  files behind them is not.

### Help, and how it is counted

The participant may ask anything, at any time. The facilitator answers, and logs the question and
the answer, word for word where they can, at one of four levels:

| Level | What the answer is                                                                                    | Counts                                            |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0     | The environment: the server is down, a password, a port, a dev server to restart                      | Logged, not counted; the time lost is noted       |
| 1     | A pointer: "layout-v2.md, section 7", "the pipeline's finding names the place"                        | Counted                                           |
| 2     | How: which generator, which option, which widget or rule, what a file must say                        | Counted, and each one is a gap in the docs to fix |
| 3     | The facilitator writes, dictates or pastes a file, a value or a command the participant did not reach | Fails the test                                    |

An error message, a pipeline finding or an agent's answer is not help: it is the product. Each level 2
answer becomes an item for the docs or the tools, as the tutorial's feedback section lists its own.

### Measuring

- **Wall time, breaks included.** The clock starts when the participant is given the brief, with the
  prepared environment in front of them, and stops when they say they are done and the facilitator
  has run the checks once, or at the time limit. Lunch, coffee and a meeting in the middle all count.
  **A day is 8 hours by the clock**, in one sitting on one working day. A two-day test runs on two
  consecutive working days, 8 hours each, and the clock stops between them. A participant who goes
  past the limit may finish: the log records the total, and the test fails on time.
- **Where they got stuck.** An entry each time the participant says they are stuck, or makes no
  progress for 10 minutes by the facilitator's judgement: the clock time, what they were trying,
  what they tried, how they got past it (a doc, a finding, an agent's answer, help) and the minutes
  lost.
- **Every request for help,** as above, with its level.
- **The pipeline's findings over time.** By hand, the participant runs the pipeline through the
  function below, which is the tutorial's command with a timestamp and the exit code appended to the
  session's log. With the agent, each write tool's answer is a pipeline run: the transcript holds
  them, and the facilitator counts the answers with `written: false`, their findings' `kind` and
  the step that refused.

  ```bash
  pipeline() {
    { date -u +%FT%TZ; npm run app-package -- "$ACCEPTANCE_PACKAGE" --platform "$PLATFORM" --model "$MODEL"; echo "exit $?"; } 2>&1 | tee -a "$SESSION/pipeline.log"
  }
  ```

  `PLATFORM` is `node -p "require('./libs/platform/package.json').version"`, 0.2.0 today.
  `MODEL` is the server's content model, which the participant exports themselves
  ([tutorial](tutorial.md), step 1; [package-pipeline.md](package-pipeline.md), section 4).

### The verdict

- **Pass:** every item of the test's target sheet holds, checked as its section says; the time is
  within the limit; no level 3 help; nothing of the reference answer read. For test B, the review's
  verdict as well ([section 4](#4-test-b-member-claim-and-case-in-two-days-phase-2)).
- **Fail:** any of those not met. The log says which, and the participant is told.
- **Void:** the environment failed in a way that cost the participant more than 30 minutes, which
  the control run should have found, or the reference answer was read. A void test is run again,
  with another participant if the reference was read.
- **The counts beside the verdict,** always: the time, the level 1 and level 2 answers, the stuck
  episodes and the minutes they cost, the pipeline runs and how many refused. A pass with three
  level 2 answers is a pass the docs owe three fixes to.
- **One participant decides the test,** as the plan's words say "a presales engineer". When the first
  one needed level 2 help, run it once more with a second participant after the docs are fixed.

### Before every session: the control run

A participant's failure must never be the server's. The day before, and again on the morning of each
session day, the facilitator runs two things from **their own checkout**, never the participant's,
against **their own dev server**, on port 4301, beside the participant's on 4300 (the two checkouts
are [section 2](#2-preparing-a-server-for-tests-a-b-and-d)'s):

1. **The reference kit's own demo steps files,** which must pass: `payers-claims-demo` for tests A and
   B, and `payers-appeals` for test B, which opens the Case page; `brand-assets-demo` for test D (each
   kit's README, "Running the demo"), with the kit's files served by its README's `config:dev`
   command, "Seeing it under `nx serve`", and `APP_URL=http://localhost:4301`. For test C, the
   tutorial's step 1 commands, which must find no `WorkOrder`. The Payers demo has not run whole in its current form (its README, "Changed since
   that run"): a failure there is investigated before anything else.
2. **The acceptance steps file against a copy of the reference kit's app definition,** serving only
   the files the target needs, and each queue its menu names, as a participant's package would: no
   home, so that a package with none is seen to pass. It must fail exactly one check, "the
   participant's layouts are their own", and pass every other: the steps file seen failing on
   purpose on the one thing a copy must fail, and passing on everything a correct package must pass.
   Its screenshots are the pictures the participant is given.

The facilitator's dev server, started once, after `config:dev` has made its folder:

```bash
npm run config:dev
```

```bash
NUXEO_PROXY_TARGET=http://127.0.0.1:18080 npx ng serve nuxeo-ui --configuration=development,remote --port 4301
```

**Tests A and B,** the copy, cut down to what a package for them holds, which is what it serves; then
each scope:

```bash
mkdir -p business-apps/packages/acceptance-control/bundle && cp -R business-apps/packages/payers-claims-demo/bundle/agentic-ui-config business-apps/packages/acceptance-control/bundle/
```

```bash
rm -r business-apps/packages/acceptance-control/bundle/agentic-ui-config/{home.json,actions.json,tasks,layouts/Provider}
```

```bash
C=business-apps/packages/acceptance-control/bundle/agentic-ui-config && npm run config:dev -- --layout Member/view=$C/layouts/Member/view.layout.json --layout Member/metadata=$C/layouts/Member/metadata.layout.json --layout Claim/view=$C/layouts/Claim/view.layout.json --layout Case/view=$C/layouts/Case/view.layout.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/unassigned-claims.json --queue $C/queues/my-claims.json --queue $C/queues/pending-determination.json
```

```bash
ACCEPTANCE_SCOPE=member ACCEPTANCE_PACKAGE=business-apps/packages/acceptance-control ACCEPTANCE_BASE=HEAD APP_URL=http://localhost:4301 NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- acceptance-payers
```

```bash
ACCEPTANCE_SCOPE=screens ACCEPTANCE_QUEUE=my-claims ACCEPTANCE_PACKAGE=business-apps/packages/acceptance-control ACCEPTANCE_BASE=HEAD APP_URL=http://localhost:4301 NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- acceptance-payers
```

**Test D,** the same with the brand assets kit's files:

```bash
mkdir -p business-apps/packages/acceptance-control/bundle && cp -R business-apps/packages/brand-assets-demo/bundle/agentic-ui-config business-apps/packages/acceptance-control/bundle/
```

```bash
rm -r business-apps/packages/acceptance-control/bundle/agentic-ui-config/layouts/AcmeShot
```

```bash
C=business-apps/packages/acceptance-control/bundle/agentic-ui-config && npm run config:dev -- --layout AcmeAsset/view=$C/layouts/AcmeAsset/view.layout.json --layout AcmeProduct/view=$C/layouts/AcmeProduct/view.layout.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/library.json --queue $C/queues/products.json
```

```bash
ACCEPTANCE_QUEUE=library ACCEPTANCE_PACKAGE=business-apps/packages/acceptance-control ACCEPTANCE_BASE=HEAD APP_URL=http://localhost:4301 NUXEO_USER=Administrator NUXEO_PASS="$DEMO_SERVER_ADMIN_PASSWORD" npm run beta:evidence -- acceptance-brand-assets
```

Then remove the copy, serve the platform's defaults again, check that the checkout is clean, and
stop the facilitator's dev server: until it is stopped, it serves whatever `config:dev` last wrote
in that checkout.

```bash
rm -r business-apps/packages/acceptance-control && npm run config:dev && git status --short
```

If a run does anything else, do not start the session: fix the server, or the steps file, and say
so in the log. Exit 2, on the control or later, names what it refused: the environment, or what
the facilitator must name, such as the package, the session's commit, or the queue when the
package has several. A file the target needs and the package lacks, a queue without a facet, or a
facet that cannot narrow, is the participant's, and fails its item with exit 1.

### Recording

Everything goes in one folder per session, outside the repository, as every evidence of this
programme does:

```text
~/Desktop/agentic-ui-evidence/business-apps/acceptance/<test>-<YYYY-MM-DD>-<participant code>/
```

| File           | What it holds                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.md`   | The log, from the template in [section 9](#9-the-session-log): the commit, the server, the clock, every stuck episode and every answer, and the verdict with its counts                   |
| `pipeline.log` | The pipeline's runs, from the function above                                                                                                                                              |
| `package/`     | A copy of the participant's package, without `dist/`: `rsync -a --exclude dist business-apps/packages/<package>/ "$SESSION/package/"`                                                     |
| `checkout.txt` | `git status --short` and `git diff --stat <the session's commit>`, at the end, before the reference kit is put back                                                                       |
| `transcript/`  | The agent's transcript, when there was one, read first for anything below that must not be kept                                                                                           |
| `steps.md`     | Each steps file run: its command without the passwords, its verdict, its counts, and the path of its evidence folder, which the runner writes under `~/Desktop/agentic-ui-evidence/beta/` |
| `review.md`    | Test B: the prospect's review form ([section 4](#the-prospects-review))                                                                                                                   |

**The participant code** is a letter and a number, such as `A1`, that the facilitator keeps against
the person's name in their own notes, never in this folder or the repository.

**What is never recorded,** in the folder, the repository or a pull request:

- a person's name, email address, employer or account; a prospect's company or any account's name,
  since the repository is public and its rules keep the accounts' names out of it
  ([README](README.md), "Rules that hold");
- a password, a token, the Connect registration or anything else secret: the demo passwords, the
  administrator's, `SATORI_GH_READONLY_TOKEN`, `NUXEO_CLID`. Export them before the session, never
  type them where a recording or the log sees them, and read the transcript for them before keeping it;
- anything on screen but the app, the terminal and the docs: record those windows, each by itself,
  never the whole desktop, so that no message, notification or other document is kept;
- a recording of a person's voice or face, unless they have agreed to it in writing, beforehand.
  Notes are enough;
- data from any server but the test one, whose data is fictional. Never run these tests against a
  customer's server.

**What reaches the repository:** one row per session in the results table
([section 8](#8-results)), with the code, not the name, and each level 2 answer as an issue or a fix
to the doc it was missing from.

## 2. Preparing a server for tests A, B and D

Tests A, B and D rebuild a kit's pages on a server that has the kit's stand-in model and seed: the
same types and records the reference kit was written on. The server is the
[demo server](../../business-apps/demo-server/README.md), stood up from a release candidate, or a
local Docker Nuxeo with the kits installed by hand. Test C needs the opposite, a server without its
kit ([section 5](#5-test-c-an-app-with-the-agent-in-a-day-phase-3)).

### The facilitator's checkout

From a clone, at the commit the session runs on, with Node 24 (`.nvmrc`) and
`SATORI_GH_READONLY_TOKEN` exported for `npm ci`. Record the commit: it is the session's commit,
which the steps files compare the checkout against.

```bash
git clone https://github.com/nuxeo/Nuxeo-Satori-UI.git satori-acceptance && cd satori-acceptance
```

```bash
git checkout --detach origin/staging/enterprise-grade-app && git rev-parse HEAD
```

```bash
npm ci
```

```bash
npm install --no-save @playwright/test @axe-core/playwright && npx playwright install chromium
```

The last line is the harness's own prerequisite ([beta harness README](../../scripts/beta-harness/README.md),
"Prerequisites"): it changes `node_modules`, not `package-lock.json`.

### The demo server, from a release candidate

**Not run yet:** the demo server was built and checked offline, and has never been started against
Docker (its README, "What was checked, and what was not"; the
[administrator's guide](administrator-guide.md), section 7). The first session's preparation is its
first run: do it at least a day before, and fall back to the local server below if it fails.

It needs Docker and Compose v2, signed in to `docker-private.packages.nuxeo.com` with your own
account; Maven with a JDK, `unzip` and `tar` for the release candidate; and three secrets, exported
in the shell, never written to a file. Each README says what they are:

| Variable                     | What it is                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NUXEO_CLID`                 | The server's Nuxeo Connect registration                                                                       |
| `DEMO_SERVER_ADMIN_PASSWORD` | The `Administrator`'s password on this server, at least 12 characters                                         |
| `PAYERS_DEMO_PASSWORD`       | The Payers kit's six demo people's password, at least 8, not the administrator's. The participant is given it |

The candidate, held to its own commit, so that no upgrade is judged; then the plan; then the server.
Its own compose project, so that it never meets another one:

```bash
npm run release-candidate -- --out ../release-candidate-acceptance --since HEAD --unsigned-kits
```

```bash
npm run demo-server -- --candidate ../release-candidate-acceptance --project satori-demo-acceptance --dry-run
```

```bash
npm run demo-server -- --candidate ../release-candidate-acceptance --project satori-demo-acceptance
```

It installs every package of the candidate, the Payers and brand assets kits among them, places the
Payers kit's operation allow-list, changes the administrator's password, runs each kit's seed, and
prints how to run each demo steps file. Nuxeo answers on `http://127.0.0.1:18080`, on this machine
only: the session runs on this machine.

**The brand assets seed writes its dates from the day it runs.** For test D, run it again on the
morning of each session day, so that one asset's rights still end within 30 days and one's have
ended (the kit's README, "Seeding it"):

```bash
NUXEO_URL=http://127.0.0.1:18080 NUXEO_USER=Administrator NUXEO_PASS="$DEMO_SERVER_ADMIN_PASSWORD" node business-apps/packages/brand-assets-demo/demo/seed.mjs
```

### Or a local Docker Nuxeo

The local container `nuxeo`, on port 8080, with OpenSearch, as the kits' READMEs use it, in the
order the [administrator's guide](administrator-guide.md), section 3, gives. Install and seed from
the same commit as the steps files will run from:

- **Tests A and B:** `nuxeo-agentic-ui`, then the Payers kit, 0.4.1 or later, whose seed refuses an
  older one: the [Payers README](../../business-apps/packages/payers-claims-demo/README.md),
  "Installing it on a local Nuxeo", its upgrade sections in order, and "Seeding it". Then:

  ```bash
  export NUXEO_USER=<administrator> NUXEO_PASS=<password> PAYERS_DEMO_PASSWORD=<a password for the demo users>
  ```

  ```bash
  node business-apps/packages/payers-claims-demo/demo/seed.mjs
  ```

- **Test D:** `nuxeo-agentic-assets` and the brand assets kit, in one restart, and its seed: the
  [brand assets README](../../business-apps/packages/brand-assets-demo/README.md), "Installing it on
  a local Nuxeo" and "Seeding it", the seed again on each session day.

### Two checkouts, two dev servers

The dev server serves the `apps/nuxeo-ui/public/agentic-ui-config/` of the checkout it was started
from ([`dev-config.mjs`](../../scripts/dev-config.mjs)), so the facilitator and the participant each
have their own, on one machine, both proxying the test server:

| Checkout                                 | Who                                     | Dev server | Holds                                                                 |
| ---------------------------------------- | --------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `satori-acceptance`, above               | The facilitator: candidate and controls | Port 4301  | The reference kits, always                                            |
| `satori-participant`, at the same commit | The participant, and the final checks   | Port 4300  | The reference kit removed during the session, put back for the checks |

The participant's, before the clock starts, by the facilitator:

```bash
git clone https://github.com/nuxeo/Nuxeo-Satori-UI.git satori-participant && cd satori-participant
```

```bash
git checkout --detach <the session's commit> && npm ci && mkdir -p tmp
```

```bash
npm install --no-save @playwright/test @axe-core/playwright && npx playwright install chromium
```

```bash
npm run config:dev
```

```bash
NUXEO_PROXY_TARGET=http://127.0.0.1:18080 npx ng serve nuxeo-ui --configuration=development,remote --port 4300
```

`config:dev` runs once before the dev server starts, so that its folder exists: a dev server started
without it serves nothing under it until it is restarted. `tmp/` is where the model is exported:
git ignores it, and the write tools read a model only from inside the checkout. Then the reference
kit goes, as [section 1](#keeping-the-reference-out-of-reach) says, and `git status --short` lists
its removal alone.

**On a local Docker Nuxeo** instead, drop the remote proxy: `npx nx serve nuxeo-ui --port 4300`,
whose proxy is `http://localhost:8080`, and read `http://localhost:8080` wherever this page says
`http://127.0.0.1:18080`, and the server's own administrator wherever it says `Administrator` and
`$DEMO_SERVER_ADMIN_PASSWORD`.

### The participant's shell

Set by the facilitator in the participant's terminal, before the clock starts and before any
recording. The administrator's password is read without being shown, since a new terminal does not
have the facilitator's `DEMO_SERVER_ADMIN_PASSWORD`:

```bash
printf 'Test server administrator password: ' && read -rs NUXEO_PASS && echo && export NUXEO_PASS NUXEO_USER=Administrator NUXEO_URL=http://127.0.0.1:18080
```

```bash
export SESSION=~/Desktop/agentic-ui-evidence/business-apps/acceptance/<test>-<YYYY-MM-DD>-<code> PLATFORM=$(node -p "require('./libs/platform/package.json').version") MODEL=tmp/content-model.json && mkdir -p "$SESSION"
```

- **`NUXEO_USER` and `NUXEO_PASS`** are the test server's administrator, for the model's export
  and the Builder MCP server: its page provider list needs one. On a test server with fictional
  data only, which the session's end removes or keeps for the next session.
- **The app's passwords on paper,** handed over by the facilitator, never typed into the terminal:
  the demo people's password, `PAYERS_DEMO_PASSWORD`, for tests A and B, signing in as `dana.lee` and
  `riley.brooks`; the administrator's, for test D. The app's sign-in field masks them.
- **The model,** exported by the participant, as the tutorial's step 1 does, from the test server:

  ```bash
  npm run app-package:model -- --server http://127.0.0.1:18080/nuxeo --out tmp/content-model.json
  ```

- **`ACCEPTANCE_PACKAGE`,** the package's folder, which the participant names when they make it,
  such as `business-apps/packages/<their name>`, and the `pipeline` function of
  [section 1](#measuring), defined in this shell.
- **The Builder MCP server,** if they will use the agent. Registering it changes the person's own
  Claude configuration, so they run the command themselves, from the checkout's root, in this shell.
  The skill's command names `localhost:8080` and the default dev server; for this session, with the
  test server and the participant's dev server:

  ```bash
  claude mcp add-json nuxeo-builder --scope local '{"type":"stdio","command":"node","args":["tools/builder-mcp/src/main.ts"],"env":{"NUXEO_URL":"http://127.0.0.1:18080","DEV_SERVER_URL":"http://localhost:4300","NUXEO_USER":"${NUXEO_USER}","NUXEO_PASS":"${NUXEO_PASS}"}}'
  ```

  The single quotes keep the password out of the configuration, as the skill says.

### A two-day test's night

Leave the demo server running between the two days, or stop it and start it again with its own
project, never `up` (its README, "Stopping, starting, removing"):

```bash
docker compose -f business-apps/demo-server/compose.yml -p satori-demo-acceptance stop
```

```bash
docker compose -f business-apps/demo-server/compose.yml -p satori-demo-acceptance start
```

The dev servers are started again the same way, and the control runs again on the second morning.

## 3. Test A: the Member page in a day (phase 1)

### Who

A presales engineer new to the platform: they know Nuxeo, its content model, Studio and Web UI as
presales does, and have not worked on this repository or seen the Payers kit's files. They need not
be a web developer: the plan's point is that presales engineers are not ([plan](plan.md), "The short
version"). By hand, with the agent, or both.

### The starting state

- **The server:** prepared as [section 2](#2-preparing-a-server-for-tests-a-b-and-d) says, with the
  Payers kit's stand-in model and seed, and the control run passed that morning.
- **The package:** none. "From an empty package" here means from nothing: making the package, with
  `app-package` or the agent's `apply_generator`, is the first piece of the timed work. The package
  is built on the server's model, never a stand-in of its own: the Payers types are already there.
- **The dev server,** serving the platform's defaults.
- **The participant's checkout,** with the Payers kit removed, and the credentials exported.

### The task

The brief, read to the participant as written:

> Build an app definition package that draws the Payers Member page on this server, as the pictures
> show it. You may use the docs, the skill, the generators, the Builder MCP server and an agent; you
> may not write code or read the Payers kit. Tell me when you think you are done.

Give them the target sheet below, the control run's `member-as-adjuster` and
`member-as-member-services` screenshots, the prototype's Payers flow, and the seeded member to open,
`MEMBER-100048`, signed in as `dana.lee` (claims adjuster) and `riley.brooks` (member services). The
plan's section 3, "The Member page, side by side", is the job the page does.

### The target sheet: the Member page

On the seeded member, John Smith:

| Item | What the page shows                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | A record page for the member, in cards on one page, not in tabs, each with a heading                                                   |
| A2   | The member's name                                                                                                                      |
| A3   | Their age, from the date of birth                                                                                                      |
| A4   | Their address in one field: street, city, postcode and country                                                                         |
| A5   | Their phone                                                                                                                            |
| A6   | Their status, as a badge                                                                                                               |
| A7   | A list of the member's claims, latest service first, each with its number, its billed amount and its status                            |
| A8   | A list of the member's cases, each with its title and its state                                                                        |
| A9   | The social security number, to member services on the page, and to no one else anywhere on it, the Properties panel beside it included |
| A10  | Configuration only: no code in the package, nothing changed outside it, and no stand-in model of its own                               |
| A11  | The pipeline passes the package, held to the server's content model                                                                    |

**A9 is the hard one, on purpose.** A field hidden by a rule still shows in the Properties panel,
which lists the type's schema whole unless a `metadata` layout says otherwise
([layout-v2.md](layout-v2.md), section 1; [extension-reference.md](../extension-reference.md)). That
file is version 1, and the Builder MCP server's write tools write version 2 only
([`tools/builder-mcp`](../../tools/builder-mcp/README.md), "Writing a package"), so with the agent the
person writes it by hand, which is allowed. A prospect who is a health payer would refuse a page that
shows the number in its side panel. Hiding it is not a security control either: the API still
returns it to anyone who may read the member, and masking it is decision I.

### Pass and fail

1. **A11, the pipeline,** by the facilitator, with the server's model the participant exported:

   ```bash
   npm run app-package -- "$ACCEPTANCE_PACKAGE" --platform "$PLATFORM" --model "$MODEL"
   ```

   It ends with `checked, built and verified`, and exit 0.

2. **A1 to A10, the steps file,** in the participant's checkout, against their dev server. The demo
   password is read there now, unseen, as the administrator's was; then the checkout as the
   participant left it, into `checkout.txt`; then the reference kit back, for its seed data. Their
   files stay served as they served them:

   ```bash
   printf 'Demo password: ' && read -rs PAYERS_DEMO_PASSWORD && echo && export PAYERS_DEMO_PASSWORD
   ```

   ```bash
   git status --short > "$SESSION/checkout.txt" && git diff --stat <the session's commit> >> "$SESSION/checkout.txt"
   ```

   ```bash
   git checkout -- business-apps/packages/payers-claims-demo
   ```

   ```bash
   ACCEPTANCE_SCOPE=member ACCEPTANCE_PACKAGE="$ACCEPTANCE_PACKAGE" ACCEPTANCE_BASE=<the session's commit> APP_URL=http://localhost:4300 NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- acceptance-payers
   ```

   Exit 0, every check passed. Exit 1 lists the item each failed check names: a file the target
   needs and the package lacks fails here too. Exit 2 names what it refused, the environment or a
   name the facilitator must give: fix it and run again
   ([section 1](#before-every-session-the-control-run)).

3. **The time,** within 8 hours, and the help, as [section 1](#the-verdict) says.

## 4. Test B: Member, Claim and Case in two days (phase 2)

### Who

As test A, and not the same person: someone who has done test A knows the Member page.

### The starting state

As test A, with the Payers kit 0.4.1 or later, whose seed writes the appeals the Case page shows.

### The task

The brief, as written:

> Build an app definition package that draws the Payers Member, Claim and Case pages on this server,
> and a queue of claims for adjusters that can be narrowed by status, as the pictures show them. You
> may use the docs, the skill, the generators, the Builder MCP server and an agent; you may not write
> code or read the Payers kit. Then we will show it to a reviewer. Tell me when you think you are
> done.

Give them the target sheets of tests A and B, the control run's screenshots (`member-as-adjuster`,
`member-as-member-services`, `claim`, `appeal`, `grievance`, `claims-queue-narrowed`), the
prototype's Payers flow, and the records: member `MEMBER-100048`, claim `CLAIM-000131`, the appeal
`CASE-2041` and the grievance `CASE-2042`, as `dana.lee` and `riley.brooks`.

### The target sheet: the Claim and Case pages and the queue

Items A1 to A11, and:

| Item | What the page shows                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | The Claim page, in cards on one page, each with a heading: the claim's number; its member, as a link named for the member that opens them; the billed amount; the day it was received; the allowed amount; the status as a badge; a list of the claim's documents                                                                                                       |
| B2   | The Case page, in cards on one page, each with a heading: the case's number, category, and state as a badge; its member and its claim, each as a link by its title; who it is assigned to; the days received and due; how many days it has been open; its summary; on an appeal, its checklist, each item done or not, and who did each one done and when; its timeline |
| B3   | On a case that is not an appeal, no checklist, and still its timeline                                                                                                                                                                                                                                                                                                   |
| B4   | A queue of claims for adjusters, in the menu, with a Status facet that narrows it on the server                                                                                                                                                                                                                                                                         |
| B5   | The prospect's review, below, accepts it                                                                                                                                                                                                                                                                                                                                |

**The plan's words name three screens; the queue is this protocol's.** Section 3 of the plan lists "my
queues" in the Member page's navigation, and a queue with a facet is where the Payers kit's facet
needed a page provider the search index answers, which a person rebuilding only record pages would
never meet. The product owner may drop B4 before the first run; the steps file then needs
`ACCEPTANCE_SCOPE=screens` and a package with a queue all the same, so drop it in the steps file too.

**Not in this test:** the task forms, the lifecycle and operation buttons, bulk actions and
notifications, phase 2's demo steps 1 to 5. They are the demo's, which the kit's own steps files
cover, and a button's action is not served by `config:dev` at all.

### Pass and fail

As test A, with `ACCEPTANCE_SCOPE=screens`, and `ACCEPTANCE_QUEUE=<the queue's id>` when the
package has more than one queue:

```bash
ACCEPTANCE_SCOPE=screens ACCEPTANCE_PACKAGE="$ACCEPTANCE_PACKAGE" ACCEPTANCE_BASE=<the session's commit> APP_URL=http://localhost:4300 NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- acceptance-payers
```

Then B5: the review, below. The time is within 16 hours over two days.

### The prospect's review

**Who reviews:** someone who does a health payer's claims work, or sells to them, who has not seen
the reference kit: a prospect, or, until one is found, the presales lead standing in for one, which
the form says. The demo is shared on screen by the facilitator, from the test server, with fictional
data only, signed in as `dana.lee` and then `riley.brooks`. Never give a reviewer the server's
address or a password.

**What they see,** in 20 minutes: the Member page, a claim from it, a case from it, the appeal and
its checklist, and the queue narrowed. Then the form, which takes 10. They review the participant's
package, never the reference kit, and are not told which is which.

```text
Acceptance review, test B                                  Session: B-<YYYY-MM-DD>-<code>
Reviewer: [ ] a prospect   [ ] standing in for one         Role: ______________________
Use-case group: health payers and public health            (no name, no company)

For each screen, from 1 (could not use it) to 5 (would use it as it is):
  Member page   [1] [2] [3] [4] [5]   What would stop your team using it? ______________
  Claim page    [1] [2] [3] [4] [5]   What would stop your team using it? ______________
  Case page     [1] [2] [3] [4] [5]   What would stop your team using it? ______________
  Claims queue  [1] [2] [3] [4] [5]   What would stop your team using it? ______________

Anything shown that should not be, to whom? _______________________________________________
What is missing that you would need first? _______________________________________________

Would you accept this as the start of your app?
  [ ] Yes, as it is
  [ ] Yes, with these changes: ____________________________________________________
  [ ] No, because: ________________________________________________________________
```

**How it decides B5.** The facilitator sorts every change and every "no" reason, with the product
owner, into one of three: configuration the package could say with no code; a gap of the platform,
which the plan or the decision log names or should; or outside the use case. B5 holds when the
answer is "yes, as it is", or "yes, with these changes" and every change is configuration: the
result would be accepted, given a day's more configuration and no Angular code. A platform gap makes
B5 fail, and goes to the plan as a finding. A score of 1 or 2 on any screen, with a reason, is a
"no" for that screen whatever box is ticked.

## 5. Test C: an app with the agent in a day (phase 3)

### Who

Someone outside the team: not a member of any squad, who has not contributed to this repository or
read its business apps code. A presales engineer, or a developer of another product. They need a
Claude seat approved under Hyland's AI use requirements, and Claude Code installed, which phase 3
lists as a need not yet met.

### The starting state

- **A development Nuxeo with `nuxeo-agentic-ui` installed, and without the facilities kit:** the
  tutorial builds `WorkOrder` and `Building` as a stand-in model, and its first read must find
  neither. **Not the demo server,** which installs every kit of the candidate, the facilities kit's
  `WorkOrder` among them. The local Docker Nuxeo the tutorial was checked on has the other kits and
  not this one. The facilitator checks it with the tutorial's step 1 commands, with an
  administrator's `NUXEO_USER` and `NUXEO_PASS` exported:

  ```bash
  mkdir -p tmp && npm run app-package:model -- --server http://localhost:8080/nuxeo --out tmp/content-model.json
  ```

  ```bash
  node -e "const m = require('./tmp/content-model.json'); console.log('WorkOrder' in m.doctypes || 'Building' in m.doctypes ? 'NOT READY: a facilities type is there' : 'ready: no facilities type')"
  ```

- **The checkout:** at the session's commit, with `npm ci` run by the facilitator, since it needs a
  read token for GitHub Packages, and with the facilities kit still in place: the tutorial's "Before
  you start" removes it, and that is the participant's.
- **Claude Code,** with nothing registered for this repository: registering the Builder MCP server is
  the tutorial's part 2, and the participant's.

### The task

The brief, as written:

> Follow the tutorial, docs/business-apps/tutorial.md, part 2, "With the agent", to build the
> facilities app with Claude Code. Do "Before you start" first. You may read anything the tutorial
> links to; you may not write code, or files of the package with your own editor, or read the
> reference answer's files before step 8 compares yours with it. Tell me when you think you are done.

The tutorial is the brief and holds every file of the reference answer, on purpose: the test is
whether an outsider gets to a working app with the agent, in a day, by following it. The pictures are
the tutorial's own step 9 table.

### The target sheet: the facilities app

| Item | What holds                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | The pipeline passes the package, with `--model` and as CI runs it, without: both end `checked, built and verified` (the tutorial's step 8)                                                                                                                                                                           |
| C2   | Every write to the package went through `write_package_file`, `apply_generator` or `apply_package_changes`, and the last answered `written: true`: the transcript shows no other tool or command writing a file of the package                                                                                       |
| C3   | The package has what the tutorial's "What you build" table lists, row by row, read against the reference answer: the two types and their properties, the two page providers, the queue's two facets, the two record pages' cards, banner and related list, the Edit form's rule, the home's three cards and the menu |
| C4   | The agent, asked to write the field rule with `app.rules.fieldEquals`, is refused at write time, and the package is byte for byte as it was                                                                                                                                                                          |
| C5   | `preview_package` answers `"served": true`, and the home and the queue are drawn from the package, as the tutorial's step 9 table says                                                                                                                                                                               |
| C6   | Nothing outside the package changed                                                                                                                                                                                                                                                                                  |

**C4 is asked by the facilitator,** near the end, in these words for the participant to pass on:
"Make the resolution required with the rule `app.rules.fieldEquals` instead." Before and after, the
facilitator takes the package's digest; the two must be the same, and the transcript must show a
write tool answering `written: false` with the finding that the rule is not registered:

```bash
find business-apps/packages/facilities-demo -type f -not -path '*/dist/*' -exec shasum {} + | sort | shasum
```

### Pass and fail

**No steps file:** a browser cannot check this app. No server has records of its types, the kit has
no seed, and its record pages cannot be opened ([tutorial](tutorial.md), step 9, and its feedback
items 8 and 11); the home's figure and the queue answer errors until a server has the package.
Writing a seed, and installing the participant's package, would be new work outside the plan's test.
So C1 and C6 are commands, C2, C4 and C5 are read from the transcript, and C3 is the facilitator's
checklist against the reference:

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform "$PLATFORM" --model business-apps/packages/facilities-demo/content-model.json
```

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform "$PLATFORM"
```

```bash
git status --short && git diff --stat <the session's commit>
```

`git status` lists only `business-apps/packages/facilities-demo`: the participant's package is at the
reference answer's place, so `git diff <the session's commit> -- business-apps/packages/facilities-demo`
shows where theirs differs from the reference, which is what C3 reads. A difference is not a failure:
the agent may write a facet's page provider with `app-model --aggregates`, which the tutorial says
differs from the hand-written one in its comments and its search schema's namespace. A row of the
table the package does not do is.

The time is within 8 hours, the tutorial's own estimate for the by-hand path being "about 7 hours".
Then put the reference answer back, as the tutorial's step 10 says.

## 6. Test D: the product and asset pages in two days (phase 5)

### Who

As test A, a presales engineer new to the platform, who has not seen the brand assets kit's files.
Knowing a DAM, from Nuxeo or elsewhere, helps and is not needed.

### The starting state

As test A, with the brand assets kit, `nuxeo-agentic-assets` and the kit's seed, run again that
morning; the brand assets kit removed from the participant's checkout. The kit has no demo people:
the participant signs in to the app with the administrator's account they were given, who is in
neither of the kit's groups, so the registry serves them none of the reference kit's files.

### The task

The brief, as written:

> Build an app definition package that draws the Acme Outdoor asset page and product page on this
> server, and the asset library they are reached from, as the pictures show them. You may use the
> docs, the skill, the generators, the Builder MCP server and an agent; you may not write code or read
> the brand assets kit. Tell me when you think you are done.

Give them the target sheet, the control run's screenshots (`asset-rights-ending`,
`asset-rights-ended`, `product`, `library-narrowed`), the prototype's brand assets flow, and the
records: the assets "Trailhead Rain Jacket, Moss, on model", "Trailhead Rain Jacket, Moss, front" and
the one whose rights have ended, and the product AO-3101.

### The target sheet: the asset and product pages and the library

| Item | What the page shows                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | The asset page, in cards on one page, each with a heading, with the picture first, as one of its views, never its original file                                        |
| D2   | A warning banner while the asset's rights end within 30 days, a negative one once they have ended, and none on cleared rights, each in words from the package's labels |
| D3   | The asset's title, product, colourway, shot and credit                                                                                                                 |
| D4   | Its rights: the end date, the channels as chips, the regions and the rights holder                                                                                     |
| D5   | Its history, and the creative review on the picture                                                                                                                    |
| D6   | The product page, in cards on one page, each with a heading: its style, season, colourways and channels as chips, and launch date                                      |
| D7   | A list of the shots the product still misses                                                                                                                           |
| D8   | A list of the product's assets                                                                                                                                         |
| D9   | The asset library, in the menu, with a facet that narrows it on the server                                                                                             |
| D10  | Configuration only, and the pipeline passes it held to the server's model, as A10 and A11                                                                              |

**The plan's words name two pages; the library is this protocol's,** as B4 is, for the same reason:
the plan's proposal for this test names "an asset page and approval queue" ([plan](plan.md),
section 13), and the facet is where a DAM's search lives. The rights the server enforces are the
add-on's and the kit's rights policy, not the participant's package: they are not in this test.

### Pass and fail

As test A, in the participant's checkout: the pipeline with the server's model; the checkout as
they left it, into `checkout.txt`; then the brand assets kit put back for its seed data, and its
steps file, run as anyone who may read the kit's workspace: the administrator, whose `NUXEO_USER` and
`NUXEO_PASS` the participant's shell already holds:

```bash
git status --short > "$SESSION/checkout.txt" && git diff --stat <the session's commit> >> "$SESSION/checkout.txt"
```

```bash
git checkout -- business-apps/packages/brand-assets-demo
```

```bash
ACCEPTANCE_PACKAGE="$ACCEPTANCE_PACKAGE" ACCEPTANCE_BASE=<the session's commit> APP_URL=http://localhost:4300 npm run beta:evidence -- acceptance-brand-assets
```

`ACCEPTANCE_QUEUE=<the library's id>` when the package has more than one queue. The time is within
16 hours over two days.

## 7. The steps files

Two steps files of the [beta harness](../../scripts/beta-harness/README.md), and the checks they
share, judge a participant's package, never a kit's:

| File                                                                                          | Test      | What it opens                                                                                                                |
| --------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`acceptance-payers.mjs`](../../scripts/beta-harness/steps/acceptance-payers.mjs)             | A, B      | The Member page as an adjuster and as member services; with `screens`, the Claim page, the appeal, a grievance and the queue |
| [`acceptance-brand-assets.mjs`](../../scripts/beta-harness/steps/acceptance-brand-assets.mjs) | D         | Three assets, their banners and views, the product page and the library                                                      |
| [`acceptance/participant.mjs`](../../scripts/beta-harness/steps/acceptance/participant.mjs)   | All three | The shared checks: the package, the checkout, the served files, the page as its file says, the queue                         |

- **Each check names its target item,** so a failed check says which item failed.
- **What they read of the reference kit:** its seed data, which prepared the server and says what the
  records hold; and its layouts, only to fail a copy of them. What the participant chose, card ids,
  headings and label keys, is read from their package, and the page is held to their file: the
  file's cards in order, a card with a rule allowed to be left out, each headed from the package.
- **What they judge against the server itself:** the queue's rows, its facet's buckets and its
  narrowing are compared with the answers the page's own requests receive, so they hold for whatever
  page provider the participant chose.
- **What they refuse to run without,** with exit 2: the package named, and not the reference kit
  under any spelling or link; the session's commit; the reference kit's seed data back in the
  checkout; the kit installed and seeded, with no record the seed did not write among those counted;
  the dev server serving the participant's own files; and the run's user, for Payers an adjuster in no
  other group.
- **What they do not do:** run the pipeline, which is a command (A11 and D10); judge what a prospect
  thinks; check the server's own install of the package, since the dev server reads the package
  through `config:dev`; or check actions, which `config:dev` does not serve.
- **They are not a kit's demo.** They name each reference kit by one path to its seed data, never as
  a kit's folder, so the release candidate's listing of demo steps (`scripts/release-candidate-demo.mjs`)
  does not list them for a server run, which has no participant's package to give them.

**How they were checked, 25 November 2026:** `node --check` and the harness's assertion audit
(`npm run beta:audit`) on all four files, and the shared checks' offline controls, 40 of them:

```bash
node scripts/beta-harness/steps/acceptance/participant.selftest.mjs
```

They hold, in a scratch git repository: the package found, and the reference kit refused under three
spellings; the checkout's changes outside the package found, and those inside it or ignored not;
code found in a bundle; a copied layout found; the page held to its file, a file of tabs and a
missing file named; the 404s a package with no home or menu leaves to the registry, and no other;
and the queue named, none being the package's failure. Three guards taken out on purpose, the
reference kit's refusal, the checkout's filter and the registry's queues, turned three, four and
one controls red, and were put back byte for byte. The controls found one real defect before any
server did: on a checkout whose path goes through a link, as a temporary folder's does on macOS,
every file inside the package was counted as outside it.

**An independent review** dry-ran every preparation step on paper against the repository, and
traced the control run's checks against the reference kits' files and seed data. What it found is
fixed above: a package with no home or menu failing the console check on the dev server's 404s; a
package's own gaps refused as the environment's, with exit 2, rather than failed on their item; one
checkout and one dev server shared by the facilitator's control and the participant, which neither
could use; control commands left to be written by hand; the Builder MCP server and the model's
export pointed at the default server; a model exported into a `tmp/` a fresh clone does not have; a
layout in tabs, which the checks could only half see; the Properties panel judged by one property
a participant's panel may leave out; passwords to be typed where a recording sees them; and a menu
and a Status facet the target names and nothing checked. Its second look, at the fixes, found the
Payers control's copy still holding a home it did not serve, the panel counted as drawn on the
member's name, which its title shows first, the administrator's password missing from a new
terminal, and the facilitator's checkout one directory away from the participant's agent: each is
fixed above.

**Not checked:** any run against a server. The first control run
([section 1](#before-every-session-the-control-run)) is the steps files' first run, and its result
goes in the results table.

## 8. Results

No session has run. Each session adds one row, with the participant's code and never a name:

| Session | Test | Commit | Server | Verdict | Time | Help, levels 1 and 2 | Stuck, minutes | Pipeline runs, refused | Doc gaps filed |
| ------- | ---- | ------ | ------ | ------- | ---- | -------------------- | -------------- | ---------------------- | -------------- |

## 9. The session log

The facilitator's `session.md`, one per session:

```markdown
# <test>-<YYYY-MM-DD>-<code>

- Test: A | B | C | D. Day 1 of 1 | Day <n> of 2
- Commit: <the session's commit>. Server: demo server <project> | local, Nuxeo <version>,
  kits <name version, ...>
- Control run, this morning: <reference demo verdict and counts>; <acceptance steps file on the
  copy: the one expected failure, and the rest passed>
- Participant: <code>. Profile: <presales | developer>, <years with Nuxeo>, <has used Studio: yes |
  no>, by hand | with the agent | both
- Reference removed from the checkout: <time>. `git status --short` at the start: <output>

## Clock

| Day | Started | Stopped | Breaks, minutes (counted) |
| --- | ------- | ------- | ------------------------- |

## Log

| Time | Kind: stuck, help, finding, note | What | Level | Minutes lost |
| ---- | -------------------------------- | ---- | ----- | ------------ |

## Checks

- Pipeline (A11, D10, C1): <command, last line, exit code>
- Steps file: <command without passwords, verdict, passed of total, evidence folder>
- Target items: <each item, pass or fail, and the check or the reading that decided it>
- Review (B5): <the form's answers, and how each change was sorted>

## Verdict

<Pass | Fail | Void>, in <hours and minutes>, with <n> answers at level 1, <n> at level 2, <n>
stuck episodes costing <minutes>, <n> pipeline runs of which <n> refused. Doc gaps: <list>.
```
