# 04-walkthrough — what to say, slide by slide

**Deck:** `~/Desktop/agentic-ui-evidence/beta/slides/04-walkthrough.pptx` · 23 slides
**Rebuild:** `node tools/video/export-pptx.mjs 04-walkthrough`

The `.pptx` carries notes already, but they are auto-composed from each slide's own lede and
footnote — fine as a safety net, useless as a script, because reading the slide aloud is the one
thing you must not do. **This file is what to say.** The slide holds the evidence; you hold the
argument.

**Total if you present every slide: ~27 minutes.** It is built to be cut. The two paths:

| If you have | Show                               |
| ----------- | ---------------------------------- |
| **~8 min**  | 1, 2, 3, 6–7, 10–11, 14, 21, 23    |
| **~15 min** | add 4–5, 8–9, 12–13, 16, 19–20, 22 |
| **Full**    | all 21                             |

Slides 4–13 are five **pairs**: the edit, then the result. Never linger on an edit slide — the
audience does not read JSON at speed. Say what it does in one sentence and advance.

---

## Framing

### Slide 1 — The edit, then the result · 30s

> "I want to show you what was built, and I want to do it in a way you can check. Every pair in this
> deck is one change and what that change did. Left slide: the actual edit. Right slide: a real
> screenshot of the running app afterwards."

Say the deck is built to be interrupted, and that you would rather go deep on two things than skim
twelve. **Then stop talking and let them steer.**

---

### Slide 2 — Two tracks, both real · 45s

The one distinction that makes everything else make sense:

> "Two ways a customer changes this product. Track A is configuration — JSON in the customer's own
> configuration package. **No rebuild of the application, no fork**: the package is zipped and
> installed like any Marketplace package. Track B is their own code in their own repo,
> against our published package. Most of what customers ask for lands in Track A."

If asked how you know that: it is a **design expectation, not a measured fact**. We have not yet
tested it against a real request backlog. Say so — it is the honest answer and it costs nothing.

---

### Slide 3 — Where we start · 45s

> "This is the product as shipped. Real Nuxeo repository, real documents, empty manifest. Columns
> read Title, Modified, Last Contributor. Everything after this slide is a change to _this_."

Point at the columns specifically — they are the thing that visibly changes twice later.

**If asked the document count:** it drifts as the instance is used. Say "a couple of hundred" rather
than quoting a number that will be wrong by the time anyone checks.

---

## Track A — five changes, no rebuild of the application

### Slide 4 — Make it their product, in a file · 1 min

> "Branding is Layer 0, and it lives in a **bootstrap fragment** — not in the manifest. Application
> title, logo, default theme, and a set of CSS custom properties. That is the whole rebrand surface."

The distinction to land, because it is the most common way this goes wrong:

> "There are **two** configuration layers and people conflate them. Branding and themes are in the
> `bootstrap` fragment. Navigation, labels, actions and columns are in the `manifest` fragment. Both
> ship in the customer's own Marketplace package. `runtime-manifest.ts` has no branding key at all —
> if you put branding in the manifest, nothing happens and nothing tells you why."

Then the upgrade point, which is a real engineering decision rather than a diagram:

> "That package is the customer's, and it depends on ours. Our package installs no configuration
> file, so upgrading ours cannot replace theirs. We rehearsed it with `nuxeoctl mp-install`:
> upgrading ours with two customer packages installed served byte-identical configuration. The first
> design, which installed `bootstrap.json` itself, broke the upgrade — NXSAT-317 found that, and
> NXSAT-312 removed configuration files from the server altogether."

**Volunteer the logo, then the limit.** They will ask about it, so get there first:

> "The logo is in the same package. It is an asset the package contributes, `branding.logo` names
> it, and it replaces the word mark in the header and the logo on the login page — no rebuild of the application. What
> it does not change: the small Hyland mark at the top of the navigation rail, the 'Content Innovation
> Cloud' title when the rail is expanded, and the favicon."

The logo is served from the customer's package like its fragments, so an upgrade of ours leaves it
alone by the same mechanism. Say the mechanism; `docs/demo-deck-claims.md` records exactly what the
NXSAT-312 rehearsal observed. The Admin Center path is unrehearsed.

**Do not say the rail mark, the rail title or the favicon is done, planned for a release, or
costed.** None has a key: the first two are hard-coded in Satori's `sat-platform-nav`.

---

### Slide 5 — The result: a new brand and a fifth theme · 45s

