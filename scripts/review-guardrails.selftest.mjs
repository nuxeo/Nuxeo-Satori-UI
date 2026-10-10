#!/usr/bin/env node
/**
 * Negative controls for the i18n and configuration guardrails in `review-guardrails.mjs`.
 *
 * No count in this sentence on purpose. It said "three" through two rounds of additions and
 * was wrong by the end of the first; the executable report at the bottom of this file prints
 * the real total, and a number duplicated in prose diverges from it immediately.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* Three gates in
 * this programme were green while the thing they guarded was broken. Eleven guardrails shipped
 * before this file existed with **no tests at all**, so this began with the ones
 * added for NXSAT-227 and establishes somewhere for the rest to go.
 *
 * ## Why a throwaway repository rather than perturbing tracked files
 *
 * `sanitizer-audit.selftest.mjs` edits real tracked files and restores them in a `finally`, with
 * signal handlers for the paths `finally` misses. It works, and it is the sharpest thing in this
 * repository: a hard kill leaves a dirty tree, and its own docstring says so.
 *
 * These guardrails need no such risk. They read the repository through `git rev-parse
 * --show-toplevel`, `git ls-files` and `git diff`, all relative to the process's working
 * directory — so a fixture repository in `os.tmpdir()` exercises them completely, and nothing
 * outside that directory is ever written. A crash leaks a temp directory, which the OS reclaims.
 *
 * `--only` is what makes this precise. Running all fifteen guardrails against a fixture tree
 * would report a dozen unrelated failures and prove nothing about the one under test.
 *
 * ## What "covered" means here
 *
 * Each control asserts the guardrail goes red **for the expected reason**, matched against the
 * message, not merely that the exit code is non-zero — a control that passes on the wrong
 * failure is how a tautological check survives. Positive controls (a correct tree must be green)
 * are counted separately from negative ones, because a total that mixes them reads as more
 * assurance than it is.
 *
 * Usage:  node scripts/review-guardrails.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const GUARDRAILS = join(ROOT, 'scripts', 'review-guardrails.mjs');

let negative = 0;
let positive = 0;
/**
 * Positive controls that specifically assert a NON-violation is not flagged.
 *
 * Counted separately because it drifted once already: the summary hardcoded "eight" while the
 * list held nine, and then said "9" while a second set of seven had been added elsewhere. A
 * number in prose next to a list it does not come from is a number that goes wrong.
 */
let falsePositiveControls = 0;
const failures = [];

/** A minimal but valid app catalogue. */
const EN_JSON = `{
  "app": {
    "title": "Hyland Nuxeo",
    "nav": { "toggle": "Toggle navigation menu" }
  },
  "settings": {
    "themes": { "search": "Search themes" }
  }
}
`;

/** A fallback map carrying both keys the fixture templates bind to accessible names. */
const EN_FALLBACK = `export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {
  'app.nav.toggle': 'Toggle navigation menu',
  'settings.themes.search': 'Search themes',
};
`;

/** A template that does everything right: both accessible names go through the pipe. */
const GOOD_TEMPLATE = `<button type="button" [attr.aria-label]="'app.nav.toggle' | translate">
  <mat-icon>menu</mat-icon>
</button>
<button type="button" [attr.aria-label]="'settings.themes.search' | translate">
  <mat-icon>search</mat-icon>
</button>
`;

/**
 * Builds a fixture repository with one commit, then applies `mutate` to it uncommitted.
 *
 * The uncommitted step matters for the diff-scoped guardrail: `parseDiff()` falls back to
 * `git diff <base>` when the tree is dirty, so a working-tree change is what a developer's
 * pre-commit run actually sees.
 *
 * `mutate` receives `git` as well as `write` because `git diff` cannot see an UNTRACKED file.
 * A control that only writes a brand-new path produces an empty diff, and a diff-scoped
 * guardrail is then green on a tree that is broken on purpose — which is a control asserting
 * nothing. Staging the file is what makes it a reintroduction rather than a stray.
 */
function withFixture(files, mutate, run) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-selftest-'));
  try {
    const git = (args) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed in fixture: ${result.stderr}`);
      }
    };

    const write = (relative, body) => {
      const path = join(dir, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    };

    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'user.email', 'selftest@example.invalid']);
    git(['config', 'user.name', 'Guardrail Selftest']);
    git(['config', 'commit.gpgsign', 'false']);

    for (const [relative, body] of Object.entries(files)) write(relative, body);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'fixture baseline']);

    // `--base` defaults to origin/main, which a fixture repository does not have. Every control
    // passes the baseline commit explicitly instead.
    const base = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    }).stdout.trim();

    if (mutate) mutate(write, git);

    return run((guardrail) => {
      // The fixture must not inherit the OUTER repository's refs.
      //
      // `review-guardrails.mjs` resolves its base and head as
      // `--base || NX_BASE || origin/main` and `--head || NX_HEAD || HEAD`. CI sets both, so
      // without this the child ran `git diff <fixture-base>...<real-repo-sha>` inside a
      // throwaway repository that has never heard of that SHA, and died with
      // `fatal: Invalid symmetric difference expression`.
      //
      // Locally neither variable is set, `head` fell back to `HEAD`, the dirty-tree branch of
      // `parseDiff()` was taken and everything passed. So this file was green here and red in
      // CI for an entire push — the exact trap `AGENTS/11-beta-program.md` §3 records as "only
      // a CI run is authoritative". Both are now passed explicitly *and* stripped from the
      // environment, because either alone would leave the other as a latent path.
      const env = { ...process.env };
      delete env.NX_BASE;
      delete env.NX_HEAD;

      const result = spawnSync(
        process.execPath,
        [GUARDRAILS, '--only', guardrail, '--base', base, '--head', 'HEAD'],
        { cwd: dir, encoding: 'utf8', env },
      );
      return { code: result.status, out: `${result.stdout}${result.stderr}` };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Asserts the guardrail goes red, and that the message says why. */
function expectRed(label, guardrail, files, mutate, expected) {
  negative += 1;
  withFixture(files, mutate, (runGuardrail) => {
    const { code, out } = runGuardrail(guardrail);
    if (code === 0) {
      failures.push(`${label}: ${guardrail} passed, but the tree is broken on purpose.`);
      return;
    }
    if (!expected.test(out)) {
      failures.push(
        `${label}: ${guardrail} failed, but not for the expected reason.\n` +
          `    expected /${expected.source}/\n    got: ${out.trim().split('\n').join('\n         ')}`,
      );
    }
  });
}

/**
 * Asserts the guardrail stays green but *warns*, naming the reason.
 *
 * Needed once missing-locale-key parity became a warning rather than a failure: a missing key
 * falls back to English and is handled, so failing would force whoever runs the extraction to
 * also invent the translations. Green-and-silent and green-with-a-warning are different
 * outcomes, and a control that only checks the exit code cannot tell them apart — which is how
 * a demoted check quietly becomes no check at all.
 */
function expectWarn(label, guardrail, files, mutate, expected) {
  negative += 1;
  withFixture(files, mutate, (runGuardrail) => {
    const { code, out } = runGuardrail(guardrail);
    if (code !== 0) {
      failures.push(`${label}: ${guardrail} failed, but this should only warn.\n    ${out.trim()}`);
      return;
    }
    if (!expected.test(out)) {
      failures.push(
        `${label}: ${guardrail} was green but did not warn about it.\n` +
          `    expected /${expected.source}/\n    got: ${out.trim()}`,
      );
    }
  });
}

/** Asserts a correct tree is green — the control that stops a guardrail failing on everything. */
function expectGreen(label, guardrail, files) {
  positive += 1;
  withFixture(files, null, (runGuardrail) => {
    const { code, out } = runGuardrail(guardrail);
    if (code !== 0) {
      failures.push(`${label}: ${guardrail} failed on a correct tree.\n    ${out.trim()}`);
    }
  });
}

const APP = {
  'apps/nuxeo-ui/public/i18n/en.json': EN_JSON,
  'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK,
  'apps/nuxeo-ui/src/app/shell/app-shell.component.html': GOOD_TEMPLATE,
};

/* ---------------- checkTranslationCatalogues ---------------- */

expectGreen('a valid single-locale catalogue set', 'checkTranslationCatalogues', APP);

expectRed(
  'malformed catalogue',
  'checkTranslationCatalogues',
  APP,
  (write) => write('apps/nuxeo-ui/public/i18n/en.json', EN_JSON.replace('"Search themes"', '"x",')),
  /is not valid JSON/,
);

expectRed(
  'blank catalogue value',
  'checkTranslationCatalogues',
  APP,
  (write) => write('apps/nuxeo-ui/public/i18n/en.json', EN_JSON.replace('"Search themes"', '""')),
  /maps `settings\.themes\.search` to an empty string/,
);

expectRed(
  'catalogue with no trailing newline',
  'checkTranslationCatalogues',
  APP,
  (write) => write('apps/nuxeo-ui/public/i18n/en.json', EN_JSON.trimEnd()),
  /has no trailing newline/,
);

expectRed(
  'a catalogue with a raw carriage return inside a JSON string value',
  'checkTranslationCatalogues',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/public/i18n/en.json',
      '{\n  "app": { "title": "Hyland' + '\r' + ' Nuxeo" }\n}\n',
    ),
  /is not valid JSON/,
);

falsePositiveControls += 1;
expectGreen(
  'a catalogue with carriage return as JSON whitespace between tokens',
  'checkTranslationCatalogues',
  {
    'apps/nuxeo-ui/public/i18n/en.json':
      '{\r "app": { "title": "Hyland Nuxeo", "nav": { "toggle": "Toggle navigation menu" } }, ' +
      '"settings": { "themes": { "search": "Search themes" } } }\n',
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK,
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': GOOD_TEMPLATE,
  },
);

expectWarn(
  'locale missing a key the reference has — warns, because English is the fallback',
  'checkTranslationCatalogues',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/public/i18n/fr.json',
      '{\n  "app": { "title": "Hyland Nuxeo", "nav": { "toggle": "Basculer" } }\n}\n',
    ),
  /fr\.json is missing 1 key\(s\).*settings\.themes\.search/s,
);

expectRed(
  'locale carrying a key the reference dropped',
  'checkTranslationCatalogues',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/public/i18n/fr.json',
      EN_JSON.replace('"Search themes"', '"Rechercher"').replace(
        '  "settings": {',
        '  "dead": { "key": "Obsolete" },\n  "settings": {',
      ),
    ),
  /fr\.json carries 1 key\(s\) absent from.*dead\.key/s,
);

expectRed(
  'a locale with no en.json to compare against',
  'checkTranslationCatalogues',
  {
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "app": { "title": "Nuxeo" }\n}\n',
    ...Object.fromEntries(Object.entries(APP).filter(([path]) => !path.endsWith('en.json'))),
  },
  null,
  /no en\.json/,
);

expectRed(
  'no catalogues at all must not read as a pass',
  'checkTranslationCatalogues',
  { 'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK },
  null,
  /asserted nothing/,
);

/* ---------------- checkCataloguesAreTranslated ---------------- */

/**
 * Six keys, because the gate ignores any catalogue sharing fewer than five with English —
 * `EN_JSON` above has three and cannot exercise this one at all.
 */
const EN_SIX = `{
  "app": {
    "title": "Hyland Nuxeo",
    "nav": { "toggle": "Toggle navigation menu", "close": "Close" }
  },
  "browse": {
    "delete": "Delete",
    "rename": "Rename",
    "details": "Show details"
  }
}
`;

/** A real translation — and `app.title` stays English, which a proper noun is entitled to do. */
const FR_SIX = `{
  "app": {
    "title": "Hyland Nuxeo",
    "nav": { "toggle": "Basculer le menu de navigation", "close": "Fermer" }
  },
  "browse": {
    "delete": "Supprimer",
    "rename": "Renommer",
    "details": "Afficher les détails"
  }
}
`;

const SIX = {
  'apps/nuxeo-ui/public/i18n/en.json': EN_SIX,
  'apps/nuxeo-ui/public/i18n/fr.json': FR_SIX,
};

expectGreen(
  'a real translation that leaves a proper noun in English',
  'checkCataloguesAreTranslated',
  SIX,
);

expectRed(
  'a catalogue that is the English export under a French name — the Crowdin defect itself',
  'checkCataloguesAreTranslated',
  SIX,
  (write) => write('apps/nuxeo-ui/public/i18n/fr.json', EN_SIX),
  /fr\.json repeats the English string for all 6 of its keys/,
);

/** Thirty keys, to clear the 25-key floor the partial-export warning carries. */
const manyKeys = (translate) => {
  const bulk = {};
  for (let index = 0; index < 30; index += 1) bulk[`k${index}`] = translate(index);
  return `${JSON.stringify({ bulk }, null, 2)}\n`;
};

expectWarn(
  'a mostly-untranslated export warns rather than fails, because a translator may have meant it',
  'checkCataloguesAreTranslated',
  {
    'apps/nuxeo-ui/public/i18n/en.json': manyKeys((index) => `English string ${index}`),
    // 27 of 30 left in English: past the 80% warning threshold, short of all-identical.
    'apps/nuxeo-ui/public/i18n/fr.json': manyKeys((index) =>
      index < 3 ? `Chaîne française ${index}` : `English string ${index}`,
    ),
  },
  null,
  /fr\.json repeats the English string for 27 of its 30 keys \(90%\)/,
);

expectRed(
  'catalogues that are all below the key floor must not read as a pass',
  'checkCataloguesAreTranslated',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "app": { "title": "Nuxeo", "close": "Close" }\n}\n',
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "app": { "title": "Nuxeo", "close": "Fermer" }\n}\n',
  },
  null,
  /asserted nothing/,
);

expectGreen(
  'a part-translated locale below the key floor is not accused of translating nothing',
  'checkCataloguesAreTranslated',
  {
    ...SIX,
    // Two real translations out of six keys. Legitimate, and the reason the floor exists.
    'apps/nuxeo-ui/public/i18n/de.json':
      '{\n  "browse": { "delete": "Löschen", "rename": "Umbenennen" }\n}\n',
  },
);

expectRed(
  'an emptied catalogue hiding behind a healthy sibling',
  'checkCataloguesAreTranslated',
  // `fr.json` is gutted to `{}` while `de.json` stays real. The key floor used to `continue`
  // past the empty one, and the healthy sibling incremented `compared` so the
  // "asserted nothing" guard could not notice either.
  {
    'apps/nuxeo-ui/public/i18n/en.json': EN_SIX,
    'apps/nuxeo-ui/public/i18n/fr.json': '{}\n',
    'apps/nuxeo-ui/public/i18n/de.json': FR_SIX.replace('Supprimer', 'Löschen'),
  },
  null,
  /fr\.json contains no translated strings at all, while .*en\.json has 6/,
);

/* ---------------- checkCataloguePlaceholders ---------------- */

const EN_PLACEHOLDERS = `{
  "browse": {
    "deleted": "Deleted {{count}} documents from {{ folder }}",
    "title": "Browse"
  }
}
`;
const placeholders = (deleted) =>
  `${JSON.stringify({ browse: { deleted, title: 'Parcourir' } }, null, 2)}\n`;
const withFrench = (deleted) => ({
  'apps/nuxeo-ui/public/i18n/en.json': EN_PLACEHOLDERS,
  'apps/nuxeo-ui/public/i18n/fr.json': placeholders(deleted),
});

expectGreen(
  'a translation keeping both placeholders',
  'checkCataloguePlaceholders',
  withFrench('{{count}} documents supprimés de {{ folder }}'),
);

expectGreen(
  'reordered placeholders pass, because word order changes between languages',
  'checkCataloguePlaceholders',
  withFrench('Dans {{ folder }} : {{count}} documents supprimés'),
);
falsePositiveControls += 1;

expectGreen(
  'zero or one space inside the braces passes, because ngx-translate accepts either',
  'checkCataloguePlaceholders',
  withFrench('{{ count }} documents supprimés de {{folder}}'),
);
falsePositiveControls += 1;

expectRed(
  'two spaces inside the braces fail — ngx-translate 17 accepts at most one and renders the rest raw',
  'checkCataloguePlaceholders',
  withFrench('{{  count  }} documents supprimés de {{ folder }}'),
  null,
  // Reported as an unparseable token rather than a missing name: both are true, and this is the
  // more precise diagnosis — the braces reach the screen.
  /contains \{\{  count  \}\} — braces ngx-translate does not parse/,
);

// The case review found the control above could not prove: a source with NO placeholders, so the
// parsed-name lists are `[]` on both sides, and a translation adding an unparseable token.
expectRed(
  'an unparseable token fails even when English has no placeholders',
  'checkCataloguePlaceholders',
  {
    'apps/nuxeo-ui/public/i18n/en.json': EN_PLACEHOLDERS,
    'apps/nuxeo-ui/public/i18n/fr.json': `${JSON.stringify(
      {
        browse: {
          deleted: '{{count}} documents supprimés de {{ folder }}',
          title: 'Parcourir {{  count  }}',
        },
      },
      null,
      2,
    )}\n`,
  },
  null,
  /maps `browse\.title` to .*contains \{\{  count  \}\}.*render verbatim/s,
);

expectRed(
  'an added empty placeholder is seen — the runtime matches `{{}}` too, and it must not read as none',
  'checkCataloguePlaceholders',
  withFrench('{{count}} documents supprimés de {{ folder }} {{}}'),
  null,
  /placeholders are \[\(empty\), count, folder\] where .*has \[count, folder\]/,
);

expectRed(
  'an added hyphenated placeholder is seen, because the runtime interpolates any non-space name',
  'checkCataloguePlaceholders',
  withFrench('{{count}} documents supprimés de {{ folder }} par {{ user-name }}'),
  null,
  /placeholders are \[count, folder, user-name\]/,
);

expectGreen(
  'a key absent from the locale is skipped — it renders the English fallback',
  'checkCataloguePlaceholders',
  {
    'apps/nuxeo-ui/public/i18n/en.json': EN_PLACEHOLDERS,
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "browse": { "title": "Parcourir" }\n}\n',
  },
);
falsePositiveControls += 1;

expectRed(
  'a dropped placeholder',
  'checkCataloguePlaceholders',
  withFrench('Documents supprimés de {{ folder }}'),
  null,
  /fr\.json maps `browse\.deleted`.*placeholders are \[folder\] where .*en\.json has \[count, folder\]/,
);

expectRed(
  'a renamed (translated) placeholder',
  'checkCataloguePlaceholders',
  withFrench('{{nombre}} documents supprimés de {{ folder }}'),
  null,
  /fr\.json maps `browse\.deleted`.*placeholders are \[folder, nombre\] where .*has \[count, folder\]/,
);

expectRed(
  'an extra placeholder',
  'checkCataloguePlaceholders',
  withFrench('{{count}} documents supprimés de {{ folder }} par {{user}}'),
  null,
  /fr\.json maps `browse\.deleted`.*placeholders are \[count, folder, user\]/,
);

expectRed(
  'a duplicated placeholder counts — the comparison is a multiset, not a set',
  'checkCataloguePlaceholders',
  withFrench('{{count}} documents ({{count}}) supprimés de {{ folder }}'),
  null,
  /placeholders are \[count, count, folder\]/,
);

/* ---------------- checkTranslationContext ---------------- */

/** Context for every string in `EN_JSON`, keyed identically, plus one `$` metadata key. */
const EN_CONTEXT = `{
  "$note": "Translator context for en.json.",
  "app.title": "PRODUCT NAME — do not translate.",
  "app.nav.toggle": "Accessible name for the nav rail button. 'Toggle' is a verb.",
  "settings.themes.search": "Accessible name for the themes search button. A verb phrase."
}
`;

const WITH_CONTEXT = { ...APP, 'apps/nuxeo-ui/public/i18n/en.context.json': EN_CONTEXT };

expectGreen('context for every string', 'checkTranslationContext', WITH_CONTEXT);

expectRed(
  'no context file at all',
  'checkTranslationContext',
  APP,
  null,
  /has no sibling en\.context\.json/,
);

expectRed(
  'a new string with no context',
  'checkTranslationContext',
  WITH_CONTEXT,
  (write) =>
    write(
      'apps/nuxeo-ui/public/i18n/en.json',
      EN_JSON.replace(
        '"title": "Hyland Nuxeo",',
        '"title": "Hyland Nuxeo",\n    "undocumented": "New string",',
      ),
    ),
  /missing context for 1 string\(s\).*app\.undocumented/s,
);

expectRed(
  'context left behind for a deleted string',
  'checkTranslationContext',
  WITH_CONTEXT,
  (write) =>
    write(
      'apps/nuxeo-ui/public/i18n/en.context.json',
      EN_CONTEXT.replace('"$note"', '"app.removed": "Stale.",\n  "$note"'),
    ),
  /documents 1 key\(s\).*app\.removed/s,
);

expectRed(
  'an unparseable context file',
  'checkTranslationContext',
  WITH_CONTEXT,
  (write) => write('apps/nuxeo-ui/public/i18n/en.context.json', '{ "app.title": }\n'),
  /en\.context\.json is not valid JSON/,
);

/* ---------------- checkAngularDevAssets ---------------- */

/**
 * A control for the `ignore` field specifically. The parity key compared glob, input and output
 * only, so an entry excluding a file in the base array and not in `development` was identical as
 * far as this gate could see, while the two configurations served different files — the same
 * divergence the gate exists for, one field further in. Found while excluding the translator
 * context file from the build.
 */
const ANGULAR_JSON = (developmentIgnore) =>
  `${JSON.stringify(
    {
      projects: {
        'nuxeo-ui': {
          architect: {
            build: {
              options: {
                assets: [
                  { glob: '**/*', input: 'apps/nuxeo-ui/public', ignore: ['i18n/*.context.json'] },
                ],
              },
              configurations: {
                development: {
                  assets: [
                    {
                      glob: '**/*',
                      input: 'apps/nuxeo-ui/public',
                      ...(developmentIgnore ? { ignore: developmentIgnore } : {}),
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;

expectGreen('matching ignore lists', 'checkAngularDevAssets', {
  'angular.json': ANGULAR_JSON(['i18n/*.context.json']),
});

expectRed(
  'a configuration that drops the base ignore list',
  'checkAngularDevAssets',
  { 'angular.json': ANGULAR_JSON(null) },
  null,
  /overrides assets but omits/,
);

/* ---------------- checkAccessibleNameFallbacks ---------------- */

expectGreen('every accessible name in the fallback', 'checkAccessibleNameFallbacks', APP);

expectRed(
  'accessible-name key missing from the fallback',
  'checkAccessibleNameFallbacks',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      EN_FALLBACK.replace("  'settings.themes.search': 'Search themes',\n", ''),
    ),
  /binds aria-label to `settings\.themes\.search`.*omits/s,
);

expectRed(
  'accessible-name key blank in the fallback',
  'checkAccessibleNameFallbacks',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      EN_FALLBACK.replace(
        "'settings.themes.search': 'Search themes'",
        "'settings.themes.search': ''",
      ),
    ),
  /maps it to an empty string/,
);

expectRed(
  'no accessible names bound at all must not read as a pass',
  'checkAccessibleNameFallbacks',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': '<button type="button"></button>\n',
  },
  null,
  /asserted nothing/,
);

expectRed(
  'a fallback map this parser cannot read must not read as a pass',
  'checkAccessibleNameFallbacks',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts':
      'export const EN_FALLBACK_TRANSLATIONS = Object.freeze(buildMap());\n',
  },
  null,
  /yielded no key\/value pairs/,
);

/** NXENG-798: global search names via associated visible label, not placeholder attribute. */
const HEADER_SEARCH_LABEL_TEMPLATE = `<input id="global-header-search-input" class="header-search-input" placeholder=" " />
<label class="header-search-label" for="global-header-search-input">
  {{ 'shell.search.placeholder' | translate }}
</label>
`;

const EN_JSON_SHELL_SEARCH = `{
  "app": {
    "title": "Hyland Nuxeo",
    "nav": { "toggle": "Toggle navigation menu" }
  },
  "settings": {
    "themes": { "search": "Search themes" }
  },
  "shell": {
    "search": {
      "placeholder": "Search documents"
    }
  }
}
`;

const EN_FALLBACK_SHELL_SEARCH = `export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {
  'app.nav.toggle': 'Toggle navigation menu',
  'settings.themes.search': 'Search themes',
  'shell.search.placeholder': 'Search documents',
};
`;

const APP_HEADER_SEARCH_LABEL = {
  'apps/nuxeo-ui/public/i18n/en.json': EN_JSON_SHELL_SEARCH,
  'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK_SHELL_SEARCH,
  'apps/nuxeo-ui/src/app/shell/app-shell.component.html': HEADER_SEARCH_LABEL_TEMPLATE,
};

expectGreen(
  'header search associated visible label covered by fallback',
  'checkAccessibleNameFallbacks',
  APP_HEADER_SEARCH_LABEL,
);

expectRed(
  'header search visible label missing from the fallback',
  'checkAccessibleNameFallbacks',
  APP_HEADER_SEARCH_LABEL,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      EN_FALLBACK_SHELL_SEARCH.replace("  'shell.search.placeholder': 'Search documents',\n", ''),
    ),
  /visible label text.*`shell\.search\.placeholder`/s,
);

expectRed(
  'header search visible label blank in the fallback',
  'checkAccessibleNameFallbacks',
  APP_HEADER_SEARCH_LABEL,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      EN_FALLBACK_SHELL_SEARCH.replace(
        "'shell.search.placeholder': 'Search documents'",
        "'shell.search.placeholder': ''",
      ),
    ),
  /maps it to an empty string/,
);

const HEADER_SEARCH_KEY_OUTSIDE_LABEL = `<label class="header-search-label" for="global-header-search-input"></label>
<span>{{ 'shell.search.placeholder' | translate }}</span>
`;

expectRed(
  'header search translate outside the associated label must not satisfy the gate alone',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': EN_JSON_SHELL_SEARCH,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK,
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': HEADER_SEARCH_KEY_OUTSIDE_LABEL,
  },
  null,
  /asserted nothing/,
);

/* ---------------- checkNoHardcodedUiText ---------------- */

expectGreen('a template routing everything through the pipe', 'checkNoHardcodedUiText', APP);

expectRed(
  'hard-coded element text added',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/shell/app-shell.component.html',
      `${GOOD_TEMPLATE}<span>Show details</span>\n`,
    ),
  /introduces the text `Show details` as hard-coded English/,
);

expectRed(
  'hard-coded aria-label added',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/shell/app-shell.component.html',
      `${GOOD_TEMPLATE}<button type="button" aria-label="Close panel"></button>\n`,
    ),
  /introduces aria-label="Close panel"/,
);

expectRed(
  'hard-coded placeholder added',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/shell/app-shell.component.html',
      `${GOOD_TEMPLATE}<input placeholder="Search documents" />\n`,
    ),
  /introduces placeholder="Search documents"/,
);

/* ---------------- checkNoHardcodedUiText: the proven-fixture exemption ---------------- */
//
// This exemption had NO controls at all, which is how it was wrong twice before review caught
// a third. It decides whether a `*.host.html` / `*.spec.html` is test data — exempt from the
// hard-coded-English gate — or a template like any other, and it is meant to FAIL CLOSED.
//
// Round one compared basenames against whole file bodies and nothing else. Round two added the
// non-spec and asset-directory rules. Round three, here, is the half left over: "exactly one
// spec NAMES it" was still a basename appearing anywhere, which is not the property claimed. A
// reference is now resolved against the referring file's directory and compared by equality.

/** A fixture whose markup is deliberately the kind of prose the gate exists to catch. */
const FIXTURE_PROSE = '<div><span>Show details</span></div>\n';

/** A spec that really does host `name` as its template. */
const hostingSpec = (name) => `import { Component } from '@angular/core';

@Component({
  standalone: true,
  selector: 'test-host',
  templateUrl: './${name}',
})
class TestHost {}

it('renders', () => expect(TestHost).toBeTruthy());
`;

expectGreen(
  'a fixture referenced by exactly one sibling spec is exempt',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts': hostingSpec('widget.host.html'),
  },
);

// Copilot's case. `dashboard/widget.host.html` is referenced by nothing, but under basename
// matching it saw `shell/widget.spec.ts` — a spec for a DIFFERENT file — and was exempted on
// the strength of that. A fixture nobody hosts is just an unreferenced template.
expectRed(
  'a same-named fixture in another directory is not exempted by the first one’s spec',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts': hostingSpec('widget.host.html'),
    'apps/nuxeo-ui/src/app/dashboard/widget.host.html': FIXTURE_PROSE,
  },
  null,
  /dashboard\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// The other direction of the same defect, and the reason resolution beats a stricter basename
// rule: two fixtures that legitimately share a basename each have their own hosting spec. Under
// basename matching both saw two specs, failed the "exactly one" test, and NEITHER was exempt —
// a false rejection. Resolution gives each its own proof.
expectGreen(
  'two same-named fixtures each with their own hosting spec are both exempt',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts': hostingSpec('widget.host.html'),
    'apps/nuxeo-ui/src/app/dashboard/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/dashboard/widget.spec.ts': hostingSpec('widget.host.html'),
  },
);

