# The demo server

Phase 0 of the [development plan](../../docs/business-apps/development-plan.md) is done when, among
other things, "the demo server is up", and every phase after ends in a demo on it, installed from
packages the pipeline built. This folder holds the one documented, repeatable way to stand one up
from a [release candidate](../../docs/business-apps/package-pipeline.md#11-a-release-candidate-across-all-kits)'s
output directory, for whoever runs the shared server.

Status, 25 November 2026: **built, and not run against Docker.** No stack has been started from it
anywhere: the machine it was written on runs the local Nuxeo on 8080, which a test run would have
stood beside. What was checked is offline: its controls, and its dry run on a candidate built from
`staging/enterprise-grade-app` ([below](#what-was-checked-and-what-was-not)).

## The short version

- **One command, from a candidate's output directory:**
  `npm run demo-server -- --candidate <directory>`. `--dry-run` prints the plan and changes nothing.
- **Docker Compose, two containers,** at the versions the local setup runs: Nuxeo 2025.10.18 and
  OpenSearch 2.13.0 ([`compose.yml`](compose.yml)). Only Nuxeo's port is published, on 127.0.0.1:18080
  by default.
- **Everything installed at the first start, once,** through the one-off install script the kits'
  READMEs use: one `nuxeoctl mp-install` of `nuxeo-agentic-ui`, the add-ons and every kit, in
  dependency order; the bundle of the add-on with no package yet; the deployment's configuration,
  such as the operation buttons' allow-list, in `nxserver/config/`.
- **Then each kit's seed,** and how to run every demo steps file against the server, printed.
- **Secrets from the environment only,** never from a file and never printed. Unset, the run is
  refused.
- **Its own compose project and container names,** never the developer's `nuxeo`. A project that
  already exists is refused, not reused.
- **Nothing pushed, built or published,** and no login: the Nuxeo image is pulled with the Docker
  login the machine already has.

## Before you start

- **A machine with Docker and Compose v2,** macOS or Linux, signed in to the Nuxeo image's
  registry with your own account: `docker login docker-private.packages.nuxeo.com`. The command
  never logs in.
- **A clone of this repository at the candidate's commit,** with `npm ci` run, and Node 24, as
  `.nvmrc` pins; git, `unzip` and `tar`. The candidate does not carry the kits' seeds, their
  deployment configuration or their steps files: these are read from the candidate's commit in
  the clone, through git, so a working tree that has moved on changes nothing installed. The
  commit must be in the clone. A candidate built with uncommitted changes in a kit is refused.
- **A release candidate,** built as the pipeline's section 11 says, into a new directory outside
  the repository:

  ```bash
  npm run release-candidate -- --out ../release-candidate-2026.0.2 --since <the last release>
  ```

- **The secrets,** exported in the shell that runs the command:

  | Variable                     | What it is                                                                                                                                                                                                            |
  | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `NUXEO_CLID`                 | The server's Nuxeo Connect registration. The image installs the OpenSearch packages from Connect with it, as the local setup does                                                                                     |
  | `DEMO_SERVER_ADMIN_PASSWORD` | The password the `Administrator` gets in place of the image's default. At least 12 characters, and not `Administrator`                                                                                                |
  | Each seed's demo password    | Today `PAYERS_DEMO_PASSWORD`, the Payers kit's six demo people's. Read from each seed's source, so a kit that adds one adds a variable. At least 8 characters, and not the administrator's: it is given to presenters |

## Running it

**1. The plan, changing nothing.** It reads the candidate, holds every file to `SHA256SUMS`, puts
the packages in dependency order, reads the seeds and the configuration from the commit, asks
Docker what the project already has, and checks the port. It needs no secret, and says which are
set.

```bash
npm run demo-server -- --candidate ../release-candidate-2026.0.2 --dry-run
```

**2. The server.** The first start installs two packages from Connect and six from the candidate,
which takes minutes; `--wait` gives it 20 by default.

```bash
npm run demo-server -- --candidate ../release-candidate-2026.0.2
```

| Option      | Default       | What it is                                                                                                                                                                      |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project` | `satori-demo` | The compose project: `satori-demo`, or `satori-demo-` and a name, so its containers, `<project>-nuxeo-1` and `<project>-opensearch-1`, can never be named as the developer's    |
| `--port`    | `18080`       | Nuxeo's port on the host. Never 8080, the local Nuxeo's, 4200 or 4300, the development servers', or 9200                                                                        |
| `--bind`    | `127.0.0.1`   | The address the port is published on. The image's default `Administrator` password holds for the seconds between the first answer and the change: to expose it wider, `0.0.0.0` |
| `--wait`    | `1200`        | Seconds to wait for the first answer                                                                                                                                            |
| `--dry-run` |               | Print the plan, and change nothing                                                                                                                                              |

Exit codes: 0, the server is up, or the dry run printed its plan; 1, a step failed once something
was made, and the output says what is left; 2, refused, and nothing was made, or a dry run whose
run would be refused, for the project, the port or Docker; 128 and the signal's number, 130 for
Ctrl-C, interrupted.

## What it does, in order

| Step                             | What happens, and what refuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The candidate                 | `manifest.json` in the release candidate's format, with a version a candidate may carry, since the install script holds it. Every file `SHA256SUMS` lists, with its digest; no file it does not list, and no link inside it. Every artifact the manifest names, with the manifest's digest. Each zip's `package.xml` names the package the manifest says; the kits the manifest lists are the kits it ships; no two files share a name                                                                                                                                                                                                                                                                                                                                |
| 2. The order                     | The server packages and the kits, each after the packages it depends on, with ties broken server packages first, then by name. Refused, naming each problem: a dependency the candidate does not hold or holds at a version Nuxeo does not count as meeting it, a conflict, a package named twice, a target platform outside a dependency's (the candidate's own rules, `release-candidate-set.mjs`), a target platform that leaves out Nuxeo 2025.10.18, and a cycle                                                                                                                                                                                                                                                                                                 |
| 3. The add-ons with no package   | A bundle the candidate ships that no package's `install/bundles/` carries, found by its bytes: today `nuxeo-agentic-connectors`, which has no Marketplace package yet. Its bundle goes into `nxserver/bundles/`, as its README installs it. No connector is contributed: its demo needs the stand-in core system and a token, and its security review is open                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4. The deployment's files        | Each kit's `deployment/*-config.xml` at the commit, such as the Payers kit's operation allow-list, for `nxserver/config/`, the one place the server reads it from. `deployment/build-allow-list.json` is a build input and is not placed. Two kits placing the same file name are refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5. The secrets                   | Each one set; the administrator's not the default, and at least 12 characters; each demo password at least 8, and not the administrator's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6. Docker, the project, the port | Docker and Compose v2 answer. No container, volume or network that compose labels as the project's, or that has one of its names. Nothing listening on the port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7. Made, not started             | `compose pull`. The project checked again, since the pull can take minutes. `compose create --no-recreate`, every container labelled with this run's own mark, which is read back from the Nuxeo container before anything is copied in: a container with another run's mark is another run's, and is not touched. Into the container, every file set readable by anyone first, whatever the umask, since `docker cp` keeps modes and the files are not the `nuxeo` user's: [`90-demo-server.conf`](90-demo-server.conf), the OpenSearch settings, in `/etc/nuxeo/conf.d/`, which the image merges at its first start; the packages, bundles, configuration and a `plan.json` record in `/docker-entrypoint-initnuxeo.d/demo-server/`; the install script beside them |
| 8. One start                     | `compose up --no-recreate`. The image installs the Connect packages, then runs the install script: one `mp-install --accept=true`, as the kits' READMEs run it, of every package in the plan's order; the bundles; the configuration; then `mp-list` must list every package of the candidate by its id, started or installed. Each step stops the start when it fails. The script removes itself once every step passed, and logs to `/var/log/nuxeo/demo-server-install.log`                                                                                                                                                                                                                                                                                        |
| 9. Secured                       | Once `/nuxeo/runningstatus` answers 200: the `Administrator` user read and written back with `DEMO_SERVER_ADMIN_PASSWORD`, then `/me` checked to answer the new password and refuse the default. A server that refused the default before the change was changed by someone else first: nothing is written to it, and it is stopped                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10. Checked                      | The server log's last `Component Loading Status`: nothing pending, missing or unstarted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11. Seeded                       | Each kit's `demo/seed.mjs`, at the commit, unpacked with `git archive`, in install order, as `Administrator`, with `NUXEO_URL` the server, `APP_URL` its app, and the demo password it reads. The facilities kit has none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 12. Printed                      | The server's address, the install log's, and how to run every demo steps file against it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**When a step fails after step 7,** what was made is left as safe as it can be, and the output
says which: not started yet, it is removed; started and not shown secured, it is stopped and kept
for its logs; started and secured, it keeps running. Nothing is removed or stopped unless every
container, volume and network of the project carries this run's mark, which `compose.yml` gives
each. Ctrl-C, or a stop sent to the command, is handled
the same way. A run is then refused until the project is removed: it never builds on a half-made
one.

## The secrets, and what never sees them

- **From the environment only.** None is in `compose.yml`, the install script, the payload or any
  file the command writes. `NUXEO_CLID` reaches the container through compose's environment, by
  name, when it is created; the image writes it into the container's `instance.clid`, as it does
  for the local setup. Like any container environment, `docker inspect` shows it to whoever may
  use the machine's Docker.
- **Never printed.** What a child prints, Docker or a seed, is printed with each secret taken out:
  its value, a `NUXEO_CLID`'s halves, which the image splits at `--`, and the Basic header of the
  administrator and of each demo person the steps files name. So is the value of every variable
  named as a credential is, `*TOKEN*`, `*PASSWORD*`, `*KEY*`, `*AUTH*` and the like, whether the
  run needs it or not. A refusal names a variable, never its value.
- **Only where needed.** A child is given only what it needs of the environment, by a list of what
  may pass: `PATH`, `HOME`, the locale and a few more. A name that looks like a credential never
  passes, whatever list would let it, and no `COMPOSE_*` can move a command to another project. The
  Docker CLI alone is also given `DOCKER_*`, `DOCKER_PASSWORD`, `DOCKER_TOKEN` and their kind
  excepted, and `SSH_AUTH_SOCK`, for a daemon reached over SSH. `compose create` alone is given
  `NUXEO_CLID`; a seed gets the administrator's password as `NUXEO_PASS` and its own demo password
  by name.
- **Never on a command line, and never in an address.** The administrator's password goes in a
  request's body once, and in `Authorization` headers.

## Running the demo steps against it

The run, and the dry run, print each steps file's command. The steps files are written against
the development server, which serves a kit's files with `config:dev` and proxies `/nuxeo` to a
server named by `NUXEO_PROXY_TARGET` (`proxy.remote.conf.mjs`), here on port 4300, beside a
developer's own on 4200. For each kit, from the clone at the candidate's commit, with the secrets
exported:

```bash
C=business-apps/packages/payers-claims-demo/bundle/agentic-ui-config && npm run config:dev -- <every file of the kit, as printed>
```

```bash
NUXEO_PROXY_TARGET=http://127.0.0.1:18080 npx ng serve nuxeo-ui --configuration=development,remote --port 4300
```

```bash
APP_URL=http://localhost:4300 NUXEO_URL=http://127.0.0.1:18080 NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-operations
```

`config:dev` writes into the clone's `apps/nuxeo-ui/public/agentic-ui-config/`, which a developer's
own dev server also reads. A steps file that names no demo user runs as `Administrator`. The
contracts and facilities kits have no steps file. The installed app itself is at
`http://127.0.0.1:18080/nuxeo/agentic-ui/`.

## Stopping, starting, removing

From the repository's root, with the project the run was given:

```bash
docker compose -f business-apps/demo-server/compose.yml -p satori-demo stop
```

```bash
docker compose -f business-apps/demo-server/compose.yml -p satori-demo start
```

```bash
docker compose -f business-apps/demo-server/compose.yml -p satori-demo down --volumes
```

- **Never `up` it by hand.** The packages are installed in the container, not in an image: a
  container made again is a bare Nuxeo whose volumes still hold records of the kits' types. And
  `up` would make it again: only the command's own `create` gives the container `NUXEO_CLID`, so a
  plain `up` finds its configuration changed. `start` never does.
- **Nothing restarts it by itself** (`restart: 'no'`): a failed install must not loop. After the
  machine restarts, `start` it.
- **A new candidate is a new server:** `down --volumes`, then run the command again, or give it
  another `--project` beside the first, on another `--port`. Upgrading in place is phase 10's
  server-side upgrade test, not this.

## Its controls

```bash
npm run demo-server:selftest
```

Offline, in under half a minute: Docker is a stand-in that records every command and answers as
Docker does, Nuxeo a stand-in HTTP server, and the candidate is written by the controls, its zips
byte by byte. The kits' seeds, configuration and app definitions are the clone's, at HEAD. 138
controls: 95 negative, each feeding in something broken or forbidden that must be refused or
caught, and 43 positive.

- **The plan:** the order, the add-on found by its bytes, the allow-list read from the commit, the
  seeds and their passwords. Refused: a candidate missing a dependency, one held at a version that
  does not meet it, a target platform without Nuxeo 2025.10.18, a cycle, a conflict, a changed,
  extra, missing or linked file, another format, a version a shell would read as more, a kit
  shipped and not listed, two files of one name, a zip whose descriptor is not the manifest's, a
  path in `SHA256SUMS` outside the candidate, a commit the clone does not have, a kit built with
  uncommitted changes.
- **The arguments, the secrets, the script and the files:** each option's refusals; each secret
  unset or empty, the default, a short one, a shared one; the install script in the plan's order,
  each step stopping the start, a hostile version quoted; the script's own `mp-list` checks run by
  bash, passing every package started or installed and stopping on one missing or only
  downloaded; each kit's `config:dev` command holding its README's arguments; the compose file
  declaring the images, services, volumes, network, the run's mark on each, and the one port the
  plan describes.
- **The machine:** the project's resources found by label and by name, and the developer's not;
  a port in use; the wait ended by its container stopping and by its deadline; the password
  changed, and refused against a server that refused the default first or keeps it after;
  redaction of each form a secret takes, and of every credential under any name; each child's
  environment, Docker's settings to Docker alone and Docker's credentials to no child; a child's
  stop read as its own signal; files made 0600 set readable; the commit's kit folder unpacked and
  a seed run with exactly its environment.
- **The command:** each secret unset, an existing project and a candidate missing a dependency
  refused with exit 2 and no Docker command that changes anything; a project another run made
  during the pull, refused before create; a container with another run's mark, touched in no way;
  a create that fails, removed, and one beside another run's volume, left; a dry run; a start that
  fails under umask 077, stopped, with every file it copied in readable; a copy that fails,
  removed; a pull that fails, nothing made; a container that stops, its log printed; a run that
  comes up, its calls in order; a run whose real seed, the contracts kit's, refuses the stand-in,
  left running; Ctrl-C to the whole process group while it waits, stopped with exit 130. Every run
  has Docker's credentials in its environment, and Docker's stand-in says every secret as it
  pulls, creates and starts, in its logs, its exec answers and its failures. No run prints one,
  puts one on a command line, gives one to a child, copies into a container compose did not
  answer, gives `NUXEO_CLID` to anything but `compose create`, or pushes, builds, tags or logs in.

CI runs them in `release-candidate.yml`'s controls job.

**Seen failing,** on 25 November 2026: each guard taken out of the code one at a time, the
controls run, and the code put back byte for byte. Each turned at least one control red:

| Guard taken out                                                        | Controls that failed                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The command's refusal of unset secrets                                 | 3: each secret unset, with exit 2                                                                        |
| The rule that finds an unset secret                                    | 10: those 3, the rule's 6, and the dry run's report                                                      |
| The command's refusal of an existing project                           | 2: the run's and the dry run's                                                                           |
| The match by compose's project label                                   | 1                                                                                                        |
| The candidate's set rules in the install order                         | 4: the missing dependency in the plan and the command, an unmet version, a conflict                      |
| The redaction                                                          | 6: the function's own, a seed's output, Docker's failure, a container's log, and two runs' success paths |
| The copy's target, made `nuxeo:`                                       | 2: what is copied where, and every target the container compose answered                                 |
| `--no-recreate` on `compose up`                                        | 4: every run that starts                                                                                 |
| The modes set on the payload                                           | 2: the function's own, and the copy under umask 077                                                      |
| Both interruption guards, in the wait and in the catch                 | 1: the run sent Ctrl-C. Either one alone still exits 130                                                 |
| The project asked again before create                                  | 1                                                                                                        |
| The run's mark read before anything is copied in                       | 1                                                                                                        |
| `DOCKER_*` passed to every child, not to Docker alone                  | 2: a seed's environment, and every other child's                                                         |
| Cleanup checking the containers' marks only, not volumes' or networks' | 1: a create that fails beside another run's volume                                                       |
| Every stop read as Ctrl-C                                              | 1: a child's stop read as its own signal                                                                 |

A first try at the missing dependency hung: with the refusal gone, the command went on to wait
twenty minutes for a server that was never there. Every command the controls run now has a short
`--wait` and is killed after a minute, so a guard taken out fails its control instead.

## What was checked, and what was not

- **The dry run, on a candidate built from `staging/enterprise-grade-app` at `ef4daba56`,** held
  to the tip itself: 86 files held to their checksums; `nuxeo-agentic-assets` 0.1.0,
  `nuxeo-agentic-ui` 2026.0.2, then the brand assets, contracts, facilities and Payers kits, the
  brand kit after both packages it depends on; the connectors' bundle; the Payers allow-list; three
  seeds, the Payers one with `PAYERS_DEMO_PASSWORD`; seven steps files with their commands.
- **`compose.yml`,** with `docker compose config`, which reads the file and makes nothing:
  `NUXEO_CLID` passed through only when set, and the port's interpolation.
- **The image,** read without starting it: its entrypoint runs every `.sh` file in
  `/docker-entrypoint-initnuxeo.d/` with bash before the server starts, under `set -e`, so a
  script that exits 1 stops the start; it merges `/etc/nuxeo/conf.d/` and installs
  `NUXEO_PACKAGES` once, at the first start; `/docker-entrypoint-initnuxeo.d/` belongs to the
  `nuxeo` user, so the script can remove itself; `docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025.10.18`
  is the tag of the version the local container runs.
- **Not checked, since nothing was started.** The first run should look at each:
  - that one `mp-install` of the candidate's six packages, after the two the image installs from
    Connect, installs them all: the kits' READMEs ran it with two;
  - `nuxeoctl mp-list`'s lines as Nuxeo 2025 prints them: the script fails the start unless each
    package's `id: <name>-<version>)` is on a line saying started or installed, a form read from
    Nuxeo's documentation, never from this image;
  - a Docker daemon reached other than through the local socket, `DOCKER_HOST=ssh://` with
    `SSH_AUTH_SOCK` say: the Docker CLI is given both, and no proxy variable;
  - that `docker cp` into a container created and not started lands where the image reads it, and
    that the files, owned by root there, are read by the `nuxeo` user as their modes allow;
  - the OpenSearch keys in `90-demo-server.conf`, taken from the fix-bug skill's dedicated
    containers, and that the queues' aggregates answer;
  - the administrator's password change through `PUT /user/Administrator`, the way the Payers
    seed writes its people, never run on the administrator;
  - the `Component Loading Status` line as Nuxeo 2025 prints it;
  - that `nxserver/config/` keeps the allow-list through the server's first configuration;
  - picture conversion in the image, which the brand kit's steps need;
  - each seed and each steps file, which have run only against the local server.
