# The extension model: how customers extend Nuxeo Satori without our source

**Status: a proposal for review, written on 27 November 2026.** Nothing here is decided. It needs
these decisions:

- three new ones, **L**, **M** and **N**;
- two already open, **K** and **5**.

All five are in [decisions.md](decisions.md). Until they are taken, the plan's work goes on as it
is.

## The short version

- **The rule.** A customer receives only signed, versioned Marketplace packages and published
  tools from us, never our source. Everything a customer builds is **a package of their own that
  depends on ours**, layered on top of what we ship, and never an edit of it. This is already the
  direction [`CUSTOMISING.md`](../../CUSTOMISING.md) sets: "ship your own Nuxeo Marketplace package
  that depends on ours … an upgrade of ours never touches them".
- **What we ship, in four tiers:**
  1. the platform;
  2. the domain add-ons;
  3. the industry kits;
  4. the tools.

  Each tier depends only on the ones before it.

- **What a customer builds, in order of preference:**
  1. configuration;
  2. server logic in their own Studio project;
  3. user-interface code, only where configuration can't reach.
- **Six gaps stand between this and what is built.** The first is structural: a customer's file
  replaces ours whole, so extending one of our kits means copying it. Patch overlays fix that,
  decision L.
- **The proposed order:**
  1. patch overlays;
  2. publishing the Builder kit (K), the add-ons and the kits (N);
  3. customers' own signing and promotion (M);
  4. decision 5 again, now that a customer ships only packages;
  5. the platform's 1.0 contract.

## 1. The rule

A customer never receives the platform's source. This repository is public, but it is not a
customer deliverable: [`CUSTOMISING.md`](../../CUSTOMISING.md) says the rest of it "is a development
workspace for people working on Satori itself". What a customer receives:

- signed Marketplace packages, which an administrator installs on the customer's Nuxeo;
- published tools, which a developer or presales engineer runs on their own computer, with no
  clone of this repository and no token for Hyland's private packages;
- the documentation that goes with both.

Everything a customer changes, they change by shipping a package of their own. That package
declares which of ours it depends on, and at which versions. It is checked by the same validator as
ours, and is installed and upgraded on its own schedule. An upgrade of ours never edits it.

## 2. What we ship

| Tier                  | What it is                                                                                                                                                                                                                                               | Depends on               | State on 27 November 2026                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The platform       | `nuxeo-agentic-ui-package`: the app and `nuxeo-agentic-core`                                                                                                                                                                                             | Nuxeo LTS 2025           | Published to the Marketplace's preprod on demand by `build-marketplace.yml`, which ran it on 3, 12 and 18 November                                                                                                                                                                                                           |
| 2. The domain add-ons | One Marketplace package per domain module (decision B): `nuxeo-agentic-assets`, `-records`, `-documents`, `-connectors`, `-signature`, `-embedded`, `-capture`, `-letters`                                                                               | The platform             | Built and tested on every pull request by `build-marketplace.yml`, whose steps say each zip "is not uploaded or published". **None is published**                                                                                                                                                                            |
| 3. The industry kits  | App definition packages, each a starting point for one kind of business: Payers, property and casualty claims, onboarding and disputes, vehicle deals and titles, moves and damage claims, media, records, controlled documents, contracts, brand assets | The platform and add-ons | Each declares its dependencies in `package.xml`. For example, `records-demo` depends on `nuxeo-agentic-ui:2026.0.2` and `nuxeo-agentic-records:0.3.0`. `app-packages.yml` signs one and publishes it to preprod when an `app-package/<name>/<version>` tag is pushed, and no such tag has been pushed. **None is published** |
| 4. The tools          | The Builder kit (the package pipeline, the generators, the MCP server and the app builder skill), the scaffolder, and the designer inside the app                                                                                                        | —                        | The designer ships in the app. **The rest runs only from a clone** of this repository: `@nuxeo-satori/builder-mcp` and `@nuxeo-satori/generators` are private, and `CUSTOMISING.md` calls the clone "a rough edge we intend to remove" (decision K)                                                                          |

The kits are accelerators, not finished products. A customer is expected to start from one and make
it theirs, which is why section 4 matters.

## 3. What a customer builds

Three kinds of change, in order of preference. Each step down costs more to build, review, secure
and upgrade.

1. **Configuration, with no code.**
   - **Branding,** in Layer 0's `bootstrap.json`.
   - **What the app shows,** in Layer 1's `manifest.json`: hide, reorder, relabel and gate.
   - **App definitions** in version 2's files: record pages, queues, home cards, the menu, task
     forms, actions and labels. Either a new app on their own model, or an overlay on one of our
     kits.

   Written by hand, by the Builder kit's agent, or in the designer.

2. **Server logic they already own.** Their Studio project holds their document types, schemas,
   vocabularies, workflows and Automation chains, as it does for Web UI today. The app reads their
   model from the server. A button calls one of their chains only through the deployment's
   operation allow-list (decision 3). Most of a business's own rules already live here in Nuxeo,
   and they stay there.
