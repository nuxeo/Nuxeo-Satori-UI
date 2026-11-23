# Computations

The runtime of layout version 2's computed fields: it evaluates the computations a layout names,
against a record that is already loaded ([layout-v2.md](../../../docs/business-apps/layout-v2.md),
section 4). [`libs/shared/app-definition`](../app-definition/README.md) checks the same
computations when a package is built; this library works them out when a page shows them.

Decision 4 ([decision log](../../../docs/business-apps/decisions.md)) sets the rule: registered
computations only, no expression language, no requests and no customer code. So a computation is
looked up by its ID, and nothing in a layout is ever run as code.

It is plain TypeScript, with no Angular and no HTTP. It is the first project tagged
`scope:engine`, with `scope:shared` too ([architecture.md](../../../docs/business-apps/architecture.md),
section 14), and imports nothing but `@agentic-ui/shared/app-definition`.

```ts
import { compute, type ComputationContext } from '@agentic-ui/shared/computations';

const context: ComputationContext = {
  value: (field) => record.properties[field],
  display: (field) => displayValueOf(record, field),
  // A rule that evaluates a computation passes `depth` on to compute: see "The computation itself".
  rule: (rule, depth) => rules.evaluate(rule, record, user, depth),
  today: new Date(),
};
const result = compute(field.computed, context);
// { ok: true, value: 36 }, or { ok: false, reason: 'the computation "core.age" takes ...' }
```

## What is in it

- **`compute(computation, context, evaluators?, depth = 0)`** evaluates `{ "type", "parameters" }`
  as a layout writes it. It never throws: whatever is wrong, the result says why, and the renderer
  leaves the field out and logs the reason (layout-v2.md, section 8). `depth` is for a rule that
  evaluates a computation in turn.
- **`PACKAGED_COMPUTATION_EVALUATORS`**, the six computations by ID, frozen. A customer's own
  computation is a Layer 2 registration in code, passed to `compute` beside them.
- **`ComputationContext`** is what a computation reads: `value` and `display` of a property,
  `rule`, which is given the depth of the computation asking, and `today`, injected so that tests
  are deterministic.
- **`isStoredCalendarDay(value)`**, whether a date is a stored day or an instant (below), so that
  the record page's `date` widget can format with the same rule.
- **The caps**, `MAX_DEPTH` (10) and `MAX_TEMPLATE_LENGTH` (1000).

### A parameter

- a literal: a text, a number or a boolean;
- `{ "field": "<prefix>:<name>" }`, read through `context.value`;
- `{ "computed": { … } }`, evaluated one level deeper;
- for `core.choose`'s first parameter only, a rule, handed to `context.rule` as it is written.

A property is one value. Missing, as `undefined` or Nuxeo's `null`, it is `null`. A `Date` is a
picked day, as a form's date picker holds one at local midnight: it is its local day, written
`2024-03-06`, and its time of day is not kept. A list or a complex value is refused where one value
is wanted; `core.sum` and `core.count` read their lists through `context.value` themselves.

## The decisions

Where layout-v2.md is silent, these are the choices, each tested.

