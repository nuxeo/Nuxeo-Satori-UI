# Nuxeo Agentic Letters

Letters on a record, from templates an administrator keeps, in the record's language or a chosen
one: phase 7's "letters through Template Rendering" in the business apps
[development plan](../docs/business-apps/development-plan.md), and the architecture's Letters
module, "correspondence from templates, in several languages"
([architecture](../docs/business-apps/architecture.md)), with the
[Payers kit](../business-apps/packages/payers-claims-demo/README.md#the-letters)'s denial letter and
appeal decision letter.

Built on decision B's recommendation, one add-on per domain module, and on decision 3's for the
buttons that write a letter ([decision log](../docs/business-apps/decisions.md)), and **on the
platform's Template Rendering add-on**, which the package depends on.

**Nothing here is installed on any server yet.** It is proven by its tests, in Nuxeo's own test
framework, with the platform's Template Rendering deployed from its own jar. The install below is
for the reviewer.

## What the platform gives

Found on 27 November 2026, read only.

| Where                                                   | What it says                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nuxeo's Marketplace                                     | `nuxeo-template-rendering` is published for LTS 2025 (2025.0.157 to 2025.29.3) and LTS 2023, Nuxeo supported, with no subscription of its own, for Nuxeo Online Services customers; Apache 2.0                                                                                                                                       |
| The Maven repository this build reads                   | `org.nuxeo.template.rendering:nuxeo-template-rendering-api`, `-core`, `-xdocreport` and `-jxls` resolve from `packages.nuxeo.com/repository/maven-public` up to **11.5.154**, the platform every add-on here builds and tests against. **No LTS 2025 version is there,** under that group or any other the repository's search finds |
| Nuxeo's source, `nuxeo/nuxeo`'s `2025` branch           | The LTS 2025 add-on, `modules/platform/nuxeo-template-rendering`: every interface, descriptor and property name the add-on uses is as in 11.5.154 (below), and its types component, `core-types-contrib.xml`, is the same file byte for byte                                                                                         |
| The local server (`nxserver/bundles`, `packages/store`) | Nuxeo LTS 2025.10.18, **without** `nuxeo-template-rendering`. It has `nuxeo-platform-rendering`, the FreeMarker engine, and `nuxeo-automation-core`, whose `Render.Document` the architecture names                                                                                                                                  |

**What Template Rendering offers.** Templates are documents: `TemplateSource`, with its file in
`file:content` and the `documenttemplate` schema (`tmpl:`): its name, the record types it is for
(`tmpl:applicableTypes`), the processor that renders it (`tmpl:templateType`), an output format
(`tmpl:outputFormat`, converted after rendering, PDF among them where the server has the
converters), a forced binding to every new document of a type, a rendition it answers for. A
document is bound to a template by the `TemplateBased` facet (`nxts:bindings`), and rendered to a
file by `TemplateBasedDocument.renderWithTemplate`, through the template processor service, which
dispatches to a processor registered at its `processor` extension point: the platform's are
FreeMarker, XSLT, Identity, XDocReport for Word and OpenDocument files, and JXLS for spreadsheets.
Its operations are `TemplateProcessor.Render`, which binds any document to a template by name and
renders it, and `TemplateProcessor.Detach`; and a rendition provider renders a bound document for
the rendition its template names.

**What the add-on takes from it, and what not.** It takes the template documents, the binding, the
processor service and its dispatch, the rendering and the output conversion: a letter template is a
`TemplateSource`, and a letter a document bound to it and rendered by `renderWithTemplate`. **It
does not take the platform's processors.** FreeMarker, which XDocReport also runs inside a Word or
OpenDocument file, is an expression language over the platform's context, the document, the
principal, the audit and `core.getParent()` and `core.getChildren()` among it, and a template that
holds an expression runs it. So the add-on registers a processor of its own,
`agenticLetter`, which fills placeholders and runs nothing, and holds every letter template to it.
Nor does it take `TemplateProcessor.Render`: a letter is written by the add-on's own operation,
which checks who asks and what the template holds first. `Render.Document`, Automation's, renders a
FreeMarker or MVEL template given as a parameter, and is not used.

**So the add-on is built on the platform, not behind a stand-in.** It compiles against
`nuxeo-template-rendering-api` 11.5.154, the one that resolves, and its tests run on Template
Rendering 11.5.154's own jar, as the other add-ons' tests run on 11.5's platform. That LTS 2025's
names are the same is held two ways: by reading the 2025 source, once, for each name, and by
`TemplateRenderingModelTest`, which holds every name the add-on reads to the platform's own files,
so that a version of the platform that renames one fails the build.

| The add-on uses, of Template Rendering                                                                                                                                                                                                                         | The same on LTS 2025                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `TemplateProcessor`, `renderTemplate(TemplateBasedDocument, String)` and `getInitialParametersDefinition(Blob)`                                                                                                                                                | Yes, both signatures                             |
| `TemplateProcessorService`: `getProcessor`, `makeTemplateBasedDocument`, `getOutputFormatDescriptor`, `findProcessorName`, `getRegisteredTemplateProcessors`                                                                                                   | Yes, every one                                   |
| `TemplateBasedDocument.renderWithTemplate`, `getTemplateNames`; `TemplateSourceDocument.getName`                                                                                                                                                               | Yes                                              |
| The `processor` point's descriptor: `name`, `label`, `class`, `default`, `supportedMimeType`, `supportedExtension`                                                                                                                                             | Yes, `TemplateProcessorDescriptor`'s annotations |
| `TemplateSource`, the `Template` and `TemplateBased` facets, `documenttemplate` (`tmpl:`), `templatesupport` (`nxts:`), and the components `org.nuxeo.platform.TemplateSources.doctypes`, `.listener`, `org.nuxeo.template.service.TemplateProcessorComponent` | Yes: `core-types-contrib.xml` unchanged          |

## The short version

- **A kit's record type carries `Correspondence`** (`correspondence`, `corr:`), so letters may be
  written on it, in its `corr:language` when a template is in it.
- **A letter template is a `LetterTemplate`:** the platform's `TemplateSource` with the add-on's
  facet of the same name (`letter_template`, `ltpl:`), naming its letter (`ltpl:letter`, such as
  `payers.denial`), its language (`ltpl:language`), and the conditions the stored record must meet
  (`ltpl:conditions`, each `prefix:name=value`); the platform's `tmpl:applicableTypes` names the
  record types it is for. **Administrators alone** create, change, copy, trash or remove one, and it
  is checked when it is saved.
- **A template holds text and placeholders, and nothing that runs:** an HTML or text file whose
  `{{prefix:name}}` placeholders name a property of the record, one hop through a property holding
  a document's id, `{{claim:member>member:lastName}}`, or the letter's date, writer and language.
  No other engine's syntax, no script, no link, no image, no style that fetches. Values are escaped.
- **`Letter.Generate`,** an Automation operation, writes a letter on a record, for someone who may
  write it, from the one template of its letter that is in the language asked for, or the record's,
  or the server's default, and whose conditions the record meets. It reads every value as that
  person, renders through the platform's template processor service with the add-on's processor,
  files the letter next to the record as a `Letter` bound to its template, and records it in the
  record's history.
- **A letter is kept as it was written:** no one changes it, an administrator included; it is not
  copied; an administrator alone trashes or removes it.
- **A button writes a letter only through decision 3's allow-list:** a kit's chain, beginning with
  `AgenticUi.RequireRunAction`, which the deployment allows, runs `Letter.Generate`. The operation
  is on Nuxeo's own Automation endpoint too, for anyone, and its own checks are the control.

## What is in it

| File                                                         | What it is                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/letters/`                   | The bundle: the operation, the generator, the template's checks, the processor, the guards, the audit                |
| `src/main/resources/OSGI-INF/letters-schema-contrib.xml`     | `org.nuxeo.agentic.letters.schema`: the two facets, the three schemas, `LetterTemplate` and `Letter`                 |
| `src/main/resources/OSGI-INF/letters-processor-contrib.xml`  | The processor `agenticLetter`, at the platform's template processor service                                          |
| `src/main/resources/OSGI-INF/letters-operations-contrib.xml` | `Letter.Generate`                                                                                                    |
| `src/main/resources/OSGI-INF/letters-listener-contrib.xml`   | The guards, before the platform's own template listener, and the audit's writer                                      |
| `src/main/package/`                                          | The Marketplace package, `nuxeo-agentic-letters` 0.1.0, which depends on `nuxeo-template-rendering`                  |
| `src/test/java/`                                             | 58 tests: 52 in Nuxeo's test framework, with Template Rendering 11.5.154 and the platform's audit, 6 with no runtime |

## The model

**`Correspondence`, on a kit's record type.**

| Property        | What it holds                                                                          |
| --------------- | -------------------------------------------------------------------------------------- |
| `corr:language` | A language tag, such as `en` or `es`: the language the record's letters are written in |

**`LetterTemplate`, the platform's `TemplateSource` and the add-on's facet.** Its file is the
platform's `file:content`, its title the letter's title.

| Property                                                                | Whose    | What it holds                                                                                         |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `tmpl:templateName`                                                     | Platform | Its name, letters, digits, dots, hyphens and underscores: `payers-denial-es`                          |
| `tmpl:applicableTypes`                                                  | Platform | The record types it is for, one by one, each carrying `Correspondence`; never `all`                   |
| `tmpl:templateType`                                                     | Platform | `agenticLetter`, the add-on's processor: written by the add-on when none is named, and no other taken |
| `tmpl:outputFormat`                                                     | Platform | None, or one of the platform's output formats, which converts the letter after it is rendered         |
| `tmpl:forcedTypes`, `tmpl:useAsMainContent`, `tmpl:targetRenditionName` | Platform | None, false and none: no other way of binding or rendering it                                         |
| `ltpl:letter`                                                           | Add-on   | The letter it is a template of, as a button asks for it: `payers.denial`                              |
| `ltpl:language`                                                         | Add-on   | Its language tag                                                                                      |
| `ltpl:conditions`                                                       | Add-on   | Twenty at most, each `prefix:name=value`, a property of each of its types: what the record must hold  |

**`Letter`, the add-on's.** Every property is the server's.

| Property                                 | What it holds                                                |
| ---------------------------------------- | ------------------------------------------------------------ |
| `letter:record`                          | The record it was written on, by id                          |
| `letter:letter`                          | Its letter                                                   |
| `letter:template`, `letter:templateName` | The template it was written from, by id, and its name then   |
| `letter:language`                        | Its language                                                 |
| `letter:writtenBy`, `letter:writtenAt`   | Who wrote it, by user name, and when                         |
| `file:content`                           | The letter, as HTML or text, or the template's output format |
| `dc:title`                               | The template's title, a comma, and the record's title        |
| `nxts:bindings`                          | The platform's binding to its template                       |

## How a letter is written

`Letter.Generate`, as the person who asks, in this order, so that nothing is read or written before
it may be. Its input is the record; its parameters `letter`, required, and `language`, which may be
left out. A refusal writes nothing, with the status the REST API answers.

1. **The record, read as the person:** one they may not read is the platform's refusal, 403. It is
   the record itself, not a version or a proxy, and its type carries `Correspondence` (400).
2. **The person may write it** (`Write`): 403 otherwise, before any template is looked for, so that
   a reader learns nothing of which letters there are. A record in the trash is 409.
3. **The letter's id and the language asked for** are of their forms (400).
4. **The letter's templates:** the live `LetterTemplate`s of that letter for the record's type, as
   the person may read them. None is 404, and a template the person may not read is none.
5. **The language:** the one asked for, 400 when no template is in it; with none asked for, the
   record's `corr:language` when a template is in it, else the server's default,
   `nuxeo.agentic.letters.language.default`, `en` when unset, else 404.
6. **The one template** of that language whose conditions the stored record meets, each
   `prefix:name=value` held by the property, or by one of a list's values. None is 409, and so are
   two: an administrator gives them conditions that tell them apart.
7. **Checked again,** as when it was saved ([below](#what-a-template-may-hold-and-reach)): one that
   no longer passes, saved by a server without the add-on or before the server denied a property it
   names, is 409.
8. **Its values, read as the person:** the record's, and each document a placeholder reaches one hop
   away, which the person must be able to read (403 otherwise) and which must still exist (409).
9. **Written:** a `Letter` created next to the record, in its folder, as the person, who must be
   able to add a document there, the platform's 403 otherwise; bound to its template by the
   platform; rendered by `renderWithTemplate`, through the platform's template processor service, by
   the add-on's processor, with the values above, and converted to the template's output format
   when it names one; its file saved; and its audit entry fired on the record. It answers the letter.

## What a template may hold, and reach

The add-on's processor is not a template engine: it has no expression, no directive, no call, no
include and no loop, so nothing in a template runs, whatever it holds. A template is still refused
when it holds another engine's syntax, so that no one mistakes it for one that runs, and so that it
runs nowhere else either should its processor be changed; and, being HTML, when it holds what a
browser runs or fetches. Checked when it is saved, and again each time a letter is written from it.

- **A file:** HTML (`text/html`, `.html`, `.htm`) or text (`text/plain`, `.txt`), at most 256 KiB,
  UTF-8, with no control character but tabs and line breaks. A Word or OpenDocument file is refused:
  the platform's processors for them run expressions.
- **No other engine's syntax,** anywhere: FreeMarker's `${`, `#{`, `<#`, `[#`, `<@`; Velocity's
  directives, `#set(` and the rest, and references, a `$` before a letter, a brace or a bang; JSP's
  `<%`, Jinja's `{%`. An amount is written `USD 10`, or with a placeholder.
- **HTML that runs and fetches nothing:** the tags of a letter's text and layout only, `p`, `div`,
  `span`, headings, lists, tables, `strong`, `em`, `br`, `hr`, `address`, `header`, `footer` and their
  kind, with `html`, `head`, `body`, `title`, `style` and `meta` for its charset alone; the attributes
  `class`, `style`, `lang`, `dir`, `title`, `colspan` and `rowspan`. No `script`, `a`, `img`, `iframe`,
  `form`, `object` or `svg`, no event handler, no `javascript:`, `url(`, `@import` or `expression(`,
  no conditional comment, no `<` that does not begin a tag. **No placeholder inside a tag, a comment
  or a style sheet,** where a value could become markup or a style: a placeholder is in the text.
- **Placeholders, 500 at most, each one of:**
  - `{{prefix:name}}`, or a complex property's subfield, `{{prefix:name/sub}}`: a property of the
    record, a value or a list of values, which **each** of the template's types has;
  - `{{prefix:ref>prefix2:name}}`: one hop through a property of the record holding a document's id,
    a text, to a property of the schema of that prefix, read as the person;
  - `{{letter.date}}`, `{{letter.writer}}`, `{{letter.language}}`: the day it is written, in its
    language's long form, who writes it, their first and last names or their user name, and its
    language.

  Nothing else: not the platform's FreeMarker context, the session, the principal or the server; no
  `ecm:` field, no file, no property holding several fields, no second hop, no call, no filter.

- **Never a property the server denies,** `nuxeo.agentic.letters.properties.denied`, `prefix:name`
  separated by commas, such as a member's social security number: a template naming one is refused
  when it is saved, and no letter is written from one saved before.
- **Values:** escaped for HTML in an HTML letter, `&`, `<`, `>`, `"` and `'`; as they are in a text
  letter, which a browser does not run. Dates in the letter's language's long form, decimals with two
  places and its grouping, lists joined by commas, and no control character but tabs and line breaks.

**And the add-on's processor renders nothing but the letter being written.** Asked by the
platform's `TemplateProcessor.Render`, which binds any document to a template it may read, by a
rendition, or to render a letter again, it refuses, 403: a letter template is reached through
`Letter.Generate` alone. It names no mime type or extension, so the platform never chooses it for a
file by itself.

## What no one but the server changes

The listener `letterGuard`, synchronous, in the transaction of the change, before the platform's
own template listener. Every refusal is 403 but a template's check, 400, and marks the transaction
for rollback.

| What                                                                       | Who may                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| Create, change, copy, trash, restore or remove a letter template           | An administrator signed in, or the server's own code |
| Save a letter template that does not pass its check                        | No one                                               |
| Create a letter                                                            | `Letter.Generate` alone, as the person who writes it |
| Change a letter's `letter:` properties, its file, its title or its binding | No one, an administrator included                    |
| Copy a letter                                                              | No one: a copy would be a letter no one wrote        |
| Trash, restore or remove a letter                                          | An administrator                                     |

A letter's description, and what the platform writes on any document, may change. The platform's
own template listener keeps a template with documents bound to it from being removed: an
administrator who removes one whose letters exist is refused by the platform.

## The audit

Each letter adds one entry to the platform's audit, on its record, so it is in the record's
history: event `letterGenerated`, category `Letters`, by its writer, with the comment "alice wrote
the letter payers.denial, `<id>`, from the template payers-denial-es, in es, the record's
language", and as extended information the letter, its id, the template's id and name, the
language, why that language (`chosen`, `record` or `default`) and who. Fired in the transaction
that writes the letter, so a refused or failed letter records nothing, and written to the audit
once it commits, as the documents and records add-ons write theirs (`LetterAuditWriter`,
`AuditAccess`). The platform records the letter's own creation on the letter.

## Settings

| Property                                  | Default     | What it does                                                             |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `nuxeo.agentic.letters.language.default`  | `en`        | The language a letter falls back to; one that is no language tag is `en` |
| `nuxeo.agentic.letters.properties.denied` | Unset: none | Properties no template may name, `prefix:name`, separated by commas      |

Both read at each letter, from `nuxeo.conf`.

## Building it

Java 21 and Maven, with the Nuxeo public repository the parent POM names.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-letters/pom.xml verify
# target/nuxeo-agentic-letters-0.1.0.zip, the Marketplace package, after 58 tests
```

The root `pom.xml` lists the module, and the Marketplace workflow (`build-marketplace.yml`) builds
and tests it on the pull requests it sees; it does not publish it.

| Test                            | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GenerateTest`, 6               | **Generate and file:** the letter next to its record, linked to it and to its template, its title, file name and type; every placeholder filled, a reference's, a date's, an amount's, a list's; bound to its template as the platform binds a document; a record's values escaped; a text letter                                                                                                                                                        |
| `LanguageTest`, 11              | **The language choice:** the record's; one chosen over it; one chosen with no template, 400, and one of no form; the default, and the server's; none at all, 404; the template whose conditions the record meets, none or two fitting, 409; a trashed template none                                                                                                                                                                                      |
| `PermissionTest`, 8             | **Refused without Write**, before any template is looked for; a record that cannot be read; no right to add a document beside it; a record printed that the writer may not read; a template the writer may not read; a type without the facet; a record in the trash. Nothing written                                                                                                                                                                    |
| `TemplateSafetyTest`, 9         | **A template that tries to reach what it should not, refused:** other engines' syntax, FreeMarker's object maker among it; HTML that runs or fetches; a placeholder in markup; the context, the session, files, fields, a second hop; a denied property, on save and on writing; another processor, a forced type, the main content; the processor refusing the platform's own ways to render; a template past the save refused when a letter is written |
| `GuardTest`, 7                  | Templates kept by administrators: created, changed, copied, trashed, removed; a letter written by `Letter.Generate` alone, changed by no one, an administrator included, not copied, trashed by an administrator alone                                                                                                                                                                                                                                   |
| `AuditTest`, 2                  | **The audit entry:** on the record, by its writer, category `Letters`, the letter, its template and its language and why; a refused letter audits nothing                                                                                                                                                                                                                                                                                                |
| `BundleTest`, 5                 | The components; the facets, schemas and types; the processor at the platform's service, chosen for no file by itself; one operation, and no allow-list contribution, chain or REST binding; the version                                                                                                                                                                                                                                                  |
| `TemplateRenderingModelTest`, 4 | Every name of the platform's the add-on reads, held to Template Rendering's own files; its listener runs on a letter template                                                                                                                                                                                                                                                                                                                            |
| `TemplateTextTest`, 6           | The file's reading, with no runtime: text and placeholders, the formats, what is refused and what is taken; the Payers kit's six templates taken                                                                                                                                                                                                                                                                                                         |

**Each guard was seen failing** ([below](#how-the-guards-were-seen-failing)).

## How the guards were seen failing

Each mutation below was made to the code, one at a time, the test class named run, and the code put
back, by a script kept outside the repository. Three stayed green at first, each because another
check refused the same template or request first: a language of no form refused as having no
template, a template for `all` refused as naming no type, and Velocity's directives refused for the
reference beside them. The tests were made to tell them apart, by the refusal's reason and by a
directive with no reference, and all three went red. 31 of 31 red.

| #     | The guard broken                                                                                                                                                         | Red in               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 1-3   | No `Write` check; a type without `Correspondence` taken; a record in the trash taken                                                                                     | `PermissionTest`     |
| 4     | A value printed from a reference read as the system, not as the writer                                                                                                   | `PermissionTest`     |
| 5-9   | A chosen language with no template taken; one of no form taken; the record's language not chosen; every template fitting, conditions aside; two fitting, the first taken | `LanguageTest`       |
| 10    | No audit entry                                                                                                                                                           | `AuditTest`          |
| 11-12 | Anyone creating or changing a template; anyone copying, trashing or removing one                                                                                         | `GuardTest`          |
| 13-16 | A letter created by hand; a letter's file, properties, title or binding changed; a letter copied; a letter trashed or removed by anyone                                  | `GuardTest`          |
| 17    | A template not checked when it is saved                                                                                                                                  | `TemplateSafetyTest` |
| 18-21 | Another processor taken, on save and when a letter is written; a forced type taken; the main content as template taken; `all` or too many types taken                    | `TemplateSafetyTest` |
| 22    | The add-on's processor rendering outside `Letter.Generate`, for the platform's own binding and for a letter already written                                              | `TemplateSafetyTest` |
| 23-25 | A placeholder reaching a file or several fields; one naming a schema its type has not; a denied property, on save and when a letter is written                           | `TemplateSafetyTest` |
| 26-30 | Other engines' syntax taken; Velocity's directives taken; any HTML tag taken; any attribute taken; a placeholder inside a tag, a comment or a style sheet                | `TemplateSafetyTest` |
| 31    | A record's values not escaped in an HTML letter                                                                                                                          | `GenerateTest`       |

## Installing it

For the reviewer, after review. Each step changes the server; none was run here. **Nuxeo's Template
Rendering must be installed first:** LTS 2025 does not install it by default, and without it the
add-on's components, which require the platform's, do not start. It is a Marketplace package for a
registered server.

```bash
# 1. Template Rendering, from Nuxeo's Marketplace, at the server's LTS 2025 version: nuxeoctl resolves it.
nuxeoctl mp-install nuxeo-template-rendering --accept=true
# 2. The add-on's package, then the kit's (the Payers README).
nuxeoctl mp-install nuxeo-agentic-letters-0.1.0.zip --accept=true
```

On the Docker image, the server stopped, with the one-off script the
[administrator's guide](../docs/business-apps/administrator-guide.md#3-installing-in-order) shows,
naming Template Rendering first. **Check it:** the server log's last `Component Loading Status` has
nothing pending or missing, and names `org.nuxeo.agentic.letters.schema`,
`org.nuxeo.agentic.letters.processor` and `org.nuxeo.template.service.TemplateProcessorComponent`;
`GET /nuxeo/api/v1/config/types/LetterTemplate` answers the type. Then, as an administrator, keep
the templates, as the Payers seed writes its six. A button needs the deployment's allow-list for its
chain in `nxserver/config/` (the Payers README). To remove it: uninstall the kit, then the add-on;
the letters and templates stay in the repository, of types the server no longer knows.

## For the security review

What the review must check. The add-on's own tests hold each point below; they are not the review,
which is deferred until the app is finished, as every security review is
([security-reviews.md](../docs/business-apps/security-reviews.md)).

- **That nothing in a template runs.** The processor is the add-on's: check that it has no
  expression, no directive and no lookup, that every letter template is held to it on save and at
  writing (`tmpl:templateType`), and that the platform has no other way to render a letter template
  through another processor: forced types, the main content as template, and renditions are
  refused on save, and `TemplateProcessor.Render`, which binds any document to a template its
  caller may read, reaches the add-on's processor, which refuses outside `Letter.Generate`.
- **What a template reaches.** The record, a document one hop away through a property holding an
  id, read as the writer, and three letter values. Check the grammar, the type checks on save (a
  value or a list of values, never a file or several fields), the reads at writing, and the denied
  properties: a template is an administrator's, and the writer may read whatever it prints anyway.
  Field-level protection is decision I, not taken.
- **What a letter holds.** Values escaped in HTML; the HTML allow-list, no placeholder in markup or
  style; a text letter as text. Check how the server serves an HTML file on download, and whether a
  deployment should ask for PDF, the template's output format, instead.
- **Who writes a letter.** `Write` on the record, as the writer, before any template is read; the
  letter created as the writer beside the record, so the folder's permission applies; the template
  read as the writer. Nuxeo's Automation endpoint reaches the operation for anyone: check that the
  button's narrowing, app, group, type and state, which the allow-list holds, is not relied on as a
  control, and that the operation's checks are.
- **Who keeps templates.** Administrators, by the guard: check against each server's own practice,
  and whether a group of letter administrators is wanted.
- **What is kept.** A letter is changed by no one and removed by administrators: check that a
  deployment's retention and the platform's template deletion guard agree with it.
- **The platform's own processors.** Template Rendering's FreeMarker, XDocReport and JXLS processors
  stay on the server, for its own templates, and are the platform's: who may create a
  `TemplateSource` on a server with Template Rendering is the platform's question, and the review
  should name it.

## Not done, and not checked

- **On a server:** nothing. That `nuxeo-template-rendering` 2025.x registers the components and
  names this add-on requires, and dispatches to its processor, is read from its source and held to
  11.5.154's jar, not run on 2025.
- **PDF letters:** a template's output format is the platform's conversion, which needs the
  server's converters; not tested here.
- **Word and OpenDocument templates:** refused. A processor of the add-on's own for them, filling
  the same placeholders in the document's XML and running nothing, is the next step if a kit needs
  them.
- **Sending a letter:** it is filed, not mailed or printed.
- **The app's own screen for templates:** none; administrators keep them through the REST API, Web
  UI or a seed.
