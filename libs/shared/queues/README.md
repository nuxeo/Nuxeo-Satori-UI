# Queues

The queue engine: an app's `queues/<id>.json` drawn as a list of records, with facets from the page
provider's aggregates, row and bulk actions, and a rule for who sees it. Phase 1 of the business
apps [development plan](../../../docs/business-apps/development-plan.md) asks for "lists and queues
over page providers, with typed columns, facets, sorts and row actions"; its demo's second step is
"Open a queue". [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section 4,
defines the file, and `libs/shared/app-definition` validates it.

It is an engine (tier 3 of [architecture.md](../../../docs/business-apps/architecture.md)): tagged
`scope:shared` and `scope:engine`. It imports shared code and two other engines: the record page's
list (`libs/shared/document-layouts`) and the home's rule check (`libs/shared/home`).

## What is in it

| File                                      | What it does                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `queue-page/queue-page.ts`                | `QueuePageComponent`, the page the app serves at `/queues/<id>`                                           |
| `queue-file.ts`                           | `readQueue`: the file checked with `validateQueue`, refused, or with columns, facets and actions left out |
| `facets.ts`                               | `facetBuckets`: a facet's buckets and counts, from a page provider's results                              |
| `queue.service.ts`                        | `QueueService`: the file's read; `queueFileUrl`; `queueLink`, `/queues/<id>`                              |
| `samples/documents/queues/documents.json` | A queue on the platform's own `default_search` page provider, for the development server                  |

## What the page does

- **Reads `queues/<id>.json` through `APP_DEFINITION_FILES`** (`libs/shared/app-registry`): at
  `agentic-ui-config/queues/<id>.json`, beside the layouts and the home, past the interceptors,
  where the development server serves it, and otherwise from the app registry, for the app open.
  Where neither serves it, the page says no queue of that name is configured (app-definition-v2.md,
  section 4, "Where the app reads it"). An id that is not one of layout version 2's is not asked for.
- **Checks it** with the validator and what this build registers:
  - a `structure` finding draws no queue, and the console names it;
  - an `unknown` or `parameter` finding leaves out the column, facet, row action or bulk action it
    is in, and a key of the file's own is ignored;
  - a column is read as a related-records card's is (`readRecordList`): a computed column, a table
    and a repeated property are left out, and a queue with no column left could not be read;
  - a facet whose aggregate cannot be sent back as a filter (`isAggregateParameter`) is left out;
  - a rule this build cannot answer hides the queue from everyone: one it does not register, one
    nested deeper than the rule registry answers, or a finding in `visibleWhen`.
- **Evaluates the rule** with `ExtensionRuleRegistry`, as the person signed in, with their groups
  and no record, and shows nothing, asking the page provider for nothing, while it does not pass.
  Each column's rule is answered the same way, as the record page answers a related list's, and a
  queue none of whose columns is for the person is hidden from them too. An empty parameter refuses
  the queue.
- **Draws the list** with `RecordListComponent`, the record page's: the page provider's records,
  page by page, sorted on the server from a header, a row opening its record, and the row actions
  that have a handler on the page. The platform's own row actions are registered by the browse
  list, so a queue has none of them yet, and the console says so.
- **Draws a facet** for each of the queue's aggregates that the results have, with each bucket's
  count. Choosing a bucket sends it back as the search page sends its filters,
  `<aggregate>=["key", …]`, and the list starts again on its first page with the order it had. It
  clears the selection too.
- **Offers bulk actions** in the app's selection bar: those of the queue's that the `bulk-actions`
  slot resolves and that have a handler, through `SelectionService.offeredBulkActions`, which it
  puts back to `null` when it goes. Rows are selectable only when one is offered, for one row or
  for several: the bar then offers those whose rules pass for the rows actually selected.
- **Runs a bulk action over every result of the query**, for the queue's bulk actions that the
  platform maps to an action of Nuxeo's Bulk Action Framework (`wholeQueryBulkAction`, in
  `@nuxeo/satori-platform/extensions`): only `app.bulkActions.delete`, as `trash`, so far. With rows
  selected it offers to select all the results, with their number; then it confirms, naming the
  number, runs the action through `BulkCommandService.runOverPageProvider`, shows its progress from
  the command's status, offers to stop it, says how it ended, and reads the list again through
  `DocumentChangesService`. `whole-query-run.ts` follows the command. Not while a bucket is chosen,
  which the server would leave out; not without a count; and the command is limited on the server
  to one record more than the person agreed to, and stopped and reported when it reaches it
  (app-definition-v2.md, section 4). An action is offered over the whole query only while its
  handler declares the mapping (`ExtensionActionRegistry.runsOverWholeQuery`), so a customer's
  replacement for Delete's handler takes Delete off the whole query.

