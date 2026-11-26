# The asset library's performance budget

Phase 5 of the [development plan](development-plan.md) is done when, among other things, "a
library of 100,000 synthetic assets stays within the performance budget". No budget existed. This
page proposes one, says why each limit is where it is, and says how
[`scripts/beta-harness/asset-performance/`](../../scripts/beta-harness/asset-performance/check.mjs)
holds the brand assets kit's library and asset page to it, without writing 100,000 documents to any
Nuxeo.

It is a proposal, decided without the team as part of the phase 5 work: change a limit here and
in `budget.json` together, with its reasoning. The offline selftest fails when the two differ.

## The short version

- **Where it is measured:** the application's production build, in Chromium, against a local
  stand-in for the REST calls the library and the asset page make. The stand-in holds 100,000
  synthetic assets and answers after a stated latency, over an emulated office network.
- **What it measures:** the library's first paint and first page of results; paging through 50
  pages and narrowing by facets; the asset page's first picture view; the JavaScript heap after 50
  pages; and the requests each of those makes. Then **the search index's window**: on to page 200,
  the last whole page within OpenSearch's 10,000 results, which the stand-in enforces as Nuxeo
  does, and what the library offers and says there.
- **What it does not measure:** Nuxeo's and OpenSearch's own query time at 100,000 documents. The
  stand-in's latencies are stated assumptions, not measurements of a server. That needs a server
  holding the data ("What this does not measure", below).
- **Where it stands, on 25 November 2026:** within budget on every line, the window's four
  included. Its eight negative controls, between them breaking every line of the budget on
  purpose, each fail it on the lines they should.

```bash
npm run beta:asset-performance                  # build, measure, judge: exit 0, 1 or 2
npm run beta:asset-performance-controls         # each negative control seen failing
npm run beta:asset-performance-selftest         # the offline controls, no browser
```

## The budget

Each limit is for one person at a time, on the office network below, against a server that answers
as the stand-in does. A time is in milliseconds from the moment named, to the moment the page shows
what was asked for, checked on the page itself: the expected first row, or the picture loaded.

<!-- table: measure -->