// A mention is not a reference. Under basename matching, a spec that only talked ABOUT the file
// — in a comment, in a string, in a variable name — proved it was a fixture.
expectRed(
  'a bare mention in a spec comment does not prove a fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      '// See widget.host.html for the markup that reproduced this.\nit(' +
      "'passes', () => expect(true).toBe(true));\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// The same thing again with the path QUOTED, which is the shape the control above missed.
// References are taken from parsed string-literal tokens now, and a comment is not in the AST,
// so this is ruled out structurally rather than by a pattern that has to anticipate it. Kept as
// a separate control from the bare mention because a text scan passes one and fails the other.
expectRed(
  'a QUOTED path in a spec comment does not prove a fixture either',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      "// See './widget.host.html' for the markup that reproduced this.\nit(" +
      "'passes', () => expect(true).toBe(true));\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// ...and the other side of that: a reference in real code must still count, or the parser change
// would simply have disabled the exemption. `hostingSpec` puts it in a `templateUrl`, so this is
// the positive control for the AST path specifically.
expectGreen(
  'a fixture referenced from a block-commented spec’s live code is still exempt',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts':
      "/* Hosts './other.host.html' in an older revision — kept for context. */\n" +
      hostingSpec('widget.host.html'),
  },
);

// Round four: `..` that climbs above the repository root. `resolveRef` walked segments and
// popped on `..`, and `pop()` on an empty array is a no-op — so a path that really resolves
// outside the checkout was silently clamped back onto an in-repo file and proved ITS exemption.
// The function's own comment said such a reference "simply matches no fixture", which is the
// fail-closed contract it did not keep. Reported on the pull request.
expectRed(
  'a reference that traverses above the repository root proves nothing',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    // From `.../shell/deep`, seven `..` exhaust the six real segments and then underflow. The
    // surplus one used to vanish, leaving `apps/nuxeo-ui/src/app/shell/widget.host.html` —
    // the fixture — proven by a spec that never pointed inside the tree at all.
    'apps/nuxeo-ui/src/app/shell/deep/unrelated.spec.ts': hostingSpec(
      '../../../../../../../apps/nuxeo-ui/src/app/shell/widget.host.html',
    ),
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// Round four, second half: a quoted `.html` literal in executable code counted as a reference
// whether or not anything hosted it, so an unused `const ref = './widget.host.html'` exempted a
// template nobody serves. Parsing ruled out the comment case; it did not rule out this one. A
// reference now has to be the value of a `templateUrl` property, which is the only shape that
// makes the file a template under test.
expectRed(
  'an unused quoted path in a spec does not prove a fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      "const ref = './widget.host.html';\n" +
      "it('passes', () => expect(typeof ref).toBe('string'));\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// Round five, and the reason "restrict it to `templateUrl`" was not yet enough: `templateUrl`
// is just a property name, so any object literal carrying one counted. A decoy that hosts
// nothing — `const proof = { templateUrl: './widget.host.html' }` — exempted the fixture again.
// The property now has to sit in the object literal passed to `@Component(...)`, which is the
// only place it means "this file is my template". Reported on the pull request.
expectRed(
  'a decoy object literal with a templateUrl property does not prove a fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      "const proof = { templateUrl: './widget.host.html' };\n" +
      "it('passes', () => expect(typeof proof.templateUrl).toBe('string'));\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// ...and the same decoy one layer up, which is what "restrict it to `@Component`" missed on the
// first attempt: matching the call by callee name alone accepts a naked `Component({ ... })`
// invocation that decorates nothing. The call has to BE a decorator. Reported on the pull
// request, immediately after the property-name narrowing above.
expectRed(
  'a naked Component() call that decorates nothing does not prove a fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      "import { Component } from '@angular/core';\n\n" +
      "Component({ standalone: true, templateUrl: './widget.host.html' });\n\n" +
      "it('passes', () => expect(true).toBe(true));\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// ...and the last of them: the decorator's SPELLING is not its identity. A spec that declares
// its own decorator called `Component` and applies it hosts nothing Angular will ever compile,
// and exempted the fixture anyway. The name now has to be bound to `Component` from
// `@angular/core`, by import, so the check asks what the identifier resolves to rather than
// what it is called. Reported on the pull request.
expectRed(
  'a locally declared decorator named Component does not prove a fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/unrelated.spec.ts':
      'function Component(_meta: { templateUrl: string }) {\n' +
      '  return (target: unknown) => target;\n' +
      '}\n\n' +
      "@Component({ templateUrl: './widget.host.html' })\n" +
      'class NotAComponent {}\n\n' +
      "it('passes', () => expect(NotAComponent).toBeTruthy());\n",
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// The other side of it, or the resolution would just have disabled the exemption for anyone
// who renames the import. An alias is still the same binding.
expectGreen(
  'a fixture hosted through an aliased @angular/core Component import is exempt',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts': `import { Component as NgComponent } from '@angular/core';

@NgComponent({
  standalone: true,
  selector: 'test-host',
  templateUrl: './widget.host.html',
})
class TestHost {}

it('renders', () => expect(TestHost).toBeTruthy());
`,
  },
);

// Round two's property, also never controlled: a shipped component compiling the file means its
// text is not test data, so the fixture cannot hold the proof of its own exemption.
expectRed(
  'a fixture a production component hosts is not exempt',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.component.ts': hostingSpec('widget.host.html'),
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

// Shared markup is not a fixture: if two specs host the same file, keying its strings is a
// decision about shared code, so it stays inside the gate.
expectRed(
  'a template hosted by two specs is shared markup, not a proven fixture',
  'checkNoHardcodedUiText',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/widget.host.html': FIXTURE_PROSE,
    'apps/nuxeo-ui/src/app/shell/widget.spec.ts': hostingSpec('widget.host.html'),
    'apps/nuxeo-ui/src/app/shell/widget-two.spec.ts': hostingSpec('widget.host.html'),
  },
  null,
  /shell\/widget\.host\.html:1 introduces the text `Show details` as hard-coded English/,
);

/**
 * The false-positive controls. Each is a thing that sits where prose sits and is not prose; if
 * any of these went red the guardrail would be unusable and someone would switch it off, which
 * is a worse outcome than not having it.
 */
const NOT_PROSE = [
  ['an icon ligature', '<mat-icon>search</mat-icon>'],
  ['an interpolation', '<span>{{ document.title }}</span>'],
  ['a translated binding', `<span [attr.title]="'app.title' | translate"></span>`],
  ['a translated text node', `<span>{{ 'app.title' | translate }}</span>`],
  ['a single character', '<span>×</span>'],
  ['a number', '<span>42</span>'],
  ['an empty element', '<span></span>'],
  ['a comment', '<!-- Show details -->'],
  ['a class attribute', '<div class="Show details"></div>'],
];

for (const [label, line] of NOT_PROSE) {
  positive += 1;
  falsePositiveControls += 1;
  withFixture(
    APP,
    (write) =>
      write('apps/nuxeo-ui/src/app/shell/app-shell.component.html', `${GOOD_TEMPLATE}${line}\n`),
    (runGuardrail) => {
      const { code, out } = runGuardrail('checkNoHardcodedUiText');
      if (code !== 0) {
        failures.push(
          `false positive — ${label} was flagged as hard-coded text.\n    ${out.trim()}`,
        );
      }
    },
  );
}

/* ---------------- checkNoHardcodedDescriptorText ---------------- */

/** A descriptor file doing it right: the label is a translation key, not English. */
const GOOD_DESCRIPTORS = `export const NAV_ITEMS = [
  { id: 'app.navbar.browse', label: 'nav.browse', icon: 'folder' },
  { id: 'app.navbar.trash', label: 'nav.trash', icon: 'delete' },
];
`;

const WITH_DESCRIPTORS = {
  ...APP,
  'libs/shared/extensions/src/lib/nav-items.ts': GOOD_DESCRIPTORS,
};

expectGreen('descriptor labels that are keys', 'checkNoHardcodedDescriptorText', WITH_DESCRIPTORS);

expectRed(
  'a hard-coded descriptor label',
  'checkNoHardcodedDescriptorText',
  WITH_DESCRIPTORS,
  (write) =>
    write(
      'libs/shared/extensions/src/lib/nav-items.ts',
      `${GOOD_DESCRIPTORS}export const EXTRA = [{ id: 'x', label: 'Knowledge Discovery' }];\n`,
    ),
  /carries `label: 'Knowledge Discovery'` — a user-facing string in a descriptor/,
);

// A story's args are documentation sample data, like a spec's fixtures.
falsePositiveControls += 1;
expectGreen('a literal label in a story arg', 'checkNoHardcodedDescriptorText', {
  ...WITH_DESCRIPTORS,
  'libs/shared/satori-components/src/lib/tag/tag.stories.ts':
    "export const Default = { args: { label: 'Invoice' } };\n",
});

// …but only a `.stories.ts` file: the same literal in a neighbouring source file is still caught.
expectRed(
  'a literal label in a file merely named like a story',
  'checkNoHardcodedDescriptorText',
  WITH_DESCRIPTORS,
  (write) =>
    write(
      'libs/shared/satori-components/src/lib/tag/tag.stories-data.ts',
      "export const TAGS = [{ id: 'x', label: 'Invoice' }];\n",
    ),
  /tag\.stories-data\.ts:1 carries `label: 'Invoice'`/,
);

const SHELL = (title) =>
  `<!doctype html>\n<html lang="en">\n  <head>\n    <title>${title}</title>\n  </head>\n` +
  `  <body><app-root></app-root></body>\n</html>\n`;

expectRed(
  'an Angular interpolation in the document shell',
  'checkNoTemplateSyntaxInDocumentShell',
  { 'apps/nuxeo-ui/src/index.html': SHELL("{{ 'app.title' | translate }}") },
  null,
  /document shell/,
);

expectGreen('a static document title', 'checkNoTemplateSyntaxInDocumentShell', {
  'apps/nuxeo-ui/src/index.html': SHELL('Nuxeo Platform'),
});

// The comment in index.html that explains this rule quotes the syntax it forbids. The first
// run of the check failed on that comment, so the exemption is a control rather than a note.
expectGreen('the syntax quoted inside an HTML comment', 'checkNoTemplateSyntaxInDocumentShell', {
  'apps/nuxeo-ui/src/index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n` +
    `    <!-- Static on purpose: {{ 'x' | translate }} would render literally here. -->\n` +
    `    <title>Nuxeo Platform</title>\n  </head>\n  <body><app-root></app-root></body>\n</html>\n`,
});

// A gate that finds no file to read must say so rather than pass.
expectRed(
  'no document shell to check at all',
  'checkNoTemplateSyntaxInDocumentShell',
  { 'apps/nuxeo-ui/src/main.ts': 'export const x = 1;\n' },
  null,
  /asserted nothing/,
);

/* ---------------- checkNoRootAbsoluteShippedAssetPaths (NXSAT-318) ---------------- */

// What ships is derived from angular.json, so the fixture declares it the way the real one does:
// one input copied to the output root, and one node_modules input given an `output`.
const ASSETS_APP = (extra = {}) => ({
  'angular.json': `${JSON.stringify(
    {
      projects: {
        'nuxeo-ui': {
          root: 'apps/nuxeo-ui',
          architect: {
            build: {
              options: {
                assets: [
                  { glob: '**/*', input: 'apps/nuxeo-ui/public' },
                  { glob: '**/*', input: 'node_modules/vendor/assets', output: 'assets/vendor' },
                ],
              },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`,
  'apps/nuxeo-ui/public/favicon.ico': '',
  'apps/nuxeo-ui/public/images/art.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  'apps/nuxeo-ui/public/login/.gitkeep': '',
  'apps/nuxeo-ui/src/app/login/login.ts': "export const art = 'images/art.svg';\n",
  ...extra,
});

expectGreen(
  'shipped files referenced relative to the base href',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
);

expectRed(
  'a component field naming shipped art from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write('apps/nuxeo-ui/src/app/login/login.ts', "export const art = '/images/art.svg';\n"),
  /login\.ts:1 references a file the app ships from the server root/,
);

expectRed(
  'a template src attribute naming shipped art from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.html',
      '<p>Hi</p>\n<img src="/images/art.svg" alt="" />\n',
    ),
  /login\.html:2 references a file the app ships/,
);

expectRed(
  'a stylesheet url() naming shipped art from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.scss',
      '.hero {\n  background: url(/images/art.svg);\n}\n',
    ),
  /login\.scss:2 references a file the app ships/,
);

// `assets` only ships because of an `output`, and the reference is in a library.
expectRed(
  'a library fetching a vendor asset from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write('libs/shared/x/src/lib/x.ts', 'export const url = `/assets/vendor/${"en"}.json`;\n'),
  /libs\/shared\/x\/src\/lib\/x\.ts:1 references a file the app ships/,
);

// A top-level file, not a folder.
expectRed(
  'the favicon from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) => write('apps/nuxeo-ui/src/index.html', '<link rel="icon" href="/favicon.ico" />\n'),
  /index\.html:1 references a file the app ships/,
);

// The list is not hand-maintained: a folder added to public/ is covered the day it lands.
expectRed(
  'a newly shipped public folder referenced from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP({ 'apps/nuxeo-ui/public/fonts/brand.woff2': '' }),
  (write) =>
    write('apps/nuxeo-ui/src/styles.scss', "@font-face {\n  src: url('/fonts/brand.woff2');\n}\n"),
  /styles\.scss:2 references a file the app ships/,
);

// `/login` is a route and `login/` a shipped folder. A directory only matches with a segment
// after it, so router calls stay clean.
falsePositiveControls += 1;
expectGreen(
  'a router path that shares a shipped folder name',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/auth/guard.ts':
      "export const login = ['/login'];\nexport const to = (r: { navigateByUrl(u: string): void }) => r.navigateByUrl('/login');\n",
  },
);

falsePositiveControls += 1;
expectGreen('a server-absolute Nuxeo path', 'checkNoRootAbsoluteShippedAssetPaths', {
  ...ASSETS_APP(),
  'libs/shared/x/src/lib/x.ts':
    "export const icon = '/nuxeo/icons/note.gif';\nexport const config = '/nuxeo/agentic-ui-config/bootstrap.json';\n",
});

falsePositiveControls += 1;
expectGreen('a comment quoting the root-absolute form', 'checkNoRootAbsoluteShippedAssetPaths', {
  ...ASSETS_APP(),
  'apps/nuxeo-ui/src/app/login/login.ts':
    "/** Not `/images/art.svg`: that 404s under /nuxeo/agentic-ui/. */\nexport const art = 'images/art.svg';\n",
  'apps/nuxeo-ui/src/app/login/login.html':
    '<!-- not src="/images/art.svg" -->\n<img [src]="art" alt="" />\n',
  'apps/nuxeo-ui/src/app/login/login.scss':
    '// url(/images/art.svg) would 404 when packaged\n.hero {\n  color: red; // not url(/images/art.svg)\n}\n',
});

// CSS function names are case-insensitive.
expectRed(
  'an upper-case URL() from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.css',
      '.hero {\n  background: URL(/images/art.svg);\n}\n',
    ),
  /login\.css:2 references a file the app ships/,
);

// `url(` and its path on different lines; the path's own line is reported.
expectRed(
  'a multi-line stylesheet url() from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.scss',
      '.hero {\n  background: url(\n    /images/art.svg\n  );\n}\n',
    ),
  /login\.scss:3 references a file the app ships/,
);

// A comment opener inside a value is not a comment, so it must not blank what follows it.
expectRed(
  'a root-absolute url() after a quoted protocol-relative one',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.scss',
      '.hero {\n  background: url("//cdn.example/overlay.png"), url("/images/art.svg");\n}\n',
    ),
  /login\.scss:2 references a file the app ships/,
);

expectRed(
  'a root-absolute src after a comment opener inside an attribute',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.html',
      '<img title="<!--" src="/images/art.svg" alt="" />\n<!-- a later comment -->\n',
    ),
  /login\.html:1 references a file the app ships/,
);

falsePositiveControls += 1;
expectGreen(
  'protocol-relative and absolute URLs in a stylesheet',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/login/login.scss':
      '.a {\n  background: url(//cdn.example/x.png), url("https://cdn.example/y.png");\n}\n' +
      "/* url(/images/art.svg) */\n.b {\n  content: '//'; // url(/images/art.svg)\n}\n",
    'apps/nuxeo-ui/src/styles.css': '.c {\n  background: url(//cdn.example/x.png);\n}\n',
  },
);

// A query string carries a path to another host; its `=` and `,` do not open a value.
falsePositiveControls += 1;
expectGreen(
  'a shipped-looking path inside a URL query string',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/login/login.scss':
      '.a {\n  background: url("https://cdn.example/render?path=/images/art.svg");\n}\n' +
      '.b {\n  background: url(https://cdn.example/render?a=1,/images/art.svg);\n}\n',
    'apps/nuxeo-ui/src/app/login/login.html':
      '<img src="https://cdn.example/render?path=/images/art.svg" alt="" />\n' +
      '<img src=https://cdn.example/render?path=/images/art.svg alt="" />\n',
    'libs/shared/x/src/lib/x.ts':
      "export const u = 'https://cdn.example/render?path=/images/art.svg&b=1,/images/art.svg';\n",
  },
);

// A relative URL with a query: nothing inside a URL opens a value.
falsePositiveControls += 1;
expectGreen(
  'a shipped-looking path in a relative URL query',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/login/login.scss':
      '.hero {\n  background: url(render?path=/images/art.svg);\n}\n',
    'apps/nuxeo-ui/src/app/login/login.css':
      '.hero {\n  background: url(render?path=/images/art.svg);\n}\n',
    'apps/nuxeo-ui/src/app/login/login.html':
      '<div style="background: url(render?path=/images/art.svg)"></div>\n',
  },
);

// `1x,` and `100w,` are ordinary query text too.
falsePositiveControls += 1;
expectGreen(
  'a descriptor-like comma inside a URL query string',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/login/login.scss':
      '.a {\n  background: url(https://cdn.example/render?size=1x,/images/art.svg);\n}\n',
    'apps/nuxeo-ui/src/app/login/login.html':
      '<img src="https://cdn.example/render?variant=100w,/images/art.svg" alt="" />\n',
    'libs/shared/x/src/lib/x.ts':
      "export const u = 'https://cdn.example/render?size=1x,/images/art.svg';\n",
  },
);

// An Angular binding that concatenates a path onto a base: the quoted tail is a suffix.
falsePositiveControls += 1;
expectGreen(
  'a path concatenated onto a base in a template binding',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    ...ASSETS_APP(),
    'apps/nuxeo-ui/src/app/login/login.html': `<img [src]="assetBase + '/images/art.svg'" alt="" />\n`,
  },
);

expectRed(
  'a bound string literal from the server root',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write('apps/nuxeo-ui/src/app/login/login.html', `<img [src]="'/images/art.svg'" alt="" />\n`),
  /login\.html:1 references a file the app ships/,
);

// A literal that only ends a URL is placed by what precedes it, so it is not root-absolute.
falsePositiveControls += 1;
expectGreen('a path appended to a base URL', 'checkNoRootAbsoluteShippedAssetPaths', {
  ...ASSETS_APP(),
  'libs/shared/x/src/lib/x.ts':
    "const base = 'http://host/nuxeo/agentic-ui';\n" +
    'export const a = `${base}/images/art.svg`;\n' +
    "export const b = base + '/images/art.svg';\n",
});

// Blanking a trailing comment must not blank the code in front of it.
expectRed(
  'a stylesheet url() followed by a trailing comment',
  'checkNoRootAbsoluteShippedAssetPaths',
  ASSETS_APP(),
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/login/login.scss',
      ".hero {\n  background: url('/images/art.svg'); // decorative\n}\n",
    ),
  /login\.scss:2 references a file the app ships/,
);

falsePositiveControls += 1;
expectGreen('a spec asserting the root-absolute form', 'checkNoRootAbsoluteShippedAssetPaths', {
  ...ASSETS_APP(),
  'apps/nuxeo-ui/src/app/login/login.spec.ts':
    "expect(new URL('images/art.svg', 'http://h/').pathname).toBe('/images/art.svg');\n",
});

expectRed(
  'no application declares build assets at all',
  'checkNoRootAbsoluteShippedAssetPaths',
  {
    'angular.json': '{ "projects": { "x": { "root": "apps/x", "architect": {} } } }\n',
    'apps/x/src/main.ts': 'export const x = 1;\n',
  },
  null,
  /declares build assets, so checkNoRootAbsoluteShippedAssetPaths asserted nothing/,
);

expectRed(
  'prose in a plain attribute on a component',
  'checkNoProseInComponentInputs',
  { 'libs/features/x/src/lib/x.html': '<mat-tab label="Permissions"></mat-tab>\n' },
  null,
  /component input holding user-facing text/,
);

expectGreen('a bound and translated component input', 'checkNoProseInComponentInputs', {
  'libs/features/x/src/lib/x.html': `<mat-tab [label]="'x.tab.permissions' | translate"></mat-tab>\n`,
});

// The element pattern deliberately matches components, not HTML. `title` on a <button> is an
// HTML attribute and belongs to checkNoHardcodedUiText, which is diff-scoped; reporting it
// here as well would make every pre-existing one a blocker.
expectGreen('a plain attribute on an HTML element', 'checkNoProseInComponentInputs', {
  'libs/features/x/src/lib/x.html': '<button title="Save">x</button>\n',
});

// A non-text input that happens to start with a capital must not be flagged.
expectGreen('a non-text input with a capitalised value', 'checkNoProseInComponentInputs', {
  'libs/features/x/src/lib/x.html': '<mat-icon fontSet="Material Icons">home</mat-icon>\n',
});

const BOOTSTRAP = (defaultLanguage, available = ['en', 'fr']) =>
  `${JSON.stringify({ defaultLanguage, availableLanguages: available }, null, 2)}\n`;
const CATALOGUES = {
  'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
  'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
};

expectRed(
  'the generated pseudo-locale shipped as the default',
  'checkShippedDefaultLanguage',
  {
    ...CATALOGUES,
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json': BOOTSTRAP(
      'zz',
      ['en', 'fr'],
    ),
  },
  null,
  /GENERATED pseudo-locale/,
);

expectRed(
  'a default language with no catalogue behind it',
  'checkShippedDefaultLanguage',
  {
    ...CATALOGUES,
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json': BOOTSTRAP(
      'de',
      ['en', 'fr', 'de'],
    ),
  },
  null,
  /no catalogue exists for it/,
);

expectRed(
  'a default absent from availableLanguages',
  'checkShippedDefaultLanguage',
  {
    ...CATALOGUES,
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json': BOOTSTRAP(
      'fr',
      ['en'],
    ),
  },
  null,
  /absent from/,
);

expectGreen('a real shipped default', 'checkShippedDefaultLanguage', {
  ...CATALOGUES,
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json': BOOTSTRAP(
    'en',
    ['en', 'fr'],
  ),
});

// A gate that cannot find the file it checks must say so, not pass.
expectRed(
  'no packaged bootstrap.json at all',
  'checkShippedDefaultLanguage',
  { ...CATALOGUES },
  null,
  /asserted nothing/,
);

// ── slice 12: the sweep is repo-wide, so it must see an UNCHANGED file ──────────────────

expectRed(
  'a hard-coded string in a file the change never touched',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<button>Regression Bait</button>\n' },
  // No mutation: the file is in the baseline commit, so a diff-scoped check would not look.
  null,
  /Regression Bait/,
);

expectGreen('prose inside a multi-line HTML comment', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': '<!--\n  Some explanation in prose.\n-->\n<div></div>\n',
});

expectGreen('a code sample inside a pre block', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html':
    '<pre class="code-block">\nImport The Component From Somewhere\n</pre>\n',
});

// ── the three blind spots found reviewing NXSAT-227 ──────────────────────────────────────
//
// Each of these passed before the fix, and each was a shape the check was written to catch.

expectRed(
  'prose alone on its own line, as Prettier and Angular control flow write it',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div>placeholder</div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<button>\n  @if (saving()) {\n    <mat-spinner />\n  } @else {\n    Create\n  }\n</button>\n',
    ),
  /hard-coded English/,
);

expectRed(
  'literal text beside a translated attribute on the same line',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div>placeholder</div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      `<button [attr.aria-label]="'x.y' | translate">Show details</button>\n`,
    ),
  /hard-coded English/,
);

// The exemption must still apply to what actually earned it.
expectGreen('a fully translated element across several lines', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': `<button [attr.aria-label]="'x.y' | translate">\n  {{ 'x.z' | translate }}\n</button>\n`,
});

expectRed(
  'a catalogue value that is null rather than a string',
  'checkTranslationCatalogues',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": null\n}\n',
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
  },
  null,
  // Must name en.json. It used to drop the key and then blame fr.json for an "extra" one.
  /en\.json maps `a` to null/,
);

