/**
 * What the acceptance tests' steps files share (docs/business-apps/acceptance-tests.md): the
 * participant's package, named by the environment and held apart from the reference kit; what the
 * dev server serves, held to that package's own files; the checkout, held to that package alone;
 * the package's bundle, held to data; and the record page and the queue as the app draws them.
 *
 * The acceptance steps files judge a participant's package, never a kit's, so they name the
 * reference kits only by their seed data, by one path each, and never as a kit's folder: the
 * release candidate's listing of kit demos (`scripts/release-candidate-demo.mjs`) reads a folder
 * named that way as a kit's demo, and a server run of a candidate has no participant's package to
 * give them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { codeIn } from '../payers-claims-demo/bundle-data.mjs';

/**
 * The handlers of every wait, click and read whose failure a check after it reports, so that the
 * failure is deferred to the check, not lost. A read that fails gives `null`, which every check or
 * precondition that reads it refuses, with what it found.
 */
export const deferred = () => undefined;
export const unread = () => null;

/**
 * Not the participant's: `/nuxeo/logout` is 404 under the dev proxy, which the app's sign-in calls
 * to drop a stale cookie session; `AI.*` operations come from a marketplace package this server may
 * lack; and the shell's recently-viewed list asks for a thumbnail of every document in it, which a
 * record with no file does not have, so Nuxeo answers 404.
 */
export const ENVIRONMENTAL_ERRORS = [
  '/nuxeo/logout',
  /automation\/AI\./,
  /\/@rendition\/thumbnail$/,
];

/** A JSON value with its object keys sorted, so two parses compare as text. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** A file's JSON, without its `$schema`, which only says where an editor finds the schema. */
export function withoutSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema'));
}

/** A JSON file, or `null` when it is missing or not JSON. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Missing or unreadable: the caller's check or precondition says what it expected.
    return null;
  }
}

/**
 * A served file as the app reads it. A layout comes in the servlet's envelope, as `config:dev`
 * writes it too: its `content`, and the `source` it was read from. The home, the menu, the queues
 * and the labels come as the package writes them, with no envelope.
 */
export function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

/** Whole years from `birth` (YYYY-MM-DD) to today, in this machine's time zone, as the browser's. */
export function ageToday(birth) {
  const [year, month, day] = birth.split('-').map(Number);
  const today = new Date();
  const before =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  return today.getFullYear() - year - (before ? 1 : 0);
}

/** Whole days from a stored day (YYYY-MM-DD) to this machine's today, as the browser counts them. */
export function daysSince(stored) {
  const [year, month, day] = String(stored).slice(0, 10).split('-').map(Number);
  const now = new Date();
  return Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(year, month - 1, day)) /
      86_400_000,
  );
}