> "Same deployment, one file. New product name, and a fifth theme card that is now the default."

The strongest thing on this slide is not visible, so say it:

> "We hashed `main-*.js` before and after. **Byte-identical.** Nothing was rebuilt — a file was
> edited and the page was reloaded."

---

### Slide 6 — Make it speak the customer's language · 1 min

This is the slide that sells Layer 1. Do not undersell it by reading ids.

> "This is not a settings heading. These are the words their users read all day. Browse becomes Claim
> Files. Collections becomes Policies. Tasks becomes Underwriting Queue. And two entries this
> customer has no use for are hidden outright — not greyed out, **gone**."

> "All fourteen navigation entries we render by default work this way, addressed by id. The same
> mechanism renames list columns, so Last Contributor becomes Adjuster."

**Fourteen rendered, fifteen registered.** `PACKAGED_NAV_ITEMS` still carries the legacy
`app.navbar.browse`, shipped `disabled` so a single Browse entry reaches the user. It is
addressable like any other id, and restorable — as a `navbar` slot entry restating the id with
`"disabled": false`, not an `overrides` entry. Say "fourteen by default", not "fourteen packaged",
if a technical audience is counting.

**If asked about translations:** both routes work, and both show one wording in every language.
Per-language wording is not configurable today — the manifest's `labels` map is not keyed by
language.

- `overrides.<id>.label` — your literal, verbatim, in every locale. Translation is bypassed.
- Layer 0 `labels["nav.item.<slug>"]` — replaces the text of the descriptor's `labelKey`. The
  manifest's `labels` layer last over every language's shipped catalogue
  (`app-translate-loader.ts`), and the shell resolves `labelKey` before falling back to `label`.

Setting **both** is the trap: the override wins outright and the `labels` entry is silently inert.
That precedence is documented in `docs/extension-reference.md`.

---

### Slide 7 — The result: it reads like their product · 45s

Let the before/after do the work. One sentence, then a pause:

> "Twelve entries renamed or removed, plus a column, from one document in the repository."

Then the framing that matters commercially:

> "Nobody forked anything. There is no branch to maintain, and none of this is in our release notes as
> a breaking change, because it is data."

**Why the rail is expanded:** collapsed, it hides every label behind an icon. If you demo this live,
expand it first or the beat proves nothing.

---

### Slide 8 — Shape the column picker · 45s

Two controls, and the difference is the whole slide:

> "`disabled` takes a column away from the user entirely — they cannot turn it back on. `hiddenByDefault`
> offers it in the picker but starts it unchecked. Same JSON, two very different policies."

**The trap worth mentioning to a technical audience:** `hiddenByDefault` and `sortable` are honoured in
`slots.documentList`, **not** in `overrides` — `overrides` reads only order, label, rule and visible,
and silently drops the rest. Our own documentation had that example wrong once.

---

### Slide 9 — The result: the picker, opened · 45s

**Tell them where to look, because the table is the wrong place:**

> "Read the panel, not the table. Adjuster is the renamed column. Version is present but unchecked —
> that is `hiddenByDefault`. And State is **absent altogether** — that is `disabled`. A screenshot of
> the resulting table shows the outcome but cannot show the control."

---

### Slide 10 — Add whole pages, and route to them · 1 min

> "A manifest is not limited to renaming what we ship. It can contribute **routes**, resolving a
> component by id — so a customer puts their own pages wherever they want them, as many as they want."

**Be precise about the boundary, because a technical audience will find it otherwise:**

> "The component has to be compiled in. That is a one-time Layer 2 step. From then on, placing it,
> routing it, naming it, ordering it and rule-gating it are all Layer 1 and need no rebuild of the application."

Worth saying plainly, because it is the kind of thing that earns trust:

> "We registered this page while building this deck, and we found the reason it had to be done: the
> routes slot went live on the 31st with **no component in the product able to serve it**. Live and
> unusable. Our own drift gate then refused the change until it was documented."

---

### Slide 11 — The result: three new destinations · 45s

> "Contracts, Renewals and Compliance — three entries the manifest added, with their own icons, and
> the page they route to."

Two honesty notes, both cheap and both worth making:

- **Two images, not one.** The expanded drawer is an overlay: open, it clips the page heading. No
  single frame can honestly show both, so we did not fake one.
- **The page is headed "Component Showcase"** because that component doubles as our platform-UI
  catalogue. The entry and the heading disagree. The slide is about the mechanism, not that page's
  content — say so rather than hoping nobody reads it.

