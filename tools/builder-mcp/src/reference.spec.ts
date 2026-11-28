import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { HOST } from './host.ts';
import { listReference, readReference } from './reference.ts';

const scratch = mkdtempSync(join(tmpdir(), 'builder-mcp-reference-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const knowledge = join(scratch, 'knowledge');
const examples = join(scratch, 'examples');
mkdirSync(join(examples, 'acme'), { recursive: true });
mkdirSync(knowledge);
writeFileSync(join(knowledge, 'README.md'), '# For the agent\n\nRead me first.\n');
writeFileSync(join(knowledge, 'notes.txt'), 'not a reference\n');
writeFileSync(join(examples, 'acme', 'app.json'), '{ "version": 2 }\n');
const outside = join(scratch, 'outside.md');
writeFileSync(outside, '# Outside\n');
symlinkSync(outside, join(knowledge, 'linked.md'));
const ROOTS = [
  { name: 'knowledge', directory: knowledge },
  { name: 'examples', directory: examples },
];

describe('read_reference', () => {
  it('lists the Markdown and JSON files of every root, Markdown with its first heading', () => {
    expect(listReference(ROOTS)).toEqual([
      { path: 'knowledge/README.md', title: 'For the agent' },
      { path: 'examples/acme/app.json' },
    ]);
  });

  it('reads a file by its path from the roots', () => {
    expect(readReference('knowledge/README.md', ROOTS).text).toContain('Read me first.');
    expect(readReference('examples/acme/app.json', ROOTS).text).toContain('"version": 2');
  });

  it('refuses what is not a reference: outside the roots, through a link, or of another kind', () => {
    const refused: [string, string][] = [
      ['knowledge/../outside.md', 'is not a path of the references'],
      ['/etc/passwd', 'is not a path of the references'],
      ['elsewhere/README.md', 'begins with none of knowledge, examples'],
      ['knowledge/notes.txt', 'only Markdown and JSON'],
      ['knowledge/linked.md', 'goes through a link'],
      ['knowledge/missing.md', 'is not one of the references'],
    ];
    for (const [path, why] of refused) expect(() => readReference(path, ROOTS), path).toThrow(why);
  });

  it("names this repository's authored knowledge pack as its reference here", () => {
    expect(HOST.reference.map(({ name }) => name)).toEqual(['knowledge']);
    expect(listReference().map(({ path }) => path)).toContain('knowledge/recipes.md');
  });
});
