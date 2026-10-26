---
title: Nuxeo Agentic UI — the short version
parent: Product
order: 0
last_reviewed: 2026-10-09
repo_commit: 97c6794
audience: presales, customers, partners
---

# Nuxeo Agentic UI — the short version

For presales engineers, customers and partners. It takes about five minutes, describes the
product as it is today (checked on 7 October 2026; the permission-level item under "What it does
not do today" was re-checked on 9 October), and leaves the longer documents to the end.

## What it is

Nuxeo Agentic UI is a modern web interface for a Nuxeo content repository. It runs in the
browser, talks to your Nuxeo server, and is delivered as a Nuxeo Marketplace package. It is in
Beta, so things can still change.

You will also see it called **Nuxeo Satori**. That is the programme name, and it is the title the
Marketplace listing shows today; the package itself is `nuxeo-agentic-ui`. It is not called
"Agentic AI". "Agentic" describes how it is built and customised — by AI coding agents following
written rules — not the AI features inside it, which are optional.

## What it does

The everyday work of a Nuxeo user:

- browse folders, search (full text, filters, saved searches) and open a document to preview it;
- create, upload, edit, move, copy and delete documents, and restore them from the trash;
- versions, permissions, history, comments, tags, collections, favorites and publishing;
- see and act on your workflow tasks;
- manage users, groups and vocabularies;
- in seven languages: English, French, German, Japanese, Dutch, Thai and Simplified Chinese.

Some features need server components this package does not include. The AI features
(natural-language search, summaries, tag suggestions, chat) need a separate Nuxeo package,
Knowledge Discovery needs its own backend, and the annotation viewer needs ARender. Without them
those features do not work, and the rest of the application does.

## The four "layers", in plain words

The longer documents sort every change into four numbered layers:

| Layer | In plain words                                                                                                  | Code?                  | Rebuild the app?    |
| ----- | --------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------- |
| 0     | **Settings**: product name, colours, language, on-screen wording                                                | No                     | No                  |
| 1     | **Arrangement**: which menu entries, buttons, tabs and columns appear, in what order, under what name, for whom | No                     | No                  |
| 2     | **Your own code**: new screens, new actions, your own conditions                                                | Yes, written by you    | Yes, your own build |
| 3     | **Help for AI coding agents**: instructions, code generators and checks that make layer 2 quicker to write      | Ships with the package | —                   |

On this page, layers 0 and 1 are "configuration" and layers 2 and 3 are "code".

## Where configuration lives today

Configuration has two parts:

1. **The settings** (bootstrap): the name, logo, colours and default language.
2. **The manifest**, which holds the wording and the whole arrangement.

You ship both in **your own Marketplace package that depends on ours**. It
contributes configuration fragments, and the server serves them after our defaults, in dependency
order. Nothing is edited on the server and nothing is stored in the Nuxeo content repository. The
application reads both at startup, before sign-in, so they are the same for every user (except on a
demo server whose package turns on presales presets, where a preset applies per browser) and must
hold nothing secret. Users see a change the next time they open the application. An edited
`bootstrap.json` beside the bundle and the old manifest Note are not read, and nothing converts
them.

Creating and building such a package needs only Node.js 20: no `npm ci`, no GitHub token, none of
this repository's dependencies. In a clone of this repository:

```bash
node tools/satori-generators/src/config-package/create.mjs acme-config --owner=acme
node config-packages/acme-config/build.mjs     # checks the fragments, writes the zip
nuxeoctl mp-install config-packages/acme-config/dist/acme-config-1.0.0.zip   # on the Nuxeo server, then restart
```

What it writes is plain JSON, XML and a build script with no dependencies, so it can live in your
own repository. `config-packages/presales-demo` is a finished example that builds the same way,
with `node config-packages/presales-demo/build.mjs`; copying it instead also needs only Node, but
means renaming it in `package.xml`, `MANIFEST.MF` and the component XML (and that file's name), and
removing its presets.
With this repository fully installed (which does need the token), the `config-package` Nx generator
in [the guide for extenders](../../libs/platform/AGENTS.md#2-start-with-a-generator) writes the same
files.

## What you can change without code

| You want to…                                                                                                                   | Where                                                            | Details                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Change the product name and the browser-tab title                                                                              | settings fragment, `branding`                                    | [Runbook, beat 3](../../docs/beta-demo-runbook.md#beat-3--rebrand-no-rebuild-3-min)                                                    |
| Change the colours, or add your own colour theme and make it the default                                                       | settings fragment, `themes`, `defaultThemeId`                    | [Runbook, beat 3](../../docs/beta-demo-runbook.md#beat-3--rebrand-no-rebuild-3-min)                                                    |
| Put your logo in the header and on the sign-in page                                                                            | settings fragment, `branding.logo`                               | [Runbook, beat 3](../../docs/beta-demo-runbook.md#beat-3--rebrand-no-rebuild-3-min)                                                    |
| Choose the default language                                                                                                    | settings fragment, `defaultLanguage`                             | [Our default settings](../../nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json)                          |
| Change on-screen wording — the same text in every language                                                                     | manifest fragment, `labels`                                      | [Runbook, beat 4](../../docs/beta-demo-runbook.md#beat-4--relabel-the-product-2-min)                                                   |
| Hide, reorder or rename a menu entry, toolbar button, tab, list column or bulk action                                          | manifest fragment, `extensions.overrides`                        | [Extension reference, overrides](../../docs/extension-reference.md#per-id-overrides)                                                   |
| Add a menu entry that opens an existing page                                                                                   | manifest fragment, `extensions.slots`                            | [Runbook, beat 5](../../docs/beta-demo-runbook.md#beat-5--nav-hide-one-add-one-and-the-security-question-4-min)                        |
| Show an entry only when a condition holds: the user can edit the document, is an administrator, has several documents selected | manifest fragment, a `rule` on the entry                         | [Extension reference, rules](../../docs/extension-reference.md#4-rules--the-registered-predicates)                                     |
| Choose which list columns are offered, and which start switched on                                                             | manifest fragment, `extensions.slots`                            | [Runbook, beat 6](../../docs/beta-demo-runbook.md#beat-6--columns-3-min)                                                               |
| Show a tab or toolbar action only on some document types, or only on documents with a facet                                    | manifest fragment, `app.rules.isType` or `app.rules.hasFacet`    | [Extension reference, document rules](../../docs/extension-reference.md#document-rules)                                                |
| Choose which of a document type's own fields the Properties panel shows, in which order (read-only)                            | a layout file in the package, named by a `<layout>` contribution | [Extension reference, per-type layouts](../../docs/extension-reference.md#9b-per-type-layouts--which-properties-a-document-type-shows) |
| Keep several demo configurations on one server and switch between them per browser                                             | settings fragment, `presales`                                    | [Extension reference, presales presets](../../docs/extension-reference.md#presales-presets)                                            |

The conditions are a fixed list that ships with the product; adding your own is code. Every name
that configuration can address is listed in the
[extension reference](../../docs/extension-reference.md).

For example, this manifest fragment hides Trash, renames Collections to "Repository", and
shows Administration to administrators only:

```json
{
  "version": 1,
  "extensions": {
    "overrides": {
      "app.navbar.trash": { "visible": false },
      "app.navbar.collections": { "label": "Repository" },
      "app.navbar.administration": { "rule": "app.rules.isAdministrator" }
    }
  }
}
```

## Two things configuration deliberately does not do

- **Change what a shipped button does.** You can rename, move or hide a shipped button but not
  make it do something else, because otherwise a button reading "Add to favorites" could delete
  the document and Nuxeo would allow it, since the user really has that permission. Changing
  behaviour is code, where the change is reviewed and versioned.
- **Restrict what people can do.** Hiding a button changes what the screen offers, not what the
  server allows. Nuxeo checks permissions on every operation, so restrict access with Nuxeo
  permissions.

## What it does not do today

- **Change every mark.** The settings fragment's `branding.logo` replaces the header word mark
  and the sign-in page logo. The small mark at the
  top of the navigation rail and the "Content Innovation Cloud" title shown when the rail is
  expanded belong to the Satori design system and stay, and so does the browser-tab icon.
- **Edit the fields of your own document types.** The Properties panel shows a type's own fields,
  generated from its schemas or arranged by a layout file in your package
  ([extension reference, per-type layouts](../../docs/extension-reference.md#9b-per-type-layouts--which-properties-a-document-type-shows)),
  but read-only. The edit form is the same standard fields for every type.
- **Install from a public registry.** The Marketplace package has only been published to Nuxeo's
  pre-production Marketplace. The developer package your own code builds against,
  `@nuxeo/satori-platform`, is not on any npm registry yet.
- **Run your own code inside the shipped application.** See the next section.
- **Edit every permission level on the rail's Browse page.** That page is still the adf-hx proof
  of concept, and its Permissions tab handles only Nuxeo's Read, ReadWrite and Everything. On a
  folder that also carries any other permission it refuses to save rather than delete that entry.
  The Permissions tab on a document's own page, and on `/browse`, offers all of Nuxeo's standard
  permissions and the others the server reports
  ([extension reference, section 13](../../docs/extension-reference.md#13-what-beta-does-not-yet-address)).

## What needs code

- a new screen or panel, or what a tab shows;
- a button or bulk action that does something new (configuration can place a button only for an
  action that code has registered);
- your own conditions, such as "the user is in the legal team";
- changing what a shipped button does;
- screens specific to your document types, and a form that edits their own fields.

Today a developer writes an Angular library against `@nuxeo/satori-platform`, starting from the
code generators that ship with it, and adds it to an application built from our template app,
`apps/nuxeo-satori-template`. That code does not plug into the shipped application, and because
the package is not published yet, you build it from this repository. Publishing it is planned.

## How to start

1. **Run it.** On your own machine, against Nuxeo in Docker: follow
   [Developer Getting Started](../30-engineering/01-getting-started.md). You need Docker,
   Node.js 20, and a GitHub token that can read Hyland's and Alfresco's GitHub Packages.
2. **Change something without code.** Locally, put the example above in a file and run
   `npm run config:dev -- --manifest <file>` before `nx serve`
   ([Part 0.6 of the runbook](../../docs/beta-demo-runbook.md#06-write-the-dev-configuration)).
   On a server, contribute the same JSON as a fragment from your own package, created and built
   with Node alone as [above](#where-configuration-lives-today). Beats 3 to 7 of the
   [demo runbook](../../docs/beta-demo-runbook.md#part-4--the-demo-script) give the exact JSON
   for each change and what you should see.
3. **Customise it with an AI coding agent.** Use the
   [Nuxeo Agentic UI prompt library](https://github.com/nuxeo-sandbox/nuxeo-agentic-ui-prompts),
   started by Nuxeo presales. Its rule is that the agent reads our source but never changes it,
   and writes everything into your own Marketplace package that depends on `nuxeo-agentic-ui`.
   Its branding prompt was written before configuration moved into packages and copies a
   settings file onto the server, which is no longer read; put the same JSON in your package's
   `bootstrap.json` fragment instead.
   Prompts are collected there rather than in this repository.

## Read more

| If you want to…                                        | Read                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| See every feature and its status                       | [Feature Catalog](02-feature-catalog.md)                                                                              |
| Know every name configuration can address              | [Extension reference](../../docs/extension-reference.md)                                                              |
| Walk through each no-code change, and what not to demo | [Beta demo runbook](../../docs/beta-demo-runbook.md), written for presenters                                          |
| Understand the product case and the layers in depth    | [Product Overview](01-product-overview.md)                                                                            |
| Install and troubleshoot the Marketplace package       | [Deployment & Troubleshooting](../30-engineering/13-deployment-and-troubleshooting.md)                                |
| Write your own code against the package                | [Platform package README](../../libs/platform/README.md) and [its guide for extenders](../../libs/platform/AGENTS.md) |
| Know where the programme stands                        | [Programme status](../../docs/adf-hx-beta-plan.md#programme-status) in the Beta plan                                  |
| Customise it with an AI coding agent                   | [Prompt library](https://github.com/nuxeo-sandbox/nuxeo-agentic-ui-prompts)                                           |
