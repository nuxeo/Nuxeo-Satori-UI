/** The reading direction of a language's script. Assignable to Angular CDK's `Direction`. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * The languages written right to left, by primary subtag.
 *
 * ## Why a named set rather than `lang === 'ar' || lang === 'he'`
 *
 * The application targets two of these — `ar` and `he` — and an inline comparison against those
 * two would have been shorter. It would also have coupled this to the wrong thing.
 *
 * **Direction is a property of a script, not of what we ship.** Which languages are *shipped*,
 * *advertised* and *selectable* are three separate lists that each moved during October alone:
 * `availableLanguages` gained five languages and lost them again, and NXSAT-733 added
 * `SHIPPED_CATALOGUE_LANGUAGES` as the gate on `defaultLanguage`. The mapping from `he` to `rtl`
 * moved none of those times, and must not have to. So this names the languages whose script runs
 * right to left and reads none of those lists; `syncDocumentDirection` applies it to whatever
 * language actually became active, which is already validated by the time it sees it.
 *
 * The practical payoff is that adding a language is one edit, not two: when `ar.json` lands, `ar`
 * becomes selectable and mirrors with no change here. Covering languages the product does not
 * target — Persian, Urdu, Yiddish — is the same argument one step further out, and is what a
 * future Layer 0 override would point at.
 *
 * ## Why these particular codes
 *
 * This mirrors the primary subtags in Angular CDK's own `RTL_LOCALE_PATTERN`, which is the list
 * CDK applies when it resolves `dir="auto"`. Matching it means our `<html dir>` and CDK's own
 * notion of right-to-left can never disagree about a language — and keeps the list traceable to a
 * maintained authority rather than to whichever languages someone remembered.
 *
 * `iw` is Hebrew's superseded ISO 639-1 code, still emitted by some tooling; `ckb` is Central
 * Kurdish (Sorani), `dv` Divehi, `nqo` N'Ko, `ps` Pashto, `sd` Sindhi, `ug` Uyghur, `yi` Yiddish.
 *
 * Script subtags — `az-Arab`, `pa-Arab` — are deliberately **not** handled: Layer 0 carries
 * two-letter codes (D8a in `docs/i18n-localization-plan.md` holds `crowdin-conf.yml` to
 * `%two_letters_code%`), so a script-qualified id cannot reach the application without a matching
 * change to the loader and to `availableLanguages`. Adding one means adding it here too.
 */
export const RTL_LANGUAGES: readonly string[] = [
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'iw',
  'nqo',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
];

/**
 * The reading direction a language is rendered in, defaulting to left-to-right.
 *
 * Tolerant of a region subtag — `ar-EG`, `he_IL` — because a customer writing `defaultLanguage`
 * by hand is likelier to produce one than the application is, and answering `ltr` for `ar-EG`
 * would mirror nothing while looking configured. Only the primary subtag decides.
 *
 * Unknown or absent is `ltr`, which is the browser's own default for an unset `dir`, so an
 * unrecognised language changes nothing rather than flipping the layout.
 */
export function textDirectionForLanguage(language: string | null | undefined): TextDirection {
  const primary = (language ?? '').toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.includes(primary) ? 'rtl' : 'ltr';
}