expectRed(
  'translator context that is an empty string',
  'checkTranslationContext',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{\n  "a": ""\n}\n',
  },
  null,
  /same as saying nothing/,
);

expectRed(
  'translator context that is only whitespace',
  'checkTranslationContext',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{\n  "a": "   "\n}\n',
  },
  null,
  /same as saying nothing/,
);

expectGreen('a label paired with a labelKey', 'checkNoHardcodedDescriptorText', {
  ...WITH_DESCRIPTORS,
  'libs/shared/extensions/src/lib/nav-items.ts':
    `${GOOD_DESCRIPTORS}export const PAIRED = [
` +
    `  { id: 'x', labelKey: 'nav.browse', label: 'Browse' },
];
`,
});

expectRed(
  'a hard-coded descriptor placeholder',
  'checkNoHardcodedDescriptorText',
  WITH_DESCRIPTORS,
  (write) =>
    write(
      'libs/shared/extensions/src/lib/nav-items.ts',
      `${GOOD_DESCRIPTORS}export const F = { placeholder: 'Enter a name for your saved search' };\n`,
    ),
  /carries `placeholder: 'Enter a name for your saved search'`/,
);

/**
 * The shapes that must NOT be flagged. `title` and `description` are excluded deliberately —
 * they name Nuxeo document properties and schema documentation as often as UI chrome, so
 * flagging them would mean arguing with the reviewer, and a check that argues gets disabled.
 */
for (const [label, line] of [
  ['a label that is already a key', `export const A = { label: 'nav.browse' };`],
  ['a lowercase value', `export const B = { label: 'folder' };`],
  ['an interpolated label', 'export const C = { label: `${prefix} items` };'],
  ['a title property', `export const D = { title: 'Saved Search' };`],
  ['a description property', `export const E = { description: 'Repository path of the doc.' };`],
  ['a commented-out label', `// label: 'Knowledge Discovery'`],
  ['a docblock mentioning one', ` * label: 'Knowledge Discovery'`],
]) {
  positive += 1;
  falsePositiveControls += 1;
  withFixture(
    WITH_DESCRIPTORS,
    (write) => write('libs/shared/extensions/src/lib/nav-items.ts', `${GOOD_DESCRIPTORS}${line}\n`),
    (runGuardrail) => {
      const { code, out } = runGuardrail('checkNoHardcodedDescriptorText');
      if (code !== 0) {
        failures.push(`false positive — ${label} was flagged.\n    ${out.trim()}`);
      }
    },
  );
}

expectRed(
  'a spec file is out of scope, but a real descriptor beside it is not',
  'checkNoHardcodedDescriptorText',
  WITH_DESCRIPTORS,
  (write) => {
    write(
      'libs/shared/extensions/src/lib/nav-items.spec.ts',
      `it('x', () => { const a = { label: 'Ignored In Specs' }; });\n`,
    );
    write(
      'libs/shared/extensions/src/lib/nav-items.ts',
      `${GOOD_DESCRIPTORS}export const G = { label: 'Real Descriptor' };\n`,
    );
  },
  /nav-items\.ts.*label: 'Real Descriptor'/s,
);

// ── controls for the blind spots Copilot found on #198 ───────────────────────────────────
//
// Each of these passed before the fix, and each is a shape the check was written to catch.

expectRed(
  'prose alone on its own line, as Prettier and Angular control flow write it',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div>placeholder</div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<button>\n  @if (saving()) {\n    <mat-spinner />\n  } @else {\n    Create\n  }\n</button>\n',
    ),
  /hard-coded English/,
);

expectRed(
  'literal text beside a translated attribute on the same line',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div>placeholder</div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      `<button [attr.aria-label]="'x.y' | translate">Show details</button>\n`,
    ),
  /hard-coded English/,
);

// The exemption must still apply to whatever actually earned it.
expectGreen('a fully translated element across several lines', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': `<button [attr.aria-label]="'x.y' | translate">\n  {{ 'x.z' | translate }}\n</button>\n`,
});

// `Object.entries(null)` throws, which killed the script and took every other guardrail's
// diagnostics with it. Going red for the right reason is the whole point of this one.
expectRed(
  'a catalogue that parses to null',
  'checkTranslationCatalogues',
  { 'apps/nuxeo-ui/public/i18n/en.json': 'null\n' },
  null,
  /parses but is null, not an object/,
);

expectRed(
  'a catalogue value that is null rather than a string',
  'checkTranslationCatalogues',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": null\n}\n',
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
  },
  null,
  // Must name en.json. It used to drop the key and then blame fr.json for an "extra" one.
  /en\.json maps `a` to null/,
);

expectRed(
  'translator context that is an empty string',
  'checkTranslationContext',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{\n  "a": ""\n}\n',
  },
  null,
  /same as saying nothing/,
);

expectRed(
  'a context file that parses to null',
  'checkTranslationContext',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': 'null\n',
  },
  null,
  /parses but is null/,
);

// The comment beside `availableLanguages` claimed an invariant nothing enforced.
expectRed(
  'an advertised locale with no catalogue behind it',
  'checkAdvertisedLocalesShip',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json':
      '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en", "es"]\n}\n',
  },
  null,
  // The message now names the catalogue directory it looked in, because the gate reads more than
  // one config and "no catalogue ships" was ambiguous about which application was meant.
  /advertises "es"[\s\S]*ships no catalogue for it/,
);

expectGreen('an advertised locale that ships', 'checkAdvertisedLocalesShip', {
  'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
  'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json':
    '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en", "fr"]\n}\n',
});

// ── controls for round two of the Copilot review ─────────────────────────────────────────

expectRed(
  'a bound literal in a text attribute',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div>placeholder</div>\n' },
  (write) =>
    write('libs/features/x/src/lib/x.html', `<button [title]="'Recently Edited'"></button>\n`),
  /Recently Edited/,
);

expectGreen('a bound TRANSLATED value in the same position', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': `<button [title]="'x.y' | translate"></button>\n`,
});

// `Object.entries(null)` throws. checkTranslationCatalogues records the shape error but
// cannot stop this guardrail crashing on the same file and taking the run's output with it.
expectRed(
  'a reference catalogue that parses to null, reaching the context gate',
  'checkTranslationContext',
  {
    'apps/nuxeo-ui/public/i18n/en.json': 'null\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{\n  "a": "context"\n}\n',
  },
  null,
  /parses but is null/,
);

// The rebrand demo edits the packaged config and the runbook says to reset it. It was not
// reset, and the demo branding reached a pull request inside an unrelated change.
expectRed(
  'the demo rebrand left in the packaged marketplace config',
  'checkPackagedConfigIsNotADemo',
  {
    'libs/shared/app-config/src/lib/bootstrap-config.ts':
      'export const DEFAULT_APP_BOOTSTRAP_CONFIG = {\n' +
      "  branding: { applicationTitle: 'Hyland Nuxeo' },\n  defaultThemeId: 'nuxeo',\n};\n",
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json':
      '{\n  "branding": { "applicationTitle": "Acme Content Cloud" },\n' +
      '  "defaultThemeId": "acme",\n  "themes": [{ "id": "acme" }]\n}\n',
  },
  null,
  /not the compiled default/,
);

const PACKAGED_OK = {
  'libs/shared/app-config/src/lib/bootstrap-config.ts':
    'export const DEFAULT_APP_BOOTSTRAP_CONFIG = {\n' +
    "  branding: { applicationTitle: 'Hyland Nuxeo' },\n  defaultThemeId: 'nuxeo',\n};\n",
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json':
    '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
    '  "defaultThemeId": "nuxeo",\n  "themes": []\n}\n',
};

expectGreen(
  'a packaged config matching the compiled defaults',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
);

// The second leak of this kind, and the one the three checks above could not see: an NXSAT-279
// ARender override pointing the annotation viewer at `http://localhost:8181`, swept into an
// unrelated i18n change by `git add -A`. Branding and themes were all correct, so every named-key
// check passed. The file is installed on a customer server, where a loopback address resolves to
// THEIR machine.
expectRed(
  'a local development URL in the packaged marketplace config',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
  (write) =>
    write(
      'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json',
      '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
        '  "defaultThemeId": "nuxeo",\n  "themes": [],\n' +
        '  "integrations": { "arender": { "viewerOrigin": "http://localhost:8181" } }\n}\n',
    ),
  /contains the local address `localhost`/,
);

// The same leak carried its own instruction to revert it, which is worth failing on by itself:
// the annotation survives even if the URL is later written as a hostname.
expectRed(
  'the packaged config declaring its own contents temporary',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
  (write) =>
    write(
      'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json',
      '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
        '  "defaultThemeId": "nuxeo",\n  "themes": [],\n' +
        '  "$integrations": "LOCAL DEV ONLY (NXSAT-279) - revert with git checkout.",\n' +
        '  "integrations": { "arender": { "viewerOrigin": "https://arender.example.com" } }\n}\n',
    ),
  /says `LOCAL DEV ONLY` about its own contents/,
);

// The template is the example a customer copies, so it is held to the same rule.
expectRed(
  'a local development URL in the customer-facing template config',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
  (write) =>
    write(
      'apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json',
      '{\n  "nuxeoApiOrigin": "http://127.0.0.1:8080"\n}\n',
    ),
  /contains the local address `127\.0\.0\.1`/,
);

// `127.0.0.2` is as much the customer's own machine as `127.0.0.1`, and the first version of this
// rule matched only the latter while its comment promised any loopback address.
expectRed(
  'a 127.0.0.0/8 address other than 127.0.0.1',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
  (write) =>
    write(
      'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json',
      '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
        '  "defaultThemeId": "nuxeo",\n  "themes": [],\n' +
        '  "integrations": { "arender": { "viewerOrigin": "http://127.0.0.2:8181" } }\n}\n',
    ),
  /contains the local address `127\.0\.0\.2`/,
);

expectRed(
  'the IPv6 loopback in a URL',
  'checkPackagedConfigIsNotADemo',
  PACKAGED_OK,
  (write) =>
    write(
      'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json',
      '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
        '  "defaultThemeId": "nuxeo",\n  "themes": [],\n' +
        '  "integrations": { "arender": { "viewerOrigin": "http://[::1]:8181" } }\n}\n',
    ),
  /contains the local address `\[::1\]`/,
);

expectGreen(
  'a real external integration host is not mistaken for a developer leak',
  'checkPackagedConfigIsNotADemo',
  {
    ...PACKAGED_OK,
    'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json':
      '{\n  "branding": { "applicationTitle": "Hyland Nuxeo" },\n' +
      '  "defaultThemeId": "nuxeo",\n  "themes": [],\n' +
      '  "integrations": { "arender": { "viewerOrigin": "https://arender.hyland.com" } }\n}\n',
  },
);

/* ---------------- checkInstallerOwnsNoCustomerFile (NXSAT-317, NXSAT-312) ---------------- */

const INSTALL_XML = 'nuxeo-agentic-ui-package/src/main/resources/install.xml';

/** The installer as it shipped before NXSAT-317, tags verbatim. */
const INSTALL_XML_BEFORE = `<install>
  <update file="\${package.root}/install/bundles" todir="\${env.bundles}" />
  <copy dir="\${package.root}/web" todir="\${env.server.home}/nxserver" overwrite="true" />
  <!-- overwrite="false" means an existing deployed file is left untouched -->
  <copy dir="\${package.root}/config"
        todir="\${env.server.home}/nxserver/nuxeo.war/agentic-ui-config"
        overwrite="false" />
</install>
`;

/** NXSAT-317's installer: the config directory carried only a sample, replaced on upgrade. */
const INSTALL_XML_SAMPLE = INSTALL_XML_BEFORE.replace(
  /overwrite="false" \/>/,
  'overwrite="true" />',
);

/** NXSAT-312's: configuration is contributed to the configuration service, nothing is copied. */
const INSTALL_XML_AFTER = `<install>
  <update file="\${package.root}/install/bundles" todir="\${env.bundles}" />
  <copy dir="\${package.root}/web" todir="\${env.server.home}/nxserver" overwrite="true" />
</install>
`;

// The NXSAT-317 defect. Rehearsed: an edited bootstrap.json survives the old version's md5-checked
// uninstall, this copy then throws on it, and the upgrade ends with no version installed.
expectRed(
  'the pre-NXSAT-317 installer copying config with overwrite="false"',
  'checkInstallerOwnsNoCustomerFile',
  { [INSTALL_XML]: INSTALL_XML_BEFORE },
  null,
  /install\.xml has a copy with overwrite="false"[\s\S]*agentic-ui-config/,
);

// The servlet owns /nuxeo/agentic-ui-config/, so even an overwriting copy there installs a file
// that is never served: a configuration that looks installed and does nothing.
expectRed(
  'the NXSAT-317 installer, copying a sample into agentic-ui-config',
  'checkInstallerOwnsNoCustomerFile',
  { [INSTALL_XML]: INSTALL_XML_SAMPLE },
  null,
  /install\.xml copies into agentic-ui-config[\s\S]*configuration servlet owns/,
);

expectRed(
  'a single file copied into agentic-ui-config with tofile',
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(
      '</install>',
      '  <copy file="${package.root}/acme-logo.svg" overwrite="true"\n' +
        '        tofile="${env.server.home}/nxserver/nuxeo.war/agentic-ui-config/acme-logo.svg" />\n' +
        '</install>',
    ),
  },
  null,
  /copies into agentic-ui-config[\s\S]*acme-logo\.svg/,
);

// The rule is about the attribute, not about the one file that tripped it.
expectRed(
  "overwrite='false' on any other file, single-quoted",
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(
      '</install>',
      "  <copy file='${package.root}/themes/acme.css' todir='${env.server.home}/x'\n" +
        "        overwrite='false' />\n</install>",
    ),
  },
  null,
  /has a copy with overwrite="false"[\s\S]*acme\.css/,
);

// Nuxeo's Copy defaults `overwrite` to false and parses the attribute only when it is non-empty,
// so leaving it out is the same defect — and so is any value parseBoolean does not read as true.
expectRed(
  'a copy with no overwrite attribute',
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(
      '</install>',
      "  <copy file='${package.root}/themes/acme.css' todir='${env.server.home}/x' />\n</install>",
    ),
  },
  null,
  /has a copy with no overwrite attribute, which Nuxeo runs as overwrite="false"[\s\S]*acme\.css/,
);

expectRed(
  'overwrite="yes", which parseBoolean reads as false',
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(
      '</install>',
      '  <copy file="${package.root}/themes/acme.css" todir="${env.server.home}/x" overwrite="yes" />\n</install>',
    ),
  },
  null,
  /has a copy with overwrite="yes", which Nuxeo runs as overwrite="false"/,
);

// The assembly stages from disk, so a file left in the old config directory is packaged even
// when nothing in install.xml copies it.
expectRed(
  'a file left in the old src/main/config directory',
  'checkInstallerOwnsNoCustomerFile',
  { [INSTALL_XML]: INSTALL_XML_AFTER },
  (write) => write('nuxeo-agentic-ui-package/src/main/config/bootstrap.example.json', '{}\n'),
  /src\/main\/config\/bootstrap\.example\.json is packaged for installation onto the server's disk/,
);

expectRed(
  'a bootstrap.json anywhere else in the package sources',
  'checkInstallerOwnsNoCustomerFile',
  { [INSTALL_XML]: INSTALL_XML_AFTER },
  (write) => write('nuxeo-agentic-ui-package/src/main/resources/bootstrap.json', '{}\n'),
  /src\/main\/resources\/bootstrap\.json is a bootstrap\.json in the marketplace package sources/,
);

falsePositiveControls += 1;
expectGreen('the NXSAT-312 installer', 'checkInstallerOwnsNoCustomerFile', {
  [INSTALL_XML]: INSTALL_XML_AFTER,
});

falsePositiveControls += 1;
expectGreen(
  'overwrite="TRUE", which parseBoolean reads as true',
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(/overwrite="true" \/>/, 'overwrite="TRUE" />'),
  },
);

expectRed(
  'no installer found at all',
  'checkInstallerOwnsNoCustomerFile',
  { 'nuxeo-agentic-ui-package/pom.xml': '<project/>\n' },
  null,
  /No install\.xml was found[\s\S]*asserted nothing/,
);

// The comment explaining the rule has to quote the attribute — here as a whole commented-out copy
// into agentic-ui-config, the strongest form of it. It must not trip either rule.
falsePositiveControls += 1;
expectGreen(
  'the installer with a commented-out overwrite="false" copy into agentic-ui-config',
  'checkInstallerOwnsNoCustomerFile',
  {
    [INSTALL_XML]: INSTALL_XML_AFTER.replace(
      '</install>',
      '  <!-- was: <copy dir="${package.root}/config" todir="nuxeo.war/agentic-ui-config" overwrite="false" /> -->\n</install>',
    ),
  },
);

// ── controls for round three of the Copilot review ───────────────────────────────────────

/**
 * A `crowdin-conf.yml` with two source entries, and the workflow pair that reads it.
 *
 * `checkCrowdinConfig` shipped with no controls at all, and the gap hid a real defect: its D8
 * options check asked `body.includes('export_only_approved')` once for the whole file, so with
 * two mappings it could not tell which entry declared what. Two entries is therefore the
 * minimum fixture — a single-entry one passes body-wide and per-entry checks identically and
 * would have proved nothing.
 */
const CROWDIN_ENTRY = (source) =>
  `    {\n` +
  `      'source': '${source}',\n` +
  `      'translation': '/%original_path%/%two_letters_code%.%file_extension%',\n` +
  `      'export_only_approved': 'true',\n` +
  `      'update_option': 'update_without_changes',\n` +
  `    },\n`;

const crowdinConf = (entries) =>
  `'base_url': 'https://hyland.api.crowdin.com'\n` +
  `'project_id_env': 'CROWDIN_PROJECT_ID'\n` +
  `'api_token_env': 'CROWDIN_PERSONAL_TOKEN'\n` +
  `'base_path': '.'\n` +
  `'preserve_hierarchy': true\n` +
  `'files': [\n${entries.join('')}  ]\n`;

const CROWDIN_WORKFLOW = (extra) =>
  `name: crowdin\non: push\njobs:\n  sync:\n    if: \${{ vars.CROWDIN_SYNC_ENABLED == 'true' }}\n` +
  `    runs-on: ubuntu-latest\n    steps:\n      - uses: crowdin/github-action@v2\n` +
  `        with:\n          config: crowdin-conf.yml\n${extra}`;

/** The input the pull workflow's downloading step must carry, so its commits are signed. */
const PULL_SIGNING = `          gpg_private_key: \${{ secrets.GPG_PRIVATE_KEY }}\n`;
/** What identifies the step the signing assertion must examine: the one that downloads. */
const PULL_DOWNLOAD = `          download_translations: true\n`;
/**
 * NOT part of the green fixture — both skip options are forbidden. `skip_untranslated_strings`
 * blanks every unapproved value for our nested JSON (#293); `skip_untranslated_files` withholds a
 * language until it is fully approved. See D8d and D8h.
 */
const PULL_SKIP_UNTRANSLATED = `          skip_untranslated_strings: true\n`;
const PULL_SKIP_UNTRANSLATED_FILES = `          skip_untranslated_files: true\n`;
const PULL_OK = PULL_DOWNLOAD + PULL_SIGNING;

const CROWDIN = {
  'crowdin-conf.yml': crowdinConf([
    CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
    CROWDIN_ENTRY('/libs/**/i18n/en.json'),
  ]),
  // The push workflow both WATCHES the context files and RUNS the uploader. The green fixture
  // originally had only the `paths`, which is the same gap the guardrail had — so the control for
  // the trigger passed while nothing asserted the job did any work.
  '.github/workflows/crowdin-push.yaml':
    CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
    `      - name: Push translator context\n` +
    `        run: node tools/i18n/crowdin-push-context.mjs\n`,
  // The pull workflow signs on the ACTION, because that is the only placement that signs
  // anything — see the control for it below.
  '.github/workflows/crowdin-pull.yaml': CROWDIN_WORKFLOW(PULL_OK),
  'apps/nuxeo-ui/public/i18n/en.json': EN_JSON,
  // A file for the SECOND pattern, because every pattern must now match something. Without
  // it this fixture is not "a valid two-entry config" at all — it is the defect the control
  // below describes, and it was silently being asserted as correct.
  'libs/shared/ui/src/lib/i18n/en.json': EN_JSON,
};

expectGreen('a D8-compliant two-entry Crowdin config', 'checkCrowdinConfig', CROWDIN);

// Crowdin fails the whole run on a pattern that matches nothing — and it fails AFTER uploading
// the files that did match, so the catalogue lands, the job goes red, and the context step
// that follows is skipped. `--dryrun` does not report it either, so this check is the only
// place it can be caught before a real run.
expectRed(
  'a source pattern that matches no file',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json'),
        CROWDIN_ENTRY('/apps/*/public/i18n/nothing-here.json'),
      ]),
    ),
  /nothing-here\.json` and nothing matches it/,
);

// Signing has to be configured on the ACTION, because `crowdin/github-action` is a Docker action
// and commits inside its own container. A host-level key import succeeds, changes nothing the
// container sees, and leaves the commit unsigned — a step that can neither fail nor work.
//
// The fixture deliberately KEEPS a host-level import step while removing the action's input, which
// is the exact arrangement that shipped. It is also what caught the first version of this check:
// that searched the whole file for `gpg_private_key:`, matched the host step's identically-named
// input, and passed on the defect.
expectRed(
  'the pull workflow importing a key on the host but not signing the action',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_DOWNLOAD).replace(
        '      - uses: crowdin/github-action@v2\n',
        `      - uses: crazy-max/ghaction-import-gpg@v6\n` +
          `        with:\n` +
          `          gpg_private_key: \${{ secrets.GPG_PRIVATE_KEY }}\n` +
          `          git_commit_gpgsign: true\n` +
          `      - uses: crowdin/github-action@v2\n`,
      ),
    ),
  /without passing `gpg_private_key`, so its commits are unsigned/,
);

// A failed step skips the rest of the job, so a translation upload placed ahead of the context
// push can stop the context ever being attached. The first real `seed_translations` run did
// precisely that: it failed on a token scope and skipped the context step behind it.
expectRed(
  'the push workflow uploading translations before pushing translator context',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// The same fail-closed rule on the ordering side. An expression-driven upload still RUNS, so it can
// still fail and still skip the context step behind it.
expectRed(
  'the push workflow hiding an upload_translations behind an Actions expression, before context',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: \${{ inputs.seed }}\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// The OTHER upload interface. The action runs a bare `command:`, so `command: upload translations`
// uploads without the boolean input ever appearing — and the ordering rule is about uploads, not
// about one spelling of one input.
expectRed(
  'the push workflow uploading translations via `command:` before the context push',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          command: upload translations\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// The same quoted-key form on the ordering side.
expectRed(
  'the push workflow uploading translations before context with a quoted key',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          'upload_translations': true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// A quoted `uses:` value. `uses: 'crowdin/github-action@…'` is valid workflow YAML, and matching
// only the bare form meant the step was not recognised as a Crowdin step at all — so every
// prohibition scoped to Crowdin steps skipped it and passed by absence. An unrecognised step is an
// unchecked step, which is the dangerous direction.
expectRed(
  'the push workflow quoting its uses value on an upload step before the context push',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: 'crowdin/github-action@v2'\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// An aliased input map hides exactly as much as a flow mapping does. The flow form was rejected and
// this one was not, which is how a limit that "fails closed" stopped being true of every spelling.
expectRed(
  'the push workflow declaring step inputs through a YAML alias',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with: *upload_inputs\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /declares Crowdin step inputs in a form this guardrail cannot read/,
);

// A `uses:` nested under `env:` belongs to that action's configuration, not to the step. Treating
// such a step as Crowdin's made the fail-closed rules fire on inputs that never reach Crowdin —
// here an expression-valued `command`, which is forbidden on a Crowdin step and fine on any other.
expectGreen(
  'an unrelated step mentioning the Crowdin action in a nested value',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-pull.yaml':
      CROWDIN_WORKFLOW(PULL_OK) +
      `      - name: Something else entirely\n` +
      `        uses: some-org/some-action@v1\n` +
      `        with:\n` +
      `          command: \${{ inputs.command }}\n` +
      `        env:\n` +
      `          uses: crowdin/github-action@v2\n`,
  },
);

// The two forms COMBINE: a flow-style step whose action reference is escaped names Crowdin in a
// spelling the substring test cannot see, inside a shape `yamlValues` cannot read — so neither
// fail-closed rule reached it. An unreadable action reference is reason enough on its own now.
expectRed(
  'a flow-style step whose escaped uses value names the Crowdin action',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - { uses: "crowdin\\u002fgithub-action@v2", with: { upload_translations: true } }\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /declares a step as a YAML flow mapping/,
);

// A colon inside a PLAIN scalar is not a key separator. Every depth-one colon was read as one, so
// `{ 'note': skip_untranslated_files:never }` invented a key the config does not declare.
expectGreen('a Crowdin entry whose plain scalar value contains a colon', 'checkCrowdinConfig', {
  ...CROWDIN,
  'crowdin-conf.yml': crowdinConf([
    CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
    CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
      `'update_option': 'update_without_changes',`,
      `'update_option': 'update_without_changes',\n      'note': skip_untranslated_files:never,`,
    ),
  ]),
});

// YAML resolves an escaped double-quoted scalar, so an escaped spelling is a WORKING spelling that
// every raw-text matcher here reads as something else. Rejected rather than decoded — that closes
// the encoding rather than one more member of it.
expectRed(
  'a Crowdin step whose uses value hides the slash behind a YAML escape',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: "crowdin\\u002fgithub-action@v2"\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /escaped double-quoted scalar/,
);

expectRed(
  'crowdin-conf.yml hiding the forbidden key behind a YAML escape',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
          `'update_option': 'update_without_changes',`,
          `'update_option': 'update_without_changes',\n      "skip\\u005funtranslated_files": true,`,
        ),
      ]),
    ),
  /contains an escaped double-quoted scalar/,
);

// A longer key CONTAINING the token is not the token. The entry fallback searched for a substring,
// so `'legacy_skip_untranslated_files'` — a key this repository does not use and Crowdin does not
// define, but valid YAML — rejected a config that declares nothing forbidden.
expectGreen(
  'a Crowdin entry with a longer key containing the forbidden token',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    'crowdin-conf.yml': crowdinConf([
      CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
      CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
        `'update_option': 'update_without_changes',`,
        `'update_option': 'update_without_changes',\n      'legacy_skip_untranslated_files': true,`,
      ),
    ]),
  },
);

// The token inside a quoted VALUE is not a key either.
expectGreen(
  'a Crowdin entry mentioning the forbidden token inside a quoted value',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    'crowdin-conf.yml': crowdinConf([
      CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
      CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
        `'update_option': 'update_without_changes',`,
        `'update_option': 'update_without_changes',\n      'note': 'skip_untranslated_files: never',`,
      ),
    ]),
  },
);

// An unrelated flow-style step hides nothing this guardrail reads, so rejecting it would be the
// cross-action false positive these scopes exist to avoid.
expectGreen('an unrelated flow-style step in a Crowdin workflow', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-push.yaml':
    CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
    `      - { uses: actions/checkout@v6, with: { ref: main } }\n` +
    `      - name: Push translator context\n` +
    `        run: node tools/i18n/crowdin-push-context.mjs\n`,
});

// An inline comment INSIDE an entry is a note, not configuration. The entry scan added for the
// one-line shape reads raw text, so a comment explaining why the option is absent was read as the
// option being present — the same mistake as the whole-file substring search, one scope smaller.
expectGreen(
  'a Crowdin entry whose inline comment mentions skip_untranslated_files',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    'crowdin-conf.yml': crowdinConf([
      CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
      CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
        `'update_option': 'update_without_changes',`,
        `'update_option': 'update_without_changes', # skip_untranslated_files: stays forbidden`,
      ),
    ]),
  },
);

