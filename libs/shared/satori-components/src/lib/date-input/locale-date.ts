import { Injectable, inject, type Provider } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DateAdapter,
  MAT_DATE_FORMATS,
  MAT_NATIVE_DATE_FORMATS,
  NativeDateAdapter,
  type MatDateFormats,
} from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';

/** The Unicode decimal digit ranges a user may type a date in, by their zero. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0xff10];

/** Each non-ASCII decimal digit typed, as its ASCII digit: `２０２６` and `٢٠٢٦` read `2026`. */
function asciiDigits(text: string): string {
  return text.replace(
    /[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u09e6-\u09ef\u0e50-\u0e59\uff10-\uff19]/g,
    (digit) => {
      const code = digit.charCodeAt(0);
      const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9) ?? code;
      return String(code - zero);
    },
  );
}

/** A locale id from what `MAT_DATE_LOCALE` holds: an id, or a date library's locale with a `code`. */
export function nxsLocaleId(locale: unknown, fallback = 'en-US'): string {
  if (typeof locale === 'string' && locale.trim()) return locale.trim();
  if (locale && typeof locale === 'object' && 'code' in locale && typeof locale.code === 'string') {
    return locale.code;
  }
  return fallback;
}

/**
 * The locale with the Gregorian calendar. `Intl` gives Thai the Buddhist calendar, 543 years ahead,
 * and every other date in the application is Gregorian; a year the field shows and the parser reads
 * differently would also not survive being typed back.
 */
function gregorian(locale: string): string {
  try {
    return new Intl.Locale(locale, { calendar: 'gregory' }).toString();
  } catch {
    return 'en-US';
  }
}

/** The order the locale writes a date's numeric fields in, such as `['day', 'month', 'year']`. */
export function nxsDateFieldOrder(locale: string): ('year' | 'month' | 'day')[] {
  const order = new Intl.DateTimeFormat(gregorian(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  })
    .formatToParts(new Date(Date.UTC(2026, 11, 31)))
    .map((part) => part.type)
    .filter((type): type is 'year' | 'month' | 'day' => ['year', 'month', 'day'].includes(type));
  return order.length === 3 ? order : ['month', 'day', 'year'];
}

/** The month a word names, 1 to 12, in the locale or in English, by its first three letters. */
function monthNamed(word: string, locale: string): number | null {
  const fold = (text: string) =>
    text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\.$/, '').toLowerCase();
  const typed = fold(word);
  if (typed.length < 3) return null;
  for (const lang of [gregorian(locale), 'en-US']) {
    for (const style of ['long', 'short'] as const) {
      const names = Array.from({ length: 12 }, (_, month) =>
        fold(
          new Intl.DateTimeFormat(lang, { month: style, timeZone: 'UTC' }).format(
            new Date(Date.UTC(2026, month, 1)),
          ),
        ),
      );
      const found = names.findIndex((name) => name.startsWith(typed) || typed.startsWith(name));
      if (found >= 0) return found + 1;
    }
  }
  return null;
}

/** A two-digit year: 00–49 is this century, 50–99 the last, as `Date.parse` reads them. */
const fullYear = (year: string): number =>
  year.length <= 2 ? Number(year) + (Number(year) < 50 ? 2000 : 1900) : Number(year);

/**
 * The date `text` means in `locale`, at local midnight; an invalid date when it is not one; `null`
 * when it is blank.
 *
 * The fields are read in the order the locale writes them, so `03/04/2026` is 3 April in French and
 * 4 March in American English, whatever the separators. A four-digit number, or one above 31, is the
 * year wherever it is, and a year first is followed by the month, so `2026-04-03` reads the same
 * everywhere. A month may be written as a word in
 * the locale or in English. Without a year, the current one is meant. Digits typed in another
 * script — full-width, Arabic-Indic, Devanagari, Bengali, Thai — are read as digits.
 */
