# Comprehensive Satori Component Usage Analysis

**Analysis Date:** 2026-10-26  
**Context:** NXSAT-673 Satori 1.0.0-alpha.171 migration  
**Scope:** Complete audit of Satori UI library adoption across the application

---

## Executive Summary

### Current Satori UI Adoption: Partial (13/32 components)

| Category            | Components Available | Currently Used | Adoption Rate |
| ------------------- | -------------------- | -------------- | ------------- |
| **Already Adopted** | 13                   | 13             | 100%          |
| **Could Adopt**     | 10                   | 0              | 0%            |
| **Not Applicable**  | 9                    | N/A            | N/A           |

### Key Findings

1. ✅ **Core navigation & layout components** are well-adopted (app-header, platform-nav, breadcrumbs)
2. ⚠️ **Mixed usage patterns** exist for avatars, tags, tooltips (using both Satori and alternatives)
3. 🔴 **High number of custom implementations** that could use Satori components
4. ✅ **Strategic decision** to wrap Satori in `nxs-*` components is working well

---

## Detailed Component Analysis

### Category 1: Already Adopted ✅ (13 components)

These Satori components are actively used in the application:

| Component      | Import                                   | Usage Count         | Wrapper                       | Notes                       |
| -------------- | ---------------------------------------- | ------------------- | ----------------------------- | --------------------------- |
| `app-header`   | `@hylandsoftware/satori-ui/app-header`   | Used in shell       | ✅ Native Satori              | App-level header            |
| `avatar`       | `@hylandsoftware/satori-ui/avatar`       | 10 instances        | ✅ `nxs-avatar` wrapper       | User/group avatars          |
| `banner`       | `@hylandsoftware/satori-ui/banner`       | 39 instances        | ✅ Native Satori              | Alert/info banners          |
| `breadcrumbs`  | `@hylandsoftware/satori-ui/breadcrumbs`  | Used                | ✅ `nxs-breadcrumbs` wrapper  | Migrated in NXSAT-673       |
| `empty-state`  | `@hylandsoftware/satori-ui/empty-state`  | 11 instances        | ✅ `nxs-empty-state` wrapper  | Empty page states           |
| `ghost`        | `@hylandsoftware/satori-ui/ghost`        | 9 instances         | ❌ Native only                | Loading skeletons           |
| `header-bar`   | `@hylandsoftware/satori-ui/header-bar`   | Used                | ✅ Native Satori              | Section headers             |
| `logo`         | `@hylandsoftware/satori-ui/logo`         | Used in shell       | ✅ Native Satori              | Nuxeo logo                  |
| `platform-nav` | `@hylandsoftware/satori-ui/platform-nav` | Used in shell       | ✅ Native Satori              | Main navigation             |
| `providers`    | `@hylandsoftware/satori-ui/providers`    | App root            | ✅ Native Satori              | Translation/theme providers |
| `rich-tooltip` | `@hylandsoftware/satori-ui/rich-tooltip` | 5 instances         | ✅ `nxs-rich-tooltip` wrapper | Enhanced tooltips           |
| `tag`          | `@hylandsoftware/satori-ui/tag`          | 0 direct, 9 nxs-tag | ✅ `nxs-tag` wrapper          | Label tags                  |
| `translations` | `@hylandsoftware/satori-ui/translations` | App root            | ✅ Native Satori              | i18n integration            |

**Verdict:** Core Satori components are well-integrated. The `nxs-*` wrapper pattern provides good abstraction.

---

### Category 2: Could Adopt (Opportunities) ⚠️ (10 components)

These Satori components exist but aren't being used. Analysis of whether they SHOULD be:

#### High-Value Opportunities 🎯

