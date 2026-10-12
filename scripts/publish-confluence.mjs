#!/usr/bin/env node
/**
 * Publish `documentation/` to Confluence.
 *
 * ## Why a script rather than hand-pasting
 *
 * The documentation is authored as Markdown **in the repository**, so it travels with the
 * code, is reviewable in a pull request, and cannot drift silently from what it describes.
 * Confluence is a rendering of that source, not the source itself. A script is what keeps
 * those two facts compatible: re-running it is how the rendering is refreshed, and nothing
 * is ever edited in two places.
 *
 * ## Idempotent by title
 *
 * Each page is looked up by title within the space before writing. Found ⇒ update (with the
 * version bump Confluence requires). Absent ⇒ create. So re-running never duplicates, which
 * is the failure mode a "just POST them all" script has on its second run.
 *
 * ## Credentials
 *
 * From the environment or a file, never from source:
 *   CONFLUENCE_EMAIL      your Atlassian account email
 *   CONFLUENCE_TOKEN      an API token from id.atlassian.com/manage-profile/security/api-tokens
 *   CONFLUENCE_TOKEN_FILE  alternatively, a path to a file containing the token
 *
 * ## Usage
 *
 *   node scripts/publish-confluence.mjs --dry-run     # convert and report, write nothing
 *   node scripts/publish-confluence.mjs --only 30-engineering/02-architecture.md
 *   node scripts/publish-confluence.mjs               # publish everything in MANIFEST.json
 *   node scripts/publish-confluence.mjs --verify      # re-read every published page
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { docLinkTarget } from './confluence-links.mjs';
import { codeMacro, esc, toStorage, uploadAttachment } from './confluence-storage.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS = join(ROOT, 'documentation');
const DIAGRAMS = join(ROOT, 'dist', 'documentation-diagrams');
const BASE = 'https://hyland.atlassian.net/wiki';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const verifyOnly = argv.includes('--verify');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const manifest = JSON.parse(readFileSync(join(DOCS, 'MANIFEST.json'), 'utf8'));

const email = process.env['CONFLUENCE_EMAIL'];
const token =
  process.env['CONFLUENCE_TOKEN'] ??
  (process.env['CONFLUENCE_TOKEN_FILE'] && existsSync(process.env['CONFLUENCE_TOKEN_FILE'])
    ? readFileSync(process.env['CONFLUENCE_TOKEN_FILE'], 'utf8').trim()
    : null);

if (!dryRun && (!email || !token)) {
  console.error(
    'publish-confluence: credentials missing.\n' +
      '  export CONFLUENCE_EMAIL=you@hyland.com\n' +
      '  export CONFLUENCE_TOKEN_FILE=/path/to/token   # or CONFLUENCE_TOKEN\n' +
      '  Create a token at https://id.atlassian.com/manage-profile/security/api-tokens',
  );
  process.exit(2);
}

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${res.status}\n  ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return body;
}

/**
 * Every documentation page, keyed by its path relative to `documentation/`, mapped to its
 * Confluence title.
 *
 * This exists because the first version rewrote **every** relative link to a GitHub blob URL,
 * including links between these pages. On the index that was 50 of 70 links, and each was
 * wrong twice: it sent a Confluence reader to GitHub, and the URL 404'd because the path had
 * lost its `documentation/` prefix. A documentation set whose internal navigation is broken is
 * not a documentation set.
 *
 * A link to another page in the set now becomes an `ac:link` resolved by page **title**, which
 * is how Confluence links pages and survives a page being moved.
 */
const pageTitles = new Map();
{
  const scan = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        scan(full, prefix ? `${prefix}/${entry}` : entry);
      } else if (entry.endsWith('.md')) {
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(full, 'utf8'));
        const title = m && /^title:\s*(.*)$/m.exec(m[1])?.[1]?.trim();
        if (title) pageTitles.set(rel, title.replace(/^["']|["']$/g, ''));
      }
    }
  };
  scan(DOCS, '');
}

/* ------------------------------------------------------------ markdown → storage ---- */

/**
 * A page of this set in storage format: a relative link resolves against its siblings by title,
 * and a Mermaid block becomes an attached diagram. The conversion itself is
 * `confluence-storage.mjs`'s, shared with every other publisher.
 */
