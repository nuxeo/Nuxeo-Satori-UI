# Table Usage Analysis - Satori Migration

Analysis date: 2026-10-26
Context: NXSAT-673 Satori 1.0.0-alpha.171 migration

## Summary

**Total tables found:** 25 files with `<table>` elements
**Current Satori table usage:** 0 instances of `SatTableWithRowStates`

### Distribution

| Type                             | Count | Purpose                                       |
| -------------------------------- | ----- | --------------------------------------------- |
| **mat-table** (Angular Material) | 14    | Interactive tables with sorting, dynamic data |
| **Plain HTML table**             | 11    | Read-only display, simple data presentation   |
| **Satori table enhancement**     | 0     | None currently using `SatTableWithRowStates`  |

## Verdict: All Tables Are Appropriately Implemented ✅

No migrations needed. The current architecture follows best practices:

- Interactive, sortable tables → `mat-table`
- Read-only, simple display → plain HTML `<table>`

---

## Detailed Analysis

### Category 1: mat-table (Interactive Tables) — 14 Files

These correctly use Angular Material's `mat-table` for interactive features:

#### Admin Pages (9 files)

| File                                       | Features                | Verdict    |
| ------------------------------------------ | ----------------------- | ---------- |
| `admin-audit-page.component.html`          | Sortable audit log      | ✅ Correct |
| `admin-group-details-page.component.html`  | Members/subgroups lists | ✅ Correct |
| `admin-nxql-search-page.component.html`    | Search results          | ✅ Correct |
| `admin-user-details-page.component.html`   | Groups + permissions    | ✅ Correct |
| `admin-analytics-page.component.html`      | Doc types + repo stats  | ✅ Correct |
| `admin-users-groups-page.component.html`   | Recent + search results | ✅ Correct |
| `admin-cloud-services-page.component.html` | Cloud providers list    | ✅ Correct |
| `admin-vocabularies-page.component.html`   | Vocabulary entries      | ✅ Correct |

**Analysis:** All admin tables need `mat-table` for sorting, filtering, and dynamic data binding.

#### Satori Components (3 files)

| File                                  | Features                           | Candidate for SatTableWithRowStates?                  |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `satori-components/document-list`     | Selection, sorting, row actions    | **Already optimal** — custom selection implementation |
| `satori-components/permissions-panel` | Inline editing, dropdowns in cells | ❌ No — editing pattern incompatible                  |
| `satori-components/document-history`  | Sortable version history           | ❌ No — read-only with sort only                      |

**SatTableWithRowStates Analysis:**

- **document-list**: Already has sophisticated selection with `MatCheckbox`, custom keyboard nav, and row-level actions. Adding `SatTableWithRowStates` would conflict with existing patterns (227 lines of custom logic).
- **permissions-panel**: Has `mat-select` dropdowns inside cells for editing permissions. `SatTableWithRowStates` is for row-level selection/actions, not cell-level editing.
- **document-history**: Read-only table with `matSort` only. No selection or row actions → no benefit from `SatTableWithRowStates`.

#### Browse & Collections (2 files)

| File                                       | Features                    | Verdict    |
| ------------------------------------------ | --------------------------- | ---------- |
| `browse/browse.html`                       | Document history (sortable) | ✅ Correct |
| `collection-detail/collection-detail.html` | Audit log (sortable)        | ✅ Correct |

---

### Category 2: Plain HTML Tables (Read-only Display) — 11 Files

These correctly use plain HTML for simple, read-only data:

#### Settings Pages (4 files)

| File                                                   | Data Shown           | Has Actions?                             | Verdict                            |
| ------------------------------------------------------ | -------------------- | ---------------------------------------- | ---------------------------------- |
| `settings/profile/profile-page.component.html`         | Groups + permissions | ❌ No                                    | ✅ Correct (read-only)             |
| `settings/authorized-applications-page.component.html` | OAuth apps           | ✅ Yes (revoke button outside table)     | ✅ Correct (actions not row-level) |
| `settings/cloud-services-page.component.html`          | Connected accounts   | ✅ Yes (disconnect button outside table) | ✅ Correct                         |
| `settings/nuxeo-drive/nuxeo-drive-page.component.html` | Sync roots + tokens  | ❌ No                                    | ✅ Correct                         |

**Pattern:** Settings pages show configuration data. Actions are card-level buttons, not row-specific → plain HTML is appropriate.

