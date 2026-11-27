# Tutorial: adding a language

For the developer and the administrator who bring a language to the app and its kits, and for the
Crowdin managers whose part comes first: what the repository does, in which order, what each
Crowdin manager must do on the project, and how a kit's labels in a new language reach a server.
The source of truth is [administrator-guide.md](../administrator-guide.md), section 4,
"Languages", and the comment at the top of
[`register-locale-data.ts`](../../../apps/nuxeo-ui/src/app/i18n/register-locale-data.ts). This
tutorial follows them as a task, and runs what can run.

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5`, on macOS with Node 24.22.1: the coverage report, the Crowdin tools' controls, and a
kit's new labels file on a scratch copy of the contracts kit, through the package pipeline and the
write tools. The outputs quoted are that run's, trimmed. The report and the controls ran again after the branch's merge of `3c1c4c51d`, which added the letters add-on, with the same outputs. Nothing was done on Crowdin, no workflow was
run, and no server was touched: those steps are marked **Crowdin step** or **Server step**, and
were not run. **No translation was written:** translations come from Crowdin, never from this
repository.

## Where the languages stand

Read from the two branches with git on 27 November 2026, and from the coverage report:

| Where                          | Languages the app ships a catalogue for                    |
| ------------------------------ | ---------------------------------------------------------- |
| `staging/enterprise-grade-app` | `en`, `de`, `fr`, `ja`, `nl`                               |
| `main`                         | `en`, `ar`, `de`, `es`, `fr`, `he`, `it`, `ja`, `nl`, `sv` |

Each of `main`'s reaches the staging branch when `main` is merged into it. The administrator's
guide, section 4, read the same day, still says Spanish waits in Crowdin's pull request into `main`;
`main`'s tree has its catalogue, from NXSAT-754 on 24 November 2026. Danish, Finnish and
Norwegian Bokmål, `da`, `fi` and `nb`, are registered here and are not yet Crowdin targets. **No
kit has a labels file in any language but English.**

```bash
npm run i18n:coverage
```

```text
The app — apps/nuxeo-ui/public/i18n (en: 3486 keys)
    ar    no file: every key is English
    da    no file: every key is English
    de     2013/3486  57.7%    1473 missing      65 as English
    es    no file: every key is English
    …
Kits — business-apps/packages/<kit>/bundle/agentic-ui-config/labels
  brand-assets-demo (en: 39 keys)
    no file in ar, da, de, es, fi, fr, he, it, ja, nb, nl, sv: every key is English
  …