/** Whether `path` is `directory` or inside it. */
function within(directory, path) {
  const rel = relative(directory, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The participant's package, from `ACCEPTANCE_PACKAGE`, a folder from the repository's root or an
 * absolute one: `{ dir, config, shown }`, or `{ problem }` saying why it cannot be judged. The
 * reference kit is refused by its real path, so that a run on the reference answer, under any
 * spelling, cannot read as the participant's pass.
 */
export function participantPackage(repo, reference) {
  const given = process.env['ACCEPTANCE_PACKAGE'] ?? '';
  if (given === '')
    return {
      problem:
        "ACCEPTANCE_PACKAGE is not set: export it as the participant's package folder, such as " +
        'business-apps/packages/<the package they wrote>',
    };
  const dir = resolve(repo, given);
  const config = join(dir, 'bundle', 'agentic-ui-config');
  if (!existsSync(config) || !statSync(config).isDirectory())
    return { problem: `${given} has no bundle/agentic-ui-config/: is it a package folder?` };
  const real = realpathSync(dir);
  if (existsSync(reference) && realpathSync(reference) === real)
    return {
      problem: `${given} is the reference kit, not a participant's package: name the package they wrote`,
    };
  return { dir: real, config: join(real, 'bundle', 'agentic-ui-config'), shown: given };
}

/**
 * The commit the session started from, from `ACCEPTANCE_BASE`, checked to be one this clone has:
 * `{ commit }`, or `{ problem }`.
 */
export function sessionBase(repo) {
  const given = process.env['ACCEPTANCE_BASE'] ?? '';
  if (given === '')
    return {
      problem:
        'ACCEPTANCE_BASE is not set: export it as the commit the session started from, which the ' +
        "facilitator's log records",
    };
  const answer = spawnSync(
    'git',
    ['-C', repo, 'rev-parse', '--verify', '--quiet', `${given}^{commit}`],
    {
      encoding: 'utf8',
    },
  );
  const commit = answer.status === 0 ? answer.stdout.trim() : '';
  return commit === ''
    ? { problem: `ACCEPTANCE_BASE ${given} is not a commit this clone has` }
    : { commit };
}

/**
 * Every path of the checkout that differs from `base` and lies outside the package `dir`: tracked
 * files changed, staged, deleted or committed since `base`, and files git does not ignore and does
 * not track. `null` when git does not answer. What git ignores, such as the dev server's
 * `apps/nuxeo-ui/public/agentic-ui-config/` and the checkout's `tmp/`, is not counted.
 */
export function changedOutside(repo, dir, base) {
  const git = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const changed = git(['diff', '--name-only', '-z', base, '--']);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  if (changed.status !== 0 || untracked.status !== 0) return null;
  // Both sides by their real paths: git names paths from the checkout's root, and the package was
  // resolved through any link on the way, as a temporary folder on macOS is.
  const root = realpathSync(repo);
  const own = existsSync(dir) ? realpathSync(dir) : dir;
  return [...changed.stdout.split('\0'), ...untracked.stdout.split('\0')]
    .filter((path) => path !== '')
    .filter((path) => !within(own, resolve(root, path)))
    .sort();
}

/** The package's bundle as data only, by the Payers demo's rule, with no route model's zip. */
export function codeInPackage(dir) {
  const bundle = join(dir, 'bundle');
  return existsSync(bundle) ? codeIn(bundle, null, dir) : ['bundle/ (missing)'];
}

/**
 * Each of `paths`, under `agentic-ui-config/`, that the dev server does not serve as the package's
 * own file: absent, other content, or, for a layout, read from somewhere else.
 */
export async function notServedFromPackage(page, baseUrl, repo, config, paths) {
  const differing = [];
  for (const path of paths) {
    const answer = await page.request.get(`${baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const { content, source } = unwrap(answer?.ok() ? await answer.json().catch(unread) : null);
    const own = readJson(join(config, path));
    // config:dev records each layout's path relative to the repository's root.
    const fromPackage = source === null || resolve(repo, source) === join(config, path);
    if (own === null || !sameJson(content, own) || !fromPackage)
      differing.push(
        `${path} (${answer?.status() ?? 'no answer'}${source ? `, from ${source}` : ''}${own === null ? ', and the package has no such file' : ''})`,
      );
  }
  return differing;
}

/**
 * The record page as drawn: its type, banners, picture, and each card's id, heading, fields, rows,
 * timeline and checklist. Values are each field's text as a person reads it.
 */
export function readRecordPage(page) {
  return page.evaluate(() => {
    const text = (element) => (element?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const preview = document.querySelector('.record-page__preview');
    const banners = document.querySelector('.record-page__banners');
    const firstCard = document.querySelector('.record-page__card[data-card-id]');
    const follows = (a, b) =>
      Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      type: document.querySelector('.record-page')?.getAttribute('data-record-type') ?? null,
      banners: [...document.querySelectorAll('.record-page__banner')].map((banner) => ({
        id: banner.getAttribute('data-banner-id'),
        tone: banner.querySelector('.nxs-banner')?.getAttribute('data-tone') ?? null,
        text: banner.querySelector('.nxs-banner__message')?.textContent?.trim() ?? null,
      })),
      picture: {
        shown: preview !== null,
        review: preview?.querySelector('lib-record-picture-review') != null,
        view: document.querySelector('.record-picture__figure')?.getAttribute('data-view') ?? null,
        src: document.querySelector('.record-picture__image')?.getAttribute('src') ?? null,
        first: follows(preview, firstCard),
        underBanners: banners === null ? preview !== null : follows(banners, preview),
      },
      cards: [...document.querySelectorAll('.record-page__card[data-card-id]')].map((card) => ({
        id: card.getAttribute('data-card-id'),
        heading: card.querySelector('.record-page__heading')?.textContent?.trim() ?? null,
        fields: [...card.querySelectorAll('.record-page__field[data-field]')].map((field) => ({
          key: field.getAttribute('data-field'),
          label: field.querySelector('dt')?.textContent?.trim() ?? '',
          value: text(field.querySelector('dd')),
          badge: field.querySelector('.record-page__badge') !== null,
          chips: [...field.querySelectorAll('.record-page__chip')].map(
            (chip) => chip.textContent?.trim() ?? '',
          ),
          links: [...field.querySelectorAll('dd a')].map((link) => ({
            text: link.textContent?.trim() ?? '',
            href: link.getAttribute('href') ?? '',
          })),
        })),
        related: card.querySelector('lib-record-list') !== null,
        rows: [...card.querySelectorAll('tbody tr')].map((row) => text(row)),
        timeline: card.querySelector('lib-record-timeline') !== null,
        checklist: [...card.querySelectorAll('.record-page__checklist-item')].map((row) => ({
          item: row.getAttribute('data-item'),
          done: row.getAttribute('data-done'),
          by: row.querySelector('.record-page__checklist-by')?.textContent?.trim() ?? null,
          on: row.querySelector('.record-page__checklist-on')?.textContent?.trim() ?? null,
        })),
      })),
    };
  });
}

/**
 * The record page has drawn the cards named, each related list its rows or its empty state, each
 * link its record's title rather than the stored id, and each checklist its people's names.
 */
export async function recordSettled(page, cards) {
  await page
    .waitForFunction(
      (ids) =>
        ids.length > 0 &&
        ids.every((id) => document.querySelector(`.record-page__card[data-card-id="${id}"]`)) &&
        [...document.querySelectorAll('.record-page__card lib-record-list')].every(
          (list) => list.querySelector('tbody tr, nxs-empty-state, nxs-error-state') !== null,
        ) &&
        // A stored id is 36 characters of hexadecimal and dashes; a title is not.
        [...document.querySelectorAll('.record-page__field dd')].every(
          (value) => !/^[0-9a-f-]{36}$/.test((value.textContent ?? '').trim()),
        ) &&
        // The checklist's names are read with the page's users, and show the stored user name
        // until then: every demo user name has a dot, and no full name does.
        [...document.querySelectorAll('.record-page__checklist-by')].every(
          (by) => !/\./.test(by.textContent ?? ''),
        ),
      cards,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/** Every field of the page, flattened, each with its card's id. */
export const fieldsOf = (record) =>
  (record?.cards ?? []).flatMap((card) =>
    card.fields.map((field) => ({ ...field, card: card.id })),
  );

/** The cards of the page that hold a related list, with their rows. */
export const listsOf = (record) => (record?.cards ?? []).filter((card) => card.related);

/** The ids of a layout's cards that show for everyone: those with no `visibleWhen`. */
export const alwaysShown = (layout) =>
  (layout?.cards ?? []).filter((card) => card.visibleWhen === undefined).map((card) => card.id);

/**
 * What differs between the page drawn and the layout file it should be drawn from, or `null`: every
 * card that shows for everyone drawn; every card drawn one of the file's, in the file's order; and
 * each headed with its literal label or its key's text in the package's labels. A card with a rule
 * may be left out, since its rule decides.
 */
export function differsFromFile(record, layout, labels) {
  const wanted = headingsOf(layout, labels);
  const order = wanted.map((card) => card.id);
  const drawn = (record?.cards ?? []).map((card) => ({ id: card.id, heading: card.heading }));
  const problems = [];
  if (wanted.length === 0) problems.push('the file has no card');
  for (const id of alwaysShown(layout))
    if (!drawn.some((card) => card.id === id)) problems.push(`card ${id} is not drawn`);
  let last = -1;
  for (const card of drawn) {
    const at = order.indexOf(card.id);
    if (at < 0) {
      problems.push(`card ${card.id} is not the file's`);
      continue;
    }
    if (at < last) problems.push(`card ${card.id} is out of the file's order`);
    last = Math.max(last, at);
    const heading = wanted[at].heading;
    if (!heading) problems.push(`card ${card.id} has no heading in the package`);
    else if (card.heading !== heading)
      problems.push(
        `card ${card.id} is headed ${JSON.stringify(card.heading)}, not ${JSON.stringify(heading)}`,
      );
  }
  return problems.length === 0 ? null : problems.join('; ');
}

/** The heading every card of a layout file should show: its literal label, or its key's text. */
export function headingsOf(layout, labels) {
  return (layout?.cards ?? []).map((card) => ({
    id: card.id,
    heading: card.label ?? (card.labelKey ? (labels?.[card.labelKey] ?? null) : null),
  }));
}

/**
 * A queue of the package, opened and narrowed by its first facet, each judged against the server's
 * own answers, which the page's requests receive: the rows drawn are as many as the server
 * returned, the facet's buckets are the server's aggregate, and choosing a bucket sends it to the
 * page provider, whose answer the queue then draws. Records its checks on `h`.
 */
export async function checkQueueNarrows(page, h, { id, queue, labels }) {
  const pageProvider = queue?.pageProvider;
  const aggregate = queue?.facets?.[0]?.aggregate;
  h.requirePrecondition(
    `the queue ${id} names a page provider and has a facet`,
    typeof pageProvider === 'string' && typeof aggregate === 'string',
    `queues/${id}.json names ${JSON.stringify(pageProvider)} and its first facet ` +
      `${JSON.stringify(aggregate)}: the target asks for a facet`,
  );
  const executes = (response, chosen) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith(`/search/pp/${pageProvider}/execute`) &&
      (chosen === undefined
        ? !url.searchParams.has(aggregate)
        : url.searchParams.get(aggregate) === JSON.stringify([chosen]))
    );
  };
  const firstAnswer = page
    .waitForResponse((response) => executes(response), { timeout: 30_000 })
    .catch(unread);
  await h.goTo(`/#/queues/${id}`);
  const first = await firstAnswer;
  const firstBody = first?.ok() ? await first.json().catch(unread) : null;
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('.queue-page tbody tr').length > 0 ||
        document.querySelector('.queue-page nxs-empty-state, .queue-page nxs-error-state') !== null,
      undefined,
      { timeout: 30_000 },
    )
    .catch(deferred);
  const rowCount = () =>
    page.evaluate(() => document.querySelectorAll('.queue-page tbody tr').length).catch(unread);
  const title = (await page.locator('.queue-page__title').textContent().catch(unread))?.trim();
  const wanted = queue.label ?? labels?.[queue.labelKey] ?? null;
  h.check(
    `the queue opens at #/queues/${id}, under its name from the package: ${wanted}`,
    wanted !== null && title === wanted,
    `drawn ${JSON.stringify(title)}`,
  );
  const served = firstBody?.entries ?? null;
  const drawn = await rowCount();
  h.check(
    "the queue draws the server's answer: as many rows as the page provider returned, at least one",
    Array.isArray(served) && served.length > 0 && drawn === served.length,
    `drawn ${drawn} rows, the server returned ${served?.length ?? 'nothing'}`,
  );
  const readFacet = () =>
    page
      .evaluate(
        (selector) =>
          Object.fromEntries(
            [...document.querySelectorAll(selector)].map((bucket) => {
              const match = /^\s*(.+?)\s*\((\d+)\)\s*$/.exec(bucket.textContent ?? '');
              return match ? [match[1], Number(match[2])] : [bucket.textContent?.trim(), null];
            }),
          ),
        `fieldset.queue-facet[data-aggregate="${aggregate}"] .queue-facet__bucket`,
      )
      .catch(unread);
  const raw = firstBody?.aggregations?.[aggregate];
  const listed = Array.isArray(raw?.extendedBuckets) ? raw.extendedBuckets : (raw?.buckets ?? []);
  const fromServer = canonical(
    Object.fromEntries(
      listed.map((bucket) => [String(bucket.key), bucket.docCount ?? bucket.doc_count ?? null]),
    ),
  );
  const facet = await readFacet();
  h.check(
    `the facet ${aggregate} shows the server's buckets, each with its count`,
    Object.keys(fromServer).length > 0 && sameJson(facet, fromServer),
    `drawn ${JSON.stringify(facet)}, the server's ${JSON.stringify(fromServer)}`,
  );
  const total = firstBody?.resultsCount ?? firstBody?.totalSize ?? null;
  const chosen = Object.keys(fromServer).find(
    (key) => fromServer[key] > 0 && typeof total === 'number' && fromServer[key] < total,
  );
  h.requirePrecondition(
    `the facet has a bucket that holds some of the queue's ${total} records and not all`,
    chosen !== undefined,
    `the buckets are ${JSON.stringify(fromServer)}: seed the server again, or choose a queue whose ` +
      'records differ in the facet',
  );
  const narrowedAnswer = page
    .waitForResponse((response) => executes(response, chosen), { timeout: 15_000 })
    .catch(unread);
  await page
    .locator(`fieldset.queue-facet[data-aggregate="${aggregate}"] .queue-facet__bucket`, {
      hasText: new RegExp(`^\\s*${chosen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`),
    })
    .locator('input')
    .click()
    .catch(deferred);
  const narrowed = await narrowedAnswer;
  const narrowedBody = narrowed?.ok() ? await narrowed.json().catch(unread) : null;
  const narrowedTotal = narrowedBody?.resultsCount ?? narrowedBody?.totalSize ?? null;
  h.check(
    `choosing "${chosen}" sends ${aggregate}=["${chosen}"] to the page provider, which counts ${fromServer[chosen]}`,
    narrowedBody !== null && narrowedTotal === fromServer[chosen],
    `the server answered ${narrowed?.status() ?? 'nothing'}, counting ${narrowedTotal}`,
  );
  const expected = narrowedBody?.entries?.length ?? null;
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      expected,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const after = await rowCount();
  h.check(
    `the queue narrows to the server's answer for "${chosen}": ${expected} rows, of ${narrowedTotal} records where there were ${total}`,
    typeof expected === 'number' && after === expected && narrowedTotal < total,
    `drawn ${after} rows`,
  );
}