// A flow-style STEP hides its own `uses:`, so nothing can tell whether it runs the Crowdin action
// — and every Crowdin-scoped rule skipped it rather than failing it. Rejected outright, before any
// scoping, because the unreadability is a level above the inputs.
expectRed(
  'a Crowdin step written as a one-line flow mapping',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - { uses: crowdin/github-action@v2, with: { upload_translations: true } }\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /declares a step as a YAML flow mapping/,
);

// A ONE-LINE flow entry is a shape the rest of this function understands — `crowdinFileEntries`
// parses it and the per-entry D8 checks read it — but `yamlValues` cannot see inside it. So the
// prohibition was bypassable by writing the entry on one line, which is valid and which the other
// checks accept.
expectRed(
  'crowdin-conf.yml hiding skip_untranslated_files in a one-line flow entry',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        `    { 'source': '/libs/**/i18n/en.json', 'translation': '/%original_path%/%two_letters_code%.%file_extension%', 'export_only_approved': 'true', 'update_option': 'update_without_changes', 'skip_untranslated_files': true },\n`,
      ]),
    ),
  /crowdin-conf\.yml sets `skip_untranslated_files`/,
);

// An INLINE comment is not configuration. `stripYamlComments` drops whole-line comments only, so a
// raw token search read `# skip_untranslated_files stays off` as the option being set — the gate
// reporting a defect in a correct file, and unfixable without deleting the note.
expectGreen(
  'crowdin-conf.yml mentioning skip_untranslated_files in an inline comment',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    'crowdin-conf.yml': crowdinConf([
      CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
      CROWDIN_ENTRY('/libs/**/i18n/en.json'),
    ]).replace(
      `'preserve_hierarchy': true`,
      `'preserve_hierarchy': true # skip_untranslated_files stays off, see D8h`,
    ),
  },
);

// The same rule one level down: a comment aligned with `with:` does not end the input mapping, and
// treating it as a dedent dropped every input after it — so an upload below such a comment was
// invisible to the ordering rule.
expectRed(
  'an upload_translations input after a comment aligned with the with key',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `        # seeding inputs below\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// `download_translations: 'true'` is honoured by the action, so the downloader must be FOUND. The
// selector wrote its own regex instead of reusing `yamlInputIsTrue`, and reported that the workflow
// had no downloader at all — a false red that reads like a real defect.
expectGreen('a pull workflow quoting the download_translations value', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-pull.yaml': CROWDIN_WORKFLOW(
    `          download_translations: 'true'\n` + PULL_SIGNING,
  ),
});

// A comment is not structure. One aligned with `steps:` was read as a dedent and ENDED step
// enumeration, so an upload after it was never examined while the context step before it was.
expectRed(
  'an upload hidden behind a comment aligned with the steps key, before context',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `    # everything below is the seeding half\n` +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// A quoted `'uses':` KEY, not just a quoted value. The step is then not recognised as a Crowdin
// step, so every Crowdin-scoped prohibition skips it and passes by absence.
expectRed(
  'a Crowdin step whose uses KEY is quoted, uploading before context',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        'uses': crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// Inputs under `env:` are passed to the action by nobody. The step does not download and does not
// sign, so the downloader must not be found there.
expectRed(
  'the download inputs placed under env: instead of with:',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      `name: crowdin\non: push\njobs:\n  sync:\n    if: \${{ vars.CROWDIN_SYNC_ENABLED == 'true' }}\n` +
        `    runs-on: ubuntu-latest\n    steps:\n      - uses: crowdin/github-action@v2\n` +
        `        with:\n          config: crowdin-conf.yml\n` +
        `        env:\n` +
        PULL_DOWNLOAD +
        PULL_SIGNING,
    ),
  /contains no `uses: crowdin\/github-action` step with `download_translations: true`/,
);

// A quoted `'with':` key hides the inputs just as a bare one does, so the opaque-input check has
// to see it too.
expectRed(
  'a Crowdin step hiding inputs behind a quoted with key',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        'with': { command: upload translations }\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /declares Crowdin step inputs in a form this guardrail cannot read/,
);

// A nested `run:` is not a command the runner executes. Under `with:` it is an action input, under
// `env:` a variable — and accepting one let a Crowdin step that uploads no context satisfy both
// context assertions. Step-level keys only.
expectRed(
  'a nested run: key standing in for the context step',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(
        `          command_args: '--delete-obsolete'\n` +
          `          run: node tools/i18n/crowdin-push-context.mjs\n`,
      ),
    ),
  /never runs `tools\/i18n\/crowdin-push-context\.mjs`/,
);

// A quoted or commented `steps:` key is still a steps block. A second job spelled either way was
// not enumerated at all, so a forbidden Crowdin step inside it was never checked while the normal
// job kept the mandatory assertions green.
expectRed(
  'a forbidden input inside a job whose steps key is quoted',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK) +
        `  second:\n    runs-on: ubuntu-latest\n    'steps': # sync\n` +
        `      - uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          download_translations: true\n` +
        `          skip_untranslated_files: true\n`,
    ),
  /declares `skip_untranslated_files: true`/,
);

// Masking by MIS-SPLITTING. When the step splitter recognised only `name:`/`uses:`-first items, an
// `if:`-first downloader was merged into the step before it — so that step's `gpg_private_key`
// satisfied the signing assertion while the real downloader had none. The wrong-step failure in its
// original form, reached by a different route.
expectRed(
  'an if-first downloader masked by the signing input on the preceding step',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(`          upload_sources: false\n` + PULL_SIGNING) +
        `      - if: \${{ always() }}\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        PULL_DOWNLOAD,
    ),
  /without passing `gpg_private_key`, so its commits are unsigned/,
);

// `- with: { … }` — the sequence marker can precede the first key, and `uses:` follows on a later
// line. The opaque-input detector anchored `with:` to the line start and missed it, so the hidden
// upload read as absent on exactly the step the check exists for.
expectRed(
  'a with-first Crowdin step hiding its inputs in a flow mapping',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - with: { command: upload translations }\n` +
        `        uses: crowdin/github-action@v2\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /declares Crowdin step inputs in a form this guardrail cannot read/,
);

// Execution, not text. The uploader's name appearing inside a block scalar is PROSE — no step runs
// it — so the "must attach translator context" guarantee must not be satisfied by a sentence
// describing the step it is looking for.
expectRed(
  'the context uploader named only in prose, with no step running it',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Say what we would do\n` +
        `        run: echo done\n` +
        `        env:\n` +
        `          NOTE: |\n` +
        `            run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /never runs `tools\/i18n\/crowdin-push-context\.mjs`/,
);

// A step whose FIRST key is not `name` or `uses`. `if:`, `id:` and `env:` are all valid there, and
// a step-parser that recognises only the common spelling does not see the step at all — so every
// check scoped to Crowdin steps skips it. Silent pass, same direction as the quoted `uses:` value.
expectRed(
  'an if-first Crowdin step setting skip_untranslated_files',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK) +
        `      - if: \${{ always() }}\n` +
        `        id: extra-download\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          download_translations: true\n` +
        `          skip_untranslated_files: true\n`,
    ),
  /declares `skip_untranslated_files: true`/,
);

// The same shape on the ordering rule, where an unseen step means an unseen upload.
expectRed(
  'an if-first Crowdin step uploading translations before the context push',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - if: \${{ always() }}\n` +
        `        name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// The bare-command DOWNLOAD path. At the pinned SHA a step with `command: download` runs
// `crowdin $INPUT_COMMAND $INPUT_COMMAND_ARGS` and returns before the boolean-driven path — so a
// second Crowdin step can download with the forbidden flag while the step found via
// `download_translations: true` carries none of it.
expectRed(
  'a second Crowdin step downloading via command: with the forbidden flag',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK) +
        `      - name: Download again\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          command: download --skip-untranslated-files\n`,
    ),
  /passes `--skip-untranslated-files` to a Crowdin step/,
);

// Same path, flag in `command_args` instead of the command scalar.
expectRed(
  'a second Crowdin step downloading via command: with the flag in command_args',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK) +
        `      - name: Download again\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          command: download\n` +
        `          command_args: '--skip-untranslated-files'\n`,
    ),
  /passes `--skip-untranslated-files` to a Crowdin step/,
);

// An opaque `with:` on an action that is NOT Crowdin cannot hide any of the three values these
// checks read, so it must not fail the gate. The first version of the opaque-input check scanned
// both whole files and failed exactly this — recreating the cross-action false positive the
// `command` scan had just been scoped to avoid.
expectGreen('an unrelated action using a flow mapping for its inputs', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-pull.yaml':
    CROWDIN_WORKFLOW(PULL_OK) +
    `      - name: Something else entirely\n` +
    `        uses: some-org/some-action@v1\n` +
    `        with: { command: value }\n`,
});

// A `command:` nobody can read counts as an upload, for the same reason a `${{ }}` boolean counts
// as true: it might be one, and failing closed is the only direction that cannot hide the
// skipped-context failure this rule exists for.
expectRed(
  'the push workflow running an unreadable command before the context push',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Do something\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          command: \${{ inputs.crowdin_command }}\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// `command:` is a generic input name. On an action that is not Crowdin it cannot upload anything,
// so an unreadable one ahead of the context push is not an ordering violation — classifying it as
// one failed the gate on a correct workflow.
expectGreen(
  'an unrelated action with an unreadable command before the context push',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-push.yaml':
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
      `      - name: Something else entirely\n` +
      `        uses: some-org/some-action@v1\n` +
      `        with:\n` +
      `          command: \${{ inputs.command }}\n` +
      `      - name: Push translator context\n` +
      `        run: node tools/i18n/crowdin-push-context.mjs\n`,
  },
);

// Masking, on the ordering side. An explicit `false` on an earlier step must not excuse an enabled
// upload on a later one that still sits ahead of the context push.
expectRed(
  'an earlier disabled upload masking a later enabled one ahead of the context push',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(
        `          command_args: '--delete-obsolete'\n          upload_translations: false\n`,
      ) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: true\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// And an upload explicitly switched off is not an upload, so it must not trip the ordering rule
// wherever it sits.
expectGreen('a disabled upload_translations step ahead of the context push', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-push.yaml':
    CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
    `      - name: Seed existing translations\n` +
    `        uses: crowdin/github-action@v2\n` +
    `        with:\n` +
    `          upload_translations: false\n` +
    `      - name: Push translator context\n` +
    `        run: node tools/i18n/crowdin-push-context.mjs\n`,
});

expectRed(
  'a push workflow that never attaches translator context at all',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`),
    ),
  /never runs `tools\/i18n\/crowdin-push-context\.mjs`/,
);

// The permitted half of the ordering rule, which the two controls above cannot reach between them:
// they cover "before" and "absent", so an implementation that rejected EVERY translation upload
// would satisfy both while contradicting the rule it claims to enforce. The rule is about order,
// not about uploading being forbidden — no real workflow uploads translations today, so without
// this control the allowed path is asserted nowhere.
expectGreen('a push workflow uploading translations AFTER the context push', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-push.yaml':
    CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
    `      - name: Push translator context\n` +
    `        run: node tools/i18n/crowdin-push-context.mjs\n` +
    `      - name: Upload existing translations\n` +
    `        uses: crowdin/github-action@v2\n` +
    `        with:\n` +
    `          upload_translations: true\n`,
});

// `skip_untranslated_strings: true` does not omit an unapproved key for our nested JSON — it
// exports the key with a BLANK value. The nightly pull of 29 September 2026 (#293) blanked every
// unapproved value in nine catalogues. This check REQUIRED the option until then; these controls are
// the inversion, so the requirement cannot come back.
expectRed(
  'the pull workflow setting skip_untranslated_strings',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + PULL_SKIP_UNTRANSLATED),
    ),
  /declares `skip_untranslated_strings: true`[\s\S]*#293/,
);

expectRed(
  'the pull workflow hiding skip_untranslated_strings behind an Actions expression',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          skip_untranslated_strings: \${{ true }}\n`),
    ),
  /declares `skip_untranslated_strings: \$\{\{ true \}\}`/,
);

// An explicit `false` is the action's own default, so it is not the defect.
expectGreen(
  'a pull workflow that explicitly disables skip_untranslated_strings',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-pull.yaml': CROWDIN_WORKFLOW(
      PULL_OK + `          skip_untranslated_strings: false\n`,
    ),
  },
);

expectRed(
  'the pull workflow passing --skip-untranslated-strings through download_translations_args',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(
        PULL_OK +
          `          download_translations_args: '--language=fr --skip-untranslated-strings'\n`,
      ),
    ),
  /passes `--skip-untranslated-strings` to a Crowdin step/,
);

// The positive half of the argument scan. The real workflow restricts the download to the
// languages the app ships with `--language`, and the forbidden-flag scan must let that through.
expectGreen('a pull workflow restricting the download with --language', 'checkCrowdinConfig', {
  ...CROWDIN,
  '.github/workflows/crowdin-pull.yaml': CROWDIN_WORKFLOW(
    PULL_OK + `          download_translations_args: '--language=fr --language=de'\n`,
  ),
});

expectRed(
  'crowdin-conf.yml setting skip_untranslated_strings',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json'),
      ]).replace(
        `'update_option': 'update_without_changes',`,
        `'update_option': 'update_without_changes',\n      'skip_untranslated_strings': true,`,
      ),
    ),
  /crowdin-conf\.yml sets `skip_untranslated_strings`/,
);

// A pull workflow with no action step at all: both assertions above would examine nothing, and
// before this the signing check simply skipped and carried the gate to green.
expectRed(
  'a pull workflow that never invokes crowdin/github-action',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK).replace(
        '      - uses: crowdin/github-action@v2\n',
        '      - uses: actions/checkout@v6\n',
      ),
    ),
  /contains no `uses: crowdin\/github-action` step/,
);

// Two Crowdin steps, with the forbidden option on the one that does NOT download. The prohibition
// reads every Crowdin step, so a preparation step is not a hiding place.
expectRed(
  'skip_untranslated_strings set on a preparation step rather than the downloader',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(`          upload_sources: false\n` + PULL_SKIP_UNTRANSLATED) +
        `      - uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          config: crowdin-conf.yml\n` +
        PULL_DOWNLOAD +
        PULL_SIGNING,
    ),
  /declares `skip_untranslated_strings: true`/,
);

// Only one of the two options can be active — Technical Usage Guide — so setting both guards
// neither loss reliably. crowdin-cli 4.14.2 is blunter and refuses the pair outright in
// `PropertiesWithFilesBuilder.checkArgParams()` before anything downloads. This check REQUIRED
// `skip_untranslated_files: true` for one commit, which would have made every nightly pull red;
// the control is here so the requirement cannot come back.
expectRed(
  'the pull workflow setting skip_untranslated_files as an action input',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + PULL_SKIP_UNTRANSLATED_FILES),
    ),
  /declares `skip_untranslated_files: true`/,
);

// The boolean input is one of THREE ways the flag reaches the CLI, and the first version of this
// prohibition guarded only that one. `download_translations_args` and `command_args` are appended
// to the command verbatim, so the option passes straight through while the check stays green and
// the nightly download still fails. Raised in review on PR #285.
expectRed(
  'the pull workflow smuggling --skip-untranslated-files through download_translations_args',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(
        PULL_OK + `          download_translations_args: '--skip-untranslated-files'\n`,
      ),
    ),
  /passes `--skip-untranslated-files` to a Crowdin step/,
);

// The same channel in a different YAML spelling. Inputs reach a Docker action as strings and
// `entrypoint.sh` compares with `[ "$INPUT_X" = true ]`, so `'true'` and a trailing comment are
// both honoured — while an anchored `:\s*true\s*$` matches neither. For a FORBIDDEN input that is
// a silent pass: the option runs and the gate stays green. Raised in review on PR #285.
expectRed(
  'the pull workflow setting skip_untranslated_files as a quoted string with a trailing comment',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          skip_untranslated_files: 'true' # belt and braces\n`),
    ),
  /declares `skip_untranslated_files: 'true'`/,
);

// The spelling that ended the enumeration. `${{ true }}` is resolved by Actions long after the
// guardrail runs, so no regex over the YAML can read it — which is why both forbidden inputs now
// fail CLOSED on any value that is not literally `false`, rather than matching truthy spellings one
// at a time. Three review rounds were spent adding spellings before that became obvious.
expectRed(
  'the pull workflow hiding skip_untranslated_files behind an Actions expression',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          skip_untranslated_files: \${{ true }}\n`),
    ),
  /declares `skip_untranslated_files: \$\{\{ true \}\}`/,
);

// An explicit `false` is the one value that is NOT the defect, so the fail-closed rule has to let
// it through — otherwise "remove the option" and "disable the option" would be indistinguishable
// and the message would be unactionable.
expectGreen(
  'a pull workflow that explicitly disables skip_untranslated_files',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-pull.yaml': CROWDIN_WORKFLOW(
      PULL_OK + `          skip_untranslated_files: false\n`,
    ),
  },
);

// Masking. Reading only the FIRST declaration let a harmless `false` on a preparation step excuse
// a `true` on the step that actually downloads — the same wrong-step blindness the `crowdinSteps`
// lookup exists to avoid, reintroduced one layer down. Every declaration is read now.
expectRed(
  'a preparation step disabling skip_untranslated_files while the downloader enables it',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(
        `          upload_sources: false\n          skip_untranslated_files: false\n`,
      ) +
        `      - uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          config: crowdin-conf.yml\n` +
        PULL_OK +
        `          skip_untranslated_files: true\n`,
    ),
  /declares `skip_untranslated_files: true`/,
);

// The quoted key reaches the action identically, so it is the same defect.
expectRed(
  'the pull workflow declaring skip_untranslated_strings with a quoted key',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          'skip_untranslated_strings': true\n`),
    ),
  /declares `skip_untranslated_strings: true`/,
);

// Key-shaped text inside a block scalar is PROSE, not configuration. `pull_request_body: |` is
// where these options get explained to whoever reads the generated pull request, so reading its
// lines as inputs made the check fire on its own documentation — and unfixable without deleting
// the explanation. The existing prose control covers the CLI spelling; this covers the input one.
expectGreen(
  'the pull request body explaining skip_untranslated_files in prose',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-pull.yaml':
      CROWDIN_WORKFLOW(PULL_OK) +
      `          pull_request_body: |\n` +
      `            We do not set skip_untranslated_files: true — only one of the two\n` +
      `            options can be active. See D8h.\n`,
  },
);

// Quoted keys. `'skip_untranslated_files': true` is valid YAML and reaches the action identically.
// Not hypothetical: `crowdin-conf.yml` quotes every key in this repository.
expectRed(
  'the pull workflow declaring skip_untranslated_files with a quoted key',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          'skip_untranslated_files': true\n`),
    ),
  /declares `skip_untranslated_files: true`/,
);

// Block scalars. `download_translations_args: >-` puts the value on the CONTINUATION lines, so a
// check that reads the key's own line captures `>-` and nothing else while the action folds the
// block and hands the flag to the CLI.
expectRed(
  'the downloading step smuggling --skip-untranslated-files through a folded block scalar',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(
        PULL_OK +
          `          download_translations_args: >-\n` +
          `            --skip-untranslated-files\n`,
      ),
    ),
  /passes `--skip-untranslated-files` to a Crowdin step/,
);

// An argument list that cannot be READ cannot be cleared, so it fails closed too. Two ways a value
// can be unreadable, and only the first was covered when this was written: an Actions expression is
// resolved after the gate runs, and a YAML alias is resolved from an anchor elsewhere in the
// document. Both mean the text the CLI gets is not the text here.
expectRed(
  'the downloading step building its download arguments from an expression',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(
        PULL_OK + `          download_translations_args: \${{ inputs.extra_args }}\n`,
      ),
    ),
  /gives a Crowdin step a command or argument this script cannot read/,
);

expectRed(
  'the downloading step taking its download arguments from a YAML alias',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      CROWDIN_WORKFLOW(PULL_OK + `          download_translations_args: *download_args\n`),
    ),
  /gives a Crowdin step a command or argument this script cannot read/,
);

// A flow-mapping `with:` hides every input from these checks, so three prohibitions would read as
// satisfied by absence. Rejected rather than parsed — but rejected LOUDLY, because a limit that
// passes quietly is what made the matcher indefensible in the first place.
expectRed(
  'the pull workflow declaring step inputs as a flow mapping',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-pull.yaml',
      `name: crowdin\non: push\njobs:\n  sync:\n    if: \${{ vars.CROWDIN_SYNC_ENABLED == 'true' }}\n` +
        `    runs-on: ubuntu-latest\n    steps:\n      - uses: crowdin/github-action@v2\n` +
        `        with: { config: crowdin-conf.yml, download_translations: true, skip_untranslated_files: true }\n`,
    ),
  /declares Crowdin step inputs in a form this guardrail cannot read/,
);

// Scope. `--skip-untranslated-files` reaches the CLI through `command`, `command_args` or
// `download_translations_args` on any CROWDIN step — three channels, and every Crowdin step, not
// only the one with `download_translations: true`, because `command: download` downloads too. A
// mention anywhere else — the pull request body is the realistic one, since it explains these very
// options — reaches the CLI on no path, and failing the gate on it would make the check unfixable
// without deleting the explanation.
expectGreen(
  'the pull request body mentioning --skip-untranslated-files in prose',
  'checkCrowdinConfig',
  {
    ...CROWDIN,
    '.github/workflows/crowdin-pull.yaml':
      CROWDIN_WORKFLOW(PULL_OK) +
      `          pull_request_body: |\n` +
      `            We do not pass --skip-untranslated-files; see D8h.\n`,
  },
);

// The ordering rule had the identical blind spot, and the consequence is the one D8c records: a
// quoted upload ahead of the context push runs, fails, and skips the context step behind it, while
// nothing reports that the rule was violated.
expectRed(
  'the push workflow uploading translations before context with a quoted upload_translations',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      '.github/workflows/crowdin-push.yaml',
      CROWDIN_WORKFLOW(`          command_args: '--delete-obsolete'\n`) +
        `      - name: Seed existing translations\n` +
        `        uses: crowdin/github-action@v2\n` +
        `        with:\n` +
        `          upload_translations: "true" # quoted, still honoured\n` +
        `      - name: Push translator context\n` +
        `        run: node tools/i18n/crowdin-push-context.mjs\n`,
    ),
  /uploads translations before pushing translator context/,
);

// The third channel. The CLI validates the pair in the config file too, via `FileBean`, so moving
// the option out of the workflow does not avoid the conflict — D8h said so while nothing enforced
// it.
expectRed(
  'crowdin-conf.yml setting skip_untranslated_files',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json'),
      ]).replace(`'files': [`, `'skip_untranslated_files': true\n'files': [`),
    ),
  /crowdin-conf\.yml sets `skip_untranslated_files`/,
);

// The founding defect. Both options deleted from the SECOND entry only: the first still
// contains both tokens, so the body-wide check this replaced stayed green here.
expectRed(
  'one Crowdin source entry stripped of both D8 options',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        `    {\n      'source': '/libs/**/i18n/en.json',\n` +
          `      'translation': '/%original_path%/%two_letters_code%.%file_extension%',\n    },\n`,
      ]),
    ),
  /entry `\/libs\/\*\*\/i18n\/en\.json` omits `export_only_approved`/,
);

// Presence is not the policy — the VALUE is. `export_only_approved: 'false'` does the opposite of
// what the Guidelines require and satisfied every token-counting form of this check. It was
// briefly the required value here, which is exactly why the control asserts the value and not the
// key: see D8g.
expectRed(
  'a Crowdin entry that declares export_only_approved and disables it',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
          `'export_only_approved': 'true'`,
          `'export_only_approved': 'false'`,
        ),
      ]),
    ),
  /sets `export_only_approved: false`, not `true`/,
);

// An ABSENT mapping, which is what a check that iterates only the values it finds cannot see.
// With the `translation` line deleted from the second entry, the source count still said two, the
// segment count still said two, and the surviving entry's valid pattern carried the gate to green.
expectRed(
  'a Crowdin entry that declares no translation mapping at all',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(/\s*'translation': '[^']*',/, ''),
      ]),
    ),
  /entry `\/libs\/\*\*\/i18n\/en\.json` declares no `translation`/,
);

// A mapping that is present but wrong, per entry rather than anywhere in the body.
expectRed(
  'one Crowdin entry mapping translations to a regional filename',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      crowdinConf([
        CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
        CROWDIN_ENTRY('/libs/**/i18n/en.json').replace(
          '%two_letters_code%.%file_extension%',
          '%locale%.json',
        ),
      ]),
    ),
  /entry `\/libs\/\*\*\/i18n\/en\.json` maps translations to `[^`]*%locale%\.json`/,
);

// A gate that cannot segment the file must say so rather than report a policy it stopped
// enforcing. Block-style YAML is valid Crowdin config and this segmenter does not read it.
expectRed(
  'a files block this guardrail cannot segment',
  'checkCrowdinConfig',
  CROWDIN,
  (write) =>
    write(
      'crowdin-conf.yml',
      `'base_url': 'https://hyland.api.crowdin.com'\n'base_path': '.'\n` +
        `'files':\n  - 'source': '/apps/*/public/i18n/en.json'\n` +
        `    'translation': '/%original_path%/%two_letters_code%.%file_extension%'\n` +
        `    'export_only_approved': 'true'\n    'update_option': 'update_without_changes'\n`,
    ),
  /cannot segment into entries/,
);

/* ---------------- checkNoReviewCorpusChurn ---------------- */

/**
 * Both halves of the corpus check, which shipped with neither.
 *
 * They are separate assertions and neither implies the other: the path half catches the corpus
 * file returning under its own name, the marker half catches the generated statistics block
 * returning to any file — including under a different name, which the path half cannot see.
 */
// Split, like the guardrail's own copy is. `checkNoReviewCorpusChurn` fails any ADDED line
// carrying this marker, and it does not exempt itself or this file — so writing it whole here
// makes the gate red on the change that adds its controls. That is the fourth time a guardrail
// in this repository has matched the text describing it; the split is the standing workaround.
const CORPUS_MARKER = `pr-review-stats${':'}start`;
/** The guardrail's diagnostic, assembled so this line does not contain the marker either. */
const CORPUS_MARKER_MESSAGE = new RegExp(`adds a generated \`${CORPUS_MARKER}\` block`);