```

A key a language does not give shows in English, key by key, never as the key: in the app through
the fallback language, and for a kit on the server too. "As English" counts texts equal to English,
which is what Crowdin's approved-only export writes for a string not yet approved. The report is a
report, not a gate: it exits 0 whatever it finds. `--missing` lists every missing key.

## 1. On Crowdin, first

**Crowdin step, by a Crowdin manager on the project, with the Translation Team.** None was done
here. From the administrator's guide:

1. **Add the target language** before anyone requests it here: a pull fails as a whole on a
   language the project does not have. For Norwegian Bokmål, choose **one** of Crowdin's two,
   "Norwegian Bokmal" (`nb`) or "Norwegian" (`no`): both configs write either as `nb.json`, the name
   the app reads, through `languages_mapping` in [`crowdin-conf.yml`](../../../crowdin-conf.yml) and
   [`crowdin-kits.yml`](../../../crowdin-kits.yml).
2. **Hide the `$schema` string** in each kit's labels file, once the kits' sources are on the
   project: it is the address of a schema for editors, not a label. Crowdin Push uploads the kits'
   `labels/en.json` on its next run.
3. **Have the strings translated and approved.** Only approved translations are exported, since
   both configs set `export_only_approved`. A string not yet approved arrives as its English source.
4. **Confirm the project's own export settings keep approved-only export,** since they take
   precedence over the pipeline's: the open owner action `D8-standard` in
   [i18n-localization-plan.md](../../i18n-localization-plan.md).

## 2. In the repository: the app's catalogue, in two steps

**A developer, on `main`.** Six touchpoints, in two steps, because four of them cannot run ahead of
the translated catalogue: a guardrail or a spec fails each, and `.husky/pre-push` runs the
guardrails.

**Step 1, request it,** safe before any translation exists:

- an entry in `LOCALE_DATA` in `apps/nuxeo-ui/src/app/i18n/register-locale-data.ts`: Angular's
  locale data, for dates, numbers and amounts. Today it registers `ar`, `da`, `de`, `es`, `fi`,
  `fr`, `he`, `it`, `ja`, `nb`, `nl` and `sv`. Registration ahead of a catalogue only warns
  (`checkLocaleDataRegistered`); a catalogue with no registration fails the guardrails, since a
  date pipe would throw `NG0701`;
- a `--language` in `download_translations_args` in
  [`crowdin-pull.yaml`](../../../.github/workflows/crowdin-pull.yaml), which downloads only the
  languages listed. On this branch it lists `fr`, `de`, `ja`, `nl` and `es`. **The id is Crowdin's:**
  `no` if the project targets "Norwegian". The pull is one shared pull request, so a language listed
  with no approvals holds every other language's catalogue red: list one once its approvals exist.

**Step 2, advertise it,** in the nightly pull's pull request, which brings
`apps/nuxeo-ui/public/i18n/<language>.json`:

- `SHIPPED_CATALOGUE_LANGUAGES` in
  [`shipped-catalogues.ts`](../../../apps/nuxeo-ui/src/app/i18n/shipped-catalogues.ts). Mandatory:
  without it a catalogue ships and is never used, and the app boots in English.
  `checkShippedCatalogueLanguages` fails either direction;
- `availableLanguages` in both Layer 0 configurations,
  [`bootstrap.defaults.json`](../../../nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json)
  and `DEFAULT_APP_BOOTSTRAP_CONFIG` in `libs/shared/app-config/src/lib/bootstrap-config.ts`.
  `checkAdvertisedLocalesShip` fails a language advertised without its catalogue;
- `DATE_FNS_LOCALES` in `libs/shared/ui/src/lib/date-adapter/satori-date-adapter.ts`, the date
  picker's, in another library and easy to miss: a test holds it equal to `availableLanguages`. On
  this branch it has `en`, `fr`, `de`, `ja` and `nl`, with their regional entries.

Until those three are in, that pull request is red, on purpose. The Crowdin tools' own controls:

```bash
npm run review:crowdin-selftest
```

```text
crowdin-push-context selftest: 16 controls.
All controls behaved as required.
crowdin-status selftest: 10 controls.
All controls behaved as required.
crowdin-sources selftest: 23 controls.
All controls behaved as required.
coverage selftest: 27 controls.
All controls behaved as required.
```

## 3. In the repository: a kit's labels

A kit's labels are `labels/<language>.json` beside its `labels/en.json`, written by Crowdin from
the English, never by hand. They have a config and a pull of their own, `crowdin-kits.yml` and
[`crowdin-pull-kits.yaml`](../../../.github/workflows/crowdin-pull-kits.yaml), because each new file
needs its kit named and versioned before the kit builds.

**A developer, on `main`, once a kit string is approved:**

1. sets the repository variable `CROWDIN_KIT_LABELS_ENABLED` to `true`, which turns the kits' pull
   on, beside the sync's own switch; and in the same change sets the pull's
   `download_translations_args` to the languages with approved kit strings. It holds
   `--language=fr` alone until then, as a placeholder: a language listed with no approval writes
   every kit's file in English;
2. in each pull request the kits' pull opens, for each kit with a new file, names it in the kit's
   component and raises the kit's version.

What the pipeline does with a kit's new file, on a scratch copy of the contracts kit, its French file
English throughout, as Crowdin writes one before any approval:

```bash
mkdir -p /tmp/language-kits
cp -R business-apps/packages/contracts-demo /tmp/language-kits/
K=/tmp/language-kits/contracts-demo
cp $K/bundle/agentic-ui-config/labels/en.json $K/bundle/agentic-ui-config/labels/fr.json
npm run app-package -- $K --platform 0.2.0
```

```text
/tmp/language-kits/contracts-demo: step 2 refused it: OSGI-INF/contracts-demo-config.xml does not name labels/fr.json in the app contracts, so the app registry would not serve it. Add a <file path="..."> for each, as the app-registry generator does.
```

**Name it,** with `app-registry`. In the repository that is
`npx nx g ./tools/satori-generators:app-registry --package=business-apps/packages/<kit>`; on the
scratch copy, outside the workspace, the write tool runs the same generator:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/language-kits \
  node tools/builder-mcp/src/call.ts apply_generator '{ "package": "/tmp/language-kits/contracts-demo", "generator": "app-registry", "options": {} }'
```