function pageStorage(md, relPath, attachments) {
  return toStorage(md, {
    link: (href) =>
      docLinkTarget(href, relPath, {
        pageTitles,
        branch: manifest.branch,
        isDirectory: (p) =>
          statSync(resolve(ROOT, p), { throwIfNoEntry: false })?.isDirectory() ?? false,
      }),
    mermaid: (index, source) => mermaidBlock(relPath, index, source, attachments),
  });
}

/**
 * A Mermaid diagram as a rendered image, with its source in a collapsed panel beneath.
 *
 * Confluence renders Mermaid only with a marketplace app, and no page in this space uses one.
 * The first version of this publisher emitted the Mermaid as a code block instead, reasoning
 * that a diagram which silently fails to render is worse than readable source. The outcome
 * proved that wrong: the Architecture page showed forty lines of `flowchart TD` where a diagram
 * belonged. Neither option was readable.
 *
 * So the image is attached to the page by `scripts/render-mermaid.mjs` and referenced here.
 * The source travels with it in an `expand` macro, so a reader can see how it is built and a
 * maintainer can copy it out — but the Markdown in this repository remains the single source of
 * truth, and re-running the renderer is what refreshes the picture.
 *
 * If the PNG is missing, this falls back to a code block **and records the miss** so the
 * publisher can warn. It never silently ships the worse rendering.
 *
 * `ac:width` is set and `ac:original-*` is NOT. The first version declared
 * `ac:original-height="0" ac:original-width="0"`, which Confluence passed through as
 * `data-height="0" data-width="0"` on the rendered image — a zero-sized picture. Confluence
 * infers the intrinsic size from the attachment; all it needs from us is the display width,
 * and 900px fits a page while remaining clickable to full size.
 */
function mermaidBlock(relPath, index, source, attachments) {
  const slug = relPath
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  const filename = `${slug}-diagram-${index}.png`;
  const abs = join(DIAGRAMS, filename);

  if (!existsSync(abs)) {
    attachments.push({ filename, missing: true });
    return codeMacro('text', source);
  }
  attachments.push({ filename, path: abs, bytes: statSync(abs).size });

  return (
    `<p><ac:image ac:align="center" ac:layout="center" ac:width="900" ` +
    `ac:alt="Diagram: ${esc(relPath)} #${index}">` +
    `<ri:attachment ri:filename="${esc(filename)}" /></ac:image></p>` +
    `<ac:structured-macro ac:name="expand" ac:schema-version="1">` +
    `<ac:parameter ac:name="title">Diagram source (Mermaid)</ac:parameter>` +
    `<ac:rich-text-body>${codeMacro('text', source)}</ac:rich-text-body>` +
    `</ac:structured-macro>`
  );
}

/* ----------------------------------------------------------------------- publishing ---- */

function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  return fm;
}

/** Every page to publish, in tree order: index, then each section's pages. */
function collect() {
  const pages = [];
  pages.push({ file: 'README.md', section: null });
  for (const s of manifest.sections) {
    const dir = join(DOCS, s.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()) {
      pages.push({ file: `${s.dir}/${f}`, section: s.title });
    }
  }
  return only ? pages.filter((p) => p.file === only) : pages;
}

async function findByTitle(title) {
  const q = new URLSearchParams({
    // Backslash FIRST, then quote: escaping the quote first would leave `\` unescaped, so a
    // title ending in a backslash escapes the closing quote and the rest of the title becomes CQL.
    cql:
      `space="${manifest.space}" and type=page and ` +
      `title="${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    limit: '5',
  });
  const r = await api(`/rest/api/content/search?${q}`);
  return (r.results ?? []).find((p) => p.title === title) ?? null;
}

const spaceId = manifest.spaceId ?? null;

async function resolveSpaceId() {
  if (spaceId) return spaceId;
  const r = await api(`/api/v2/spaces?keys=${encodeURIComponent(manifest.space)}`);
  const id = r.results?.[0]?.id;
  if (!id) throw new Error(`Space ${manifest.space} not found`);
  return id;
}

async function upsert(title, storage, parentId, sid) {
  const existing = await findByTitle(title);
  if (existing) {
    const cur = await api(`/api/v2/pages/${existing.id}`);
    await api(`/api/v2/pages/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: existing.id,
        status: 'current',
        title,
        spaceId: sid,
        parentId,
        body: { representation: 'storage', value: storage },
        version: {
          number: (cur.version?.number ?? 1) + 1,
          message: `docs sync @ ${manifest.repoCommit}`,
        },
      }),
    });
    return { id: existing.id, action: 'updated' };
  }
  const created = await api('/api/v2/pages', {
    method: 'POST',
    body: JSON.stringify({
      spaceId: sid,
      status: 'current',
      title,
      parentId,
      body: { representation: 'storage', value: storage },
    }),
  });
  return { id: created.id, action: 'created' };
}