/** The session `AuthService` keeps, which the app's interceptor reads: helpers.mjs's key. */
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/**
 * The browser signed in as `username`, declared to the identity guard first, as the Payers demo's
 * step 4 does it (`payers-claims-demo.mjs`). The outgoing user's cookie is dropped first: a
 * JSESSIONID Nuxeo has answered on beats a Basic header. Until the reload, the app still holds the
 * outgoing session in memory, so every request a frame sends to Nuxeo is given the new header, and
 * the route is removed as soon as the reload commits: from then on the header is the app's own,
 * from the session it restored. `page.request`, the run's own channel, keeps the run's user.
 */
export async function switchBrowserTo(page, h, { username, password, reason }) {
  await h.signedInAs(username, reason);
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  await page.route('**/nuxeo/**', (route) => {
    let fromFrame = false;
    try {
      fromFrame = Boolean(route.request().frame());
    } catch {
      // A service worker's request has no frame, and keeps its own header.
      fromFrame = false;
    }
    return fromFrame
      ? route.continue({
          headers: { ...route.request().headers(), authorization: `Basic ${basic}` },
        })
      : route.continue();
  });
  await page.context().clearCookies();
  await page.evaluate(
    ({ key, value, outKey }) => {
      localStorage.removeItem(key);
      sessionStorage.setItem(key, value);
      sessionStorage.removeItem(outKey);
    },
    {
      key: SESSION_KEY,
      outKey: SIGNED_OUT_KEY,
      value: JSON.stringify({ kind: 'basic', username, basic, isAdministrator: false, groups: [] }),
    },
  );
  await page.reload({ waitUntil: 'commit', timeout: 120_000 });
  await page.unroute('**/nuxeo/**');
  await page.waitForLoadState('load', { timeout: 120_000 });
}