It answered `written: true`, the component updated, "Now names: labels/fr.json". **Then hold it to
the kit as it was,** as CI holds a pull request to its base:

```bash
npm run app-package -- $K --platform 0.2.0 --previous business-apps/packages/contracts-demo
```

```text
  - judge: bundle/OSGI-INF/contracts-demo-config.xml changed.
  - addition: The labels file for fr is added.
/tmp/language-kits/contracts-demo: step 3 refused it: the content changed since 0.2.1 (2 changes), and the version is still 0.2.1. Raise it to 0.2.2 at least, a patch version, in package.xml and app.json's packageVersion together.
```

The pipeline asks a patch at least; the administrator's guide asks **a minor for a new language**,
a patch for changed texts. Raise it in the three places together, `package.xml`, `app.json`'s
`packageVersion` and the manifest's `Bundle-Version`:

```bash
perl -pi -e 's/version="0.2.1"/version="0.3.0"/' $K/package/package.xml
perl -pi -e 's/"packageVersion": "0.2.1"/"packageVersion": "0.3.0"/' $K/bundle/agentic-ui-config/app.json
perl -pi -e 's/Bundle-Version: 0.2.1/Bundle-Version: 0.3.0/' $K/bundle/META-INF/MANIFEST.MF
npm run app-package -- $K --platform 0.2.0 --previous business-apps/packages/contracts-demo
```

Edit them in place, with no backup beside them: a backup file left in `bundle/` is packaged, and
counted as a change.

```text
Since 0.2.1: 2 changes, which need a patch version. 0.3.0 raises the minor.
contracts-demo 0.3.0: checked, built and verified: /tmp/language-kits/contracts-demo/dist/contracts-demo-0.3.0.zip, sha256 …
```

**A language's file may give fewer keys than English, never one English lacks.** With a key added
to the French file that `labels/en.json` does not have, the pipeline refuses it, step 2:
`labels/en.json has no text for "<the key>": a language's labels give a text only to a key English
has`. A file with a subset of the keys passes, and the missing ones show in English.

## 4. Letters: a language is a template, not a catalogue

The letters add-on, [`nuxeo-agentic-letters`](../../../nuxeo-agentic-letters/README.md), merged on
27 November 2026 and installed nowhere, writes letters on a record from templates an administrator
keeps on the server. **Crowdin plays no part in them.** A letter's language is its template's,
`ltpl:language`:

- the letter is written in the language the person asks for, refused, 400, when no template is in
  it; with none asked for, in the record's `corr:language` when a template is in it, else in the
  server's `nuxeo.agentic.letters.language.default`, `en` unless set;
- so **a letter in a new language is a new template** in that language, for each letter, kept by an
  administrator, and no change to the repository's catalogues. The Payers kit's fictional templates
  are in `business-apps/packages/payers-claims-demo/demo/letters/`, in English and Spanish, which its
  seed writes on a server (its README, "The letters").

## 5. On the server

**Server step.** An administrator installs the kits' new versions, and sets `defaultLanguage` in the
deployment's Layer 0 configuration, which `availableLanguages` must list. The app runs in a language
only when the build ships its catalogue; given another, it says so in the browser's console and runs
in English. The app registry serves a kit's language over its English, key by key, and a language a
kit has no file for shows the kit's English.

**The demos in a language** show it only as far as Crowdin has approved it and these steps have
brought it here: on this branch, every kit label in every language is English today.

## Cleaning up

Remove `/tmp/language-kits`. Nothing here was written to the repository.