---

### Slide 12 — Add actions, and gate them declaratively · 1 min

> "Three new bulk actions, and two different kinds of gate. `rule` **removes** an action when it does
> not hold. `enabledRule` **keeps it and greys it out**. Same declarative mechanism, two completely
> different user experiences, no code."

The maintenance number is the point:

> "Adding a seventh bulk action used to mean a button, an `@Output()` and a shell handler — three files
> across two projects. It is now two registrations."

---

### Slide 13 — The result: three new actions · 45s

> "Two rows selected: Archive is there, Publish is gone, Merge is available. With **one** row selected,
> Merge disappears entirely and Send-for-review stays but greys out."

**This is where you volunteer the security answer, before it is asked as an accusation:**

> "One thing I want to say without being asked. **Hiding an action is not a security control.** Type a
> hidden route into the address bar and the page still loads. Nuxeo's server-side permissions are the
> authorisation boundary and they still apply. Layer 1 decides what the interface _offers_; it does not
> decide what the server _allows_."

If they push: the registry deliberately **fails open** for unknown rules, so a typo cannot strip working
actions out of the UI — safe precisely because visibility is not authorisation. The three user rules
fail _closed_, so an unknown admin rule cannot hand everyone the Administration entry.

---

## Track B — their own code

### Slide 14 — A page is three edits · 1 min

> "This is the entire mechanism for adding a surface to an app built on our package. A component, a
> lazy route, a navigation descriptor. The platform handles routing, code-splitting and registration."

The line that matters for support:

> "Look at the imports. `@nuxeo/satori-platform/nuxeo-client` and `/ui`. **Nothing from our internals.**
> If we change how the bridge works, this keeps compiling — which is what makes an upgrade a version
> bump instead of a merge."

Note the rule-gating as a quality detail: the entry is hidden when signed out, because with no
credential every request 401s, and a link that can only fail is worse than no link.

---

### Slide 15 — Search, metadata, preview and actions · 1.5 min

Slow down here. This is the most technically credible slide in the deck.

> "Four things every content application needs, and where each comes from."

**The two-step is the insight:**

> "`search()` returns a flat row built for a list — title, type, modified. It carries **no properties
> bag and no blob**, so it cannot feed a metadata panel or a preview. Selecting a row fetches the full
> document. That two-step is what a real ECM UI does; collapsing it means either over-fetching every
> row or rendering a metadata panel with holes in it."

**The blob lifecycle is the part to point at:**

> "A Nuxeo binary must never reach `[src]` as a URL — that request leaves the app's auth interceptor
> behind and 401s. So: fetch through the service, wrap in an object URL, and revoke it. The revoke has
> to happen on **replacement** as well as on destroy, or every document a user clicks leaks a blob for
> the life of the page. That is the half everyone forgets."

---

### Slide 16 — The result: a working case file · 1 min

> "Real repository, real metadata, and a real blob rendered through the platform's own document
> viewer. Share, Export and Download are the platform's dialogs — the host only supplies how bytes are
> fetched, because our services never build an auth header themselves."

A detail that shows the work was done honestly rather than staged:

> "The capture clicks rows until a preview actually renders. Only five of forty-six documents in this
> repository carry an attachment, and Nuxeo's `File` type does **not** imply one — so picking the first
> row, or the first row labelled File, both gave us an empty viewer."

**If asked about the contributor field:** it shows a username, not a display name. Nuxeo carries only
the username on the document. Known gap, tracked, with a known fix path through the user port.

---

### Slide 17 — Browsing, paging and searching the real repository · 45s

> "The page a customer's users would actually live in. Folder navigation, paging and search, through
> the same services the product itself uses — reached through the published entry point."

Worth admitting, briefly, because it makes the rest more credible:

> "This was missing from an earlier cut of this deck. We showed the widgets and a diagnostics screen and
> never the repository browser — the one surface a content application cannot do without."

---

### Slide 18 — The components, and a screen that explains itself · 1 min

> "Left: the UI components the package ships — widget grid and container, the dialogs, the selection
> topbar. That page is the template's own catalogue of them, so it is a working example rather than a
> reference table."

> "Right is the screen I would open first when a customisation does not appear. It lists the live
> configuration, the fallback chain, and **every registered extension id** — the customer's `acme.*`
> beside the platform's `app.*`. It distinguishes 'the manifest did not load' from 'the id is not
> registered' from 'a rule denied it'. Those three failures look identical in the UI."

