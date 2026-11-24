# Payers Claims (demo)

The Payers kit, version 1 ([development plan](../../../docs/business-apps/development-plan.md),
phase 1), and the package pipeline's demo app definition
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md)). All its data is
fictional. Phase 0's demo runs on it, phase 1's demo script runs on it (below), and the pipeline's
controls (`scripts/app-package.selftest.mjs`) break copies of it.

## The short version

- **Four record pages, as layout files:** Member, Claim, Case and Provider. The Member page is
  [layout-v2.md](../../../docs/business-apps/layout-v2.md)'s section 9, word for word.
- **Three queues, a home for two groups, a menu and labels:** claims adjusters see the unassigned
  claims and their own; member services, and supervisors, see the claims pending determination.
  The home's KPIs count from the queues' page providers, through their aggregates.
- **A stand-in model,** until the presales Payers model arrives: the types, schemas and page
  providers those files name. It is fictional, and replaced whole when theirs comes.
- **A seed script** writes a few members, with their claims and cases, and the four people who
  work them, in the groups the files' rules name. Run it twice and nothing is added the second
  time.
- **The demo script,** phase 1's five steps, as a steps file of the beta harness:
  [`scripts/beta-harness/steps/payers-claims-demo.mjs`](../../../scripts/beta-harness/steps/payers-claims-demo.mjs).
