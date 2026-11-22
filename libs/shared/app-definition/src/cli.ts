/**
 * npm run app-definition:validate -- <file or directory>... [--mode <mode>]
 *
 * The check behind phase 0's demo step 1, which the package pipeline is to run first. A layout file
 * that names a widget the platform does not have is refused, and the message names the widget.
 *
 * - **Files checked:** given a directory, it checks every `*.layout.json` under it, so a whole
 *   configuration package can be checked at once.
 * - **Mode:** read from the path a configuration package gives every layout,
 *   `layouts/<Type>/<mode>.layout.json`, unless `--mode` names it.
 * - **Version 1 files** are left to the version 1 reader in `libs/shared/document-layouts`, and
 *   counted.
 *
 * Exit codes:
 * - 0: every version 2 file has no finding;
 * - 1: a file has a finding, or cannot be read;
 * - 2: the command was wrong.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_MODES, validateLayoutV2, type LayoutMode } from './lib/layout-v2';

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE =
  'usage: app-definition validate <file or directory>... [--mode view|metadata|edit|create]\n';
const LAYOUT_PATH = /(?:^|[\\/])layouts[\\/][^\\/]+[\\/]([a-z][a-z0-9-]*)\.layout\.json$/;

export function main(argv: readonly string[], io: CliIo): number {
  const [command, ...rest] = argv;
  const paths: string[] = [];
  let mode: LayoutMode | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--mode') {
      const value = rest[++index];
      if (!LAYOUT_MODES.includes(value as LayoutMode)) {
        io.err(`--mode is one of ${LAYOUT_MODES.join(', ')}\n${USAGE}`);
        return 2;
      }
      mode = value as LayoutMode;
    } else if (arg.startsWith('--')) {
      io.err(USAGE);
      return 2;
    } else paths.push(arg);
  }
  if (command !== 'validate' || paths.length === 0) {
    io.err(USAGE);
    return 2;
  }

  const files: string[] = [];
  for (const path of paths) {
    try {
      files.push(...(statSync(path).isDirectory() ? layoutFiles(path) : [path]));
    } catch (error) {
      io.err(`${path}: ${(error as Error).message}\n`);
      return 1;
    }
  }
  if (files.length === 0) {
    io.out(`No layout files in ${paths.join(', ')}.\n`);
    return 0;
  }

  let refused = 0;
  let passed = 0;
  let versionOne = 0;
  for (const file of files) {
    let content: unknown;
    try {
      content = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      io.out(`${file}: cannot be read as JSON: ${(error as Error).message}\n`);
      refused++;
      continue;
    }
    if (
      typeof content === 'object' &&
      content !== null &&
      (content as { version?: unknown }).version === 1
    ) {
      versionOne++;
      continue;
    }
    const fileMode = mode ?? (LAYOUT_PATH.exec(file)?.[1] as LayoutMode | undefined);
    if (!fileMode || !LAYOUT_MODES.includes(fileMode)) {
      io.out(
        `${file}: cannot tell its mode; name it layouts/<Type>/<mode>.layout.json, or pass --mode\n`,
      );
      refused++;
      continue;
    }
    const findings = validateLayoutV2(content, { mode: fileMode });
    if (findings.length === 0) {
      passed++;
      continue;
    }
    refused++;
    for (const finding of findings) {
      io.out(`${file}: ${finding.path || 'the file'}: ${finding.message} [${finding.kind}]\n`);
    }
  }
  io.out(
    `${files.length} layout files: ${passed} passed, ${refused} refused` +
      (versionOne ? `, ${versionOne} in version 1, which this does not check` : '') +
      '.\n',
  );
  return refused > 0 ? 1 : 0;
}

/** Every `*.layout.json` under a directory, in a stable order. */
function layoutFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') found.push(...layoutFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.layout.json')) found.push(path);
  }
  return found;
}
