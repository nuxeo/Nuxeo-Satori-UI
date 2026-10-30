/**
 * The languages this application bundles a translation catalogue for.
 *
 * ## Why this is declared rather than discovered
 *
 * The catalogues are static assets served over HTTP, and a directory listing is not. The only way
 * to find out at runtime whether `i18n/es.json` exists is to ask for it and see whether it 404s —
 * which is exactly the defect this list exists to remove (NXSAT-733). So it is written down, for
 * the same reason and in the same shape as `UPSTREAM_FOLDERS[].languages` in
 * `app-translate-loader.ts`.
 *
 * A declaration that can rot is worse than none, so `checkShippedCatalogueLanguages` in
 * `scripts/review-guardrails.mjs` compares it to `apps/nuxeo-ui/public/i18n` on every pull
 * request and fails the `guardrails` gate with the difference. Adding a catalogue without adding
 * it here cannot pass.
 *
 * ## Why it is not one of the three lists that already exist
 *
 * Three lists in this repository name languages, and they answer three different questions:
 *
 * | List | Question | Authority |
 * | --- | --- | --- |
 * | `REGISTERED_LOCALES` | can Angular format dates without `NG0701`? | this build |
 * | `DATE_FNS_LOCALES` (`canFormatDatesIn`) | can the date adapter parse them back? | this build |
 * | `availableLanguages` | does this deployment offer the language? | the customer |
 *
 * None of them answers "will the text actually render in this language?", and substituting one
 * that nearly does is how a check ends up testing a proxy for the thing in its own name.
 * `REGISTERED_LOCALES` is the closest and still wrong: `ar`, `es`, `he`, `it` and `sv` are
 * registered ahead of their catalogues (`D8e-webui`), so it would admit five languages that
 * render English throughout.
 *
 * `en` is listed, unlike in `REGISTERED_LOCALES`: `en.json` really does ship, it is the fallback
 * language, and `EN_FALLBACK_TRANSLATIONS` is compiled in besides. A consumer may therefore treat
 * membership here as the whole answer rather than having to special-case English.
 */
export const SHIPPED_CATALOGUE_LANGUAGES: readonly string[] = ['de', 'en', 'fr', 'ja', 'nl'];
