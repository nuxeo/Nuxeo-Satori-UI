#!/usr/bin/env node
/**
 * The with-and-without-Satori page has one section per `nxs-` component, and only those.
 *
 * `docs/satori-components/with-and-without-satori.md` is the source of the Confluence page that
 * shows a customer what each component looks like with and without Satori access. A component
 * added to the library barrel without a section there is a component that page silently omits,
 * and a section left behind after a component is removed describes something that no longer
 * ships. Both are easy to miss in review, because the page lives outside the repository.
 *
 * So this reads the barrel, the Satori registrations and the stories, and fails when:
 *   - a component exported from `libs/shared/satori-components/src/index.ts` has no section, or a
 *     section names a component the barrel does not export;
 *   - a Satori variant registered by `provideNxsSatoriComponents()` is not named by a section, or a
 *     section says "Satori's own component" for a component Satori does not re-register;
 *   - a section's registered ID, Storybook story or image file name disagrees with the code;
 *   - the "All components" table and the sections disagree;
 *   - the page text carries a ticket key, a pull-request reference or a branch name.
 *
 * Static, no credentials, no network: it reads files. `satori-comparison-doc.selftest.mjs` holds
 * its negative controls; `scripts/satori-comparison/` holds the capture and publish commands,
 * which read the same sections through `loadComparison`.
 *
 * Usage:  node scripts/beta-harness/satori-comparison-doc.mjs [--json]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyNameFromExport, toId } from 'storybook/internal/csf';

import { parseImageLine } from '../confluence-storage.mjs';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const DOC = 'docs/satori-components/with-and-without-satori.md';
export const BARREL = 'libs/shared/satori-components/src/index.ts';
const BASE_SRC = 'libs/shared/satori-components/src';
const SATORI_SRC = 'libs/shared/satori-components-satori/src';
const BASE_PROVIDER = `${BASE_SRC}/lib/provide-nxs-components.ts`;
const SATORI_PROVIDER = `${SATORI_SRC}/lib/provide-nxs-satori-components.ts`;
const PRIMITIVE_IDS = `${BASE_SRC}/lib/primitives.ts`;

/** The section every component lives under, and the table that summarises them. */
export const COMPONENTS_HEADING = 'Side by side';
export const SUMMARY_HEADING = 'All components';
/** Where a generator splices a new section, and a new summary row. */
export const MARKERS = {
  components: '<!-- satori:comparison:components -->',
  summary: '<!-- satori:comparison:summary -->',
};
export const OWN = "Satori's own component";
export const THEME_ONLY = 'Same component; theme only';
/** What the capture does before the screenshot. Absent means "As rendered". */
export const CAPTURE_STATES = ['As rendered', 'Opened from the keyboard'];
const REQUIRED_FIELDS = ['Component', 'Registered ID', 'With Satori', 'Storybook story'];
const OPTIONAL_FIELDS = ['Captured'];

/**
 * The images that are not one component's: the "Primitives/By registered ID" story, whole, in both
 * Storybooks. The capture produces exactly these and one `<name>-side-by-side.png` per section.
 */
export const FULL_IMAGES = {
  without: 'without-satori-full.png',
  with: 'with-satori-full.png',
  sideBySide: 'full-side-by-side.png',
};
export const FULL_STORIES = {
  without: 'primitives-by-registered-id--material-registration',
  with: 'primitives-by-registered-id--satori-registration',
};

/** Ticket keys, pull-request references and branch names. The page is for readers, not history. */
const FORBIDDEN = [
  [/\b(?:NXSAT|NCO|NXENG|WEBUI|ELEMENTS)-\d+/g, 'a ticket key'],
  [/(?:^|[\s(])#\d{1,5}(?![\da-fA-F])/g, 'a pull-request number'],
  [/\bPRs?\b|pull request|\/pull\/\d/gi, 'a pull-request reference'],
  [/\b(?:feature|fix|integration|autopilot|refactor|sync|docs)\/nx[\w.-]*/gi, 'a branch name'],
  [/\b(?:feature|fix|integration|autopilot)\/[\w.-]+/g, 'a branch name'],
];

const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
const isSeparator = (row) => row.every((c) => /^:?-{2,}:?$/.test(c));

/* ------------------------------------------------------------------- the code side ---- */

/**
 * The value exports of the barrel whose names end in `Component`, with the module each comes from.
 * `export *` is refused rather than followed: it would hide components from this check.
 */
export function barrelComponents(source) {
  const problems = [];
  if (/export\s+\*/.test(source)) {
    problems.push(`${BARREL} uses \`export *\`; export components by name so this check sees them`);
  }
  const components = [];
  for (const m of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const name = spec
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (/Component$/.test(name)) components.push({ name, from: m[3] });
    }
  }
  return { components, problems };
}

function read(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function walk(root, rel, keep) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, child, keep));
    else if (keep(entry.name)) out.push(child);
  }
  return out;
}

