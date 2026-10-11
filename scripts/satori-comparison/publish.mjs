#!/usr/bin/env node
/**
 * Publish `docs/satori-components/with-and-without-satori.md` to its Confluence page, in place,
 * then read the page back and verify it.
 *
 * The page named by `docs/satori-components/with-and-without-satori.confluence.json` is updated
 * with a version bump — never created, never moved, never renamed. Images come from the capture's
 * output (`npm run docs:satori-comparison:capture`) and are uploaded by file name, replacing the
 * attachment of the same name. The conversion is `confluence-storage.mjs`'s, shared with
 * `publish-confluence.mjs`.
 *
 * Refuses to run:
 *   - in CI (it writes to Confluence with a person's credentials);
 *   - against any space but the one in ALLOWED_SPACE_ID, checked in the config **and** on the page
 *     Confluence returns, so editing the config cannot redirect it;
 *   - when the page fails `docs:satori-comparison:check`, or an image it references was not
 *     captured, or the converted page carries a ticket key, PR reference or branch name.
 *
 * Credentials from CONFLUENCE_EMAIL and CONFLUENCE_TOKEN (or CONFLUENCE_TOKEN_FILE), else from
 * ~/.jira_email and ~/.jira_token. Never printed.
 *
 * The read-back fails unless the version went up by one, every image the page references is an
 * attachment of the page that downloads as the PNG that was uploaded (byte for byte), Confluence
 * renders each, the headings match the Markdown, and no forbidden reference appears.
 *
 * Usage:
 *   npm run docs:satori-comparison:publish                 # upload, update, read back
 *   npm run docs:satori-comparison:publish -- --dry-run    # convert and check locally; no network
 *   npm run docs:satori-comparison:publish -- --verify     # read back and verify only
 *   npm run docs:satori-comparison:publish -- --images <dir>
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';
import { imageMacro, toStorage, uploadAttachment } from '../confluence-storage.mjs';
import {
  DOC,
  ROOT,
  forbiddenReferences,
  imageReferences,
  loadComparison,
  parseDoc,
} from '../beta-harness/satori-comparison-doc.mjs';

const BASE = 'https://hyland.atlassian.net/wiki';
/** The only space this command writes to. */
const ALLOWED_SPACE_ID = '3624665219';
const CONFIG = 'docs/satori-components/with-and-without-satori.confluence.json';
const PNG_MAGIC = '89504e470d0a1a0a';
/** Display width on the page; a click opens the full-size image. */
const MAX_DISPLAY_WIDTH = 900;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const imagesArg = args.includes('--images') ? args[args.indexOf('--images') + 1] : null;
const IMAGES = resolve(imagesArg ?? join(EVIDENCE_ROOT, 'satori-comparison'));

function refuse(message) {
  console.error(`\nsatori-comparison publish: ${message}\n`);
  process.exit(2);
}

/* ---------------------------------------------------------------------- preconditions ---- */

if (process.env['CI'] || process.env['GITHUB_ACTIONS']) {
  refuse('refusing to run in CI: publishing writes to Confluence with a person’s credentials.');
}

const config = JSON.parse(readFileSync(join(ROOT, CONFIG), 'utf8'));
if (config.source !== DOC) refuse(`${CONFIG} names ${config.source}, not ${DOC}.`);
if (!/^\d+$/.test(config.pageId ?? '')) refuse(`${CONFIG} has no numeric pageId.`);
if (config.spaceId !== ALLOWED_SPACE_ID) {
  refuse(
    `${CONFIG} names space ${config.spaceId}; this command writes only to ${ALLOWED_SPACE_ID}.`,
  );
}

let doc;
try {
  ({ doc } = loadComparison(ROOT));
} catch (error) {
  refuse(error.message);
}

/* ------------------------------------------------------------------------ conversion ---- */

const pngInfo = (file) => {
  const buf = readFileSync(file);
  return {
    png: buf.subarray(0, 8).toString('hex') === PNG_MAGIC,
    width: buf.readUInt32BE(16),
    bytes: buf.length,
  };
};

const referenced = [...new Set(imageReferences(doc).map((r) => r.src))];
const missing = referenced.filter((name) => !existsSync(join(IMAGES, name)));
if (missing.length) {
  refuse(
    `${missing.length} image(s) the page references are not in ${IMAGES}:\n  ${missing.join('\n  ')}\n` +
      'Run `npm run docs:satori-comparison:capture` first.',
  );
}
const local = new Map(referenced.map((name) => [name, pngInfo(join(IMAGES, name))]));
const notPng = referenced.filter((name) => !local.get(name).png);
if (notPng.length) refuse(`not PNG files: ${notPng.join(', ')}`);

const storage = toStorage(doc, {
  image: (img) =>
    imageMacro({ ...img, width: Math.min(local.get(img.src).width, MAX_DISPLAY_WIDTH) }),
});
const leaks = forbiddenReferences(storage);
if (leaks.length) {
  refuse(`the converted page carries ${leaks.map((l) => `${l.what} ("${l.match}")`).join(', ')}.`);
}

const { h2: wantH2, sections } = parseDoc(doc);
const wantH3 = sections.map((s) => s.heading);
const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
})();

console.log(
  `satori-comparison publish: ${DOC} → page ${config.pageId} (space ${config.spaceId})\n` +
    `  ${storage.length} storage chars, ${wantH2.length} sections, ${wantH3.length} component(s), ` +
    `${referenced.length} image(s) from ${IMAGES}`,
);

if (dryRun) {
  const out = join(IMAGES, 'publish-storage.html');
  writeFileSync(out, storage);
  console.log(`  dry run: nothing sent. Storage written to ${out}`);
  process.exit(0);
}

/* ----------------------------------------------------------------------- credentials ---- */