- **What a production install shows:** the record pages and the model, to everyone, and the home,
  the menu, the queues and the labels from the app registry, after sign-in, to the three demo
  groups `app.json` names. The development server serves the same files through
  `npm run config:dev`, and a file it serves wins there
  ([below](#what-a-server-shows-and-what-the-dev-server-does)).

## What is in it

| File                                                           | What it is                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                            | The app: its name, version, platform range and groups                                      |
| `bundle/agentic-ui-config/layouts/Member/view.layout.json`     | The Member record page: section 9's                                                        |
| `bundle/agentic-ui-config/layouts/Claim/view.layout.json`      | The Claim record page                                                                      |
| `bundle/agentic-ui-config/layouts/Case/view.layout.json`       | The Case record page                                                                       |
| `bundle/agentic-ui-config/layouts/Provider/view.layout.json`   | The Provider record page, with the claims it billed                                        |
| `bundle/agentic-ui-config/layouts/Member/metadata.layout.json` | Version 1: the Properties panel beside the Member page, without the social security number |
| `bundle/agentic-ui-config/queues/unassigned-claims.json`       | Adjusters: claims no one holds yet, with a Status facet                                    |
| `bundle/agentic-ui-config/queues/my-claims.json`               | Adjusters: the claims they hold, through `$currentUser`                                    |
| `bundle/agentic-ui-config/queues/pending-determination.json`   | Member services and supervisors: claims in review or pended                                |
| `bundle/agentic-ui-config/home.json`                           | The home: KPI cards for adjusters and for member services                                  |
| `bundle/agentic-ui-config/navigation.json`                     | The menu: the home, the three queues, and two platform pages                               |
| `bundle/agentic-ui-config/actions.json`                        | An approve button: a lifecycle transition                                                  |
| `bundle/agentic-ui-config/labels/en.json`                      | Its labels, in English: every key the files above name                                     |
| `bundle/OSGI-INF/payers-claims-demo-config.xml`                | The component that contributes the five layouts                                            |
| `bundle/OSGI-INF/payers-claims-demo-model.xml`                 | **The stand-in model:** document types, lifecycles, page providers                         |
| `bundle/schemas/*.xsd`                                         | **The stand-in model's** schemas                                                           |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`     | The seed script, its fictional records and people, and its controls. Not packaged          |
| `package/package.xml`                                          | The Marketplace package: name, version, and what it depends on                             |
| `build.mjs`                                                    | Version 1's builder: the generator's, byte for byte                                        |
| `content-model.json`                                           | The stand-in model as the server answers it, for `--model`                                 |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **No operation button.** Decision 3 is open, so the pipeline refuses every operation.
- **One version in three places:** `package.xml`'s, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`, raised together. The pipeline's step 3 refuses any of them that
  differs, and, given the package as it was (`--previous`), a version that moved less than the
  changes need ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 8).
  0.3.0 is the minor raise this version needs over 0.2.0: the `members` group no longer has the
  app, which is breaking, and below 1.0.0 a breaking change raises the minor.

## The stand-in model

The presales Payers model has not arrived. Until it does, the package carries a fictional one, in
a component of its own so that it can be replaced whole: `payers-claims-demo-model.xml` and
`bundle/schemas/`.

| Type                | Schema (prefix)                       | What it holds                                                                                                                                               |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Member`            | `member`                              | `number`, `firstName`, `lastName`, `birthDate`, `address` (`street`, `city`, `zip`, `country`), `phone`, `email`, `plan`, `status`, `ssn`                   |
| `Claim`             | `claim`                               | `number`, `member`, `provider`, `serviceDate`, `serviceStart`, `serviceEnd`, `received`, `billedAmount`, `allowedAmount`, `status`, `adjuster`, `diagnosis` |
| `Case`              | `case`                                | `number`, `member`, `claim`, `category`, `state`, `received`, `due`, `assignee`, `summary`                                                                  |
| `Provider`          | `provider`                            | `number`, `npi`, `specialty`, `network`, `phone`, `address`. Its name is its `dc:title`                                                                     |
| `ClaimDocument`     | `claimdoc`, on a File                 | `claim`, the claim's number, and `category`                                                                                                                 |
| `PayersClaimSearch` | `payers_claim_search` (`claimsearch`) | The claim queues' search document, never saved: `claim_status_agg` and `claim_adjuster_agg`, the facets a queue sends back. Hidden                          |

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

| Page provider              | Given                    | Returns                                                                                        |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `member_claims`            | A member's `ecm:uuid`    | The member's claims, latest service first                                                      |
| `member_cases`             | A member's `ecm:uuid`    | The member's cases, latest change first                                                        |
| `provider_claims`          | A provider's `ecm:uuid`  | The claims the provider billed                                                                 |
| `payers_claim_documents`   | A claim's `claim:number` | The claim's documents                                                                          |
| `payers_unassigned_claims` | Nothing                  | Claims with no adjuster, submitted or in review, oldest first. Aggregate: `claim_status_agg`   |
| `payers_my_claims`         | An adjuster's user name  | The claims they hold, latest service first. Aggregate: `claim_status_agg`                      |
| `payers_pending_claims`    | Nothing                  | Claims in review or pended, oldest first. Aggregates: `claim_status_agg`, `claim_adjuster_agg` |

Each binds what it is given as a quoted literal, and leaves out versions, proxies and trashed
records.

- **The three queue page providers read the search index,** not the repository: a queue's facets
  and a KPI's buckets are aggregates, which only the index answers. They are
  `SearchServicePageProvider`, the class Nuxeo 2025 gives `default_search`, each with the search
  document `PayersClaimSearch`. An aggregate's id, its field there and the parameter the app sends
  back, such as `claim_status_agg=["paid"]`, are one name. The index is written a moment after the
  repository, so they lag a change by about a second.
- **`payers_my_claims` is given `$currentUser`,** by the queue and by the home: the REST API puts
  the name of the person signed in in its place before the query runs (`QueryExecutor` in
  `nuxeo-search-rest-api`). So no one's name is in a file, and each adjuster is asked for their own
  claims. The seed checks it, as each adjuster. **The kit relies on that server behaviour:** whether
  version 2 of the app definition says a literal may name the person this way is still open
  ([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 13).

## Building it

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0
```

It writes `dist/payers-claims-demo-0.3.0.zip`.

Held to the package as it was, as a pull request's check holds it
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 8), it also writes
`dist/payers-claims-demo-0.3.0.changes.md`. Run on 24 November 2026 against the staging branch's
0.2.0: 27 changes, which need a minor version, and 0.3.0 raises the minor.

