#!/usr/bin/env node
/**
 * The English copy `@nuxeo/satori-platform` ships for the translation keys its own code uses.
 *
 * ## Why the package needs one
 *
 * The package's entry points are built from `libs/shared/{ui,nuxeo-client,extensions,app-config}`,
 * and their templates and services ask for ~300 keys that exist only in the application's
 * catalogue, `apps/nuxeo-ui/public/i18n/en.json` — which does not travel with the package. A host
 * that installs it without that catalogue saw raw keys. `PLATFORM_EN_TRANSLATIONS`, written by this
 * script, is the English for exactly those keys, and `providePlatformEnglishFallback()` serves it
 * for any key the host's own catalogues do not supply.
 *
 * ## How the key set is found
 *
 * Every entry point listed in `libs/platform/**\/ng-package.json` is walked. A string literal equal
 * to a key in `en.json` is a reference; a template literal that builds a key from a prefix
 * (`` `permissions.right.${permission}` ``) references every key under that prefix. The generated
 * file itself is skipped, or its own keys would keep a key "referenced" after the code stopped
 * using it.
 *
 * Usage:  node tools/i18n/platform-english.mjs   # rewrites the generated file
 *
 * `checkPlatformEnglishFallback` in scripts/review-guardrails.mjs fails when the file drifts from
 * the catalogue or from the keys the package uses.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLATFORM_EN_FILE = 'libs/shared/ui/src/lib/i18n/platform-en.ts';
export const APP_CATALOGUE = 'apps/nuxeo-ui/public/i18n/en.json';
const BEGIN = '// @generated-begin';
const END = '// @generated-end';

/** `en.json` flattened to dotted keys. */
export function flatCatalogue(root) {
  const flat = {};
  const collect = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') collect(value, path);
      else if (typeof value === 'string') flat[path] = value;
    }
  };
  collect(JSON.parse(readFileSync(join(root, APP_CATALOGUE), 'utf8')), '');
  return flat;
}

/** Source directories of every `@nuxeo/satori-platform` entry point. */
export function platformSourceDirs(root) {
  const platform = join(root, 'libs/platform');
  const dirs = new Set();
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (entry === 'node_modules') continue;
      if (statSync(path).isDirectory()) visit(path);
      else if (entry === 'ng-package.json') {
        const entryFile = JSON.parse(readFileSync(path, 'utf8'))?.lib?.entryFile;
        if (entryFile) dirs.add(relative(root, dirname(resolve(dir, entryFile))));
      }
    }
  };
  if (existsSync(platform)) visit(platform);
  return [...dirs].sort();
}

/** Every catalogue key the package's source references, sorted. */
export function platformKeys(root) {
  const catalogue = flatCatalogue(root);
  const keys = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const rel = relative(root, path).replace(/\\/g, '/');
      if (!/\.(ts|html)$/.test(entry) || /\.spec\.ts$|\.host\.html$/.test(entry)) continue;
      if (rel === PLATFORM_EN_FILE) continue;
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g)) {
        if (m[1] in catalogue) keys.add(m[1]);
      }
      for (const m of text.matchAll(/`([a-z][\w-]*(?:\.[\w-]+)*\.)\$\{/g)) {
        for (const key of Object.keys(catalogue)) if (key.startsWith(m[1])) keys.add(key);
      }
    }
  };
  for (const dir of platformSourceDirs(root))
    if (existsSync(join(root, dir))) walk(join(root, dir));
  return [...keys].sort();
}

/** The English the package should ship: each referenced key with its `en.json` value. */
export function expectedPlatformEnglish(root) {
  const catalogue = flatCatalogue(root);
  return Object.fromEntries(platformKeys(root).map((key) => [key, catalogue[key]]));
}

/** The map currently written in the generated file, or `null` if it cannot be read. */
export function readPlatformEnglish(root) {
  const path = join(root, PLATFORM_EN_FILE);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) return null;
  const body = text.slice(text.indexOf('{', start), text.lastIndexOf('}', end) + 1);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function renderPlatformEnglish(map) {
  return `/**
 * English for every translation key \`@nuxeo/satori-platform\` uses, so a host application that does
 * not ship the application catalogue renders English rather than raw keys.
 *
 * Generated by \`node tools/i18n/platform-english.mjs\` from \`${APP_CATALOGUE}\`; do not edit by
 * hand. \`checkPlatformEnglishFallback\` fails when it drifts from that catalogue or from the keys the
 * package's code references.
 */
${BEGIN}
// prettier-ignore
export const PLATFORM_EN_TRANSLATIONS: Readonly<Record<string, string>> = ${JSON.stringify(map, null, 2)};
${END}
`;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const map = expectedPlatformEnglish(root);
  writeFileSync(join(root, PLATFORM_EN_FILE), renderPlatformEnglish(map));
  console.log(`${PLATFORM_EN_FILE}: ${Object.keys(map).length} keys`);
}