| Component                 | Use Case                | Current Alternative                   | Migration Value | Recommendation                          |
| ------------------------- | ----------------------- | ------------------------------------- | --------------- | --------------------------------------- |
| **action-bar**            | Bulk action toolbars    | Custom divs with buttons              | **High**        | ✅ Adopt for document-list bulk actions |
| **card-surface**          | Consistent card styling | Custom CSS classes                    | **Medium**      | ⚠️ Consider for new features            |
| **ghost** (expand usage)  | Loading skeletons       | Custom skeleton divs (78 instances)   | **High**        | ✅ Replace custom skeletons             |
| **upload / upload-field** | File upload UI          | Custom implementations (80 instances) | **High**        | ✅ Standardize uploads                  |

#### Medium-Value Opportunities 📊

| Component             | Use Case               | Current Alternative     | Migration Value | Recommendation              |
| --------------------- | ---------------------- | ----------------------- | --------------- | --------------------------- |
| **navigation-tabs**   | Tab navigation         | Custom or Material tabs | **Medium**      | ⚠️ Evaluate for consistency |
| **split-button**      | Dropdown actions       | Separate buttons + menu | **Low**         | ❌ Not a priority           |
| **tonal-icon-button** | Secondary icon buttons | `mat-icon-button`       | **Low**         | ❌ Material is fine         |

#### Low-Value / Not Applicable 🚫

| Component        | Reason Not to Adopt                                         |
| ---------------- | ----------------------------------------------------------- |
| **drag-drop**    | Already using Angular CDK drag-drop + custom `nxs-dropzone` |
| **icons**        | Already using custom icon registry with SVGs                |
| **illustration** | No use case for illustrations in current UI                 |

---

### Category 3: Not Applicable (Infrastructure) 🔧 (9 components)

These are either infrastructure components or already satisfied by Material/custom:

| Component               | Status                                  |
| ----------------------- | --------------------------------------- |
| `focus-indicator`       | Infrastructure - automatic via theme    |
| `important-button`      | Specialized - use when needed           |
| `inline-chip`           | Use `mat-chip` or `nxs-tag`             |
| `interactive-card`      | Use `card-surface` or custom            |
| `nested-scrollviews`    | Specialized layout - use when needed    |
| `splitter`              | No current use case for resizable panes |
| `table-with-row-states` | Analyzed separately - no current need   |

---

## Detailed Usage Breakdown

### 1. Empty States

**Current State:**

- ✅ Using `nxs-empty-state`: **11 instances**
- ❌ Custom empty divs: **108 instances**

**Analysis by Type:**

| Pattern                               | Count | Should Migrate?                                     |
| ------------------------------------- | ----- | --------------------------------------------------- |
| Table empty rows (`<td colspan="N">`) | ~60   | ❌ No - these are inline table states               |
| Widget empty states (dashboard)       | 4     | ⚠️ Maybe - simple text-only, wrapping adds overhead |
| Page-level empty states               | 11    | ✅ Already using `nxs-empty-state`                  |
| Tree/list empty states                | 8     | ⚠️ Consider - but simple divs work                  |

**Verdict:**

- **Keep using `nxs-empty-state` for page/section-level empty states** ✅
- **Don't migrate table empty rows** - `<td>` with message is semantic HTML
- **Don't migrate widget empty states** - simple `<div>` is lighter than component overhead

---

### 2. Loading States / Skeletons

**Current State:**

- ✅ Using `sat-ghost`: **9 instances** (mostly in AI features)
- ❌ Using `mat-spinner`/`mat-progress-spinner`: **100 instances**
- ❌ Custom skeleton divs: **78 instances**

**Analysis by Type:**

| Location                     | Current Implementation               | Should Use sat-ghost?                                 |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------- |
| **Dashboard AI cards**       | Custom `skeleton-bar` divs           | ✅ **Yes** - Replace with sat-ghost                   |
| **Knowledge Discovery**      | Custom `kd-answer__skeleton` lines   | ✅ **Yes** - Replace with sat-ghost                   |
| **Admin Audit AI banner**    | Custom `ai-skeleton-bar` divs        | ✅ **Yes** - Replace with sat-ghost                   |
| **Document-detail AI cards** | ✅ Already using `sat-ghost`         | ✅ Keep                                               |
| **Spinner for loading data** | `mat-spinner` in center of container | ❌ **No** - Spinners for indeterminate waits are fine |