```bash
mkdir -p /tmp/base && git archive origin/staging/enterprise-grade-app business-apps/packages/payers-claims-demo | tar -x -C /tmp/base
```

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 --previous /tmp/base/business-apps/packages/payers-claims-demo
```

Held to its content model ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md),
section 4): `content-model.json` is the stand-in model as a local Nuxeo with this package installed
answers it. It was exported with `npm run app-package:model` and cut down to the kit's five types,
their facets and their schemas. Export it again when the stand-in model changes.

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 \
  --model business-apps/packages/payers-claims-demo/content-model.json
```

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
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.3.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-ui.zip /tmp/payers-claims-demo-0.3.0.zip --accept=true > /var/log/nuxeo/payers-kit-install.log 2>&1 || echo "payers kit: install failed, see /var/log/nuxeo/payers-kit-install.log"' 'rm -f "$0"' > /tmp/zz-payers-kit-install.sh && chmod 755 /tmp/zz-payers-kit-install.sh
```

```bash
docker cp /tmp/zz-payers-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.** `/var/log/nuxeo/payers-kit-install.log` in the container lists both packages
installed, and the server log's `Component Loading Status` has nothing pending or missing.
`/nuxeo/agentic-ui-config/layouts.json` lists the four `view` layouts and Member's `metadata` one.

**Over version 0.2.0,** install only this package: `mp-install` upgrades it, removing 0.2.0 first,
and the records stay. Version 0.3.0 adds a type and page providers, and removes none, so nothing
needs deleting first. Run on 23 November 2026, as above, with `nuxeo-agentic-ui` already installed.
A rebuild of a version already installed is skipped as unchanged: in the one-off script, run
`nuxeoctl mp-remove payers-claims-demo --accept=true` before `mp-install`, as was done here.

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
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

The demo's people are given a password of your choosing, for this server, which the seed puts back
on every run:

```bash
export PAYERS_DEMO_PASSWORD=<a password for the demo users>
```

```bash
node business-apps/packages/payers-claims-demo/demo/seed.mjs
```

- **What it writes:** four members, three providers, eight claims, three cases and four claim
  documents, under `/default-domain/workspaces/payers-demo`.
- **And the people:** four fictional users, in the three groups the kit's rules name.

  | User           | Groups                                   | Works              |
  | -------------- | ---------------------------------------- | ------------------ |
  | `dana.lee`     | `claims-adjusters`                       | Most of the claims |
  | `morgan.chen`  | `claims-adjusters`, `claims-supervisors` | One pended claim   |
  | `riley.brooks` | `member-services`                        | Two cases          |
  | `sam.patel`    | `member-services`                        | The appeal         |

  Every group may read the workspace; adjusters and supervisors may also change claims, which
  approving one needs. No demo group may change a member, so none of the demo's people is offered
  the Member edit form, which would list the social security number. The seed checks both as each
  user, wherever the permission comes from.

- **Safe to run twice.** A record already there is put back to `data.mjs`'s values, a trashed one
  is restored, and a place that holds a document of another type stops the run untouched. A user
  is put back to its name, groups and the demo password, and the demo's groups to their
  permissions. A user or a group of the same name that the seed did not create, which it knows by
  its marker (a user's `company`, a group's `description`), is found before anything is written,
  and stops the run with exit 2.
- **It checks what it wrote:** last, it signs in as each user, and checks their groups and what
  they may change, once. Then it runs the seven page providers and compares what they return with
  what it seeded, each queue's aggregates included, asking `payers_my_claims` for each adjuster's
  claims as that adjuster. A queue may hold claims the seed did not write: the seed checks its
  own, and the demo refuses such a server. The search index lags the repository, so the page
  providers are asked again, once a second, for up to `NUXEO_INDEX_WAIT_MS` (60 seconds).
- **What it needs:** Node 24, nothing to install. `NUXEO_USER`, `NUXEO_PASS` and
  `PAYERS_DEMO_PASSWORD` have no default, and `NUXEO_USER` must be an administrator: only one may
  create users and groups. `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a
  precondition is not met: no credentials, no demo password, no server, credentials refused or not
  an administrator's, the package not installed or older than 0.3.0, no
  `/default-domain/workspaces`, or a user or a group of the demo's names that the seed did not
  create.

It prints a member's and a provider's record page, on the app at `APP_URL`
(`http://localhost:4200` by default, `npx nx serve nuxeo-ui`).

### Seeing it under `nx serve`