3. **User-interface code, only where configuration cannot reach.** A plugin written against the
   published `@nuxeo/satori-platform` API, whose `package.json` publishes it to
   `packages.nuxeo.com`, and shipped inside the customer's own package. Section 6 says what this
   needs, since today a customer's code can only be built into the app from the template's source.

**How it composes, by kind of business.** Each is the customer's package, our kit, our add-ons and
their Studio project:

| Business                | Starts from                             | Our add-ons                                     | What the customer adds                                                                           |
| ----------------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Property and casualty   | The P&C claims kit                      | Connectors, capture, letters                    | Their fields and queues over the kit; a connector to their policy system; their letter templates |
| Banking                 | The onboarding and disputes kit         | E-signature, records, connectors                | Their KYC checklist; their e-signature vendor's provider; their core-banking connector           |
| Health payers           | The Payers kit                          | Letters, connectors                             | Their claim fields and workflows from Studio; their determination and appeal letters             |
| Brand assets and media  | The brand assets or media kit           | Assets: rights, windows, watermarks, deliveries | Their rights policies, territories and distributors; their reviewer groups                       |
| Engineering and records | The controlled documents or records kit | Documents, records                              | Their numbering series, export-control marks and retention rules                                 |

## 4. How the layers combine

[architecture.md](architecture.md), section 10, sets the order: "starter kit, then customer, then
tenant, then environment, merged on the server in that order". The designer's deployment layer sits
above them, and holds an administrator's changes made in the browser.

**What is built is replacement, not merging.**
[extension-reference.md](../extension-reference.md) says it plainly: "a later package's file for
the same type and mode replaces yours whole". An app with the same id replaces it whole too, and
the deployment layer's live file wins over the package's file at the same path. Labels are the
exception: they are looked up by key, and a customer's manifest labels win.

So a customer who wants one more field on the Payers kit's claim page must copy the whole
`layouts/Claim/view.layout.json` into their package. From then on, every fix we make to that page
in a later kit version passes them by. The upgrade check
([package-pipeline.md](package-pipeline.md), section 10) refuses what we _remove_, but it cannot
tell a customer what they _missed_. At one customer this is a nuisance. Across hundreds, extending a
kit and upgrading it would pull against each other, which is the problem a product's extension
model exists to avoid.

### Patch overlays (decision L)

A customer's package changes our file by naming what it changes, not by replacing it. A sketch, not
a format:

```json
{
  "format": "nuxeo-agentic-ui-overlay/1",
  "target": {
    "package": "payers-claims-demo",
    "range": "^0.8.0",
    "file": "layouts/Claim/view.layout.json"
  },
  "operations": [
    {
      "op": "addField",
      "card": "claim",
      "after": "clm:amount",
      "field": { "property": "acme:adjusterRegion" }
    },
    { "op": "hide", "card": "notes" },
    { "op": "relabel", "card": "claim", "labelKey": "acme.claim.card" },
    { "op": "move", "card": "documents", "before": "timeline" }
  ]
}
```

- **What it addresses:** elements by what already names them. A card has an `id` in layout
  version 2, a field its property, a queue's column its property, a menu entry its id, and a home
  card its id. An element with no stable name cannot be patched until it has one. That is a rule
  for us, as the kits' authors, not for the customer.
- **Where it is merged:** on the server, in the section's order, before the registry serves the
  result. Every layer's patches apply to the layer below.
- **Checks:** the validator checks the merged result as it checks a file today, and the pipeline
  checks a patch against the kit version it names.
- **On upgrade:** when a new kit version arrives, the upgrade check re-applies each customer's
  patches to it. It reports any operation whose anchor is gone or moved, as a conflict for a person
  to settle, and never drops one silently.
- **The designer:** for a file a kit owns, it writes a patch into the deployment layer, not a whole
  copy.
- **Replacing still exists,** for a customer who means to own a file outright, and the upgrade check
  names every replaced file on each upgrade.

**Open within L:**

- which files take patches, at first: layouts, queues, home, navigation, actions, task forms;
- the operations' closed list;
- whether a field needs an id of its own when one property is shown twice;
- how a conflict is shown to an administrator;
- the format's version and compatibility rules, since it becomes a long-term contract with every
  customer.

## 5. Tools without the repository (decision K)

Decision K is already open ([decisions.md](decisions.md), "Open: from phase 3"). In this model its
recommendation reads:

- **One versioned package:** the pipeline's command, the generators, the MCP server and the app
  builder skill, run with `npx`, at the platform's version.
- **The scaffolder,** distributed on its own, as `CUSTOMISING.md` already intends.
- **Preview,** which runs the app's dev server, needs either a published dev-mode build of the app
  or a hosted preview. Until one exists, a customer previews on their development server.

## 6. Customer code without our source (decision 5)

Decision 5 keeps a customer's code **built into their app from the template**
(`apps/nuxeo-satori-template`) "until signed, pinned plugins are proven". The migration's M3 builds
plugins that way. The spike for decision 5, [spikes/plugins-decision-5.md](spikes/plugins-decision-5.md)
(25 November 2026), found three things:

- loading a signed, pinned plugin at run time works and costs little;
- it does not make customer code any safer than building it in, since in the host's page a plugin
  reached the stored session, the host's DOM and the user's cookies;
- isolation needs a sandboxed iframe, with limits.

So the spike recommends keeping the template build, and loading only custom elements at run time
if it ever goes ahead, sandboxed when less trusted than the shell.

**This model adds a constraint the spike did not have: the customer ships only packages.** The
template build means the customer builds and hosts their own app from the template, against our
published `@nuxeo/satori-platform`. That needs no source of ours, but it replaces our app's bundle
with theirs, and every upgrade of ours means a rebuild of theirs. The choice is the customer's, and
each option costs something:

| Option                               | What the customer ships                                             | What it costs                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. No user-interface code            | Configuration and their Studio project only                         | What configuration cannot say waits for us to register it                                                                                            |
| B. Their own build from the template | Their own app bundle, built against our published platform library  | They host and rebuild their app on every upgrade of ours; it is no longer our package on their server                                                |
| C. Run-time custom elements, signed  | A custom element in their package, signed, pinned by the deployment | The spike's prerequisites first; the same reach as built-in code unless sandboxed, and a sandboxed frame is a box on the page, not a component in it |

**Proposed:**

- **A for most customers.** Widen what configuration can say, from demand: more registered
  widgets, cards, computations and rules. Each request that needs code is first a question of
  whether a registered piece would serve everyone.
- **B for partners and for customers who choose to run their own build,** with the template and
  the platform library published for them.
- **C only once the spike's section 10 prerequisites hold,** for partner-certified plugins first.

Decision 5 stays open with this constraint added.

## 7. Signing, trust and promotion (decision M)

Today only this repository's `app-packages.yml` signs a package (`business-apps/trusted-signers.json`).
The verifier already takes a deployment's own list, `--trusted-signers`, so the mechanism exists.
What a customer needs:

- **Their own signer,** named in their deployment's trusted-signers list: their CI's identity, or a
  key they hold. Our signer stays trusted for our packages.
- **A starter repository** for their app package:
  - a workflow that checks every change with the pipeline;
  - signing with their identity;
  - promotion through development, test and production servers, with a person's approval before
    production ([package-pipeline.md](package-pipeline.md), section 9, proposes the approval step).
- **Verification before install,** which the [administrator guide](administrator-guide.md) already
  documents for our packages, and the same for theirs.

## 8. Publishing and dependencies (decision N)

- **Publish the add-ons and the kits to the Marketplace,** preprod first, with the dependencies
  their `package.xml` files already declare. A kit then cannot be installed without the add-on
  versions it needs.
- **A release train:** the platform, the add-ons and the kits released together at known compatible
  versions, with a matrix that says which kit versions run on which platform. The release
  candidate ([package-pipeline.md](package-pipeline.md), section 11) is that train's check.
- **Pushing `app-package/*` tags** starts publishing, and when to push the first one is the
  product's call.

## 9. The contract, and upgrades

- **Registered IDs:** what a customer's package may name is what [extension-reference.md](../extension-reference.md)
  registers. Nothing else is promised.
- **`@nuxeo/satori-platform` 1.0,** with a deprecation policy: a promised name is removed only
  after a deprecation period and a migration note. It is at 0.2.0 today. A 1.0.0 policy is not
  recorded yet.
- **The upgrade check,** run on every customer package before every upgrade of ours: its offline
  half and its server half, which is read-only. With patch overlays it also reports conflicts
  (section 4).
- **Diagnostics:** the diagnostics page shows support what is installed and in force.

## 10. For some customers only

- **Tenancy** (decision G), for providers serving many client organisations on one system.
- **Partner certification:** a partner's industry package passes the pipeline and a security
  review, and is then listed on the Marketplace beside our kits.

## 11. The proposed order

1. **Decide L,** then build patch overlays: the merge on the server, the validator and pipeline
   checks, the upgrade check's conflict report, and the designer writing patches. This changes how
   every customer extends a kit, so it comes first.
2. **Decide K and N,** then publish the Builder kit, the add-ons and the kits.
3. **Decide M,** then build the starter repository and customer signing.
4. **Take decision 5 again** with section 6's constraint. Its spike already ran on 25 November
   2026, so this is a decision, not more research.
5. **Declare `@nuxeo/satori-platform` 1.0** and its deprecation policy.

## 12. What this rests on

Checked in this repository on 27 November 2026:

- the whole-file replacement, in [extension-reference.md](../extension-reference.md);
- the kits' declared dependencies, in each `package/package.xml`;
- the add-ons' zips not uploaded, in `.github/workflows/build-marketplace.yml`;
- the platform package's preprod runs, in that workflow's history;
- the single trusted signer, in `business-apps/trusted-signers.json`;
- the private tool packages, in their `package.json`;
- no `app-package/*` tag on the repository.

**Not checked:**

- whether `@nuxeo/satori-platform` is published at `packages.nuxeo.com` today;
- how other Nuxeo products extend their own user interfaces;
- what customers and partners need first, which presales would know.
