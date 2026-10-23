---
title: Use Cases & Journeys
parent: Product
order: 4
last_reviewed: 2026-08-24
repo_commit: 77265f9
audience: product
---

# Use Cases & Customer Journeys

> **Last reviewed:** 2026-08-24 · **Repository:** `77265f9`
> Journeys are traced through **code paths that exist**. Where a step depends on something
> absent, it says so. No journey here has been walked by a real customer.

---

## Journey 1 — Knowledge worker finds and works with a document

```text
Problem:        "I need last quarter's signed contract for Acme."
Entry point:    /#/search  or  /#/browse
User action:    Types a term, or navigates the folder tree
System:         SearchService → NXQL (literals escaped) → Nuxeo → OpenSearch
                Aggregations render as filters; 12 configurable columns
User action:    Opens the document
System:         DocumentDetailService fetches properties, ACLs, versions, audit
                Preview renders inline; ARender for rich formats
Result:         Metadata, versions, permissions, history, comments in one surface
Benefit:        Answer found without leaving the UI or learning NXQL
```

**Where it is weak:** `search` sits at 22.8% line coverage and `document-detail` at 29.8% —
the two surfaces this journey depends on are the least tested in the repository. And
`AI.NlToNxql`, which would remove the filter-thinking entirely, has **no backend here**.

---

## Journey 2 — Contributor bulk-imports and corrects metadata

```text
Problem:        "300 scanned invoices need to be in the right folder with the right metadata."
Entry point:    /#/browse → Create / Import
User action:    Drag-and-drop; sets shared properties for the batch
System:         DocumentImportService (1,054 lines) stages a batch, creates documents,
                applies properties; progress reported per file
User action:    Multi-selects rows, applies a bulk action
System:         SelectionService tracks ids; bulk-actions slot resolves the action set
User action:    Fixes a mistake
System:         Trash with filters and restore
Result:         Content in place, recoverable
Benefit:        Batch work is batch-shaped, not 300 single operations
```

**A limitation worth knowing:** the rule context carries selection **ids**, not documents, so
`canWriteSelection` and `canRemoveSelection` answer `false`. Bulk actions cannot yet be
manifest-gated on permissions.

---

## Journey 3 — Administrator grants access and is audited

```text
Problem:        "Legal need read access to this workspace, and I must be able to prove who did."
Entry point:    Document detail → Permissions tab
User action:    Adds a permission for a group, with a notification email
System:         PrincipalPermissionsService writes the ACE; Nuxeo sends notification
                (Mailpit locally); the audit log records it
User action:    Later, History tab
System:         Audit entries with event labels
Result:         Access granted, recorded, reversible
Benefit:        The permission trail is Nuxeo's, so it inherits existing compliance posture
```

**The important framing for this persona:** the UI decides what is _offered_; **Nuxeo's ACLs
decide what is permitted**. Hiding an action in a manifest is not a security control. Three
security-relevant rules therefore **fail closed** — an unregistered
`app.rules.hasAdministrationAccess` denies rather than permits, because the dangerous window
is exactly the one before registration happens.

---

## Journey 4 — Customer rebrands, with no code and no rebuild

**The journey the product thesis rests on.** Layer 0.

```text
Problem:        "It must look like our product, not like Nuxeo."
Entry point:    a bootstrap fragment in their own Marketplace package (NXSAT-312)
User action:    Sets branding, defaultThemeId, themes[].tokens, availableLanguages
System:         the configuration servlet serves it after our defaults; AppConfigService
                loads it BEFORE authentication; TemplateThemeService writes tokens onto
                <html> as CSS custom properties
Result:         Rebranded application. No build. No deployment of ours.
On upgrade:     our package and theirs are separate, so upgrading ours leaves their
                fragment in force (rehearsed on a real server, NXSAT-312)
Benefit:        Rebranding is a config change, not an engagement
```

Evidence: `phase-1-config`. The upgrade-survival half is asserted by `npm run beta:upgrade` for
the npm package, and was rehearsed for the marketplace package with `nuxeoctl mp-install` in
NXSAT-312 (upgrading ours with a customer configuration package installed).

**Verified caveat:** an earlier version of this installed to `nxserver/web/…`, which is not a
Tomcat docBase, so it **would have 404'd on every install** — and it was recorded complete
before that was caught. The current path is correct and the reasoning is recorded at the code.

---

## Journey 5 — Customer reconfigures the addressable surface, still no rebuild

Layer 1.