const selectorOf = (source) => /selector:\s*['"]([^'"]+)['"]/.exec(source ?? '')?.[1] ?? null;

/** `[NXS_PRIMITIVE_IDS.avatar]: NxsAvatarComponent` and `'nxs.x.y': NxsYComponent`, as class → ID. */
function registrations(source, primitiveIds) {
  const byClass = new Map();
  if (!source) return byClass;
  for (const m of source.matchAll(/\[NXS_PRIMITIVE_IDS\.(\w+)\]\s*:\s*(\w+Component)/g)) {
    if (primitiveIds.has(m[1])) byClass.set(m[2], primitiveIds.get(m[1]));
  }
  for (const m of source.matchAll(/['"](nxs\.[\w.]+)['"]\s*:\s*(\w+Component)/g)) {
    byClass.set(m[2], m[1]);
  }
  return byClass;
}

/** Every story ID a library's Storybook serves, computed the way Storybook computes it. */
function storyIds(root, src) {
  const ids = new Set();
  for (const file of walk(root, src, (n) => n.endsWith('.stories.ts'))) {
    const source = read(root, file);
    // The meta's title, not the first `title:` in the file: fixtures have titles too.
    const meta = source.search(/\bconst meta\b|export default\s*\{/);
    const title = meta === -1 ? null : /\btitle:\s*['"]([^'"]+)['"]/.exec(source.slice(meta))?.[1];
    if (!title) continue;
    for (const m of source.matchAll(/^export const (\w+)\s*[:=]/gm)) {
      ids.add(toId(title, storyNameFromExport(m[1])));
    }
  }
  return ids;
}

/**
 * Everything the check compares the page against, read from the repository.
 *
 * @param {string} root
 * @param {{ doc?: string, barrel?: string }} [overrides] replace the page or barrel text, for the
 *   selftest's controls; nothing on disk changes.
 */
export function readInputs(root = ROOT, overrides = {}) {
  const barrel = overrides.barrel ?? read(root, BARREL) ?? '';
  const doc = overrides.doc ?? read(root, DOC);
  const primitiveIds = new Map(
    [...(read(root, PRIMITIVE_IDS) ?? '').matchAll(/^\s*(\w+):\s*['"](nxs\.[\w.]+)['"]/gm)].map(
      (m) => [m[1], m[2]],
    ),
  );
  const { components, problems: barrelProblems } = barrelComponents(barrel);
  const selectors = new Map();
  for (const c of components) {
    const file = resolve(root, dirname(BARREL), `${c.from}.ts`);
    selectors.set(c.name, existsSync(file) ? selectorOf(readFileSync(file, 'utf8')) : null);
  }
  const satoriVariants = new Map();
  for (const file of walk(root, `${SATORI_SRC}/lib`, (n) => n.endsWith('.component.ts'))) {
    const source = read(root, file);
    for (const m of source.matchAll(/export class (\w+Component)\b/g)) {
      satoriVariants.set(m[1], { selector: selectorOf(source), file });
    }
  }
  const idLiterals = new Set();
  for (const file of walk(
    root,
    BASE_SRC,
    (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts') && !n.endsWith('.stories.ts'),
  )) {
    for (const m of read(root, file).matchAll(/['"](nxs\.[\w.]+)['"]/g)) idLiterals.add(m[1]);
  }
  return {
    doc,
    components,
    barrelProblems,
    selectors,
    satoriVariants,
    baseRegistrations: registrations(read(root, BASE_PROVIDER), primitiveIds),
    satoriRegistrations: registrations(read(root, SATORI_PROVIDER), primitiveIds),
    idLiterals,
    baseStories: storyIds(root, BASE_SRC),
    satoriStories: storyIds(root, SATORI_SRC),
  };
}

/* ------------------------------------------------------------------- the page side ---- */

/**
 * The page's `##` headings, its component sections and its summary table.
 *
 * A component section is a `###` under `## Side by side`: a field table, then one image.
 */
export function parseDoc(md) {
  const lines = md.split('\n');
  const h2 = [];
  const sections = [];
  const summaryRows = [];
  const markerLines = { components: [], summary: [] };
  let inComments = false;
  let current = null;
  let h2Title = null;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const [key, marker] of Object.entries(MARKERS)) {
      if (line.trim() === marker) markerLines[key].push({ lineNo, h2: h2Title, after: current });
    }
    if (/^<!--/.test(line.trim())) inComments = !line.includes('-->');
    else if (inComments) {
      if (line.includes('-->')) inComments = false;
      return;
    }
    const heading = /^(#{2,3})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (heading[1] === '##') {
        h2Title = heading[2];
        h2.push(h2Title);
        current = null;
      } else if (h2Title === COMPONENTS_HEADING) {
        current = { heading: heading[2], lineNo, fields: new Map(), images: [], tables: 0 };
        sections.push(current);
      } else {
        current = null;
      }
      return;
    }
    if (/^\s*\|/.test(line)) {
      const row = cells(line);
      if (isSeparator(row)) return;
      if (current) {
        if (row[0] === 'Field' && row[1] === 'Value') current.tables += 1;
        else if (current.tables === 1)
          current.fields.set(row[0].replace(/\*\*/g, ''), row[1] ?? '');
      } else if (h2Title === SUMMARY_HEADING) {
        summaryRows.push({ lineNo, cells: row });
      }
      return;
    }
    const img = parseImageLine(line);
    if (img && current) current.images.push(img);
  });

  // The summary table's first row is its header.
  return { h2, sections, summaryRows: summaryRows.slice(1), markerLines };
}

/** Every image the page references, in order, with the line it is on. */
export function imageReferences(md) {
  return md
    .split('\n')
    .map((line, i) => ({ img: parseImageLine(line), lineNo: i + 1 }))
    .filter(({ img }) => img)
    .map(({ img, lineNo }) => ({ ...img, lineNo }));
}

/** The image a component's section must reference: its selector without `nxs-`. */
export const imageNameFor = (selector) => `${selector.replace(/^nxs-/, '')}-side-by-side.png`;

/** Forbidden references in text a reader sees, i.e. outside HTML comments. */
export function forbiddenReferences(text) {
  const visible = text.replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  for (const [re, what] of FORBIDDEN) {
    for (const m of visible.matchAll(re)) found.push({ what, match: m[0].trim() });
  }
  return found;
}

/* ------------------------------------------------------------------------ the check ---- */

/**
 * Compare the page with the code. Returns the problems and the component list the capture uses.
 *
 * @param {ReturnType<typeof readInputs>} inputs
 */
export function checkComparison(inputs) {
  const problems = [...inputs.barrelProblems];
  const fail = (msg) => problems.push(msg);
  if (typeof inputs.doc !== 'string') {
    fail(`${DOC} does not exist`);
    return { problems, components: [] };
  }
  const { h2, sections, summaryRows, markerLines } = parseDoc(inputs.doc);
  for (const heading of [COMPONENTS_HEADING, SUMMARY_HEADING]) {
    if (!h2.includes(heading)) fail(`${DOC} has no "## ${heading}" section`);
  }

  const lastSection = sections.at(-1) ?? null;
  for (const [key, found] of Object.entries(markerLines)) {
    if (found.length !== 1) {
      fail(`${DOC} must hold \`${MARKERS[key]}\` exactly once (found ${found.length})`);
      continue;
    }
    const [{ lineNo, h2: under, after }] = found;
    const want = key === 'components' ? COMPONENTS_HEADING : SUMMARY_HEADING;
    if (under !== want || (key === 'components' && after !== lastSection)) {
      fail(
        `${DOC}:${lineNo} \`${MARKERS[key]}\` must sit ` +
          (key === 'components'
            ? `after the last component section under "## ${COMPONENTS_HEADING}"`
            : `under "## ${SUMMARY_HEADING}", before its table`),
      );
    }
  }

  const exported = new Map(inputs.components.map((c) => [c.name, c]));
  const satoriIdByClass = inputs.satoriRegistrations;
  const satoriClassById = new Map([...satoriIdByClass].map(([cls, id]) => [id, cls]));
  const documented = new Map();
  const namedVariants = new Map();
  const images = new Map();
  const result = [];

  for (const s of sections) {
    const where = `${DOC}:${s.lineNo} "### ${s.heading}"`;
    if (s.tables !== 1) {
      fail(`${where} needs exactly one "| Field | Value |" table (found ${s.tables})`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!s.fields.has(field)) fail(`${where} has no "${field}" row`);
    }
    for (const field of s.fields.keys()) {
      if (!REQUIRED_FIELDS.includes(field) && !OPTIONAL_FIELDS.includes(field)) {
        fail(`${where} has an unknown row "${field}"`);
      }
    }

    const [component, ...extraComponents] = ticks(s.fields.get('Component') ?? '');
    if (!component || extraComponents.length || !/^Nxs\w+Component$/.test(component)) {
      fail(`${where} "Component" must name one \`Nxs…Component\` class`);
      continue;
    }
    if (!exported.has(component)) {
      fail(`${where} names ${component}, which ${BARREL} does not export — remove the section`);
      continue;
    }
    if (documented.has(component)) {
      fail(`${where} names ${component}, already documented at line ${documented.get(component)}`);
      continue;
    }
    documented.set(component, s.lineNo);

    const idCell = s.fields.get('Registered ID') ?? '';
    const [registeredId = null] = ticks(idCell);
    if (!registeredId && idCell !== '—') {
      fail(`${where} "Registered ID" must be one \`nxs.…\` ID or "—"`);
    }
    const baseId = inputs.baseRegistrations.get(component) ?? null;
    if (baseId && registeredId !== baseId) {
      fail(
        `${where} provideNxsComponents() registers ${component} as ${baseId}, not ${registeredId ?? '—'}`,
      );
    }
    if (registeredId && !inputs.idLiterals.has(registeredId)) {
      fail(`${where} names ID ${registeredId}, which ${BASE_SRC} does not define`);
    }

    const withSatori = s.fields.get('With Satori') ?? '';
    const own = withSatori.startsWith(OWN);
    if (!own && withSatori !== THEME_ONLY) {
      fail(`${where} "With Satori" must start with "${OWN}" or be "${THEME_ONLY}"`);
    }
    const variant = ticks(withSatori).find((t) => /^Nxs\w*Component$/.test(t)) ?? null;
    const reRegistered = registeredId ? (satoriClassById.get(registeredId) ?? null) : null;
    if (own) {
      if (!variant || !inputs.satoriVariants.has(variant)) {
        fail(`${where} says "${OWN}" but names no Satori variant class from ${SATORI_SRC}`);
      } else if (satoriIdByClass.get(variant) !== registeredId) {
        fail(
          `${where} provideNxsSatoriComponents() registers ${variant} as ` +
            `${satoriIdByClass.get(variant) ?? 'nothing'}, not ${registeredId ?? '—'}`,
        );
      } else {
        namedVariants.set(variant, s.lineNo);
      }
    } else if (reRegistered) {
      fail(
        `${where} says "${THEME_ONLY}", but ${reRegistered} re-registers ${registeredId} on Satori`,
      );
    }

    const [story = null, satoriStory = null, ...extraStories] = ticks(
      s.fields.get('Storybook story') ?? '',
    );
    if (!story || !inputs.baseStories.has(story)) {
      fail(`${where} story ${story ?? '(none)'} is not a story in ${BASE_SRC}`);
    }
    if (own && (!satoriStory || !inputs.satoriStories.has(satoriStory))) {
      fail(
        `${where} needs a second story from ${SATORI_SRC}; ${satoriStory ?? '(none)'} is not one`,
      );
    }
    if ((!own && satoriStory) || extraStories.length) {
      fail(`${where} "Storybook story" names more stories than it can use`);
    }

    const captured = s.fields.get('Captured') ?? CAPTURE_STATES[0];
    if (!CAPTURE_STATES.includes(captured)) {
      fail(`${where} "Captured" must be one of: ${CAPTURE_STATES.join(', ')}`);
    }

    const selector = inputs.selectors.get(component);
    const satoriSelector =
      own && variant ? (inputs.satoriVariants.get(variant)?.selector ?? null) : null;
    if (s.images.length !== 1) {
      fail(`${where} needs exactly one image (found ${s.images.length})`);
    } else if (!selector) {
      fail(`${where} cannot read ${component}'s selector, so cannot name its image`);
    } else {
      const want = imageNameFor(selector);
      const [image] = s.images;
      if (image.src !== want) fail(`${where} image must be ${want}, not ${image.src}`);
      if (!image.alt.trim()) fail(`${where} image has no alt text`);
      if (images.has(image.src))
        fail(`${where} image ${image.src} is also used at line ${images.get(image.src)}`);
      images.set(image.src, s.lineNo);
    }

    result.push({
      heading: s.heading,
      component,
      selector,
      own,
      variant: own ? variant : null,
      satoriSelector,
      registeredId,
      story,
      satoriStory: own ? satoriStory : null,
      captured,
      image: s.images[0]?.src ?? null,
    });
  }

  for (const c of inputs.components) {
    if (!documented.has(c.name)) {
      fail(
        `${c.name} is exported from ${BARREL} but has no section in ${DOC}. Add one under ` +
          `"## ${COMPONENTS_HEADING}" and a row under "## ${SUMMARY_HEADING}", then run ` +
          '`npm run docs:satori-comparison:capture` and `npm run docs:satori-comparison:publish`.',
      );
    }
  }
  for (const [variant, { file }] of inputs.satoriVariants) {
    if (!namedVariants.has(variant)) {
      fail(`Satori variant ${variant} (${file}) is not named by any section's "With Satori" row`);
    }
  }

  const byHeading = new Map(result.map((r) => [r.heading, r]));
  const rowNames = new Set();
  for (const { lineNo, cells: row } of summaryRows) {
    const [name, idCell = '', differs = ''] = row;
    const where = `${DOC}:${lineNo} "${SUMMARY_HEADING}" row "${name}"`;
    rowNames.add(name);
    const section = byHeading.get(name);
    if (!section) {
      fail(`${where} has no "### ${name}" section under "## ${COMPONENTS_HEADING}"`);
      continue;
    }
    const [rowId = null] = ticks(idCell);
    if (rowId !== section.registeredId) {
      fail(`${where} says ${rowId ?? '—'}, its section says ${section.registeredId ?? '—'}`);
    }
    if (differs.startsWith('Yes') !== section.own) {
      fail(`${where} "Differs with Satori?" disagrees with its section's "With Satori" row`);
    }
  }
  for (const r of result) {
    if (!rowNames.has(r.heading))
      fail(`"### ${r.heading}" has no row under "## ${SUMMARY_HEADING}"`);
  }

  const known = new Set([...images.keys(), ...Object.values(FULL_IMAGES)]);
  for (const ref of imageReferences(inputs.doc)) {
    if (!known.has(ref.src)) {
      fail(
        `${DOC}:${ref.lineNo} image ${ref.src} is neither a component's nor one the capture produces`,
      );
    }
  }
  for (const { what, match } of forbiddenReferences(inputs.doc)) {
    fail(
      `${DOC} contains ${what} ("${match}"); the page describes the components, not their history`,
    );
  }

  return { problems, components: result };
}

/**
 * The page's component sections, checked, for the capture and publish commands. Throws if the
 * page fails the check: neither command should run against a page CI would reject.
 */
export function loadComparison(root = ROOT) {
  const inputs = readInputs(root);
  const { problems, components } = checkComparison(inputs);
  if (problems.length) {
    throw new Error(
      `${DOC} fails its check — run \`npm run docs:satori-comparison:check\`:\n  ` +
        problems.join('\n  '),
    );
  }
  return { doc: inputs.doc, components };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = readInputs(ROOT);
  const { problems, components } = checkComparison(inputs);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, components }, null, 2));
  } else {
    const own = components.filter((c) => c.own).length;
    console.log(
      `satori-comparison-doc: ${inputs.components.length} component(s) exported, ` +
        `${components.length} section(s) in ${relative(ROOT, join(ROOT, DOC))} ` +
        `(${own} with a Satori variant, ${components.length - own} theme only)`,
    );
    for (const p of problems) console.error(`  FAIL ${p}`);
    console.log(problems.length ? `\nFAIL — ${problems.length} problem(s)` : 'pass');
  }
  process.exitCode = problems.length ? 1 : 0;
}
