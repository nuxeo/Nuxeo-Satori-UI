# Home

The home engine: an app's `home.json` drawn as cards of KPIs and links to queues, each shown or
hidden by a rule. Phase 1 of the business apps
[development plan](../../../docs/business-apps/development-plan.md) asks for "a home per group, with
cards that carry rules"; [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md),
section 10, defines the file, and `libs/shared/app-definition` validates it.

It is an engine (tier 3 of [architecture.md](../../../docs/business-apps/architecture.md)): tagged
`scope:shared` and `scope:engine`, and it imports only shared code.

## What is in it

| File                                | What it does                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `home-page/home-page.ts`            | `HomePageComponent`, the page the app serves at `/home`                                                                                         |
| `home-file.ts`                      | `readHome`: the file checked with `validateHome`, refused or with cards left out                                                                |
| `figures.ts`                        | `figureOf`: what a KPI shows, from a page provider's results                                                                                    |
| `lists.ts`                          | `taskItem`, `recordItem`: what a list shows of each task or record                                                                              |
| `home.service.ts`                   | `HomeService`: the file's read, the page providers' and the lists' reads; `HOME_QUEUE_LINK`; `HOME_TASKS_LINK`; `homeFileUrl`                   |
| `navigation-file.ts`                | `readNavigation`: the menu, `navigation.json`, checked with `validateNavigation`                                                                |
| `samples/documents/home.json`       | A home on the platform's own `default_search` page provider, with a list of tasks and one of recent notes and files, for the development server |
| `samples/documents/navigation.json` | A menu with the home, the sample queue and a platform page, for the development server                                                          |

## What the page does

- **Reads `home.json` through `APP_DEFINITION_FILES`** (`libs/shared/app-registry`): at
  `agentic-ui-config/home.json`, beside the layouts, past the interceptors, where the development
  server serves it, and otherwise, where the app provides the registry, from the app registry, for
  the app open. Where neither serves one, the page says that no home is configured
  (app-definition-v2.md, section 10, "Where the app reads it").
- **Checks it** with the validator and the rules this build registers:
  - a `structure` finding draws no home, and the console names it;
  - an `unknown` or `parameter` finding leaves out its card, and a key of the file's own is ignored;
  - a card whose rule this build does not register, or nests deeper than the rule registry answers
    (`MAX_RULE_LEVELS`, 32), is left out: the registry would answer `true` for it. Nested rules are
    a core composite's parameters and any `{ "type" }` among another rule's, at any depth;
  - a home whose every card is left out is a home that could not be read.
- **Evaluates each card's rule** with `ExtensionRuleRegistry`, in the signed-in person's context:
  their user name and groups, and no record. A home per group is cards whose rule is
  `app.rules.inGroup`.
- **Counts** with `GET /nuxeo/api/v1/search/pp/<pageProvider>/execute`, a page of one record, as the
  signed-in person. One request for each page provider and parameters that a shown card reads; a
  hidden card asks for nothing. A terms aggregate returns only its `size` largest buckets: a KPI on
  a bucket missing from a full list is unavailable, not 0, and a full list says it is the largest
  only.
- **Lists the person's tasks and recent records** (a card's `tasks` or `recent`), each once, when
  its card shows, as the signed-in person: `TaskService.getUserTasks`, newest first, of one workflow
  when the card names it, and `DocumentService.getRecentlyViewed`, the records they created or
  edited last, of the card's types when it names some; each as many as the card's `limit`, 5 when it
  says none. Each says when it is empty ("No open tasks", "No recent records", an
  `nxs-empty-state`) and when the server does not answer ("Unavailable", and the console why). A
  task opens on the tasks page, and a record its record page; the list of tasks links to the tasks
  page through `HOME_TASKS_LINK`, which the app gives, `/tasks` and `/tasks/<id>`. Without it, as
  in a host with no tasks page, a list of tasks is left out and asks for nothing. Nuxeo records no
  read of a record, so "recent" is what the person changed, not what they opened.
- **Links to queues** through `HOME_QUEUE_LINK`, which the app gives: `/queues/<id>`, the queue
  engine's page (`libs/shared/queues`). Without it, as in a host that has no queue page, a card that
  is only a link is left out and a KPI draws no link.

Nothing here is a security control. A figure counts what the page provider returns to the person,
and hiding a card hides the figure, not the records.

## The menu

`navigation.json` is read the same way, by `HomeService.loadNavigation`, and checked by
`readNavigation`: a `structure` finding refuses it, a finding in an entry or a rule this build
cannot answer leaves the entry out. The app, not this library, adds the entries to its menu at
startup (`apps/nuxeo-ui/src/app/business-apps.menu.ts`; app-definition-v2.md, section 9).

## Running it

```bash
npm run config:dev -- --home libs/shared/home/samples/documents/home.json \
  --navigation libs/shared/home/samples/documents/navigation.json \
  --queue libs/shared/queues/samples/documents/queues/documents.json
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
- The lists (`home-page.lists.spec.ts`, `lists.spec.ts`): their content and order, the workflow and
  type filters and the limit as the requests carry them, the empty states, a failure, no one signed
  in, a host with no tasks page, a hidden list asking for nothing, and axe at WCAG 2.2 AA in jsdom.
  In real Chrome, at 320 CSS pixels and at 1280, with colour contrast and target size, and nothing
  wider than the window: `apps/nuxeo-ui/src/app/home-lists-phone.spec.ts`.
- Negative controls: a refused file, a card a finding leaves out, every card left out, an
  unregistered rule, in a core composite or a customer's, a rule nested past the registry's depth
  (held to `ExtensionRuleRegistry` both ways), a page provider that fails, one with no aggregates,
  a bucket the server does not return, from a full list of a terms aggregate or a short one.

## Not done yet

- **The home as the app's first page.** `/` still opens the dashboard.
- **A bucket's label.** A bucket shows its key, as the server returns it.
- **Replacing the platform's menu.** `navigation.json`'s entries for queues and the home are joined
  to the platform's (`readNavigation`, read by the app at startup); whether an app's menu replaces
  the platform's is still open.
- **Sums**, which the plan's KPI tiles ask for: a KPI counts only.