expectGreen('a diff that touches no review bookkeeping', 'checkNoReviewCorpusChurn', {
  'docs/some-doc.md': '# A document\n',
});

expectRed(
  'the tracked findings corpus back in the diff',
  'checkNoReviewCorpusChurn',
  { 'docs/some-doc.md': '# A document\n' },
  (write, git) => {
    write('docs/pr-review-findings.jsonl', '{"finding":"one"}\n');
    // Staged, because `git diff` does not report an untracked path. Written and left untracked,
    // this control was green against a tree carrying the corpus — it asserted nothing.
    git(['add', 'docs/pr-review-findings.jsonl']);
  },
  /docs\/pr-review-findings\.jsonl is back in the diff/,
);

expectRed(
  'the generated statistics block re-added under another path',
  'checkNoReviewCorpusChurn',
  { '.cursor/skills/pre-pr-review/SKILL.md': '# Pre-PR review\n' },
  (write) =>
    write(
      '.cursor/skills/pre-pr-review/SKILL.md',
      `# Pre-PR review\n\n<!-- ${CORPUS_MARKER} -->\n| finding | count |\n`,
    ),
  CORPUS_MARKER_MESSAGE,
);

// The marker check reads ADDED lines, not file contents, so a pull request that merely touches
// a file already carrying the marker is not blamed for it. Without this the check would go red
// on every unrelated change to that file, and a gate nobody can pass gets bypassed.
falsePositiveControls += 1;
expectGreen('a file that already carried the marker before this diff', 'checkNoReviewCorpusChurn', {
  '.cursor/skills/pre-pr-review/SKILL.md': `# Pre-PR review\n\n<!-- ${CORPUS_MARKER} -->\n`,
});

/* ---------------- checkNoHardcodedDialogText: scope, not field list ---------------- */

// This gate exists because the two nearby ones cannot reach a dialog's text: the template sweep
// reads templates and this is built in TypeScript, and the descriptor check excludes `title`
// deliberately. Its whole correctness rests on SCOPE — strict inside a dialog's data, silent
// outside it — so both halves of that need a control.

expectRed(
  'a hard-coded title in a ConfirmDialogData',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "const data = {\n  title: 'Delete Document',\n} as ConfirmDialogData;\n",
    ),
  /sets `title: 'Delete Document'` in a dialog's data/,
);

expectRed(
  'a hard-coded message in the data: of an open() call',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "dialog.open(C, {\n  data: { message: 'Are you sure?' },\n});\n",
    ),
  /sets `message: 'Are you sure\?'` in a dialog's data/,
);

expectRed(
  'a hard-coded confirmLabel in a function returning DialogData',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/shared/ui/src/lib/y.ts',
      "export function d(): ConfirmDialogData {\n  return { confirmLabel: 'Delete' };\n}\n",
    ),
  /sets `confirmLabel: 'Delete'` in a dialog's data/,
);

// The false positive that made widening `checkNoHardcodedDescriptorText` the wrong fix. A
// synthetic Nuxeo document has a `title` and is not prose; `browse.service.ts` builds one with
// `title: 'Root'`. If this gate ever flags that, it has stopped being scope-anchored and will be
// switched off like any check that argues with its reviewer.
falsePositiveControls += 1;
expectGreen('a synthetic document title outside any dialog', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/shared/nuxeo-client/src/lib/services/z.service.ts':
    "export const root = {\n  uid: 'virtual-root',\n  title: 'Root',\n  type: 'Root',\n};\n",
});

falsePositiveControls += 1;
expectGreen('a dialog title read from a catalogue', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "const data = {\n  title: this.translate.instant('confirm.delete-document'),\n} as ConfirmDialogData;\n",
});

// A `data:` object carrying an id or a uid is the common shape and must stay silent: only the
// text-bearing fields are in the pattern.
falsePositiveControls += 1;
expectGreen('a dialog data object with no user-facing text', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/features/x/src/lib/x.ts': "dialog.open(C, {\n  data: { id: 'Ab12', uid: 'X9' },\n});\n",
});

/* ---------------- the mixed-language sentence, either side of a value ---------------- */

// Fifty-one of these were in the tree with the whole sweep green: `ELEMENT_TEXT` needs `>` and `<`
// with no braces between them, and `BARE_PROSE_LINE` rejects `{`, so English beside an interpolated
// value was judged by nothing.

expectRed(
  'prose before an interpolated value',
  'checkNoHardcodedUiText',
  APP,
  (write) => write('libs/features/x/src/lib/x.html', '<h2>Create Version for {{ title }}</h2>\n'),
  /the text `Create Version for` beside an interpolated value/,
);

// The load-bearing control. A sentence CONTINUATION is lowercase, and `isDisplayText` requires an
// initial capital — so the predicate that guards the rest of this check would have excluded exactly
// the half of the sentence this case exists to find.
expectRed(
  'prose after an interpolated value, which is lowercase',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<p><strong>{{ name }}</strong> workflow on this document.</p>\n',
    ),
  /the text `workflow on this document\.` beside an interpolated value/,
);

// `BARE_PROSE_LINE` rejects `"`, which hid this shape specifically.
expectRed(
  'prose quoting an interpolated value',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write('libs/features/x/src/lib/x.html', '<p>Content for "{{ item }}" will appear here.</p>\n'),
  /beside an interpolated value/,
);

// Prettier splits an element across lines, leaving a partial tag on each. Without stripping those,
// `{{ x }}</span` reported the fragment `/span` and the check looked broken rather than useful.
falsePositiveControls += 1;
expectGreen('a partial tag left by Prettier is not prose', 'checkNoHardcodedUiText', {
  ...APP,
  'libs/features/x/src/lib/x.html': '<span class="c"\n  >{{ \'a.b\' | translate }}</span\n>\n',
});

// Units beside a bound number are not translatable prose, and a shape heuristic cannot tell them
// from short English words, so they are listed explicitly.
falsePositiveControls += 1;
expectGreen('a unit beside an interpolated number', 'checkNoHardcodedUiText', {
  ...APP,
  'libs/features/x/src/lib/x.html': '<span>{{ rate() }} fps</span>\n',
});

falsePositiveControls += 1;
expectGreen('a fully parameterised sentence', 'checkNoHardcodedUiText', {
  ...APP,
  'libs/features/x/src/lib/x.html':
    "<p>{{ 'x.slot-empty' | translate: { name: item.label } }}</p>\n",
});

/* ---------------- the sink holes a reviewer had to find ---------------- */

// Three shapes the first version of `checkNoHardcodedImperativeUiText` reported clean, each of which
// made the "333 strings" count I quoted from it an understatement.

expectRed(
  'a literal in a TERNARY, not the direct first argument',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'this.snackBar.open(\n' +
        "  denied(err) ? KEY : 'Failed to update collection',\n" +
        "  this.translate.instant('common.ok'),\n" +
        ');\n',
    ),
  /passes the hard-coded string `Failed to update collection`/,
);

expectRed(
  'a signal whose name ENDS in Error rather than beginning with it',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.recentlyEditedError.set('Failed to load documents.');\n",
    ),
  /passes the hard-coded string `Failed to load documents\.`/,
);

expectRed(
  'a literal reached through a ?? fallback',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.agentsError.set(err?.error?.detail ?? 'Failed to load agents.');\n",
    ),
  /passes the hard-coded string `Failed to load agents\.`/,
);

// Matching anywhere in the argument costs two false positives, and both must stay green or the
// check starts arguing with its reviewer.
falsePositiveControls += 1;
expectGreen('an operation name handed to a nested call', 'checkNoHardcodedImperativeUiText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "this.agentsErrorDetail.set(this.captureError('HylandKnowledgeDiscovery.getAllAgents', err));\n",
});

falsePositiveControls += 1;
expectGreen('a literal used in a comparison', 'checkNoHardcodedImperativeUiText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "this.error.set(message.startsWith('Cannot sort by') ? message : this.translate.instant('x.k'));\n",
});

/* ---------------- a text attribute is prose whatever its first letter ---------------- */

// `isDisplayText` requires an initial capital, which is right in text position and wrong for an
// attribute whose NAME already establishes that the value is prose. It hid every lowercase
// placeholder, including the date masks that differ by locale.
expectRed(
  'a lowercase placeholder',
  'checkNoHardcodedUiText',
  APP,
  (write) => write('libs/features/x/src/lib/x.html', '<input placeholder="mm/dd/yyyy" />\n'),
  /placeholder="mm\/dd\/yyyy"/,
);

expectRed(
  'a lowercase example placeholder',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<input placeholder="e.g. All PDFs created last month" />\n',
    ),
  /placeholder="e\.g\. All PDFs created last month"/,
);

// A repository path is structure: translating a segment would make the example wrong.
falsePositiveControls += 1;
expectGreen('a path placeholder', 'checkNoHardcodedUiText', {
  ...APP,
  'libs/features/x/src/lib/x.html':
    '<input placeholder="/default-domain/workspaces/MyWorkspace" />\n',
});

/* ---------------- this.translate must be injected, per class ---------------- */

expectRed(
  'a class using this.translate without injecting it',
  'checkTranslateIsInjectedWhereUsed',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'export class XComponent {\n' +
        "  fail() { this.error.set(this.translate.instant('x.k')); }\n" +
        '}\n',
    ),
  /uses `this\.translate` but never injects it/,
);

// The variant that actually happened: one file, several classes, the injection added to the first.
expectRed(
  'a second class in the same file missing the injection',
  'checkTranslateIsInjectedWhereUsed',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'export class FirstService {\n' +
        '  private readonly translate = inject(TranslateService);\n' +
        "  a() { return this.translate.instant('x.a'); }\n" +
        '}\n' +
        'export class SecondService {\n' +
        "  b() { return this.translate.instant('x.b'); }\n" +
        '}\n',
    ),
  /class `SecondService` uses `this\.translate` but never injects it/,
);

/* ---------------- a comment may end with --!> as well as --> ---------------- */

// `--!>` is a valid comment terminator (the spec's comment-end-bang state). Recognising only `-->`
// made `blankSkippableSpans` read a CLOSED comment as open and blank to end of file, which removed
// every string after it from this gate's sight. CodeQL flagged the same pattern in `extract.mjs`,
// where it merely skips an extraction; here it disables the check for the rest of the file.
expectRed(
  'a hard-coded string after a comment closed with --!>',
  'checkNoHardcodedUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<!-- a note --!>\n<button title="Recently Edited"></button>\n',
    ),
  /title="Recently Edited"/,
);

// The ordinary terminator must still work, and the comment's own prose must stay exempt.
falsePositiveControls += 1;
expectGreen('prose inside a comment closed with --!>', 'checkNoHardcodedUiText', {
  ...APP,
  'libs/features/x/src/lib/x.html': '<!-- Explains the slot in prose. --!>\n<div></div>\n',
});

/* ---------------- imperative UI text, built in TypeScript ---------------- */

// The class that survived eight review rounds: 333 strings in snackbars, status signals and toasts.
// Three checks agreed the tree was clean and none of them read the place these live.

expectRed(
  'a hard-coded snackbar message',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write('libs/features/x/src/lib/x.ts', "this.snackBar.open('Document restored.', 'OK');\n"),
  /passes the hard-coded string `Document restored\.` to a user-facing sink/,
);

expectRed(
  'a hard-coded snackbar ACTION label, which is as visible as the message',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.snackBar.open(this.translate.instant('x.k'), 'Dismiss');\n",
    ),
  /passes the hard-coded string `Dismiss` to a user-facing sink/,
);

expectRed(
  'a hard-coded error signal, which a template renders',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write('libs/features/x/src/lib/x.ts', "this.error.set('Failed to load folder contents.');\n"),
  /passes the hard-coded string `Failed to load folder contents\.` to a user-facing sink/,
);

// A resolved message must stay green, or the check pushes authors back to literals.
falsePositiveControls += 1;
expectGreen('a snackbar resolved from the catalogue', 'checkNoHardcodedImperativeUiText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "this.snackBar.open(this.translate.instant('x.restored'), this.translate.instant('common.ok'));\n",
});

// `console` and `throw` are developer diagnostics, not UI. Including them would make the check
// argue with its reviewer on most hits, which is how a check gets switched off.
falsePositiveControls += 1;
expectGreen('a console message and a thrown error', 'checkNoHardcodedImperativeUiText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "console.warn('Could not parse the response.');\nthrow new Error('Unreachable state.');\n",
});

/* ---------------- a catalogue value must be what a user sees ---------------- */

expectRed(
  'an HTML character reference in a catalogue value',
  'checkCatalogueValuesAreRenderable',
  APP,
  (write) => write('apps/nuxeo-ui/public/i18n/en.json', '{\n  "a": "Users &amp; Groups"\n}\n'),
  /contains an HTML character reference/,
);

expectRed(
  'an (s) plural suffix in a catalogue value',
  'checkCatalogueValuesAreRenderable',
  APP,
  (write) => write('apps/nuxeo-ui/public/i18n/en.json', '{\n  "a": "Choose file(s)"\n}\n'),
  /pluralises with an `\(s\)` suffix/,
);

falsePositiveControls += 1;
expectGreen('an ampersand stored as itself', 'checkCatalogueValuesAreRenderable', {
  ...APP,
  'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "Users & Groups"\n}\n',
});

/* ---------------- the contract marker, not the prose around it ---------------- */

// The first version of this gate matched a sentence, and the commit that added it reworded that
// sentence — so the gate could never fire. Both halves need a control: the marker must exist, and
// what it promises must still be true.

expectRed(
  'the contract marker deleted, leaving the gate inert',
  'checkNoStaleAgnosticClaim',
  APP,
  (write) =>
    write(
      'libs/shared/extensions/src/lib/extension-actions.ts',
      'export function descriptorLabel(\n' +
        '  descriptor: { readonly label: string },\n' +
        '  translate: (key: string) => string,\n' +
        '): string {\n  return translate(descriptor.label);\n}\n',
    ),
  /marker, so this gate asserted nothing/,
);

expectRed(
  'the resolver parameter removed while the marker still claims it',
  'checkNoStaleAgnosticClaim',
  APP,
  (write) =>
    write(
      'libs/shared/extensions/src/lib/extension-actions.ts',
      '/** @i18n-contract:descriptor-api-is-framework-agnostic */\n' +
        'export function descriptorLabel(descriptor: { readonly label: string }): string {\n' +
        '  return descriptor.label;\n}\n',
    ),
  /no longer takes a resolver function/,
);

/* ------------- checkNoHardcodedDialogText: every literal form, not just one ------------- */

// The first version matched single quotes only and reported green over ten template-literal dialog
// messages. A template literal is the worst form, not an equivalent one: it interpolates, so it is
// a concatenation a translator cannot reorder.

expectRed(
  'a template-literal dialog message',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'const d = {\n  message: `Delete group "${name}"?`,\n} as ConfirmDialogData;\n',
    ),
  /sets `message: `Delete group "\$\{name\}"\?`` in a dialog's data/,
);

expectRed(
  'an interpolated dialog message is named as a concatenation, not just untranslated',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'const d = {\n  message: `Delete "${name}"?`,\n} as ConfirmDialogData;\n',
    ),
  /This one INTERPOLATES, so it is a concatenation as well as untranslated/,
);

expectRed(
  'a double-quoted dialog title',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'const d = {\n  title: "Delete",\n} as ConfirmDialogData;\n',
    ),
  /sets `title: "Delete"` in a dialog's data/,
);

// A template literal that resolves a key is the CORRECT shape and must stay green, or the check
// would push authors back to concatenation to appease it.
falsePositiveControls += 1;
expectGreen('a dialog message built from a resolved key', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    'const d = {\n' +
    "  message: this.translate.instant('confirm.delete-named', { name }),\n" +
    '} as ConfirmDialogData;\n',
});

/* ---------------- checkNoStaleAgnosticClaim: the comment must match the imports ---------------- */

expectRed(
  'the contract claimed while descriptorLabel no longer honours it',
  'checkNoStaleAgnosticClaim',
  APP,
  (write) =>
    write(
      'libs/shared/extensions/src/lib/extension-actions.ts',
      '/** @i18n-contract:descriptor-api-is-framework-agnostic */\n' +
        'export function descriptorLabel(descriptor: { readonly label: string }): string {\n' +
        '  return descriptor.label;\n}\n',
    ),
  /no longer takes a resolver function/,
);

/* ---------------- the generated pseudo-locale is not a shipped one ---------------- */

// `zz` is derived from `en.json` by `tools/i18n/pseudo-locale.mjs` and gitignored; it exists only
// while someone audits for strings no catalogue supplies. Treating it as a customer-facing language
// demands key parity with a file regenerated from `en.json`, and Angular locale data for a locale
// Angular has never heard of. Running the audit left it on disk and turned the whole gate red.
falsePositiveControls += 1;
expectGreen('a generated zz.json on disk is not a shipped locale', 'checkLocaleDataRegistered', {
  'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
  'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
  'apps/nuxeo-ui/public/i18n/zz.json': '{\n  "a": "\u27E6Á\u27E7"\n}\n',
  // The tuple shape the parser reads: `['fr', localeFr],`. `en` is never registered — Angular
  // bundles it — so a fixture registering only `fr` is the realistic minimum.
  'apps/nuxeo-ui/src/app/i18n/register-locale-data.ts':
    "import localeFr from '@angular/common/locales/fr';\n" +
    'const LOCALE_DATA = [\n' +
    "  ['fr', localeFr],\n" +
    '];\n',
});

falsePositiveControls += 1;
expectGreen('a generated zz.json is not held to key parity', 'checkTranslationCatalogues', {
  'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A",\n  "b": "B"\n}\n',
  'apps/nuxeo-ui/public/i18n/zz.json': '{\n  "a": "\u27E6Á\u27E7"\n}\n',
});

/* ---------------- checkNoHardcodedDescriptorText: pairing is per object ---------------- */

// The false negative: an unkeyed descriptor two lines below a keyed one borrowed its `labelKey`
// under the old ±3-line window, so the gate passed on exactly the shape it exists to catch.
expectRed(
  'an unkeyed descriptor sitting next to a keyed one',
  'checkNoHardcodedDescriptorText',
  { 'libs/features/x/src/lib/x.ts': 'export const ITEMS = [];\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'export const ITEMS = [\n' +
        "  { labelKey: 'x.keep', label: 'Keep', path: '/keep' },\n" +
        "  { label: 'Delete', path: '/delete' },\n" +
        '];\n',
    ),
  /carries `label: 'Delete'`/,
);

// And the pairing still works, single-line and multi-line, or the fix would flag 89 correctly
// keyed descriptors — which the first two attempts at this walk did.
falsePositiveControls += 1;
expectGreen('descriptors keyed on one line and across lines', 'checkNoHardcodedDescriptorText', {
  'libs/features/x/src/lib/x.ts':
    'export const ITEMS = [\n' +
    "  { labelKey: 'x.one', label: 'One', path: '/one' },\n" +
    '  {\n' +
    "    labelKey: 'x.two',\n" +
    "    label: 'Two',\n" +
    "    path: '/two',\n" +
    '  },\n' +
    '];\n',
});

/* ---------------- checkNoHardcodedUiText: parameterised translate spans ---------------- */

// A parameterised pipe's own braces ended the interpolation pattern, so `| translate` survived
// into the remainder and the whole-line escape skipped the line — carrying the hard-coded sibling
// text with it. A false negative in the gate that enforces AC1, created by this PR: parameterised
// pipes became the recommended form once accessible names started carrying values.
expectRed(
  'hard-coded text beside a parameterised translate interpolation',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      `{{ 'x.items' | translate: { count: n } }} <span>Show Details</span>\n`,
    ),
  /Show Details/,
);

// A quoted literal inside an Angular EXPRESSION. Displayed text that nothing could reach: the
// interpolation braces mean it matches neither the element-text pattern nor the bare-prose one.
// `nav-drawer.component.html:266` is exactly this shape and sat in a template this repository
// described as having zero hard-coded strings left.
expectRed(
  'a hard-coded literal inside a ternary interpolation',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      `<span>{{ isOverdue(t) ? 'Overdue' : 'Due' }}</span>\n`,
    ),
  /the quoted literal `'Overdue'`/,
);

// Expressions quote keys, ids, types and CSS classes constantly. Flagging every quoted string would
// make this gate unpassable, so `isDisplayText` and a dotted-token exemption do the judging.
falsePositiveControls += 1;
expectGreen('quoted non-prose inside expressions', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html':
    `<span>{{ doc.lastModified | date: 'mediumDate' }}</span>\n` +
    `<div [class.active]="mode === 'grid'"></div>\n` +
    `<span>{{ 'browse.title' | translate }}</span>\n` +
    `<hxp-icon name="refresh" [attr.data-type]="'Folder'" />\n`,
});

// Prose on the same line as a TRANSLATED interpolation, which the bare-prose branch could never
// reach: it tested the raw line, and the raw line contains `{`, so `BARE_PROSE_LINE` rejected it and
// the hard-coded words were never judged. Every other branch already used the remainder.
expectRed(
  'hard-coded prose beside a translated interpolation on one line',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) => write('libs/features/x/src/lib/x.html', `{{ 'x.label' | translate }} Show Details\n`),
  /Show Details/,
);

// And the parameterised interpolation alone is still exempt, or the fix would fail every
// pluralised string in the repository.
falsePositiveControls += 1;
expectGreen('a parameterised translate interpolation on its own', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': `{{ 'x.items' | translate: { count: n } }}\n`,
});

falsePositiveControls += 1;
expectGreen('a parameterised translate bound to an accessible name', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html': `<button [attr.aria-label]="'x.y' | translate: { name: nodeLabel(node) }"></button>\n`,
});

/* ---------------- checkNoHardcodedUiText: comment and <pre> spans ---------------- */

// The founding case. A multi-line template comment's interior lines start with prose, so the
// `startsWith('<!--')` skip never saw them and every sentence beginning with a capital was
// reported as hard-coded English — including a comment explaining why a label uses an
// interpolation parameter.
falsePositiveControls += 1;
expectGreen('the interior lines of a multi-line template comment', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html':
    '<!--\n  The name goes through an interpolation parameter, not a concatenation.\n' +
    '  INFO-144 forbids building a string from concatenated substrings.\n-->\n' +
    `<button [attr.aria-label]="'x.y' | translate"></button>\n`,
});

// Code shown to customers as documentation. Translating an import statement would be wrong.
falsePositiveControls += 1;
expectGreen('a code sample inside a <pre> block', 'checkNoHardcodedUiText', {
  'libs/features/x/src/lib/x.html':
    '<pre>\n  import { Component } from "@angular/core";\n  Register The Rule Here\n</pre>\n',
});

// The dangerous failure mode: if the span never closes, everything after the first comment in the
// file is exempt and the guardrail is dead while still reporting green.
expectRed(
  'a hard-coded label after a CLOSED multi-line comment',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<!--\n  An explanation spanning lines.\n-->\n<button title="Recently Edited"></button>\n',
    ),
  /Recently Edited/,
);

expectRed(
  'a hard-coded label after a CLOSED <pre> block',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<pre>\n  import { Component } from "@angular/core";\n</pre>\n' +
        '<button title="Show Details"></button>\n',
    ),
  /Show Details/,
);

// The hole that skipping whole lines left: a real label escaped the gate by having a comment
// after it on the same line. Spans are blanked instead, so what is left on the line is the markup.
expectRed(
  'a hard-coded label on the same line as a trailing comment',
  'checkNoHardcodedUiText',
  { 'libs/features/x/src/lib/x.html': '<div></div>\n' },
  (write) =>
    write(
      'libs/features/x/src/lib/x.html',
      '<button title="Recently Edited"></button> <!-- a trailing note -->\n',
    ),
  /Recently Edited/,
);

/* ---------------- checkTranslatorContextPush ---------------- */

/** The two lines of the loader's flattener this guardrail holds the script's copy to. */
const LOADER_FLATTENER = `export function flattenCatalogue(source, prefix = '', target = {}) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? \`\${prefix}.\${key}\` : key;
    if (typeof value === 'string') target[path] = value;
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenCatalogue(value, path, target);
    }
  }
  return target;
}
`;

const SCRIPT_FLATTENER = `export function flattenKeys(node, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? \`\${prefix}.\${key}\` : key;
    if (typeof value === 'string') out.push(path);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenKeys(value, path));
    }
  }
  return out;
}
`;

const CONTEXT_PUSH = {
  'tools/i18n/crowdin-push-context.mjs': SCRIPT_FLATTENER,
  'apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts': LOADER_FLATTENER,
  'crowdin-conf.yml': crowdinConf([
    CROWDIN_ENTRY('/apps/*/public/i18n/en.json'),
    CROWDIN_ENTRY('/libs/**/i18n/en.json'),
  ]),
  'apps/nuxeo-ui/public/i18n/en.json': EN_JSON,
  'apps/nuxeo-ui/public/i18n/en.context.json': EN_CONTEXT,
};

expectGreen('a context file reachable through a declared source', 'checkTranslatorContextPush', {
  ...CONTEXT_PUSH,
});

// The `libs/**` glob crosses separators, so a deeply nested library catalogue IS reachable.
// Without this control the reachability half could be satisfied by a glob translation that
// treated `**` as `*`, and would then reject every real library catalogue.
falsePositiveControls += 1;
expectGreen(
  'a deeply nested library context file the libs glob covers',
  'checkTranslatorContextPush',
  {
    ...CONTEXT_PUSH,
    'libs/platform/nuxeo-client/src/i18n/en.json': EN_JSON,
    'libs/platform/nuxeo-client/src/i18n/en.context.json': EN_CONTEXT,
  },
);

// The founding defect, the other way round: a context file whose catalogue no source matches.
// Its context reaches Crowdin through nothing, and the script still prints a success line.
expectRed(
  'a context file no Crowdin source mapping reaches',
  'checkTranslatorContextPush',
  { ...CONTEXT_PUSH },
  (write) => {
    write('tools/other/i18n/en.json', EN_JSON);
    write('tools/other/i18n/en.context.json', EN_CONTEXT);
    // Under `apps/`, so the walk finds it, but at a depth the `/apps/*/public/` glob cannot reach.
    write('apps/nuxeo-ui/src/deep/i18n/en.json', EN_JSON);
    write('apps/nuxeo-ui/src/deep/i18n/en.context.json', EN_CONTEXT);
  },
  /apps\/nuxeo-ui\/src\/deep\/i18n\/en\.context\.json documents .*which no `source`/s,
);

