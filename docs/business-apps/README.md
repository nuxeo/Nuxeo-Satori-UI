# Business apps on Nuxeo

Everything about turning Nuxeo Satori UI into a platform for business applications for every
account: what presales asked for, what is feasible, the architecture, the migration from Studio
Designer, the development plan and its decisions. Start here when you pick this work up again.

## Where things stand, 22 November 2026

- **Analysis, architecture and plan:** done, ready for review.
- **Development:** phase 0 of the [development plan](development-plan.md) started on 22 November
  2026, with only the work no open decision affects.
  - **Done:** migration M0, in [`tools/studio-migration`](../../tools/studio-migration/README.md).
    That is the package reader, the inventory and the catalogue, and the harness skeleton
    running checks 1, 4 and 8 with its negative controls. Step 4 of the phase 0 demo, a broken
    conversion that the harness refuses, runs on the sample.
  - **Next:** the rest of M0 needs at least two more real Studio packages.
  - **Waiting:** the rest of phase 0 waits for its decisions and inputs.
- **Clickable prototype:** published at
  [nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps](https://nuxeo.github.io/Nuxeo-Satori-UI/prototypes/business-apps/).
  Its source is in [`docs/prototype/business-apps/`](../prototype/business-apps/). It has the
  Payers flow, the brand assets flow, and a guide with an "Every account" page.
- **Pull requests:** #607 (the prototype, plan and feasibility report), #608 (the brand assets
  demo, the coverage of every account, and the review fixes) and #610 (Builder links) are merged.
- **Where the work happens:** on the integration branch `integration/enterprise-grade-app`, created
  from `main` on 21 November 2026. Every pull request for this work targets it, `main` is merged
  into it at least daily, and it reaches `main` in one final pull request
  ([AGENTS/06-git-workflow.md](../../AGENTS/06-git-workflow.md)). Since 22 November 2026 it has
  `main`'s protection, the `main_branch` ruleset. Every pull request into it needs an approving
  review. The daily merge of `main` goes in through a pull request merged with a merge commit,
  never squashed, unless an admin pushes it. Run the local gate against it:
  `SANITIZER_AUDIT_BASE_REF=origin/integration/enterprise-grade-app npm run beta:gate -- --base origin/integration/enterprise-grade-app`.
- **Checks:** the repository's own gates (lockfile, guardrails, lint, test, build, typecheck) must
  pass. Until the plan is implemented, SonarCloud, the accessibility checks and the security scans
  run but are not chased; phase 10 brings them back to green. CodeQL still blocks a merge with a
  high-severity finding, through the ruleset ([decision log](decisions.md)).
- **Kept outside this public repository:** the names of the twenty accounts, kept with the team;
  and a narrated demo video of the Payers flow, made locally.

## Read in this order

1. [plan.md](plan.md): what presales said, what the app lacks, and the plan. Sections 13 and 14
   check it against the twenty accounts and cover them in four waves.
2. [feasibility.md](feasibility.md): every capability of the prototype, checked against two
   Nuxeo 2025 servers, and what we need from whom.
3. [architecture.md](architecture.md): the six tiers, the modules, the apps and the backend
   services.
4. [studio-migration.md](studio-migration.md): moving Web UI customisations from Studio Designer,
   with agents and a verification harness, from a real sample package.
5. [development-plan.md](development-plan.md): phases 0 to 10, each with the demo the team will
   see.
6. [end-state.md](end-state.md): what exists at the end of phase 9, and how each kind of company
   and each person in it uses the app.
7. [decisions.md](decisions.md): what is open, who decides, by when, and what is settled.
8. [layout-v2.md](layout-v2.md): layout file version 2, proposed. It is the format record pages
   and forms are configured in, and what the Studio migration writes.
9. [app-definition-v2.md](app-definition-v2.md): the other files of an app definition, proposed:
   `app.json`, queues, actions, task forms, labels, module settings, the menu and the home.
10. [package-pipeline.md](package-pipeline.md): the package pipeline's first stage, which checks,
    signs and publishes an app definition package.
11. [tutorial.md](tutorial.md): build a small app from an empty package in a day, by hand and with
    the agent, and the feedback its first run found. Its test with someone outside the team, and
    the plan's other acceptance tests, are run by [acceptance-tests.md](acceptance-tests.md): who
    takes part, the server, the task, what is measured, how each passes, and what is recorded.