```text
Problem:        "Hide Reports. Rename Home to Dashboard. Add a Contracts entry."
Entry point:    A manifest fragment in their configuration package (NXSAT-312)
User action:    Edits JSON:
                  overrides: { "template.navbar.reports": { "visible": false },
                               "template.navbar.home": { "label": "Dashboard", "order": 5 } }
                  slots:     { "navbar": [ { "id": "acme.navbar.contracts", ... } ] }
System:         The server serves the fragment after ours; registries merge manifest with code
Result:         Changed navigation. No build. Versioned with their package.
Benefit:        An upgrade of ours leaves their configuration in force
```

Evidence: `phase-2-registry`, 46 checks.

**The sharp edge:** the manifest is JSON and **nothing type-checks JSON**. If a platform
upgrade renamed a slot, every manifest naming it would go quietly inert — app boots, compiles,
entry gone. That is precisely what `beta:upgrade`'s slot-existence check exists to catch, and
it is demonstrably the only check that would: `--break-slot toolbar` leaves the compile green
and only that assertion red.

---

## Journey 6 — Customer developer adds a real feature

Layer 2, with Layer 3 assistance.

```text
Problem:        "Add a contract-approval action, visible only to users who can write the
                 document, plus a tab showing approval history."
Step 1:  Fork apps/nuxeo-satori-template (ships no design system — add yours)
Step 2:  npx nx g @nuxeo/satori-platform:extension-library acme-extensions --owner=acme
Step 3:  npx nx g @nuxeo/satori-platform:extension-action  approve-contract --library=...
Step 4:  Implement the handler and the rule
Step 5:  node node_modules/@nuxeo/satori-platform/guardrails/check-extension-library.mjs libs/acme-extensions
Step 6:  Add the route for the panel — ExtensionOutletComponent resolves it BY ID
Step 7:  providers: [ ..., provideAcmeExtensions() ]     ← the whole integration
Step 8:  Reference the action id from their manifest
Result:  A new capability, in THEIR repo, against a versioned API
Benefit: Their support boundary. Our upgrades are a version bump.
```

Evidence: `phase-4-platform` 25 checks, `phase-5-harness` 27 checks. Verified from the
tarball, not the source tree.

**Two things a customer will hit:**

- **Step 6 is not optional.** The generator registers a navbar entry pointing at
  `/<library-name>`, and **registering a path does not create a route**. Until the app maps it,
  the entry falls through the wildcard and lands on the wrong page. This happened in the
  reference application and shipped for two commits. The generator now prints the required
  route snippet and the generated README documents it.
- **Assert `false`, not `true`.** An _unregistered_ rule ID also evaluates to `true`.

---

## Journey 7 — Customer upgrades

```text
Problem:        "A new Satori version is out. Will it break what we built?"
Step 1:  npm version bump of @nuxeo/satori-platform
Step 2:  Reinstall the marketplace package
System:  install.xml — app overwritten; no configuration file installed or replaced
         Their bootstrap and manifest fragments stay in their own configuration
         package, which upgrading ours does not touch (rehearsed, NXSAT-312)
         Their Layer 2 library compiles against the new published types
Result:  Customisation intact
Benefit: The upgrade promise is TESTED, not asserted
```

What `npm run beta:upgrade` actually asserts, on every run:

1. All 21 staged customer files byte-identical after the upgrade.
2. The customer app compiles against the new version, resolved through the unpacked
   `exports` map.
3. **Every slot the JSON manifest names still exists in the upgraded package.**
4. The customer imports only published entry points — no deep paths into internals.

**Honest limit:** the two versions in that rehearsal differ only in their version string,
because inventing API changes would be testing the invention. Sensitivity comes from the
negative control instead. It proves the _mechanism_, not that any future upgrade is safe.

---

## Journey 8 — What a customer cannot do today

| Want                                                 | Status                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Install from a registry                              | `private: true`. Scope decided, publishing deferred                                    |
| Use the AI features                                  | Need a **separate backend package**                                                    |
| Place an action on the document toolbar via manifest | `toolbar` is **reserved** — nothing reads it. Same for `contextMenu`, `tabs`, `routes` |
| Gate a bulk action on write permission               | `selection` rule context is empty                                                      |
| Meet an accessibility procurement requirement        | WCAG 2.1 AA **met** on 15 scanned cases; scope stated                                  |
| Configure Layer 0/1 through a UI                     | Text editing of JSON only                                                              |
| Migrate a customised Web UI                          | **Not verified in repository** — nothing addresses it                                  |