// The flattener half. Two implementations with nothing comparing them is how a wrong half
// survives; a disagreement here attaches context to identifiers the app never resolves.
//
// The guardrail IMPORTS the fixture's flattener and runs it, so this control asserts changed
// OUTPUT, not changed source text: dropping the array guard makes an array leaf recurse into the
// identifier `a.0`, which Crowdin has never heard of. An earlier revision of both the check and
// this control compared source patterns while claiming to compare behaviour.
expectRed(
  'the script flattener dropping its array-leaf guard while the loader keeps it',
  'checkTranslatorContextPush',
  { ...CONTEXT_PUSH },
  (write) =>
    write(
      'tools/i18n/crowdin-push-context.mjs',
      SCRIPT_FLATTENER.replace(` && !Array.isArray(value)`, ''),
    ),
  /disagrees with the loader on "array leaves are not keys"[\s\S]*\["a\.0","b"\]/,
);

// A flattener that no longer exports `flattenKeys` leaves nothing to compare. Without this the
// import half could fail open: a missing export is not a disagreement.
expectRed(
  'the script no longer exporting its flattener',
  'checkTranslatorContextPush',
  { ...CONTEXT_PUSH },
  (write) =>
    write(
      'tools/i18n/crowdin-push-context.mjs',
      SCRIPT_FLATTENER.replace('export function', 'function'),
    ),
  /no longer exports `flattenKeys`/,
);

// The loader-shape tripwire. It is a SOURCE check, not a behavioural one, because the loader is
// TypeScript and this script has no compiler — so what it must do is fire when the loader is
// rewritten, forcing the transcribed expectations above to be re-derived rather than trusted.
expectRed(
  'the loader flattener rewritten so the transcribed contract no longer describes it',
  'checkTranslatorContextPush',
  { ...CONTEXT_PUSH },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts',
      LOADER_FLATTENER.replace(' && value !== null', ''),
    ),
  /no longer visibly "excludes null from the recursion"/,
);

expectRed(
  'the context push script deleted while the guardrail still claims to gate it',
  'checkTranslatorContextPush',
  {
    'apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts': LOADER_FLATTENER,
    'crowdin-conf.yml': crowdinConf([CROWDIN_ENTRY('/apps/*/public/i18n/en.json')]),
  },
  null,
  /tools\/i18n\/crowdin-push-context\.mjs is missing/,
);

// ── controls for round nine: the template config the gate never read ─────────────────────

/**
 * `checkAdvertisedLocalesShip` read one bootstrap config while the repository had two.
 *
 * `nuxeo-satori-template` is the public Layer 0 example a customer copies. It advertised `fr` and
 * `de`, ships no catalogue directory and wires no `TranslateModule` — so the example described two
 * languages it could not render, and the gate was looking somewhere else entirely.
 */
const TEMPLATE_CONFIG = 'apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json';
const PACKAGED_CONFIG =
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json';
const EN_ONLY = '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en"]\n}\n';

expectRed(
  'the template config advertising a locale it ships no catalogue for',
  'checkAdvertisedLocalesShip',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    [PACKAGED_CONFIG]: EN_ONLY,
    [TEMPLATE_CONFIG]: '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en", "fr"]\n}\n',
  },
  null,
  /nuxeo-satori-template[\s\S]*advertises "fr"[\s\S]*ships no catalogue/,
);

// English needs no catalogue — it is the source language, compiled in as the fallback — so an
// application with no catalogue directory may advertise English and nothing else. Without this the
// widened gate would fail every template that has no i18n yet, which is a gate nobody can pass.
falsePositiveControls += 1;
expectGreen(
  'a template advertising English only, with no catalogues',
  'checkAdvertisedLocalesShip',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    [PACKAGED_CONFIG]: EN_ONLY,
    [TEMPLATE_CONFIG]: EN_ONLY,
  },
);

// The two configs stay independent: a catalogue in the main app must not satisfy the template.
expectRed(
  "the template borrowing the main app's catalogues",
  'checkAdvertisedLocalesShip',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "A"\n}\n',
    'apps/nuxeo-ui/public/i18n/fr.json': '{\n  "a": "A"\n}\n',
    [PACKAGED_CONFIG]: '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en", "fr"]\n}\n',
    [TEMPLATE_CONFIG]: '{\n  "defaultLanguage": "en",\n  "availableLanguages": ["en", "fr"]\n}\n',
  },
  null,
  /nuxeo-satori-template[\s\S]*advertises "fr"/,
);

// ── controls for round four of the Copilot review ────────────────────────────────────────

/* ---------------- checkAccessibleNameFallbacks: parameterised bindings ---------------- */

/**
 * The binding shape the accessible-name fix itself introduced, which this gate could not see.
 *
 * `nav-drawer.component.html` binds `'nav.tree.toggle' | translate: { name: nodeLabel(node) }`.
 * The matcher stopped at `| translate`, so the key could be deleted from the fallback map and this
 * guardrail stayed green — restoring exactly the raw-key accessible name it exists to prevent.
 * Verified against the real repository before the fix by deleting that entry: still green.
 *
 * A parameterised name is MORE likely here, not less: INFO-144 forbids concatenation, so every
 * label that carries a value is pushed towards this form.
 */
const PARAM_TEMPLATE =
  `<button type="button"\n` +
  `  [attr.aria-label]="'app.nav.toggle' | translate: { name: nodeLabel(node) }"\n` +
  `></button>\n`;

const PARAM_APP = {
  'apps/nuxeo-ui/public/i18n/en.json': EN_JSON,
  'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK,
  'apps/nuxeo-ui/src/app/shell/app-shell.component.html': PARAM_TEMPLATE,
};

expectRed(
  'a parameterised accessible name whose key is missing from the fallback map',
  'checkAccessibleNameFallbacks',
  PARAM_APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      EN_FALLBACK.replace(/\s*'app\.nav\.toggle': 'Toggle navigation menu',/, ''),
    ),
  /binds aria-label to `app\.nav\.toggle`.*omits/s,
);

// A fallback value Prettier wrapped and double-quoted, because it contains an apostrophe. The
// parser read single-quoted one-line entries only, so this entry was invisible and the gate
// reported a key as absent from the very file that defines it — 317 of 318 entries seen, and
// `fallback.size === 0` cannot catch a partial parse.
falsePositiveControls += 1;
expectGreen('a double-quoted, wrapped fallback entry', 'checkAccessibleNameFallbacks', {
  'apps/nuxeo-ui/public/i18n/en.json':
    '{\n  "search": { "search": { "ask": "Ask e.g. \'PDFs from last week\'" } }\n}\n',
  'apps/nuxeo-ui/src/app/i18n/en-fallback.ts':
    'export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {\n' +
    "  'search.search.ask':\n" +
    '    "Ask e.g. \'PDFs from last week\'",\n};\n',
  'apps/nuxeo-ui/src/app/shell/app-shell.component.html': `<input [placeholder]="'search.search.ask' | translate" />\n`,
});

falsePositiveControls += 1;
expectGreen(
  'a parameterised accessible name whose key IS in the fallback map',
  'checkAccessibleNameFallbacks',
  PARAM_APP,
);

// A PLACEHOLDER is the only thing naming the two shell text inputs, so its key needs a fallback
// exactly as an `aria-label`'s does. Neither `shell.search.placeholder` nor
// `shell.ai.input-placeholder` was in the map, and nothing noticed: this gate read only `aria-label`
// and `title`, while the evidence harness's unnamed-control sweep deliberately accepts a placeholder
// AS a name. Between them a raw key could be announced as the global search box's name.
const PLACEHOLDER_CATALOGUE =
  '{\n  "shell": { "search": { "placeholder": "Search documents" } }\n}\n';
const PLACEHOLDER_TEMPLATE = `<input [placeholder]="'shell.search.placeholder' | translate" />\n`;

expectRed(
  'a translated placeholder whose key is missing from the fallback map',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': PLACEHOLDER_CATALOGUE,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts':
      'export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {\n' +
      "  'unrelated.key': 'Unrelated',\n};\n",
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': PLACEHOLDER_TEMPLATE,
  },
  null,
  /binds placeholder to `shell\.search\.placeholder`[\s\S]*omits/,
);

falsePositiveControls += 1;
expectGreen(
  'a translated placeholder whose key IS in the fallback map',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': PLACEHOLDER_CATALOGUE,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts':
      'export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {\n' +
      "  'shell.search.placeholder': 'Search documents',\n};\n",
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': PLACEHOLDER_TEMPLATE,
  },
);

// A catalogue of `null` is valid JSON, so the `try` around `JSON.parse` does not catch it and
// `Object.entries(null)` threw — killing the process before any accumulated diagnostic printed and
// discarding every other guardrail's output. A guardrail that can crash silences the others.
expectGreen(
  'a catalogue that parses to null does not crash this gate',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': 'null\n',
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': EN_FALLBACK,
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': GOOD_TEMPLATE,
  },
);

// A key in OUR shape that no catalogue defines. ngx-translate renders an unresolved key as the key
// itself, so this names the control `app.nav.togle` — and the gate used to wave it through as
// "upstream-owned", which is the commonest way of producing the defect it exists to stop.
expectRed(
  'a misspelled accessible-name key no catalogue defines',
  'checkAccessibleNameFallbacks',
  APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/shell/app-shell.component.html',
      `<button type="button" [attr.aria-label]="'app.nav.togle' | translate"></button>\n`,
    ),
  /binds aria-label to `app\.nav\.togle`, which no catalogue defines/,
);

// Upstream's SCREAMING_CASE keys come from seeded catalogues this repository does not own, so
// absence there is expected and must stay silent. D4 chose the case convention for exactly this.
falsePositiveControls += 1;
expectGreen(
  'an upstream SCREAMING_CASE key absent from our catalogue',
  'checkAccessibleNameFallbacks',
  {
    ...APP,
    'apps/nuxeo-ui/src/app/shell/app-shell.component.html': `<button type="button" [attr.aria-label]="'DOCUMENT_TREE.TOGGLE_ARIA-LABEL' | translate"></button>\n`,
  },
);

/**
 * `[attr.aria-label]="panelLabelKey() | translate"` — keys come from the method body, not from an
 * earlier call site. `indexOf(\`\${methodName}(\`)` used to anchor on the call in `refreshLabel()`,
 * miss the declaration's return literals, and let a missing fallback slip through.
 */
const METHOD_BINDING_CATALOGUE = `{
  "x": { "panel": { "hide": "Hide panel", "show": "Show panel" } }
}
`;
const METHOD_BINDING_FALLBACK = `export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {
  'x.panel.hide': 'Hide panel',
  'x.panel.show': 'Show panel',
};
`;
const METHOD_BINDING_TS = `export class XComponent {
  refreshLabel(): string {
    return this.panelLabelKey();
  }
  panelLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    return this.open ? 'x.panel.hide' : 'x.panel.show';
  }
}
`;
const METHOD_BINDING_HTML = `<button type="button" [attr.aria-label]="panelLabelKey() | translate"></button>\n`;
const METHOD_BINDING_APP = {
  'apps/nuxeo-ui/public/i18n/en.json': METHOD_BINDING_CATALOGUE,
  'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': METHOD_BINDING_FALLBACK,
  'libs/features/x/src/lib/x.html': METHOD_BINDING_HTML,
  'libs/features/x/src/lib/x.ts': METHOD_BINDING_TS,
};

expectRed(
  'a method-bound accessible name whose keys are missing from the fallback map',
  'checkAccessibleNameFallbacks',
  METHOD_BINDING_APP,
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

falsePositiveControls += 1;
expectGreen(
  'a method-bound accessible name with an earlier call site still reads the declaration',
  'checkAccessibleNameFallbacks',
  METHOD_BINDING_APP,
);

const METHOD_PLACEHOLDER_HTML = `<input [placeholder]="inputLabelKey() | translate" />\n`;
const METHOD_PLACEHOLDER_TS = `export class XComponent {
  inputLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    return this.open ? 'x.panel.hide' : 'x.panel.show';
  }
}
`;
expectRed(
  'a method-bound placeholder whose keys are missing from the fallback map',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.html': METHOD_PLACEHOLDER_HTML,
    'libs/features/x/src/lib/x.ts': METHOD_PLACEHOLDER_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds inputLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

const METHOD_DEBUG_LITERAL_TS = `export class XComponent {
  panelLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    console.log('x.panel.debug-only');
    return this.open ? 'x.panel.hide' : 'x.panel.show';
  }
}
`;
falsePositiveControls += 1;
expectGreen(
  'a method-bound name ignores debug string literals nested in the method body',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_DEBUG_LITERAL_TS,
  },
);

const METHOD_IF_RETURN_TS = `export class XComponent {
  panelLabelKey(): string {
    if (this.open) {
      return 'x.panel.hide';
    }
    return 'x.panel.show';
  }
}
`;
expectRed(
  'a method-bound name whose keys are returned through nested control flow',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_IF_RETURN_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

const METHOD_LOCAL_VAR_TS = `export class XComponent {
  panelLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    const key = this.open ? 'x.panel.hide' : 'x.panel.show';
    return key;
  }
}
`;
falsePositiveControls += 1;
expectGreen(
  'a method-bound name returned through a local const still resolves its keys',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_LOCAL_VAR_TS,
  },
);

const METHOD_CONST_CHAIN_TS = `export class XComponent {
  panelLabelKey(): string {
    const hide = 'x.panel.hide';
    const key = this.open ? hide : 'x.panel.show';
    return key;
  }
}
`;
expectRed(
  'a method-bound name whose const chain omits a key from the fallback map',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_CONST_CHAIN_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.hide': 'Hide panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.hide`.*omits/s,
);

const METHOD_LET_REASSIGN_TS = `export class XComponent {
  panelLabelKey(): string {
    let key = 'x.panel.hide';
    key = 'x.panel.show';
    return key;
  }
}
`;
expectRed(
  'a method-bound name that reassigns a let before returning',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_LET_REASSIGN_TS,
  },
  null,
  /panelLabelKey\(\).*(control-flow path does not return a resolvable|could not resolve any translation keys from that method declaration)/s,
);

const METHOD_SHADOW_TS = `export class XComponent {
  panelLabelKey(): string {
    const key = 'x.panel.hide';
    if (this.open) {
      const key = 'x.panel.show';
      return key;
    }
    return key;
  }
}
`;
expectRed(
  'a method-bound name whose nested const shadows an outer key',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_SHADOW_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

const METHOD_HOST_SPEC_TS = `import { Component } from '@angular/core';
@Component({ standalone: true, templateUrl: './widget.host.html' })
export class WidgetHostSpec {
  open = false;
  panelLabelKey(): string {
    return this.open ? 'x.panel.hide' : 'x.panel.show';
  }
}
`;
expectRed(
  'a method-bound name on a host template resolved through templateUrl',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/widget.host.html': METHOD_BINDING_HTML,
    'libs/features/x/src/lib/widget.spec.ts': METHOD_HOST_SPEC_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

expectRed(
  'a method-bound name with no resolvable component TypeScript owner',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/orphan.host.html': METHOD_BINDING_HTML,
  },
  null,
  /panelLabelKey\(\).*could not resolve any translation keys from that method declaration/s,
);

const METHOD_UNRESOLVABLE_TS = `export class XComponent {
  panelLabelKey(): string {
    return this.pickKey();
  }
  pickKey(): string {
    return 'x.panel.hide';
  }
}
`;
const METHOD_UNRESOLVABLE_HTML =
  `<button type="button" [attr.aria-label]="'app.nav.toggle' | translate"></button>\n` +
  METHOD_BINDING_HTML;
expectRed(
  'a method-bound name the extractor cannot resolve while other bindings exist',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': `{
  "app": { "nav": { "toggle": "Toggle navigation menu" } },
  "x": { "panel": { "hide": "Hide panel", "show": "Show panel" } }
}
`,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': `export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {
  'app.nav.toggle': 'Toggle navigation menu',
  'x.panel.hide': 'Hide panel',
  'x.panel.show': 'Show panel',
};
`,
    'libs/features/x/src/lib/x.html': METHOD_UNRESOLVABLE_HTML,
    'libs/features/x/src/lib/x.ts': METHOD_UNRESOLVABLE_TS,
  },
  null,
  /panelLabelKey\(\).*(control-flow path does not return a resolvable|could not resolve any translation keys from that method declaration)/s,
);

const METHOD_PARTIAL_RETURN_TS = `export class XComponent {
  panelLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    return this.open ? 'x.panel.hide' : this.pickKey();
  }
  pickKey(): string {
    return 'x.panel.show';
  }
}
`;
const METHOD_FALLTHROUGH_TS = `export class XComponent {
  panelLabelKey(): 'x.panel.hide' | 'x.panel.show' {
    if (this.open) return 'x.panel.hide';
  }
}
`;
expectRed(
  'a method-bound name with an implicit fall-through after a guarded return',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.ts': METHOD_FALLTHROUGH_TS,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /panelLabelKey\(\).*fall through/s,
);

expectRed(
  'a method-bound name with a partially resolved return ternary',
  'checkAccessibleNameFallbacks',
  {
    'apps/nuxeo-ui/public/i18n/en.json': `{
  "app": { "nav": { "toggle": "Toggle navigation menu" } },
  "x": { "panel": { "hide": "Hide panel", "show": "Show panel" } }
}
`,
    'apps/nuxeo-ui/src/app/i18n/en-fallback.ts': `export const EN_FALLBACK_TRANSLATIONS: Record<string, string> = {
  'app.nav.toggle': 'Toggle navigation menu',
  'x.panel.hide': 'Hide panel',
  'x.panel.show': 'Show panel',
};
`,
    'libs/features/x/src/lib/x.html': METHOD_UNRESOLVABLE_HTML,
    'libs/features/x/src/lib/x.ts': METHOD_PARTIAL_RETURN_TS,
  },
  null,
  /panelLabelKey\(\).*control-flow path does not return a resolvable/s,
);

const METHOD_PARAM_HTML = `<button type="button" [attr.aria-label]="panelLabelKey() | translate: { name: itemName() }"></button>\n`;
expectRed(
  'a parameterised method-bound accessible name whose keys are missing from the fallback map',
  'checkAccessibleNameFallbacks',
  {
    ...METHOD_BINDING_APP,
    'libs/features/x/src/lib/x.html': METHOD_PARAM_HTML,
  },
  (write) =>
    write(
      'apps/nuxeo-ui/src/app/i18n/en-fallback.ts',
      METHOD_BINDING_FALLBACK.replace(/\s*'x\.panel\.show': 'Show panel',/, ''),
    ),
  /binds panelLabelKey\(\) to `x\.panel\.show`.*omits/s,
);

const PUSH_WORKFLOW_PATHS_AND_CONTEXT_STEP =
  "on:\n  push:\n    paths:\n      - 'apps/*/public/i18n/en.json'\n" +
  "      - 'apps/*/public/i18n/en.context.json'\n      - 'libs/**/i18n/en.context.json'\n" +
  '    steps:\n      - run: node tools/i18n/crowdin-push-context.mjs\n';
const CRLF_CONTEXT_PUSH_WORKFLOW = PUSH_WORKFLOW_PATHS_AND_CONTEXT_STEP.replace(/\n/g, '\r\n');
falsePositiveControls += 1;
expectGreen(
  'a CRLF-checked-out push workflow still finds the context uploader step',
  'checkTranslatorContextPush',
  {
    ...CONTEXT_PUSH,
    '.github/workflows/crowdin-push.yaml': CRLF_CONTEXT_PUSH_WORKFLOW,
  },
);

/* ---------------- checkTranslatorContextPush: the push STEP ---------------- */

// The gate verified which files trigger the job and never that the job runs the uploader. Deleting
// the step left every guardrail green while no translator context reached Crowdin — the doorbell
// checked, nobody answering.
expectRed(
  'a push workflow that watches the context files but never runs the uploader',
  'checkTranslatorContextPush',
  {
    ...CONTEXT_PUSH,
    '.github/workflows/crowdin-push.yaml':
      "on:\n  push:\n    paths:\n      - 'apps/*/public/i18n/en.json'\n" +
      "      - 'apps/*/public/i18n/en.context.json'\n      - 'libs/**/i18n/en.context.json'\n",
  },
  null,
  /never runs `node tools\/i18n\/crowdin-push-context\.mjs`/,
);

/* ---------------- checkTranslatorContextPush: the push trigger ---------------- */

// `paths` and the discovery walk are two independent lists of what counts as a source, and they
// drifted the moment discovery grew. A context file read by the script but watched by no trigger
// means Crowdin serves context the repository has already moved past.
expectRed(
  'a context file the push workflow watches no path for',
  'checkTranslatorContextPush',
  {
    ...CONTEXT_PUSH,
    '.github/workflows/crowdin-push.yaml':
      "on:\n  push:\n    paths:\n      - 'apps/*/public/i18n/en.json'\n",
  },
  null,
  /watches no path matching apps\/nuxeo-ui\/public\/i18n\/en\.context\.json/,
);

falsePositiveControls += 1;
expectGreen(
  'a push workflow watching every discovered context file',
  'checkTranslatorContextPush',
  {
    ...CONTEXT_PUSH,
    // Carries the uploader step as well as the globs, or this positive control fails on the
    // *invocation* half and stops saying anything about the trigger half it exists for.
    '.github/workflows/crowdin-push.yaml':
      "on:\n  push:\n    paths:\n      - 'apps/*/public/i18n/en.json'\n" +
      "      - 'apps/*/public/i18n/en.context.json'\n      - 'libs/**/i18n/en.context.json'\n" +
      '    steps:\n      - run: node tools/i18n/crowdin-push-context.mjs\n',
  },
);

/* ---------------- NXSAT-284: sink text through a ternary or a constant ---------------- */

// The shapes `toast(wasLocked ? 'Document unlocked' : 'Document locked')` and
// `toast(DOMAIN_CONTAINER_GUIDANCE)` were read as clean by every check, because each looked for a
// literal as the first thing in the call. 23 such strings were live when this was found.
expectRed(
  'a toast whose message is a ternary of two literals',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.toast(wasLocked ? 'Document unlocked' : 'Document locked');\n",
    ),
  /passes the hard-coded string `Document unlocked`[\s\S]*passes the hard-coded string `Document locked`/,
);

expectRed(
  'a toast whose hard-coded branch is the else side of a keyed ternary',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.toast(\n  denied(err) ? this.translate.instant(KEY) : 'Failed to save note',\n);\n",
    ),
  /passes the hard-coded string `Failed to save note`/,
);

expectRed(
  'a snackbar message passed through a prose constant declared in another file',
  'checkNoHardcodedImperativeUiText',
  {
    ...APP,
    'libs/shared/x/src/lib/notice.ts':
      "export const DOMAIN_CONTAINER_GUIDANCE =\n  'Open Sections, Templates, or Workspaces, then create content inside those folders.';\n",
  },
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "this.snackBar.open(DOMAIN_CONTAINER_GUIDANCE, this.translate.instant('common.ok'));\n",
    ),
  /through the constant `DOMAIN_CONTAINER_GUIDANCE`/,
);

expectRed(
  'an error signal set through a prose constant',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      "const LOAD_FAILED = 'Could not load the folder.';\nthis.scopeNotice.set(LOAD_FAILED);\n",
    ),
  /through the constant `LOAD_FAILED`/,
);

// The same argument parsing must not start flagging what is correct, or it gets switched off.
falsePositiveControls += 1;
expectGreen(
  'a ternary that selects between two catalogue keys',
  'checkNoHardcodedImperativeUiText',
  {
    ...APP,
    'libs/features/x/src/lib/x.ts':
      "this.toast(\n  this.translate.instant(wasLocked ? 'x.message.unlocked' : 'x.message.locked'),\n);\n",
  },
);

falsePositiveControls += 1;
expectGreen('a constant holding a catalogue KEY', 'checkNoHardcodedImperativeUiText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    "const GUIDANCE_KEY = 'browse.message.domain-container-guidance';\n" +
    'this.toast(this.translate.instant(GUIDANCE_KEY));\n',
});

falsePositiveControls += 1;
expectGreen(
  'a local lower-case prose const is not matched across files',
  'checkNoHardcodedImperativeUiText',
  {
    ...APP,
    'libs/features/x/src/lib/a.ts':
      "const message = 'Saved the document.';\nconsole.log(message);\n",
    'libs/features/x/src/lib/b.ts': 'this.toast(message);\n',
  },
);

falsePositiveControls += 1;
expectGreen(
  'a parenthesis inside a keyed argument does not end the scan early',
  'checkNoHardcodedImperativeUiText',
  {
    ...APP,
    'libs/features/x/src/lib/x.ts':
      "this.toast(this.translate.instant('x.k', { n: count(items) }));\nconsole.warn('Not (a) sink');\n",
  },
);

expectRed(
  'a dialog title set from a ternary',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'this.dialog.open(ConfirmDialogComponent, {\n  data: {\n' +
        "    title: isReply ? 'Delete Reply' : 'Delete Comment',\n" +
        "    confirmLabel: this.translate.instant('confirm.delete'),\n  },\n});\n",
    ),
  /sets `title` in a dialog's data from a ternary with the hard-coded branch `Delete Reply`/,
);

expectRed(
  'a dialog message set from a prose constant',
  'checkNoHardcodedDialogText',
  {
    ...APP,
    'libs/shared/x/src/lib/notice.ts': "export const MOVE_WARNING = 'This cannot be undone.';\n",
  },
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'this.dialog.open(ConfirmDialogComponent, {\n  data: {\n    message: MOVE_WARNING,\n  },\n});\n',
    ),
  /sets `message` in a dialog's data to the constant `MOVE_WARNING`/,
);

falsePositiveControls += 1;
expectGreen('a dialog title choosing between two keys', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    'this.dialog.open(ConfirmDialogComponent, {\n  data: {\n' +
    "    title: this.translate.instant(isReply ? 'confirm.delete-reply' : 'confirm.delete-comment'),\n" +
    '  },\n});\n',
});

/* ---------------- NXSAT-284: checkNoHardcodedDescriptorText is repo-wide ---------------- */

// Committed in the BASELINE, so the diff is empty. Under the diff-scoped version this passed —
// which is exactly how 28 descriptors predating the check went unmeasured.
expectRed(
  'a hard-coded descriptor that predates the change is still flagged',
  'checkNoHardcodedDescriptorText',
  {
    'libs/features/x/src/lib/toolbar.ts':
      "export const CONTROLS = [{ selector: 'button.ql-bold', label: 'Bold' }];\n",
  },
  null,
  /toolbar\.ts:1 carries `label: 'Bold'`/,
);

expectRed(
  'the starter template is exempt, but a shipped library beside it is not',
  'checkNoHardcodedDescriptorText',
  {
    'apps/nuxeo-satori-template/src/app/nav.ts':
      "export const N = [{ label: 'Deferred Label' }];\n",
    'libs/features/x/src/lib/nav.ts': "export const N = [{ label: 'Shipped Label' }];\n",
  },
  null,
  /libs\/features\/x\/src\/lib\/nav\.ts:1 carries `label: 'Shipped Label'`/,
);

falsePositiveControls += 1;
expectGreen('a pre-existing descriptor keyed with labelKey', 'checkNoHardcodedDescriptorText', {
  'libs/features/x/src/lib/toolbar.ts':
    "export const CONTROLS = [{ selector: 'button.ql-bold', labelKey: 'x.bold' }];\n" +
    "export const THEMES = [{ id: 'dark', labelKey: 'x.dark', label: 'Dark' }];\n",
});

falsePositiveControls += 1;
expectGreen(
  'a hard-coded descriptor in the exempt starter template',
  'checkNoHardcodedDescriptorText',
  {
    'apps/nuxeo-satori-template/src/app/nav.ts':
      "export const N = [{ label: 'Deferred Label' }];\n",
    'libs/features/x/src/lib/nav.ts': "export const N = [{ label: 'x.nav.browse' }];\n",
  },
);

/* ---------------- NXSAT-284 review round 1: shapes the first version missed ---------------- */

// The balanced-argument pass replaced the old `toast\('…'` regex and only looked after `?`/`:`, so
// the plainest shape of all went green.
expectRed(
  'a toast whose whole first argument is a literal',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) => write('libs/features/x/src/lib/x.ts', "this.toast('Document restored');\n"),
  /passes the hard-coded string `Document restored`/,
);

expectRed(
  'a toast passed a prose constant written as a template literal',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'const WARNING = `This cannot be undone.`;\nthis.toast(WARNING);\n',
    ),
  /through the constant `WARNING`/,
);

// Prettier breaks a long ternary across lines; a line-bounded match could not see it.
expectRed(
  'a dialog title ternary broken across lines',
  'checkNoHardcodedDialogText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'this.dialog.open(ConfirmDialogComponent, {\n  data: {\n' +
        "    title: isReply\n      ? 'Delete Reply'\n      : 'Delete Comment',\n  },\n});\n",
    ),
  /sets `title` in a dialog's data from a ternary with the hard-coded branch `Delete Reply`/,
);

falsePositiveControls += 1;
expectGreen('a multi-line dialog ternary that selects between keys', 'checkNoHardcodedDialogText', {
  ...APP,
  'libs/features/x/src/lib/x.ts':
    'this.dialog.open(ConfirmDialogComponent, {\n  data: {\n' +
    "    title: this.translate.instant(\n      isReply ? 'confirm.delete-reply' : 'confirm.delete-comment',\n    ),\n" +
    "    message: this.translate.instant('confirm.delete-question', { name: 'x' }),\n" +
    '  },\n});\n',
});

/* ---------------- NXSAT-284 review round 2: a local alias ---------------- */

// `const msg = err?.error?.message || 'Failed to delegate task.'; this.snackBar.open(msg, …)` —
// four task handlers did this, and neither the literal patterns nor the SCREAMING_CASE constant
// lookup could see it.
expectRed(
  'a hard-coded fallback held in a local const and passed to a snackbar',
  'checkNoHardcodedImperativeUiText',
  APP,
  (write) =>
    write(
      'libs/features/x/src/lib/x.ts',
      'function onError(err) {\n' +
        "  const msg = err?.error?.message || 'Failed to delegate task.';\n" +
        "  this.snackBar.open(msg, this.translate.instant('common.close'));\n" +
        '}\n',
    ),
  /passes the hard-coded string `Failed to delegate task\.` \(through the local `msg`\)/,
);

// Scoped to the declaring block: a same-named `msg` in another method is not blamed for it.
falsePositiveControls += 1;
expectGreen(
  'a same-named local in another block is not borrowed',
  'checkNoHardcodedImperativeUiText',
  {
    ...APP,
    'libs/features/x/src/lib/x.ts':
      'function a() {\n' +
      "  const msg = 'Only logged, never shown.';\n" +
      '  console.warn(msg);\n' +
      '}\n' +
      'function b() {\n' +
      "  const msg = this.translate.instant('x.message.saved');\n" +
      "  this.snackBar.open(msg, this.translate.instant('common.close'));\n" +
      '}\n',
  },
);

/* ---------------- checkTranslatorNotesFlagProductsAndAcronyms ---------------- */

// AC3: a product name must be flagged do-not-translate and an acronym expanded, in the note of
// the string that contains it. A generic "Visible text in X" note satisfied the existence check.
const NOTES_EN = `{
  "nav": { "drive": "Open in Nuxeo Drive", "export": "Export CSV", "said": "Said so" }
}
`;
const notesFixture = (drive, exportNote) => ({
  'apps/nuxeo-ui/public/i18n/en.json': NOTES_EN,
  'apps/nuxeo-ui/public/i18n/en.context.json': JSON.stringify(
    {
      'nav.drive': drive,
      'nav.export': exportNote,
      'nav.said': 'Visible text in a fixture.',
    },
    null,
    2,
  ),
});
const GOOD_DRIVE =
  'Button. Nuxeo Drive is the desktop sync client (product name, do not translate).';
const GOOD_EXPORT = 'Button. CSV = comma-separated values; keep the acronym.';

expectRed(
  'a product name in the English with no do-not-translate flag in its note',
  'checkTranslatorNotesFlagProductsAndAcronyms',
  notesFixture('Visible text in browse. Rendered in browse.html.', GOOD_EXPORT),
  null,
  /the note for `nav\.drive` \("Open in Nuxeo Drive"\) does not flag "Nuxeo" as do-not-translate/,
);

expectRed(
  'an acronym in the English whose note does not expand it',
  'checkTranslatorNotesFlagProductsAndAcronyms',
  notesFixture(GOOD_DRIVE, 'Accessible name (aria-label) of a control in browse.'),
  null,
  /the note for `nav\.export` \("Export CSV"\) does not expand CSV \(comma-separated values\)/,
);

// The fixture also holds "Said so" with a generic note. Matching is whole-word and case-sensitive,
// so it does not count as containing the acronym AI and must not be flagged.
falsePositiveControls += 1;
expectRed(
  'a hyphenated acronym whose note does not expand it',
  'checkTranslatorNotesFlagProductsAndAcronyms',
  {
    'apps/nuxeo-ui/public/i18n/en.json': '{\n  "a": "Run AI-powered analysis"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json': '{\n  "a": "Button on the audit page."\n}\n',
  },
  null,
  /the note for `a` \("Run AI-powered analysis"\) does not expand AI \(artificial intelligence\)/,
);

expectGreen(
  'notes that flag the product and expand the acronym, beside a look-alike word',
  'checkTranslatorNotesFlagProductsAndAcronyms',
  notesFixture(GOOD_DRIVE, GOOD_EXPORT),
);

falsePositiveControls += 1;
expectGreen(
  'a product name not on the list is not checked',
  'checkTranslatorNotesFlagProductsAndAcronyms',
  {
    'apps/nuxeo-ui/public/i18n/en.json':
      '{\n  "a": "Open in Nuxeo Drive",\n  "b": "Sync with Dropbox"\n}\n',
    'apps/nuxeo-ui/public/i18n/en.context.json':
      '{\n  "a": "Nuxeo Drive is the desktop client (do not translate).",\n  "b": "Visible text."\n}\n',
  },
);

/* ---------------- checkPlatformEnglishFallback ---------------- */

// The package ships English for the keys its own code uses; it must be the catalogue's English, for
// exactly those keys, or a host sees stale wording or raw keys.
const platformFile = (map) =>
  '// @generated-begin\n// prettier-ignore\nexport const PLATFORM_EN_TRANSLATIONS: Readonly<Record<string, string>> = ' +
  `${JSON.stringify(map, null, 2)};\n// @generated-end\n`;
const PLATFORM = (map, source = "export const K = 'shared-ui.a';\n") => ({
  'apps/nuxeo-ui/public/i18n/en.json':
    '{\n  "shared-ui": { "a": "Alpha", "b": "Beta" },\n  "app": { "c": "Gamma" }\n}\n',
  'libs/platform/ui/ng-package.json':
    '{ "lib": { "entryFile": "../../shared/ui/src/index.ts" } }\n',
  'libs/shared/ui/src/index.ts': source,
  'libs/shared/ui/src/lib/i18n/platform-en.ts': platformFile(map),
});

expectGreen(
  'a platform English copy that matches the catalogue and the references',
  'checkPlatformEnglishFallback',
  PLATFORM({ 'shared-ui.a': 'Alpha' }),
);

expectRed(
  'a key the package references with no English copy',
  'checkPlatformEnglishFallback',
  PLATFORM({ 'shared-ui.a': 'Alpha' }, "export const K = ['shared-ui.a', 'shared-ui.b'];\n"),
  null,
  /has no English for 1 key\(s\) the package uses: shared-ui\.b/,
);

expectRed(
  'an English copy that differs from the catalogue',
  'checkPlatformEnglishFallback',
  PLATFORM({ 'shared-ui.a': 'Alpah' }),
  null,
  /differs from apps\/nuxeo-ui\/public\/i18n\/en\.json for 1 key\(s\): shared-ui\.a \("Alpah" vs "Alpha"\)/,
);

expectRed(
  'a copied key the package no longer references',
  'checkPlatformEnglishFallback',
  PLATFORM({ 'shared-ui.a': 'Alpha', 'app.c': 'Gamma' }),
  null,
  /carries 1 key\(s\) the package no longer uses: app\.c/,
);

// A key built from a prefix at runtime references every catalogue key under that prefix.
falsePositiveControls += 1;
expectGreen(
  'a prefix-built key covers the whole family',
  'checkPlatformEnglishFallback',
  PLATFORM(
    { 'shared-ui.a': 'Alpha', 'shared-ui.b': 'Beta' },
    'export const label = (k: string) => `shared-ui.${k}`;\n',
  ),
);

/* ---------------- libs/shared/satori-components (NXSAT-308) ---------------- */

const NXS_ROOT = 'libs/shared/satori-components';
const NXS_COMPONENT = `${NXS_ROOT}/src/lib/thing/thing.component.ts`;
const NXS_STYLES = `${NXS_ROOT}/src/lib/thing/thing.component.scss`;
const nxsComponent = ({ imports = '', config = "selector: 'nxs-thing', standalone: true," } = {}) =>
  `import { Component } from '@angular/core';\n${imports}\n` +
  `@Component({\n  ${config}\n  templateUrl: './thing.component.html',\n` +
  `  styleUrl: './thing.component.scss',\n})\nexport class NxsThingComponent {}\n`;

/** A correct library: one standalone component behind its barrel, published and aliased. */
const NXS_LIB = (extra = {}, paths = {}) => ({
  'tsconfig.base.json': `${JSON.stringify(
    {
      compilerOptions: {
        paths: {
          '@nuxeo-satori/platform/components': [`${NXS_ROOT}/src/index.ts`],
          '@nuxeo-satori/platform/nuxeo-client': ['libs/shared/nuxeo-client/src/index.ts'],
          ...paths,
        },
      },
    },
    null,
    2,
  )}\n`,
  'libs/platform/components/ng-package.json':
    '{ "lib": { "entryFile": "../../shared/satori-components/src/index.ts" } }\n',
  [`${NXS_ROOT}/src/index.ts`]:
    "export { NxsThingComponent } from './lib/thing/thing.component';\n",
  [NXS_COMPONENT]: nxsComponent(),
  [`${NXS_ROOT}/src/lib/thing/thing.component.html`]: '<p>{{ 1 }}</p>\n',
  [NXS_STYLES]: ':host {\n  display: block;\n}\n',
  'libs/shared/nuxeo-client/src/index.ts': "export * from './lib/clean';\n",
  'libs/shared/nuxeo-client/src/lib/clean.ts': 'export const clean = 1;\n',
  ...extra,
});

// checkSatoriComponentsDependencies

expectGreen('a library importing only Angular', 'checkSatoriComponentsDependencies', NXS_LIB());

// A workspace import is followed, not refused: a clean shared library is fine to depend on.
falsePositiveControls += 1;
expectGreen(
  'a library importing a clean workspace library',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import { clean } from '@nuxeo-satori/platform/nuxeo-client';",
    }),
  }),
);