Installed on a server, the app reads its layouts from `/nuxeo/agentic-ui-config/`, which the
package fills. Under `npx nx serve nuxeo-ui` it reads `/agentic-ui-config/` on its own port
instead (`app-config.tokens.ts`), served from the git-ignored
`apps/nuxeo-ui/public/agentic-ui-config/`, which `npm run config:dev` writes. This serves the
kit's layouts, home, menu, queues and labels there, from the repository's root:

```bash
C=business-apps/packages/payers-claims-demo/bundle/agentic-ui-config && npm run config:dev -- --layout Member/view=$C/layouts/Member/view.layout.json --layout Member/metadata=$C/layouts/Member/metadata.layout.json --layout Claim/view=$C/layouts/Claim/view.layout.json --layout Case/view=$C/layouts/Case/view.layout.json --layout Provider/view=$C/layouts/Provider/view.layout.json --home $C/home.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/unassigned-claims.json --queue $C/queues/my-claims.json --queue $C/queues/pending-determination.json
```

Then start the dev server, or restart it: it serves only the files that were there when it
started.

```bash
npx nx serve nuxeo-ui
```

Sign in as one of the demo's people, with the demo password: `dana.lee` for an adjuster's home,
`riley.brooks` for member services'. An administrator is in none of the kit's groups, so sees an
empty home and none of the queues.

**The social security number** shows only to members of the group `member-services`
(`app.rules.inGroup`), on the Member page. The Properties panel beside it lists the member's
properties from `layouts/Member/metadata.layout.json`, which leaves the number out for everyone:
version 1 has no rules, and without the file the panel lists the whole schema, the number
included, to everyone the page hides it from. Hiding it is a convenience, not a control: the API
still returns it to anyone who may read the member, and masking it there is decision I.

## Running the demo

Phase 1's demo script, as a steps file of the beta harness
([`scripts/beta-harness/README.md`](../../../scripts/beta-harness/README.md)), end to end:

1. an adjuster's home, with KPIs from the page providers' aggregates;
2. a queue opened, its rows in the server's order, and narrowed by a facet on the server;
3. a member, opened from the queue through its member column, a link named for the member, with
   age, combined address, and the claims and cases lists;
4. member services seeing the social security number, which the adjuster does not, anywhere on
   the Member page, the Properties panel included; nor may the adjuster change the member, whose
   Edit form would list it;
5. the layout file behind the page, beside it.

Step 4 differs from the plan's words, "the protected fields are masked on screen": it follows the
Member page this kit has, layout-v2.md's section 9, which shows the number to member services
alone and leaves it out, not masked, for everyone else. Masking the value itself is decision I.

Its figures, rows and values are read from `data.mjs` and the kit's files; the demo's own choices,
which cards each group's home shows, the member and the facet bucket, are written in the script.
**What it needs:** the package installed and seeded (above), the dev server serving the kit's files
(above), and Playwright (`scripts/beta-harness/README.md`, "Prerequisites"). It signs in as an
adjuster, the run's own user, then switches the browser to member services, which the identity guard
is told of.

```bash
NUXEO_USER=dana.lee NUXEO_PASS="$PAYERS_DEMO_PASSWORD" npm run beta:evidence -- payers-claims-demo
```

`APP_URL` names the dev server if it is not on `http://localhost:4200`. The evidence, screenshots,
a video and `INDEX.md`, goes to `~/Desktop/agentic-ui-evidence/beta/payers-claims-demo/`, outside
the repository. Exit 2 means a precondition is not met, and says which: the run's user is not an
adjuster in no other group, `PAYERS_DEMO_PASSWORD` is unset or refused, the package or the seed is
missing, a claim the seed did not write is in what the demo counts, or the dev server serves
something other than the kit's files.

Run on 24 November 2026, against Nuxeo 2025.10.18 with this package installed and seeded: 37 of 37
checks passed, on six distinct screenshots. With the kit broken on purpose in six runs, and in a
seventh the steps file pointed at a claim instead of the member, 21 of its 27 checks outside the
preconditions were each seen failing: every home figure and card set, both menus, the queue's order,
facet, request and narrowing, the member's name, age, address, claims and cases, the SSN hidden from
the adjuster (by its rule, and by the Properties panel) and shown to member services, the adjuster's
right to change the member, and the page drawn as its file says. Not seen failing: the queue's
address and title, the record page's three cards, the Properties panel drawn, the served layout
being the kit's, the bundle holding no code, and the console. Of the preconditions, these were seen
refusing a real environment: the dev server serving other files, a supervisor as the run's user,
and, with its test widened on purpose, a claim another session had left on the server, which the
demo's figures do not count; and, with the seeded statuses it expects changed, the one that proves
the properties it judges arrived.

