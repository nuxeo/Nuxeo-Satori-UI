# The extension model: how customers extend Nuxeo Satori without our source

**Status: a proposal for review, written on 27 November 2026 and revised the same day with the
plan of record for decision K.** Nothing here is decided except what [decisions.md](decisions.md)
lists as settled: the kits in this repository are test fixtures and examples, not customer
deliverables. It needs these decisions:

- **K**, how the tools reach customers;
- **L**, **M** and **N**;
- **5**, customer code.

All are in [decisions.md](decisions.md). Until they are taken, the plan's work goes on as it is.

## The short version

- **The rule.** A customer receives only signed, versioned Marketplace packages and published
  tools from us, never our source. Everything a customer builds is **a package of their own that
  depends on ours**, layered on top of what we ship, and never an edit of it. This is already the
  direction [`CUSTOMISING.md`](../../CUSTOMISING.md) sets: "ship your own Nuxeo Marketplace package
  that depends on ours … an upgrade of ours never touches them".
- **What we ship:** the platform, the domain add-ons and the tools. The kits in
  `business-apps/packages/`, Payers among them, test the platform and show what it does. They are
  not shipped to customers.
- **Where a customer works: one config repository of their own,** which they create by following
  our documentation, with `satori create` to scaffold it. It holds all of their configuration in
  one place: branding, what the app shows, and their app definitions. Nuxeo-Satori-Config stays
  ours, for presales and the hosted Beta, and customers never see it.
- **Their tools come from npm:** a command-line tool and an MCP server, pinned in their lockfile,
  with the agent's skill and rules installed by the tool. **Their own AI IDE and agents** build the
  configuration with them, as most customers already do. Upgrades arrive as a version bump.
- **What a customer builds, in order of preference:**
  1. configuration;
  2. server logic in their own Studio project;
  3. user-interface code, only where configuration can't reach.
- **The proposed order:**
  1. one builder for every file a customer writes, version 2's included, in the command-line tool;
  2. the tools on npm, `satori create` and its documentation (K);
  3. customers' own signing and promotion (M);
  4. publishing the add-ons (N);
  5. patch overlays (L);
  6. decision 5 again, now that a customer ships only packages;
  7. the platform's 1.0 contract.

## 1. The rule

A customer never receives the platform's source. This repository is public, but it is not a
customer deliverable: [`CUSTOMISING.md`](../../CUSTOMISING.md) says the rest of it "is a development
workspace for people working on Satori itself". What a customer receives:

- signed Marketplace packages, which an administrator installs on the customer's Nuxeo;
- published tools, which a developer or presales engineer runs on their own computer, with no
  clone of this repository. Until Satori is public, which is Hyland's long-term plan, a tool that
  needs one of Hyland's private packages comes with a read token from us;
- the documentation that goes with both.

Everything a customer changes, they change by shipping a package of their own. That package
declares which of ours it depends on, and at which versions. It is checked by the same validator as
ours, and is installed and upgraded on its own schedule. An upgrade of ours never edits it.

## 2. What we ship

| What                  | Contents                                                                                                                                                                   | Depends on     | State on 27 November 2026                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The platform       | `nuxeo-agentic-ui-package`: the app and `nuxeo-agentic-core`                                                                                                               | Nuxeo LTS 2025 | Published to the Marketplace's preprod on demand by `build-marketplace.yml`, which ran it on 3, 12 and 18 November                                                                                                                     |
| 2. The domain add-ons | One Marketplace package per domain module (decision B): `nuxeo-agentic-assets`, `-records`, `-documents`, `-connectors`, `-signature`, `-embedded`, `-capture`, `-letters` | The platform   | Built and tested on every pull request by `build-marketplace.yml`, whose steps say each zip "is not uploaded or published". **None is published**                                                                                      |
| 3. The tools          | A command-line tool, an MCP server, the app builder skill and reusable CI workflows (section 5), and the designer inside the app                                           | —              | The designer ships in the app. **The rest runs only from a clone** of this repository: `@nuxeo-satori/builder-mcp` and `@nuxeo-satori/generators` are private, and `CUSTOMISING.md` calls the clone "a rough edge we intend to remove" |

**Not shipped: the kits.** The packages in `business-apps/packages/` are Payers, property and
casualty claims, onboarding and disputes, vehicle deals and titles, moves, media, records,
controlled documents, contracts and brand assets. They are **test fixtures and examples**:

- CI builds every one, and each holds the platform to a real use, with its steps files and seed;
- presales demos them on demo servers;
- a customer's agent may read them as worked examples of what the platform does.

A customer builds their own app on their own model, and does not install ours. Each kit's
`package.xml` already declares its dependencies, such as `records-demo` on
`nuxeo-agentic-ui:2026.0.2` and `nuxeo-agentic-records:0.3.0`. That is the shape a customer's own
package follows.

## 3. What a customer builds

Three kinds of change, in order of preference. Each step down costs more to build, review, secure
and upgrade.

1. **Configuration, with no code.**
   - **Branding,** in Layer 0's `bootstrap.json`.
   - **What the app shows,** in Layer 1's `manifest.json`: hide, reorder, relabel and gate.
   - **Their app definitions,** in version 2's files: record pages, queues, home cards, the menu,
     task forms, actions and labels.

   All of it sits in one package in their config repository (section 5). It is written by their AI
   IDE's agent with our MCP server and skill, by hand, or in the designer.

2. **Server logic they already own.** Their Studio project holds their document types, schemas,
   vocabularies, workflows and Automation chains, as it does for Web UI today. The app reads their
   model from the server. A button calls one of their chains only through the deployment's
   operation allow-list (decision 3). Most of a business's own rules already live here in Nuxeo,
   and they stay there.
3. **User-interface code, only where configuration cannot reach.** Section 6 says what this needs,
   since today a customer's code can only be built into the app from the template.

**How it composes, by kind of business.** Each is the customer's config package, our add-ons and
their Studio project. Our example kit shows the agent what such an app looks like.

| Business                | Our add-ons                                     | Their Studio project                                      | Their config package                                                               | Example kit to learn from     |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| Property and casualty   | Connectors, capture, letters                    | Claim and policy types, the claim workflow                | Claim pages, queues, a connector to their policy system, their letter templates    | P&C claims                    |
| Banking                 | E-signature, records, connectors                | Case types, the KYC workflow                              | The onboarding case page with its checklist, their e-signature provider's settings | Onboarding and disputes       |
| Health payers           | Letters, connectors                             | Member, claim and case types; review and appeal workflows | Claim and member pages, work queues, determination and appeal letters              | Payers                        |
| Brand assets and media  | Assets: rights, windows, watermarks, deliveries | Asset and film types                                      | Asset pages, rights policies, territories, distributors, reviewer groups           | Brand assets, media           |
| Engineering and records | Documents, records                              | Controlled document and record types                      | Document pages, numbering series, export-control marks, retention rules            | Controlled documents, records |

## 4. How the layers combine

[architecture.md](architecture.md), section 10, sets the order: "starter kit, then customer, then
tenant, then environment, merged on the server in that order". With our kits not shipped, the
bottom layer is any package below the customer's own: a partner's industry package, a business
unit's shared package, or a kit we decide to ship later. The designer's deployment layer sits above
them all, and holds an administrator's changes made in the browser.

**What is built is replacement, not merging.**
[extension-reference.md](../extension-reference.md) says it plainly: "a later package's file for
the same type and mode replaces yours whole". An app with the same id replaces it whole too, and
the deployment layer's live file wins over the package's file at the same path. Labels are the
exception: they are looked up by key, and a customer's manifest labels win.

So any layer that wants one more field on a page below it must copy that page whole:

- a business unit over the company's shared package;
- a customer over a partner's package;
- an administrator in the designer over the customer's package.

From then on, every change made below passes the copy by. The upgrade check
([package-pipeline.md](package-pipeline.md), section 10) refuses what a package _removes_, but it
cannot tell a layer what it _missed_.

### Patch overlays (decision L)

A layer changes the file below it by naming what it changes, not by replacing it. A sketch, not a
format:

```json
{
  "format": "nuxeo-agentic-ui-overlay/1",
  "target": {
    "package": "acme-claims",
    "range": "^1.4.0",
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
  card its id. An element with no stable name cannot be patched until it has one.
- **Where it is merged:** on the server, in the section's order, before the registry serves the
  result. Every layer's patches apply to the layer below.
- **Checks:** the validator checks the merged result as it checks a file today, and the pipeline
  checks a patch against the package version it names.
- **On upgrade:** when a new version of the package below arrives, the upgrade check re-applies the
  patches to it. It reports any operation whose anchor is gone or moved, as a conflict for a person
  to settle, and never drops one silently.
- **The designer:** for a file a package owns, it writes a patch into the deployment layer, not a
  whole copy.
- **Replacing still exists,** for a layer that means to own a file outright, and the upgrade check
  names every replaced file on each upgrade.

**L matters less while a customer has only their own package and the designer above it.** It
becomes structural the day a partner's package, a shared business-unit package, or a kit of ours
sits below a customer's. That is why the proposed order puts it after the tools.

**Open within L:**

- which files take patches, at first: layouts, queues, home, navigation, actions, task forms;
- the operations' closed list;
- whether a field needs an id of its own when one property is shown twice;
- how a conflict is shown to an administrator;
- the format's version and compatibility rules, since it becomes a long-term contract.

## 5. The customer's config repository, and the tools on npm (decision K)

### One config repository per customer

A customer creates their own repository by following our documentation, and `satori create`
writes its skeleton: the tree below, with a first package, `AGENTS.md`, the skill and the
workflows. [Nuxeo-Satori-Config](https://github.com/nuxeo/Nuxeo-Satori-Config) stays ours, for
presales and the hosted Beta; customers never see it, and it is not the starter. Its packages
move onto the same tools, so we use what customers use.

```text
acme-satori/
  package.json            devDependencies: @nuxeo/satori-cli, @nuxeo/satori-mcp (pinned in the lockfile)
  AGENTS.md               written by the command-line tool: the rules any AI IDE reads
  .cursor/  .claude/      the app builder skill, installed and refreshed by the tool
  .mcp.json               the MCP server, run with npx; the server's address and credentials from the environment
  config-packages/
    acme-config/          one Marketplace package holding all of the customer's configuration
      bundle/agentic-ui-config/
        bootstrap.json    branding (Layer 0)
        manifest.json     what the app shows (Layer 1)
        app.json, home.json, navigation.json, layouts/, queues/, actions.json, tasks/, labels/
  .github/workflows/      validate, build, sign, publish to preprod, promote: calling our reusable workflows
```

**One package holds all of it,** because a customer doesn't think in our layers. Branding, the
manifest and their app definitions are their configuration, reviewed and released together.

### The tools on npm

**Today Nuxeo-Satori-Config copies three files.** `build.mjs` and the two schemas are copied from
this repository into every package, pinned to one commit in `platform-ref.txt`, and checked by a
weekly job that goes red when they drift. That works for one repository we own. Across hundreds of
customer repositories the copies would drift.

**Proposed: publish the tools**, at `packages.nuxeo.com/repository/npm-public/`, where
`@nuxeo/satori-platform` is already set to publish. That registry needs no token, though a tool
that depends on one of Hyland's private packages needs the read token we give a customer until
Satori is public.

| Package               | What it does                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nuxeo/satori-cli`   | `create`, `validate`, `build`, `preview` against the customer's dev server, `upgrade-check` before each of our upgrades, `sign`, and `agents sync`, which installs or refreshes the app builder skill and `AGENTS.md` for Cursor, Claude Code, Copilot and other AI IDEs. It carries the JSON schemas and the same validator our pipeline runs |
| `@nuxeo/satori-mcp`   | The MCP server: read the customer's model, page providers, workflows, vocabularies and operations from their development server; write a file only when the package then validates; preview                                                                                                                                                    |
| Reusable CI workflows | The customer's workflows call ours, so a fix to a check reaches every customer when they bump the version                                                                                                                                                                                                                                      |

**How a customer's agent builds something:**

1. A developer asks their AI IDE's agent for, say, "a claims queue with an Approve button".
2. The agent reads the skill and `AGENTS.md`, and uses the MCP server to read their server's model.
3. It writes the files, and each write is kept only if it validates.
4. The developer previews the result on their development server.
5. CI checks, signs and publishes it.

Nothing needs our source.

**How upgrades reach customers:** we release a platform version with tool versions to match.
Renovate or Dependabot opens a pull request in the customer's repository, and their CI runs
`upgrade-check` against the new version.

### What has to be true

- **Hyland's private packages:** a tool that needs one comes with a read token from us, until
  Satori is public, which is Hyland's long-term plan. The validator and the pipeline likely need
  none.
- **Preview runs against the customer's development server,** with Satori installed on it, not a
  bundled copy of the app.
