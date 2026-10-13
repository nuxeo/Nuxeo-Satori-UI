/**
 * NXSAT-628 — the History tab's Date column must follow the active locale.
 *
 * The regression: the column was bound as
 * `{{ entry.eventDate | date: ('collections.mmmm-d-yyyy' | translate) }}`, taking its
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

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'collection-detail.html');

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

describe('Collection detail History date column locale (NXSAT-628)', () => {
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

  it('renders the French long date in French and the en-US long date in English', () => {
    const format = eventDateFormatExpression().replace(/^'|'$/g, '');
    const when = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));

    // French puts the day first and uses no comma. The defect rendered `octobre 12, 2026`.
    expect(formatDate(when, format, 'fr', 'UTC')).toBe('12 octobre 2026');

    // The English rendering is unchanged by the fix — `longDate` is en-US's `MMMM d, y`,
    // which is what the deleted catalogue value spelled out by hand.
    expect(formatDate(when, format, 'en-US', 'UTC')).toBe('October 12, 2026');
  });
});
