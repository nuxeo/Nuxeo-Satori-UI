# Decision: the table primitive for `nxs-document-list`

**Status:** decided 2026-10-08 · **Ticket:** [NXSAT-308](https://hyland.atlassian.net/browse/NXSAT-308) ·
**Question:** plan section 11, "which table primitive", which gates the largest component

**Decision: Angular Material table (`<table mat-table>` with `MatSort`), paged on the server, not
virtualised.** On Angular 22, add Satori 1.0's `satTableWithRowStates` on top. Do not combine Satori row
states with virtual scrolling until the stale-name defect in section 4.4 is fixed.

The measurements behind it:

- **At page sizes every candidate is fast enough.** With the CPU throttled 4×, the unvirtualised
  candidates render a 50-row page in 44 to 54 ms and a 500-row page in 232 to 307 ms, and both scroll at
  60 fps. Only a 5,000-row list needs
  virtualisation: unvirtualised it takes 2.0 to 2.8 s to render and scrolling stalls.
- **Material table is the only candidate Satori's row-state layer styles.** Its CSS selects only `mat-row`,
  `[mat-row]` and `[matRow]`.
- **Material table is the only candidate with an accessible sort header out of the box.** Today's `/browse`
  has sort headers no keyboard can reach and no `aria-sort`, and axe reported nothing.
- **Virtual scrolling with Satori row states mis-announces rows and drops focus.** On Angular 22, from
  the 17th row on, every row reached by the keyboard announced another document's name, in all 10 runs
  that checked it. In 4 of 11 runs focus fell to `<body>` partway down the list.

The cost is 22.3 kB gzip over today's hand-written table, in an app that already ships `mat-table` in 11
files.

## 1. What the component has to do, and the facts that constrain it

- **Today's `/browse` is a hand-written `<table class="browse-table">`** (`browse.html:301`). It asks for
  one page of 50 (`getBrowseFolderContents(nuxeoPath, 50)`, `browse.ts:681`) and never pages. It sorts and
  filters those 50 rows in the browser (`toggleBrowseSort`, `browse.ts:561`). Its sort headers are
  `<th (click)>`: they cannot be reached by keyboard and carry no `aria-sort`.
- **Server paging and sort exist in the service, but only for ordinary folders.**
  `BrowseService.getBrowseFolderContents(path, pageSize, { currentPageIndex, sort })` takes both, and the
  adf-hx bridge's query port calls it that way. It forwards them only on the ordinary-folder branch
  (`getChildren`). The `Root`/`Domain` branch (`getNavTreeChildren`) and the `Favorites`/`Collection`
  branch (`getCollectionMembers`) take a page size and ignore the page index and sort. It returns
  Nuxeo's `isNextPageAvailable` as `hasNextPage`.
- **Nuxeo constrains paging and sort** (`AGENTS/11-beta-program.md` section 3, verified facts):
  - the total is known only when the result fits on one page, so a numbered pager is impossible and
    `isNextPageAvailable` (the service's `hasNextPage`) is what paging is built on;
  - an unsupported `sortBy` returns HTTP 200 with **zero** entries, so sort keys must be validated before
    the request;
  - "folders first" is not a Nuxeo sort;
  - sorting a page in the browser once hid a dropped server sort for several phases, so the table must
    never sort client-side.
- **Columns come from the 12 `app.documentList.*` descriptors** in the `documentList` slot: `order`,
  `hiddenByDefault`, `disabled`, plus the user's column picker state.
- **What the repo already uses.** `mat-table` appears in 11 files: the three history tables in browse,
  collection detail and document detail, which also use `matSort`, and eight administration pages.
  `@angular/cdk/table` and CDK virtual scroll are used nowhere. `MatTableDataSource` and `SelectionModel`
  are not used either.
- **Satori 1.0's `table-with-row-states`**, read from the `1.0.0-alpha.142` source:
  - it is a directive "applied to a `mat-table` element";
  - its theme styles only `mat-row`, `[mat-row]` and `[matRow]`;
  - it keeps one row in the tab sequence (a roving tabindex) and moves focus with ArrowUp and ArrowDown
    over its rendered `satRowState` rows. ArrowLeft and ArrowRight move between the controls inside a
    row. There is no Home, End or Page key and no Shift range;
  - Space toggles the row's selection control and Enter clicks its primary action;
  - it derives each row's `aria-label` from the primary action's text after render, and announces its
    help text through a hidden element read via `aria-describedby`.
- **CDK table virtual scrolling starts at CDK 21.** `CdkTable` injects `CDK_VIRTUAL_SCROLL_VIEWPORT` in
  21.2.14 and 22.2.2, but not in our 20.2.14. Neither version sets `aria-rowcount` or `aria-rowindex`.

## 2. Candidates

| ID  | Candidate                                                                      | Angular |
| --- | ------------------------------------------------------------------------------ | ------- |
| A   | Hand-written native `<table>`: today's `browse-table` (the baseline)           | 20      |
| B   | CDK table, with hand-written sort buttons and `aria-sort`                      | 20      |
| C   | Material table with `MatSort`                                                  | 20, 22  |
| D   | Native `<table>`, rows windowed by CDK virtual scroll (`*cdkVirtualFor`)       | 20      |
| C+R | C plus Satori `satTableWithRowStates`                                          | 22      |
| E   | C+R inside `cdk-virtual-scroll-viewport`, CDK 22's native table virtualisation | 22      |

On Angular 20, D is the only virtualised table available without a third-party library, because CdkTable
and MatTable cannot be virtualised before CDK 21. C+R and E need Angular 22, which Satori 1.0 requires.

## 3. Method

The spike was throwaway code in a scratch directory outside the repository. It was never committed or
pushed. Two apps were built:

- Angular 20.3 with CDK and Material 20.2.14, using zone.js;
- Angular 22.2 with CDK and Material 22.2.2, `@hylandsoftware/satori-ui@1.0.0-alpha.142` and
  `@ngx-translate/core@18`, zoneless.

Every candidate shared the same parts: deterministic fixture rows, the 12 column descriptors (7 visible
plus a checkbox column), and one selection, sort and column-state class. Only the template and the table
primitive differed. Rows were 48 px high, inside a 600 px scroll container, and every component used
`OnPush`.

- **Timing.** Each update ran synchronous change detection, then forced layout, then waited for the next
  frame. Times are to that frame. Each figure is a median, at 1× and 4× CPU throttle, of:
  - 5 runs for Angular 20 candidates A, B and C (3 at 5,000 rows);
  - 3 runs for candidate D, from its re-measurement after the sticky-header fix (section 4.4);
  - 3 runs at every size on Angular 22.
    The tables below use 4×, as a stand-in for a mid-range laptop; 1× is in the evidence. Angular 20
    (zone.js) and Angular 22 (zoneless) numbers are **not comparable with each other**.
- **Scrolling.** The container was scrolled from top to bottom over 2 s, one step per animation frame, and
  the time between frames recorded.
- **Bundle size.** All JS of a production build that bootstraps one candidate, gzip level 9, compared
  with a baseline candidate.
- **Accessibility.** Each candidate was checked four ways:
  - axe-core 4.13 with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `best-practice` rules;
  - a Tab walk through the header, counting which sort controls receive focus;
  - Chromium's accessibility tree at 5,000 rows;
  - for Satori row states, 200 ArrowDown presses from the first row, then Space and Enter.
- **Environment.** Chromium 153 headless through Playwright 1.63, at 1440×900, on an Apple M4 Max running
  macOS 26.6. No Nuxeo was involved.

Every figure this decision rests on is in section 4, so the record stands on its own. The raw per-run
outputs and the spike source are in `~/Desktop/agentic-ui-evidence/NXSAT-308/spikes/table/`. They are
outside the repository because the repo keeps evidence out of the tree (`CLAUDE.md`, "Evidence"), and the
spike was required never to be committed. Reproducing it needs only what this section describes.

## 4. Results

### 4.1 Bundle cost

| Angular 20 (all JS, gzip) | Bytes  | vs A        |
| ------------------------- | ------ | ----------- |
| A: hand-written           | 68,194 | baseline    |
| B: CDK table              | 81,800 | +13,606     |
| C: Material table + sort  | 90,483 | **+22,289** |
| D: CDK virtual scroll     | 82,761 | +14,567     |

| Angular 22 (all JS, gzip)            | Bytes  | vs C       |
| ------------------------------------ | ------ | ---------- |
| C: Material table + sort             | 84,042 | baseline   |
| C+R: + Satori row states             | 87,581 | **+3,539** |
| E: + row states + CDK virtual scroll | 91,669 | **+7,627** |

These figures isolate each candidate. In the product the marginal cost of C is lower, because `mat-table`
and `matSort` already ship in lazy chunks for the history and administration tables. That was not measured.

### 4.2 Rendering and updates, Angular 20, CPU throttled 4×

Time to first frame after rendering the rows:

| Rows  | A: hand-written | B: CDK table | C: Material | D: virtual |
| ----- | --------------- | ------------ | ----------- | ---------- |
| 50    | 43.9 ms         | 49.7 ms      | 54.3 ms     | 25.8 ms    |
| 500   | 232.3 ms        | 270.3 ms     | 307.1 ms    | 30.5 ms    |
| 5,000 | 2,015 ms        | 2,351 ms     | 2,783 ms    | 47.4 ms    |

Updating 500 rendered rows:

| Update                         | A        | B        | C        | D       |
| ------------------------------ | -------- | -------- | -------- | ------- |
| Select all                     | 178.0 ms | 175.0 ms | 159.8 ms | 10.9 ms |
| Re-sort (a new server page)    | 177.6 ms | 200.6 ms | 238.0 ms | 13.9 ms |
| Change columns (hide, reorder) | 86.9 ms  | 271.5 ms | 319.6 ms | 8.9 ms  |

Scrolling, and size at 5,000 rows:

| Measure                                      | A        | B        | C        | D        |
| -------------------------------------------- | -------- | -------- | -------- | -------- |
| Scroll at 500 rows, 95th-percentile frame    | 16.8 ms  | 16.7 ms  | 16.8 ms  | 16.8 ms  |
| Scroll at 5,000 rows, 95th-percentile frame  | 250 ms   | 167 ms   | 217 ms   | 16.8 ms  |
| Frames over 50 ms while scrolling 5,000 rows | 16 of 17 | 24 of 27 | 19 of 20 | 0 of 121 |
| Heap at 5,000 rows                           | 52.3 MB  | 66.6 MB  | 66.9 MB  | 5.6 MB   |
| DOM nodes at 5,000 rows                      | 105,048  | 105,057  | 105,089  | 415      |

D renders 17 rows whatever the list length. Every unvirtualised candidate is linear in rows, and C costs
about 1.2 to 1.4 times A at every size. At 5,000 rendered rows all three are unusable, with scrolling
reduced to a few frames in two seconds. At 500 they all scroll at 60 fps.

### 4.3 Angular 22, with Satori row states, CPU throttled 4×

| Rows  | C: Material | C+R: + row states | E: + row states, virtual |
| ----- | ----------- | ----------------- | ------------------------ |
| 50    | 68.0 ms     | 85.0 ms           | 45.6 ms                  |
| 500   | 424.8 ms    | 545.9 ms          | 41.6 ms                  |
| 5,000 | 4,095 ms    | 4,553 ms          | 70.0 ms                  |

| Measure              | C       | C+R      | E      |
| -------------------- | ------- | -------- | ------ |
| Select all, 500 rows | 147 ms  | 203 ms   | 12 ms  |
| Heap at 5,000 rows   | 56.6 MB | 110.6 MB | 6.4 MB |

Satori row states add 25 to 29% to render time at page sizes and double the heap at 5,000 rows. These
runs had 3 repetitions, and some unthrottled scroll runs had one-off outliers, so read the Angular 22
figures as indicative.

### 4.4 Accessibility

- **axe reported zero violations for every candidate**, today's hand-written table included. Its
  click-only `<th>` sort headers are a real keyboard defect that axe does not detect. "axe-clean" is
  therefore not evidence for this decision.
- **Keyboard access to sorting.**
  - A: none of the 7 sortable headers is reachable by Tab, and no header has `aria-sort`.
  - B and D: 7 of 7, but only because the spike wrote a `<button>` and `aria-sort` by hand in each header.
  - C, C+R and E: 7 of 7, with `aria-sort`, from `MatSortHeader` itself.
  - None of the candidates announces a sort change. Most screen readers do not announce a change to
    `aria-sort`, so Material's guidance is to set `sortActionDescription` on each header and announce the
    new order through `LiveAnnouncer` on `matSortChange`. The spike did neither. Section 7 requires both.
- **What a screen reader is told at 5,000 rows.**
  - A, B, C and C+R expose a real table with 5,001 rows (a header row plus 5,000).
  - D exposes 18 rows. It reports 5,001 only because the spike added `aria-rowcount` and `aria-rowindex`
    by hand.
  - E exposes 18 rows with no `aria-rowcount`: CDK 22's virtual table sets neither attribute, so a
    screen reader is told the list has 18 rows.
- **Satori row states without virtualisation (C+R), over five runs at each of 50 and 5,000 rows.**
  - Exactly one row is in the tab sequence.
  - At 5,000 rows, 200 ArrowDown presses from the first row visit 200 further distinct rows.
  - At 50 rows, focus reaches the last row after 49 presses. The remaining presses keep it there, because
    Satori clamps ArrowDown at the last rendered row.
  - At both sizes, each row's accessible name is its own document's, and Space selects the row and Enter
    activates it.
- **Satori row states with virtualisation (E), at 5,000 rows.**
  - **Every row from the 17th on announced another document's name, in all 10 runs that checked it**:
    181 of 200 when focus held. The first wrong name came at press 17, exactly where the viewport starts
    recycling rows. For example, the row for document 00017 was announced as "Policy report 00004".
    Row states compute the label after a render, and a recycled row does not trigger that recompute.
    The same happened at 50 rows, which also recycle once scrolled.
  - **In 4 of 11 runs focus fell to `<body>`**, at presses 26, 54, 82 and 131. A keyboard user is then
    thrown out of the list.
  - This affects any recycled rows. It needs a Satori fix before row states are used with virtual scroll
    or with `recycleRows`. **Worth reporting to the Satori team.**
- **Sticky header.** It works natively in A, B, C, C+R and E. D lost it: after scrolling halfway the
  header was 829 px out of view. It needed CDK's documented workaround of offsetting each `<th>` by the
  rendered-content offset.

## 5. Why Material table

- **Speed does not decide it.** At the sizes paging will render, every candidate is fast enough. A page
  render is a one-off on load or page change, not an animation frame. 50 rows take at most 54 ms
  throttled, 500 rows at most 307 ms, and both scroll at 60 fps afterwards. C costs 1.2 to 1.4 times A
  under throttling, which at 50 rows is about 10 ms. Unthrottled the two are equal: 12.0 ms and 12.4 ms.
- **The things that do decide it all favour C:**
  - **Satori compatibility.** The row-state layer styles Material rows only. B and A would need
    `mat-row` attributes added by hand to look right.
  - **Accessible sort headers out of the box.** `MatSortHeader` provides a focusable control, `aria-sort`
    and the `sortActionDescription` hook. A and B have to hand-write all three. Announcing the change is
    the component's job whichever primitive is chosen (section 7).
  - **Consistency.** The repo's history and administration tables are already `mat-table`, and the history
    tables already sort with `matSort`.
- **Why not virtualise now.**
  - On Angular 20 it means D: hand-written rows, giving up `mat-table` and `MatSort`, a sticky-header
    workaround, and `aria-rowcount` and `aria-rowindex` written by hand.
  - On Angular 22, virtualisation combined with Satori row states mis-announces rows.
  - Paging on the server keeps the rendered rows to a page, where nothing needs it.
- **Why not CDK table.** It saves 8.7 kB gzip over C, and costs `MatSort` and Satori styling.

## 6. What this decision forecloses, and what it does not

**It forecloses:**

- **A different DOM without a rewrite.** The component's DOM becomes `<table mat-table>` with `mat-row`
  rows. Moving later to a `div`-based `role="grid"`, for example for spreadsheet-style cell-by-cell
  arrow navigation or inline cell editing, means rewriting the row and cell templates, styles and
  specs. `mat-table` has table semantics with row-level keyboard navigation (from row states), not grid
  semantics. If a true data grid is ever needed, it is a separate component.
- **Rendering thousands of rows at once in `nxs-document-list`.** The component pages. "Show all 5,000"
  is not offered.

**It does not foreclose:**

- **Virtualisation later.** CDK 21+ virtualises the same `mat-table` templates. This was measured on
  Angular 22 at 70 ms for 5,000 rows, as an additive change. Its two gaps must be closed first: no
  `aria-rowcount` or `aria-rowindex`, and the row-states naming defect.
- **Server paging, sorting or selection.** All three sit outside the primitive (section 7).

**One guard keeps the choice reversible for customers: no Material table type in the public API.** Today a
column is an `ExtensionColumnDescriptor`, and a cell shows the value of its `field`; there is no
cell-renderer contract. That contract is primitive-neutral and should stay so. If custom cell rendering
is added, it must be a renderer resolved by ID through the existing component-by-ID registry
(plan section 3). It must never be `matColumnDef` or `MatCellDef` in a public signature: once a customer
writes a `matCellDef`, the primitive can no longer change without breaking them. This is the same rule as
"adf-hx types never appear in our public API", and the federation-readiness rule on serializable
contracts.

## 7. Constraints for whoever builds `nxs-document-list`

1. **Data and sorting.**
   - Rows come from `getBrowseFolderContents(path, pageSize, { currentPageIndex, sort })`.
   - `matSortChange` triggers a new request. Pass a plain array as the data source; never use
     `MatTableDataSource` wired to `MatSort`, which would sort in the browser.
   - Validate the sort key against the sortable fields before sending it.
   - For `Root`, `Domain`, `Favorites` and `Collection`, the service ignores page index and sort today
     (section 1). Those branches still request only `pageSize` entries, so anything past the first page
     cannot be reached. **Paging support in `getNavTreeChildren` and `getCollectionMembers` is a
     prerequisite** for any of these sources that can exceed one page; disabling paging is not a
     fallback. Sorting alone may be disabled for a source that cannot honour it, and its headers then
     render as plain, non-sortable headers rather than controls that change nothing.
2. **Paging.**
   - Next is enabled by `hasNextPage`. Previous is enabled whenever the current page index is above
     zero; `hasNextPage` says nothing about it. Show "of N" only when `totalSize` is a real, non-negative
     total.
   - Keep the page size at 100 or less (today it is 50).
   - If a "load more" mode is added, cap the accumulated rows at 500, the largest size measured that
     stays smooth at 4× throttle.
3. **Selection.**
   - Selected ids live in `SelectionService`.
   - Support single and multiple selection (checkbox), range selection with Shift+click from an anchor,
     and select-all on the page with an indeterminate header checkbox.
   - Keyboard: ArrowUp and ArrowDown move, Space toggles, Enter opens. On Angular 22 this comes from
     Satori row states. Until then, build an `nxs` row directive with the same contract.
   - Adopting Satori then changes `nxs-document-list`'s own template and imports, swapping the `nxs`
     directives for Satori's. It is not a registration change: `ExtensionComponentRegistry` registers
     component types, and directives are compiled into the template. What stays the same is the
     behaviour that users and the specs depend on, and nothing outside the component changes.
4. **Columns.** `displayedColumns` is the resolved, ordered, visible descriptor list. Show, hide and
   reorder are changes to that array; no separate column API is needed.
5. **Row states.**
   - Until Satori: `selected` and `active` classes.
   - On Angular 22:
     - put `satTableWithRowStates` on the table and `satRowState [selected] [active]` on each row;
     - mark the checkbox `satRowStateSelectionControl` and the title link `satRowPrimaryAction`;
     - seed the `sat.table-with-row-states.row-description.*` translation keys.
   - Never set `recycleRows` while row states are in use.
6. **Sort announcements.** Set `sortActionDescription` on each sortable header, from the column's
   translated label. On `matSortChange`, announce the new order through `LiveAnnouncer`, for example
   "Sorted by Modified, descending", and announce clearing the sort too.
7. **Accessibility tests.** axe will not catch a regression of section 4.4, so the component spec and the
   browse E2E must assert it directly:
   - every sortable header is reachable by Tab and has `aria-sort`;
   - a sort change produces a `LiveAnnouncer` announcement naming the column and direction;
   - a keyboard walk keeps each row's accessible name equal to its own title.
8. **Satori's keyboard model has gaps.** It has no Home, End or Page keys and no Shift+Arrow range. Add
   them in the `nxs` layer if the product wants them; do not assume Satori provides them.

DAM is outside this decision. AssetGrid is a grid of cards, not this table, and whether it stays in
NXSAT-308 is plan section 13, question 2. Virtualising a card grid would be a separate choice and is not
constrained by this one.
