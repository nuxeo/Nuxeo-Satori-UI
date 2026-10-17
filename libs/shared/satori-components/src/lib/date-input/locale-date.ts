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

const DECIMAL_DIGIT = /\p{Nd}/u;

/**
 * Each decimal digit typed in another script, as its ASCII digit: `２０２６`, `٢٠٢٦` and Tibetan
 * `༢༠༢༦` read `2026`. Unicode encodes every script's decimal digits as runs of ten, zero first, and
 * never splits one, so a digit is its distance from the start of its run of digits, modulo ten.
 * Some locales write their dates in their own digits — Dzongkha, Burmese, Chakma, Santali — and a
 * field reads back what it writes.
 */
function asciiDigits(text: string): string {
  // `\d` is ASCII 0-9 alone, even with the `u` flag: every other script's digits are converted.
  return text.replace(/(?!\d)\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    let start = code;
    while (DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
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
 *
 * ngx-translate setups and POSIX name languages `fr_FR`, which `Intl` rejects; read as `en-US`, a
 * French field's hint would be lined up month first while its parser reads day first. So an
 * underscore is read as a hyphen, and a tag `Intl` still rejects, such as `fr_FR.UTF-8`, is read
 * as its language alone.
 */
function gregorian(locale: string): string {
  const tag = locale.trim().replaceAll('_', '-');
  for (const candidate of [tag, tag.split('-')[0]]) {
    try {
      return new Intl.Locale(candidate, { calendar: 'gregory' }).toString();
    } catch {
      // Not a tag `Intl` reads: try the next.
    }
  }
  return 'en-US';
}

/** The options Material's native adapter, and so `NxsLocaleDateAdapter`, writes a field's date in. */
const WRITTEN_DATE = MAT_NATIVE_DATE_FORMATS.display.dateInput as Intl.DateTimeFormatOptions;

/** 31 December 2026 in parts, as `locale` writes a date into a field. */
function writtenParts(locale: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(gregorian(locale), {
    ...WRITTEN_DATE,
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2026, 11, 31)));
}

/**
 * The order the locale writes a date's numeric fields in, such as `['day', 'month', 'year']`: the
 * order of the date the field itself writes. For some locales `Intl` orders a two-digit day and
 * month differently from the plain numbers the field shows — Maltese `31/12/2026` but `12/31/2026`
 * — and a parser reading the first would swap the day and month of every date the field wrote.
 */
export function nxsDateFieldOrder(locale: string): ('year' | 'month' | 'day')[] {
  const order = writtenParts(locale)
    .map((part) => part.type)
    .filter((type): type is 'year' | 'month' | 'day' => ['year', 'month', 'day'].includes(type));
  return order.length === 3 ? order : ['month', 'day', 'year'];
}

/**
 * The words `locale` itself writes around a date's numeric fields, in lower case: `г`, for
 * `година`, in Bulgarian and Macedonian `31.12.2026 г.`. The parser reads past them, so a field
 * reads back the dates it writes.
 */
function writtenWords(locale: string): Set<string> {
  return new Set(
    writtenParts(locale)
      .filter((part) => part.type === 'literal')
      .flatMap((part) => part.value.match(/\p{L}+/gu) ?? [])
      .map((word) => word.toLowerCase()),
  );
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
 * everywhere but in the two locales that write the year first and then the day. A month may be written as a word in
 * the locale or in English, and a word the locale writes around a date, such as Bulgarian `г.`, is
 * read past. Without a year, the current one is meant. Digits typed in any script — full-width,
 * Arabic-Indic, Devanagari, Thai, Tibetan — are read as digits.
 */
export function nxsParseLocaleDate(text: string, locale: string, today = new Date()): Date | null {
  const typed = asciiDigits(text).trim();
  if (!typed) return null;
  const invalid = new Date(Number.NaN);
  const numbers = typed.match(/\d+/g) ?? [];
  const written = writtenWords(locale);
  const words = (typed.match(/\p{L}+/gu) ?? []).filter((word) => !written.has(word.toLowerCase()));
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
      // Year first is year-month-day in ISO 8601 and in every locale that writes the year first
      // but Kyrgyz and Uyghur, which write `2026-31-12`, and are read as they write.
      const monthFirst =
        order.indexOf('month') < order.indexOf('day') || (yearIndex === 0 && order[0] !== 'year');
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
 * The date adapter a host provides, unless it reads typed text as Material's native one does, with
 * `Date.parse`, which cannot read a localized date; then this library's. So a host that chose a date
 * library — date-fns, Luxon — keeps it, and its formats with it, and every other host gets typed
 * dates read in its locale.
 *
 * Reading as the native one is Material's own class, or a subclass that keeps its `parse`, such as
 * one that only starts the week on Monday. Kept, it would store `03/04/2026` typed in French as
 * 4 March under a hint, lined up from the dates it writes, that says day first. Its other changes
 * then do not reach the field; a host that wants both overrides `parse`.
 */
function hostDateAdapter(): DateAdapter<unknown> | null {
  const host = inject(DateAdapter, { skipSelf: true, optional: true });
  const readsAsNative =
    host instanceof NativeDateAdapter && host.parse === NativeDateAdapter.prototype.parse;
  return host && !readsAsNative ? host : null;
}

/**
 * Providers for a date field: the date adapter and formats `hostDateAdapter` decides on.
 *
 * The adapter kept may not hold JS `Date`s — Luxon's holds `DateTime`s — so a component using
 * these providers gives its fields, and reads from them, the adapter's own dates, crossing to and
 * from the JS dates it computes with through `nxsDateToAdapter` and `nxsDateFromAdapter`.
 */
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

/**
 * The English `common.date-mask`. It is the one mask whose letters are known to be in English order
 * whatever the active language, because it is what answers for a language whose catalogue has no
 * mask of its own. A spec holds it to the English catalogue, so the two cannot drift apart.
 */
export const NXS_ENGLISH_DATE_MASK = 'mm/dd/yyyy';

/** 31 December 2026, as `DateAdapter.createDate` takes it: its day, month and year differ. */
export const NXS_DATE_MASK_SAMPLE = { year: 2026, month: 11, day: 31 } as const;

type DateField = 'year' | 'month' | 'day';
type MaskSegment = string | { readonly field: DateField; readonly width: number };

/** Punctuation and spaces: what may sit between, before or after a date's numeric fields. */
const FIELD_PUNCTUATION = /^[\p{P}\p{Zs}]+$/u;

/** The field a number in the written sample date is: 31 the day, 12 the month, the rest the year. */
function sampleField(value: number): DateField {
  if (value === NXS_DATE_MASK_SAMPLE.day) return 'day';
  if (value === NXS_DATE_MASK_SAMPLE.month + 1) return 'month';
  return 'year';
}

/**
 * The fields of the sample date as a field writes it, in order, with the text between them:
 * `31/12/2026` is day, `/`, month, `/`, year. `null` when it is not three numeric fields with only
 * punctuation around them, such as a month written as a word or a literal like `年`.
 */
function writtenSegments(written: string): MaskSegment[] | null {
  const text = asciiDigits(written).replace(/[\u200e\u200f\u061c]/g, '');
  const segments: MaskSegment[] = [];
  const seen = new Set<DateField>();
  for (const run of text.match(/\d+|\D+/g) ?? []) {
    if (!/\d/.test(run)) {
      if (!FIELD_PUNCTUATION.test(run)) return null;
      segments.push(run);
      continue;
    }
    const field = sampleField(Number(run));
    if (seen.has(field)) return null;
    seen.add(field);
    segments.push({ field, width: run.length });
  }
  return seen.size === 3 ? segments : null;
}

/**
 * The letter runs of a translated mask — `jj/mm/aaaa` is `jj`, `mm`, `aaaa` — or `null` when it is
 * not three runs, each one letter repeated, with only punctuation between them.
 */
function maskLetters(mask: string): string[] | null {
  const trimmed = mask.trim();
  if (!/^\p{L}+(?:[\p{P}\p{Zs}]+\p{L}+){2}$/u.test(trimmed)) return null;
  const runs = trimmed.match(/\p{L}+/gu) ?? [];
  return runs.every((run) => [...run].every((letter) => letter === run[0])) ? runs : null;
}

/**
 * The fields a translated mask's letter runs stand for, in order: the order `language` writes a
 * date in, the language the catalogue answered in. A catalogue is named by the whole code, so
 * `en_GB`'s `dd/mm/yyyy` is read in British order, day first. But a regional catalogue may copy
 * its language's mask: `fr_CA` with French `jj/mm/aaaa` would give `jj`, written first, to the
 * year Canadian French writes first. A year's run is never shorter than another field's, so an
 * order that would give the year a shorter run is the wrong one: then the mask is read in the
 * language's order, and failing that it is not read at all (`null`).
 */
function maskOrder(letters: readonly string[], language: string): DateField[] | null {
  const longest = Math.max(...letters.map((run) => [...run].length));
  return (
    [language, language.trim().split(/[-_]/)[0]]
      .map(nxsDateFieldOrder)
      .find((order) => [...letters[order.indexOf('year')]].length === longest) ?? null
  );
}

/**
 * The hint for a date field — `jj/mm/aaaa` — in the order, and with the separators, of `written`:
 * the sample date (31 December 2026) as the field's own date adapter writes it. The letters are the
 * translated mask's, read in the order of `maskLanguage`, the language the catalogue answered in,
 * as `maskOrder` decides it — `fr_FR` is French; the English mask is read in English order whatever the language, because it is what answers for a
 * catalogue without one.
 *
 * So the hint follows the parser rather than the catalogue: a French catalogue's `jj/mm/aaaa` reads
 * `mm/jj/aaaa` where the adapter writes month first, and the English `mm/dd/yyyy` reads
 * `dd/mm/yyyy` where it writes day first. A year the adapter writes with two digits gets two
 * letters, one with four gets four. Anything that cannot be lined up — a mask with a literal such
 * as `年`, an adapter that writes the month as a word or a word such as Bulgarian `г.` — gives
 * `written` itself rather than a mask that might not agree with the parser.
 *
 * Either way the hint is only as good as the adapter reading back what it writes: the field's
 * order comes from what the adapter writes, and the parse from what it reads. `NxsLocaleDateAdapter`
 * does, which its spec checks in every language `Intl` formats a date in. A host's adapter is trusted to; one that writes
 * with `display.dateInput` and reads with a different `parse.dateInput` may not.
 */
export function nxsDateMask(written: string, mask: string, maskLanguage: string): string {
  const target = writtenSegments(written);
  const letters = maskLetters(mask);
  if (!target || !letters) return written;
  const order = maskOrder(letters, mask.trim() === NXS_ENGLISH_DATE_MASK ? 'en' : maskLanguage);
  if (!order) return written;
  const lettersOf = new Map(order.map((field, index) => [field, letters[index]]));
  return target
    .map((segment) => {
      if (typeof segment === 'string') return segment;
      const word = lettersOf.get(segment.field) ?? '';
      if (segment.field !== 'year') return word;
      // A year written with two digits gets two letters, one written with four gets four.
      const yearLetters = segment.width <= 2 ? 2 : 4;
      return ([...word][0] ?? '').repeat(yearLetters);
    })
    .join('');
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
