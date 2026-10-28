import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';

type DatepickerLabel = Exclude<
  keyof MatDatepickerIntl,
  'changes' | 'formatYearRange' | 'formatYearRangeLabel'
>;

const LABEL_KEYS: Record<DatepickerLabel, string> = {
  calendarLabel: 'shared-ui.datepicker.calendar',
  openCalendarLabel: 'shared-ui.datepicker.open-calendar',
  closeCalendarLabel: 'shared-ui.datepicker.close-calendar',
  prevMonthLabel: 'shared-ui.datepicker.previous-month',
  nextMonthLabel: 'shared-ui.datepicker.next-month',
  prevYearLabel: 'shared-ui.datepicker.previous-year',
  nextYearLabel: 'shared-ui.datepicker.next-year',
  prevMultiYearLabel: 'shared-ui.datepicker.previous-24-years',
  nextMultiYearLabel: 'shared-ui.datepicker.next-24-years',
  switchToMonthViewLabel: 'shared-ui.datepicker.choose-date',
  switchToMultiYearViewLabel: 'shared-ui.datepicker.choose-month-and-year',
  startDateLabel: 'shared-ui.datepicker.start-date',
  endDateLabel: 'shared-ui.datepicker.end-date',
  comparisonDateLabel: 'shared-ui.datepicker.comparison-range',
};

/**
 * Angular Material's date picker labels, from our catalogue.
 *
 * Material ships its own English strings — "Open calendar", "Next month" — and they stayed English
 * in every locale. Re-read on every language or catalogue change and announced through `changes`,
 * which is how Material's picker knows to re-render. A key the catalogue does not supply keeps
 * Material's English rather than showing the key.
 *
 * The date input provides this on its own injector: Material's datepicker module otherwise
 * shadows a root override with its English instance. Older screens can still use the UI entry
 * point's `provideTranslatedDatepickerIntl()`, which delegates to this implementation.
 */
@Injectable()
export class TranslatedDatepickerIntl extends MatDatepickerIntl {
  private readonly translate = inject(TranslateService);
  private readonly englishDefaults = Object.fromEntries(
    (Object.keys(LABEL_KEYS) as DatepickerLabel[]).map((field) => [field, this[field]]),
  ) as Record<DatepickerLabel, string>;

  constructor() {
    super();
    this.refresh();
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());
  }

  override formatYearRange(start: string, end: string): string {
    return this.resolve('shared-ui.datepicker.year-range', super.formatYearRange(start, end), {
      start,
      end,
    });
  }

  override formatYearRangeLabel(start: string, end: string): string {
    return this.resolve(
      'shared-ui.datepicker.year-range-label',
      super.formatYearRangeLabel(start, end),
      {
        start,
        end,
      },
    );
  }

  private refresh(): void {
    for (const field of Object.keys(LABEL_KEYS) as DatepickerLabel[]) {
      this[field] = this.resolve(LABEL_KEYS[field], this.englishDefaults[field]);
    }
    this.changes.next();
  }

  private resolve(key: string, fallback: string, params?: Record<string, string>): string {
    const value = this.translate.instant(key, params);
    return typeof value === 'string' && value !== key ? value : fallback;
  }
}