| Measure                          | Limit   | Why there                                                                                                                                                                                                                                                           |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library.firstContentfulPaintMs` | 1800 ms | Web Vitals' "good" first contentful paint. From navigation to the library's address, the median of three cold loads, each in a new browser context with nothing cached. The shell's icon font, on `fonts.googleapis.com`, is not fetched, so it costs nothing here. |
| `library.firstPageMs`            | 2500 ms | Web Vitals' "good" largest contentful paint: the first page of results is what the person came for. Measured as the 50 rows drawn, the first being the asset the server puts first, rather than the browser's own largest paint, which may pick the facets.         |
| `library.openRequests`           | 20      | The cold load's 14 requests today, with room for six more of the shell's. A request per row, or per page, breaks it at once.                                                                                                                                        |
| `paging.medianMs`                | 500 ms  | The server's share of a page is 260 ms: 220 ms for 50 records and a 40 ms round trip. Web Vitals' "good" interaction to next paint allows the browser 200 ms of its own work. With the transfer, half a second.                                                     |
| `paging.p95Ms`                   | 1000 ms | Within a second a person keeps their train of thought: Nielsen's response-time limits. The 95th of 49 pages.                                                                                                                                                        |
| `paging.requestsPerPage`         | 1       | A page is one read of the page provider. A second request is waste whatever it is: a count, a type, a row.                                                                                                                                                          |
| `facets.maxMs`                   | 1000 ms | A facet chosen or cleared is the same read as a page, filtered on the server. Each of the four within the second.                                                                                                                                                   |
| `facets.requestsPerChoice`       | 1       | As a page: one read, its aggregates included. The facets are never counted on the client.                                                                                                                                                                           |
| `asset.firstViewMs`              | 1000 ms | From the click on a row to the asset's first picture view loaded: within the second. The slowest of five opens, which is the first, since it also loads the asset page's code.                                                                                      |
| `asset.requests`                 | 25      | The first open's 20 requests today ("Requests per action", below), with room for five.                                                                                                                                                                              |
| `heap.after50PagesMB`            | 64 MB   | A ceiling for the whole application after 50 pages, its code and services included: four times today's. It catches a gross change only; the next line catches a leak.                                                                                               |
| `heap.growthMB`                  | 6 MB    | Twice today's 2.9 MB, which is warm-up, not pages held (below). A page of results, kept, costs about 0.2 MB of heap: the `hold-pages` control, keeping all 50, grew 13.3 MB. Six catches a list that keeps fifteen pages or more.                                   |
| `window.requestsPast`            | 0       | A page that ends past the search index's window is HTTP 500 from Nuxeo: the person sees the list fail. None is ever asked for, over the whole run.                                                                                                                  |
| `window.controlsPast`            | 0       | On page 200, the window's last whole page, no control offers a page past it: the pager's next is disabled.                                                                                                                                                          |
| `window.totalsMisstated`         | 0       | Every pager from page 2 to page 200 names the server's whole count, 100,000, not the window's 10,000 nor a guess. The total is what the person reads to decide to narrow.                                                                                           |
| `window.noticeMissing`           | 0       | On page 200 the list says, above its rows, how many results its pages reach and of how many, both numbers, and to narrow with the filters or a search. Without it, paging just stops.                                                                               |

The two heap lines are read after garbage collection, through the DevTools protocol, once after
page 1 and once after page 50. The four `window.` lines count what must not happen at all, so
their limit is 0; `budget.mjs` refuses any other limit for them, and 0 for any other line.

**What the window's lines can and cannot tell apart.** They hold the app, end to end, against a
server that answers as Nuxeo does, and Nuxeo's own `isNextPageAvailable` is already false on page 200. So an app that only follows that flag, as the record list did before the window was read,
would also keep the first three lines at 0: they catch a regression that pages past the window,
misstates the total or offers a way past the edge, and the `unwindowed` and `capped-count` controls
show them going red. Of the four, only `window.noticeMissing` tells the app with the notice from
the one before it, which has none: reasoned from its code, not run. The app's own guard, for a
server that offers a next page at the edge anyway, is held by `record-list.spec.ts`, not by this
check.

**Today's growth is warm-up.** Browsed to page 200 once, by a probe against the same stand-in rather
than by this check, which reads the heap after pages 1 and 50 only: the heap grew 2.6 MB over the
first 25 pages, then about 5 kB a page, 13.2 MB at page 1, 16.1 MB at page 50 and 16.8 MB at page 200. A page of 50 results is about 300 kB of JSON, 6 kB a record with every schema, which the
browser holds in far less once parsed.

## How it is measured

`npm run beta:asset-performance` builds `nuxeo-ui` for production and runs
[`check.mjs`](../../scripts/beta-harness/asset-performance/check.mjs). That serves the build, the
kit's configuration and the stand-in from one port, 4294, and drives Chromium through Playwright,
which is installed with `--no-save` as the
[beta harness](../../scripts/beta-harness/README.md#prerequisites) says. It needs no Nuxeo and no
credentials: the stand-in answers `/me` as a reader of its own, `perf-reader`, a member of
`brand-team`, and the app signs in as it would on a server with single sign-on.

1. **The library, cold, three times.** A new browser context each time, nothing cached, at
   `/#/queues/library`: the first
   contentful paint the browser reports, and the moment the first page's 50 rows are drawn.
2. **Paging.** 49 clicks on the pager's next button, so 50 pages browsed, each timed from the click
   event to the page's first row being the asset the server's order puts there.
3. **The heap,** after page 1 and after page 50.
4. **The search index's window.** 150 more clicks on next, to page 200, results 9,951 to 10,000,
   each page its expected first row, not timed. Every pager from page 2 on is read for its total.
   On page 200: whether next is still enabled, which is then pressed, as a person would, and the
   list's notice, with the numbers it names. Every page the stand-in refused for the window, over
   the whole run, is counted from its log.
5. **Facets.** Rights "Ending" chosen, then Shot "Detail", then each cleared, each timed from the
   click to the first row of the narrowed list.
6. **The asset page.** The first five rows opened in turn, each timed from the click to its first
   picture view loaded from its blob, then back to the library. Loaded, not painted: the image is
   complete and its size known; Chromium decodes it when it paints.