**Verdict:**

- ✅ **Migrate custom skeleton bars to `sat-ghost`** (Dashboard, KD, Admin AI features)
- ✅ **Keep using `mat-spinner` for general loading indicators**
- 📊 **Estimated migration:** ~30 custom skeleton implementations → sat-ghost

---

### 3. Avatars

**Current State:**

- ✅ Using `nxs-avatar`: **5 instances**
- ✅ Using `sat-avatar` directly: **10 instances**
- ❌ Custom avatar divs: **12 instances**

**Analysis:**

```html
<!-- Good: Using wrapped component -->
<nxs-avatar [user]="user" size="32" />

<!-- Good: Direct Satori usage -->
<sat-avatar [name]="name" size="40" />

<!-- Bad: Custom implementation -->
<div class="user-avatar">
  <img [src]="avatarUrl" />
</div>
```

**Verdict:**

- ✅ **Standardize on `nxs-avatar` wrapper** for all avatar usage
- ⚠️ **Audit the 12 custom avatar divs** - likely legacy code that should migrate
- 📊 **Estimated migration:** 12 custom avatars → nxs-avatar

---

### 4. Tags / Chips / Badges

**Current State:**

- ✅ Using `nxs-tag`: **9 instances**
- ❌ Using `sat-tag` directly: **0 instances**
- ❌ Custom tag/chip/badge classes: **73 instances**

**Analysis by Type:**

| Pattern                               | Count | Should Use nxs-tag?                          |
| ------------------------------------- | ----- | -------------------------------------------- |
| Permission badges (Read, Write, etc.) | ~20   | ⚠️ Maybe - semantic tags, but custom styling |
| Status badges (Active, Pending, etc.) | ~15   | ✅ **Yes** - good candidate                  |
| Document type labels                  | ~10   | ❌ No - too specialized                      |
| Table cell labels                     | ~20   | ⚠️ Maybe - depends on styling needs          |
| Other custom badges                   | ~8    | ❌ No - custom styling required              |

**Verdict:**

- ✅ **Status badges are good candidates** for `nxs-tag`
- ⚠️ **Permission tags** could work but have specific theming
- ❌ **Most custom badges have specific styling** that `nxs-tag` doesn't support
- 📊 **Estimated migration:** ~15-20 status badges → nxs-tag

---

### 5. Banners / Alerts

**Current State:**

- ✅ Using `sat-banner`: **39 instances**
- ❌ Custom banner/alert divs: **75 instances**

**Analysis:**

| Type                           | Count | Should Use sat-banner?                    |
| ------------------------------ | ----- | ----------------------------------------- |
| AI Insights banner (dashboard) | 1     | ❌ No - highly custom design              |
| Widget error messages          | ~20   | ⚠️ Maybe - but inline errors, not banners |
| Form validation alerts         | ~15   | ❌ No - inline validation, not banners    |
| Info/warning banners           | 39    | ✅ **Already using sat-banner**           |
| Custom alert dialogs           | ~40   | ❌ No - use Material dialog               |

**Verdict:**

- ✅ **Already well-adopted** - 39 instances using `sat-banner`
- ❌ **Don't migrate inline errors/alerts** - banners are for page-level messages
- ✅ **Good usage pattern** - keep current approach

---

### 6. Upload / Dropzone

**Current State:**

- ✅ Using `nxs-dropzone`: **5 instances**
- ❌ Custom upload/drop implementations: **80 instances**

**Analysis:**

The 80 "custom" instances are likely:

- CSS classes containing "upload" or "drop" in names
- Not all are actual dropzone components
- Many are button labels, zone classes, queue items

**Actual dropzone components:**

```typescript
// Current wrapper
@Component({ selector: 'nxs-dropzone' })
export class NxsDropzoneComponent {
  // Wraps file input + drag/drop handling
}
```

