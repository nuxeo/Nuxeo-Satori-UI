#!/usr/bin/env node
/** NXSAT-639: plan first; NXSAT-640 applies the reviewed rename. See docs/rename-sweep.md. */
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OLD_PACKAGE = '@nuxeo-satori/platform';
const NEW_PACKAGE = '@nuxeo/satori-platform';
const SELF = /^scripts\/rename-satori(?:\.selftest)?\.mjs$/;
export const EXCLUSIONS = [
  'CHANGELOG files (at any depth, case insensitive)',
  'scripts/rename-satori.mjs and scripts/rename-satori.selftest.mjs (migration rules and fixtures)',
  'untracked files, symlinks, submodules and files containing a NUL byte',
  'upstream @alfresco package names, external URLs, Hxp/AdfHx class names and --hxp-* theme tokens',
];
const git = (root, args, options = {}) =>
  execFileSync('git', args, {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const excluded = (path) => /(^|\/)changelog(?:[./_-]|$)/i.test(path) || SELF.test(path);

/** Read tracked working files, or an immutable Git tree without checking out that ref. */
export function readTree(root, ref) {
  if (!ref) {
    const paths = git(root, ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    return new Map(
      paths
        .filter((path) => lstatSync(resolve(root, path)).isFile())
        .map((path) => [path, readFileSync(resolve(root, path))]),
    );
  }
  const tree = git(root, ['ls-tree', '-rz', '--full-tree', ref], { encoding: 'utf8' });
  const entries = tree
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t');
      const [mode, type, hash] = row.slice(0, tab).split(' ');
      return { mode, type, hash, path: row.slice(tab + 1) };
    })
    .filter(({ mode, type }) => type === 'blob' && mode !== '120000');
  const batch = git(root, ['cat-file', '--batch'], {
    input: entries.map(({ hash }) => hash).join('\n') + '\n',
  });
  let offset = 0;
  return new Map(
    entries.map(({ path, hash }) => {
      const end = batch.indexOf(10, offset);
      const [actual, type, sizeText] = batch.subarray(offset, end).toString().split(' ');
      const size = Number(sizeText);
      if (actual !== hash || type !== 'blob' || !Number.isSafeInteger(size))
        throw new Error('Invalid Git blob response');
      const content = batch.subarray(end + 1, end + 1 + size);
      offset = end + 2 + size;
      return [path, content];
    }),
  );
}

/** All substitutions are derived from this tree; upstream selectors are not guessed. */
export function planRename(files) {
  const textFiles = new Map(
    [...files]
      .filter(([path, data]) => !excluded(path) && !data.includes(0))
      .map(([path, data]) => [path, data.toString('utf8')]),
  );
  const tokens = new Map();
  for (const path of textFiles.keys()) {
    for (const segment of path.split('/')) {
      const renamed = segment.replaceAll('adf-hx', 'satori').replace(/^(_?)hxp-/, '$1nxs-');
      if (renamed !== segment) {
        tokens.set(segment, renamed);
        // Extensionless imports, project names, Sass partials and file stems.
        const stem = segment.replace(/\.[^.]+$/, '');
        const newStem = renamed.replace(/\.[^.]+$/, '');
        tokens.set(stem, newStem);
        if (stem.startsWith('_')) tokens.set(stem.slice(1), newStem.slice(1));
      }
    }
  }
  const selectors = new Map();
  const existing = new Map();
  for (const [path, content] of textFiles) {
    if (!path.endsWith('.ts')) continue;
    for (const match of content.matchAll(/\bselector\s*:\s*(['"])([^'"\r\n]+)\1/g)) {
      for (const selector of match[2].split(',').map((item) => item.trim())) {
        if (selector.startsWith('hxp-')) selectors.set(selector, selector.replace(/^hxp-/, 'nxs-'));
        if (selector.startsWith('nxs-')) existing.set(selector, path);
      }
    }
  }
  for (const entry of selectors) tokens.set(...entry);
  // These route names also occur in manifests, links and evidence scenes.
  tokens.set('browse-adf-hx', 'browse-satori');
  tokens.set('search-adf-hx', 'search-satori');
  const ordered = [...tokens].sort(([a], [b]) => b.length - a.length || a.localeCompare(b));
  const tokenPattern = ordered.length
    ? new RegExp(`(?<![\\w-])(?:${ordered.map(([from]) => escape(from)).join('|')})(?![\\w-])`, 'g')
    : null;
  const transform = (content) =>
    content
      .split(/(@alfresco\/[\w./-]+|https?:\/\/[^\s'"<>`]+)/g)
      .map((part, index) => {
        if (index % 2) return part;
        const renamed = part.replace(/@nuxeo-satori\/platform(?![\w-])/g, NEW_PACKAGE);
        return tokenPattern ? renamed.replace(tokenPattern, (token) => tokens.get(token)) : renamed;
      })
      .join('');
  const changes = [];
  const next = new Map(files);
  const blockers = [];
  const targets = new Map();
  for (const [path, before] of textFiles) {
    const to = path
      .split('/')
      .map((segment) => tokens.get(segment) ?? segment)
      .join('/');
    const after = transform(before);
    if (targets.has(to) && targets.get(to) !== path)
      blockers.push(`Path collision: ${targets.get(to)} and ${path} -> ${to}`);
    targets.set(to, path);
    if (to !== path && files.has(to)) blockers.push(`Destination already exists: ${path} -> ${to}`);
    if (before !== after || path !== to) {
      const beforeLines = before.split('\n');
      const edits = after.split('\n').flatMap((line, index) =>
        line === beforeLines[index]
          ? []
          : [
              {
                line: index + 1,
                before: beforeLines[index],
                after: line,
              },
            ],
      );
      changes.push({ from: path, to, edits });
      next.delete(path);
      next.set(to, Buffer.from(after));
    }
  }
  for (const [from, to] of selectors) {
    if (existing.has(to))
      blockers.push(
        `Selector collision: ${from} -> ${to}; already declared in ${existing.get(to)}`,
      );
  }
  changes.sort((a, b) => a.from.localeCompare(b.from));
  return { changes, blockers: [...new Set(blockers)].sort(), next };
}

/** Refuse a stale plan before any move or write. Never overwrite an existing destination. */
export function applyPlan(root, files, plan) {
  if (plan.blockers.length) throw new Error(`Rename blocked:\n${plan.blockers.join('\n')}`);
  for (const { from, to } of plan.changes) {
    if (!readFileSync(resolve(root, from)).equals(files.get(from)))
      throw new Error(`Source changed: ${from}`);
    if (from !== to) {
      try {
        lstatSync(resolve(root, to));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error(`Destination already exists: ${to}`);
    }
  }
  for (const { from, to } of plan.changes) {
    const target = resolve(root, to);
    mkdirSync(dirname(target), { recursive: true });
    if (from !== to) renameSync(resolve(root, from), target);
    writeFileSync(target, plan.next.get(to));
  }
}

export function main(argv) {
  const options = { root: process.cwd(), write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--dry-run') continue;
    else if (arg === '--help') {
      console.log(
        'node scripts/rename-satori.mjs [--dry-run|--write] [--root dir] [--ref git-ref] [--report file.json]',
      );
      return;
    } else if (['--root', '--ref', '--report'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.write && options.ref) throw new Error('--write cannot be combined with --ref');
  const root = resolve(options.root);
  const files = readTree(root, options.ref);
  const plan = planRename(files);
  const second = planRename(plan.next);
  if (second.changes.length) throw new Error('Plan is not idempotent');
  const report = {
    mode: options.write ? 'write' : 'dry-run',
    ref: options.ref ?? 'working-tree',
    commit: git(root, ['rev-parse', '--verify', `${options.ref ?? 'HEAD'}^{commit}`], {
      encoding: 'utf8',
    }).trim(),
    package: { from: OLD_PACKAGE, to: NEW_PACKAGE },
    exclusions: EXCLUSIONS,
    scannedFiles: files.size,
    changedFiles: plan.changes.length,
    movedFiles: plan.changes.filter(({ from, to }) => from !== to).length,
    changedLines: plan.changes.reduce((count, { edits }) => count + edits.length, 0),
    secondRunChanges: second.changes.length,
    blockers: plan.blockers,
    changes: plan.changes,
  };
  if (options.report) {
    const target = resolve(options.report);
    if (files.has(target.slice(root.length + 1).replaceAll('\\', '/')))
      throw new Error('Report must not overwrite a tracked file');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  }
  if (options.write) applyPlan(root, files, plan);
  console.log(
    `${report.mode}: ${report.changedFiles} files, ${report.movedFiles} moves, ${report.changedLines} changed lines; second run: ${report.secondRunChanges} changes`,
  );
  for (const { from, to, edits } of plan.changes) {
    console.log(`${from === to ? from : `${from} -> ${to}`} (${edits.length} lines)`);
    if (!options.report)
      for (const edit of edits) console.log(`  ${edit.line}: ${edit.before}\n  -> ${edit.after}`);
  }
  for (const blocker of plan.blockers) console.log(`BLOCKER: ${blocker}`);
  if (options.report) console.log(`Report: ${resolve(options.report)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