- **One builder checks every file a customer writes.** Today there are two:
  - the configuration package's `build.mjs`, which checks Layer 0, Layer 1 and version 1 layouts,
    and none of version 2's files;
  - the app package pipeline, `scripts/app-package.mjs`, which checks version 2's files and runs
    only from this repository.

  The command-line tool is the two made one.

- **The MCP server reads the customer's server with their own credentials,** from the environment,
  never from a file in the repository, as it does today.

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
- **The workflows `satori create` writes** (section 5):
  - checking every change with the pipeline;
  - signing with their identity;
  - promotion through development, test and production servers, with a person's approval before
    production ([package-pipeline.md](package-pipeline.md), section 9, proposes the approval step).
- **Verification before install,** which the [administrator guide](administrator-guide.md) already
  documents for our packages, and the same for theirs.

## 8. Publishing and dependencies (decision N)

- **Publish the add-ons to the Marketplace,** preprod first, beside the platform, which is already
  published there. A customer's package declares the add-ons it needs, so it cannot be installed
  without the versions it needs.
- **A release train:** the platform, the add-ons and the tools released together at known
  compatible versions, with a matrix that says which add-on versions run on which platform. The
  release candidate ([package-pipeline.md](package-pipeline.md), section 11) is that train's check,
  and it keeps building every kit as the train's tests.
- **The kits stay unpublished as products.** If presales needs one on a demo server, it is
  installed there from a build, or published to preprod under an `app-package/*` tag. When to push
  the first such tag is the product's call.

## 9. The contract, and upgrades

- **Registered IDs:** what a customer's package may name is what
  [extension-reference.md](../extension-reference.md) registers. Nothing else is promised.
- **`@nuxeo/satori-platform` 1.0,** with a deprecation policy: a promised name is removed only
  after a deprecation period and a migration note. It is at 0.2.0 today. A 1.0.0 policy is not
  recorded yet.
- **The upgrade check,** run in the customer's CI on every version bump of ours: its offline half,
  and its server half, which is read-only. With patch overlays it also reports conflicts
  (section 4).
- **Diagnostics:** the diagnostics page shows support what is installed and in force.

## 10. For some customers only

- **Tenancy** (decision G), for providers serving many client organisations on one system.
- **Partner certification:** a partner's industry package passes the pipeline and a security
  review, and is then listed on the Marketplace. Patch overlays (L) are what let a customer build on
  it.

## 11. The proposed order

1. **One builder,** the configuration package's checks and the app package pipeline made one
   command-line tool that runs outside this repository, so that one config repository holds all
   of a customer's configuration.
2. **Decide K,** then publish `@nuxeo/satori-cli`, `@nuxeo/satori-mcp` and the reusable workflows,
   with `satori create` and the documentation for a customer's own repository. This is what lets a
   customer's AI IDE build their configuration at all.
3. **Decide M,** then customer signing and promotion in the workflows `satori create` writes.
4. **Decide N,** then publish the add-ons beside the platform.
5. **Decide L,** then build patch overlays, before the first partner package or shared package sits
   below a customer's.
6. **Take decision 5 again** with section 6's constraint. Its spike already ran on 25 November
   2026, so this is a decision, not more research.
7. **Declare `@nuxeo/satori-platform` 1.0** and its deprecation policy.

## 12. What this rests on

Checked on 27 November 2026, in this repository unless named:

- the whole-file replacement, in [extension-reference.md](../extension-reference.md);
- the kits' declared dependencies, in each `package/package.xml`;
- the add-ons' zips not uploaded, in `.github/workflows/build-marketplace.yml`;
- the platform package's preprod runs, in that workflow's history;
- the single trusted signer, in `business-apps/trusted-signers.json`;
- the private tool packages, in their `package.json`;
- no `app-package/*` tag on the repository;
- **in nuxeo/Nuxeo-Satori-Config:** public, not a template repository, holding `presales-demo` and
  `satori-beta`. Its packages copy `build.mjs` and two schemas, pinned by `platform-ref.txt`, with a
  weekly drift job, and publish through its own "Publish Configuration Package" workflow.

**Not checked:**

- whether `@nuxeo/satori-platform` is published at `packages.nuxeo.com` today;
- whether the validator and the pipeline need any of Hyland's private packages;
- how other Nuxeo products extend their own user interfaces;
- what customers and partners need first, which presales would know.
