# Local demo runbook: a customer's Payers app, built by prompting the Claude app

From nothing to a working claims app on your own machine, the way a customer gets there:

1. a new Nuxeo container;
2. the latest Marketplace build, installed with `nuxeoctl`;
3. the customer's configuration repository, cloned;
4. in the Claude desktop app, prompts that build a health payer's claims app;
5. the agent generates every file, each write validated;
6. push the repository;
7. build the configuration package;
8. install it, which restarts Nuxeo, and see the changes.

Everything the customer needs is in their one repository: `@nuxeo/satori-cli`, with its MCP
server, the app builder skill, the agent rules and a reference of the platform. Nothing comes from
Nuxeo Satori UI's repository. Allow about 45 minutes.

**Run on 28 November 2026**, against a throwaway server that was then removed:

- steps 1 to 3, 5, 7 and 8 as written;
- step 4's first two prompts, through headless Claude Code in the repository;
- not run: step 4 in the desktop app's window, its third prompt, step 6, and any page in a browser.

[What was checked](#what-was-checked-on-28-november-2026) gives each result.

## What you need

| What                                                           | Why                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Desktop, running the usual local stack                  | The containers `nuxeo` (port 8080) and `nuxeo-opensearch`, on the network `nuxeo-net`. The new server reuses that OpenSearch with indices of its own, and leaves `nuxeo` alone. |
| The image `docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025` | Already on your machine if `nuxeo` runs from it. The trial's was Nuxeo 2025.26.16.                                                                                              |
| A Nuxeo Connect registration, `NUXEO_CLID`                     | For the two OpenSearch packages the new server installs from Connect. Step 1 reads it from `nuxeo`.                                                                             |
| The GitHub CLI, signed in (`gh auth status`)                   | To download the Marketplace package, and to make the customer's repository on GitHub.                                                                                           |
| The Claude desktop app, with Claude Code                       | Step 4. The trial ran Claude Code 2.1.311.                                                                                                                                      |
| Node 24 or later, git, curl and unzip                          |                                                                                                                                                                                 |

`nuxeoctl` needs nothing installed: it ships in the Nuxeo image, at `/opt/nuxeo/server/bin/nuxeoctl`.
`docker exec satori-demo nuxeoctl mp-list` runs it. It refuses to install while the server runs,
and in the image the server is the container's main process, so each install below goes through a
one-off script the image runs at the next start.

## 0. Your shell

```bash
export DEMO="$HOME/satori-demo"
mkdir -p "$DEMO/conf.d" "$DEMO/packages"
```

The new server's administrator is the image's default account, on `127.0.0.1` only:

```bash
export NUXEO_USER=Administrator
export NUXEO_PASS='<the Nuxeo image default administrator password>'
```

## 1. A new Nuxeo container, on port 8090

The search and audit settings. The image reads `conf.d` at its first start only:

```bash
cat > "$DEMO/conf.d/99-satori-demo.conf" <<'EOF'
# The demo server's search and audit, on the shared nuxeo-opensearch, in indices of its own.
nuxeo.opensearch2.client.server=http://nuxeo-opensearch:9200
nuxeo.search.client.default.opensearch2.index.name=nuxeo-satori-demo
nuxeo.search.client.default.opensearch2.settings.numberOfReplicas=0
nuxeo.search.client.default.opensearch2.settings.numberOfShards=1
nuxeo.audit.backend.default.opensearch2.index.name=nuxeo-satori-demo-audit
nuxeo.audit.backend.default.opensearch2.settings.numberOfReplicas=0
nuxeo.audit.backend.default.opensearch2.settings.numberOfShards=1
EOF
```

The Connect registration, read from `nuxeo` and never printed:

```bash
export NUXEO_CLID="$(docker inspect nuxeo --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^NUXEO_CLID=//p')"
[ -n "$NUXEO_CLID" ] && echo "NUXEO_CLID is set" || echo "nuxeo has no NUXEO_CLID: export your own"
```

The server. `-e NUXEO_CLID` passes the value by name, so it is not on the command line:

```bash
docker run -d --name satori-demo --network nuxeo-net -p 127.0.0.1:8090:8080 \
  -e NUXEO_PACKAGES="nuxeo-search-client-opensearch2 nuxeo-audit-opensearch2" \
  -e NUXEO_CLID \
  -v "$DEMO/conf.d:/etc/nuxeo/conf.d:ro" \
  docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025
```

```bash
until curl -fs -o /dev/null http://localhost:8090/nuxeo/runningstatus; do sleep 5; done; echo "Nuxeo is up"
```

**Check it.** It was up 18 seconds after `docker run`.

```bash
docker exec satori-demo nuxeoctl mp-list | grep started
```

```bash
curl -s "http://localhost:9200/_cat/indices/nuxeo-satori-demo*?h=index,docs.count"
```

You should see `nuxeo-search-client-opensearch2` and `nuxeo-audit-opensearch2` started (2025.5.21),
and two indices, `nuxeo-satori-demo` and `nuxeo-satori-demo-audit`.

## 2. The latest Marketplace build

```bash
gh run download 46100962286 --repo nuxeo/Nuxeo-Satori-UI -n nuxeo-agentic-ui-package -D "$DEMO/packages"
```

That is the artifact of the `Build Marketplace Package` run on `staging/enterprise-grade-app` at
`498c4505a`, from 28 November 2026. GitHub keeps it until 28 December 2026.

For a newer build, use the latest successful run's id:

```bash
gh run list --repo nuxeo/Nuxeo-Satori-UI --workflow build-marketplace.yml --branch staging/enterprise-grade-app --status success --limit 1
```

**Check it:**

```bash
shasum -a 256 "$DEMO"/packages/nuxeo-agentic-ui-package-*.zip
```

```bash
unzip -p "$DEMO"/packages/nuxeo-agentic-ui-package-*.zip package.xml
```

You should see:

- the file `nuxeo-agentic-ui-package-2026.0.2-20261128030336-BUILD-3223.zip`, 5,016,831 bytes;
- its SHA-256, `a0462c5f6a74c45c8cb42643839ad088d44f9b290b0dafaf459b97225cdb9f7c`;
- a `package.xml` naming `nuxeo-agentic-ui` at version `2026.0.2-20261128030336-BUILD-3223`, under
  the Apache License 2.0, for Nuxeo LTS `[2025.0,2026.0)`, with no dependency.

The zip holds two things:

- the core bundle, in `install/bundles/`;
- the app, in `web/nuxeo.war/agentic-ui/`, with the embedded panel in its `embedded/v1/`.

### Install it with nuxeoctl

Define the helper once. It does what each kit's README does by hand:

1. copies the zips into the container;
2. writes the one-off script, which always ends with `exit 0`, so a failed install cannot stop the
   container from starting;
3. restarts the server and waits for it;
4. removes the script, and prints the install log and the components' status.

```bash
demo_install() {
  local z script=zz-demo-install.sh
  local -a names=()
  for z in "$@"; do
    docker cp "$z" satori-demo:/tmp/ || return 1
    names+=("/tmp/$(basename "$z")")
  done
  printf '%s\n' '#!/bin/bash' \
    "nuxeoctl mp-install ${names[*]} --accept=true > /var/log/nuxeo/demo-install.log 2>&1 || echo 'demo install failed: see /var/log/nuxeo/demo-install.log'" \
    'exit 0' > "$DEMO/$script"
  chmod 755 "$DEMO/$script"
  docker cp "$DEMO/$script" satori-demo:/docker-entrypoint-initnuxeo.d/ || return 1
  echo "Restarting satori-demo to install ${names[*]}"
  docker restart satori-demo > /dev/null || return 1
  sleep 15
  until curl -fs -o /dev/null http://localhost:8090/nuxeo/runningstatus; do sleep 5; done
  docker exec -u 0 satori-demo rm -f "/docker-entrypoint-initnuxeo.d/$script"
  docker exec satori-demo sed -n '/Dependency resolution/,$p' /var/log/nuxeo/demo-install.log
  docker exec satori-demo sh -c 'grep "Component Loading Status" /var/log/nuxeo/server.log | tail -1'
}
```

```bash
demo_install "$DEMO"/packages/nuxeo-agentic-ui-package-*.zip
```

**You should see this.** The server was back in 39 seconds.

```text
Installation order (1):        nuxeo-agentic-ui-2026.0.2-20261128030336-BUILD-3223
Unchanged packages (2):        nuxeo-audit-opensearch2:2025.5.21, nuxeo-search-client-opensearch2:2025.5.21
Local packages to install (1): nuxeo-agentic-ui:2026.0.2-20261128030336-BUILD-3223

Installing nuxeo-agentic-ui-2026.0.2-20261128030336-BUILD-3223
= Component Loading Status: Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 572
```

**Open the app:** <http://localhost:8090/nuxeo/agentic-ui/>.

1. A browser that is not signed in is sent to Nuxeo's sign-in page,
   `/nuxeo/login.jsp?requestedUrl=agentic-ui%2Findex.html`.
2. Sign in as the administrator, and the app opens.
3. No app is listed yet, because you are in no app's group.

The 401 that `curl` gets at the same address is expected. It carries the small script that sends
a browser to the sign-in page, and `curl` does not run it.

```bash
curl -s -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8090/nuxeo/agentic-ui-apps/apps.json
```

```bash
curl -s -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8090/nuxeo/agentic-ui-apps/diagnostics.json
```

You should see `"apps" : [ ]`. The diagnostics name the package's version, its core bundle's,
Nuxeo's (2025.26.16), and every installed package with its state.

## 3. The customer's configuration repository

A customer makes it once, by following Nuxeo's guide, and keeps it in their own GitHub. Everyone
after that clones it. Here, make it, push it, and clone it, as a customer would.

**Make it, once.** `@nuxeo/satori-cli` 0.4.0 is the version this runbook needs. Until it is
published, build its tarball from PR #805's branch, in a clone of Nuxeo Satori UI:

```bash
git switch feat/satori-cli-0.4.0-claude-app && node tools/satori-cli/build.mjs && npm pack dist/tools/satori-cli --pack-destination "$DEMO"
```

```bash
cd "$DEMO"
npx --package ./nuxeo-satori-cli-0.4.0.tgz satori create acme-satori --name acme-config --owner acme
```

Once 0.4.0 is published, use the registry instead:
`npx --@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/ @nuxeo/satori-cli@alpha create acme-satori --name acme-config --owner acme`.

`create` writes the repository:

- the package `config-packages/acme-config/`;
- `AGENTS.md`, and `CLAUDE.md`, which imports it;
- the app builder skill, in `.claude/skills/` and the other IDEs' folders;
- the MCP server `nuxeo-satori`, in `.mcp.json`;
- `.claude/settings.json`, which approves the server, allows the agent the checks and builds, and
  denies it the local credentials and Claude's own file tools on the package;
- a CI workflow.

```bash
cd "$DEMO/acme-satori"
git init
git add . && git commit -m "A Nuxeo Satori configuration repository"
gh repo create acme-satori --private --source . --push
```

**Clone it, as everyone after that does:**

```bash
cd "$DEMO" && gh repo clone acme-satori acme-satori-clone && cd acme-satori-clone
```

```bash
npm install --no-save "$DEMO/nuxeo-satori-cli-0.4.0.tgz"
```

Once 0.4.0 is published, that is `npm install`, which writes the `package-lock.json` to commit.

**Connect it to the server, once, in a terminal.** The Claude desktop app reads no shell profile,
so the MCP server takes the server and the account from `.claude/settings.local.json`:

```bash
./node_modules/.bin/satori connect --server http://localhost:8090 --user Administrator
```

It asks for the password without showing it, and checks it against the server. It writes the file
only if git ignores it: `create`'s `.gitignore` does. In the trial it answered
`http://localhost:8090 answers as Administrator`, at mode `-rw-------`.

## 4. Build the Payers app, by prompting the Claude app

Open `$DEMO/acme-satori-clone` in the Claude desktop app's Code tab:

1. **Trust the folder** when Claude asks. Until it is trusted, Claude ignores
   `.claude/settings.json` and does not load the skill.
2. **If Claude says `nuxeo-satori` is "blocked by enterprise policy",** that is your
   organisation's policy, which allows only the MCP servers it lists. It was so in the trial. The
   agent goes on through the same tools from the command line, `satori tool`, which the settings
   allow. Nothing to do; an administrator could allow `nuxeo-satori` instead.

Then paste the prompts, one at a time, and read each answer.

**Prompt 1, the branding:**

> Brand the app as Acme Health Plan: primary colour #0B5FFF with white text on it, accent #FF6B00,
> and make it the default theme. Then validate and build the package, and tell me what is left for
> me.

In the trial the agent did the following, in 11 turns, 54 seconds and about $0.20:

1. read `knowledge/README.md` and `knowledge/branding.md`;
2. wrote `bootstrap.json` through the validated `write_package_file`: a theme `acme-health` on
   the base `nuxeo`, with `--mat-sys-primary` `#0B5FFF`, `--mat-sys-on-primary` `#FFFFFF`, the
   primary containers and `--mat-sys-tertiary` `#FF6B00`, made the default;
3. built `dist/acme-config-1.0.0.zip`;
4. listed what was left: installing, restarting, committing.

**Prompt 2, the claims app:**

> Build a claims app for our health plan, called Acme Claims, for the group claims-adjusters. Our
> development server has no claim types yet. This is a demo, so create stand-in types: Member
> (member id, full name, plan Gold, Silver or Bronze, date of birth, status Active or Inactive),
> Claim (claim number, the member it is for, amount, service date, status Submitted, In review,
> Approved or Denied, priority Normal or High) and Case (case number, the claim it is about,
> reason, status Open or Closed). Give each type a record page, and give claims an edit form and a
> create form with the claim number, the member and the amount required. Validate and build when
> done.

**Claude asks you to allow `satori model pull`.** Allow it. That is your yes to a stand-in model:
it takes the server's model into the package, so the agent may add types to it.

In the trial the agent did the following, in 41 turns, about 3 minutes and about $1.01:

1. added the app `acme-claims` to the one package: `app.json`, its labels, and `app-registry`;
2. wrote the three types, with page providers for the queues;
3. wrote the three record pages, and the Claim edit and create forms with the three required fields;
4. wrote two queues, "Claims to review" and "Open cases", following the reference's worked example;
5. wrote a home with a figure for each and the claims changed last, and a menu, modelled on an
   example app;
6. validated and built.

When it tried to edit a generated file by hand, the settings refused it, and it went back to the
tools.

**Prompt 3, the facets and one more queue.** This one was not run in the trial:

> Add facets by status and priority to the Claims to review queue, and add a High-value claims
> queue for claims over 10,000, in the menu and on the home page. Validate and build.

**Check what the agent says it did.** In the trial it reported facets on "Claims to review", and
the queue's file had none: `app-queue` writes no facets. The reference now makes them a step of
their own, which this prompt asks for. Read the queue file after it:

```bash
grep -c '"facets"' config-packages/acme-config/bundle/agentic-ui-config/queues/claims-to-review.json
```

## 5. The agent generated and validated every file

Each write went through the MCP server's tools, or `satori tool`, and was kept only when the
package then passed `satori validate`'s steps. Check it yourself:

```bash
git status --short
./node_modules/.bin/satori validate config-packages/acme-config --kits config-packages
```

In the trial, `git status` listed these, all from the agent:

- `app.json`, `home.json`, `navigation.json`, `labels/`;
- `layouts/Member`, `layouts/Claim` and `layouts/Case`, and `queues/`;
- the model's `acme-config-model.xml`, `schemas/` and `content-model.json`;
- the updated component and `MANIFEST.MF`.

`validate` answered `the package passes every step`.

## 6. Push the repository

```bash
git add -A && git commit -m "Acme Claims: members, claims and cases" && git push
```

Its workflow, `.github/workflows/satori.yml`, then validates and builds the package on GitHub,
and uploads the zip as the run's artifact `configuration-packages`. Not run in the trial: the
repository was not pushed.

## 7. Build the configuration package

```bash
npm run build
```

In the trial: `acme-config 1.0.0: checked, built and verified: dist/acme-config-1.0.0.zip`. The
CI artifact of step 6 is the same zip.

## 8. Install it, which restarts Nuxeo, and see the changes

The app's group, with you in it, so that the app is served to you:

```bash
curl -s -o /dev/null -w "claims-adjusters: %{http_code}\n" -u "$NUXEO_USER:$NUXEO_PASS" -H 'Content-Type: application/json' \
  -X POST http://localhost:8090/nuxeo/api/v1/group \
  -d "{\"entity-type\":\"group\",\"groupname\":\"claims-adjusters\",\"grouplabel\":\"Claims adjusters\",\"memberUsers\":[\"$NUXEO_USER\"]}"
```

```bash
demo_install dist/acme-config-1.0.0.zip
```

In the trial: `Installing acme-config-1.0.0`, then
`Component Loading Status: Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 574`.

**What the server serves now.** Each was checked in the trial:

```bash
for t in Member Claim Case; do echo "$t: $(curl -s -o /dev/null -w '%{http_code}' -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8090/nuxeo/api/v1/config/types/$t)"; done
curl -s -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8090/nuxeo/agentic-ui-apps/apps.json
```

You should see:

- `200` for each type;
- `acme-claims` in `apps.json`;
- in `/nuxeo/agentic-ui-config/bootstrap.json`, the fragment `acme-config` with `Acme Health Plan`
  and `--mat-sys-primary` `#0B5FFF`.

**A member and a claim**, so that the queue lists something:

```bash
B=http://localhost:8090/nuxeo/api/v1; H='Content-Type: application/json'
curl -s -u "$NUXEO_USER:$NUXEO_PASS" -H "$H" -X POST "$B/path/default-domain/workspaces" -d '{"entity-type":"document","type":"Workspace","name":"acme-claims","properties":{"dc:title":"Acme claims"}}' > /dev/null
M=$(curl -s -u "$NUXEO_USER:$NUXEO_PASS" -H "$H" -X POST "$B/path/default-domain/workspaces/acme-claims" -d '{"entity-type":"document","type":"Member","name":"m-1001","properties":{"dc:title":"Dana Lee","member:memberId":"M-1001","member:fullName":"Dana Lee","member:plan":"Gold","member:status":"Active"}}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).uid')
curl -s -u "$NUXEO_USER:$NUXEO_PASS" -H "$H" -X POST "$B/path/default-domain/workspaces/acme-claims" -d "{\"entity-type\":\"document\",\"type\":\"Claim\",\"name\":\"c-5001\",\"properties\":{\"dc:title\":\"CLM-5001\",\"claim:claimNumber\":\"CLM-5001\",\"claim:member\":\"$M\",\"claim:amount\":12500,\"claim:status\":\"Submitted\",\"claim:priority\":\"High\"}}" > /dev/null
```

The property names, `member:…` and `claim:…`, are those the agent wrote; `content-model.json`
holds them. In the trial, the queue's page provider, `acme_claims_to_review`, then listed
CLM-5001, with its status and priority aggregations.

**See it.** Open <http://localhost:8090/nuxeo/agentic-ui/>, sign in, and open Acme Claims: the
home, "Claims to review", CLM-5001's record page, and the Acme colours. Not looked at in a browser
in the trial.

**Each change after that:** prompt the agent, then

1. raise the version: `./node_modules/.bin/satori version config-packages/acme-config patch`;
2. `npm run build`;
3. `demo_install dist/acme-config-<version>.zip`;
4. commit and push.

## 9. Removing everything

```bash
docker rm -f -v satori-demo
```

```bash
curl -s -X DELETE http://localhost:9200/nuxeo-satori-demo
curl -s -X DELETE http://localhost:9200/nuxeo-satori-demo-audit
```

```bash
mv "$DEMO" ~/.Trash/
```

`-v` removes the container's three volumes: its data, its logs and its `/tmp`. Nothing on `nuxeo`
or in its indices was touched. The repository `acme-satori` stays on GitHub: if you made it for
this demo only, delete it there yourself.

## If something goes wrong

- **`docker run` says the name `/satori-demo` is in use.** Run step 9 first.
- **The container stops at its first start.** Run `docker logs --tail 50 satori-demo`.
  `Registration required` means there is no `NUXEO_CLID`.
- **Claude says the folder is not trusted, or the skill is unknown.** Trust the folder, and reopen
  it.
- **The agent says a server read refuses for missing credentials.** Run `satori connect` again in
  a terminal, then `/mcp` in Claude.
- **`demo_install` printed `demo install failed`.** Read
  `docker exec satori-demo cat /var/log/nuxeo/demo-install.log`. A package at a version already
  installed is skipped: raise it with `satori version`.
- **No app is listed.** Check that you are in `claims-adjusters` (`apps.json`), then reload the app.

## What was checked on 28 November 2026

On macOS, Docker Desktop, Nuxeo 2025.26.16, Node 24 or later and Claude Code 2.1.311.

- **Steps 1, 2 and the install:**
  - the server was up in 16 seconds;
  - the Marketplace package installed with 0 pending and 0 missing out of 572.
- **Step 3:**
  - a repository from the 0.4.0 tarball of #805, with all seven agent files;
  - `satori connect` against the server;
  - `agents sync --check` in step.
- **Step 4, headless,** through `claude -p` in the repository, under an organisation policy that
  blocks the MCP server, so through `satori tool`:
  - the repository's settings and the local file's `env` were given with `--settings`, as a
    trusted folder gives them;
  - the skill did not load, since the folder was not trusted, and the agent found the reference
    through `AGENTS.md`;
  - prompt 2 ran with `satori model pull` allowed, as you allow it when Claude asks;
  - prompts 1 and 2 did what step 4 says.
- **The trial found these, fixed in #805 before the run step 4 describes:**
  - the blocked MCP server;
  - a command with a variable that Claude Code cannot check;
  - the agent writing a model itself;
  - facets reported but not written.
- **Steps 5, 7 and 8:**
  - `validate` passed, and `build` gave `acme-config-1.0.0.zip`;
  - the install gave 0 pending and 0 missing out of 574;
  - the server served the three types, their layouts, the app to its group, and the branding;
  - a claim created on it was listed by the queue's page provider, with aggregations.
- **Step 9:** the container, its volumes and both indices were removed.
- **Not run or not seen:**
  - the desktop app's window;
  - prompt 3;
  - step 6's push and its CI run;
  - any page in a browser;
  - a logo, which is a file a person adds.

**What prompts cannot build here:** Payers' workflows (no generator: they are Studio's), letters
(they need the letters add-on and Nuxeo's Template Rendering) and buttons that run the customer's
Automation chains (Studio's, and the deployment's allow-list a person's). The reference says so to
the agent.
