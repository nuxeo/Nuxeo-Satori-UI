/**
 * The appeals' checklist, as the kit's Case page lists it (`layouts/Case/view.layout.json`, its
 * `checklist` card), and the seeded appeals held to it: read from that file, so that the seed, its
 * controls and the appeals demo follow what the package gives a server, not a copy of it.
 *
 * The layout says what an appeal requires; `data.mjs` says how far each seeded appeal has got. So
 * `appealProblems` refuses data the page would show wrongly or not at all: an appeal not against a
 * denied claim, an entry for an item the card does not list, one listed twice, a done item that
 * does not say both who and when, someone not of `USERS` or a day that is not one, and a checklist
 * on a case that is not an appeal. An entry not done may still say who and when.
 *
 * `checklistOnType` answers whether a server has the checklist's property, from its answer for the
 * Case type, so the seed and the demo ask the type, not a schema named after the field's prefix.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { child, childrenNamed, parseXml } from '../workflow/xml.mjs';
import { MODEL_XML } from './lifecycle.mjs';

export const CASE_LAYOUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bundle',
  'agentic-ui-config',
  'layouts',
  'Case',
  'view.layout.json',
);

/** The Case page's checklist card: the one card whose `checklist` the file has. */
export const CHECKLIST_CARD = 'checklist';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day that exists, written `YYYY-MM-DD`: `Date` would roll 2026-02-30 into March. */
const isDay = (value) =>
  typeof value === 'string' &&
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * `{ card, field, tickable, items: [{ id, labelKey }] }`, the Case page's checklist card as written. Throws
 * when the file has no such card, or more than one: the seed and the demo hold every appeal to one
 * list.
 */
export function readAppealChecklist(text = readFileSync(CASE_LAYOUT, 'utf8')) {
  const layout = JSON.parse(text);
  const cards = (layout.cards ?? []).filter((card) => card && typeof card.checklist === 'object');
  if (cards.length !== 1)
    throw new Error(`the Case layout has ${cards.length} checklist cards, not one`);
  const [card] = cards;
  return {
    card: card.id,
    field: card.checklist.field,
    // Since 0.6.0 the Case page lets someone who may change the case tick its items.
    tickable: card.checklist.tickable === true,
    visibleWhen: card.visibleWhen ?? null,
    items: (card.checklist.items ?? []).map((item) => ({
      id: item.id,
      labelKey: item.labelKey ?? null,
      label: item.label ?? null,
    })),
  };
}

/**
 * Whether the answer of `/config/types/Case`, `type`, has the checklist's property, `field`: a
 * schema whose prefix is the field's, Nuxeo's `@prefix` or else its name, as the app reads one,
 * with the property among its fields.
 */
export function checklistOnType(type, field) {
  const [prefix, property] = String(field).split(':');
  return (Array.isArray(type?.schemas) ? type.schemas : []).some(
    (schema) =>
      ((schema?.['@prefix'] || schema?.prefix || schema?.name) ?? '') === prefix &&
      schema?.fields !== null &&
      typeof schema?.fields === 'object' &&
      Object.hasOwn(schema.fields, property),
  );
}

/** The open-appeals queue's page provider, version 0.6.0's, in the stand-in model. */
export const OPEN_APPEALS = 'payers_open_appeals';

/**
 * `{ states, sort: { field, ascending }, aggregates: [{ id, property }] }`, the open-appeals queue's
 * page provider as the stand-in model contributes it (`demo/lifecycle.mjs`'s `MODEL_XML`), read by
 * the strict XML parser the lifecycle is read with: the case states its query holds, its sort and
 * its facets' aggregates. So the seed, its controls and the appeals demo expect what the package
 * gives a server. Throws when there is no such page provider, or one more, or its query is not of
 * appeals, by their state.
 */