function credential(envName, fileEnv, homeFile) {
  if (process.env[envName]) return process.env[envName].trim();
  const file = (fileEnv && process.env[fileEnv]) || join(homedir(), homeFile);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}
const email = credential('CONFLUENCE_EMAIL', null, '.jira_email');
const token = credential('CONFLUENCE_TOKEN', 'CONFLUENCE_TOKEN_FILE', '.jira_token');
if (!email || !token) {
  refuse(
    'no credentials. Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN (or CONFLUENCE_TOKEN_FILE), ' +
      'or write them to ~/.jira_email and ~/.jira_token.',
  );
}
const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/* -------------------------------------------------------------------------- publish ---- */

const page = await api(`/api/v2/pages/${config.pageId}`);
if (String(page.spaceId) !== ALLOWED_SPACE_ID) {
  refuse(
    `page ${config.pageId} is in space ${page.spaceId}; this command writes only to ${ALLOWED_SPACE_ID}.`,
  );
}
if (page.title !== config.title) {
  refuse(
    `page ${config.pageId} is titled "${page.title}", not "${config.title}" as ${CONFIG} says.`,
  );
}
const before = page.version.number;

if (!verifyOnly) {
  for (const name of referenced) {
    const how = await uploadAttachment({
      base: BASE,
      auth,
      pageId: config.pageId,
      filename: name,
      absPath: join(IMAGES, name),
    });
    console.log(`  ${how.padEnd(8)} ${name}`);
  }
  await api(`/api/v2/pages/${config.pageId}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: config.pageId,
      status: 'current',
      title: config.title,
      body: { representation: 'storage', value: storage },
      version: {
        number: before + 1,
        message: `Published from ${DOC}${commit ? ` at ${commit}` : ''}`,
      },
    }),
  });
  console.log(`  updated  page ${config.pageId}: version ${before} → ${before + 1}`);
}

/* ------------------------------------------------------------------------- read back ---- */

const problems = [];
const fail = (msg) => problems.push(msg);

const after = await api(`/api/v2/pages/${config.pageId}?body-format=storage`);
const body = after.body.storage.value;
const expectVersion = verifyOnly ? before : before + 1;
if (after.version.number !== expectVersion) {
  fail(`version is ${after.version.number}, expected ${expectVersion}`);
}
if (String(after.spaceId) !== ALLOWED_SPACE_ID) fail(`page moved to space ${after.spaceId}`);
if (after.title !== config.title) fail(`title is "${after.title}"`);

const attachments = new Map();
let next = `/rest/api/content/${config.pageId}/child/attachment?limit=100`;
while (next) {
  const r = await api(next);
  for (const a of r.results ?? []) attachments.set(a.title, a);
  next = r._links?.next ?? null;
}
const refs = [...body.matchAll(/ri:filename="([^"]+)"/g)].map((m) => m[1]);
if (JSON.stringify([...new Set(refs)].sort()) !== JSON.stringify([...referenced].sort())) {
  fail(`the page references ${new Set(refs).size} image(s), the Markdown ${referenced.length}`);
}
for (const name of new Set(refs)) {
  const a = attachments.get(name);
  if (!a) {
    fail(`image ${name} is not an attachment of the page`);
    continue;
  }
  const res = await fetch(`${BASE}${a._links.download}`, {
    headers: { Authorization: auth },
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const want = readFileSync(join(IMAGES, name));
  if (!res.ok) fail(`image ${name} does not download (${res.status})`);
  else if (buf.subarray(0, 8).toString('hex') !== PNG_MAGIC) fail(`image ${name} is not a PNG`);
  else if (!verifyOnly && !buf.equals(want)) fail(`image ${name} is not the PNG just uploaded`);
}

const view = (await api(`/api/v2/pages/${config.pageId}?body-format=view`)).body.view.value;
const rendered = (view.match(/<img[^>]*confluence-embedded-image/g) ?? []).length;
if (rendered < refs.length) fail(`Confluence renders ${rendered} image(s) of ${refs.length}`);
if (/data-width="0"|data-height="0"/.test(view)) fail('an image renders with a zero dimension');
if (/class="[^"]*(createlink|unresolved-link)/.test(view)) fail('a link renders unresolved');
if (/&amp;(amp|lt|gt|quot);/.test(view)) fail('a double-escaped entity is visible');
if (body.includes('@@CODE') || /\|\s*-{3,}\s*\|/.test(body)) fail('raw Markdown in the body');

const headings = (level) =>
  [...body.matchAll(new RegExp(`<h${level}>(.*?)</h${level}>`, 'g'))].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&amp;/g, '&'),
  );
if (JSON.stringify(headings(2)) !== JSON.stringify(wantH2)) {
  fail(`sections differ from the Markdown: ${JSON.stringify(headings(2))}`);
}
if (JSON.stringify(headings(3)) !== JSON.stringify(wantH3)) {
  fail(`component sections differ from the Markdown: ${JSON.stringify(headings(3))}`);
}
for (const { what, match } of forbiddenReferences(`${after.title}\n${body}`)) {
  fail(`the published page carries ${what} ("${match}")`);
}

const stale = [...attachments.keys()].filter((name) => !refs.includes(name));

console.log(
  `\n  read back: version ${after.version.number}, ${headings(2).length} sections, ` +
    `${headings(3).length} component sections, ${new Set(refs).size} image(s) — ` +
    `${rendered} rendered, all downloaded and compared`,
);
if (stale.length) {
  console.log(`  attachments no longer referenced (left in place): ${stale.join(', ')}`);
}
console.log(`  ${config.url}`);
if (problems.length) {
  console.error(`\nsatori-comparison publish: FAIL — ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nsatori-comparison publish: pass');
