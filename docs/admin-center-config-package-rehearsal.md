# Admin Center configuration-package rehearsal (NXSAT-680)

Status: **server provisioned and CLI package lifecycle verified locally. The Admin Center package
lifecycle is NOT RUN: the installed LTS-2025 administration UIs expose no package lifecycle controls.**

[NXSAT-680](https://hyland.atlassian.net/browse/NXSAT-680) requires an Admin Center
install, upgrade and removal of a configuration package, with recorded evidence. Final acceptance
requires [NXSAT-679](https://hyland.atlassian.net/browse/NXSAT-679) to be merged into `main`;
that merge has not yet been verified.
The existing `nuxeoctl mp-install` rehearsal does not validate this UI path.

## Initial preparation record — 2026-11-04, before provisioning

| Item               | Observation                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source base        | `origin/main`, `e192756974e159e52bc7a5cff633d07ac109dbe9`                                                                                                                                                                            |
| Work branch        | `feature/nxsat-680-admin-center-rehearsal`                                                                                                                                                                                           |
| NXSAT-679          | Jira reports Open; prerequisite merge not established                                                                                                                                                                                |
| Builder inspection | `tools/satori-generators/src/config-package/files/build.mjs__tmpl__` packages non-JSON bundle files with `readFileSync(file)`, including `META-INF/MANIFEST.MF`; no output normalization of manifest BOM or header wrapping observed |
| Dependency floor   | The generated `package.xml` already declares `nuxeo-agentic-ui:2026.0.2`; this alone does not establish completion of NXSAT-679                                                                                                      |
| Disposable server  | `nxsat680-admin-center`, Docker label `purpose=nxsat-680`, `http://localhost:8180/nuxeo/`                                                                                                                                            |
| Server image       | Cached `docker-private.packages.nuxeo.com/nuxeo/nuxeo:2025`, image ID `sha256:fc520099f51de5750472f188542dc366e6467ef74bf531737b216c62fb09fd68`                                                                                      |
| Server readiness   | `/nuxeo/runningstatus` returned HTTP 200; startup log reports Nuxeo Platform Started with 0 pending, missing or unstarted components                                                                                                 |
| UI readiness       | `/nuxeo/` returned HTTP 200 (Nuxeo Server); `/nuxeo/ui/` and `/nuxeo/view_home.faces` returned HTTP 404; stock image has no application UI installed                                                                                 |
| Registration       | Startup log reports an unregistered instance; no registration has been performed                                                                                                                                                     |
| Installed packages | `nuxeoctl mp-list` reports an empty local package list                                                                                                                                                                               |
| Result             | No package lifecycle verdict yet                                                                                                                                                                                                     |

The server is a separate container, with no existing server data mounted and only a loopback port
published. The image's default template uses H2. This fixture is intended for package lifecycle
checks, not search parity or production performance. Do not use the hosted Beta environment.

## Provisioning result — 2026-11-04

The disposable server is now Nuxeo **2025.25.21**, with these packages installed and started:

| Package               | Version                              | Source                                                                                                      |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `nuxeo-agentic-ui`    | `2026.0.2-20261103163939-BUILD-2783` | Existing local Marketplace ZIP used by the NXSAT-679 test environment                                       |
| `nuxeo-admin-console` | `25.2.1`                             | Complete cached payload from reference container `nuxeo`, repackaged without its generated uninstall record |
| `nuxeo-web-ui`        | `2025.20.0`                          | Downloaded through the disposable server's package manager                                                  |
| `nuxeo-admin-center`  | `2025.0.0`                           | Downloaded through the disposable server's package manager                                                  |

The base ZIP's SHA-256 is
`2354f2a386df17e94fcdd06be32f33af9f72186b6c0aed026e63cd8447662ad1`.
The locally repackaged Admin Console ZIP's SHA-256 is
`71b7a2c2b65464a88f1da32f37ab73f13422ad6e2f8758510c3f81cbcc693cef`.
The latter is a local archive of the reference payload, not an original vendor ZIP.

The first online download failed with `Registration required`. After explicit user approval,
the reference container's `instance.clid` was copied into this disposable server, with its contents
kept out of logs and source. The subsequent Web UI and Admin Center downloads and installations
succeeded. Admin Console still displays registration details as `NA`; the successful package
downloads establish access for provisioning, not an independently verified subscription summary.

Verification after restart:

- Startup reports **0 pending, 0 missing and 0 unstarted components** (568 total).
- `/nuxeo/runningstatus`, `/nuxeo/agentic-ui/`,
  `/nuxeo/agentic-ui-config/bootstrap.json`, `/nuxeo/nuxeoadmin/` and `/nuxeo/ui/` answer HTTP 200.
- The configured test credentials authenticate as `Administrator`.
- Admin Center opens at `http://localhost:8180/nuxeo/ui/#!/admin/admincenter` and displays healthy
  runtime, directories, repository and stream checks.
- Admin Console opens at `http://localhost:8180/nuxeo/nuxeoadmin/`.

**Remaining UI blocker:** neither installed administration UI offers the package upload, install,
upgrade and removal workflow this ticket calls for. Admin Console's navigation exposes probes,
reindexing, renditions, bulk actions, streams, configuration and bundles. The separate Admin Center
offers logs, ShowConf, server info, probes, renditions, cleanup, page providers and scaling tools.
It has no Update Center. `nuxeoctl mp-show nuxeo-jsf-ui` reports no matching remote or local package
in the target catalog. The official
[LTS-2025 hotfix notes](https://doc.nuxeo.com/nxdoc/hotfixes-installation-notes-for-nuxeo-platform-lts-2025/)
also state that JSF UI is no longer released in 2025. Do not force a 2023 JSF package onto this
server: the Satori package targets `[2025.0,2026.0)`.

Evidence is outside the checkout, under the session's `nxsat-680/` evidence directory:
`provisioning-report.json`, `installed-packages.json`, `admin-ui-package-metadata.json`,
`provisioned-bootstrap.json`, `680-provision.sh` and `admin-center-provisioned.png`.
The original `environment-preflight.json` describes the earlier, unprovisioned state.
The startup hook is guarded by marker files, so an ordinary restart does not reinstall packages.

Provisioning is complete for the available LTS-2025 administration UIs. The Admin Center rehearsal
still needs NXSAT-679's confirmed merge and a supported package-management UI, or a ticket-scope
decision to validate a different installation path. The provisioning record alone makes no claim
about the configuration-package lifecycle; the separate CLI run below covers that path.

## Local CLI verification — 2026-11-04

Before preparing the PR, the same disposable server was exercised with the current `main`
generator (`e19275697`). This is a local CLI check of ordinary generated packages, not evidence
that NXSAT-679's defect controls passed or that the Admin Center UI supports package management.

Two ZIPs were built with the same package identity `nxsat680-rehearsal` and component
`nxsat680.config.nxsat680-rehearsal`:

| Version | Branding application/document title | ZIP SHA-256                                                        |
| ------- | ----------------------------------- | ------------------------------------------------------------------ |
| `1.0.0` | `NXSAT-680 local v1`                | `802c849fdacd295b9cd5de9470c8d4f5962c38f531755bedfb590ad37f135105` |
| `1.0.1` | `NXSAT-680 local v2`                | `62fdf102da0cd963fe14a36c0d017bee5fb1d333e04009a0f31be1545d2e3911` |

The server's startup hook ran each requested `nuxeoctl` operation while the application was
stopped, recorded its exit status, and then started the application. All install operations used
`--accept=true --relax=false`; no dependency constraints were relaxed.

| Stage      | Observations                                                                                                                                                        | Result                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Baseline   | Healthy runtime/repository/stream; configured administrator identity; no rehearsal fragments or package; base Satori started                                        | `CLI baseline PASS (6 checks); Admin Center lifecycle NOT RUN` |
| Install v1 | Installer exit 0; only v1 started; v1 title served in bootstrap; both fragment provenances match the component; unrelated fragments unchanged; base Satori retained | `CLI v1 PASS (12 checks); Admin Center lifecycle NOT RUN`      |
| Upgrade v2 | Installer exit 0; only v2 started; both v2 titles served; both fragment provenances match; unrelated fragments unchanged; base Satori retained                      | `CLI v2 PASS (12 checks); Admin Center lifecycle NOT RUN`      |
| Remove     | Installer exit 0; rehearsal package and both fragments absent; entire bootstrap and manifest response bodies equal the saved baseline; base Satori retained         | `CLI remove PASS (11 checks); Admin Center lifecycle NOT RUN`  |

Browser verification additionally observed the title `NXSAT-680 local v2`, successful sign-in to
the Satori dashboard after the upgrade, and the original `Nuxeo Platform` title after removal.
The v1 title was checked in the served configuration, not separately in the browser.

Local evidence files: `baseline-report.json`, `v1-report.json`, `v2-report.json`,
`remove-report.json`, the corresponding configuration responses and installed-package inventories,
`v1-installer.log`, `v2-installer.log`, `remove-installer.log`, `v2-browser-report.json`,
`remove-browser-report.json`, `v2-satori.png` and `remove-satori.png`.
The fixture sources, ZIPs, `681-lifecycle.sh` and `verify-lifecycle.ps1` are retained beside them,
outside the repository. The server is left running with the rehearsal package removed.

For a repeat on a disposable server, retain a baseline, copy the two ZIPs onto that server, and
run these commands while the application is stopped, restarting and checking the configuration
between each operation:

```bash
nuxeoctl mp-install /path/to/nxsat680-rehearsal-1.0.0.zip --accept=true --relax=false
nuxeoctl mp-install /path/to/nxsat680-rehearsal-1.0.1.zip --accept=true --relax=false
nuxeoctl mp-remove nxsat680-rehearsal --accept=true --relax=false
```

These commands are intentionally not an Admin Center procedure. The UI protocol and acceptance
record below remain pending for the ticket's original path.

## Entry conditions

1. Establish that all NXSAT-679 fixes are merged into `main`, including its deliberate failure
   controls and successful `nuxeoctl mp-install` evidence. Record the PR and merge commit, then
   update the work branch from that base. Do not repair those defects as part of this rehearsal.
2. Verify the disposable server starts, record its exact Nuxeo version and authenticate as an
   administrator. Check that Admin Center's package management screens are available. If they
   are absent, record the missing prerequisite rather than substitute a CLI install result.
3. Install the compatible base `nuxeo-agentic-ui` package, at least `2026.0.2`, on this fixture
   and record its artifact hash and installed version. Base-server provisioning may use the CLI;
   the configuration-package lifecycle under test must use Admin Center.
4. Create a package named `nxsat680-rehearsal` with the repository's Node-only generator. Use
   owner `nxsat680`, version `1.0.0` and title `NXSAT-680 rehearsal v1`. Build a second artifact
   with the same identity, version `1.0.1`, and branding title `NXSAT-680 rehearsal v2`.
   Keep both ZIPs and their SHA-256 hashes outside the repository.
5. Save baseline responses from `/nuxeo/agentic-ui-config/bootstrap.json` and `manifest.json`,
   including headers and ETags. Identify the fragment names and component provenance the new
   package will contribute, so removal can be checked without assuming it is the only package.
6. Start a fresh screen recording before opening package management. Store the recording,
   screenshots, assertions, responses and server logs outside the repository. Do not record
   passwords, Connect identifiers or authentication headers.

The generator accepts a relative output directory. After the prerequisite merge, open PowerShell
in an external evidence/fixture directory and invoke the generator by its absolute checkout path:

```powershell
$checkout = '<absolute-path-to-checkout>'
node "$checkout/tools/satori-generators/src/config-package/create.mjs" nxsat680-rehearsal --owner=nxsat680 --version=1.0.0 --title="NXSAT-680 rehearsal v1" --directory=fixtures
```

Use `node fixtures/nxsat680-rehearsal/build.mjs` to build. For v2, change the
package version and both branding title fields in the same source fixture, build again and retain
v1. Record the actual commands and outputs. See the generated README for the contribution contract.

The UI path also needs a compatibility check. The official
[package installation guide](https://doc.nuxeo.com/nxdoc/installing-a-new-package-on-your-instance/)
describes the Admin tab's Update Center under **Managing Packages with JSF UI (deprecated)**.
The [Admin Console](https://doc.nuxeo.com/nxdoc/nuxeo-admin-console/) is a separate add-on,
`nuxeo-admin-console`; do not assume it exposes that legacy package flow. Record the UI add-on and
version actually used, and its compatibility with the target Nuxeo and Satori package versions.

## Rehearsal sequence to validate

The exact screen labels and restart behavior must be transcribed from the actual recording.
The sequence below is a test protocol, not a claim that those controls have been observed.

| Step     | Action through Admin Center                                                                                                         | Required observation                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline | Open package management and record the installed package list                                                                       | Base UI version recorded; rehearsal package absent; baseline configuration captured                                                                           |
| Install  | Use the available local-package upload/install flow for v1; inspect the proposed plan, apply it and follow its restart instructions | v1 installed, base UI retained, server healthy, v1 branding fragment served with this package's component provenance, application shows v1 title after reload |
| Upgrade  | Submit v2 with the same package name; inspect the plan, apply and restart as instructed                                             | v2 installed instead of v1; served fragment and rendered title show v2; v1 marker absent; unrelated configuration remains                                     |
| Remove   | Remove the rehearsal package; inspect the plan, apply and restart as instructed                                                     | Both rehearsal versions absent; base UI retained; rehearsal fragments absent from configuration responses; original branding restored after reload            |
| Review   | Compare the written steps with the recording and assertion results                                                                  | Every lifecycle claim maps to a timestamp, screenshot and falsifiable observation; gaps are explicit                                                          |

After each restart, verify authenticated server identity, configuration diagnostics and startup
logs. A package-list success message alone does not prove its contributions loaded. Compare
unrelated fragments by name and provenance; compare whole-response bytes/ETags only where the
expected state is identical. An HTTP 200 alone does not prove the intended configuration applied.

If the UI cannot upload or upgrade a local package, record that result with its screen and logs.
Do not silently replace it with publishing to Connect or installing via `nuxeoctl`. A different
distribution path needs to be documented and rehearsed as such.

## Evidence and acceptance record

Fill each row from a new run. Leave missing observations pending rather than mark them passed.

| Claim                                                             | Recording timestamp | Screenshot / response / log | Assertion and actual result |
| ----------------------------------------------------------------- | ------------------- | --------------------------- | --------------------------- |
| NXSAT-679 merged and base package compatible                      | Pending             | Pending                     | Pending                     |
| Baseline package and configuration state                          | Pending             | Pending                     | Pending                     |
| v1 installed through Admin Center and applied                     | Pending             | Pending                     | Pending                     |
| v1 upgraded to v2 through Admin Center and applied                | Pending             | Pending                     | Pending                     |
| Rehearsal package removed through Admin Center; baseline restored | Pending             | Pending                     | Pending                     |
| Runbook independently reviewed against recording                  | Pending             | Pending                     | Pending                     |

Use the assertion and recording conventions in
[`capture-phase-evidence`](../.cursor/skills/capture-phase-evidence/SKILL.md).
If the existing harness is used, its dev-app login/navigation helpers must not stand in for
Admin Center navigation. An independent evidence audit follows
[`audit-evidence`](../.cursor/skills/audit-evidence/SKILL.md) and `AGENTS/12-review-agents.md`.
Do not update the existing "Admin Center path is unrehearsed" claims or mark NXSAT-680 complete
until the lifecycle evidence and review are available.

## Fixture operations

Only these commands refer to this rehearsal container:

```powershell
docker logs --tail 100 nxsat680-admin-center
docker stop nxsat680-admin-center
docker start nxsat680-admin-center
```

Retain the stopped container while diagnosis or review needs it. Once evidence is retained and the
fixture is no longer needed, remove this named container and its anonymous fixture volumes with
`docker rm -v nxsat680-admin-center`. Never use a Docker-wide prune for this rehearsal.
