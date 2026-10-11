#!/usr/bin/env node
/**
 * Negative controls for `satori-comparison-doc.mjs`.
 *
 * Each control breaks the page or the barrel **in memory** — nothing tracked is touched — and
 * asserts the check reports that specific breakage, not merely that it fails: a control that
 * fails for an unrelated reason would read as a pass. Two positive controls hold the other
 * direction: the repository as it stands passes, and so does a copy of it carrying what the
 * `satori-component` generator is expected to emit for a new component (`generatedComponent`
 * below), built under `os.tmpdir()`.
 *
 * Usage:  node scripts/beta-harness/satori-comparison-doc.selftest.mjs
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BARREL,
  DOC,
  MARKERS,
  ROOT,
  THEME_ONLY,
  checkComparison,
  readInputs,
} from './satori-comparison-doc.mjs';

const doc = readFileSync(join(ROOT, DOC), 'utf8');
const barrel = readFileSync(join(ROOT, BARREL), 'utf8');

/** `text` with `from` replaced once; throws if `from` is absent, so a control cannot go stale. */
function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`control fixture not found: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}

/** `text` without the `### heading` section, up to the next heading or marker. */
function withoutSection(text, heading) {
  const re = new RegExp(`### ${heading}\\n[\\s\\S]*?(?=\\n### |\\n<!-- satori:comparison)`);
  if (!re.test(text)) throw new Error(`control fixture not found: ### ${heading}`);
  return text.replace(re, '');
}

const sectionOf = (text, heading) =>
  new RegExp(`### ${heading}\\n[\\s\\S]*?(?=\\n### |\\n<!-- satori:comparison)`).exec(text)[0];

/**
 * What the `satori-component` generator should emit into the page for a new component, beside the
 * component, story, barrel export and registration it already emits: a section above
 * `<!-- satori:comparison:components -->` and a row appended to the table after
 * `<!-- satori:comparison:summary -->`.
 */
export function generatedComponent({ fileName, className, title, componentId }) {
  const storyId = `components-${fileName}--default`;
  return {
    section: [
      `### ${title}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Component | \`${className}\` |`,
      `| Registered ID | \`${componentId}\` |`,
      `| With Satori | ${THEME_ONLY} |`,
      `| Storybook story | \`${storyId}\` |`,
      '',
      `![${title}: without Satori on the left, with Satori on the right](${fileName}-side-by-side.png ` +
        `'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')`,
      '',
      'The same component in both; only the theme differs.',
      '',
    ].join('\n'),
    row: `| ${title} | \`${componentId}\` | ${THEME_ONLY} |`,
  };
}