/**
 * The real `nuxeo-client` and `extensions` barrels, not stand-ins.
 *
 * A fixture that stubs a library proves the walk, not that the shipped library is clean, and the
 * walk skips an alias whose target is absent — so the fixture carries every non-spec source in
 * `libs/` and the real `tsconfig.base.json`. The two red controls after it re-introduce the
 * imports each barrel once carried, two hops deep, so the green cannot come from a walk that never
 * entered either library.
 */
const REAL_LIBS = (() => {
  const listed = spawnSync('git', ['ls-files', '-z', 'libs', 'tsconfig.base.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const files = {};
  for (const file of listed.stdout.split('\0')) {
    if (
      file === 'tsconfig.base.json' ||
      (/\.(ts|mts|scss)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
    ) {
      files[file] = readFileSync(join(ROOT, file), 'utf8');
    }
  }
  return files;
})();
const NXS_PROBE = `${NXS_ROOT}/src/lib/probe/probe.ts`;
const REAL_LIBS_WITH_PROBE = {
  ...REAL_LIBS,
  [NXS_PROBE]:
    "import { avatarColor } from '@nuxeo-satori/platform/nuxeo-client';\n" +
    "import { ExtensionRuleRegistry } from '@nuxeo-satori/platform/extensions';\n" +
    'export const probe = [avatarColor, ExtensionRuleRegistry];\n',
};
const AVATAR_COLORS = 'libs/shared/nuxeo-client/src/lib/constants/avatar-colors.ts';
const EXTENSION_RULES = 'libs/shared/extensions/src/lib/extension-rules.ts';
/**
 * Interpolated into the control below, never spelled out in it. `supply-chain` reads a
 * `from '<dep>'` anywhere under `scripts/` as a real import, and this dependency is excused there
 * as unreferenced — a literal specifier in a fixture would make it look used, and that gate is
 * right to refuse it.
 */
const ADF_EXTENSIONS = '@alfresco/adf-extensions';

falsePositiveControls += 1;
expectGreen(
  'the real nuxeo-client and extensions barrels',
  'checkSatoriComponentsDependencies',
  REAL_LIBS_WITH_PROBE,
);

expectRed(
  'the real nuxeo-client barrel reaching a Satori type again',
  'checkSatoriComponentsDependencies',
  REAL_LIBS_WITH_PROBE,
  (write) =>
    write(
      AVATAR_COLORS,
      "import type { SatAvatarCategory } from '@hylandsoftware/satori-ui/avatar';\n" +
        REAL_LIBS[AVATAR_COLORS],
    ),
  /avatar-colors\.ts imports `@hylandsoftware\/satori-ui\/avatar`, and the library reaches that file through .* -> libs\/shared\/nuxeo-client\/src\/index\.ts -> libs\/shared\/nuxeo-client\/src\/lib\/constants\/avatar-colors\.ts\./,
);

expectRed(
  'the real extensions barrel reaching adf-extensions again',
  'checkSatoriComponentsDependencies',
  REAL_LIBS_WITH_PROBE,
  (write) =>
    write(
      EXTENSION_RULES,
      `import type { RuleContext } from '${ADF_EXTENSIONS}';\n` + REAL_LIBS[EXTENSION_RULES],
    ),
  /extension-rules\.ts imports `@alfresco\/adf-extensions`, and the library reaches that file through .*probe\.ts -> libs\/shared\/extensions\/src\/index\.ts -> /,
);

expectRed(
  'a direct satori-ui import',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';",
    }),
  }),
  null,
  /thing\.component\.ts imports `@hylandsoftware\/satori-ui\/avatar`\. .*`\/components-satori` entry point/,
);

expectRed(
  'a direct adf-core import',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import { FileSizePipe } from '@alfresco/adf-core';",
    }),
  }),
  null,
  /thing\.component\.ts imports `@alfresco\/adf-core`\. .*ADF leaves the dependency tree/,
);

expectRed(
  'a direct hxcs-js-client import',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import type { Document } from '@hylandsoftware/hxcs-js-client';",
    }),
  }),
  null,
  /thing\.component\.ts imports `@hylandsoftware\/hxcs-js-client`\. .*HxCS client exists only for the adf-hx bridge/,
);

expectRed(
  'a dynamic import of an ADF package',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/lazy.ts`]:
      "export const load = () => import('@alfresco/adf-core');\n",
  }),
  null,
  /lazy\.ts imports `@alfresco\/adf-core`/,
);

// The shape that exists on main today: nuxeo-client's avatar-colors.ts imports a Satori TYPE.
expectRed(
  'a type-only Satori import one workspace hop away',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import { clean } from '@nuxeo-satori/platform/nuxeo-client';",
    }),
    'libs/shared/nuxeo-client/src/lib/clean.ts':
      "import type { SatAvatarCategory } from '@hylandsoftware/satori-ui/avatar';\n" +
      'export const clean: SatAvatarCategory | 1 = 1;\n',
  }),
  null,
  /nuxeo-client\/src\/lib\/clean\.ts imports `@hylandsoftware\/satori-ui\/avatar`, and the library reaches that file through .*thing\.component\.ts -> libs\/shared\/nuxeo-client\/src\/index\.ts -> libs\/shared\/nuxeo-client\/src\/lib\/clean\.ts\./,
);

// TypeScript maps an explicit `.js` specifier back to the `.ts` source; the walk must too.
expectRed(
  'a Satori import behind a `.js` re-export one workspace hop away',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({
      imports: "import { clean } from '@nuxeo-satori/platform/nuxeo-client';",
    }),
    'libs/shared/nuxeo-client/src/index.ts': "export * from './lib/clean.js';\n",
    'libs/shared/nuxeo-client/src/lib/clean.ts':
      "import { SatTag } from '@hylandsoftware/satori-ui/tag';\nexport const clean = SatTag;\n",
  }),
  null,
  /nuxeo-client\/src\/lib\/clean\.ts imports `@hylandsoftware\/satori-ui\/tag`/,
);

// Sass resolves a bare `@use 'theme'` against the current file first.
expectRed(
  'a Satori theme behind a bare local Sass @use',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]: "@use 'theme';\n",
    [`${NXS_ROOT}/src/lib/thing/_theme.scss`]: "@use '@hylandsoftware/satori-ui/theme' as sat;\n",
  }),
  null,
  /thing\/_theme\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme behind a local Sass @use with its .scss extension',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]: "@use 'theme.scss';\n",
    [`${NXS_ROOT}/src/lib/thing/_theme.scss`]: "@use '@hylandsoftware/satori-ui/theme' as sat;\n",
  }),
  null,
  /thing\/_theme\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme in a component stylesheet',
  'checkSatoriComponentsDependencies',
  NXS_LIB({ [NXS_STYLES]: "@use '@hylandsoftware/satori-ui/theme' as sat;\n" }),
  null,
  /thing\.component\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori import in a library spec',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.component.spec.ts`]:
      "import { SatTag } from '@hylandsoftware/satori-ui/tag';\n",
  }),
  null,
  /thing\.component\.spec\.ts imports `@hylandsoftware\/satori-ui\/tag`/,
);

/** A library component whose metadata, after `templateUrl`, is exactly `metadata`. */
const nxsComponentWith = (metadata, preamble = '') =>
  `import { Component } from '@angular/core';\n${preamble}@Component({\n  selector: 'nxs-thing',\n` +
  `  standalone: true,\n  templateUrl: './thing.component.html',\n${metadata}\n})\n` +
  'export class NxsThingComponent {}\n';
const SATORI_THEME = "@use '@hylandsoftware/satori-ui/theme' as sat;\n";

// Every spelling Angular accepts for a stylesheet path is followed.
for (const [how, metadata] of [
  ['a quoted styleUrl key', "  'styleUrl': './thing.component.scss',"],
  ['a double-quoted styleUrls key', '  "styleUrls": [\'./thing.component.scss\'],'],
  ['a computed styleUrl key', "  ['styleUrl']: './thing.component.scss',"],
  ['a backtick styleUrl path', '  styleUrl: `./thing.component.scss`,'],
  ['a backtick path in styleUrls', '  styleUrls: [`./thing.component.scss`],'],
]) {
  expectRed(
    `a Satori theme in a stylesheet named by ${how}`,
    'checkSatoriComponentsDependencies',
    NXS_LIB({ [NXS_COMPONENT]: nxsComponentWith(metadata), [NXS_STYLES]: SATORI_THEME }),
    null,
    /thing\.component\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
  );
}

// A path the guardrail cannot read statically fails, rather than passing a stylesheet unread.
expectRed(
  'a stylesheet named by a constant',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponentWith(
      '  styleUrl: STYLE,',
      "const STYLE = './thing.component.scss';\n",
    ),
  }),
  null,
  /thing\.component\.ts:7 `styleUrl` is not a string literal, so the stylesheet it names was not checked/,
);

expectRed(
  'component metadata spread from a constant',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponentWith(
      '  ...STYLES,',
      "const STYLES = { styleUrl: './thing.component.scss' };\n",
    ),
  }),
  null,
  /thing\.component\.ts:7 @Component metadata is not an object literal the guardrail can read/,
);

// The app builds the library's components with `inlineStyleLanguage: scss`.
expectRed(
  'a Satori theme in inline styles',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponentWith(
      "  styles: [`@use '@hylandsoftware/satori-ui/theme' as sat;`],",
    ),
  }),
  null,
  /thing\.component\.ts \(inline styles\) imports `@hylandsoftware\/satori-ui\/theme`/,
);

falsePositiveControls += 1;
expectGreen(
  'decorators without metadata objects, and a styles key outside any decorator',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]:
      "import { Component, HostListener, Input } from '@angular/core';\n" +
      'const theme = { styles: [String(1)] };\n' +
      "@Component({\n  selector: 'nxs-thing',\n  standalone: true,\n" +
      "  templateUrl: './thing.component.html',\n  styleUrl: './thing.component.scss',\n})\n" +
      "export class NxsThingComponent {\n  @Input('alias') value = theme;\n" +
      "  @HostListener('click', ['$event']) onClick(): void {}\n}\n",
  }),
);

// The package ban is on the specifier, whatever a tsconfig alias maps it to.
expectRed(
  'a Satori specifier a tsconfig alias maps to a workspace file',
  'checkSatoriComponentsDependencies',
  NXS_LIB(
    {
      [NXS_COMPONENT]: nxsComponent({
        imports: "import { SatTag } from '@hylandsoftware/satori-ui/tag';",
      }),
      'libs/shared/shims/src/satori-tag.ts': 'export const SatTag = 1;\n',
    },
    { '@hylandsoftware/satori-ui/tag': ['libs/shared/shims/src/satori-tag.ts'] },
  ),
  null,
  /thing\.component\.ts imports `@hylandsoftware\/satori-ui\/tag`\. .*`\/components-satori` entry point/,
);

// A project's own tsconfig `paths` is followed too, against the directory that declares it.
expectRed(
  'a Satori import behind a project-level tsconfig alias',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({ imports: "import { dirty } from '@shim/dirty';" }),
    [`${NXS_ROOT}/tsconfig.json`]: `${JSON.stringify({
      extends: '../../../tsconfig.base.json',
      compilerOptions: { paths: { '@shim/dirty': ['../other/src/dirty.ts'] } },
    })}\n`,
    'libs/shared/other/src/dirty.ts':
      "import { SatTag } from '@hylandsoftware/satori-ui/tag';\nexport const dirty = SatTag;\n",
  }),
  null,
  /other\/src\/dirty\.ts imports `@hylandsoftware\/satori-ui\/tag`, and the library reaches that file through/,
);

