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

- **Reads `agentic-ui-config/queues/<id>.json`,** beside the layouts and the home, past the
  interceptors. Nothing is served there on a server today, so the page says no queue of that name
  is configured (app-definition-v2.md, section 4, "Where the app reads it"). An id that is not one
  of layout version 2's is not asked for.
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
  puts back to `null` when it goes. Rows are selectable only when one is offered.

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

## Not done yet

- **Bulk actions over a whole query**, every result rather than the rows selected: the Bulk Action
  Framework's, in phase 2.
- **The package's own actions**, from `actions.json`: phase 2 runs them, so a queue leaves them out.
- **Serving the queues on a server.** The app registry serves them, once decisions B and E are
  taken.
- **The menu.** `navigation.json` names queues, and is not drawn: `queueLink` is the address its
  entries are to open.
- **A bucket's label.** A bucket shows its key, as the server returns it.
- **The facets in the address.** A choice is the page's state, and a reload starts with none.
