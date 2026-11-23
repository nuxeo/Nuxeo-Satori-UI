# Home

The home engine: an app's `home.json` drawn as cards of KPIs and links to queues, each shown or
hidden by a rule. Phase 1 of the business apps
[development plan](../../../docs/business-apps/development-plan.md) asks for "a home per group, with
cards that carry rules"; [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md),
section 10, defines the file, and `libs/shared/app-definition` validates it.

It is an engine (tier 3 of [architecture.md](../../../docs/business-apps/architecture.md)): tagged
`scope:shared` and `scope:engine`, and it imports only shared code.

## What is in it

| File                          | What it does                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `home-page/home-page.ts`      | `HomePageComponent`, the page the app serves at `/home`                                        |
| `home-file.ts`                | `readHome`: the file checked with `validateHome`, refused or with cards left out               |
| `figures.ts`                  | `figureOf`: what a KPI shows, from a page provider's results                                   |
| `home.service.ts`             | `HomeService`: the file's read and the page providers' reads; `HOME_QUEUE_LINK`; `homeFileUrl` |
| `samples/documents/home.json` | A home on the platform's own `default_search` page provider, for the development server        |

## What the page does

- **Reads `agentic-ui-config/home.json`,** beside the layouts, past the interceptors, as the layouts
  are read. Nothing is served there on a server today, so the page says that no home is configured
  (app-definition-v2.md, section 10, "Where the app reads it").
- **Checks it** with the validator and the rules this build registers:
  - a `structure` finding draws no home, and the console names it;
  - an `unknown` or `parameter` finding leaves out its card, and a key of the file's own is ignored;
  - a card whose rule this build does not register, or nests deeper than the rule registry answers
    (`MAX_RULE_LEVELS`, 32), is left out: the registry would answer `true` for it. Nested rules are
    a core composite's parameters and any `{ "type" }` among another rule's;
  - a home whose every card is left out is a home that could not be read.
- **Evaluates each card's rule** with `ExtensionRuleRegistry`, in the signed-in person's context:
  their user name and groups, and no record. A home per group is cards whose rule is
  `app.rules.inGroup`.
- **Counts** with `GET /nuxeo/api/v1/search/pp/<pageProvider>/execute`, a page of one record, as the
  signed-in person. One request for each page provider and parameters that a shown card reads; a
  hidden card asks for nothing. A terms aggregate returns only its `size` largest buckets: a KPI on
  a bucket missing from a full list is unavailable, not 0, and a full list says it is the largest
  only.
- **Leaves queue links out** until the app gives `HOME_QUEUE_LINK`, which it does not yet: phase 1's
  queue page is not built.

Nothing here is a security control. A figure counts what the page provider returns to the person,
and hiding a card hides the figure, not the records.

## Running it

```bash
npm run config:dev -- --home libs/shared/home/samples/documents/home.json
npx nx serve nuxeo-ui
```

Then open `/home`. The sample's cards for `members` and `administrators` show to a person in those
groups. A package's own home is served the same way: `--home <package>/home.json`.

## Tests

```bash
npx nx run-many -t lint,test -p shared-home
npx ngc -p libs/shared/home/tsconfig.lib.json
```

- The proposal's `home.json` and the sample are read whole, with no problem.
- The page is drawn for an adjuster, a supervisor, someone in neither group and someone in both,
  against a stand-in server: which cards show, which requests are made, and the figures.
- Negative controls: a refused file, a card a finding leaves out, every card left out, an
  unregistered rule, in a core composite or a customer's, a rule nested past the registry's depth
  (held to `ExtensionRuleRegistry` both ways), a page provider that fails, one with no aggregates,
  a bucket the server does not return, from a full list of a terms aggregate or a short one.

## Not done yet

- **Serving `home.json` on a server.** The app registry serves it, once decisions B and E are taken.
- **Links to queues**, which wait for phase 1's queue page.
- **The home as the app's first page.** `/` still opens the dashboard.
- **A bucket's label.** A bucket shows its key, as the server returns it.
- **The menu.** `navigation.json` is proposed and validated, and not drawn.
- **Sums**, which the plan's KPI tiles ask for: a KPI counts only.