- **Dates** (`src/lib/dates.ts`, after `AGENTS/08-bug-patterns.md`, pattern 29: a stored day is
  anchored in UTC, and a real instant belongs in the reader's zone):
  - **`2024-03-06`** is that day.
  - **An ISO 8601 instant at exactly midnight UTC**, written with `Z` or `+00:00` and a fraction of
    zeros or none, is its UTC day. That is what Nuxeo stores for a day-only write.
  - **Any other ISO 8601 instant**, a `dc:created` for one, is its day in the reader's zone.
  - **A `Date`** is its local year, month and day, as a picker gives them.
  - **`today`** is the reader's local day, so an age turns over at their midnight. A `today` that is
    not a valid `Date` is refused, rather than answered with `NaN`.
  - `isStoredCalendarDay` is true for the two day forms, and false for everything else, a `Date`
    included. **The one known misreading:** an instant that falls at exactly midnight UTC, a
    `dc:created` stamped `00:00:00.000Z`, is taken for a stored day, and west of UTC reads a day
    later than it is there. Nothing in the value tells the two apart.
  - **Only ISO 8601 as Nuxeo writes it is a date:** a day, `2024-03-06`, or a date and time with a
    zone, `Z` or `±HH:mm`. A time with no zone names a different instant in every zone, so it is
    refused rather than guessed. So is a day that does not exist, such as `2023-02-29`, and a
    number of milliseconds.
  - **A whole month is counted as a birthday is:** complete on the same day of the month, or, when
    that month has no such day, on the first of the next. A year is twelve such months. So someone
    born on 29 February turns one on 1 March in a common year.
- **`core.age(date)`:** the whole years from the date to today.
  - A missing date gives `null`, and a value that is not a date is refused.
  - **A date after today is refused.** An age before birth is not an age, and a negative number or
    a 0 would show a wrong value as if it were right. The day of birth itself gives 0.
- **`core.template(text)`:** each `{<prefix>:<name>}` placeholder becomes `context.display(field)`.
  - **A missing property becomes empty text**, whatever the display would say for it.
  - **Text, never HTML.** Nothing is escaped or interpreted: markup in a value reaches the renderer
    as the characters it is, and the renderer binds the result as text. A `$&` in a value is not a
    replacement pattern.
  - **Text in braces that is not a placeholder stays as written**, such as `{note}` or
    `{ dc:title }`. The validator refuses it when the package is built.
  - The text is a literal, up to 1000 characters. A property or a computation is refused.
- **`core.sum(list[, subfield])`:** the sum of its numbers.
  - **A blank, `null`, is skipped**, as a spreadsheet's sum skips an empty cell.
  - **Anything else that is not a number is refused**, a numeric text such as `"12"` included,
    rather than left out of a total that would then look whole.
  - **An item with no such subfield is refused.** Nuxeo sends every subfield of a complex value,
    with `null` for an empty one, so a missing key is a misspelt subfield, not a total of 0.
  - An empty list gives 0, a missing one `null`. A total too large to be a number is refused, rather
    than shown as `Infinity`. A sum of decimals is not rounded: the `number` widget's `decimals` is.
- **`core.count(list)`:** how many items it holds, blanks included.
  - **A missing list gives `null`**, not 0: a property the record was loaded without is not a list
    of none, and a 0 nobody counted is a wrong value. An empty list gives 0.
  - A value that is not a list is refused, a text included, whatever its length.
- **`core.dateDiff(date, date or "today", unit)`:** the second date minus the first, in whole
  `days`, `months` or `years`.
  - **Positive when the second date is later**, negative when it is earlier, and the same size
    either way round. Never `-0`, which a number format writes as "-0".
  - Months and years are counted as `core.age` counts them.
  - **`"today"` is the second parameter's, as written.** As the first, or as the value of a
    property or a computation, it is a text that is not a date, and is refused.
  - Either date missing gives `null`. The unit is a literal.
- **`core.choose(rule, a, b)`:** `a` while the rule passes, otherwise `b`. Only the chosen one is
  evaluated, so the other is never read and its refusal never shown.
- **The computation itself:**
  - It is an object with a text `type` and, optionally, `parameters`. **Any other key is refused**,
    rather than ignored: it might change what the value means.
  - Absent `parameters` are none; `null` is malformed, not absent (section 8).
  - A type is found among the evaluators' own keys only, so `constructor` or `__proto__` is not
    registered.
  - **Computations nest at most 10 deep.** A field's own computation is level 1, and each
    `{ "computed" }` parameter is one deeper. The 11th level is refused without being evaluated,
    and nothing under it is read.
    - **Through a rule, only if the rule passes the depth on.** `context.rule` is given the level of
      the computation asking. A rule that evaluates a computation in turn, as `app.rules.fieldIn`
      will, passes that to `compute(…, depth)` and the count continues; one that calls `compute`
      without it starts again at 0.
    - **So the cap bounds the depth of an evaluation, not the size of a file.** The work is the
      computations within ten levels of the top, and the packaged evaluators evaluate each at most
      once.
  - **An evaluator that throws, or a context whose `value`, `display` or `rule` throws**, is refused
    with the error's message, naming the computation.
  - A refusal of a nested computation is passed up as it is, naming the one that refused.
  - **A reason quotes at most 60 characters of each value it names**: a value, a type, a key, a
    property or a subfield. An error's message is cut at 60 characters too.
  - **An evaluator checks its own number of parameters**, so a customer's needs no signature here.
    The packaged ones word the refusal exactly as the validator does.
- **Refusals the validator words its own way.** Six mistakes are refused here in other words than
  the validator's. In the app the validator runs first: it leaves such a field out, or refuses the
  file, with its own message, so these refusals never reach the console. They are for a caller that
  evaluates a computation the validator has not seen.

  | The mistake                               | The validator says                                                                                | This library says                                                                              |
  | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | A key a computation does not have         | `"<key>" is not a key version 2 has`                                                              | `the computation "<type>" has a key a computation does not have: "<key>"`                      |
  | Parameters that are not a list            | `parameters must be a list`                                                                       | `the computation "<type>" has parameters that are not a list`                                  |
  | A parameter that is not a value           | `a value is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} }` | `a parameter is a text, a number, a boolean, … , not <value>`                                  |
  | `core.template`'s text that is not a text | `the computation "core.template" takes a text with {<prefix>:<name>} placeholders`                | The same, then `, not <value>`                                                                 |
  | `core.sum`'s subfield that is not a text  | `the computation "core.sum" takes a text here`                                                    | `the computation "core.sum" takes the name of a subfield as its second parameter, not <value>` |
  | `core.dateDiff`'s unit that is not one    | `the computation "core.dateDiff" takes "days", "months" or "years" here`                          | `the computation "core.dateDiff" counts in "days", "months" or "years", not <value>`           |

## What holds it to the rest

- **The registered computations.** The evaluators' IDs must be `PACKAGED_COMPUTATIONS`' IDs, both
  ways. For every number of parameters from none to two past the most, an evaluator must take
  exactly the numbers its `Signature` allows, `optional` included, and refuse the others in the
  validator's own words. A parameter either side gains fails the test until the other follows.
- **The proposal.** Every computation in layout-v2.md's JSON examples must evaluate against the
  Member record of its section 9, and the Member page must get its name and its age. The test
  target lists the document among its inputs, so an edit to it reruns the tests.
- **Its imports.** The library's sources import only each other and
  `@agentic-ui/shared/app-definition`, and name no `fetch`, `XMLHttpRequest`, `eval`, `Function` or
  timer.
- **The time zones.** Every spec runs twice, in Asia/Calcutta and in America/New_York, one each
  side of UTC, because each reading of a date can only be seen failing on one side:
  - a stored day read in the reader's zone is a day out only west of UTC, since midnight UTC is the
    same day everywhere from UTC to +14:00;
  - a `Date` at local midnight, or `today` at 01:30, read in UTC is a day out east of it.

  The suite supports these two zones and no other, so it does not take `SATORI_TEST_TZ`: its
  expectations are literals, written for each. A test fails if a run is in any other zone. CI
  runners are UTC, where neither reading could fail.

## Tests

```bash
npx --no-install vitest run --config libs/shared/computations/vite.config.mts
npx nx run-many -t lint,typecheck,test -p shared-computations
```

- **Negative controls:** every reason a computation can be refused with has one: an input wrong in
  one way, and the exact reason. `reasons.spec.ts` reads the library's source and fails when a
  reason has no control. Every refusal is built by `refuse()`, and a second test fails when one is
  built any other way, so that a reason cannot slip past the first. It proves that every reason has a
  control, not that every guard has one. The mutation checks are for guards.
- **Mutation checks:** taking out any one of these 37 guards made a test fail. The helper that ran
  them refused a mutation that did not apply exactly once, and one that broke a suite instead of
  failing a test.
  - the depth cap, and the depth cap off by one;
  - the starting depth, the depth given to a rule, and refusing a depth that is not a whole number
    from 0;
  - birthday-correct ages, against days divided by 365 and by 365.25;
  - refusing a non-number in a sum, and an item with no such subfield;
  - today read in the reader's zone, and refusing a `today` that is not a valid `Date`;
  - a stored day read in UTC, any other instant in the reader's zone, and a `Date` as its local
    day;
  - the stored-day test's seconds, its fraction of zeros, and its `Z` or `+00:00`;
  - refusing a future birth date, a time with no zone, and a key a computation does not have;
  - a missing property's placeholder as empty text, and the template's size cap;
  - evaluating only `core.choose`'s chosen value;
  - looking up a type among own keys only;
  - never `-0`;
  - catching what an evaluator or the context throws;
  - quoting a type, a key and a subfield, and cutting an error's message;
  - an evaluator's number of parameters drifting from its signature, and an ID missing from the
    evaluators;
  - a new refusal with no control, and a refusal built without `refuse()`;
  - each run in its own zone, and the config's zones the ones the suite's literals are written for.

## Not done yet

- **The renderer**, in phase 1: it binds a result as text, and leaves out a field whose computation
  is refused, logging the reason.
- **The record page's `date` widget** is to format with `isStoredCalendarDay`, so that an instant
  such as `dc:created` shows the reader's day, as this library reads it. Version 1's renderer,
  `field-view.ts`, formats every date in UTC.
- **Rules that evaluate a computation**, `app.rules.fieldIn` first, are to pass on the depth
  `context.rule` is given.
- **The validator does not know the caps.** A package with computations nested 11 deep, or a
  template over 1000 characters, passes the pipeline and is refused here. `MAX_DEPTH` and
  `MAX_TEMPLATE_LENGTH` are exported for it.
- **A result's type against its widget**, a `number` widget on a template for one, which needs the
  content model: phase 1's model reader.
- **The security review** of decision 4's starting set, open as decision 4 of the decision log.