12. [studio-migration-guide.md](studio-migration-guide.md): for a customer, migrating their own
    Studio package, or several, with one command, reading its report and filling in its decisions.
13. [studio-migration-support.md](studio-migration-support.md): the support playbook, for a support
    engineer helping a customer whose migration reports findings: every finding the tool can print,
    who acts on it, when to escalate and with what, reproducing a run safely, and lab mode.
14. [spikes/plugins-decision-5.md](spikes/plugins-decision-5.md): the spike for decision 5,
    customer code built in from the template or loaded at run time, signed and pinned.
15. [performance-budget.md](performance-budget.md): the brand assets library's budget at 100,000
    assets, proposed, and the check that holds it without a server.
16. [administrator-guide.md](administrator-guide.md): for a Nuxeo administrator, what to install
    and in what order, every server setting with its default, upgrading and removing a kit, the
    demo server, the logs, and what is not ready for production.
17. [security-reviews.md](security-reviews.md): every security review the work needs, deferred
    until the app is finished: what each covers, where its notes are, and the decision it rests on.

The server add-ons the domain modules have so far, each its own Marketplace package on decision B's
recommendation, and waiting for its security review ([security-reviews.md](security-reviews.md)):

- [`nuxeo-agentic-assets`](../../nuxeo-agentic-assets/README.md): an asset's rights, refused at the
  platform's download permission (phase 5).
- [`nuxeo-agentic-connectors`](../../nuxeo-agentic-connectors/README.md): a record of another
  system, read for the record page by `Connector.Read`, kept for a time each server sets, and
  dropped when the system's signed change event names it (phase 7).
- [`nuxeo-agentic-documents`](../../nuxeo-agentic-documents/README.md): controlled documents,
  numbered from the platform's sequencer, and a new revision superseding the one before it in the
  same transaction (phase 8), with its kit,
  [controlled documents](../../business-apps/packages/controlled-documents-demo/README.md).
- [`nuxeo-agentic-records`](../../nuxeo-agentic-records/README.md): the disposition review, on the
  platform's retention module: the records due held in a run, approved by two people other than
  its starter, deleted, and a certificate kept; the audit export a records specialist reviews, and
  access logging (phase 9), with its kit,
  [records](../../business-apps/packages/records-demo/README.md).

## Facts that hold

Checked first-hand; build on them rather than re-checking.

- The Nuxeo REST API gives:
  - the content model;
  - page provider definitions, with their aggregates;
  - each workflow step's variables;
  - audit, comments and bulk actions;
  - ranged downloads.
- Nothing in Nuxeo lists a document's allowed lifecycle transitions. `nuxeo-agentic-core`'s
  `allowedTransitions` enricher does, for the document page's Change state action.
- The platform has picture, video and audio types, views, renditions and conversions.
- `Document.AddPermission` grants time-limited access, including to an outside person by email.
- Retention, legal hold and template rendering are add-ons that the checked servers do not have.
- `nuxeo-agentic-core`, in this repository, serves the configuration and handles sign-in for the
  app.
- The configuration is one per server, served before sign-in.
- Layouts are version 1 only.
- Customer code cannot load into the shipped app at run time.
- A Studio package carries the data model and the Web UI files together. The model needs no
  conversion.

## Rules that hold

- The repository is public: no account names and no security findings in it.
- The server is the control. What configuration hides is not secured by hiding it.
- No free code in configuration: registered IDs, registered computations, allow-listed operations.
- Every gate is seen failing on purpose before it is trusted, and every phase gets an
  independent adversarial review.

## The accounts

Twenty accounts in eight use-case groups, plus one whose use case presales has not confirmed. The
counts per group, and the phase that gives each group its first demo, are in the
[development plan](development-plan.md), section 5. The names are not in this repository.

## Working on it

- **The prototype:** `node docs/prototype/business-apps/src/build.cjs`, then open
  `docs/prototype/business-apps/index.html`. The build needs `sass` and the Satori packages in
  `node_modules`.
- **Evidence:** screenshots, recordings and reports go outside the repository, as for the Beta.
