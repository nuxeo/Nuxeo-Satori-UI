# Local demo runbook: the Marketplace package, a kit and your own configuration repository

From nothing to a working Nuxeo Satori on your own machine, the way a customer gets there:

1. a clean Nuxeo;
2. the Marketplace package, installed with `nuxeoctl`;
3. a kit, as the example app;
4. a configuration repository of your own, built with the published `@nuxeo/satori-cli` and
   installed like any other package.

Allow about 30 minutes, most of it reading what each step prints.

Parts 1 to 5 and 7 were run on 28 November 2026, on macOS, against a server made for the trial
and then removed. Each step below gives what the trial printed, so that you can compare. Part 6,
the AI IDE, was not run. [What was checked](#what-was-checked-on-28-november-2026) lists each
result, and what was not seen.

## What you need

| What                                                                         | Why                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Desktop, running the usual local stack                                | The containers `nuxeo` (port 8080) and `nuxeo-opensearch`, on the network `nuxeo-net`. The new server reuses that OpenSearch with indices of its own, and leaves `nuxeo` and its data alone. |
| The image `docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025`               | Already on your machine if `nuxeo` runs from it. The trial's was Nuxeo 2025.26.16.                                                                                                           |
| A Nuxeo Connect registration, `NUXEO_CLID`                                   | The new server installs its two OpenSearch packages from Connect at its first start. Step 1 reads the registration from `nuxeo`.                                                             |
| The GitHub CLI, signed in (`gh auth status`)                                 | To download the Marketplace package, a build artifact of `nuxeo/Nuxeo-Satori-UI`.                                                                                                            |
| Node 24 or later, git, curl and unzip                                        |                                                                                                                                                                                              |
| A clone of Nuxeo-Satori-UI on `staging/enterprise-grade-app`, after `npm ci` | For part 4 only: a kit is built from source.                                                                                                                                                 |

### nuxeoctl: nothing to install

`nuxeoctl` ships in the Nuxeo image, at `/opt/nuxeo/server/bin/nuxeoctl`, on the container's
`PATH`. `docker exec satori-demo nuxeoctl mp-list` runs it. On a server installed without Docker,
it is in the distribution's `bin/`.

What Docker changes is when it may install. `nuxeoctl mp-install` refuses while the server runs,
and in the image the server is the container's main process. So each install below goes through a
one-off script in `/docker-entrypoint-initnuxeo.d/`. The image runs it at the next start, before
the server.

## 0. Your shell

In the terminal you use throughout:

```bash
export DEMO="$HOME/satori-demo"
mkdir -p "$DEMO/conf.d" "$DEMO/packages"
```

The new server's administrator is the image's default account. Its port is bound to `127.0.0.1`
only:

```bash
export NUXEO_USER=Administrator
export NUXEO_PASS='<the Nuxeo image default administrator password>'
```

Your clone, for part 4:

```bash
export SATORI_UI="<the path of your clone of Nuxeo-Satori-UI>"
```

## 1. A clean Nuxeo on port 8090

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

## 2. The Marketplace package

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

## 3. Install it with nuxeoctl

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

## 4. A kit: Contracts

Kits are the examples we build apps from, and test the platform with. They are not a customer
deliverable. The Contracts kit needs nothing but the Marketplace package.

**Build it, in your clone:**

```bash
cd "$SATORI_UI"
```

```bash
npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0
```

You should see:

```text
contracts-demo 0.2.2: checked, built and verified: business-apps/packages/contracts-demo/dist/contracts-demo-0.2.2.zip
```

**Install it:**

```bash
demo_install "$SATORI_UI/business-apps/packages/contracts-demo/dist/contracts-demo-0.2.2.zip"
```

Its dependency, `nuxeo-agentic-ui:2026.0.2`, is met by the package you installed: it is listed
under "Unchanged packages". The status line reads
`Pending: 0 / Missing: 0 / Unstarted: 0 / Total: 574`.

**Its groups, with you in them.** Its `app.json` names two, `contract-managers` and
`legal-reviewers`:

```bash
for g in contract-managers legal-reviewers; do
  curl -s -o /dev/null -w "$g: %{http_code}\n" -u "$NUXEO_USER:$NUXEO_PASS" \
    -H 'Content-Type: application/json' -X POST http://localhost:8090/nuxeo/api/v1/group \
    -d "{\"entity-type\":\"group\",\"groupname\":\"$g\",\"grouplabel\":\"$g\",\"memberUsers\":[\"$NUXEO_USER\"]}"
done
```

You should see `201` twice, after which `apps.json` lists `contracts`.

**Seed it:**

```bash
NUXEO_URL=http://localhost:8090 APP_URL=http://localhost:8090/nuxeo/agentic-ui node business-apps/packages/contracts-demo/demo/seed.mjs
```

You should see `Done: 9 created, 0 updated, 0 restored from the trash. The page providers return
what was seeded.`, then five links: the home, the queue and three contracts.

**See it.** Reload the app, and open the links the seed printed. The kit's README says what each
page should show:

- the home's renewals figure is 3;
- the queue lists CTR-1007, CTR-1001 and CTR-1002, in that order.

Neither page was looked at in a browser in the trial.

### The other kits

Each kit's README gives its groups and its seed. They were installed on the local `nuxeo` from
local builds, and never on a server made this way.

| Kit                                                    | Needs, besides the Marketplace package                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `facilities-demo`, `moves-demo`, `vehicle-titles-demo` | Nothing                                                                              |
| `brand-assets-demo`, `media-demo`                      | `nuxeo-agentic-assets`                                                               |
| `controlled-documents-demo`                            | `nuxeo-agentic-documents`                                                            |
| `pc-claims-demo`                                       | `nuxeo-agentic-capture`                                                              |
| `onboarding-demo`                                      | `nuxeo-agentic-signature`, `nuxeo-agentic-records`                                   |
| `records-demo`                                         | `nuxeo-agentic-records`, which needs Nuxeo's `nuxeo-retention` from Connect          |
| `payers-claims-demo` 0.8.0                             | `nuxeo-agentic-letters`, which needs Nuxeo's `nuxeo-template-rendering` from Connect |

An add-on is built from the clone with Maven and a JDK. For example:

```bash
mvn package -pl nuxeo-agentic-assets -am -B -DskipTests
```

That writes `nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.6.0.zip`. Install the add-on and
the kit in one call, the add-on first:
`demo_install <add-on zip> <kit zip>`.

## 5. Your configuration repository

This is what a customer does, with nothing of the Nuxeo-Satori-UI repository: no clone, and no
token. Do it outside the clone:

```bash
cd "$DEMO"
npx --@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/ \
  @nuxeo/satori-cli@alpha create acme-satori --name acme-config --owner acme
```

```bash
cd "$DEMO/acme-satori"
git init
npm install
git add .
git commit -m "A Nuxeo Satori configuration repository"
```

`npm install` fetches one package, the tool, from Nuxeo's registry, through the `.npmrc` that
`create` wrote.

```bash
npm run validate
npm run build
```

You should see this. The build is reproducible, so your checksum is the trial's:

```text
acme-config 1.0.0: checked, built and verified: dist/acme-config-1.0.0.zip, sha256 dbbe59ed99ed08c9091b0b0862172447e433f8d750ebbf577870ec6bf77426b4
```

**The server's content model,** for the agent and for `--model`. Create `tmp/` first, because
0.3.0 does not create it (see [Found by the trial](#found-by-the-trial-not-fixed-yet)):

```bash
mkdir -p tmp
./node_modules/.bin/satori model pull --server http://localhost:8090/nuxeo --out tmp/content-model.json
```

With the Contracts kit installed, you should see 51 document types, 63 facets and 88 schemas.

**Install it:**

```bash
demo_install dist/acme-config-1.0.0.zip
```

```bash
curl -s http://localhost:8090/nuxeo/agentic-ui-config/bootstrap.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s).fragments)console.log(f.name,"|",f.component,"|",f.content.branding?.applicationTitle??"")})'
```

You should see two fragments:

- `defaults`, Satori's own;
- `acme-config | acme.config.acme-config | Acme Config`, yours.

**Change it, and install the change.**

1. In `config-packages/acme-config/bundle/agentic-ui-config/bootstrap.json`, set `applicationTitle`
   and `documentTitle` to `Acme Claims Portal`.
2. In `config-packages/acme-config/package/package.xml`, raise `version="1.0.0"` to
   `version="1.0.1"`. Nuxeo skips a package it already has at the same version.

Then:

```bash
npm run validate && npm run build
```

```bash
./node_modules/.bin/satori upgrade-check config-packages/acme-config --previous dist/acme-config-1.0.0.zip
```

```bash
demo_install dist/acme-config-1.0.1.zip
```

You should see:

- from `upgrade-check`, `acme-config 1.0.1, held to 1.0.0: every configuration is kept.`;
- from the install, `Packages to upgrade (1): acme-config:1.0.0`, then
  `Uninstalling acme-config-1.0.0` and `Installing acme-config-1.0.1`;
- from the same `curl` as above, the new title, `Acme Claims Portal`.

Reload the app to see it. That was not looked at in a browser in the trial. Then commit:

```bash
git commit -am "Acme Claims Portal, 1.0.1"
```

## 6. With your AI IDE

**Not run in the trial.** The customer guide,
[customer-config-repository.md](customer-config-repository.md), section 3, is the reference.

`create` already wrote the agent files:

- the app builder skill, in `.claude/`, `.cursor/` and `.agent/`;
- `AGENTS.md`;
- the MCP server `nuxeo-satori`, in `.mcp.json` and `.cursor/mcp.json`.

The MCP entries name the server's address and credentials as references to the environment, so
start the IDE from a shell that has them:

```bash
export NUXEO_URL=http://localhost:8090
cd "$DEMO/acme-satori"
claude
```

`NUXEO_USER` and `NUXEO_PASS` are already set from part 0. Open the folder in Cursor instead, if
you use it.

In Claude Code, `/mcp` should list `nuxeo-satori` as connected. Then ask, for example:

> Add an app definition to the acme-config package for our Contract documents: an app with the id
> `acme-contracts`, for the group `contract-managers`, with a record page showing the contract's
> number, counterparty, end date and status, and a queue of the active contracts.

Give it an id and an address of its own. The kit's are `contracts` and `contract-desk`, and the
tool compares names only with the packages in your repository, not with what the server already
has. The agent keeps a write only if the package still passes `satori validate`.

Then do what part 5 does:

1. `npm run validate` and `npm run build`;
2. raise the version;
3. run `demo_install`;
4. reload the app.

`preview_package` refuses in your repository: you see the page by installing the package.

## 7. Removing everything

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

`-v` removes the container's three volumes: its data, its logs and its `/tmp`. The kit's `dist/`
in your clone is ignored by git. Nothing on `nuxeo` or in its indices was touched.

## If something goes wrong

- **`docker run` says the name `/satori-demo` is already in use.** Run part 7 first.
- **The container stops at its first start.** Run `docker logs --tail 50 satori-demo`.
  - `Registration required` means there is no `NUXEO_CLID`.
  - An OpenSearch connection error means `nuxeo-opensearch` is not running on `nuxeo-net`.
- **`demo_install` printed `demo install failed`.** Read
  `docker exec satori-demo cat /var/log/nuxeo/demo-install.log`. A package at a version already
  installed is listed as unchanged and skipped, so raise its version.
- **The status line shows something pending or missing.** Read the server log,
  `docker exec satori-demo tail -200 /var/log/nuxeo/server.log`, for the component it names.
- **No app is listed.** Check that you are in one of the app's groups (`apps.json`), then reload
  the app.

## What was checked on 28 November 2026

On macOS, Docker Desktop, Nuxeo 2025.26.16 and Node 24 or later, with the commands above. The one
difference: `demo_install`'s commands were run one by one against the server, not as the function.
The function itself was then run in zsh and in bash, with `docker` and `curl` replaced by
stand-ins. It wrote the same one-off script, and made the same calls in the same order.

- **Part 1.**
  - The server was up in 18 seconds, with the two OpenSearch packages started and its own two
    indices.
  - `nuxeo` on 8080 still answered afterwards.
- **Part 2.** The package's checksum and `package.xml` were as given above.
- **Part 3.**
  - The install took 39 seconds, with 0 pending and 0 missing out of 572 components.
  - Through the sign-in form, `POST /nuxeo/startup` answered 302 to `agentic-ui/index.html`, and
    the app's page answered 200.
  - `apps.json` was empty, and the diagnostics named the package.
- **Part 4.**
  - The kit built, installed with 0 pending and 0 missing out of 574, and its dependency was met.
  - Its `Contract` type and layouts were served, and both groups were created (201).
  - `apps.json` listed `contracts`.
  - The seed created 9 documents and checked its three page providers.
- **Part 5.**
  - `create`, `npm install`, `validate` and `build` ran, with the checksum above.
  - `model pull` worked once `tmp/` existed.
  - 1.0.0 installed and was served as `acme.config.acme-config`.
  - 1.0.1 was upgraded over it, and the served title changed.
- **Part 7.** The container, its three volumes and both indices were removed.
- **Not seen:**
  - any page in a browser: the sign-in page, the app, the kit's home and queue, the new title;
  - part 6;
  - the other kits on a server made this way.

## Found by the trial, not fixed yet

Both are in `@nuxeo/satori-cli` 0.3.0.

- **`satori model pull --out tmp/content-model.json` fails with `ENOENT` in a new repository.**
  `create` writes no `tmp/`, and the tool does not create the folder it writes to. The customer
  guide gives the command without the `mkdir`.
- **`satori validate --model` passes with a model file that does not exist,** on a configuration
  package with no app definition, and says nothing about the missing file. It was not checked
  whether the same happens with an app definition.