Each action's REST and configuration requests are counted by the stand-in, which sees every one
of them, from the action's start until nothing has been asked for 300 ms (3 seconds for the asset
page, whose history card asks the audit again 2.5 seconds after it is drawn). Static files are
recorded but not counted, so splitting the app's code into more files moves no request line. The
notification bell's checks, on their own timer and known by the queries they send, are recorded but
not charged to the action they fall in; the same operation with another query is not the bell's,
and fails the run as unanswered.

The run fails, whatever its times, if the pages made a request the stand-in has no answer for, if
they asked any host but the stand-in and the icon font's two, if the page threw an error, if an
action's requests were still coming 8 seconds after it, or if a page or a facet did not ask the
page provider exactly once. Its
report goes to `~/Desktop/agentic-ui-evidence/beta/asset-performance/<timestamp>/`, outside the
repository: `REPORT.md`, and `report.json` with every request.

### The network and the machine

- **The network:** a 40 ms round trip and 10 Mbit/s each way, Lighthouse's desktop figures, for a
  person in an office reaching a server elsewhere. The stand-in adds the round trip to every answer,
  static files included; Chromium's own emulation limits the bandwidth. Chromium's emulated latency
  is not used: it is a least time to the response headers, so an answer slower than it got no round
  trip at all.
- **Compression:** text is sent gzipped, as by a server behind a compressing proxy. The synthetic
  records are much alike, so a page of them compresses about 20 to 1, better than real records
  would: a page of results costs the network less here than it will on a server.
- **The machine:** the one it runs on, with no CPU slowdown unless `--cpu <n>` asks for one.
  `--network none` drops the network, to see the app's own share.

### The stand-in's latencies

What each kind of request waits for at the stand-in, its own work included, before the round trip.
They are **assumed, not measured**: they make the browser wait as a server would, and a server
holding 100,000 assets is what would confirm them.

<!-- table: latency -->

