import { PLATFORM_EN_TRANSLATIONS } from '../i18n/platform-en';
import { dateFnsLocaleFor } from './satori-date-adapter';

/**
 * The placeholder hint for a date input, in the active locale's field order.
 *
 * ## The gap this closes
 *
 * `common.date-mask` is a translation key, so it resolves per **language** — `mm/dd/yyyy` for
 * `en`, `jj/mm/aaaa` for `fr`. The adapter resolves per **locale tag**, region included, and a
 * region can reorder the fields outright: `en-GB` parses `dd/MM/yyyy`. These dialogs are
 * exported from `@nuxeo/satori-platform/ui`, so a host's `LOCALE_ID` reaches the adapter
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
 * ## The letters are not always in `LOCALE_ID`'s order
 *
 * A host using `providePlatformEnglishFallback()` for a language whose catalogue has no
 * `common.date-mask` is handed the **platform's English**, so the letters arrive in English
 * order while `LOCALE_ID` says otherwise. Reading them as that language's own mask is how the
 * first version of this function reintroduced the defect it was written to remove: `fr` kept
 * the month-first `mm/dd/yyyy` because French's own pattern matched itself, and `fr-CA`
 * composed English runs through French field positions and produced `yy-dd-mm`.
 *
 * So the order the letters are *in* is tracked separately from the order they are wanted in —
 * see `sourcePattern`. With it, the English fallback now follows the adapter for every
 * language: `fr` renders `dd/mm/yyyy`, `de` renders `dd.mm.yyyy`, `fr-CA` renders `yy-mm-dd`.
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
  const source = sourcePattern(translatedMask, language);

  // The mask's letters are already in the order this field parses: every language we ship a
  // catalogue for, and every region whose order and separators match it. Leave it exactly as is.
  if (target === source) return translatedMask;

  const sourceFields = patternFields(source);
  const letters = maskLetters(translatedMask);
  if (!letters || letters.length !== sourceFields.length) return translatedMask;

  const lettersByField = new Map<DateField, string>();
  sourceFields.forEach((field, index) => lettersByField.set(field, letters[index]));

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

/** What `providePlatformEnglishFallback()` answers with when a catalogue has no mask. */
const PLATFORM_EN_MASK = PLATFORM_EN_TRANSLATIONS['common.date-mask'];

/**
 * The pattern whose field order the mask's letters are already in.
 *
 * Normally the language in `LOCALE_ID`, because that language's catalogue answered. The
 * exception is the platform's English fallback, which answers for any language whose catalogue
 * lacks the key — then the letters are English and in English order, whatever `LOCALE_ID` says.
 *
 * Recognising it by value is exact for the one case that matters and cannot misfire on a
 * shipped catalogue: no language's own mask is `mm/dd/yyyy` except English's. A host that
 * writes a month-first mask into its own non-English catalogue is read as English and gets its
 * fields reordered to match the parser — which is the right outcome for a mask that was already
 * disagreeing with the field.
 *
 * What this does **not** catch is a host whose own fallback chain answers in some third
 * language. Nothing in the string says which language wrote it, so that case is out of reach
 * here; it stays with the host that configured the chain.
 */
function sourcePattern(translatedMask: string, language: string): string {
  if ((translatedMask ?? '').trim() === PLATFORM_EN_MASK) return shortDatePattern('en');
  return shortDatePattern(language);
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