#### Dashboard (1 file)

| File                                      | Data Shown   | Interaction                         | Verdict    |
| ----------------------------------------- | ------------ | ----------------------------------- | ---------- |
| `dashboard/dashboard-page.component.html` | Recent edits | `(click)` on entire row to navigate | ✅ Correct |

**Analysis:** Two tables showing recent/viewed documents with simple click-to-navigate. No selection/sorting needed → plain HTML appropriate.

#### Document Detail (1 file)

| File                                   | Table Type                 | Has Actions?                      | Verdict                      |
| -------------------------------------- | -------------------------- | --------------------------------- | ---------------------------- |
| `document-detail/document-detail.html` | Permissions (perm-table)   | ✅ Yes (edit/send/delete per row) | ⚠️ **CANDIDATE** (see below) |
| `document-detail/document-detail.html` | Publishing (publish-table) | ❌ No                             | ✅ Correct                   |

**⚠️ Permissions Table in document-detail:**

```html
<table class="perm-table">
  <!-- Shows external ACEs with 3 action buttons per row -->
  <td class="perm-row-actions">
    <button mat-icon-button (click)="editExternalPermission(ace)">...</button>
    <button mat-icon-button (click)="sendPermissionNotification(ace)">...</button>
    <button mat-icon-button (click)="deletePermission(ace)">...</button>
  </td>
</table>
```

**Migration consideration:** This table has row-level actions but uses plain HTML. However:

- Not using selection checkboxes
- Actions are explicit buttons, not click-on-row
- Current implementation is functional and tested
- **Recommendation:** Keep as-is. Migrating to `mat-table` would be refactoring without user benefit.

#### Shared Components (3 files)

| File                                       | Data Shown                    | Verdict                                  |
| ------------------------------------------ | ----------------------------- | ---------------------------------------- |
| `share-saved-search-dialog.component.html` | Local + inherited permissions | ✅ Correct (has actions, but functional) |
| `delete-permission-dialog` (2 files)       | Confirmation display          | ✅ Correct (dialog content)              |
| `drive-dialog.component.html`              | Sync roots                    | ✅ Correct                               |

#### Template/Demo Pages (2 files)

| File                                   | Purpose   | Verdict    |
| -------------------------------------- | --------- | ---------- |
| `nuxeo-satori-template/search.html`    | Demo page | ✅ Correct |
| `nuxeo-satori-template/documents.html` | Demo page | ✅ Correct |

---

## Recommendations

### 1. ✅ No Migrations Required

Every table in the application is using the appropriate pattern for its use case:

- **Interactive → mat-table** (sorting, filtering, dynamic data)
- **Read-only → plain HTML** (simple display, no features)

### 2. ⚠️ Do NOT Add SatTableWithRowStates

`SatTableWithRowStates` is designed for:

- Multi-select with checkboxes
- Keyboard navigation between rows (ArrowUp/Down)
- Row-level hover/active/selected states

**Current tables don't need these features:**

- Admin tables: Sorting only, no selection
- Document-list: Already has custom selection (adding Satori would be redundant)
- Permissions tables: Cell-level editing, not row selection
- Read-only tables: No interaction at all

### 3. 🎯 When to Consider SatTableWithRowStates in Future

Add it only when building a NEW component that needs:

1. Multi-select with checkboxes on each row
2. Bulk actions on selected rows
3. Keyboard navigation between rows
4. Consistent Satori hover/focus states

**Example use case:** A "Bulk document manager" where users select multiple documents and apply actions.

### 4. 📊 Migration Scope for NXSAT-673

**Current PR scope (NXSAT-673):** Fix breaking API changes in Satori 1.0

- Nav component API changes ✅
- Breadcrumbs API changes ✅
- Translation provider changes ✅

**Out of scope:** Adopting new Satori components

- Table enhancements → deferred
- Empty-state, ghost, action-bar → deferred (per PR description)

---

## Conclusion

**All 25 tables are correctly implemented.** No changes needed for this PR or future work.

The architecture follows the principle: **Use the simplest tool that meets requirements.**

- Simple display → HTML `<table>`
- Sorting/filtering → `mat-table`
- Selection + actions → `mat-table` + custom logic OR `SatTableWithRowStates` (when appropriate)

The codebase demonstrates good judgment in not over-engineering read-only displays with framework abstractions.