**On generators, if asked:** four of them scaffold libraries, rules, actions and components. Be honest —
the three contribution generators write registrations but **no specs**.

---

### Slide 19 — Four commands that write the boilerplate · 1 min

> "A customer does not start from a blank file. One command scaffolds a whole extension library.
> Three more add a rule, an action or a component to a library they already have."

The distinction worth drawing, because it maps onto the four-layer model:

> "A **rule** is visibility logic — the manifest references it by id. An **action** is a handler the
> manifest can place in any slot. A **component** is a lazily-loaded panel or page. Those are exactly
> the three things Layer 1 can address, so the generators exist to make Layer 2 cheap."

> "And these ship **inside** the published package. A customer runs them against their own repo, not
> ours."

---

### Slide 20 — What the commands actually produce · 1 min

> "This is real output from those four commands, not a description of them. Fourteen files for a
> library, including a spec and a working panel. The contribution generators mostly **update** — they
> register the id in one file and leave you a place to put the logic in another."

Point at the markers if the audience is technical:

> "The registration goes in above a marker comment, so the generator has a stable insertion point and
> your own edits are never in its way."

**Volunteer both caveats — they are the difference between a demo and a sales pitch:**

> "The library generator writes a spec. The three contribution generators write registrations but **no
> specs** — you get the code, you write the test."

> "And these shipped broken once. Every insertion landed _inside_ the marker comment rather than below
> it, and lint, typecheck and six existing specs all passed. Now the generator asserts, after writing,
> that the line it inserted exists as a line of its own. That is the pattern we use everywhere: a check
> nobody has watched fail is not a check."

**If asked whether they work in a customer's repo:** verified end to end in an isolated worktree — the
generated library passed `check-extension-library`, `nx test` (6 tests), `nx typecheck` and `nx lint`
from scratch. The library generator's own output tells you it is **two steps, not one**, and hands you
the route, because a nav entry with no route falls through the wildcard.

---

### Slide 21 — The customer points an AI agent at it · 1.5 min

This is the differentiator, so give it room. Open with the problem, not the artefact:

> "Layer 2 is a customer writing code against our API. Left alone, that is expensive — they have to
> learn our conventions, and their first attempt will get the ids wrong. Layer 3 is what makes it
> cheap, and the whole of it **ships inside the package**. Their agent reads it in their own checkout.
> It never sees our source."

Walk the four, briefly — the titles are enough:

> "A knowledge base written **to** the agent, not about it. The reference listing every addressable id
> and each slot's real state. Four generators so the first attempt already conforms. And a guardrail
> the agent runs on its own work."

The line worth quoting verbatim, because it is the whole philosophy in one sentence:

> "The rule the file leads with is: **never fork to change something a layer already addresses.** And
> the corollary is the part I would want you to hold us to — if something is not possible at any
> layer, that is a gap worth raising, not a reason to fork."

**If asked "so the AI writes the customisation?"** — no, and be precise: it writes their **Layer 2
library**, in their repo. Layers 0 and 1 need no code at all. The agent is an accelerator for the
contract, not a licence to edit our source.

---

### Slide 22 — Why an agent can be trusted here: it gets told off · 1.5 min

The honest framing of why this is not hand-waving:

> "The obvious objection to an agent writing extension code is that it will produce something that
> compiles and does nothing. That is a real failure mode — a green build is entirely compatible with
> registering nothing. So the harness closes the loop."

Point at the failure, not the pass:

> "Same check, on a library that reached into our internals. It names the file, names the bad import,
> and lists the five entry points it should have used. That is a message an agent can act on without a
> human in the loop."

Then the part that makes it credible rather than decorative:

> "And this **cannot** be done with lint. eslint says so in its own config comment: a path alias makes a
> supported import and a raw internal one the same edge in the dependency graph. So this script is what
> actually holds the support boundary — which is why it ships to the customer instead of living in our
> CI, where it would only protect us."

**The rule to state if they push on trust:** the knowledge base tells the agent never to claim a
contribution works because it compiled — run the specs, and make one assert registry state. We hold
ourselves to the same rule, and it is the reason this deck's screenshots each assert their own content.

---

### Slide 23 — Where each change lived · 1 min, then discussion

Land the asymmetry:

> "Five changes on the left, all of them data. A rebrand, their vocabulary, the column picker, custom
> pages, actions and rules. Nothing rebuilt, nothing deployed, nothing forked."

