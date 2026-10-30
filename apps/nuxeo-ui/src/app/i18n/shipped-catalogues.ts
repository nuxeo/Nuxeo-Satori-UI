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

/**
 * Locales whose catalogue exists only while someone is auditing, and only on a dev server.
 *
 * `tools/i18n/pseudo-locale.mjs` generates `zz` from `en.json` with every string wrapped in
 * `⟦ ⟧`, writes it into `apps/nuxeo-ui/public/i18n/` **and** into the upstream catalogue
 * directories inside `node_modules`, and `npm run i18n:audit` then boots the application with
 * `defaultLanguage: 'zz'` and looks for strings with no sentinel — those are the ones hard-coded
 * past the translation layer. A dedicated locale is what lets the generator write a catalogue
 * everywhere without overwriting a real one.
 *
 * So at audit time `zz` genuinely does have a catalogue, and refusing it is wrong: the audits
 * boot in English and fail `requireSentinel()` instead of finding hard-coded strings. That is
 * what happened when the NXSAT-733 guard first landed, and it was caught in review of #531
 * rather than by a test, which is why there is one now.
 *
 * It is **never** committed and never in a release build — `zz` is absent from
 * `availableLanguages`, from `REGISTERED_LOCALES` and from `GENERATED_LOCALES`' own exclusion in
 * `scripts/review-guardrails.mjs`, which is why every locale gate skips it. Admission is
 * therefore gated on development mode: a production build refuses `zz` exactly like any other
 * language it ships no catalogue for, so this seam cannot become a way to configure a deployment
 * into announcing a language it does not render.
 *
 * `checkShippedCatalogueLanguages` holds this equal to `GENERATED_LOCALES` in the guardrail, so
 * the two cannot drift into disagreeing about which locales are generated.
 */
export const GENERATED_AUDIT_LOCALES: readonly string[] = ['zz'];
