# Business apps: the administrator's guide

For a Nuxeo administrator who installs the business apps on a server: the platform package, its
add-ons and the kits. Each piece has its own README and pull request; this guide puts in one place
what an administrator installs, sets and checks, and names the file each statement comes from.
Where a README and the code disagree, it follows the code.

Status, 25 November 2026, read from `staging/enterprise-grade-app` at `c6f67abe5`: **nothing here
is ready for production.** Every piece is built and tested, most have run on no server, several
wait for a security review, and some are built on open decisions
([section 9](#9-what-is-not-production-ready-yet)). Install them on a test server.

## 1. What there is to install

| Package                     | What it is                                                                                                                                                                                        | Depends on                                                   | On staging                       | Installed so far                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------- | ------------------------------------------------- |
| `nuxeo-agentic-ui`          | The app: the `nuxeo-agentic-core` bundle and the client, which it copies to `nxserver/nuxeo.war/agentic-ui`, served at `/nuxeo/agentic-ui/`                                                       | Nothing                                                      | 2026.0.2 once stamped            | Earlier builds, on the local server only          |
| `nuxeo-agentic-assets`      | An asset's rights, enforced on the server at the platform's download endpoints and video operations, an asset's share links, and media rights: territories, release windows and delivery packages | Nothing                                                      | 0.4.0                            | Nowhere                                           |
| `nuxeo-agentic-connectors`  | `Connector.Read`, live fields from another system on a record page, kept per connector, and change events. **A bundle, no package yet**                                                           | No package                                                   | 0.1.0, its jar 2026.0.2-SNAPSHOT | Nowhere                                           |
| `nuxeo-agentic-documents`   | Controlled documents: numbers from the platform's sequencer, unique per series, and a new revision superseding the one before it                                                                  | Nothing                                                      | 0.1.0                            | Nowhere                                           |
| `nuxeo-agentic-signature`   | The e-signature step: a record's file sent to its signers, the callback authenticated, the signed file filed. A stand-in provider only                                                            | Nothing                                                      | 0.1.0                            | Nowhere                                           |
| `nuxeo-agentic-capture`     | Capture: mail uploaded into an inbox classified, its fields extracted, matched and filed on its record, or queued for a person                                                                    | Nothing                                                      | 0.1.0                            | Nowhere                                           |
| `payers-claims-demo`        | The Payers kit: members, claims, cases, a claims review workflow, appeals with their review workflow and two operation buttons                                                                    | `nuxeo-agentic-ui:2026.0.2`                                  | 0.7.0                            | 0.6.1 on the local server; 0.7.0 nowhere          |
| `brand-assets-demo`         | The brand assets kit: an asset library, pictures and videos, whose rights the server enforces                                                                                                     | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-assets:0.3.0`    | 0.2.4                            | 0.2.0 on the local server; 0.1.1 to 0.2.4 nowhere |
| `contracts-demo`            | The contracts kit: a record page, an edit form, a renewals queue                                                                                                                                  | `nuxeo-agentic-ui:2026.0.2`                                  | 0.2.1                            | Nowhere                                           |
| `facilities-demo`           | The tutorial's work-order app                                                                                                                                                                     | `nuxeo-agentic-ui:2026.0.2`                                  | 0.1.1                            | Nowhere                                           |
| `moves-demo`                | The moves kit: moves with their inventories, damage claims with their attachments, two queues                                                                                                     | `nuxeo-agentic-ui:2026.0.2`                                  | 0.2.0                            | Nowhere                                           |
| `pc-claims-demo`            | The P&C claims kit: property claims and their policies, photos and documents, three queues, a core-system card, a claims mail inbox                                                               | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-capture:0.1.0`   | 0.2.0                            | Nowhere                                           |
| `controlled-documents-demo` | The controlled documents kit: an engineering register, its record page with the superseded banner, a queue of current documents                                                                   | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-documents:0.1.0` | 0.1.0                            | Nowhere                                           |
| `nuxeo-agentic-records`     | The disposition review on the retention module: runs, two approvals, deletion, a certificate; the audit export, access logging                                                                    | `nuxeo-retention:2025.0.0`, Nuxeo's own Marketplace package  | 0.2.0                            | Nowhere                                           |
| `records-demo`              | The records kit: runs awaiting approval, a run's page, a certificate's page, the audit exports, a record's history                                                                                | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-records:0.2.0`   | 0.1.1                            | Nowhere                                           |
| `onboarding-demo`           | The onboarding kit: cases with their KYC checklist and an e-signature step, disputes, three queues                                                                                                | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-signature:0.1.0` | 0.1.0                            | Nowhere                                           |
| `media-demo`                | The media kit: a film's page with its release windows and localised versions, a version's page, the deliveries and a delivery's page                                                              | `nuxeo-agentic-ui:2026.0.2`, `nuxeo-agentic-assets:0.4.0`    | 0.1.0                            | Nowhere                                           |
| `vehicle-titles-demo`       | The vehicle titles kit: vehicle deals with their checklist of required documents and phone capture, titles and their liens, three queues                                                          | `nuxeo-agentic-ui:2026.0.2`                                  | 0.1.0                            | Nowhere                                           |

Sources: each package's `package.xml`
([`nuxeo-agentic-ui`](../../nuxeo-agentic-ui-package/src/main/resources/package.xml),
[`nuxeo-agentic-assets`](../../nuxeo-agentic-assets/src/main/package/package.xml),
[`nuxeo-agentic-documents`](../../nuxeo-agentic-documents/src/main/package/package.xml), and each kit's
`package/package.xml`), [`assembly.xml`](../../nuxeo-agentic-ui-package/src/main/assemble/assembly.xml),
the [assets add-on's README](../../nuxeo-agentic-assets/README.md) ("It is not installed
anywhere"), the [connectors README](../../nuxeo-agentic-connectors/README.md) ("Nothing here is
installed on any server yet"), and the kits' READMEs:
[Payers](../../business-apps/packages/payers-claims-demo/README.md),
[brand assets](../../business-apps/packages/brand-assets-demo/README.md),
[contracts](../../business-apps/packages/contracts-demo/README.md),
[facilities](../../business-apps/packages/facilities-demo/README.md),
[moves](../../business-apps/packages/moves-demo/README.md),
[P&C claims](../../business-apps/packages/pc-claims-demo/README.md),
[controlled documents](../../business-apps/packages/controlled-documents-demo/README.md),
[records](../../business-apps/packages/records-demo/README.md),
[onboarding](../../business-apps/packages/onboarding-demo/README.md),
[media](../../business-apps/packages/media-demo/README.md) and
[vehicle titles](../../business-apps/packages/vehicle-titles-demo/README.md); the
[documents add-on's README](../../nuxeo-agentic-documents/README.md) ("It is not installed anywhere")
the [records add-on's README](../../nuxeo-agentic-records/README.md) ("Nothing here is installed
on any server"), the [e-signature add-on's README](../../nuxeo-agentic-signature/README.md)
("Nothing here is installed on any server") and the [capture add-on's README](../../nuxeo-agentic-capture/README.md)
("Nothing here is installed on any server yet").

- **Every package targets Nuxeo LTS `[2025.0,2026.0)`** in its `package.xml`. What was checked was
  checked against Nuxeo 2025.10.18.
- **The kits are starter kits.** Their data is fictional, and each ships a stand-in content model,
  "replaced whole" when a customer's own arrives (each kit's README, "The short version").
- **Besides the packages, a deployment has files of its own,** which no package carries: server
  properties, and contributions in `nxserver/config/` such as the operation buttons' allow-list
  ([section 4](#4-server-settings-and-contributions)).

## 2. Before you start

- **A search index.** A queue's facets and the home's figures read a page provider's aggregates,
  and "aggregates come from the search index" ([app-definition-v2.md](app-definition-v2.md),
  section 10; [tutorial.md](tutorial.md), step 10). The demo server runs OpenSearch 2.13.0 and
  installs `nuxeo-search-client-opensearch2` and `nuxeo-audit-opensearch2` from Nuxeo Connect
  ([`compose.yml`](../../business-apps/demo-server/compose.yml)). OpenSearch serves a query's
  results only up to its `index.max_result_window`, 10,000 by default, and a page past it is an
  HTTP 500; the app's queues and record lists offer no page past the window, and say so
  ([api-integrations.md](../api-integrations.md), section 33).
- **The packages, built from source.** No package is published: a kit is released by its tag
  `app-package/<name>/<version>`, and none has been pushed
  ([package-pipeline.md](package-pipeline.md), section 11). The one command that builds every
  package, and checks on paper that they hold together as a set, is the release candidate; it
  installs nothing. It runs from a clone with
  `npm ci` run, Node 24, Maven with a JDK, `unzip`, git and `tar`
  ([package-pipeline.md, section 11](package-pipeline.md#11-a-release-candidate-across-all-kits)):

  ```bash
  npm run release-candidate -- --out ../release-candidate-2026.0.2 --since <the last release> --unsigned-kits
  ```

  It writes the server packages in `server/`, the kits in `kits/`, a `SHA256SUMS`, a
  `manifest.json` and a `RELEASE-NOTES.md`. No kit is signed yet either, so the command is told to
  take them unsigned, `--unsigned-kits`, and says so in its manifest and release note; given the
  kits' signatures instead, `--signatures <folder>`, it holds each kit to its own. A kit is signed
  by its tag's run, and checked before it is installed
  ([section 3](#checking-a-kit-before-you-install-it)).

- **A stamped `nuxeo-agentic-ui`.** A plain `mvn package` leaves `@VERSION@` in the package's
  `package.xml`, which Nuxeo reads as 0.0.0, so it does not upgrade an installed one; and Nuxeo
  counts neither `2026.0.2-SNAPSHOT` nor `2026.0.2-rc.1` as meeting a kit's dependency on
  `nuxeo-agentic-ui:2026.0.2` ([package-pipeline.md](package-pipeline.md), section 11). The
  release candidate stamps it; the
  [Payers README](../../business-apps/packages/payers-claims-demo/README.md#installing-it-on-a-local-nuxeo),
  step 1, shows the stamp by hand.
- **The server stopped for every install and removal.** `nuxeoctl mp-install` and `mp-remove`
  refuse while the server runs. In the Docker image the server is the container's main process, so
  the kits' READMEs install with a one-off script in `/docker-entrypoint-initnuxeo.d/`, which the
  image runs before the server at every start, and which removes itself
  ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#installing-it-on-a-local-nuxeo)).
- **A Nuxeo administrator's account** for the seeds and the checks. The Payers seed must run as an
  administrator, since it creates users and groups
  ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#seeding-it)).

## 3. Installing, in order

**Check each kit's signature before you install it**
([below](#checking-a-kit-before-you-install-it)), and install nothing the check refuses.

The order the [demo server](../../business-apps/demo-server/README.md) installs in, at one start,
"What it does, in order", steps 2 to 8:

1. **`nuxeo-agentic-ui`, then `nuxeo-agentic-assets` if a kit needs it, then the kits,** each
   after the packages it depends on, in one `nuxeoctl mp-install --accept=true`. Today only the
   brand assets kit needs the assets add-on; name the add-on before the kit
   ([brand assets README](../../business-apps/packages/brand-assets-demo/README.md#installing-it-on-a-local-nuxeo)).
   The records kit needs `nuxeo-agentic-records`, which needs Nuxeo's own retention module,
   `nuxeo-retention`, from Nuxeo's Marketplace for a registered server, at a version for the
   server's LTS 2025: install the module, then the add-on, then the kit
   ([records kit README](../../business-apps/packages/records-demo/README.md#installing-it-on-a-server-of-your-own)).
2. **The connectors bundle, only where a kit contributes a connector.** It has no package: its jar
   goes into `nxserver/bundles/` ([connectors README](../../nuxeo-agentic-connectors/README.md),
   "Installing it"). One kit configures one: the P&C claims kit's `pcclaims.policyPayments`, whose
   contribution is `demo/pc-claims-connectors-config.xml`, outside its package, since the bundle has
   no package to depend on
   ([P&C claims README](../../business-apps/packages/pc-claims-demo/README.md#connecting-the-core-system)).
   The Payers kit's opt-in is described and "not done here" (same README, "How a kit opts in").
3. **The deployment's own contributions, into `nxserver/config/`.** Each kit's
   `deployment/*-config.xml`, which today is the Payers kit's operation allow-list, and, with the
   connectors bundle, the P&C claims kit's `demo/pc-claims-connectors-config.xml`. A file there
   whose name ends in `-config.xml` is a contribution the server reads at start. Never place
   `deployment/build-allow-list.json`: it is a build input
   ([demo server README](../../business-apps/demo-server/README.md), step 4;
   [Payers README](../../business-apps/packages/payers-claims-demo/README.md#over-version-041-version-050-with-the-operation-buttons)).
4. **The server properties you need,** from [section 4](#4-server-settings-and-contributions),
   in `nuxeo.conf`. See "On an existing Docker container", below, before you use `conf.d`.
5. **Start the server, and check it** (the kits' READMEs, "Check it"):
   - each install log lists its packages installed;
   - the server log's last `Component Loading Status` has nothing pending or missing;
   - `/nuxeo/agentic-ui-config/layouts.json` lists the kits' layouts, and
     `/nuxeo/agentic-ui-apps/apps.json` answers, `"apps" : [ ]` for an administrator in no app's
     groups ([tutorial.md](tutorial.md), step 10);
   - with the Payers allow-list in place, the server log names it:
     `Payers.RequestMedicalRecords allowed by payers-claims-demo.deployment.operations`
     ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#over-version-041-version-050-with-the-operation-buttons));
   - with the assets add-on, the log names `org.nuxeo.agentic.assets.rights` and its kit's
     `nuxeo.config.brand-assets-demo.rights` and `nuxeo.config.brand-assets-demo.video-rights`,
     and has no `Asset rights:` error
     ([assets README](../../nuxeo-agentic-assets/README.md#installing-it-on-a-local-nuxeo)).
6. **Create the groups each app names, and put people in them** ([section 4](#the-app-registrys-groups)).
   An administrator in none of them sees no app.
7. **Seed the demo data, on a demo server only** (each kit's README, "Seeding it").

On a Docker container, copy the zips into the container's `/tmp/` with `docker cp`, then write
the one-off script. This is the one the Payers README runs for its 0.5.0 upgrade; name every zip
you install, in the order above:

```bash
printf '%s\n' '#!/bin/bash' '{ nuxeoctl mp-remove payers-claims-demo --accept=true && nuxeoctl mp-install /tmp/nuxeo-agentic-ui.zip /tmp/payers-claims-demo-0.5.0.zip --accept=true; } > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

On a first install there is nothing to remove: the README's first script runs `mp-install`
alone. **Not run yet** for 0.5.0; the README's install of 0.3.0 was run, on 23 November 2026.

### Checking a kit before you install it

A kit released by its tag `app-package/<name>/<version>` is signed by the repository's
`app-packages.yml` workflow, keyless, through Sigstore
([package-pipeline.md](package-pipeline.md), section 9). Before `nuxeoctl mp-install`, check that
the zip you hold is the one that workflow signed, for the version you mean to install. Either with
the GitHub CLI, signed in to GitHub, which reads the signature from the repository's attestations:

```bash
gh attestation verify payers-claims-demo-0.7.0.zip --repo nuxeo/Nuxeo-Satori-UI \
  --predicate-type https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1 \
  --cert-identity https://github.com/nuxeo/Nuxeo-Satori-UI/.github/workflows/app-packages.yml@refs/tags/app-package/payers-claims-demo/0.7.0 \
  --source-ref refs/tags/app-package/payers-claims-demo/0.7.0 --deny-self-hosted-runners
```

or from a clone of the repository, with the signature beside the zip,
`payers-claims-demo-0.7.0.zip.sig.json`: the tag run's artifact `app-package-signature` for 30
days, and at any time the repository's attestations of the zip, downloaded and renamed. This also
holds the zip to its own `package.xml`, and the signer to the repository's trusted signers,
`business-apps/trusted-signers.json`, or yours with `--trusted-signers`:

```bash
gh attestation download /tmp/payers-claims-demo-0.7.0.zip --repo nuxeo/Nuxeo-Satori-UI \
  --predicate-type https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1
mv "sha256:$(sha256sum /tmp/payers-claims-demo-0.7.0.zip | cut -d' ' -f1).jsonl" /tmp/payers-claims-demo-0.7.0.zip.sig.json
npm run app-package:signature -- verify /tmp/payers-claims-demo-0.7.0.zip \
  --name payers-claims-demo --version 0.7.0
```

- **Each says it verified the zip, or refuses it and says why.** Both name the package and the
  tag of the version you install, so a zip of another version, one changed by a byte, or a
  signature made by another workflow, from another repository or for another tag, is refused.
  Checked with the GitHub CLI 2.83.1; an older one that lacks a flag refuses it, and checks nothing.
- **A tag moved since the release** is not seen: a tag deleted and pushed again on another commit
  signs another zip of the same version, and both pass. Until a ruleset forbids moving these tags
  ([package-pipeline.md](package-pipeline.md), section 9.1), keep the SHA-256 of each version you
  install, `sha256sum` of its zip, and refuse a zip of the same version with another.
- **A server with no network:** export Sigstore's trusted root once where there is one,
  `gh attestation trusted-root > trusted_root.jsonl`, and give it with `--trusted-root`. Not tried
  yet.
- **Not signed:** a kit built from source, as the release candidate builds one, which is as sound
  as the clone it came from (the candidate given the kits' signatures, `--signatures`, holds each
  kit it builds to its release's, [package-pipeline.md](package-pipeline.md), section 11); and the
  server packages, `nuxeo-agentic-ui` and the add-ons, which this pipeline does not sign.
- **No kit has been signed yet:** no tag has been pushed. And nothing on the server checks a
  signature: the check is yours, before the install.
- **A signature says which run built the zip, from which commit,** not that the kit is right or
  approved.

### On an existing Docker container: `conf.d` is read at the first start only

The Nuxeo image merges the files of `/etc/nuxeo/conf.d/` into `/etc/nuxeo/nuxeo.conf` only at a
container's first start. Its `/docker-entrypoint.sh` appends them inside
`if [ ! -f $NUXEO_HOME/configured ]` and `if [ ! -f $NUXEO_CONF ]`, then writes the `configured`
marker; read from the 2025.10.18 image of the local container, and said in the "Local mail
setup" of [`nuxeo-conf/README.md`](../../nuxeo-conf/README.md). **A file added to `conf.d` later
is never read, and nothing says so.** A restart leaves the property unset, so a switch stays off
and a connector answers 503.

- **A new container:** put the file in `conf.d` before its first start, as the demo server does
  with [`90-demo-server.conf`](../../business-apps/demo-server/90-demo-server.conf).
- **An existing container:** write the property into `/etc/nuxeo/nuxeo.conf` itself, then restart,
  as [`nuxeo-conf/README.md`](../../nuxeo-conf/README.md) does for its mail settings:

  ```bash
  docker exec nuxeo sh -c 'grep -q "^nuxeo.agentic.ui.layer.enabled=" /etc/nuxeo/nuxeo.conf || echo "nuxeo.agentic.ui.layer.enabled=true" >> /etc/nuxeo/nuxeo.conf'
  ```

  ```bash
  docker restart nuxeo
  ```

  Then check that the server read it: here, the server log's `the DEPLOYMENT LAYER IS ON` line
  ([`AgenticUiConfigComponent.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/AgenticUiConfigComponent.java)).
  These commands follow that README's method and were not run for these properties. A value that
  is a secret, such as a connector's credential, goes in through standard input, never on a
  command line: `docker exec -i nuxeo sh -c 'cat >> /etc/nuxeo/nuxeo.conf' < <file>`. To change or
  remove a property later, edit `nuxeo.conf`: deleting the `conf.d` file does nothing.

## 4. Server settings and contributions

Two places, both the server's and never a package's:

- **Properties** in `nuxeo.conf` (on Docker, [section 3](#on-an-existing-docker-container-confd-is-read-at-the-first-start-only)).
  The deployment layer's are "read once when the component starts"
  ([`LayerSettings.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerSettings.java)):
  restart after a change. `selfApproval` and the `registered` lists are set alike on every server
  of a cluster ([layout designer README](../../libs/features/layout-designer/README.md)).
- **Contributions** in `nxserver/config/`, a file whose name ends in `-config.xml`. A package
  upgrade leaves them where they are
  ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#over-version-041-version-050-with-the-operation-buttons)).

### The properties

| Property                                                                                                                             | Default                                   | What it does                                                                                                                                                                                                                      | Security note                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `nuxeo.agentic.ui.layer.enabled`                                                                                                     | Off; on only when `true`                  | The deployment layer ([below](#the-deployment-layer)). Off, every layer address answers an administrator 404, and the registry serves each package's files; the stored layer is kept, and applies again when it is turned back on | It changes an app for every user of it, from an administrator's screen. Its security review is pending                  |
| `nuxeo.agentic.ui.layer.selfApproval`                                                                                                | Off                                       | On, the administrator who wrote or submitted a draft may approve it. Off, a second administrator approves                                                                                                                         | Turn it on only on a server with one administrator                                                                      |
| `nuxeo.agentic.ui.layer.registered.rules`, `.rowActions`, `.bulkActions`                                                             | Empty                                     | The IDs the deployment registers in its own code beyond the platform's, separated by commas. A layer file that names such an ID not listed here is refused                                                                        | None                                                                                                                    |
| The address property a connector names, `nuxeo.agentic.connectors.<id>.<name>`                                                       | Unset: the call answers 503, nothing sent | The other system's address: `https`, a host, no user, query or fragment                                                                                                                                                           | Never in a contribution, a document, a layout or a request. The connectors' security review is pending                  |
| The credential a connector names: the property `nuxeo.agentic.connectors.<id>.<name>`, or the variable `NUXEO_CONNECTOR_<ID>_<NAME>` | Unset: 503, nothing sent                  | Sent in the one header the connector names. The property is read first, then the environment                                                                                                                                      | Never logged, never in an answer. Keep it where only the Nuxeo user reads it                                            |
| `nuxeo.agentic.connectors.<id>.http.allowed`                                                                                         | Unset: `https` only                       | `true` lets that connector call a plain `http` address                                                                                                                                                                            | For a demo server only                                                                                                  |
| `nuxeo.agentic.connectors.<id>.cache.ttl`                                                                                            | Unset: nothing kept                       | How long that connector's answers are kept, in whole seconds, 1 to 86400; anything else keeps nothing, and the log says so once. Every check of the reader runs before a kept answer is given                                     | A kept answer may be older than the other system's record. The connectors' security review is pending                   |
| `nuxeo.agentic.connectors.<id>.cache.maxEntries`                                                                                     | 1000                                      | The most answers kept for that connector, 1 to 100000, the first kept dropped first; anything else is the default                                                                                                                 | In the server's memory: each answer is at most the connector's `maxBytes`                                               |
| `nuxeo.agentic.connectors.<id>.events.secret`                                                                                        | Unset: no events                          | The secret that connector's system signs its change events with, at least 32 characters, for `POST /nuxeo/agentic-connectors/events/<id>`; shorter takes no events                                                                | Never logged. Keep it where only the Nuxeo user reads it, and share it with the other system only                       |
| `nuxeo.agentic.ui.config.dev`                                                                                                        | Off; on only when `true`                  | Reads a directory of configuration fragments on every request, after every package's                                                                                                                                              | "Never set it in production." The server log warns `DEVELOPMENT OVERRIDES ARE ACTIVE` at start                          |
| `nuxeo.agentic.ui.config.dev.dir`                                                                                                    | `${nuxeo.data.dir}/agentic-ui-config-dev` | That directory. Set alone, it does nothing                                                                                                                                                                                        | As above                                                                                                                |
| `nuxeo.agentic.ui.url`                                                                                                               | Unset                                     | Notification emails' document links. Unset, `agentic-ui/#/doc/<id>` under `nuxeo.url`; set, `#/doc/<id>`, for the notification template in `nuxeo-conf/` to put after it                                                          | A development setting: its sample sets `http://localhost:4200`                                                          |
| `nuxeo.agentic.records.disposition.maxRecords`                                                                                       | 200                                       | The most records one disposition run holds, 1 to 1000, so that its disposal is one transaction of a bounded size                                                                                                                  |
| `nuxeo.agentic.records.audit.export.settleSeconds`                                                                                   | 30                                        | How long after its period's end an audit export waits before it reads the audit, 0 to 600, so that the audit's last entries are in it                                                                                             |
| `nuxeo.agentic.share.groups`                                                                                                         | Unset: administrators only                | The groups whose members may make share links, besides administrators, separated by commas ([below](#share-links))                                                                                                                | A link gives whoever holds it some of an asset's pictures, with no sign-in. The share links' security review is pending |
| `nuxeo.agentic.signature.provider`                                                                                                   | Unset: every request refused, 503         | The e-signature provider requests are sent through, by its id: `standin`, the stand-in, is the only one there is, and signs nothing                                                                                               | For a demonstration server only                                                                                         |
| The stand-in's `nuxeo.agentic.signature.standin.address`, `.apiKey`, `.callbackSecret` and `.callbackSecret.previous`                | Unset: not configured, nothing sent       | Its service's address (`https`, or `http` with `.http.allowed=true`), the key sent to it, and the secret its callbacks are signed with, 32 characters at least, and the one before while it is rotated                            | Never logged; the key and secrets also from the environment. Review pending                                             |
| `nuxeo.agentic.signature.callback.window`                                                                                            | 300                                       | How far a callback's signed time may be from the server's, in seconds, 30 to 3600                                                                                                                                                 | A callback's id is kept twice as long                                                                                   |
| `nuxeo.agentic.capture.provider`                                                                                                     | Unset: nothing read, every item waits     | The capture provider items are read through, by its id: `standin`, which reads the file's own text and calls nothing, or `ai`, the AI package's ([below](#capture))                                                               | `standin` for a demonstration server only                                                                               |
| `nuxeo.agentic.capture.ai.enabled`                                                                                                   | Off; on only when `true`                  | Lets the `ai` provider run: the AI package then sends each item's content to its model provider                                                                                                                                   | **Set it only once the AI data terms are approved** for that server's data. Review pending                              |
| `nuxeo.agentic.capture.ai.classifyOperation`, `.extractOperation`                                                                    | `AI.CaptureClassify`, `AI.CaptureExtract` | The AI package's two operations the `ai` provider calls                                                                                                                                                                           | Only an id beginning `AI.` is used; any other leaves the provider unconfigured                                          |
| `nuxeo.agentic.capture.maxBytes`                                                                                                     | 20971520                                  | The largest file an inbox takes, in bytes, 1024 to 104857600; anything else is the default                                                                                                                                        | None                                                                                                                    |

Sources, row by row:
[`LayerSettings.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerSettings.java)
and [`LayerService.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerService.java);
[`Connector.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/Connector.java),
[`ConnectorSettings.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/ConnectorSettings.java),
[`SystemOfRecordClient.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/SystemOfRecordClient.java),
[`ConnectorCache.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/ConnectorCache.java),
[`ChangeEvents.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/ChangeEvents.java)
and the [connectors README](../../nuxeo-agentic-connectors/README.md);
[`DevOverrides.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/DevOverrides.java)
and [extension-reference.md](../extension-reference.md), "The fast loop while you are tuning a
value";
[`AgenticNotificationDocumentIdCodec.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/url/codec/AgenticNotificationDocumentIdCodec.java)
and [`45-agentic-ui-url.sample.conf`](../../nuxeo-conf/45-agentic-ui-url.sample.conf);
[`Disposition.java`](../../nuxeo-agentic-records/src/main/java/org/nuxeo/agentic/records/Disposition.java),
where a value out of range is the default;
[`SignatureSettings.java`](../../nuxeo-agentic-signature/src/main/java/org/nuxeo/agentic/signature/SignatureSettings.java),
[`StandInProvider.java`](../../nuxeo-agentic-signature/src/main/java/org/nuxeo/agentic/signature/standin/StandInProvider.java)
and [`SignatureComponent.java`](../../nuxeo-agentic-signature/src/main/java/org/nuxeo/agentic/signature/SignatureComponent.java);
[`CaptureSettings.java`](../../nuxeo-agentic-capture/src/main/java/org/nuxeo/agentic/capture/CaptureSettings.java)
and [`AiPackageProvider.java`](../../nuxeo-agentic-capture/src/main/java/org/nuxeo/agentic/capture/ai/AiPackageProvider.java),
whose switch counts only `true`, in any letter case. The layer's
two switches use Java's `Boolean.parseBoolean`, so `TRUE` counts too; `http.allowed` counts only
`true`.

### The operation allow-list

An app's button that runs an Automation operation or chain runs only what the deployment's
allow-list holds ([app-definition-v2.md, section 5](app-definition-v2.md#5-actions);
[`agentic-ui-operations-service.xml`](../../nuxeo-agentic-core/src/main/resources/OSGI-INF/agentic-ui-operations-service.xml)).

- **The default is nothing.** With no contribution, nothing is allowed: the app registry serves no
  button that runs an operation, and the server log says what it left out.
- **Where it goes:** a contribution to `org.nuxeo.agentic.ui.operations`, point `allowList`, in a
  file of `nxserver/config/`. The server reads it from there alone: a contribution from a bundle,
  a package's included, is refused and logged
  ([`OperationAllowListComponent.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/OperationAllowListComponent.java)).
  The Payers kit's is
  [`deployment/payers-claims-demo-operations-config.xml`](../../business-apps/packages/payers-claims-demo/deployment/payers-claims-demo-operations-config.xml):

  ```xml
  <extension target="org.nuxeo.agentic.ui.operations" point="allowList">
    <operation id="Payers.RequestMedicalRecords" permission="Write">
      <app>payers-claims</app>
      <group>claims-adjusters</group>
      <type>Claim</type>
      <state>inReview</state>
      <state>pended</state>
      <param name="provider" type="string" maxLength="64" source="field:claim:provider" />
      <param name="urgent" type="boolean" source="input" />
      <param name="note" type="string" maxLength="500" source="input" required="true" />
    </operation>
  </extension>
  ```

- **What each entry sets**
  ([`AllowedOperation.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/AllowedOperation.java)):

  | Part         | Default          | What it is                                                                                                                                              |
  | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `id`         | Required         | The operation or chain                                                                                                                                  |
  | `permission` | `Write`          | The permission the person needs on the record, besides `Read`                                                                                           |
  | `app`        | Any app          | The apps whose buttons may run it                                                                                                                       |
  | `group`      | Anyone           | Groups the person must be in one of                                                                                                                     |
  | `type`       | Any type         | The record's document types                                                                                                                             |
  | `state`      | Any state        | The record's lifecycle states                                                                                                                           |
  | `param`      | None             | Each parameter an app may give it: `name` and `type`, both required, the type `string`, `boolean`, `long` or `double`; and `required`, false by default |
  | `maxLength`  | 1000             | For a `string`: at most 10000                                                                                                                           |
  | `source`     | Any of the three | `input`, the action's form; `literal`, the app's file; `field:<prefix>:<name>`, a property of the record as stored                                      |

- **Never allowed, whoever contributes them:** the platform's own `AgenticUi.` operations, and those
  that run another operation, a script or as another user, such as `RunOperation` and
  `Auth.LoginAs` (`NEVER` in `AllowedOperation.java`).
- **An entry that fails a check is not registered,** and takes the entry of its id registered
  before it out with it. A later entry with the same id replaces it whole; `enabled="false"`
  removes it.
- **Allow chains that begin with `AgenticUi.RequireRunAction`,** naming themselves, as the Payers
  kit's do, rather than plain operations: such a chain runs only through a button
  ([app-definition-v2.md, section 5](app-definition-v2.md#5-actions)).
- **Install packages the package pipeline built.** It refuses a package that contributes to the
  allow-list or could write into `nxserver/config/` (same section); check any other package for
  both yourself.
- **Removing the file** takes every button's chain off the allow-list.
- **Decision 3 is open, and the allow-list's security review is pending**
  ([section 9](#9-what-is-not-production-ready-yet)).

### The deployment layer

A customer's own versions of an app's record pages, forms and queues, made in the layout designer
and kept in the repository, which the registry serves over the package's files
([app-definition-v2.md, section 10](app-definition-v2.md#10-the-home);
[layout designer README](../../libs/features/layout-designer/README.md)).

- **Off unless `nuxeo.agentic.ui.layer.enabled=true`.** Turning it off takes every customer change
  out at once.
- **Who:** Nuxeo's administrators alone, as `NuxeoPrincipal.isAdministrator` counts them; everyone
  else is answered 403 at every address
  ([`LayerService.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerService.java)).
- **How a change goes live:** saved as a draft, which the registry never serves; submitted;
  approved by an administrator who neither wrote nor submitted it, unless `selfApproval` is on. A
  rollback is immediate and needs one administrator.
- **Where it is kept:** one `File` document per app, named by the app's id, under
  `/agentic-ui-layers`, a folder hidden in navigation whose ACL blocks every permission
  ([`RepositoryLayerStore.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/RepositoryLayerStore.java)).
- **Limits:** 500 files and 64 MiB a layer; the last 50 versions of a file, and the live one; a
  trail of 1000 lines a file. Another server of a cluster sees a change at most 10 seconds late
  (`LayerService.java`).
- **CORS:** keep the server's CORS configuration (`nuxeo.cors.urls`, or a `corsConfig`
  contribution) from admitting another origin to `/nuxeo/agentic-ui-apps/`
  ([layout designer README](../../libs/features/layout-designer/README.md)).
- **Its export,** for an upgrade: `GET /nuxeo/agentic-ui-apps/layer.json`, as an administrator
  ([api-integrations.md](../api-integrations.md), section 41).
- **Decisions B and E are open, and its security review is pending.**

### Connectors

A kit contributes a connector to `org.nuxeo.agentic.connectors`, point `connectors`; the server
sets its address and credential ([connectors README](../../nuxeo-agentic-connectors/README.md),
"The contribution"). The bounds a contribution may set, with their defaults
([`Connector.java`](../../nuxeo-agentic-connectors/src/main/java/org/nuxeo/agentic/connectors/Connector.java)):

| Element          | Default | Range           |
| ---------------- | ------- | --------------- |
| `permission`     | `Read`  | A permission    |
| `connectTimeout` | 2000 ms | 100 to 10000 ms |
| `timeout`        | 5000 ms | 100 to 30000 ms |
| `maxBytes`       | 262144  | 1024 to 1048576 |
| `maxConcurrent`  | 8       | 1 to 64         |

- **The names a connector reads are its own:** a property is one name after
  `nuxeo.agentic.connectors.<id>.`, and a variable is `NUXEO_CONNECTOR_<ID>_<NAME>`, the id in
  capitals with `.` and `-` as `_`. No id ends in `.http`, `.cache` or `.events`, whose names are
  the server's own for another connector. So a contribution cannot have another of the server's
  settings sent out.
- **A connector that breaks a rule is not registered,** and the log names every problem. A later
  contribution with the same id replaces it; `enabled="false"` removes it. Either drops the
  answers kept for it.
- **The cache and the change events are each server's,** connector by connector: `cache.ttl` and
  `cache.maxEntries`, `events.secret` (the properties above). A connector with none of them reads
  the other system for every card, as before 0.1.0. The change events' address,
  `/nuxeo/agentic-connectors/events/<id>`, has no sign-in: the signature with the secret is what
  lets an event in, and it only drops kept answers. Each node of a cluster keeps its own answers,
  and an event drops those of the node it reaches
  ([connectors README](../../nuxeo-agentic-connectors/README.md), "The cache" and "Change events").
- **The demo's settings,** for the stand-in core system on a demo server only: an address,
  `http.allowed=true`, a made-up token, a time to live and a made-up events secret
  ([connectors README](../../nuxeo-agentic-connectors/README.md), "Installing it").
- **Decision D is open, and the connectors' security review is pending.**

### The rights policy

`nuxeo-agentic-assets` refuses, on the server, the downloads an asset's rights do not cover, for
every user, administrators included, by a rights policy a kit contributes for its document type
([assets README](../../nuxeo-agentic-assets/README.md)). The brand assets kit's are
[`brand-assets-demo-rights.xml`](../../business-apps/packages/brand-assets-demo/bundle/OSGI-INF/brand-assets-demo-rights.xml),
for its pictures, and
[`brand-assets-demo-video-rights.xml`](../../business-apps/packages/brand-assets-demo/bundle/OSGI-INF/brand-assets-demo-video-rights.xml),
for its videos.

- **It refuses nothing until a package contributes a policy for a document type** (its
  `package.xml`).
- **A use the policy does not list is refused,** and a broken policy refuses every use of its
  type. A preview is served whatever the rights.
- **One policy per exact type.** A later policy for the type replaces it whole; `enabled="false"`
  removes it.
- **A video's,** from 0.3.0: a transcoded video is decided by its conversion's name, at the
  download endpoints whether named or at its place, every storyboard frame by the policy's one
  `<storyboard>`, and the platform's `Video.*` operations as a download of the file they read. The add-on replaces those five
  operations by its own of the same ids: on a server without the platform's video bundle, its
  component waits for it, and the server log's `Component Loading Status` lists it.
- **If the add-on cannot run at all,** its class not loading or its service not started, every
  download on the server is refused, not only assets'. Check the server log after every install.
- **Decision B is open, and its security review is pending:** the README says not to rely on it
  before then.

### The app registry's groups

There is no server setting: each app's `app.json` names its groups, and the registry lists the app
only to a person in one of them, counting every group Nuxeo counts them in, nested and virtual ones
included, so `members` is everyone signed in
([app-definition-v2.md, section 10](app-definition-v2.md#10-the-home);
[api-integrations.md](../api-integrations.md), section 36). An administrator sees what their
groups give them, and gets every diagnostic.

| App, and its address              | Groups                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| `payers-claims`                   | `claims-adjusters`, `claims-supervisors`, `member-services` |
| `brand-assets`                    | `brand-team`, `creative-review`                             |
| `contracts`, at `contract-desk`   | `contract-managers`, `legal-reviewers`                      |
| `facilities`                      | `facilities-coordinators`, `facilities-technicians`         |
| `moves`                           | `move-coordinators`, `move-claims-adjusters`                |
| `pc-claims`, at `property-claims` | `property-claims-adjusters`, `property-claims-managers`     |
| `controlled-documents`            | `document-controllers`, `engineers`                         |
| `records`                         | `records-managers`, `records-approvers`                     |
| `onboarding`                      | `onboarding-officers`, `kyc-analysts`, `dispute-analysts`   |
| `media`                           | `media-distribution`, `media-rights`                        |
| `vehicle-titles`                  | `vehicle-deal-desk`, `vehicle-title-clerks`                 |

Read from each kit's `bundle/agentic-ui-config/app.json`.

- **Create the groups yourself.** The contracts, brand assets, moves, P&C claims, controlled
  documents, records and vehicle titles seeds create no user and no group; the Payers seed creates its fictional demo people and its groups,
  for a demo server.
- **Seeing an app is not a security control.** Nuxeo's permissions decide which records its
  queues, homes and pages show.
- **Anonymous:** on a server that defines an anonymous user, a request with no credentials is
  `Anonymous`, in no app's group, and gets an empty list
  ([`auth-config-agentic.xml`](../../nuxeo-agentic-core/src/main/resources/OSGI-INF/auth-config-agentic.xml)).
- **Decision E is open.**

### Share links

`nuxeo-agentic-assets` 0.2.0 adds share links, and a property, `nuxeo.agentic.share.groups`: the
groups whose members may make share links, separated by commas, besides administrators. Unset or
empty, only administrators may
([`ShareLinkService.java`](../../nuxeo-agentic-assets/src/main/java/org/nuxeo/agentic/assets/share/ShareLinkService.java)).
A link is served at `/nuxeo/agentic-share/` to whoever holds it, with no sign-in; what must stand
in front of that path before anyone outside the company has a link is in the
[assets README](../../nuxeo-agentic-assets/README.md#installing-it-on-a-local-nuxeo). The brand
assets kit turns them on from 0.2.2. Installed nowhere yet.

### What everyone reads before sign-in

`/nuxeo/agentic-ui-config/` answers `bootstrap.json`, `manifest.json`, `layouts.json`, its layout
files and `assets/` to everyone, before sign-in. "Put nothing secret in a fragment"
([extension-reference.md](../extension-reference.md), "Where the manifest lives";
[app-definition-v2.md](app-definition-v2.md), section 10). The registry's files are served only
after sign-in.

### Languages

Read from `staging/enterprise-grade-app` on 27 November 2026. `npm run i18n:coverage` gives the
numbers of the day, for the app and every kit, and names the keys each language is missing.

**What the app shows.** A deployment's language is its Layer 0 `defaultLanguage`, which
`availableLanguages` must list, as Satori's own defaults do in
[`bootstrap.defaults.json`](../../nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json),
and a configuration package's `bootstrap.json` may change. The app runs in a language only when
this build ships its catalogue, `apps/nuxeo-ui/public/i18n/<language>.json`; given another, it says
so in the console and runs in English (`resolveStringLanguage` in
[`provide-app-config.ts`](../../apps/nuxeo-ui/src/app/config/provide-app-config.ts)). Dates,
numbers and amounts follow the same language, once it is offered.

| Languages                                                               | State                                                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| English, French, German, Japanese, Dutch (`en`, `fr`, `de`, `ja`, `nl`) | Ship. The four translations hold 2,013 of English's 3,355 keys                                                                    |
| Spanish (`es`)                                                          | Requested from Crowdin. Its dates, numbers and amounts are ready; its catalogue is not on this branch, so it cannot be chosen yet |
| Swedish, Arabic, Hebrew, Italian (`sv`, `ar`, `he`, `it`)               | Crowdin targets, not requested on this branch; dates, numbers and amounts ready; no catalogue here                                |
| Danish, Finnish, Norwegian Bokmål (`da`, `fi`, `nb`)                    | Registered: dates, numbers and amounts ready. Not yet Crowdin targets, so not requested                                           |

`main` is further along than this branch. Swedish, Italian, Arabic and Hebrew ship there already
(NXSAT-754, #656 and #696), and Spanish, 99 % approved on Crowdin on 30 October
([i18n-status.md](../i18n-status.md)), waits in Crowdin's pull request into `main`, #401, with
2,774 keys. Each reaches this branch when `main` is merged into it. Danish, Finnish and Norwegian
Bokmål are new: none was among the project's targets on 30 October, the last time they were read.

**Every language falls back to English, key by key.** A key a catalogue does not give shows in
English, never as the key, so a language at 60 % shows the other 40 % in English.

**A kit's labels** are `labels/<language>.json` beside its `labels/en.json`, written by Crowdin
from the English, never by hand ([app-definition-v2.md](app-definition-v2.md), section 7). The
registry serves a language over English, key by key, and a language a kit has no file for shows the
kit's English. No kit has a file in any language but English yet. The pipeline accepts a language
that gives a subset of English's keys and refuses one with a key English lacks
([package-pipeline.md](package-pipeline.md), section 2). The kits have a Crowdin config of their
own, [`crowdin-kits.yml`](../../crowdin-kits.yml), and a pull of their own,
[`crowdin-pull-kits.yaml`](../../.github/workflows/crowdin-pull-kits.yaml), because a kit's new file
needs a person to name it and version the kit before the kit builds, and in the app's one pull
request that would hold every app catalogue red with it.

**The demos need approved translations first.** Phase 7's "the app in Spanish" and phase 8's "the
app in French" each show the app only as far as Crowdin has approved it and the steps below have
brought it here. French ships today at 60 %, and every kit label in French is English until its
translations are approved and pulled. Spanish needs #401 merged, with step 3 below, and its kit
labels the same as French. Translations are never written in this repository.

**On Crowdin's side,** a Crowdin manager on project 160 of the Hyland tenant, with the Translation
Team, does each of these:

1. **Adds the target language,** before anyone requests it here: a pull fails as a whole on a
   language the project does not have. Spanish `es`, Swedish `sv`, Danish `da`, Finnish `fi`. For
   Norwegian Bokmål, choose **one** of Crowdin's two: "Norwegian Bokmal" (`nb`) or "Norwegian"
   (`no`). Both configs write either as `nb.json`, the name the app reads; both would write the
   same file.
2. **Hides the `$schema` string** in each kit's labels file, once the kits' sources are on the
   project. Crowdin Push uploads them on its next run: a change on `main` to any source, the app's
   catalogue or context, or a kit's `labels/en.json`, starts one, or it can be run by hand. The
   string is the address of a schema for editors, not a label; hidden, it is not shown to a
   translator and exports as written.
3. **Has the strings translated and approved.** Only approved translations are exported. A string
   not yet approved arrives as its English source, and shows as English.
4. **Confirms the project's own export settings keep approved-only export,** since they take
   precedence over the pipeline's. It is the open owner action in `D8-standard`
   ([i18n-localization-plan.md](../i18n-localization-plan.md)).

**In the repository,** once approvals exist, a developer, on `main`:

1. **For the app,** adds the language's `--language` to `download_translations_args` in
   [`crowdin-pull.yaml`](../../.github/workflows/crowdin-pull.yaml) and waits for the nightly pull.
   The id is Crowdin's: `no` if the project targets "Norwegian". In the pull request it opens, which
   brings `apps/nuxeo-ui/public/i18n/<language>.json`, offers the language:
   `SHIPPED_CATALOGUE_LANGUAGES` in
   [`shipped-catalogues.ts`](../../apps/nuxeo-ui/src/app/i18n/shipped-catalogues.ts),
   `availableLanguages` in `bootstrap.defaults.json` and in `DEFAULT_APP_BOOTSTRAP_CONFIG`
   (`libs/shared/app-config/src/lib/bootstrap-config.ts`), and `DATE_FNS_LOCALES` in
   `libs/shared/ui/src/lib/date-adapter/satori-date-adapter.ts`, where date-fns' `es`, `sv`, `da`,
   `fi` and `nb` need no regional entry. Until then that pull request is red, on purpose: a
   catalogue nobody offers ships and is never shown.
2. **For the kits,** once a kit string is approved, sets the repository variable
   `CROWDIN_KIT_LABELS_ENABLED` to `true`, which turns the kits' pull on, and in the same change
   sets the pull's `download_translations_args` to the languages with approved kit strings: it
   holds French alone until then, as a placeholder, and a language listed with no approval writes
   every kit's file in English, each needing its kit named and versioned. In each pull request it
   opens, for each kit with a new file, names it in the component
   (`npx nx g ./tools/satori-generators:app-registry --package=business-apps/packages/<kit>`), and
   raises the kit's version: a minor for a new language, a patch for changed texts. Until then the
   package pipeline refuses the kit and that pull request is red, holding only the kits.

**On the server,** an administrator then sets `defaultLanguage` in the deployment's Layer 0
configuration, and installs the kits' new versions.

## 5. Upgrading a kit

1. **Read what changed.** A release candidate's `RELEASE-NOTES.md` carries each kit's changelog
   since the last release, and a changelog carries the migration notes that apply under
   "Upgrading" ([package-pipeline.md](package-pipeline.md), sections 10 and 11). A kit's notes are
   its `upgrade-notes.json`; the platform's are
   [`platform-upgrade-notes.json`](platform-upgrade-notes.json). Two exist today: Payers 0.4.0
   removed the Approve button and its labels, and contracts 0.2.0 moved its address from
   `contracts` to `contract-desk`
   ([Payers](../../business-apps/packages/payers-claims-demo/upgrade-notes.json),
   [contracts](../../business-apps/packages/contracts-demo/upgrade-notes.json)).
2. **Run the upgrade check** with your own layer's export, if the layer is on: it warns for each
   file of the kit your deployment overrides that the upgrade adds, changes or removes
   ([package-pipeline.md, section 10](package-pipeline.md#10-the-upgrade-check)):

   ```bash
   npm run app-upgrade -- <kit> --previous <the kit as it was> --deployment <layer.json>
   ```

   Exit 0 keeps every configuration, 1 does not, 2 is a command it could not run. A warning
   changes no exit code: your override keeps winning, so the kit's change does not show until an
   administrator takes it into a new draft, or rolls the override back.

3. **Check the upgrade against your running server,** before you stop it. The server half reads
   the server, `GET` only, as an administrator, with `NUXEO_USER` and `NUXEO_PASS` in your
   environment, and changes nothing there
   ([package-pipeline.md, section 10](package-pipeline.md#on-a-server-before-the-install)):

   ```bash
   node scripts/app-upgrade-check.mjs <the new kit> --server https://<host>/nuxeo --previous <the kit as installed>
   ```

   It reads the version installed from the server, refuses a server it cannot identify, and reads
   your own layer's export itself, so `--deployment` is not given. Then it says, with what to do
   before you install:
   - records of a type, a schema or a property the upgrade removes or changes, and records in a
     state the new lifecycle does not have, counted;
   - a page provider the kit changes that your server does not answer with its aggregates;
   - workflows still running on a route model the kit replaces, which keep their old steps: let
     them finish, or cancel them;
   - an override in your deployment layer, live or a draft, that the new version would no longer
     accept, and one whose file the upgrade changes;
   - a vocabulary entry the new version adds that your server will not load;
   - the errors your server already reports, so that a new one afterwards can be told.

   An error is exit 1; a warning leaves the exit code alone; exit 2 is a server it could not
   identify, or a read it could not make. Run on the local Docker Nuxeo for payers 0.6.1 over the
   0.6.1 installed, 26 November 2026: kept, with the one error the registry already reported; and
   for payers 0.7.0 over the same 0.6.1: kept, its claims review route model replaced with no
   workflow running on it. What neither run reached has been checked only against a stand-in for
   the server ([package-pipeline.md, section 10](package-pipeline.md#on-a-server-before-the-install)).

4. **Install the new version** with the one-off script. `mp-install` upgrades a kit, removing the
   version before first, and the records stay: so the Payers kit went from 0.2.0 to 0.3.0, on 23
   November 2026. A rebuild of a version already installed is skipped as unchanged: run
   `nuxeoctl mp-remove <kit> --accept=true` first, in the same script
   ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#installing-it-on-a-local-nuxeo)).
5. **Follow the kit's README for its version.** Payers 0.7.0 adds the appeal review workflow, a
   second route model the routing service imports at the next start, and an appeal's decision,
   `case:decision`, which its seed writes on the decided appeal: seed it again after the install.
   Payers 0.6.1 gives the supervisor's step the
   variables facet Nuxeo's task completion needs, so a workflow started under 0.6.0 has a
   supervisor's approval that cannot be completed: cancel it. Payers 0.6.0 needs a
   `nuxeo-agentic-ui` whose layout engine knows a checklist's `tickable`, or the Case page's
   checklist is left out; Payers
   0.5.0 needs a `nuxeo-agentic-ui` with the allow-list, and the allow-list in `nxserver/config/`;
   Payers 0.4.0 adds a claim lifecycle, so claims seeded under 0.3.0 wait in `project` until the
   seed runs again. Of these, 0.4.0, 0.6.0 and 0.6.1 were installed on the local server, and 0.5.0
   and 0.7.0 on none ([Payers README](../../business-apps/packages/payers-claims-demo/README.md)).
6. **Check it,** as after an install: the install log, `Component Loading Status`, and no new error
   in the diagnostics ([section 8](#8-logs-and-diagnostics)), against the errors step 3 noted.

**Not built:** the server-side upgrade test, which would install a version and a customer's
configuration, upgrade both and check that the customer's component still starts and that records
made before still open. Step 3 reads a running server before an install and installs nothing. Nor
has the Admin Center's install path been rehearsed
([package-pipeline.md](package-pipeline.md), section 10).

## 6. Removing a kit safely

**Not run yet,** for any kit (each kit's README, "Removing it"). The steps follow the Payers
kit's install, which was run; the contracts, facilities, moves, P&C claims and media kits were never
installed.

1. **Delete the kit's documents first, and empty them from the trash.** A document whose type is
   gone cannot be read, and breaks the folder and the searches that hold it. Do the same before you
   replace a kit's stand-in model. The seeded workspaces:
   `/default-domain/workspaces/payers-demo`, `/default-domain/workspaces/acme-brand-assets`,
   `/default-domain/workspaces/contracts-demo`, `/default-domain/workspaces/moves-demo`,
   `/default-domain/workspaces/pc-claims-demo`, `/default-domain/workspaces/records-demo`,
   `/default-domain/workspaces/media-demo` and `/default-domain/workspaces/vehicle-titles-demo`; the records kit's seed also writes `/disposition-runs`
   and the rule `/RetentionRules/records-demo-one-minute`. Its records are records of the retention
   module: one under retention or a legal hold cannot be deleted, whoever asks. The facilities kit
   has no seed.
2. **For the Payers kit from 0.4.0, cancel its workflows and delete its route models:** as an
   administrator, `DELETE /nuxeo/api/v1/workflow/<instance id>` for each running instance of
   `PayersClaimReview`, and from 0.7.0 of `PayersAppealReview`, found by the model's id, the `id`
   `GET /nuxeo/api/v1/workflowModel/<model>` answers, with
   `SELECT * FROM DocumentRoute WHERE docri:modelId = '<model id>' AND ecm:currentLifeCycleState = 'running'`,
   since `GET /nuxeo/api/v1/workflow?workflowModelName=` lists only the workflows the person asking
   started; then the models under the route models' folder
   ([Payers README](../../business-apps/packages/payers-claims-demo/README.md#removing-it)).
3. **Remove what depends on a package before the package:** the brand assets kit before
   `nuxeo-agentic-assets`, the records kit before `nuxeo-agentic-records`, and every kit before
   `nuxeo-agentic-ui`. With the assets add-on gone,
   no download is refused for rights ([assets README](../../nuxeo-agentic-assets/README.md)).
4. **Remove the package** with `nuxeoctl mp-remove <kit> --accept=true`, the server stopped: on
   Docker, in a one-off script, as for the install.
5. **Then the deployment's own files, which no package removes.** A kit's `install.xml` only copies
   its bundle ([Payers](../../business-apps/packages/payers-claims-demo/package/install.xml)), so
   its removal leaves the kit's contributions in `nxserver/config/`, its properties in
   `nuxeo.conf`, and its app's layer document under `/agentic-ui-layers`. Delete each that is no
   longer wanted. Of the layer, the layout designer README says: "The stored layer stays in
   `/agentic-ui-layers` until an administrator deletes it."

## 7. The demo server

One command makes a demo server from a release candidate's directory: a Docker Compose project of
its own, Nuxeo 2025.10.18 and OpenSearch 2.13.0, with every package installed at its first start,
the deployment's files in `nxserver/config/`, the administrator's password changed, and each kit
seeded ([demo server README](../../business-apps/demo-server/README.md)).
**Built, and not run against Docker** (25 November 2026).

```bash
npm run demo-server -- --candidate ../release-candidate-2026.0.2 --dry-run
```

| Option      | Default       |
| ----------- | ------------- |
| `--project` | `satori-demo` |
| `--port`    | `18080`       |
| `--bind`    | `127.0.0.1`   |
| `--wait`    | `1200` s      |
| `--dry-run` | Off           |

Read from [`demo-server-plan.mjs`](../../scripts/demo-server-plan.mjs), which also refuses ports
8080, 4200, 4300 and 9200.

- **Secrets from the environment only:** `NUXEO_CLID`, `DEMO_SERVER_ADMIN_PASSWORD`, at least 12
  characters and not the default, and each seed's demo password, today `PAYERS_DEMO_PASSWORD`, at
  least 8 and not the administrator's. Unset, the run is refused.
- **No connector is contributed:** the connectors' bundle is placed, and its demo needs the
  stand-in system and a token.
- **Stop, start and remove it** with `docker compose -f business-apps/demo-server/compose.yml -p satori-demo`
  and `stop`, `start` or `down --volumes`. Never `up` it by hand, and nothing restarts it on its
  own. A new candidate is a new server: upgrading in place is not what it does.
- **The installed app** is at `http://127.0.0.1:18080/nuxeo/agentic-ui/`, and the install log at
  `/var/log/nuxeo/demo-server-install.log` in the container.

## 8. Logs and diagnostics

| Where                                                                  | What it holds                                                                                                                                                                                                                | Source                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| An install script's log, `/var/log/nuxeo/<name>-install.log`           | What `nuxeoctl mp-install` installed or refused                                                                                                                                                                              | The kits' READMEs; the demo server's `demo-server-install.log`                                                                         |
| `server.log`, `Component Loading Status`                               | A component pending or missing. Nuxeo leaves a component whose requirement is missing unstarted, so it contributes nothing                                                                                                   | The kits' READMEs; [package-pipeline.md](package-pipeline.md), section 10                                                              |
| `server.log`, `Agentic UI configuration:`                              | The configuration's diagnostics; `the DEPLOYMENT LAYER IS ON` and `DEVELOPMENT OVERRIDES ARE ACTIVE` at start                                                                                                                | [`AgenticUiConfigComponent.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/AgenticUiConfigComponent.java)       |
| `server.log`, `Agentic UI allow-list:`                                 | Each entry allowed, removed or refused                                                                                                                                                                                       | [`OperationAllowListComponent.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/OperationAllowListComponent.java) |
| `server.log`, `Agentic UI app registry:`                               | What the registry left out, such as an action the allow-list does not hold                                                                                                                                                   | [`AppRegistryEndpoint.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/AppRegistryEndpoint.java)                 |
| `server.log`, `Agentic UI action run:` and `Agentic UI action refused` | Each button run, and each refusal with who asked                                                                                                                                                                             | [`AppActionRunner.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/AppActionRunner.java)                         |
| `server.log`, `Agentic UI deployment layer:`                           | Each change, at `INFO`; each refused change, at `WARN`, with who asked; a failure to read or write the layer, at `ERROR`                                                                                                     | [`LayerService.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerService.java)                               |
| `server.log`, `Asset rights:`                                          | A policy's mistakes as it registers; each refused download, at `INFO`                                                                                                                                                        | [assets README](../../nuxeo-agentic-assets/README.md)                                                                                  |
| `server.log`, `Connector <id>:` and `A connector contributed by`       | A connector not registered, an address or credential missing, a call refused or failed, a change event accepted at `INFO` or refused at `WARN`, once a minute per reason; never the key, the credential or the events secret | [connectors README](../../nuxeo-agentic-connectors/README.md)                                                                          |
| `server.log`, `Disposition run` and `Disposition review:`              | Each run started, approved, rejected, halted or disposed of, with who; each refused request, at `WARN`; never a record's title                                                                                               | [records add-on README](../../nuxeo-agentic-records/README.md)                                                                         |
| `server.log`, `Audit export`, `Records audit:`, `Access logging:`      | Each export filed and written, or why it failed; an entry the audit refused; a view not recorded                                                                                                                             | [records add-on README](../../nuxeo-agentic-records/README.md#access-logging)                                                          |
| `diagnostics` in `bootstrap.json` and `manifest.json`                  | A fragment rejected, replaced or removed, with the component behind it                                                                                                                                                       | [extension-reference.md](../extension-reference.md)                                                                                    |
| `diagnostics` in `/nuxeo/agentic-ui-apps/apps.json`                    | What the registry refused, such as `action-refused`; an administrator gets all of them                                                                                                                                       | [api-integrations.md](../api-integrations.md), section 36                                                                              |
| A layer file's trail, and `/nuxeo/agentic-ui-apps/layer.json`          | Who changed a file, when, and to which version                                                                                                                                                                               | [layout designer README](../../libs/features/layout-designer/README.md)                                                                |
| A record's history                                                     | "App action run", for each button run                                                                                                                                                                                        | [app-definition-v2.md](app-definition-v2.md), section 5                                                                                |

On Docker, the server log is `/var/log/nuxeo/server.log` in the container:
`docker exec nuxeo grep -A20 "Component Loading Status" /var/log/nuxeo/server.log | tail -25`, as
the [Payers README](../../business-apps/packages/payers-claims-demo/README.md) checks it.

### Capture

A kit contributes a capture profile to `org.nuxeo.agentic.capture`, point `profiles`: its inbox
and item types, the record type it files on and the folder it matches under, a threshold, and its
classes with their fields, a key field naming the record's property it must equal
([capture README](../../nuxeo-agentic-capture/README.md#the-model)). The server sets the provider.

- **Mail comes in as an upload into an inbox,** through the REST API, by whoever may add to it
  (`AddChildren`): a scanner's account, a mail gateway's, or a person. No mail server and no drop
  folder. Give the inbox's `AddChildren` only to the accounts that should file mail, and its
  `Write` to the people who confirm.
- **Each item is read in the background, as the system,** and filed by itself only when its class
  and keys are at least the profile's threshold, 0.85 unless it says otherwise and never below 0.5,
  and exactly one record matches. Anything else waits for a person, who files only on a record they
  may write ([capture README](../../nuxeo-agentic-capture/README.md#the-confidence-rule)).
- **With no provider set,** nothing is read, and every item waits for a person: the inbox still
  works as a queue.
- **The stand-in, `standin`,** is for a demonstration server: it reads the file's own text and sends
  it nowhere.
- **The AI package's provider, `ai`, is off by default.** It needs the AI package installed, with
  its capture operations, which it does not have yet, and both `provider=ai` and `ai.enabled=true`.
  **Set the second only once the AI data terms are approved:** the AI package sends each item's
  content to its model provider ([capture README](../../nuxeo-agentic-capture/README.md#before-the-ai-provider-is-switched-on)).
- **A profile that breaks a rule is not registered,** and the log names the rule; nothing in its
  inbox is then received.
- **An item left received,** its capture lost with its node, is not in any queue, and nothing
  reads it again: look for items with `capt:status = 'received'` older than an hour, and upload
  each again ([capture README](../../nuxeo-agentic-capture/README.md#how-a-capture-goes)).
- **Its security review is pending.**

### The diagnostics page

**Administration, Diagnostics**, at `/administration/diagnostics`, for administrators: what support
needs to know of this server's apps, read only, in one place. It shows:

- **the versions:** the platform's, Nuxeo's product name and version; the app's, the installed
  `nuxeo-agentic-ui` package; and the `nuxeo-agentic-core` bundle's own build;
- **the installed packages,** each with its version, its state and whether it is the app, a kit
  (a package that depends on the app) or another add-on, as the package manager records them in
  `nuxeo.mp.dir`. **Signature: "Not recorded by the server",** for every package: Nuxeo LTS 2025's
  package manager keeps no record of a signature, so verify each one before installing it
  ([section 3](#3-installing-in-order); [package-pipeline.md](package-pipeline.md), section 9.1);
- **the server checks the apps depend on:** Nuxeo's retention module (its `RetentionRule` facet
  registered), Template Rendering (its `TemplateBased` facet), the AI package (any `AI.*`
  operation), the deployment layer on or off, the development overrides on or off, and the
  operation allow-list in force or replaced;
- **the configuration in force:** server-wide, the bootstrap and manifest fragments, in the order
  the browser applies them, with the bundle each came from, and how many layouts; for each app, its
  package version, the platform it needs, the bundle and files it is served from, its deployment
  layer's live files with their versions, and how many configuration errors were logged for it;
- **the configuration's errors and warnings** the server logged when it built the configuration in
  force, and when the registry served each app's actions, each with its app, its code, its message
  and the file it is about. Those for information only are counted, not listed;
- **a "copy for support" text:** the same facts as plain text, a fact a line, in field names that
  do not change with the page's language, and a Copy button.

**What it leaves out, by construction:** no person, not the administrator asking, not who changed
the deployment layer, not an app's groups; no property is read for it but the product's name and
version, the package manager's directory, which is not shown, and the switches, shown as on or
off; and no file's content. One property can still show: with the development overrides on, their
directory is in their own messages and as the source of their files. Every message is cleaned
before it is sent: an email address, who a URL signs in as and its query, a home directory's owner,
what follows a credential's name such as `password=`, an `Authorization` header's value, and
anything shaped like a key or a token are replaced
([`Redaction.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/Redaction.java)).
A package's name and version are held to a name's and a version's form instead, so that a build's
timestamped version is shown whole. The cleaning is a second line, not a guarantee: read the text
before sending it.

**Who may read it is decided on the server.** The page reads
`GET /nuxeo/agentic-ui-apps/diagnostics.json`, after sign-in, below the app registry's servlet:

| Request                                          | Answer                                        |
| ------------------------------------------------ | --------------------------------------------- |
| `GET`, from an administrator (`isAdministrator`) | 200, the report, `Cache-Control: no-store`    |
| `GET`, from anyone else, any group               | 403, before anything of the server is read    |
| `GET`, with no sign-in                           | 401; 403 on a server with an anonymous user   |
| Any other method, `HEAD` and `POST` included     | 405, `Allow: GET`, before anyone is looked at |

The page's own route guard only keeps it out of the menu: someone who reaches the page without
being an administrator sees the server's 403 and nothing of the report. Sources:
[`DiagnosticsEndpoint.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/DiagnosticsEndpoint.java),
[`DiagnosticsReport.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/DiagnosticsReport.java),
[`InstalledPackages.java`](../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/InstalledPackages.java),
and their tests, `DiagnosticsAccessTest` above all. **Run in its tests only:** no server has the
build of `nuxeo-agentic-core` that answers it yet, so the local Docker Nuxeo answers 404 there, and
the report's reads of a running server, `ServerProbe.live()`, have run nowhere. Its security review waits with the others
([security-reviews.md](security-reviews.md)). Telemetry, which would send any of this anywhere, is
not built: [telemetry.md](telemetry.md) is its design, for decision T.

## 9. What is not production-ready yet

### Open decisions

Each piece below is built on a decision's recommendation, and the decision stays open: its owner
may still take it another way, and the [decision log](decisions.md)'s notes say what would change.

| Decision                                   | What is built on its recommendation                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 2, workflow and business records in scope  | The Payers kit's claims review workflow and appeals                                               |
| 3, buttons bound to Automation chains      | The operation buttons and their allow-list                                                        |
| 5, customer code at run time               | A spike only                                                                                      |
| B, the packaging of the server tier        | The registry and the layer in core; the assets, records, documents, signature and capture add-ons |
| C, outside users                           | Share links, in `nuxeo-agentic-assets` 0.2.0                                                      |
| D, connectors                              | The connectors add-on                                                                             |
| E, app definitions after sign-in, by group | The app registry and the deployment layer                                                         |

Decision 4, the security review of the registered computations and rules, is open too. Tenants,
decision G, are not built: the registry knows groups only
([app-definition-v2.md](app-definition-v2.md), section 10).

### Security reviews pending

Every security review waits until the app is finished, as decided on 26 November 2026. The
[register](security-reviews.md) lists each one: what it covers, where its notes for the reviewer
are, and the decision it rests on. Until a review is done, nothing it covers is to be relied on
outside a development or demonstration server.

### Installed or shown only on a local server, or nowhere

- **On a local server only,** the local Docker Nuxeo, as of 26 November 2026:
  - `nuxeo-agentic-ui` built from the staging branch, with the app registry and the operation
    buttons' allow-list in `nxserver/config/`;
  - `nuxeo-agentic-assets` 0.1.0, with the brand assets kit 0.2.0;
  - Payers 0.6.1, with its seed and the demo users;
  - contracts 0.2.1;
  - moves 0.1.0;
  - `nuxeo-agentic-documents` 0.1.0, with the controlled documents kit 0.1.0.

  Earlier, Payers 0.3.0 to 0.4.1 and the brand assets kit 0.1.0
  ([api-integrations.md](../api-integrations.md), section 36; the kits' READMEs). On 26 November
  2026, through the development server, on Payers 0.6.1, every Payers steps file passed:
  - the demo's, 40 of 40;
  - the claims review workflow's, 43 of 43, four runs in a row;
  - the appeals', 43 of 43;
  - the operation buttons', 32 of 32.

  The moves and controlled documents seeds ran there, the second checking the server's numbering
  and supersession.

- **On no server:** the connectors; the deployment layer, which `nuxeo-agentic-ui` holds switched
  off; `nuxeo-agentic-assets` 0.2.0 and its share links, left off the local server because a share
  link is reached without signing in; Payers 0.7.0, with its appeal review workflow; brand assets
  0.2.1 to 0.2.3; the facilities and records kits; `nuxeo-agentic-records`, whose disposition runs
  only in its tests, and which needs `nuxeo-retention` from the Marketplace; `nuxeo-agentic-signature`
  and the onboarding kit, the e-signature step run in its tests and against the stand-in service
  only, decision H choosing no vendor yet; `nuxeo-agentic-capture` and the P&C claims kit 0.2.0,
  capture run in its tests only, with the stand-in and stand-ins for the AI package's operations;
  every kit's removal.
- **The demo server:** built, and not run against Docker
  ([demo server README](../../business-apps/demo-server/README.md)).
- **The release candidate:** assembled offline, and it installs nothing. CI runs it on every push
  to a `staging/**` branch ([`release-candidate.yml`](../../.github/workflows/release-candidate.yml);
  [package-pipeline.md](package-pipeline.md), section 11).
- **The upgrade check:** its offline half, and its server half, which reads a running server
  before an install; the server-side test that installs and upgrades is not built
  ([package-pipeline.md](package-pipeline.md), section 10).
- **Publishing:** never run ([tutorial.md](tutorial.md), step 10). Signing is built and has
  signed nothing, since no tag has been pushed, and promotion after approval is a proposal
  ([package-pipeline.md](package-pipeline.md), sections 7 and 9).
- **No Marketplace package** for `nuxeo-agentic-connectors`.
- **The Studio migration** reports "not ready" for every package, and installing a migrated app is
  not part of its guide ([studio-migration-guide.md](studio-migration-guide.md)).
- **The asset library's performance budget** is measured against a stand-in for the server, not a
  server's own query time ([performance-budget.md](performance-budget.md)).
