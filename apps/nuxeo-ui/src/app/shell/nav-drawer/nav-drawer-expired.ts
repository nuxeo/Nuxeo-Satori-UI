import { formatDate } from '@angular/common';

/**
 * The Expired queue's label for a document's `dc:expired`, in the locale.
 *
 * **Formatted in UTC** (NXSAT-727). `dc:expired` is a calendar day a user picked, stored at UTC
 * midnight, so it names that day in every zone — the layout `date` renderer, the Properties
 * panel's Expires row, `formatCompareDate` and the ACE formatters all read it that way, and
 * `docs/extension-reference.md` publishes it as the field type's contract. Formatting it in the
 * browser's zone made this queue read "Mar 5" for a document whose Properties panel said March 6,
 * for every user west of Greenwich.
 *
 * A free function beside `drawerDueKey`, rather than a method, so the zone handling is testable
 * without standing up the drawer and all of its services — which is also why the drawer's due
 * fragment lives in `nav-drawer-due.ts`.
 */
export function drawerExpiredLabel(expired: unknown, locale: string): string {
  if (typeof expired !== 'string' || expired === '') return '';
  const instant = new Date(expired);
  if (Number.isNaN(instant.getTime())) return '';
  return formatDate(instant, 'mediumDate', locale, 'UTC');
}
