/**
 * npm run app-definition:validate -- <file or directory>... [--mode <mode>] [--allow-list <file>]
 *   [--platform <version>]
 *
 * The check behind phase 0's demo step 1, which the package pipeline is to run first. A layout file
 * that names a widget the platform does not have is refused, and the message names the widget.
 *
 * - **Files checked:** given a directory, every file of an app definition under it
 *   (docs/business-apps/app-definition-v2.md, section 1), so a whole package is checked at once.
 *   Given a file, that file.
 * - **With its package:** a file is checked with the `app.json`, `actions.json` and `assets/` of
 *   the package it sits in, whether or not they were named.
 * - **A layout's mode** is read from its path, `layouts/<Type>/<mode>.layout.json`, unless
 *   `--mode` names it.
 * - **Operations** are refused unless `--allow-list` names a file that lists them (decision 3).
 * - **`app.json`'s platform range** is held to `--platform`, when it is given.
 * - **Version 1 layouts** are left to the version 1 reader in `libs/shared/document-layouts`, and
 *   counted.
 *
 * Exit codes:
 * - 0: every file has no finding;
 * - 1: a file has a finding, or cannot be read;
 * - 2: the command was wrong.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { LAYOUT_MODES, type LayoutMode } from './lib/layout-v2';
import { placeFile, validateFile, type PackageContext, type PlacedFile } from './lib/package';
import { isRecord } from './lib/registries';
import { parseVersion } from './lib/semver';

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE =
  'usage: app-definition validate <file or directory>... [--mode view|metadata|edit|create]' +
  ' [--allow-list <file>] [--platform <version>]\n';

export function main(argv: readonly string[], io: CliIo): number {
  const [command, ...rest] = argv;
  const paths: string[] = [];
  let mode: LayoutMode | undefined;
  let allowList: string | undefined;
  let platformVersion: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--mode') {
      const value = rest[++index];
      if (!LAYOUT_MODES.includes(value as LayoutMode)) {
        io.err(`--mode is one of ${LAYOUT_MODES.join(', ')}\n${USAGE}`);
        return 2;
      }
      mode = value as LayoutMode;
    } else if (arg === '--allow-list' && rest[index + 1] !== undefined) {
      allowList = rest[++index];
    } else if (arg === '--platform') {
      const value = rest[++index];
      if (value === undefined || !parseVersion(value)) {
        io.err(`--platform is a version, such as 1.0.0\n${USAGE}`);
        return 2;
      }
      platformVersion = value;
    } else if (arg.startsWith('--')) {
      io.err(USAGE);
      return 2;
    } else paths.push(arg);
  }
  if (command !== 'validate' || paths.length === 0) {
    io.err(USAGE);
    return 2;
  }
  let operations: ReadonlySet<string> = new Set();
  if (allowList !== undefined) {
    const read = readAllowList(allowList);
    if (typeof read === 'string') {
      io.err(`${allowList}: ${read}\n${USAGE}`);
      return 2;
    }
    operations = read;
  }

  const files: string[] = [];
  for (const path of paths) {
    try {
      files.push(...(statSync(path).isDirectory() ? packageFiles(path) : [path]));
    } catch (error) {
      io.err(`${path}: ${(error as Error).message}\n`);
      return 1;
    }
  }
  if (files.length === 0) {
    io.out(`No app definition files in ${paths.join(', ')}.\n`);
    return 0;
  }

  const contexts = new Map<string, PackageContext>();
  let refused = 0;
  let passed = 0;
  let versionOne = 0;
  let operationRefused = false;
  for (const file of files) {
    let content: unknown;
    try {
      content = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      io.out(`${file}: cannot be read as JSON: ${(error as Error).message}\n`);
      refused++;
      continue;
    }
    const placed: PlacedFile | null =
      placeFile(file) ??
      (mode ? { file: { kind: 'layout', type: '', mode }, root: dirname(file) } : null);
    if (!placed) {
      io.out(
        `${file}: cannot tell which file of an app definition it is; name it as a package places it,` +
          ' such as layouts/<Type>/<mode>.layout.json or queues/<id>.json, or pass --mode for a layout\n',
      );
      refused++;
      continue;
    }
    if (placed.file.kind === 'layout' && isRecord(content) && content['version'] === 1) {
      versionOne++;
      continue;
    }
    const findings = validateFile(placed.file, content, contextOf(placed.root, contexts), {
      operations,
      platformVersion,
      mode,
    });
    if (findings.length === 0) {
      passed++;
      continue;
    }
    refused++;
    for (const finding of findings) {
      io.out(`${file}: ${finding.path || 'the file'}: ${finding.message} [${finding.kind}]\n`);
      if (finding.message.endsWith("is not on this deployment's allow-list"))
        operationRefused = true;
    }
  }
  if (operationRefused && allowList === undefined)
    io.out('No --allow-list was given, so every operation is refused.\n');
  io.out(
    `${files.length} ${files.length === 1 ? 'file' : 'files'}: ${passed} passed, ${refused} refused` +
      (versionOne ? `, ${versionOne} in version 1, which this does not check` : '') +
      '.\n',
  );
  return refused > 0 ? 1 : 0;
}

/** The deployment's operations, from `{ "operations": [...] }`, or what is wrong with the file. */
function readAllowList(path: string): ReadonlySet<string> | string {
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return `cannot be read as JSON: ${(error as Error).message}`;
  }
  const operations = isRecord(content) ? content['operations'] : undefined;
  if (
    !isRecord(content) ||
    Object.keys(content).some((key) => key !== 'operations') ||
    !Array.isArray(operations) ||
    !operations.every((operation) => typeof operation === 'string')
  )
    return 'an allow-list is { "operations": [<operation or chain ID>, ...] }';
  return new Set(operations as string[]);
}

/** A package's `app.json`, `actions.json` and assets, read once for all its files. */
function contextOf(root: string, cache: Map<string, PackageContext>): PackageContext {
  const cached = cache.get(root);
  if (cached) return cached;
  const read = (name: string): unknown => {
    try {
      const path = join(root, name);
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
    } catch {
      return null; // Unreadable: its own check says so, and nothing can be taken from it.
    }
  };
  const assetsRoot = join(root, 'assets');
  const assets = existsSync(assetsRoot)
    ? everyFile(assetsRoot).map((path) => relative(root, path).split(sep).join('/'))
    : [];
  const context = { app: read('app.json'), actions: read('actions.json'), assets: new Set(assets) };
  cache.set(root, context);
  return context;
}

/** Every file of an app definition under a directory, and every layout file, in a stable order. */
function packageFiles(directory: string): string[] {
  return everyFile(directory).filter(
    (path) => placeFile(path) !== null || path.endsWith('.layout.json'),
  );
}

function everyFile(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') found.push(...everyFile(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
