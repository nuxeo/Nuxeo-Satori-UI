/**
 * The appeals' checklist, as the kit's Case page lists it (`layouts/Case/view.layout.json`, its
 * `checklist` card), and the seeded appeals held to it: read from that file, so that the seed, its
 * controls and the appeals demo follow what the package gives a server, not a copy of it.
 *
 * The layout says what an appeal requires; `data.mjs` says how far each seeded appeal has got. So
 * `appealProblems` refuses data the page would show wrongly or not at all: an appeal not against a
 * denied claim, an entry for an item the card does not list, one listed twice, a done item with no
 * one of `USERS` or no day, a not-done one that still names someone or a day, and a checklist on a
 * case that is not an appeal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * `{ card, field, items: [{ id, labelKey }] }`, the Case page's checklist card as written. Throws
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
    visibleWhen: card.visibleWhen ?? null,
    items: (card.checklist.items ?? []).map((item) => ({
      id: item.id,
      labelKey: item.labelKey ?? null,
      label: item.label ?? null,
    })),
  };
}

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
      if (typeof entry.done !== 'boolean') problems.push(`${what} is neither done nor not done`);
      else if (entry.done) {
        if (!people.has(entry.doneBy))
          problems.push(`${what} is done by ${entry.doneBy}, who is not one of the demo's people`);
        if (!isDay(entry.doneOn))
          problems.push(`${what} is done on ${entry.doneOn}, which is not a day`);
      } else if (entry.doneBy !== null || entry.doneOn !== null)
        problems.push(`${what} is not done, and still names someone or a day`);
    }
  }
  return problems;
}
