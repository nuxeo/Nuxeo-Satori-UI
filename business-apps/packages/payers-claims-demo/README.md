# Payers Claims (demo)

The Payers kit, version 0 ([development plan](../../../docs/business-apps/development-plan.md),
phase 1), and the package pipeline's demo app definition
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md)). All its data is
fictional. Phase 0's demo runs on it, and the pipeline's controls
(`scripts/app-package.selftest.mjs`) break copies of it.

## The short version

- **Four record pages, as layout files:** Member, Claim, Case and Provider. The Member page is
  [layout-v2.md](../../../docs/business-apps/layout-v2.md)'s section 9, word for word.
- **A stand-in model,** until the presales Payers model arrives: the types, schemas and page
  providers those pages and the queue name. It is fictional, and replaced whole when theirs comes.
- **A seed script** writes a few members, with their claims and cases, so the pages have something
  to show. Run it twice and nothing is added the second time.

## What is in it

| File                                                         | What it is                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`                          | The app: its name, version, platform range and groups                 |
| `bundle/agentic-ui-config/layouts/Member/view.layout.json`   | The Member record page: section 9's                                   |
| `bundle/agentic-ui-config/layouts/Claim/view.layout.json`    | The Claim record page                                                 |
| `bundle/agentic-ui-config/layouts/Case/view.layout.json`     | The Case record page                                                  |
| `bundle/agentic-ui-config/layouts/Provider/view.layout.json` | The Provider record page, with the claims it billed                   |
| `bundle/agentic-ui-config/queues/unassigned-claims.json`     | A queue                                                               |
| `bundle/agentic-ui-config/actions.json`                      | An approve button: a lifecycle transition                             |
| `bundle/agentic-ui-config/labels/en.json`                    | Its labels, in English                                                |
| `bundle/OSGI-INF/payers-claims-demo-config.xml`              | The component that contributes the four layouts                       |
| `bundle/OSGI-INF/payers-claims-demo-model.xml`               | **The stand-in model:** document types, lifecycles, page providers    |
| `bundle/schemas/*.xsd`                                       | **The stand-in model's** schemas                                      |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`   | The seed script, its fictional records and its controls. Not packaged |
| `package/package.xml`                                        | The Marketplace package: name, version, and what it depends on        |
| `build.mjs`                                                  | Version 1's builder: the generator's, byte for byte                   |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **No operation button.** Decision 3 is open, so the pipeline refuses every operation.
- **One version in two places:** `package.xml`'s and `app.json`'s `packageVersion`, raised
  together. The manifest's `Bundle-Version` follows them; nothing checks it.

## The stand-in model

The presales Payers model has not arrived. Until it does, the package carries a fictional one, in
a component of its own so that it can be replaced whole: `payers-claims-demo-model.xml` and
`bundle/schemas/`.

| Type            | Schema (prefix)       | What it holds                                                                                                                                               |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Member`        | `member`              | `number`, `firstName`, `lastName`, `birthDate`, `address` (`street`, `city`, `zip`, `country`), `phone`, `email`, `plan`, `status`, `ssn`                   |
| `Claim`         | `claim`               | `number`, `member`, `provider`, `serviceDate`, `serviceStart`, `serviceEnd`, `received`, `billedAmount`, `allowedAmount`, `status`, `adjuster`, `diagnosis` |
| `Case`          | `case`                | `number`, `member`, `claim`, `category`, `state`, `received`, `due`, `assignee`, `summary`                                                                  |
| `Provider`      | `provider`            | `number`, `npi`, `specialty`, `network`, `phone`, `address`. Its name is its `dc:title`                                                                     |
| `ClaimDocument` | `claimdoc`, on a File | `claim`, the claim's number, and `category`                                                                                                                 |

- **A reference is the document's id.** `claim:member`, `claim:provider`, `case:member` and
  `case:claim` hold the `ecm:uuid` of what they point to, through Nuxeo's document resolver. That
  is what the page providers are given.
- **Statuses are properties,** as section 9 shows them: `member:status`, `claim:status`,
  `case:state`. Each schema lists its values. Every type has the platform's default lifecycle, so
  the approve action has a transition; a Payers lifecycle is phase 2's.
- **None of the four record types holds a file or is a folder,** so each opens as a record page.
- **Created by the seed, not by hand:** no folder lists the types among its subtypes, so the
  Create menu does not offer them.
- **The names are plain:** `Member`, `Claim`, `member_claims` and the rest. On a server shared with
  another model that uses them, the two would collide. The presales model sets the real ones.

| Page provider              | Given                    | Returns                                                       |
| -------------------------- | ------------------------ | ------------------------------------------------------------- |
| `member_claims`            | A member's `ecm:uuid`    | The member's claims, latest service first                     |
| `member_cases`             | A member's `ecm:uuid`    | The member's cases, latest change first                       |
| `provider_claims`          | A provider's `ecm:uuid`  | The claims the provider billed                                |
| `payers_claim_documents`   | A claim's `claim:number` | The claim's documents                                         |
| `payers_unassigned_claims` | Nothing                  | Claims with no adjuster, submitted or in review, oldest first |

Each binds what it is given as a quoted literal, and leaves out versions, proxies and trashed
records.

## Building it

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0
```

It writes `dist/payers-claims-demo-0.2.0.zip`.

## Installing it on a local Nuxeo

The local Nuxeo is the Docker container `nuxeo`, on port 8080. Run on 23 November 2026 against
Nuxeo 2025.10.18, as below.

**1. `nuxeo-agentic-ui` first.** This package depends on it (`package/package.xml`), and it serves
the layouts. A server registered with Nuxeo Connect installs it from the Marketplace. Otherwise
build it from this repository, writing a version into its `package.xml` first, as
`build-marketplace.yml` does: its source says `@VERSION@`, and nothing in the Maven build replaces
it.

```bash
sed -i.orig 's/version="@VERSION@"/version="2026.0.2-'"$(date +%Y%m%d%H%M%S)"'-BUILD-local"/' nuxeo-agentic-ui-package/src/main/resources/package.xml
```

```bash
mvn -pl nuxeo-agentic-core,nuxeo-agentic-ui-package package -DskipTests
```

```bash
mv nuxeo-agentic-ui-package/src/main/resources/package.xml.orig nuxeo-agentic-ui-package/src/main/resources/package.xml
```

**2. Both packages into the container,** then a one-off script that installs them when it next
starts. `nuxeoctl mp-install` refuses while the server runs, and the server is the container's
main process, so stopping it stops the container. The image runs every `.sh` file in
`/docker-entrypoint-initnuxeo.d/` before it starts the server; this one removes itself.

```bash
docker cp nuxeo-agentic-ui-package/target/nuxeo-agentic-ui-package-2026.0.2-SNAPSHOT.zip nuxeo:/tmp/nuxeo-agentic-ui.zip
```

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.2.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-ui.zip /tmp/payers-claims-demo-0.2.0.zip --accept=true > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.** `/var/log/nuxeo/payers-kit-install.log` in the container lists both packages
installed, and the server log's `Component Loading Status` has nothing pending or missing.
`/nuxeo/agentic-ui-config/layouts.json` lists the four `view` layouts.

### Removing it

**First delete the seeded workspace,** `/default-domain/workspaces/payers-demo`, and empty it
from the trash: do the same before replacing the stand-in model. A document whose type is gone
cannot be read, and would break the folder and the searches that hold it.

Then remove the package the way it was installed. `nuxeoctl mp-remove`, like `mp-install`,
refuses while the server runs, and stopping the server stops the container, so a one-off script
removes it when the container next starts, then removes itself. **Not run yet:** this was written
from the install, which was.

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-remove payers-claims-demo --accept=true > /var/log/nuxeo/payers-kit-remove.log 2>&1 || echo "payers kit: removal failed, see /var/log/nuxeo/payers-kit-remove.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-remove.sh && chmod 755 /tmp/zz-payers-kit-remove.sh
```

```bash
docker cp /tmp/zz-payers-kit-remove.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<user> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/payers-claims-demo/demo/seed.mjs
```

- **What it writes:** four members, three providers, eight claims, three cases and four claim
  documents, under `/default-domain/workspaces/payers-demo`.
- **Safe to run twice.** A record already there is put back to `data.mjs`'s values, a trashed one
  is restored, and a place that holds a document of another type stops the run untouched.
- **It checks what it wrote:** last, it runs the five page providers and compares what they
  return with what it seeded.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default;
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met: no
  credentials, no server, credentials refused, the package not installed, or no
  `/default-domain/workspaces`.

It prints a member's and a provider's record page, on the app at `APP_URL`
(`http://localhost:4200` by default, `npx nx serve nuxeo-ui`).

**The social security number** shows only to members of the group `member-services`
(`app.rules.inGroup`). An administrator is not in it, so to see it, add yourself to a group of that
name. Hiding it is a convenience, not a control: the API still returns it to anyone who may read
the member, and masking it there is decision I.

## Not done yet

- **Related records are not drawn yet** ([layout-v2.md](../../../docs/business-apps/layout-v2.md),
  section 11), so the Member page's claims and cases cards, the Claim page's documents and the
  Provider page's claims are left out until the lists engine lands. The page providers they name
  are installed and seeded.
- **A reference shows its stored id, not a link:** the `document-link` widget has no lookup yet
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 11), so the Case page's member
  and claim, and the Claim page's member, show the record's `ecm:uuid` until it does.
- **Labels, queues, actions and `app.json` are carried, not served:** the app registry will
  contribute them. Until then a card shows a heading only where its label is literal, and a field
  is labelled from its name, `billedAmount` as "Billed amount".
- **Phase 1's kit has more:** three queues and a home for two groups. This version has one queue
  and no home.
- **Not seen in the app yet:** the install and the seed have run on a local Nuxeo, and the server
  serves the four layouts, but the record pages themselves have not been looked at in a browser.
- **The seed's controls are not in CI:**
  `node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs` checks its logic against
  a stand-in for the REST API it calls, so it proves the script, not the server.
