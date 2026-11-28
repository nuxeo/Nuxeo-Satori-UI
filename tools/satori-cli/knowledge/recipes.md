# Recipes: what to do for each request

Each recipe is the tool calls to make, in order. Every write is validated as it is made; after the
last, run `npm run validate` and `npm run build` and report what they print.

## Before anything: read the server

`describe_document_type`, `list_page_providers`, `describe_page_provider`, `list_workflows`,
`list_vocabularies` and `list_operations` read the development server's model. If they refuse for
missing credentials, ask the person to run `./node_modules/.bin/satori connect` in a terminal
(in the Claude app, its terminal pane), then to reconnect the server (`/mcp` in Claude). Never ask
for the password, and never read `.claude/settings.local.json`.

## An app definition, when the package has none

A record page, a queue, a home or a menu belongs to an app, and a package with no
`bundle/agentic-ui-config/app.json` has none. Ask the person the app's name and the groups it is
for (people outside them do not see it), then one `apply_package_changes` call:

1. write `bundle/agentic-ui-config/app.json`:
   `{ "version": 2, "id": "<id>", "label": "<Name>", "packageVersion": "<the package.xml version>", "platform": ">=0.2.0 <1.0.0", "address": "<id>", "groups": ["<group>"] }`;
2. write `bundle/agentic-ui-config/labels/en.json`: `{ "version": 2, "labels": {} }`;
3. run the generator `app-registry`.

The id is the app's own: never one of an example's. Say that the groups must exist on the server,
with people in them, for anyone to see the app; a person creates them.

## A stand-in model, for a demo or a prototype

When the person asks for records of a type the server does not have (`describe_document_type`
refuses), say so, and ask whether this is a demo or a prototype on a development server. Only on
their yes:

1. `./node_modules/.bin/satori model pull --out config-packages/<name>/content-model.json`, the
   server `NUXEO_URL`'s, which they approve when Claude asks: the package then holds the server's
   model and its own. If it is refused, stop and ask: never write `content-model.json` yourself;
2. `apply_generator` `app-model` once per type: `type`, `properties` (each `name`, `name:type` or
   `name=Value|Value`; types are string, long, double, boolean, date, document, checklist and
   complex), `pageProvider` with `where`, `sort` and `aggregates` for the queues and the home.

Never write a type the server already has, and say that a real model comes from Nuxeo Studio and
replaces the stand-in whole. `properties` is one string, comma-separated, not a list.

## A record page

`apply_generator` `app-layout` with `type`, and `schemas` and `columns` if the person names them.
It writes one card per schema from the model, with the widget each property's type takes. To
change cards, fields, banners or related lists after that, write the layout file whole with
`write_package_file`, following `layout-v2.schema.json` and the examples.

## An Edit or a Create form

`apply_generator` `app-form` with `type`, `mode` (`edit` or `create`), and `required` for the
fields a person must fill.

## A queue

`apply_generator` `app-queue` with `id`, `pageProvider`, `columns`, `label`, `sort` and `pageSize`.
It writes no facets.

**Facets are a second step.** Read the queue file, then write it whole with `write_package_file`,
adding `"facets": [{ "aggregate": "<id>", "labelKey": "<key>" }]`, with each text in
`labels/en.json` in the same `apply_package_changes` call. Each aggregate is one the page
provider defines: `describe_page_provider` lists them. A stand-in model's are
`<prefix>_<name>_agg`, such as `claim_status_agg`. Never say a queue has facets until its file
has them.

## A home and a menu

`apply_package_changes`: write `home.json` and `navigation.json` whole, following their schemas
and an example's, with their texts in `labels/en.json`, then `app-registry`.

## A button

`apply_generator` `app-action`: a lifecycle `transition` the type's lifecycle has, or an
`operation` on the deployment's allow-list (a person writes the allow-list). `on` says where it
shows: `record`, `row`, `bulk`.

## Branding, and what the app shows

[branding.md](branding.md).

## Every time: check, build, version

1. `npm run validate`, then `npm run build`: report the zip's name and its sha256.
2. Before a change is installed over an earlier one: `./node_modules/.bin/satori version config-packages/<name> patch`.
   Nuxeo keeps a package it already has at the same version.
3. Say what is the person's: committing and pushing, installing the zip on the development
   server, which restarts it, and releasing.