**In the layout designer's preview** (`libs/features/layout-designer`), the page is given the file it
draws, `content`, instead of reading `queues/<id>.json`, and drawn `readOnly`: it asks the page
provider for its records and a facet still filters them, but no row can be selected, no row action,
bulk action or action over the whole query is offered, and the console is not told what the file
leaves out, which the designer lists itself with `readQueue`. Its title is then a heading under the
designer's, not the page's own `h1`.

Nothing here is a security control. The page provider returns only what the person may read,
hiding a queue hides the page and not the address, and offering fewer actions decides nothing
Nuxeo's permissions do not.

## Running it

```bash
npm run config:dev -- --home libs/shared/home/samples/documents/home.json --queue libs/shared/queues/samples/documents/queues/documents.json
npx nx serve nuxeo-ui
```

Then open `/queues/documents`, or `/home` and its "Open the queue" link. The sample is for
`members` and `administrators`. A package's queues are served the same way, with one `--queue` for
each file in its `queues/`.

## Tests

```bash
npx nx run-many -t lint,test -p shared-queues
npx ngc -p libs/shared/queues/tsconfig.lib.json
```

- The proposal's `queues/unassigned-claims.json` and the sample are read: the proposal's leaves out
  the package's own actions only, and the sample is read whole.
- The page is drawn against a stand-in server: the request, the cells, the facets and their counts,
  a bucket chosen and cleared, the selection and the bulk actions it offers, and another queue
  opened after one with buckets chosen.
- Negative controls: each structural refusal; a column, facet, row action and bulk action left out;
  a reserved or dotted aggregate; a repeated facet; an unregistered rule, a rule this build was made
  without, and one nested past the registry's depth; a person outside the queue's group; a bulk
  action with no handler; no file, and a file that cannot be read.
- The designer's preview (`queue-page.preview.spec.ts`): the file given is drawn and none read, the
  console is not told what it leaves out, and read-only offers no row action, no selectable row, no
  bulk action and no action over the whole query, each against a control drawn as the app draws it.
- Over the whole query, against a stand-in server: the offer and its total, the confirmation and its
  cancel, the request (the queue's parameters, no bucket, the platform's action and parameters),
  progress, the end and the list read again, a stop, more records than agreed, a refusal, and no
  offer while a bucket is chosen, without a count, for a queue with no mapped action, or for a
  descriptor that runs another action's handler. Each was seen failing with its guard removed.

## Not done yet

- **More actions over a whole query.** Only Delete maps to one, and a stock Nuxeo opens its `trash`
  to administrators only over HTTP. A customer's own bulk action cannot be mapped yet, and a
  package's own waits for decision 3.
- **Following a command after the page goes.** Leaving the page stops following it; it goes on on
  the server, and nothing tells the person how it ended.
- **The package's own actions**, from `actions.json`: phase 2 runs them, so a queue leaves them out.
- **A bucket's label.** A bucket shows its key, as the server returns it.
- **The facets in the address.** A choice is the page's state: a reload, or going back to the
  queue from a record, starts with none.