**Verdict:**

- ✅ **`nxs-dropzone` wrapper is appropriate**
- ⚠️ **Check if Satori `upload`/`upload-field` components could replace wrapper**
- 📊 **Action:** Compare Satori upload vs nxs-dropzone features

---

### 7. Tooltips

**Current State:**

- ✅ Using `nxs-rich-tooltip`: **5 instances**
- ✅ Using `sat-rich-tooltip`: **5 instances**
- ❌ Using `matTooltip`: **146 instances in 35 files**

**Analysis:**

| Tooltip Type         | Count | Component          | Verdict                                   |
| -------------------- | ----- | ------------------ | ----------------------------------------- |
| Simple text tooltip  | 146   | `matTooltip`       | ✅ **Keep** - Material is fine for simple |
| Rich content tooltip | 5     | `nxs-rich-tooltip` | ✅ **Keep** - for HTML content            |
| Satori rich tooltip  | 5     | `sat-rich-tooltip` | ✅ **Keep** - direct usage OK             |

**Verdict:**

- ✅ **Current pattern is correct**
- `matTooltip` for simple text (fast, lightweight)
- `nxs-rich-tooltip` / `sat-rich-tooltip` for HTML content
- ❌ **Do NOT migrate 146 simple tooltips** - unnecessary overhead

---

## Migration Priorities & Recommendations

### Tier 1: High-Value Migrations 🎯 (Do These)

| Component      | Target                                           | Effort | User Benefit                     | Recommendation                |
| -------------- | ------------------------------------------------ | ------ | -------------------------------- | ----------------------------- |
| **sat-ghost**  | Replace custom skeletons in Dashboard, KD, Admin | Medium | **High** - Consistent loading UX | ✅ **Migrate ~30 instances**  |
| **nxs-avatar** | Standardize 12 custom avatar divs                | Low    | Medium - Visual consistency      | ✅ **Migrate custom avatars** |
| **nxs-tag**    | Status badges (15-20 instances)                  | Low    | Medium - Consistent theming      | ✅ **Migrate status badges**  |

**Estimated effort:** 2-3 developer days  
**Benefit:** Consistent UX, less custom CSS, easier theming

---

### Tier 2: Consider for New Features ⚠️ (Future Work)

| Component               | Use When                          | Don't Retrofit                |
| ----------------------- | --------------------------------- | ----------------------------- |
| **action-bar**          | Building new bulk action toolbars | Existing toolbars work fine   |
| **card-surface**        | New card-based layouts            | Existing cards use custom CSS |
| **navigation-tabs**     | New tabbed interfaces             | Existing tabs are functional  |
| **upload/upload-field** | New upload flows                  | nxs-dropzone is established   |

**Verdict:** Adopt incrementally as new features require these patterns.

---

### Tier 3: Do Not Migrate ❌ (Keep Current)

| Pattern                | Current Solution             | Why Not Migrate                             |
| ---------------------- | ---------------------------- | ------------------------------------------- |
| **Table empty rows**   | `<td colspan="N">`           | Semantic HTML, no benefit                   |
| **Simple empty divs**  | `<div class="widget-empty">` | Component overhead not worth it             |
| **Simple tooltips**    | `matTooltip`                 | Material is perfect for text tooltips       |
| **Spinners**           | `mat-spinner`                | Satori doesn't provide spinner alternative  |
| **Most custom badges** | CSS classes                  | Specific styling, tag component too generic |
| **Inline errors**      | Custom divs                  | Not banners, different semantic meaning     |

---

## Gaps in Satori UI Library

### What Satori Doesn't Provide (That We Need)

