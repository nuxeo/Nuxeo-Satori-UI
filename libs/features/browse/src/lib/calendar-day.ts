/**
 * Converting between an `nxs-date-input`'s calendar day and the instant a Nuxeo date property
 * holds, for the dialogs in this library that edit `dc:expired` (NXSAT-727).
 *
 * **A calendar day is anchored in UTC.** Nuxeo stores a day-only write (`2024-03-06`) at midnight
 * of the server's day, read back as `2024-03-06T00:00:00.000Z`; the layout `date` renderer and the
 * Properties panel's Expires row both format in UTC, and `docs/extension-reference.md` publishes
 * that as the field type's contract. Calling `toISOString()` on the picker's `Date` instead anchors
 * the day in the editor's own zone, so the same picked day becomes a different instant per user and
 * every reader outside that zone can name a different day.
 *
 * `nxs-metadata-editor` does this at its own property boundary, in
 * `satori-components/metadata-editor/metadata-editor-form.ts`. It is repeated here rather than
 * shared because a shared home reachable from both this library and `shared/ui` means exporting it
 * from the published platform API, which is a decision for a human and not for a bug fix. If that
 * is agreed, these two copies and the editor's should collapse into it.
 *
 * `AGENTS/08-bug-patterns.md` pattern 28 has the full rule and the test traps.
 */

/** The UTC calendar day of `iso`, as a JS `Date` at local midnight for an `nxs-date-input`. */
export function calendarDayOf(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth();
  const day = instant.getUTCDate();
  const local = new Date(year, month, day);
  // `new Date` reads a year below 100 as 19xx.
  local.setFullYear(year, month, day);
  return local;
}

/** The calendar day `local` names, as the ISO 8601 instant at its UTC midnight. */
export function utcMidnightOf(local: Date | null | undefined): string | null {
  if (!local || Number.isNaN(local.getTime())) return null;
  const year = local.getFullYear();
  const month = local.getMonth();
  const day = local.getDate();
  const instant = new Date(Date.UTC(year, month, day));
  // `Date.UTC` reads a year below 100 as 19xx, for the same reason `new Date` does.
  instant.setUTCFullYear(year, month, day);
  return instant.toISOString();
}

/**
 * The value to write for an expiry the user may not have touched: the instant the read returned
 * when `local` still names the day that instant names, otherwise that day's UTC midnight.
 *
 * Without this, saving a title change rewrites an untouched `2027-12-31T20:00:00.000Z` to
 * `2027-12-31T00:00:00.000Z` — the right day, but the value moved by 20 hours for an edit that
 * never went near it. `docs/api-integrations.md` records the same defect measured on ACE dates,
 * where a permission-only edit moved a CET entry's start by 23 hours, and `dateToWrite` in
 * `permissions-model.ts` is the same rule for those. `nxs-metadata-editor` applies it through the
 * instant it remembers per control.
 */
export function instantToWrite(
  local: Date | null | undefined,
  original: string | null | undefined,
): string | null {
  const picked = utcMidnightOf(local);
  const originalDay = calendarDayOf(original);
  if (!picked || !originalDay || !local) return picked;
  const unchanged =
    originalDay.getFullYear() === local.getFullYear() &&
    originalDay.getMonth() === local.getMonth() &&
    originalDay.getDate() === local.getDate();
  return unchanged ? (original as string) : picked;
}
