import { dateFnsLocaleFor } from './satori-date-adapter';

/**
 * The placeholder hint for a date input, in the active locale's field order.
 *
 * ## The gap this closes
 *
 * `common.date-mask` is a translation key, so it resolves per **language** — `mm/dd/yyyy` for
 * `en`, `jj/mm/aaaa` for `fr`. The adapter resolves per **locale tag**, region included, and a
 * region can reorder the fields outright: `en-GB` parses `dd/MM/yyyy`. These dialogs are
 * exported from `@nuxeo-satori/platform/ui`, so a host's `LOCALE_ID` reaches the adapter
 * unclamped while the catalogue still answers for the bare language. A host on `en-GB` using
 * the documented English fallback was therefore told to type month-first while its field read
 * day-first — the silent swap this adapter exists to remove, wearing a different locale id.
 *
 * ## Why it composes rather than deriving the whole mask
 *
 * The letters are translated and the order is not. date-fns knows the order and separators for
 * every region; only a translator knows that a German reader expects `tt.mm.jjjj` and a French
 * one `jj/mm/aaaa`. Deriving the whole hint from date-fns would hand every language Latin
 * `dd/MM/yyyy` and throw that work away, so the order and separators come from the adapter's
 * own format and the letters come from the catalogue. Each half keeps one source of truth.
 *
 * `fr-CH` is the separator-only case (`jj.mm.aaaa`), `en-GB` the order-only case
 * (`dd/mm/yyyy`), `fr-CA` both at once (`aa-mm-jj`).
 *
 * ## Why it fails back to the translated value
 *
 * Every exit that cannot line the two up returns `translatedMask` untouched. A hint that
 * disagrees with the parser is worse than an English one, but a hint this function mangled
 * would be worse still, and it has no way to tell a catalogue it cannot parse from one it has
 * misread. Returning the translator's own string is the one outcome that is never a regression.
 */
export function dateMaskFor(localeId: string, translatedMask: string): string {
  const language = (localeId ?? '').toLowerCase().replaceAll('_', '-').split('-')[0];
  const target = shortDatePattern(localeId);
  const base = shortDatePattern(language);

  // Every language we ship a catalogue for, and every region whose order and separators match
  // its base. The translated mask already describes this field, so leave it exactly as it is.
  if (target === base) return translatedMask;

  const baseFields = patternFields(base);
  const letters = maskLetters(translatedMask);
  if (!letters || letters.length !== baseFields.length) return translatedMask;

  const lettersByField = new Map<DateField, string>();
  baseFields.forEach((field, index) => lettersByField.set(field, letters[index]));

  let composed = '';
  for (const segment of patternSegments(target)) {
    if (typeof segment === 'string') {
      composed += segment;
      continue;
    }
    const word = lettersByField.get(segment.field);
    if (!word) return translatedMask;
    // A two-digit year gets two letters; `y`, `yy` and `yyyy` are the only widths date-fns
    // uses here, and the catalogues spell the wide year out in full.
    composed += segment.field === 'year' && segment.width === 2 ? word.slice(0, 2) : word;
  }
  return composed;
}

type DateField = 'day' | 'month' | 'year';

type PatternSegment = string | { field: DateField; width: number };

/**
 * date-fns' own short date format for a locale — `MM/dd/yyyy`, `dd.MM.y`, `yy-MM-dd`.
 *
 * `formatLong` is optional on date-fns' `Locale`, so an empty string stands for "no pattern".
 * Two of those compare equal, which lands on the unchanged-mask path rather than composing from
 * a shape nobody stated.
 */
function shortDatePattern(localeId: string): string {
  return dateFnsLocaleFor(localeId).formatLong?.date({ width: 'short' }) ?? '';
}

const FIELD_FOR_PATTERN_LETTER: Readonly<Record<string, DateField>> = {
  d: 'day',
  M: 'month',
  y: 'year',
};

/** The pattern split into field runs and the literal text between them, in order. */
function patternSegments(pattern: string): PatternSegment[] {
  const segments: PatternSegment[] = [];
  for (const run of pattern.match(/([dMy])\1*|[^dMy]+/g) ?? []) {
    const field = FIELD_FOR_PATTERN_LETTER[run[0]];
    segments.push(field ? { field, width: run.length } : run);
  }
  return segments;
}

/** Just the fields of a pattern, in order: `MM/dd/yyyy` is month, day, year. */
function patternFields(pattern: string): DateField[] {
  return patternSegments(pattern)
    .filter(
      (segment): segment is { field: DateField; width: number } => typeof segment !== 'string',
    )
    .map((segment) => segment.field);
}

/**
 * The letter runs of a translated mask: `jj/mm/aaaa` is `['jj', 'mm', 'aaaa']`.
 *
 * `null` when the value is not a bare mask — every run one letter repeated, with only
 * punctuation between them. That is the shape `review-guardrails`' date-pattern arm already
 * holds `common.date-mask` to in all seven catalogues, so anything else means the caller handed
 * this function something other than a mask and it must not try to reshape it.
 */
function maskLetters(translatedMask: string): string[] | null {
  const mask = (translatedMask ?? '').trim();
  // Letter runs with only field punctuation between them. A literal segment such as Japanese
  // `年` is not rejected because it is wrong, but because reshaping around one needs to know
  // which field each literal belongs to; falling back leaves the translator's value intact.
  if (!/^\p{L}+(?:[/\-.,: ]+\p{L}+)+$/u.test(mask)) return null;
  const runs = mask.match(/\p{L}+/gu) ?? [];
  if (runs.some((run) => [...run].some((character) => character !== run[0]))) return null;
  return runs;
}