const NEGATIVE = [
  [
    'a component exported from the barrel with no section',
    { doc: withoutSection(doc, 'Spinner') },
    /NxsSpinnerComponent is exported from .* but has no section/,
  ],
  [
    'a fake component added to the barrel',
    { barrel: `${barrel}export { NxsFakeComponent } from './lib/fake/fake.component';\n` },
    /NxsFakeComponent is exported from .* but has no section/,
  ],
  [
    'a section for a component the barrel no longer exports',
    { barrel: swap(barrel, "export { NxsIconComponent } from './lib/icon/icon.component';\n", '') },
    /names NxsIconComponent, which .* does not export/,
  ],
  [
    'a Satori variant no section names',
    { doc: withoutSection(doc, 'Avatar') },
    /Satori variant NxsSatoriAvatarComponent .* is not named/,
  ],
  [
    'a registered ID that disagrees with provideNxsComponents()',
    {
      doc: swap(
        doc,
        '| Registered ID   | `nxs.primitives.avatar`',
        '| Registered ID   | `nxs.primitives.tag`',
      ),
    },
    /registers NxsAvatarComponent as nxs\.primitives\.avatar, not nxs\.primitives\.tag/,
  ],
  [
    'a Satori-backed component described as theme only',
    {
      doc: swap(
        doc,
        "Satori's own component: `NxsSatoriTagComponent` renders `<sat-category-tag>`",
        THEME_ONLY,
      ),
    },
    /says "Same component; theme only", but NxsSatoriTagComponent re-registers nxs\.primitives\.tag/,
  ],
  [
    'a theme-only component described as Satori-backed',
    {
      doc: swap(
        doc,
        sectionOf(doc, 'Icon'),
        sectionOf(doc, 'Icon').replace(
          THEME_ONLY,
          "Satori's own component: `NxsSatoriIconComponent`",
        ),
      ),
    },
    /"### Icon" says "Satori's own component" but names no Satori variant/,
  ],
  [
    'a story that does not exist',
    { doc: swap(doc, '`primitives-icon--sized-and-coloured`', '`primitives-icon--no-such-story`') },
    /story primitives-icon--no-such-story is not a story/,
  ],
  [
    'an image whose name does not follow the selector',
    { doc: swap(doc, '](icon-side-by-side.png', '](icons-side-by-side.png') },
    /image must be icon-side-by-side\.png, not icons-side-by-side\.png/,
  ],
  [
    'a section copied twice',
    {
      doc: swap(
        doc,
        MARKERS.components,
        `${sectionOf(doc, 'Icon').replace('### Icon', '### Icon again')}\n${MARKERS.components}`,
      ),
    },
    /names NxsIconComponent, already documented/,
  ],
  [
    'a section with no row in "All components"',
    { doc: swap(doc, doc.split('\n').find((l) => l.startsWith('| Spinner ')) + '\n', '') },
    /"### Spinner" has no row under "## All components"/,
  ],
  [
    'an "All components" row that disagrees with its section',
    {
      doc: swap(
        doc,
        doc.split('\n').find((l) => l.startsWith('| Avatar ')),
        "| Avatar | `nxs.primitives.tag` | Yes — Satori's own component |",
      ),
    },
    /row "Avatar" says nxs\.primitives\.tag, its section says nxs\.primitives\.avatar/,
  ],
  [
    "a generator's marker removed",
    { doc: swap(doc, MARKERS.components, '') },
    /satori:comparison:components -->` exactly once \(found 0\)/,
  ],
  [
    'a misspelt field row',
    {
      doc: swap(
        doc,
        '| Registered ID   | `nxs.primitives.tag`',
        '| Registerd ID    | `nxs.primitives.tag`',
      ),
    },
    /"### Tag" has an unknown row "Registerd ID"/,
  ],
  [
    'an unknown capture state',
    { doc: swap(doc, 'Opened from the keyboard  ', 'Hovered                   ') },
    /"Captured" must be one of/,
  ],
  [
    'an image the capture does not produce',
    { doc: swap(doc, '## Why both exist', '![Stray](stray.png)\n\n## Why both exist') },
    /image stray\.png is neither a component's nor one the capture produces/,
  ],
  [
    'a ticket key in the text',
    { doc: swap(doc, 'Leaving out', 'Since NXSAT-308, leaving out') },
    /contains a ticket key \("NXSAT-308"\)/,
  ],
  [
    'a pull-request number in the text',
    { doc: swap(doc, 'nothing breaks.', 'nothing breaks (see #366).') },
    /contains a pull-request number \("#366"\)/,
  ],
  [
    'a branch name in the text',
    { doc: swap(doc, 'nothing breaks.', 'nothing breaks on feature/nxsat-308-storybook.') },
    /contains a branch name/,
  ],
  [
    '`export *` in the barrel',
    { barrel: `${barrel}export * from './lib/primitives';\n` },
    /uses `export \*`/,
  ],
];

let failed = 0;
const report = (ok, name, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Negative controls — each must report its own breakage:');
for (const [name, overrides, want] of NEGATIVE) {
  let problems;
  try {
    ({ problems } = checkComparison(readInputs(ROOT, overrides)));
  } catch (error) {
    report(false, name, `threw ${error.message}`);
    continue;
  }
  const hit = problems.find((p) => want.test(p));
  report(
    Boolean(hit),
    name,
    hit ? '' : `got ${problems.length ? problems.join(' | ') : 'no problems'}`,
  );
}

console.log('\nPositive controls — each must pass:');
{
  const { problems } = checkComparison(readInputs(ROOT));
  report(problems.length === 0, 'the repository as it stands', problems.join(' | '));
}
{
  const { problems } = checkComparison(
    readInputs(ROOT, { doc: swap(doc, 'nothing breaks.', 'nothing breaks (colour #123456).') }),
  );
  report(
    problems.length === 0,
    'a six-digit hex colour is not a pull-request number',
    problems.join(' | '),
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'satori-comparison-selftest-'));
try {
  for (const dir of [
    'libs/shared/satori-components/src',
    'libs/shared/satori-components-satori/src',
  ]) {
    cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true });
  }
  mkdirSync(join(tmp, 'docs/satori-components'), { recursive: true });

  const spec = {
    fileName: 'claim-summary',
    className: 'NxsClaimSummaryComponent',
    title: 'Claim Summary',
    componentId: 'nxs.sidebar.claimSummary',
  };
  const lib = join(tmp, 'libs/shared/satori-components/src');
  mkdirSync(join(lib, 'lib/claim-summary'));
  writeFileSync(
    join(lib, 'lib/claim-summary/claim-summary.component.ts'),
    `@Component({ selector: 'nxs-claim-summary', templateUrl: './claim-summary.component.html' })\n` +
      `export class ${spec.className} {}\n`,
  );
  writeFileSync(
    join(lib, 'lib/claim-summary/claim-summary.stories.ts'),
    `const meta = { title: 'Components/${spec.title}' };\nexport default meta;\nexport const Default = {};\n`,
  );
  writeFileSync(
    join(lib, 'index.ts'),
    `${barrel}export { ${spec.className} } from './lib/claim-summary/claim-summary.component';\n`,
  );
  const provider = join(lib, 'lib/provide-nxs-components.ts');
  writeFileSync(
    provider,
    swap(
      readFileSync(provider, 'utf8'),
      'components: {',
      `components: {\n      '${spec.componentId}': ${spec.className},`,
    ),
  );

  const { section, row } = generatedComponent(spec);
  const lines = swap(doc, MARKERS.components, `${section}\n${MARKERS.components}`).split('\n');
  const marker = lines.indexOf(MARKERS.summary);
  let end = marker + 1;
  while (!lines[end].startsWith('|')) end += 1;
  while (lines[end]?.startsWith('|')) end += 1;
  lines.splice(end, 0, row);
  writeFileSync(join(tmp, DOC), lines.join('\n'));

  const before = checkComparison(readInputs(tmp, { doc })).problems;
  report(
    before.some((p) => /NxsClaimSummaryComponent is exported .* but has no section/.test(p)),
    'a generated component without its section fails (precondition for the next control)',
    before.length ? '' : 'no problems',
  );
  const { problems } = checkComparison(readInputs(tmp));
  report(
    problems.length === 0,
    "a generated component with the generator's section and row passes",
    problems.join(' | '),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const total = NEGATIVE.length + 4;
console.log();
if (failed === 0) {
  console.log(
    `satori-comparison-doc selftest: pass — ${NEGATIVE.length} negative, 4 positive control(s).`,
  );
} else {
  console.error(`satori-comparison-doc selftest: FAIL — ${failed} of ${total} control(s).`);
  process.exitCode = 1;
}
