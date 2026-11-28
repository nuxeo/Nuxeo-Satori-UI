/**
 * `read_reference`: the knowledge pack and the examples the tool carries, for an agent in any AI
 * IDE, which may not browse `node_modules`. Given no path, it lists every file, each Markdown file
 * with its first heading; given one, it answers that file's text. It reads only what the host names
 * as its references (`host.ts`), and nothing reached through a link, outside them, or of another
 * kind than Markdown and JSON.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { HOST } from './host.ts';

/** The largest file it answers: the knowledge pack's files are a few kilobytes each. */
const MAX_BYTES = 512 * 1024;
const KINDS = /\.(?:md|json)$/;

export interface ReferenceRoot {
  /** The name a path begins with, such as `knowledge`. */
  readonly name: string;
  readonly directory: string;
}

export interface ReferenceEntry {
  readonly path: string;
  readonly title?: string;
}

/** Every file of the references, by its path from them, Markdown files with their first heading. */
export function listReference(roots: readonly ReferenceRoot[] = HOST.reference): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  for (const root of roots) {
    const walk = (directory: string) => {
      const found = lstatSync(directory, { throwIfNoEntry: false });
      if (!found?.isDirectory()) return;
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const file = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && KINDS.test(entry.name)) {
          const path = [root.name, ...relative(root.directory, file).split(sep)].join('/');
          const heading = entry.name.endsWith('.md')
            ? /^#\s+(.+)$/m.exec(readFileSync(file, 'utf8'))?.[1]
            : undefined;
          entries.push(heading === undefined ? { path } : { path, title: heading });
        }
      }
    };
    walk(root.directory);
  }
  return entries;
}

/** The text of one file of the references, named by its path from them, or why it is not read. */
export function readReference(
  path: string,
  roots: readonly ReferenceRoot[] = HOST.reference,
): { readonly path: string; readonly text: string } {
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\')))
    throw new Error(
      `path: ${JSON.stringify(path)} is not a path of the references, such as knowledge/README.md.`,
    );
  const root = roots.find(({ name }) => name === parts[0]);
  if (root === undefined)
    throw new Error(
      `path: ${JSON.stringify(path)} begins with none of ${roots.map(({ name }) => name).join(', ')}. Call read_reference with no path for the list.`,
    );
  if (!KINDS.test(path)) throw new Error(`path: only Markdown and JSON files are references.`);
  let current = root.directory;
  for (const part of parts.slice(1)) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry === undefined) throw new Error(`path: ${path} is not one of the references.`);
    if (entry.isSymbolicLink())
      throw new Error(`path: ${path} goes through a link, which is not read.`);
  }
  const file = resolve(current);
  if (!file.startsWith(resolve(root.directory) + sep))
    throw new Error(`path: ${path} is not inside the references.`);
  const entry = lstatSync(file);
  if (!entry.isFile())
    throw new Error(`path: ${path} is a folder: call read_reference with no path for the list.`);
  if (entry.size > MAX_BYTES) throw new Error(`path: ${path} is larger than ${MAX_BYTES} bytes.`);
  return { path, text: readFileSync(file, 'utf8') };
}