const pages = collect();
console.log(
  `publish-confluence: ${pages.length} page(s)${dryRun ? ' (dry run)' : ''}\n` +
    `  space ${manifest.space} · folder ${manifest.rootFolderId} (${manifest.rootFolderTitle}) · commit ${manifest.repoCommit}\n`,
);

if (dryRun) {
  let total = 0;
  for (const p of pages) {
    const md = readFileSync(join(DOCS, p.file), 'utf8');
    const fm = frontmatter(md);
    const atts = [];
    const storage = pageStorage(md, p.file, atts);
    total += storage.length;
    const missing = atts.filter((a) => a.missing).length;
    console.log(
      `  ${String(storage.length).padStart(7)} chars  ${(fm.title ?? '(NO TITLE)').padEnd(46)} ${p.file}` +
        (atts.length
          ? `  [${atts.length} diagram(s)${missing ? `, ${missing} NOT RENDERED` : ''}]`
          : ''),
    );
    if (!fm.title) console.log(`           ^ MISSING frontmatter title — would be skipped`);
  }
  console.log(`\n  total storage: ${total} chars across ${pages.length} page(s)`);
  process.exit(0);
}

const sid = await resolveSpaceId();
const sectionParents = new Map();
const results = [];
const warnings = [];
let uploaded = 0;

for (const p of pages) {
  const md = readFileSync(join(DOCS, p.file), 'utf8');
  const fm = frontmatter(md);
  if (!fm.title) {
    console.error(`  SKIP ${p.file} — no frontmatter title`);
    continue;
  }

  let parentId = manifest.rootFolderId;
  if (p.section) {
    if (!sectionParents.has(p.section)) {
      const r = await upsert(
        p.section,
        `<p>Section index. Child pages are listed below.</p>` +
          `<ac:structured-macro ac:name="children" ac:schema-version="2" />`,
        manifest.rootFolderId,
        sid,
      );
      sectionParents.set(p.section, r.id);
      console.log(`  ${r.action.padEnd(7)} [section] ${p.section} → ${r.id}`);
    }
    parentId = sectionParents.get(p.section);
  }

  try {
    const atts = [];
    const storage = pageStorage(md, p.file, atts);
    const r = await upsert(fm.title, storage, parentId, sid);
    results.push({ ...p, ...r, title: fm.title });

    let note = '';
    const renderable = atts.filter((a) => !a.missing);
    for (const a of renderable) {
      const how = await uploadAttachment({
        base: BASE,
        auth,
        pageId: r.id,
        filename: a.filename,
        absPath: a.path,
      });
      uploaded += 1;
      void how;
    }
    const missing = atts.filter((a) => a.missing);
    if (renderable.length) note += `  [${renderable.length} diagram(s) attached]`;
    if (missing.length) {
      note += `  [${missing.length} DIAGRAM(S) NOT RENDERED - shown as source]`;
      warnings.push(
        `${p.file}: ${missing.length} diagram(s) fell back to a code block. ` +
          `Run \`node scripts/render-mermaid.mjs\` and publish again.`,
      );
    }
    console.log(`  ${r.action.padEnd(7)} ${fm.title.padEnd(46)} ${r.id}${note}`);
  } catch (error) {
    console.error(`  FAILED  ${fm.title}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(
  `\npublish-confluence: ${results.filter((r) => r.action === 'created').length} created, ` +
    `${results.filter((r) => r.action === 'updated').length} updated, ` +
    `${uploaded} diagram(s) attached`,
);
for (const w of warnings) console.warn(`  WARNING ${w}`);
console.log(`  ${BASE}/spaces/${manifest.space}/folder/${manifest.rootFolderId}`);