**Changed since that run, and not run since:** step 3 opened the member by its address then. It
now clicks the member's link in a row of the narrowed queue, after a check that the link's text is
the member's name and that it links to the member, and a precondition that one of the rows step 2
leaves is the member's claim. The script runs as `dana.lee`, whose password was not to hand, so
the whole of it has not been run with that change. What was checked, on 24 November 2026 in a
headless browser against the same server, is what the new lines read, run as an administrator
over a copy of `my-claims.json` that names `dana.lee` in place of `$currentUser` and drops its
group rule, since an administrator is shown no queue: the queue narrowed to "paid", the row of
CLAIM-000130 with one member link, reading "John Smith" and routed to the member, and the click
opening the member's record page with its three cards. The other checks of step 3 are unchanged.

## What a server shows, and what the dev server does

The configuration servlet in `nuxeo-agentic-core` answers a fixed set of addresses, to everyone:
the bootstrap, the manifest, `layouts.json` and the layouts it lists, and images. The app
registry, beside it, serves the rest of the app after sign-in, to the groups `app.json` names,
from the `<app>` the kit's component contributes
([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 10). It is
built on the decision log's proposed answers to B and E, which are open
([decisions.md](../../../docs/business-apps/decisions.md)). So, installed on a server, with a
`nuxeo-agentic-core` that has the registry:

| Part                         | Served by the package on a server                  | Under `config:dev`                                        |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| The model and page providers | Yes                                                | From the server                                           |
| The five layouts             | Yes                                                | Yes                                                       |
| `home.json`                  | From the registry, to the demo groups              | Yes, and it wins over the registry's                      |
| `navigation.json`            | From the registry, to the demo groups              | Yes, and it wins over the registry's                      |
| The three queues             | From the registry, to the demo groups              | Yes, and they win over the registry's                     |
| `labels/en.json`             | From the registry, to the demo groups              | Yes, and it wins over the registry's                      |
| `actions.json`               | From the registry; nothing in the app reads it yet | No, so the approve button is left out of the queues' rows |
| `app.json`                   | From the registry: it lists the app                | No                                                        |

**So a production install shows the record pages to everyone, and the home, the menu and the
queues to the demo groups once they sign in.** A person in none of them, an administrator
included, is shown no app. The demo itself still runs on a development server, as it does here.

## Not done yet

- **A record the reader may not read was not seen live.** A reference shows the record it names, by
  its title, as a link that opens it
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 11): a queue's member column,
  the Provider page's claims, the Case page's member and claim, the Claim page's member, and the
  Properties panel beside a Case or a Claim. The panel was checked live on 24 November 2026, as an
  administrator in a headless browser: beside CASE-2042, the member shows as "John Smith" and the
  claim as "CLAIM-000132", each a link to its record, the member's opening it when clicked, and
  neither id is on the panel. A reference to a record that no longer exists shows "Unavailable",
  and so does one the reader may not read, which was not seen: the checks ran as an administrator,
  who may read every record.
- **The approve button is not offered on a queue's rows,** nor in bulk: `actions.json` is carried
  and not served, and the queue leaves out an action the app does not register, saying so in the
  console.
- **The menu's two platform entries are not added:** `app.navbar.tasks` and `app.navbar.search`
  are in the platform's menu already, and the console says so. They are there for when an app's
  entries may replace the platform's (app-definition-v2.md, section 13).
- **`content-model.json` does not list `PayersClaimSearch`:** no layout names it, and the
  pipeline holds only layouts to the model.
- **The seed's and the demo's controls are not in CI:**
  `node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs` checks the seed's logic
  against a stand-in for the REST API it calls, so it proves the script, not the server; the demo
  needs a server and a dev server, and runs by hand.