| Need                 | Current Solution           | Satori Alternative                                                   |
| -------------------- | -------------------------- | -------------------------------------------------------------------- |
| **Data tables**      | `mat-table`                | Only provides `SatTableWithRowStates` (enhancement, not replacement) |
| **Form controls**    | Material form fields       | None                                                                 |
| **Dialogs**          | Material dialogs           | None                                                                 |
| **Spinners**         | `mat-spinner`              | None (only ghost/skeleton)                                           |
| **Menus**            | Material menu              | None                                                                 |
| **Date pickers**     | Material datepicker        | None                                                                 |
| **Tree view**        | Custom `nxs-document-tree` | None                                                                 |
| **Toasts/Snackbars** | Custom `nxs-toast`         | None                                                                 |

**Verdict:** Material UI + custom `nxs-*` components will remain core alongside Satori.

---

## Recommendations for NXSAT-673 PR

### In Scope ✅ (Already Done)

- ✅ Breadcrumbs API migration
- ✅ Platform nav API migration
- ✅ Translation provider migration
- ✅ All breaking changes from Satori 0.4 → 1.0

### Out of Scope for This PR ❌ (Deferred)

As stated in PR description:

> **Deferred to follow-up PRs:**
>
> - New Satori component adoption (empty-state, ghost, action-bar, etc.)

**Rationale:** This PR is about **fixing breaking changes**, not **expanding Satori adoption**.

---

## Follow-Up Work Items

### Immediate Next Steps (Post-NXSAT-673)

1. **NXSAT-XXX: Standardize Loading Skeletons**
   - Replace custom skeleton divs with `sat-ghost`
   - Target: Dashboard, Knowledge Discovery, Admin Audit
   - Effort: 1-2 days

2. **NXSAT-XXX: Standardize Avatars**
   - Audit 12 custom avatar implementations
   - Migrate to `nxs-avatar`
   - Effort: 0.5 day

3. **NXSAT-XXX: Standardize Status Badges**
   - Identify 15-20 status badge instances
   - Migrate to `nxs-tag`
   - Effort: 1 day

### Future Enhancements

- Evaluate `action-bar` for document-list bulk actions
- Consider `card-surface` for new card-based layouts
- Monitor Satori releases for new components (table, form controls, etc.)

---

## Architectural Guidelines

### When to Use Satori vs Alternatives

| Use Case            | Use                                      | Don't Use     |
| ------------------- | ---------------------------------------- | ------------- |
| **Navigation**      | Satori (platform-nav, breadcrumbs)       | ✅            |
| **Layout**          | Satori (app-header, header-bar)          | ✅            |
| **Content display** | Satori (avatar, tag, empty-state, ghost) | ✅            |
| **Data tables**     | Material (`mat-table`)                   | ❌ Not Satori |
| **Forms**           | Material form controls                   | ❌ Not Satori |
| **Dialogs**         | Material dialogs                         | ❌ Not Satori |
| **Simple tooltips** | Material (`matTooltip`)                  | ❌ Not Satori |
| **Rich tooltips**   | Satori (`rich-tooltip`)                  | ✅            |

### Wrapper Strategy

**✅ Create `nxs-*` wrappers when:**

- Component needs Nuxeo-specific logic (e.g., `nxs-avatar` with user service integration)
- Want to abstract Satori version changes
- Need to add application-specific defaults

**❌ Don't create wrappers when:**

- Satori component is configuration-only (e.g., `sat-banner`)
- No additional logic needed
- Direct usage is clearer

---

## Conclusion

### Summary

- ✅ **Core Satori adoption is strong** (13/32 components actively used)
- ⚠️ **Opportunities exist** to replace ~30-40 custom implementations
- ❌ **Many "custom" patterns are appropriate** (table empties, simple divs, Material components)
- 🎯 **Focus migrations** on high-value consistency wins (skeletons, avatars, status badges)

### For NXSAT-673 PR

**This PR is correctly scoped.** New component adoption is explicitly deferred and should be handled in dedicated follow-up tickets.

### Architectural Health

The codebase demonstrates good judgment:

- Using Satori for layout/navigation/branding
- Using Material for data-heavy components (tables, forms)
- Using custom components where neither Satori nor Material fits
- Not over-engineering simple patterns

**Rating: 8/10** - Room for standardization, but fundamentally sound architecture.