export function nxsParseLocaleDate(text: string, locale: string, today = new Date()): Date | null {
  const typed = asciiDigits(text).trim();
  if (!typed) return null;
  const invalid = new Date(Number.NaN);
  const numbers = typed.match(/\d+/g) ?? [];
  const words = typed.match(/\p{L}+/gu) ?? [];
  const order = nxsDateFieldOrder(locale);

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  const months = words.map((word) => monthNamed(word, locale));
  const named = months.find((found) => found !== null);
  // A word is a month, or one of the markers Chinese, Japanese and Korean put after each field.
  if (words.some((word, i) => months[i] === null && !/^[年月日년월일]$/u.test(word)))
    return invalid;
  if (named) {
    if (numbers.length < 1 || numbers.length > 2) return invalid;
    month = named;
    const yearIndex = numbers.findIndex((n) => n.length >= 3 || Number(n) > 31);
    if (numbers.length === 2) {
      const yi = yearIndex >= 0 ? yearIndex : order.indexOf('year') < order.indexOf('day') ? 0 : 1;
      year = fullYear(numbers[yi]);
      day = Number(numbers[1 - yi]);
    } else {
      if (yearIndex === 0) return invalid;
      day = Number(numbers[0]);
    }
  } else if (numbers.length === 1 && (numbers[0].length === 8 || numbers[0].length === 6)) {
    // Digits typed without separators, in the locale's order: 31122026 or 311226.
    const yearLength = numbers[0].length - 4;
    let at = 0;
    const parts: Record<string, string> = {};
    for (const field of order) {
      const length = field === 'year' ? yearLength : 2;
      parts[field] = numbers[0].slice(at, at + length);
      at += length;
    }
    year = fullYear(parts['year']);
    month = Number(parts['month']);
    day = Number(parts['day']);
  } else if (numbers.length === 3) {
    const yearIndex = numbers.findIndex((n) => n.length >= 3 || Number(n) > 31);
    if (yearIndex >= 0) {
      year = fullYear(numbers[yearIndex]);
      const rest = numbers.filter((_, i) => i !== yearIndex);
      // Year first is year-month-day in every locale that writes it so, and in ISO 8601.
      const monthFirst = yearIndex === 0 || order.indexOf('month') < order.indexOf('day');
      [month, day] = (monthFirst ? rest : [rest[1], rest[0]]).map(Number);
    } else {
      const fields = Object.fromEntries(order.map((field, i) => [field, numbers[i]]));
      year = fullYear(fields['year']);
      month = Number(fields['month']);
      day = Number(fields['day']);
    }
  } else if (numbers.length === 2) {
    const dayMonth = order.filter((field) => field !== 'year');
    const fields = Object.fromEntries(dayMonth.map((field, i) => [field, numbers[i]]));
    month = Number(fields['month']);
    day = Number(fields['day']);
  } else {
    return invalid;
  }

  const resolvedYear = year ?? today.getFullYear();
  if (!month || month < 1 || month > 12 || !day || day < 1) return invalid;
  const date = new Date(resolvedYear, month - 1, day);
  date.setFullYear(resolvedYear, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : invalid;
}

/**
 * Material's native adapter, reading a typed date in the locale's order.
 *
 * `NativeDateAdapter.parse` is `Date.parse`, which reads `nn/nn/yyyy` as an American date in every
 * locale: `03/04/2026` typed in French became 4 March. This keeps everything else the native adapter
 * does and replaces that, with the Gregorian calendar throughout.
 */
@Injectable()
export class NxsLocaleDateAdapter extends NativeDateAdapter {
  constructor() {
    super();
    // `NativeDateAdapter`'s constructor sets its locale through `DateAdapter`, past this override.
    this.setLocale(this.locale);
  }

  override setLocale(locale: unknown): void {
    super.setLocale(gregorian(nxsLocaleId(locale)));
  }

  override parse(value: unknown): Date | null {
    if (typeof value === 'number') return new Date(value);
    if (value instanceof Date) return value;
    return typeof value === 'string' ? nxsParseLocaleDate(value, this.locale) : null;
  }
}

/**
 * The date adapter a host provides, unless it is Material's plain native one, which cannot read a
 * localized date; then this library's. So a host that chose a date library — date-fns, Luxon — keeps
 * it, and its formats with it, and every other host gets typed dates read in its locale.
 */
function hostDateAdapter(): DateAdapter<unknown> | null {
  const host = inject(DateAdapter, { skipSelf: true, optional: true });
  return host && host.constructor !== NativeDateAdapter ? host : null;
}

/** Providers for a date field: the date adapter and formats `hostDateAdapter` decides on. */
export function provideNxsDateAdapter(): Provider[] {
  return [
    {
      provide: DateAdapter,
      useFactory: () => hostDateAdapter() ?? new NxsLocaleDateAdapter(),
    },
    {
      provide: MAT_DATE_FORMATS,
      useFactory: (): MatDateFormats =>
        hostDateAdapter()
          ? (inject(MAT_DATE_FORMATS, { skipSelf: true, optional: true }) ??
            MAT_NATIVE_DATE_FORMATS)
          : MAT_NATIVE_DATE_FORMATS,
    },
  ];
}

type DatepickerLabel = Exclude<
  keyof MatDatepickerIntl,
  'changes' | 'formatYearRange' | 'formatYearRangeLabel'
>;

/** The keys the application's other date pickers use, so the calendar is translated once. */
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
 * The calendar's labels from the catalogue, re-read when the language or catalogue changes. A key
 * the catalogue lacks keeps Material's English rather than showing the key. Provided by the date
 * field itself: `MatDatepickerModule` provides its own English one, which shadows a host's.
 */
@Injectable()
export class NxsDatepickerIntl extends MatDatepickerIntl {
  private readonly translate = inject(TranslateService);
  private readonly english = Object.fromEntries(
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
      { start, end },
    );
  }

  private refresh(): void {
    for (const field of Object.keys(LABEL_KEYS) as DatepickerLabel[]) {
      this[field] = this.resolve(LABEL_KEYS[field], this.english[field]);
    }
    this.changes.next();
  }

  private resolve(key: string, fallback: string, params?: Record<string, string>): string {
    const value = this.translate.instant(key, params);
    return typeof value === 'string' && value !== key ? value : fallback;
  }
}