// Sass's own resolution order: file, `_` partial, then `index` or `_index`, as .scss or .sass.
expectRed(
  'a Satori theme behind a non-partial Sass directory index',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]: "@use './theme';\n",
    [`${NXS_ROOT}/src/lib/thing/theme/index.scss`]: SATORI_THEME,
  }),
  null,
  /thing\/theme\/index\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme behind an indented-syntax Sass partial',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]: "@use 'theme';\n",
    [`${NXS_ROOT}/src/lib/thing/_theme.sass`]: "@use '@hylandsoftware/satori-ui/theme' as sat\n",
  }),
  null,
  /thing\/_theme\.sass imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme through a pkg: URL',
  'checkSatoriComponentsDependencies',
  NXS_LIB({ [NXS_STYLES]: "@use 'pkg:@hylandsoftware/satori-ui/theme' as sat;\n" }),
  null,
  /thing\.component\.scss imports `pkg:@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme second in an @import list',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]: "@import 'local', '@hylandsoftware/satori-ui/theme';\n",
    [`${NXS_ROOT}/src/lib/thing/_local.scss`]: ':root {\n  display: block;\n}\n',
  }),
  null,
  /thing\.component\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a Satori theme loaded with meta.load-css',
  'checkSatoriComponentsDependencies',
  NXS_LIB({
    [NXS_STYLES]:
      "@use 'sass:meta';\n:host {\n  @include meta.load-css('@hylandsoftware/satori-ui/theme');\n}\n",
  }),
  null,
  /thing\.component\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'no library sources at all',
  'checkSatoriComponentsDependencies',
  { 'libs/shared/ui/src/index.ts': 'export {};\n' },
  null,
  /asserted nothing/,
);

// checkSatoriComponentsEntryPoint

const NXS_CONSUMER = 'libs/features/x/src/lib/x.ts';

expectGreen(
  'a consumer importing through the entry point',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    [NXS_CONSUMER]: "import { NxsThingComponent } from '@nuxeo-satori/platform/components';\n",
  }),
);

expectRed(
  'a subpath under the entry specifier',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    [NXS_CONSUMER]:
      "import { NxsThingComponent } from '@nuxeo-satori/platform/components/lib/thing/thing.component';\n",
  }),
  null,
  /x\.ts imports `@nuxeo-satori\/platform\/components\/lib\/thing\/thing\.component`, which reaches into libs\/shared\/satori-components past its entry point/,
);

expectRed(
  'a relative path into the library',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    [NXS_CONSUMER]:
      "import { NxsThingComponent } from '../../../../shared/satori-components/src/lib/thing/thing.component';\n",
  }),
  null,
  /x\.ts imports `\.\.\/\.\.\/\.\.\/\.\.\/shared\/satori-components\/src\/lib\/thing\/thing\.component`, which reaches into/,
);

expectRed(
  'a second alias into the library',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({}, { '@agentic-ui/shared/satori-components/*': [`${NXS_ROOT}/src/*`] }),
  null,
  /alias `@agentic-ui\/shared\/satori-components\/\*` points into libs\/shared\/satori-components/,
);

expectRed(
  'the entry alias pointing past the barrel',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB(
    {},
    { '@nuxeo-satori/platform/components': [`${NXS_ROOT}/src/lib/thing/thing.component.ts`] },
  ),
  null,
  /must map `@nuxeo-satori\/platform\/components` to exactly `libs\/shared\/satori-components\/src\/index\.ts`/,
);

expectRed(
  'the published ng-package pointing past the barrel',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'libs/platform/components/ng-package.json':
      '{ "lib": { "entryFile": "../../shared/satori-components/src/lib/thing/thing.component.ts" } }\n',
  }),
  null,
  /ng-package\.json must publish `libs\/shared\/satori-components\/src\/index\.ts`/,
);

// A project's own tsconfig `paths` is an alias like any other. Its targets resolve against its
// `baseUrl` — its own, else the one it inherits — or, with none, its own directory.
const projectTsconfig = (compilerOptions) =>
  `${JSON.stringify({ extends: '../../../tsconfig.base.json', compilerOptions })}\n`;

expectRed(
  'a project-level alias into the library, against its own baseUrl',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'libs/features/x/tsconfig.json': projectTsconfig({
      baseUrl: '../../..',
      paths: { '@x/thing': [`${NXS_ROOT}/src/lib/thing/thing.component.ts`] },
    }),
  }),
  null,
  /libs\/features\/x\/tsconfig\.json alias `@x\/thing` points into libs\/shared\/satori-components/,
);

expectRed(
  'a project-level alias into the library, against an inherited baseUrl',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'tsconfig.base.json': `${JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@nuxeo-satori/platform/components': [`${NXS_ROOT}/src/index.ts`] },
      },
    })}\n`,
    'libs/features/x/tsconfig.json': projectTsconfig({
      paths: { '@x/thing': [`${NXS_ROOT}/src/lib/thing/thing.component.ts`] },
    }),
  }),
  null,
  /libs\/features\/x\/tsconfig\.json alias `@x\/thing` points into libs\/shared\/satori-components/,
);

expectRed(
  'a consumer reaching into the library through a project-level wildcard alias',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'libs/features/x/tsconfig.json': projectTsconfig({ paths: { '@libs/*': ['../../*'] } }),
    [NXS_CONSUMER]:
      "import { NxsThingComponent } from '@libs/shared/satori-components/src/lib/thing/thing.component';\n",
  }),
  null,
  /x\.ts imports `@libs\/shared\/satori-components\/src\/lib\/thing\/thing\.component`, which reaches into/,
);

expectRed(
  'a project-level entry alias pointing past the barrel',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'libs/features/x/tsconfig.json': projectTsconfig({
      paths: {
        '@nuxeo-satori/platform/components': [
          '../../shared/satori-components/src/lib/thing/thing.component.ts',
        ],
      },
    }),
  }),
  null,
  /libs\/features\/x\/tsconfig\.json maps `@nuxeo-satori\/platform\/components` to \["libs\/shared\/satori-components\/src\/lib\/thing\/thing\.component\.ts"\]/,
);

falsePositiveControls += 1;
expectGreen(
  'a project tsconfig re-declaring the entry alias',
  'checkSatoriComponentsEntryPoint',
  NXS_LIB({
    'libs/features/x/tsconfig.json': projectTsconfig({
      paths: {
        '@nuxeo-satori/platform/components': ['../../shared/satori-components/src/index.ts'],
      },
    }),
    [NXS_CONSUMER]: "import { NxsThingComponent } from '@nuxeo-satori/platform/components';\n",
  }),
);

expectRed(
  'no barrel at all',
  'checkSatoriComponentsEntryPoint',
  { [NXS_COMPONENT]: nxsComponent() },
  null,
  /has no entry point and the no-deep-imports rule asserted nothing/,
);

// checkSatoriComponentsFederationReadiness

expectGreen('a standalone component', 'checkSatoriComponentsFederationReadiness', NXS_LIB());

// An explicitly provided service is the pattern the rule asks for, so it must not be flagged.
falsePositiveControls += 1;
expectGreen(
  'an @Injectable with no providedIn',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.service.ts`]:
      "import { Injectable } from '@angular/core';\n@Injectable()\nexport class ThingService {}\n",
  }),
);

// A test host is not part of the library.
falsePositiveControls += 1;
expectGreen(
  'a spec host component and a root service in a spec',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.component.spec.ts`]:
      "import { Component, Injectable } from '@angular/core';\n" +
      "@Component({ template: '' })\nclass Host {}\n" +
      "@Injectable({ providedIn: 'root' })\nclass Fake {}\n",
  }),
);

expectRed(
  'an NgModule in the library',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.module.ts`]:
      "import { NgModule } from '@angular/core';\n@NgModule({})\nexport class ThingModule {}\n",
  }),
  null,
  /thing\.module\.ts:2 declares an @NgModule/,
);

expectRed(
  'a component with standalone: false',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({ config: "selector: 'nxs-thing', standalone: false," }),
  }),
  null,
  /thing\.component\.ts:3 @Component does not say `standalone: true`/,
);

expectRed(
  'an aliased Component decorator with standalone: false',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [NXS_COMPONENT]:
      "import { Component as C } from '@angular/core';\n" +
      "@C({ selector: 'nxs-thing', standalone: false, templateUrl: './thing.component.html' })\n" +
      'export class NxsThingComponent {}\n',
  }),
  null,
  /thing\.component\.ts:2 @Component does not say `standalone: true`/,
);

expectRed(
  'an NgModule through a namespace import',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.module.ts`]:
      "import * as ng from '@angular/core';\n@ng.NgModule({})\nexport class ThingModule {}\n",
  }),
  null,
  /thing\.module\.ts:2 declares an @NgModule/,
);

expectRed(
  'a component that leaves standalone to the default',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({ [NXS_COMPONENT]: nxsComponent({ config: "selector: 'nxs-thing'," }) }),
  null,
  /@Component does not say `standalone: true`/,
);

expectRed(
  'a root-provided service',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.service.ts`]:
      "import { Injectable } from '@angular/core';\n" +
      "@Injectable({ providedIn: 'root' })\nexport class ThingService {}\n",
  }),
  null,
  /thing\.service\.ts:2 uses `providedIn`/,
);

expectRed(
  'a root-provided service with a quoted key',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.service.ts`]:
      "import { Injectable } from '@angular/core';\n" +
      "@Injectable({ 'providedIn': 'root' })\nexport class ThingService {}\n",
  }),
  null,
  /thing\.service\.ts:2 uses `providedIn`/,
);

expectRed(
  'a root-provided service with a computed key',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.service.ts`]:
      "import { Injectable } from '@angular/core';\n" +
      "@Injectable({ ['providedIn']: 'root' })\nexport class ThingService {}\n",
  }),
  null,
  /thing\.service\.ts:2 uses `providedIn`/,
);

// A quoted `'standalone': true` is still standalone.
falsePositiveControls += 1;
expectGreen(
  'a component whose standalone key is quoted',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [NXS_COMPONENT]: nxsComponent({ config: "selector: 'nxs-thing', 'standalone': true," }),
  }),
);

expectRed(
  'a root-provided InjectionToken',
  'checkSatoriComponentsFederationReadiness',
  NXS_LIB({
    [`${NXS_ROOT}/src/lib/thing/thing.token.ts`]:
      "import { InjectionToken } from '@angular/core';\n" +
      "export const THING = new InjectionToken<number>('thing', {\n" +
      "  providedIn: 'platform',\n  factory: () => 1,\n});\n",
  }),
  null,
  /thing\.token\.ts:3 uses `providedIn`/,
);

expectRed(
  'no non-spec library sources',
  'checkSatoriComponentsFederationReadiness',
  { [`${NXS_ROOT}/src/lib/thing/thing.component.spec.ts`]: 'export {};\n' },
  null,
  /federation-readiness rules asserted nothing/,
);

// checkSatoriComponentsDependencies — the Storybook build is held to the same rule

const NXS_STORYBOOK_MAIN = `${NXS_ROOT}/.storybook/main.ts`;
const NXS_STORYBOOK_PROJECT = ({ styles, satoriStyles } = {}) =>
  `${JSON.stringify(
    {
      name: 'satori-components',
      targets: {
        'build-storybook': {
          options: { styles: styles ?? [`${NXS_ROOT}/.storybook/material-theme.scss`] },
          configurations: {
            satori: { styles: satoriStyles ?? [`${NXS_ROOT}/.storybook/satori-theme.scss`] },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
const NXS_STORYBOOK = (extra = {}) =>
  NXS_LIB({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT(),
    [NXS_STORYBOOK_MAIN]:
      "export default { stories: ['../src/**/*.stories.ts'], framework: { name: '@storybook/angular', options: {} } };\n",
    [`${NXS_ROOT}/.storybook/preview.ts`]:
      "import type { Preview } from '@storybook/angular';\nexport default {} satisfies Preview;\n",
    [`${NXS_ROOT}/.storybook/material-theme.scss`]: "@use '@angular/material' as mat;\n",
    [`${NXS_ROOT}/.storybook/satori-theme.scss`]:
      "@use '@hylandsoftware/satori-ui/theme' as sat;\n",
    ...extra,
  });

// The opt-in `:satori` configuration is the one place under `.storybook/` that may need a token.
falsePositiveControls += 1;
expectGreen(
  'a Satori theme named only by the opt-in :satori Storybook configuration',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK(),
);

expectRed(
  'a Satori import in the Storybook preview',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/.storybook/preview.ts`]:
      "import { provideSatori } from '@hylandsoftware/satori-ui/providers';\nexport const p = provideSatori;\n",
  }),
  null,
  /\.storybook\/preview\.ts imports `@hylandsoftware\/satori-ui\/providers`/,
);

expectRed(
  "a Satori theme in the default build-storybook configuration's styles",
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/satori-theme.scss`],
    }),
  }),
  null,
  /\.storybook\/satori-theme\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a default Storybook theme that @uses a Satori partial',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/.storybook/material-theme.scss`]: "@use 'tokens';\n",
    [`${NXS_ROOT}/.storybook/_tokens.scss`]: "@forward '@hylandsoftware/satori-ui/theme';\n",
  }),
  null,
  /\.storybook\/_tokens\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a default Storybook style that does not exist',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/missing.scss`],
    }),
  }),
  null,
  /names `libs\/shared\/satori-components\/\.storybook\/missing\.scss` in build-storybook's styles, and it does not exist/,
);

// Angular compiles every `styles` entry, not only `.scss`: a CSS or indented-Sass default theme is
// held to the same rule.
expectRed(
  'a default Storybook theme written in CSS that imports Satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/material-theme.css`],
    }),
    [`${NXS_ROOT}/.storybook/material-theme.css`]:
      "@import '@hylandsoftware/satori-ui/theme.css';\n",
  }),
  null,
  /\.storybook\/material-theme\.css imports `@hylandsoftware\/satori-ui\/theme\.css`/,
);

expectRed(
  'a default CSS theme reaching Satori through a relative url() import',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/material-theme.css`],
    }),
    [`${NXS_ROOT}/.storybook/material-theme.css`]: "@import './tokens.css';\n",
    [`${NXS_ROOT}/.storybook/tokens.css`]: '@import url(@hylandsoftware/satori-ui/tokens.css);\n',
  }),
  null,
  /\.storybook\/tokens\.css imports `@hylandsoftware\/satori-ui\/tokens\.css`/,
);

expectRed(
  'a default indented-Sass theme whose second @use is Satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/material-theme.sass`],
    }),
    [`${NXS_ROOT}/.storybook/material-theme.sass`]:
      "@use '@angular/material' as mat\n@use '@hylandsoftware/satori-ui/theme' as sat\n",
  }),
  null,
  /\.storybook\/material-theme\.sass imports `@hylandsoftware\/satori-ui\/theme`/,
);

// The `:satori` configuration's theme is the one stylesheet that may reach Satori — exactly that one.
const storybookProjectWith = (configurations) =>
  `${JSON.stringify(
    {
      name: 'satori-components',
      targets: {
        'build-storybook': {
          options: { styles: [`${NXS_ROOT}/.storybook/material-theme.scss`] },
          configurations,
        },
      },
    },
    null,
    2,
  )}\n`;

expectRed(
  'another named Storybook configuration whose theme reaches Satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: storybookProjectWith({
      satori: { styles: [`${NXS_ROOT}/.storybook/satori-theme.scss`] },
      print: { styles: [`${NXS_ROOT}/.storybook/print-theme.scss`] },
    }),
    [`${NXS_ROOT}/.storybook/print-theme.scss`]: "@use '@hylandsoftware/satori-ui/theme';\n",
  }),
  null,
  /\.storybook\/print-theme\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'the Satori theme named by a configuration other than :satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: storybookProjectWith({
      satori: { styles: [`${NXS_ROOT}/.storybook/satori-theme.scss`] },
      print: { styles: [`${NXS_ROOT}/.storybook/satori-theme.scss`] },
    }),
  }),
  null,
  /\.storybook\/satori-theme\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

expectRed(
  'a second stylesheet in the :satori configuration that reaches Satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      satoriStyles: [
        `${NXS_ROOT}/.storybook/satori-theme.scss`,
        `${NXS_ROOT}/.storybook/satori-extra.scss`,
      ],
    }),
    [`${NXS_ROOT}/.storybook/satori-extra.scss`]: "@use '@hylandsoftware/satori-ui/tokens';\n",
  }),
  null,
  /\.storybook\/satori-extra\.scss imports `@hylandsoftware\/satori-ui\/tokens`/,
);

expectRed(
  'a stylesheet under .storybook that no configuration names, reaching Satori',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/.storybook/extra.scss`]: "@use '@hylandsoftware/satori-ui/theme';\n",
  }),
  null,
  /\.storybook\/extra\.scss imports `@hylandsoftware\/satori-ui\/theme`/,
);

falsePositiveControls += 1;
expectGreen(
  'a default indented-Sass theme on Material only',
  'checkSatoriComponentsDependencies',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/project.json`]: NXS_STORYBOOK_PROJECT({
      styles: [`${NXS_ROOT}/.storybook/material-theme.sass`],
    }),
    [`${NXS_ROOT}/.storybook/material-theme.sass`]:
      "@use '@angular/material' as mat\n@use 'tokens'\n",
    [`${NXS_ROOT}/.storybook/_tokens.sass`]: '$gap: 8px\n',
  }),
);

// checkSatoriComponentsHaveStories

const NXS_STORY = `${NXS_ROOT}/src/lib/thing/thing.stories.ts`;
const nxsStory = ({
  imports = "import { NxsThingComponent } from './thing.component';",
  meta = 'const meta: Meta<NxsThingComponent> = { component: NxsThingComponent };\nexport default meta;',
  stories = 'export const Basic: StoryObj<NxsThingComponent> = {};',
} = {}) =>
  `import type { Meta, StoryObj } from '@storybook/angular';\n${imports}\n${meta}\n${stories}\n`;

expectGreen(
  'an exported component with a story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_STORY]: nxsStory() }),
);

falsePositiveControls += 1;
expectGreen(
  'a story whose meta is the default export itself, behind satisfies',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: 'export default { component: NxsThingComponent } satisfies Meta<NxsThingComponent>;',
    }),
  }),
);

falsePositiveControls += 1;
expectGreen(
  'a story importing the component through the published entry point',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      imports: "import { NxsThingComponent } from '@nuxeo-satori/platform/components';",
    }),
  }),
);

// Two `export … from` statements naming one module must both be read.
falsePositiveControls += 1;
expectGreen(
  'a barrel re-exporting one module twice, each component storied',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/src/index.ts`]:
      "export { NxsThingComponent } from './lib/thing/thing.component';\n" +
      "export { NxsOtherComponent } from './lib/thing/thing.component';\n",
    [NXS_COMPONENT]:
      nxsComponent() +
      "@Component({ selector: 'nxs-other', standalone: true, template: '' })\n" +
      'export class NxsOtherComponent {}\n',
    [NXS_STORY]: nxsStory(),
    [`${NXS_ROOT}/src/lib/thing/other.stories.ts`]: nxsStory({
      imports: "import { NxsOtherComponent } from './thing.component';",
      meta: 'export default { component: NxsOtherComponent } as Meta<NxsOtherComponent>;',
      stories: 'export const Basic: StoryObj<NxsOtherComponent> = {};',
    }),
  }),
);

expectRed(
  'an exported component with no story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK(),
  null,
  /exports `NxsThingComponent` \(libs\/shared\/satori-components\/src\/lib\/thing\/thing\.component\.ts\), and no story documents it/,
);

expectRed(
  'a component exported through export * with no story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/src/index.ts`]: "export * from './lib/thing/thing.component';\n",
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a component exported by a bare export of an import, with no story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/src/index.ts`]:
      "import { NxsThingComponent } from './lib/thing/thing.component';\nexport { NxsThingComponent };\n",
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

// A class declared without `export` and exported later by a bare `export { X }` is exported all the same.
const nxsComponentExportedLater = () =>
  `${nxsComponent().replace('export class', 'class')}export { NxsThingComponent };\n`;

expectRed(
  'a component the barrel declares itself and exports by a bare export, with no story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/src/index.ts`]:
      "import { Component } from '@angular/core';\n" +
      "@Component({ selector: 'nxs-local', standalone: true, template: '' })\n" +
      'class NxsLocalComponent {}\nexport { NxsLocalComponent };\n' +
      "export { NxsThingComponent } from './lib/thing/thing.component';\n",
    [NXS_STORY]: nxsStory(),
  }),
  null,
  /exports `NxsLocalComponent` \(libs\/shared\/satori-components\/src\/index\.ts\), and no story documents it/,
);

expectRed(
  'a component its module declares and exports by a bare export, with no story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_COMPONENT]: nxsComponentExportedLater() }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

falsePositiveControls += 1;
expectGreen(
  'a component its module declares and exports by a bare export, with a story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_COMPONENT]: nxsComponentExportedLater(), [NXS_STORY]: nxsStory() }),
);

expectRed(
  'a story file that mentions the component but documents another',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      imports:
        "import { NxsThingComponent } from './thing.component';\nimport { Other } from './other';",
      meta: 'export default { component: Other, title: `${NxsThingComponent.name}` };',
    }),
    [`${NXS_ROOT}/src/lib/thing/other.ts`]: 'export class Other {}\n',
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a meta that names the component with no story exported',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_STORY]: nxsStory({ stories: '' }) }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a story outside src, where Storybook does not look',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [`${NXS_ROOT}/stories/thing.stories.ts`]: nxsStory({
      imports: "import { NxsThingComponent } from '../src/lib/thing/thing.component';",
    }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a Storybook main.ts that does not load the stories counted',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]: "export default { stories: ['../docs/**/*.mdx'] };\n",
  }),
  null,
  /main\.ts does not load `\.\.\/src\/\*\*\/\*\.stories\.ts`/,
);

// A story is a named export Storybook renders, after the meta's `includeStories`/`excludeStories`.
const filteredMeta = (filter) =>
  `export default { component: NxsThingComponent, ${filter} } satisfies Meta<NxsThingComponent>;`;

expectRed(
  'a meta whose excludeStories filters out its only export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: filteredMeta("excludeStories: ['fixture']"),
      stories: 'export const fixture = {};',
    }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a meta whose includeStories names no export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({ meta: filteredMeta("includeStories: ['Other']") }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a meta whose excludeStories regex matches every export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_STORY]: nxsStory({ meta: filteredMeta('excludeStories: /.*/') }) }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a meta whose excludeStories the guardrail cannot read',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: `const FILTERS = ['Basic'];\n${filteredMeta('excludeStories: FILTERS')}`,
    }),
  }),
  null,
  /thing\.stories\.ts sets `excludeStories` to something other than a list of names or a regex literal/,
);

falsePositiveControls += 1;
expectGreen(
  'a meta that excludes a fixture export and keeps a story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: filteredMeta("excludeStories: ['fixture']"),
      stories: 'export const fixture = {};\nexport const Basic: StoryObj<NxsThingComponent> = {};',
    }),
  }),
);

falsePositiveControls += 1;
expectGreen(
  'a meta whose includeStories regex matches its story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_STORY]: nxsStory({ meta: filteredMeta('includeStories: /^Bas/') }) }),
);

expectRed(
  'a shorthand excludeStories that filters out the only export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: `const excludeStories = ['fixture'];\n${filteredMeta('excludeStories')}`,
      stories: 'export const fixture = {};',
    }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

falsePositiveControls += 1;
expectGreen(
  'a shorthand excludeStories that keeps a story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: `const excludeStories = ['fixture'];\n${filteredMeta('excludeStories')}`,
      stories: 'export const fixture = {};\nexport const Basic: StoryObj<NxsThingComponent> = {};',
    }),
  }),
);

expectRed(
  'a shorthand excludeStories naming an import the guardrail cannot read',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      imports:
        "import { NxsThingComponent } from './thing.component';\nimport { excludeStories } from './filters';",
      meta: filteredMeta('excludeStories'),
    }),
  }),
  null,
  /thing\.stories\.ts sets `excludeStories` to something other than a list of names or a regex literal/,
);

expectRed(
  'a meta that spreads another object in',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: `const shared = { excludeStories: ['Basic'] };\n${filteredMeta('...shared')}`,
    }),
  }),
  null,
  /thing\.stories\.ts spreads another object into its default-exported meta/,
);

// Meta keys are read as JavaScript reads them, so a computed or repeated key filters as Storybook does.
expectRed(
  'a computed excludeStories key that filters out the only story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({ [NXS_STORY]: nxsStory({ meta: filteredMeta("['excludeStories']: ['Basic']") }) }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'a meta key computed from an expression the guardrail cannot read',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: `const KEY = 'excludeStories';\n${filteredMeta("[KEY]: ['Basic']")}`,
    }),
  }),
  null,
  /thing\.stories\.ts computes a key of its default-exported meta/,
);

expectRed(
  'a repeated excludeStories whose later value filters out the only story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: filteredMeta("excludeStories: ['fixture'], ['excludeStories']: ['Basic']"),
    }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

expectRed(
  'an excludeStories accessor',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({ meta: filteredMeta("get excludeStories() { return ['Basic']; }") }),
  }),
  null,
  /thing\.stories\.ts sets `excludeStories` to something other than a list of names or a regex literal/,
);

falsePositiveControls += 1;
expectGreen(
  'a computed excludeStories key that keeps a story',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: filteredMeta("['excludeStories']: ['fixture']"),
      stories: 'export const fixture = {};\nexport const Basic: StoryObj<NxsThingComponent> = {};',
    }),
  }),
);

// Every named-export form Storybook renders is a story, under the name it is exported as.
falsePositiveControls += 1;
expectGreen(
  'a story exported by a bare export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      stories: 'const Basic: StoryObj<NxsThingComponent> = {};\nexport { Basic };',
    }),
  }),
);

falsePositiveControls += 1;
expectGreen(
  'a story exported under an alias that includeStories names',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: filteredMeta("includeStories: ['Basic']"),
      stories: 'const story: StoryObj<NxsThingComponent> = {};\nexport { story as Basic };',
    }),
  }),
);

falsePositiveControls += 1;
expectGreen(
  'a story exported as a function',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({ stories: 'export function Basic() {\n  return {};\n}' }),
  }),
);

falsePositiveControls += 1;
expectGreen(
  'a meta exported as default by a bare export',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      meta: 'const meta: Meta<NxsThingComponent> = { component: NxsThingComponent };\nexport { meta as default };',
    }),
  }),
);

expectRed(
  'a type-only export, which Storybook does not render',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory({
      stories: 'type Basic = StoryObj<NxsThingComponent>;\nexport { type Basic };',
    }),
  }),
  null,
  /exports `NxsThingComponent` .* no story documents it/,
);

// `.storybook/main.ts` is read for its exported `stories` list, not searched for the glob's text.
expectRed(
  'a Storybook main.ts that mentions the glob only in a comment',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "// '../src/**/*.stories.ts'\nexport default { stories: ['../docs/**/*.mdx'] };\n",
  }),
  null,
  /main\.ts does not load `\.\.\/src\/\*\*\/\*\.stories\.ts`/,
);

expectRed(
  'a Storybook main.ts whose stories list is not literal',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "const globs = () => ['../src/**/*.stories.ts'];\nexport default { stories: globs() };\n",
  }),
  null,
  /main\.ts does not export a `stories` list of string literals/,
);

falsePositiveControls += 1;
expectGreen(
  'a Storybook main.ts exporting a typed constant, as the library does',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "import type { StorybookConfig } from '@storybook/angular';\n" +
      "const config: StorybookConfig = { stories: ['../src/**/*.stories.ts'], addons: [] };\n" +
      'export default config;\n',
  }),
);

// The config's keys are read as JavaScript reads them: the last `stories` wins, and a spread or a
// computed key could be the one that replaces it.
expectRed(
  'a Storybook main.ts whose spread replaces the stories glob',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "export default { stories: ['../src/**/*.stories.ts'], ...{ stories: ['../docs/**/*.mdx'] } };\n",
  }),
  null,
  /main\.ts does not export a `stories` list of string literals, with no spread or computed key/,
);

expectRed(
  'a Storybook main.ts whose later stories key replaces the glob',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "export default { stories: ['../src/**/*.stories.ts'], ['stories']: ['../docs/**/*.mdx'] };\n",
  }),
  null,
  /main\.ts does not load `\.\.\/src\/\*\*\/\*\.stories\.ts`/,
);

expectRed(
  'a Storybook main.ts with a key computed from an expression',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "const KEY = 'stories';\n" +
      "export default { stories: ['../src/**/*.stories.ts'], [KEY]: ['../docs/**/*.mdx'] };\n",
  }),
  null,
  /main\.ts does not export a `stories` list of string literals, with no spread or computed key/,
);

falsePositiveControls += 1;
expectGreen(
  'a Storybook main.ts whose last stories key loads the glob',
  'checkSatoriComponentsHaveStories',
  NXS_STORYBOOK({
    [NXS_STORY]: nxsStory(),
    [NXS_STORYBOOK_MAIN]:
      "export default { stories: ['../docs/**/*.mdx'], ['stories']: ['../src/**/*.stories.ts'] };\n",
  }),
);

expectRed(
  'exported components and no Storybook at all',
  'checkSatoriComponentsHaveStories',
  NXS_LIB({ [NXS_STORY]: nxsStory() }),
  null,
  /\.storybook\/main\.ts does not exist/,
);

// checkNoProseInComponentInputs scans `nxs-` elements too, or the library's own selector prefix
// would be the one place hard-coded English could hide.
expectRed(
  'prose in an input on an nxs- component',
  'checkNoProseInComponentInputs',
  {
    'libs/features/x/src/lib/x.html':
      '<nxs-empty-state heading="Nothing here"></nxs-empty-state>\n',
  },
  null,
  /sets `heading="Nothing here"` on `<nxs-empty-state>`/,
);

/* ---------------- report ---------------- */

const total = negative + positive;
console.log(
  `review-guardrails selftest: ${total} controls — ${negative} negative (a broken tree must go ` +
    `red, for the stated reason) and ${positive} positive (a correct tree must stay green), ` +
    `of which ${falsePositiveControls} assert that a specific non-violation is NOT flagged.`,
);

if (failures.length) {
  console.error(`\n${failures.length} control(s) did not behave as required:`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('All controls behaved as required.');
