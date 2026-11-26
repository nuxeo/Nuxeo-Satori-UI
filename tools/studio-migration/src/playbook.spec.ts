/**
 * The support playbook, docs/business-apps/studio-migration-support.md, holds every kind of finding
 * the tool can print, and no other: its section 9 has a row for each, under the section the
 * scanner (`testing/finding-kinds.ts`) gives it, and each row names who acts on it.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESULTS } from './batch';
import { findingKinds, NOT_FINDINGS, SOURCES } from './testing/finding-kinds';

const PLAYBOOK = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'business-apps',
  'studio-migration-support.md',
);
/** The section of the results of a run of several packages, whose rows are `RESULTS`. */
const RESULTS_SECTION = "Many packages: each package's result";

/** Each `### ` section of the playbook, by its heading, with the first cell of each row. */
function rowsBySection(
  markdown: string,
): Map<string, { readonly kind: string; readonly who: string }[]> {
  const sections = new Map<string, { kind: string; who: string }[]>();
  let current: string | undefined;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('#')) {
      current = line.startsWith('### ') ? line.slice(4).trim() : undefined;
      if (current !== undefined) sections.set(current, []);
      continue;
    }
    const row = /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (row && current !== undefined) {
      const cells = row[2].split('|');
      sections.get(current)?.push({ kind: row[1], who: cells[cells.length - 1].trim() });
    }
  }
  return sections;
}

/** The playbook's section for a scanner's: `Check 2` is `### Check 2: Fields`. */
function sectionFor(sections: ReadonlyMap<string, unknown>, name: string): string | undefined {
  return [...sections.keys()].find((heading) => heading === name || heading.startsWith(`${name}:`));
}

/** Who may act on a finding: the words section 3, "Who acts on a finding", defines. */
function definedActors(markdown: string): Set<string> {
  const section = /\n## 3\. Who acts on a finding\n([^]*?)\n## 4\./.exec(markdown)?.[1] ?? '';
  return new Set([...section.matchAll(/^- \*\*([A-Z][a-z]+):\*\*/gm)].map((match) => match[1]));
}

describe('the support playbook', () => {
  const markdown = readFileSync(PLAYBOOK, 'utf8');
  const sections = rowsBySection(markdown);
  const scanned = findingKinds(__dirname);

  it('reads every finding of the tool as text, each in a file with a section', () => {
    expect(scanned.unread).toEqual([]);
    expect(scanned.kinds.length).toBeGreaterThan(100);
    for (const file of [...Object.keys(SOURCES), ...Object.keys(NOT_FINDINGS)])
      expect([file, existsSync(join(__dirname, file))]).toEqual([file, true]);
  });

  it('has a row for every finding the tool can print, in its section, and none it cannot', () => {
    const byScan = new Map<string, Set<string>>();
    for (const { section, kind } of scanned.kinds)
      byScan.set(section, (byScan.get(section) ?? new Set()).add(kind));
    for (const [section, kinds] of byScan) {
      const heading = sectionFor(sections, section);
      expect([section, heading !== undefined]).toEqual([section, true]);
      const rows = (sections.get(heading as string) ?? []).map((row) => row.kind);
      const missing = [...kinds].filter((kind) => !rows.includes(kind));
      const extra = rows.filter((kind) => !kinds.has(kind));
      // Named so that a failure says which line to write, or to take out.
      expect({ section, 'not in the playbook': missing, 'not in the tool': extra }).toEqual({
        section,
        'not in the playbook': [],
        'not in the tool': [],
      });
      expect([section, rows.length]).toEqual([section, new Set(rows).size]);
    }
  });

  it('has a row for every result of a run of several packages', () => {
    const rows = (sections.get(RESULTS_SECTION) ?? []).map((row) => row.kind);
    expect(rows.sort()).toEqual([...RESULTS, 'the same package'].sort());
  });

  it('names who acts on every finding, with the words section 3 defines', () => {
    const actors = definedActors(markdown);
    expect([...actors].sort()).toEqual(
      ['Decide', 'Decisions', 'Inputs', 'Lab', 'Package', 'Tool', 'Wait'].sort(),
    );
    for (const [heading, rows] of sections)
      for (const { kind, who } of rows) {
        const named = [...who.matchAll(/\*\*([A-Z][a-z]+)\*\*/g)].map((match) => match[1]);
        const fine = named.length > 0 && named.every((name) => actors.has(name));
        // As section 7 says: a stopped package is a stop, which section 7 covers.
        expect([heading, kind, fine || who.startsWith('As section 7 says')]).toEqual([
          heading,
          kind,
          true,
        ]);
      }
  });

  it('names what each file whose problems are not findings does instead', () => {
    expect(markdown).toContain('the catalogue in … is wrong');
    expect(Object.keys(NOT_FINDINGS)).toEqual(['catalogue.ts']);
  });
});

describe('the scanner of findings, on a made-up source', () => {
  /** A `src` of two files: one with a section, one without. */
  function scan(source: string, unmapped = ''): ReturnType<typeof findingKinds> {
    const directory = mkdtempSync(join(tmpdir(), 'finding-kinds-'));
    writeFileSync(join(directory, 'check-seen.ts'), source);
    if (unmapped) writeFileSync(join(directory, 'elsewhere.ts'), unmapped);
    return findingKinds(directory);
  }

  it('reads a text, a template, each branch of a choice, and what a function is given', () => {
    const { kinds, unread } = scan(`
      export function checkSeen(a: string, flag: boolean) {
        const findings: string[] = [];
        findings.push('a fixed line');
        findings.push(\`\${a}: \${a} is missing\`);
        findings.push(flag ? 'one way' : \`the other, \${a}\`);
        const list = (missing?: string) => { if (missing !== undefined) findings.push(missing); };
        list(\`\${a} has no queue\`);
        list(undefined);
        return { findings };
      }`);
    expect(unread).toEqual([]);
    expect(kinds.map((kind) => [kind.section, kind.kind])).toEqual([
      ['Check 6', 'a fixed line'],
      ['Check 6', '…: … is missing'],
      ['Check 6', 'one way'],
      ['Check 6', 'the other, …'],
      ['Check 6', '… has no queue'],
    ]);
  });

  it('lists, never passes over, a finding it cannot read or a file with no section', () => {
    const { unread } = scan(
      `export function checkSeen(rows: string[]) {
        const findings: string[] = [];
        findings.push(rows.join(', '));
        return { findings };
      }`,
      `export function elsewhere() { const findings: string[] = []; findings.push('new'); return findings; }`,
    );
    expect(unread).toEqual([
      expect.stringMatching(/^check-seen\.ts:3: a finding built as `rows\.join\(', '\)`/),
      'elsewhere.ts:1: a finding in a file, or a function, with no section of the playbook in SOURCES',
    ]);
  });
});
