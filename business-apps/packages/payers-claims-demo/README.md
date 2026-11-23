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

| File                                                         | What it is                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                          | The app: its name, version, platform range and groups              |
| `bundle/agentic-ui-config/layouts/Member/view.layout.json`   | The Member record page: section 9's                                |
| `bundle/agentic-ui-config/layouts/Claim/view.layout.json`    | The Claim record page                                              |
| `bundle/agentic-ui-config/layouts/Case/view.layout.json`     | The Case record page                                               |
| `bundle/agentic-ui-config/layouts/Provider/view.layout.json` | The Provider record page, with the claims it billed                |
| `bundle/agentic-ui-config/queues/unassigned-claims.json`     | A queue                                                            |
| `bundle/agentic-ui-config/actions.json`                      | An approve button: a lifecycle transition                          |
| `bundle/agentic-ui-config/labels/en.json`                    | Its labels, in English                                             |
| `bundle/OSGI-INF/payers-claims-demo-config.xml`              | The component that contributes the four layouts                    |
| `bundle/OSGI-INF/payers-claims-demo-model.xml`               | **The stand-in model:** document types, lifecycles, page providers |
| `bundle/schemas/*.xsd`                                       | **The stand-in model's** schemas                                   |
| `demo/seed.mjs`, `demo/data.mjs`                             | The seed script and its fictional records. Not packaged            |
| `package/package.xml`                                        | The Marketplace package: name, version, and what it depends on     |
| `build.mjs`                                                  | Version 1's builder: the generator's, byte for byte                |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **No operation button.** Decision 3 is open, so the pipeline refuses every operation.
- **One version in two places:** `package.xml`'s and `app.json`'s `packageVersion`, raised
  together.

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

It writes `dist/payers-claims-demo-0.1.0.zip`.

## Installing it on a local Nuxeo

The local Nuxeo is the Docker container `nuxeo`, on port 8080. The package depends on
`nuxeo-agentic-ui` 2026.0.2 (`package/package.xml`), which serves its layouts: install that first.

```bash
docker cp business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.1.0.zip nuxeo:/tmp/
```

```bash
docker exec nuxeo nuxeoctl mp-install /tmp/payers-claims-demo-0.1.0.zip --accept=true
```

```bash
docker restart nuxeo
```

To remove it, `nuxeoctl mp-remove payers-claims-demo --accept=true`, then restart.

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
  credentials, no server, credentials refused, or the package not installed.

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
- **Labels, queues, actions and `app.json` are carried, not served:** the app registry will
  contribute them. Until then a card shows a heading only where its label is literal, and a field
  is labelled from its name, `billedAmount` as "Billed amount".
- **Phase 1's kit has more:** three queues and a home for two groups. This version has one queue
  and no home.
- **Not run against a server yet:** the install and the seed, against a real Nuxeo. The seed's
  logic is checked against a stand-in for the REST API it calls.