export function readOpenAppeals(xml = readFileSync(MODEL_XML, 'utf8')) {
  const providers = childrenNamed(parseXml(xml), 'extension')
    .filter(
      (extension) =>
        extension.attributes.target === 'org.nuxeo.ecm.platform.query.api.PageProviderService' &&
        extension.attributes.point === 'providers',
    )
    .flatMap((extension) => childrenNamed(extension, 'genericPageProvider'))
    .filter((provider) => provider.attributes.name === OPEN_APPEALS);
  if (providers.length !== 1)
    throw new Error(
      `${providers.length === 0 ? 'no' : providers.length} page provider ${OPEN_APPEALS} in the stand-in model`,
    );
  const [provider] = providers;
  const query = child(child(provider, 'whereClause'), 'fixedPart')?.text ?? '';
  const states = /case:state IN \(([^)]*)\)/.exec(query);
  if (!/case:category = 'appeal'/.test(query) || !states)
    throw new Error(`${OPEN_APPEALS} does not hold appeals by their state: ${query.trim()}`);
  const sort = child(provider, 'sort');
  return {
    states: [...states[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    sort: {
      field: sort?.attributes.column ?? null,
      ascending: sort?.attributes.ascending === 'true',
    },
    aggregates: childrenNamed(child(provider, 'aggregates'), 'aggregate').map((aggregate) => ({
      id: aggregate.attributes.id,
      property: aggregate.attributes.parameter,
    })),
  };
}

/** Whether the queue `open`, from `readOpenAppeals`, holds the case: an appeal in one of its states. */
export const isOpenAppeal = (kase, open) =>
  kase.category === 'appeal' && open.states.includes(kase.state);

/** What an appeal's checklist is, item by item in the card's order: its entry, or none. */
export function appealRows(kase, checklist) {
  return checklist.items.map((item) => {
    const entry = (kase.checklist ?? []).find((each) => each.item === item.id) ?? null;
    const done = entry?.done === true;
    return {
      id: item.id,
      done,
      doneBy: done ? entry.doneBy : null,
      doneOn: done ? entry.doneOn : null,
    };
  });
}

/**
 * Every way `data.mjs`'s cases disagree with the checklist and the claims they name, as one line
 * each; none when the seed may write them.
 */
export function appealProblems({ cases, claims, users }, checklist) {
  const problems = [];
  const listed = new Set(checklist.items.map((item) => item.id));
  const people = new Set(users.map((user) => user.username));
  for (const kase of cases) {
    const entries = kase.checklist ?? [];
    if (kase.category !== 'appeal') {
      if (entries.length > 0)
        problems.push(`${kase.number} is a ${kase.category}, and holds a checklist`);
      continue;
    }
    const claim = claims.find((each) => each.number === kase.claim);
    if (!claim) problems.push(`${kase.number} is an appeal against no claim`);
    else if (claim.status !== 'denied')
      problems.push(`${kase.number} appeals ${claim.number}, which is ${claim.status}, not denied`);
    const seen = new Set();
    for (const entry of entries) {
      const what = `${kase.number}'s entry ${JSON.stringify(entry.item)}`;
      if (!listed.has(entry.item)) {
        problems.push(`${what} is not an item the Case page's checklist lists`);
        continue;
      }
      if (seen.has(entry.item)) problems.push(`${what} is there twice`);
      seen.add(entry.item);
      // An entry not done may still say who and when, as one unticked or only asked for does:
      // the page shows neither for it, and the demo checks that it does not.
      const nobody = entry.doneBy === null || entry.doneBy === undefined;
      const noDay = entry.doneOn === null || entry.doneOn === undefined;
      if (typeof entry.done !== 'boolean') problems.push(`${what} is neither done nor not done`);
      else if (entry.done && (nobody || noDay))
        problems.push(`${what} is done, and does not say both who did it and when`);
      if (!nobody && !people.has(entry.doneBy))
        problems.push(`${what} names ${entry.doneBy}, who is not one of the demo's people`);
      if (!noDay && !isDay(entry.doneOn))
        problems.push(`${what} names ${entry.doneOn} as its day, which is not a day`);
    }
  }
  return problems;
}