/** Who a pair of credentials signs in as on the server, and their groups, asked from Node. */
export async function whoIs(baseUrl, username, password) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo/api/v1/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { id: null, groups: [], status: response.status };
    const me = await response.json();
    return {
      id: me?.id ?? null,
      groups: (me?.extendedGroups ?? []).map((group) => group.name),
      status: response.status,
    };
  } catch (error) {
    return { id: null, groups: [], status: String(error?.message ?? error) };
  }
}

/**
 * Every live document an NXQL query finds in the repository, as `username`, with `schema`'s
 * properties, from Node: `Repository.Query`, not the search endpoint, whose index can still hold a
 * trashed document. `null` when it is refused, or holds more than one page.
 */
export async function repositoryQuery(baseUrl, { username, password }, query, schema) {
  try {
    const response = await fetch(`${baseUrl}/nuxeo/api/v1/automation/Repository.Query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        properties: schema,
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({ params: { query, pageSize: 1000 } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const answer = await response.json();
    return answer?.isNextPageAvailable === true ? null : (answer?.entries ?? null);
  } catch {
    // Refused or unanswered: the caller says it could not judge, and the precondition fails.
    return null;
  }
}

/** The queue `ACCEPTANCE_QUEUE` names, or the package's one queue: `{ id }` or `{ problem }`. */
export function participantQueue(config) {
  const named = process.env['ACCEPTANCE_QUEUE'] ?? '';
  const folder = join(config, 'queues');
  const ids = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort()
    : [];
  if (named !== '')
    return ids.includes(named)
      ? { id: named }
      : { problem: `ACCEPTANCE_QUEUE is ${named}, and the package's queues are ${ids.join(', ')}` };
  if (ids.length === 1) return { id: ids[0] };
  return {
    problem:
      ids.length === 0
        ? 'the package has no queue: the target asks for one'
        : `the package has ${ids.length} queues, ${ids.join(', ')}: export ACCEPTANCE_QUEUE as the one the target names`,
  };
}

/** The app's own menu entries, from `navigation.json`, as drawn: their nav ids. */
export function readAppMenu(page) {
  return page
    .evaluate(() =>
      [...document.querySelectorAll('a[data-nav-id^="appMenu."]')].map((a) =>
        a.getAttribute('data-nav-id'),
      ),
    )
    .catch(unread);
}
