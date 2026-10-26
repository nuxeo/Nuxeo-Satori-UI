/**
 * NXSAT-628 — the History tab's Date column must follow the active locale.
 *
 * The regression: the column was bound as
 * `{{ entry.eventDate | date: ('document-detail.mmmm-d-yyyy' | translate) }}`, taking its
 * `DatePipe` format from the translation catalogue. Angular's `M`, `d` and `y` are
 * locale-INDEPENDENT tokens, so a French user got the English field order with a French
 * month name — `octobre 12, 2026` — and the translation crew was billed to translate a
 * format string that could not localize anything.
 *
 * This test reads the format out of the real template and renders with it, rather than
 * matching the template text. A string match would pass on any named format, including a
 * wrong one; what has to hold is that the Date column actually produces French order in
 * French and leaves English untouched.
 */
import { formatDate, registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/** The History tab is `nxs-document-history`; its table is the template that formats the date. */
const templatePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../shared/satori-components/src/lib/document-history/document-history.component.html',
);

/** The `date:` argument on the History table's `eventDate` cell, exactly as the template has it. */
function eventDateFormatExpression(): string {
  const template = readFileSync(templatePath, 'utf8');
  const column = template.match(
    /<ng-container matColumnDef="eventDate">[\s\S]*?<\/ng-container>/,
  )?.[0];
  expect(column, 'the History table still has an eventDate column').toBeTruthy();

  const binding = column!.match(/\|\s*date:\s*([^}]+?)\s*\}\}/)?.[1];
  expect(binding, 'the eventDate cell still formats through DatePipe').toBeTruthy();
  return binding!.trim();
}

describe('Document detail History date column locale (NXSAT-628)', () => {
  beforeAll(() => {
    registerLocaleData(localeFr, 'fr');
  });

  it('takes its DatePipe format from Angular, not from the translation catalogue', () => {
    const expression = eventDateFormatExpression();

    expect(
      expression,
      'the format must not be routed through `translate` — its tokens are the same in every language',
    ).not.toMatch(/\|\s*translate/);
    expect(expression, 'the format must be a quoted literal').toMatch(/^'[a-zA-Z]+'$/);
  });

  it('renders day and time in French order in French and in English order in English', () => {
    const format = eventDateFormatExpression().replace(/^'|'$/g, '');
    const when = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));

    // French puts the day first. The defect rendered the English order with a French month.
    expect(formatDate(when, format, 'fr', 'UTC')).toBe('12 oct. 2026, 12:00:00');

    // An audit entry needs its time as well as its day, as Web UI's audit table shows it.
    // Angular 21's CLDR data separates the time from AM/PM with a narrow no-break space.
    expect(formatDate(when, format, 'en-US', 'UTC')).toBe('Oct 12, 2026, 12:00:00 PM');
  });
});