| Route          | Latency               | What it stands for                                                                                                                                                                                                                                 |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageProvider` | 120 + 2 per record ms | `acme_asset_library` on the search index: the query and its three aggregates over 100,000 small records, then each record loaded and written with every schema and the `permissions` enricher, which is most of the time. 220 ms for a page of 50. |
| `document`     | 90 ms                 | One record with the document page's nine enrichers: ACLs, permissions, renditions, favourites, subscriptions, collections, preview, thumbnail and transitions.                                                                                     |
| `blob`         | 40 ms                 | One picture view from the binary store.                                                                                                                                                                                                            |
| `audit`        | 80 ms                 | The record's history from the audit.                                                                                                                                                                                                               |
| `annotations`  | 60 ms                 | The review's pins: `Repository.Query` over the record's annotations.                                                                                                                                                                               |
| `directory`    | 30 ms                 | A page of a vocabulary.                                                                                                                                                                                                                            |
| `me`           | 25 ms                 | The signed-in person.                                                                                                                                                                                                                              |
| `user`         | 25 ms                 | A person named in a record's history.                                                                                                                                                                                                              |
| `schema`       | 20 ms                 | A type or a schema, from the server's registries.                                                                                                                                                                                                  |
| `config`       | 10 ms                 | A configuration file, which the configuration servlet answers from memory.                                                                                                                                                                         |
| `other`        | 40 ms                 | The rest: the shell's favourites, the bell's checks, the document page's tasks, workflows and publications.                                                                                                                                        |

### The synthetic library

[`library.mjs`](../../scripts/beta-harness/asset-performance/library.mjs): 100,000 `AcmeAsset`
records, each a function of its number, so every run sees the same library. 400 products, eight
colourways and eight shots, the products skewed so the Product facet's ten largest are a real
choice; rights that ended for 8%, end within 30 days for 4%, have no end for 2%, and are cleared
for the rest. Each record is a Picture with five views and every schema the kit's content model
gives it, about 6 kB of JSON.

It answers as the kit's page provider does: 50 a page, at most 100; ordered by rights end, those
with none last; a bucket chosen sent as a parameter named after its aggregate; each aggregate
counted with the other aggregates' choices and not its own; a terms aggregate's ten largest; and a
chosen bucket that holds nothing listed at 0.

And it keeps to **the search index's window** as the local Nuxeo 2025.10.18 did over OpenSearch's
default `max_result_window` ([api-integrations.md, section 33](../api-integrations.md#33-queues--queuesidjson-and-the-queues-page-provider)):
`resultsCountLimit` 10,000 and the exact count past it; no next page on the last whole page within
it, page 200 at 50 a page; and HTTP 500, with Nuxeo's message, for a page that ends past it, even
where the results run out first. The selftest holds it to the measured answers, page for page.

The asset page's other reads are answered too: the record with its enrichers, its type and schemas
from the kit's `content-model.json`, its picture views as PNGs drawn by the kit's `png.mjs` and
padded to the size the record gives each view, its
history, the review's annotations (none), and the three vocabularies the document page reads, as
large as Nuxeo's stock ones: 251, 58 and 37 entries.

## The negative controls

A check is not evidence until it has been seen to fail. `npm run beta:asset-performance-controls`
runs the check eight more times, each with something made worse on purpose, and passes only when
each run failed on the lines it should, each of them measured. Between them they name every line
of the budget, which the offline selftest holds them to:

| Control        | What it makes worse                                                                                                                                                          | Must be over                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `slow`         | The stand-in's server five times slower; the network as it was                                                                                                               | `library.firstPageMs`, `paging.medianMs`, `paging.p95Ms`, `facets.maxMs`, `asset.firstViewMs`  |
| `big-bundle`   | The app's first script 1.5 MB heavier, in bytes that do not compress                                                                                                         | `library.firstContentfulPaintMs`, `library.firstPageMs`                                        |
| `fetch-all`    | A script in the page reads every page of a query before the app's own request for it is sent                                                                                 | `library.firstPageMs`, `library.openRequests`, `facets.requestsPerChoice`                      |
| `twice`        | A script in the page sends every request to the server a second time, as one subscribed to twice would                                                                       | `library.openRequests`, `paging.requestsPerPage`, `facets.requestsPerChoice`, `asset.requests` |
| `hold-pages`   | A script in the page keeps every page of results the app is sent                                                                                                             | `heap.growthMB`                                                                                |
| `ballast`      | A script in the page holds 80 MB from its first moment                                                                                                                       | `heap.after50PagesMB`                                                                          |
| `unwindowed`   | The stand-in refuses past the window as Nuxeo does, but says nothing of it, as this check's first stand-in did: no `resultsCountLimit`, and a next page while records remain | `window.requestsPast`, `window.controlsPast`, `window.noticeMissing`                           |
| `capped-count` | The stand-in counts only to 10,000, as OpenSearch's own default `track_total_hits` would have the index count                                                                | `window.totalsMisstated`, `window.noticeMissing`                                               |

The scripts run in the page, around the app's own requests; `big-bundle` pads the script as the
stand-in serves it, and `slow`, `unwindowed` and `capped-count` change how the stand-in answers,
rather than the app: no control needs a build of its own, and the app's code is left as it is.
`unwindowed` is the boundary's negative control: an app that cannot read the window from the
server's answer pages past it, and the check goes red on the page asked for and the control left
enabled.

## Measured on 25 November 2026

On an Apple Silicon Mac, Chromium 153 headless, the network above, no CPU slowdown, the build of
the branch that added the search index's window (commit `44bc47790`, no changes on top). Each
line's limit is the budget's, above:

| Measure                                   | Measured |
| ----------------------------------------- | -------- |
| First contentful paint                    | 1308 ms  |
| First page of results                     | 1724 ms  |
| Requests to open the library              | 14       |
| A page, median                            | 294 ms   |
| A page, 95th percentile                   | 297 ms   |
| Requests per page                         | 1        |
| A facet, slowest                          | 299 ms   |
| Requests per facet                        | 1        |
| The asset page's first view, slowest      | 578 ms   |
| Requests to open the asset page           | 20       |
| Heap after 50 pages                       | 16.3 MB  |
| Heap growth over 50 pages                 | 3.0 MB   |
| Requests past the window                  | 0        |
| Controls past the window, enabled         | 0        |
| Pages 2 to 200 misstating the total       | 0 of 199 |
| The window's last page without its notice | 0        |

The slowest first view is the first open, which also loads the asset page's code; the four after
it took 299 to 311 ms. On page 200 the pager read "9951–10000 of 100000", its next button disabled,
and above the rows: "Only the first 10,000 of these 100,000 records can be paged through. Choose
filters, or search, to narrow the list and find the others."

Once more with a fourfold CPU slowdown (`--cpu 4`), on the build before the window (`f0a618af6`):
1528 ms to first paint, 1966 ms to the first page, 307 ms a page at the median, 657 ms to the
slowest first view, and 2.9 MB of heap growth: within budget too, on every line. Not run again.

The eight controls, the same day, against that same build (`--skip-build`), while other work
loaded the machine, so their times are if anything high: each control was over on every line it
names, and failed the run.

| Control        | Over budget on                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `slow`         | first page 2891 ms; a page 1171 ms median, 1179 ms at the 95th; facets 1168 ms; first view 1164 ms                    |
| `big-bundle`   | first paint 2488 ms; first page 2900 ms                                                                               |
| `fetch-all`    | first page 15,159 ms; 1014 requests to open the library; facets 3568 ms and 41 requests; 900 requests past the window |
| `twice`        | 28 requests to open the library; a page 554 ms median and 2 requests; 2 requests a facet; 40 to open the asset page   |
| `hold-pages`   | heap growth 13.4 MB                                                                                                   |
| `ballast`      | heap after 50 pages 92.6 MB                                                                                           |
| `unwindowed`   | 1 request past the window, the next pressed on page 200 and refused; next enabled there; no notice                    |
| `capped-count` | the total misstated on all 199 pages, "of 10000"; no notice                                                           |

Each was within budget on the lines it does not touch, but for the slower pages `twice`'s extra
requests cost, the slower facets of `fetch-all`, and `fetch-all`'s requests past the window: it
reads every page of the library, and 900 of its 1,000 are now refused, as Nuxeo refuses them. That
is also why its first page took 15 seconds rather than the 67 it took before the stand-in kept the
window: the refused pages are answered at once.

### Requests per action

| Action                      | Requests | What they are                                                                                                                                                          |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The library, cold           | 14       | 8 configuration files, 2 to the app registry (none here), `/me`, the shell's favourites, the page provider, and `AcmeAsset`'s type                                     |
| A page of results           | 1        | The page provider                                                                                                                                                      |
| A facet chosen or cleared   | 1        | The page provider                                                                                                                                                      |
| The asset page, first open  | 20       | 9 vocabulary reads, the record, 3 for the document page's panels, the layout index and file, the annotations, the picture view, the history twice, and a person's name |
| The asset page, later opens | 17       | The same, less the layout files and the name, read once                                                                                                                |

**Noticed, within budget:** 9 of the asset page's 17 requests are the document page's three
vocabularies, read again on every open: all 251 coverage entries six pages one after another, 58
subjects in two, and 37 natures. They do not delay the first view, which needs the record, the
layout and the picture view, but they are the first place to look if the request line is tightened.

## What this does not measure

- **Nuxeo's and OpenSearch's own query time at 100,000 documents.** The stand-in's latencies are
  assumptions. The page provider's real time at 100,000, with its three aggregates, the document
  page's enrichers and the audit, need a server holding 100,000 assets, which this check exists to
  avoid writing.
- **The cost of deep pages.** The window itself is enforced and checked, but the stand-in answers
  page 200 as fast as page 1, and an index's `from` and `size` work grows with the offset. A server
  holding 100,000 assets would show what page 200 costs.
- **A window other than the default.** An administrator may raise `index.max_result_window`; the
  app reads the window from each answer, but the check runs at 10,000 only.
- **A server under load:** many people at once, its memory, its threads, its database.
- **A real network:** one machine runs both ends. The round trip and the bandwidth are emulated;
  there is no TLS, HTTP/2, proxy or packet loss.
- **Other browsers, and slower machines** than the one it runs on, except as `--cpu` emulates.
- **The icon font** the shell takes from `fonts.googleapis.com`: no host but the stand-in is
  resolved, so it is not fetched.
- **Real pictures.** The views are flat PNGs drawn by the kit's `png.mjs`, padded to their stated
  size; real views are JPEGs, which cost more to decode.
- **A grid with thumbnails.** The plan's "library as a grid with filters" is, today, the queue's
  table, with no picture in it. A grid of 50 thumbnails would add up to 50 picture reads a page,
  and the request lines would need setting again.
- **The rest of the kit:** the product page, the products queue, video, and a review with pins.