> "One page on the right, end to end, in their repo — and zero edits to our libraries, which is
> enforced by a guardrail that ships inside the package rather than by a code review."

Then the upgrade proof, which is the commercial claim:

> "`npm run beta:upgrade` installs a customisation across both tracks, upgrades the platform, and
> asserts all twenty-one customer files are byte-identical and every slot the manifest names still
> exists. `--break-slot toolbar` makes it go red on demand — because a pass means nothing until you
> have watched it fail."

**Stop and open it up.**

---

## What to say when asked the hard ones

Have these ready. Each is verified; none needs hedging.

| Question                                        | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Can I install it from npm today?"**          | No. It is **publishable and dry-run verified**, not published. The first publish is a deliberate step and the final package name is part of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **"Is this adf-hx or your own UI?"**            | Both, deliberately. **Seven** upstream components render real adf-hx surfaces; the surrounding chrome is ours — thirteen components sharing the same `hxp-` prefix. The prefix tells you nothing; the import does.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **"Does the marketplace package install?"**     | **Yes, with `nuxeoctl mp-install` — rehearsed 2026-10-07 on a throwaway server.** Say: install, customise and upgrade were all run. Customisation is the customer's own configuration package (NXSAT-312), and upgrading ours with two customer packages installed served byte-identical configuration. An earlier rehearsal found the original design broke on an upgrade after `bootstrap.json` was edited (NXSAT-317); since NXSAT-312 there is no configuration file on the server at all. **Do not** extend it to the Admin Center / Update Center screens: that path has not been rehearsed. The older answer, "nobody has run Maven", was withdrawn 2026-09-26 (F13). |
| **"Is it production quality?"**                 | **Do not say "ten of ten".** Say: **ten of eleven** in-scope projects are above 90% as of 2026-09-22, and Phase 6 step 6 is reopened for the eleventh — `shared-ai-client` at 15.98%. It was ten of ten until three never-measured projects entered the denominator. **And the caveat travels with it** — those are percentages of the measured subset, and **6,137** in-scope lines are in no test at all. "The bar is met" and "the code is 90% tested" are different sentences.                                                                                                                                                                                           |
| **"Accessibility?"**                            | **Do not say "met".** Say: it was met on 2026-08-24 across fifteen cases on eight routes, and it is being re-verified — five consecutive `phase-6-a11y` captures from 2026-09-15 to 2026-09-16 fail 3 `button-name` checks (browse, browse cards, column panel), undiagnosed as of 2026-09-23. **Dialogs, upload, dark mode and the login page were never in that scan.** One remaining violation is upstream's.                                                                                                                                                                                                                                                             |
| **"How big is the bundle?"**                    | 3.56 MB initial against a 4 MB budget. adf-core registers eleven root services so it is eager — every user pays it, including users who never open an adf-hx route. A known constraint, not a surprise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **"Can I change the logo?"**                    | Yes, with no rebuild of the application: `branding.logo` in a bootstrap fragment names an asset the customer's configuration package contributes, served at `agentic-ui-config/assets/<name>`, and it replaces the Satori word mark in the header and the lockup on the login page. The logo is part of the customer's package, so an upgrade of ours leaves it alone by the same mechanism as their fragments; say the mechanism. It does not replace the navigation-rail mark or the expanded rail's "Content Innovation Cloud" title (hard-coded in Satori), and the favicon cannot be changed yet.                                                                       |
| **"Can I edit metadata in the adf-hx panel?"**  | No. Upstream does not export the cache service its editable sidebar needs, so the read-only properties panel renders instead. Upstream's to fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **"How do I know these screenshots are real?"** | Each one asserts its own content before the run is allowed to pass, all images are hashed so no two can be duplicates, and the run aborts if it is authenticated as the wrong user. That last check exists because a whole run once came back as `Anonymous` and every other check still passed.                                                                                                                                                                                                                                                                                                                                                                             |

---

## Before you present

1. `docker start nuxeo-opensearch && sleep 15 && docker start nuxeo`
2. Nothing else is required — **the deck is a file.** That is the point of it.
3. If you intend to go live afterwards, read Part 6 of `beta-demo-runbook.md` first. It lists what
   does not work, and it was re-verified against current code on 2026-09-01: twelve of thirteen
   entries hold, one was wrong and is withdrawn, one is right for a different reason than it stated.
