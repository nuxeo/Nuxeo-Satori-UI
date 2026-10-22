#!/usr/bin/env node
/**
 * NXSAT-308 parity fixture — the one Nuxeo data set both halves of the parity evidence run against.
 *
 * The "before" half captured the upstream adf-hx components on 2026-10-08; the "after" half
 * captures the nxs- replacements (NXSAT-644). Both must see the same documents, so this script is
 * the data contract. It lived only in that capture's evidence folder until NXSAT-643 committed it
 * here, next to the steps file, so any worktree can recreate the fixture. The binary assets in
 * `./assets` are reused byte for byte; their digests are the ones the "before" capture recorded.
 *
 * What it builds, under /default-domain/workspaces/<workspace> ("Parity fixtures"):
 *
 *   deep-l1 … deep-l6   a folder chain six levels below the workspace; every level also holds a leaf
 *                       folder ("Deep Ln side") and a File ("Deep Ln file"), so each tree node has
 *                       children to render at depth and each list has mixed content. Level 5 carries
 *                       a long title to exercise breadcrumb truncation.
 *   paged               125 children (Folder / Note / File in a 1:1:3 cycle), created in a seeded
 *                       shuffled order so creation order, title order and modified order all differ.
 *                       50 per page means three server pages: 50, 50, 25.
 *   versions            "Versioned contract" with versions 0.1, 0.2 and 1.0 (live doc 1.0+), and an
 *                       unversioned sibling for contrast.
 *   acl                 a folder whose local ACL holds <user>:AddChildren — a permission outside
 *                       Read / ReadWrite / Everything — next to members:ReadWrite; and a File inside
 *                       it with <user>:WriteVersion.
 *   denied              inheritance blocked, the seeding user :Everything only, so <user> cannot
 *                       read it. Holds one File so an administrator sees content.
 *   media               a PDF, a PNG Picture, a WebM (VP9) Video and an application/octet-stream File
 *                       (the viewer's fallback case).
 *   empty               a folder with no children.
 *
 * It also creates (or resets the password of) the restricted user, in `members`, granted
 * ReadWrite on the workspace. The permission-denied steps sign in as that user.
 *
 * The parity steps read the defaults — workspace `parity`, user `parity-user`. `--workspace` and
 * `--user` exist so the script can be exercised on a server whose `parity` workspace is not yours
 * to replace; a fixture seeded under other names is not one the parity steps can run against.
 * Another workspace gets its own user, `<workspace>-user`, unless `--user` names one.
 *
 * It replaces and deletes only what it created: the workspace's description and the user's
 * `company` carry a marker, and a workspace or user that exists without it is refused (exit 2).
 *
 * Usage (Node 20+, no dependencies):
 *
 *   export NUXEO_URL=http://localhost:18094          # your own Nuxeo; see README.md
 *   export NUXEO_USER=… NUXEO_PASS=…                 # from the environment, never written here
 *   export PARITY_USER_PASS=$(openssl rand -hex 16)  # the restricted user's password for this run
 *   node seed-parity-data.mjs                        # delete and recreate the fixture, then verify it
 *   node seed-parity-data.mjs --check                # verify only, change nothing
 *   node seed-parity-data.mjs --remove               # delete the workspace and the user
 *   node seed-parity-data.mjs --workspace nxsat-643-parity   # user nxsat-643-parity-user
 *
 * Every request carries the Authorization header, and before the first write Nuxeo is asked who
 * it is talking to (`identity-guard.mjs`). A guest-enabled Nuxeo answers a request whose header
 * did not arrive as `Anonymous` rather than refusing it, and a fixture "verified" as the guest
 * verifies nothing (NXSAT-643). The restricted user's sign-in is checked the same way.
 *
 * Refuses the default workspace on a `:8080` server — the conventional port of a developer's own
 * local Nuxeo, which team runs must not seed over. Pass `--workspace` to use a ticket-named one.
 *
 * Writes `seed-manifest.json` (paths, uids, version labels, ACLs, asset digests) to
 * `$AGENTIC_UI_EVIDENCE_DIR/nxsat-308-parity/<workspace>/`, outside the repository, or to
 * `--manifest <file>`. Exit 0 only when every verification passed; 2 when the environment cannot
 * be used (missing variables, unreachable server, wrong identity); 1 when a verification failed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { EVIDENCE_ROOT } from '../../../collect-evidence/evidence-path.mjs';
import { checkFetchIdentity, ME_PATH } from '../../identity-guard.mjs';
import { basicAuthorization, nuxeoCredentialsOrExit } from '../../nuxeo-credentials.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');
const EXIT_PRECONDITION = 2;

// ── Configuration: environment only, no credential defaults ───────────────────────────────────────

const { values: opts } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    remove: { type: 'boolean', default: false },
    workspace: { type: 'string', default: 'parity' },
    // Default: `parity-user` for the default workspace, `<workspace>-user` for any other, so two
    // fixtures under different names never share — and reset each other's — restricted user.
    user: { type: 'string' },
    manifest: { type: 'string' },
  },
});

/** @param {string} message */
function refuse(message) {
  console.error(message);
  process.exit(EXIT_PRECONDITION);
}

// Before anything else: `--check` lifts the `:8080` refusal below, and `--remove` deletes.
if (opts.check && opts.remove) {
  refuse('--check and --remove cannot be combined: --check changes nothing, --remove deletes.');
}

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (!value)
    refuse(`${name} must be set (no default). See the usage block at the top of this file.`);
  return /** @type {string} */ (value);
}

opts.user ??= opts.workspace === 'parity' ? 'parity-user' : `${opts.workspace}-user`;

const NUXEO_URL = required('NUXEO_URL').replace(/\/+$/, '');
const { username: USER, password: PASS } = nuxeoCredentialsOrExit('seed the parity fixture');
const CHECK_ONLY = opts.check === true;
const REMOVE = opts.remove === true;
const PARITY_USER_PASS =
  CHECK_ONLY || REMOVE ? process.env['PARITY_USER_PASS'] : required('PARITY_USER_PASS');

if (
  !/^[a-z0-9][a-z0-9-]*$/.test(opts.workspace) ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.user)
) {
  refuse('--workspace must be a lowercase document name and --user a plain user id.');
}
if (/:8080$/.test(new URL(NUXEO_URL).host) && opts.workspace === 'parity' && !CHECK_ONLY) {
  refuse(
    `Refusing to change /default-domain/workspaces/parity on ${NUXEO_URL}: :8080 is a developer's own ` +
      'local Nuxeo by convention. Start one of your own (README.md), or pass --workspace <ticket-name>.',
  );
}

const API = `${NUXEO_URL}/nuxeo/api/v1`;
const AUTH = basicAuthorization({ username: USER, password: PASS });

// ── The fixture, as data. The steps file asserts against exactly these values. ────────────────────

const ROOT = `/default-domain/workspaces/${opts.workspace}`;
export const FIXTURE = {
  root: ROOT,
  rootTitle: 'Parity fixtures',
  restrictedUser: opts.user,
  deep: {
    levels: 6,
    path: (n) => `${ROOT}/${Array.from({ length: n }, (_, i) => `deep-l${i + 1}`).join('/')}`,
    title: (n) =>
      n === 5
        ? 'Deep L5 with a deliberately long folder title to exercise breadcrumb truncation'
        : `Deep L${n}`,
  },
  paged: { name: 'paged', title: 'Paged folder', count: 125, pageSize: 50 },
  versions: {
    name: 'versions',
    title: 'Versions',
    doc: 'versioned-contract',
    docTitle: 'Versioned contract',
    labels: ['0.1', '0.2', '1.0'],
    unversioned: 'unversioned-memo',
    unversionedTitle: 'Unversioned memo',
  },
  acl: {
    name: 'acl',
    title: 'ACL beyond three levels',
    aces: [
      { username: opts.user, permission: 'AddChildren' },
      { username: 'members', permission: 'ReadWrite' },
    ],
    doc: 'acl-memo',
    docTitle: 'ACL memo',
    docAces: [{ username: opts.user, permission: 'WriteVersion' }],
  },
  denied: {
    name: 'denied',
    title: 'Restricted folder',
    doc: 'secret-memo',
    docTitle: 'Secret memo',
  },
  media: {
    name: 'media',
    title: 'Viewer fixtures',
    pdf: {
      name: 'parity-pdf',
      title: 'Parity PDF',
      file: 'parity.pdf',
      mime: 'application/pdf',
      type: 'File',
    },
    image: {
      name: 'parity-image',
      title: 'Parity image',
      file: 'parity.png',
      mime: 'image/png',
      type: 'Picture',
    },
    // WebM, not MP4: Playwright's bundled Chromium has no H.264 decoder, so an MP4 fixture would
    // fail the after-half for a browser reason rather than a component one.
    video: {
      name: 'parity-video',
      title: 'Parity video',
      file: 'parity.webm',
      mime: 'video/webm',
      type: 'Video',
    },
    unknown: {
      name: 'parity-unknown',
      title: 'Parity unsupported format',
      file: 'parity.bin',
      mime: 'application/octet-stream',
      type: 'File',
    },
  },
  empty: { name: 'empty', title: 'Empty folder' },
  collection: {
    name: 'parity-collection',
    title: 'Parity collection',
    description: 'Test collection for error states',
  },
  pdfText: 'Parity PDF fixture',
  searchToken: 'paritytoken',
};

/** Paged item n (1-based) → its type, in a 1:1:3 Folder / Note / File cycle. */
export function pagedType(n) {
  return ['Folder', 'Note', 'File', 'File', 'File'][(n - 1) % 5];
}

export function pagedTitle(n) {
  return `Paged item ${String(n).padStart(3, '0')}`;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────

async function call(
  method,
  path,
  { json, body, headers = {}, auth = AUTH, ok = [200, 201, 204] } = {},
) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (ok && !ok.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}: ${String(text).slice(0, 300)}`);
  }
  return { status: res.status, data };
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function create(parentPath, type, name, properties = {}) {
  const { data } = await call('POST', `/path${enc(parentPath)}`, {
    json: { 'entity-type': 'document', type, name, properties },
  });
  return data;
}

/** Upload bytes into a new batch and return the blob reference a document property takes. */
async function uploadBytes(fileName, bytes, mime) {
  const { data } = await call('POST', '/upload/new/default');
  const batchId = data.batchId;
  await call('POST', `/upload/${batchId}/0`, {
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': fileName,
      'X-File-Type': mime,
    },
  });
  return { 'upload-batch': batchId, 'upload-fileId': '0' };
}

const upload = (file, mime) => uploadBytes(file, readFileSync(join(ASSETS, file)), mime);

/** The SHA-256 of a document's stored `file:content`, read as raw bytes (`call` reads text). */
async function storedSha256(uid) {
  const res = await fetch(`${API}/id/${uid}/@blob/file:content`, {
    headers: { Authorization: AUTH },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    sha256: res.status === 200 ? createHash('sha256').update(bytes).digest('hex') : null,
  };
}

async function op(uid, operation, params = {}) {
  return call('POST', `/id/${uid}/@op/${operation}`, { json: { params, context: {} } });
}

async function addPermission(uid, users, permission, extra = {}) {
  return op(uid, 'Document.AddPermission', { users, permission, acl: 'local', ...extra });
}

// ── Deterministic assets ──────────────────────────────────────────────────────────────────────────

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 480×270 RGB: eight vertical colour bars over a dark band, so the image is recognisable on screen. */
function makePng() {
  const w = 480;
  const h = 270;
  const bars = [
    [255, 255, 255],
    [255, 221, 0],
    [0, 204, 255],
    [0, 200, 80],
    [230, 0, 180],
    [235, 40, 40],
    [40, 60, 230],
    [20, 20, 20],
  ];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = y > h * 0.75 ? [36, 36, 64] : bars[Math.floor((x / w) * bars.length)];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF whose text layer carries FIXTURE.pdfText, so a viewer check can read it. */
function makePdf() {
  const content =
    `BT /F1 28 Tf 72 700 Td (${FIXTURE.pdfText}) Tj 0 -40 Td /F1 16 Tf ` +
    '(NXSAT-308 parity evidence - page one) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * The committed assets, regenerated only when one is missing. ffmpeg output is not byte-stable
 * across versions, so the committed WebM — not a regeneration — is what makes a replay identical.
 */
function ensureAssets() {
  mkdirSync(ASSETS, { recursive: true });
  const make = {
    'parity.png': makePng,
    'parity.pdf': makePdf,
    'parity.bin': () => Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) & 0xff)),
  };
  for (const [file, fn] of Object.entries(make)) {
    if (!existsSync(join(ASSETS, file))) writeFileSync(join(ASSETS, file), fn());
  }
  const webm = join(ASSETS, 'parity.webm');
  if (!existsSync(webm)) {
    const r = spawnSync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=4:size=640x360:rate=25',
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '300k',
        '-pix_fmt',
        'yuv420p',
        webm,
      ],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error('parity.webm is missing and ffmpeg could not generate it');
  }
  return Object.fromEntries(
    ['parity.pdf', 'parity.png', 'parity.webm', 'parity.bin'].map((f) => {
      const buf = readFileSync(join(ASSETS, f));
      return [f, { bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }];
    }),
  );
}

/** A seeded shuffle (mulberry32), so every replay creates the paged children in the same order. */
function shuffled(n, seed = 308) {
  let a = seed;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Seed ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * What this script writes into everything it creates, and checks before it replaces or deletes
 * anything: a workspace or user without it is someone else's, and is refused, not reset.
 */
const WORKSPACE_MARKER = 'NXSAT-308 parity fixture — recreated by seed-parity-data.mjs';
const USER_MARKER = 'nxsat-308-parity-fixture';

/** Refuse unless the workspace is absent or this script's. @returns {Promise<boolean>} present */
async function requireOwnWorkspace() {
  const ws = await call('GET', `/path${enc(FIXTURE.root)}`, {
    headers: { properties: 'dublincore' },
    ok: null,
  });
  if (ws.status === 404) return false;
  if (ws.status !== 200) refuse(`${FIXTURE.root} answered ${ws.status}; not touching it.`);
  if (ws.data?.properties?.['dc:description'] !== WORKSPACE_MARKER) {
    refuse(
      `${FIXTURE.root} exists and was not created by this script (its description is not the ` +
        'fixture marker). Not replacing or deleting it; pass --workspace <another-name>.',
    );
  }
  return true;
}

/** Refuse unless the user is absent or this script's. @returns {Promise<boolean>} present */
async function requireOwnUser() {
  const id = FIXTURE.restrictedUser;
  const existing = await call('GET', `/user/${id}`, { ok: null });
  if (existing.status === 404) return false;
  if (existing.status !== 200) refuse(`user ${id} answered ${existing.status}; not touching it.`);
  if (existing.data?.properties?.company !== USER_MARKER) {
    refuse(
      `user ${id} exists and was not created by this script (company is not "${USER_MARKER}"). ` +
        'Not resetting or deleting it; pass --user <another-id>.',
    );
  }
  return true;
}

async function ensureUser() {
  const id = FIXTURE.restrictedUser;
  const properties = {
    username: id,
    firstName: 'Parity',
    lastName: 'User',
    company: USER_MARKER,
    password: PARITY_USER_PASS,
    groups: ['members'],
  };
  if (await requireOwnUser()) {
    await call('PUT', `/user/${id}`, { json: { 'entity-type': 'user', id, properties } });
  } else {
    await call('POST', '/user', { json: { 'entity-type': 'user', id, properties } });
  }
}

async function remove() {
  // Both checked before either is deleted, so a refusal leaves everything as it was.
  await requireOwnWorkspace();
  await requireOwnUser();
  const gone = await call('DELETE', `/path${enc(FIXTURE.root)}`, { ok: [200, 204, 404] });
  console.log(gone.status === 404 ? `${FIXTURE.root} was not there` : `deleted ${FIXTURE.root}`);
  const user = await call('DELETE', `/user/${FIXTURE.restrictedUser}`, { ok: [200, 204, 404] });
  console.log(
    user.status === 404
      ? `user ${FIXTURE.restrictedUser} was not there`
      : `deleted user ${FIXTURE.restrictedUser}`,
  );
}

async function seed() {
  const root = FIXTURE.root;
  await requireOwnWorkspace();
  await requireOwnUser();
  const gone = await call('DELETE', `/path${enc(root)}`, { ok: [200, 204, 404] });
  if (gone.status !== 404) console.log(`deleted the previous ${root}`);

  await ensureUser();
  const rootDoc = await create('/default-domain/workspaces', 'Workspace', opts.workspace, {
    'dc:title': FIXTURE.rootTitle,
    'dc:description': WORKSPACE_MARKER,
  });
  await addPermission(rootDoc.uid, [FIXTURE.restrictedUser], 'ReadWrite');

  // Deep chain.
  let parent = root;
  for (let n = 1; n <= FIXTURE.deep.levels; n++) {
    await create(parent, 'Folder', `deep-l${n}`, { 'dc:title': FIXTURE.deep.title(n) });
    const here = `${parent}/deep-l${n}`;
    await create(here, 'Folder', `deep-l${n}-side`, { 'dc:title': `Deep L${n} side` });
    await create(here, 'File', `deep-l${n}-file`, {
      'dc:title': `Deep L${n} file`,
      'dc:description': `deep level ${n}`,
    });
    parent = here;
  }

  // Paged folder.
  const pagedPath = `${root}/${FIXTURE.paged.name}`;
  await create(root, 'Folder', FIXTURE.paged.name, { 'dc:title': FIXTURE.paged.title });
  for (const n of shuffled(FIXTURE.paged.count)) {
    const type = pagedType(n);
    const properties = {
      'dc:title': pagedTitle(n),
      'dc:description': `${FIXTURE.searchToken} paged item ${n}`,
      ...(type === 'Note'
        ? { 'note:note': `Paged note ${n}`, 'note:mime_type': 'text/plain' }
        : {}),
    };
    await create(pagedPath, type, `paged-${String(n).padStart(3, '0')}`, properties);
  }

  // Versions. The contract's text is uploaded from memory, so a run writes nothing into the repo.
  const versionsPath = `${root}/${FIXTURE.versions.name}`;
  await create(root, 'Folder', FIXTURE.versions.name, { 'dc:title': FIXTURE.versions.title });
  const contract = await create(versionsPath, 'File', FIXTURE.versions.doc, {
    'dc:title': FIXTURE.versions.docTitle,
    'dc:description': 'draft',
    'file:content': await uploadBytes(
      'versioned-contract.txt',
      Buffer.from('Versioned contract — live text\n', 'utf8'),
      'text/plain',
    ),
  });
  const steps = [
    ['minor', 'first draft', 'second draft'],
    ['minor', 'second draft', 'approved wording'],
    ['major', 'approved', 'edited after approval'],
  ];
  for (const [version, comment, nextDescription] of steps) {
    await op(contract.uid, 'Document.CheckIn', { version, comment });
    await call('PUT', `/id/${contract.uid}`, {
      json: { 'entity-type': 'document', properties: { 'dc:description': nextDescription } },
    });
  }
  await create(versionsPath, 'File', FIXTURE.versions.unversioned, {
    'dc:title': FIXTURE.versions.unversionedTitle,
  });

  // ACL beyond the three levels.
  const aclPath = `${root}/${FIXTURE.acl.name}`;
  const aclFolder = await create(root, 'Folder', FIXTURE.acl.name, {
    'dc:title': FIXTURE.acl.title,
  });
  for (const ace of FIXTURE.acl.aces)
    await addPermission(aclFolder.uid, [ace.username], ace.permission);
  const aclDoc = await create(aclPath, 'File', FIXTURE.acl.doc, {
    'dc:title': FIXTURE.acl.docTitle,
  });
  for (const ace of FIXTURE.acl.docAces)
    await addPermission(aclDoc.uid, [ace.username], ace.permission);

  // Permission-denied folder.
  const deniedPath = `${root}/${FIXTURE.denied.name}`;
  const denied = await create(root, 'Folder', FIXTURE.denied.name, {
    'dc:title': FIXTURE.denied.title,
  });
  await create(deniedPath, 'File', FIXTURE.denied.doc, { 'dc:title': FIXTURE.denied.docTitle });
  await addPermission(denied.uid, [USER], 'Everything', { blockInheritance: true });

  // Viewer fixtures.
  const mediaPath = `${root}/${FIXTURE.media.name}`;
  await create(root, 'Folder', FIXTURE.media.name, { 'dc:title': FIXTURE.media.title });
  for (const key of ['pdf', 'image', 'video', 'unknown']) {
    const m = FIXTURE.media[key];
    await create(mediaPath, m.type, m.name, {
      'dc:title': m.title,
      'file:content': await upload(m.file, m.mime),
    });
  }

  await create(root, 'Folder', FIXTURE.empty.name, { 'dc:title': FIXTURE.empty.title });

  // Collection for error state testing.
  const collectionResp = await call('POST', '/automation/Collection.Create', {
    json: {
      params: {
        name: FIXTURE.collection.title,
        description: FIXTURE.collection.description,
      },
      context: {},
    },
  });
  const collectionUid = collectionResp.data?.uid;
  if (!collectionUid) throw new Error('Collection.Create did not return a uid');
  // Add one document to the collection so it has members to list
  const firstPaged = await call('GET', `/path${enc(`${pagedPath}/paged-001`)}`);
  if (firstPaged.data?.uid) {
    await op(firstPaged.data.uid, 'Document.AddToCollection', { collection: collectionUid });
  }
}

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────

async function verify(assets) {
  const failures = [];
  const expect = (name, condition, detail) => {
    console.log(`  [${condition ? 'pass' : 'FAIL'}] ${name}${condition ? '' : ` — ${detail}`}`);
    if (!condition) failures.push(name);
  };
  const get = (path, headers = {}) => call('GET', path, { headers, ok: null });
  const byPath = (p, headers) => get(`/path${enc(p)}`, headers);
  const manifest = {
    nuxeoUrl: NUXEO_URL,
    root: FIXTURE.root,
    generatedAt: new Date().toISOString(),
    docs: {},
  };

  const root = await byPath(FIXTURE.root);
  expect('workspace exists', root.status === 200, `HTTP ${root.status}`);
  manifest.docs.root = root.data?.uid;

  for (let n = 1; n <= FIXTURE.deep.levels; n++) {
    const d = await byPath(FIXTURE.deep.path(n));
    expect(
      `deep level ${n} exists with its title`,
      d.status === 200 && d.data?.title === FIXTURE.deep.title(n),
      `HTTP ${d.status} ${d.data?.title}`,
    );
    manifest.docs[`deep-l${n}`] = {
      uid: d.data?.uid,
      path: FIXTURE.deep.path(n),
      title: d.data?.title,
    };
    const kids = await get(`/path${enc(FIXTURE.deep.path(n))}/@children?pageSize=50`);
    const titles = (kids.data?.entries ?? []).map((e) => e.title).sort();
    const want = [
      `Deep L${n} file`,
      `Deep L${n} side`,
      ...(n < FIXTURE.deep.levels ? [FIXTURE.deep.title(n + 1)] : []),
    ].sort();
    expect(
      `deep level ${n} has exactly its children`,
      JSON.stringify(titles) === JSON.stringify(want),
      JSON.stringify(titles),
    );
  }

  const pagedPath = `${FIXTURE.root}/${FIXTURE.paged.name}`;
  const paged = await get(`/path${enc(pagedPath)}/@children?pageSize=500`);
  const entries = paged.data?.entries ?? [];
  expect(
    `paged folder has ${FIXTURE.paged.count} children`,
    entries.length === FIXTURE.paged.count,
    `${entries.length}`,
  );
  const typeCounts = entries.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {});
  expect(
    'paged children are Folder 25 / Note 25 / File 75',
    typeCounts.Folder === 25 && typeCounts.Note === 25 && typeCounts.File === 75,
    JSON.stringify(typeCounts),
  );
  manifest.docs.paged = {
    path: pagedPath,
    uid: (await byPath(pagedPath)).data?.uid,
    count: entries.length,
    typeCounts,
  };

  const contractPath = `${FIXTURE.root}/${FIXTURE.versions.name}/${FIXTURE.versions.doc}`;
  const contract = await byPath(contractPath, {
    properties: '*',
    'fetch-document': 'versionLabel',
  });
  const versions = await call('POST', `/id/${contract.data?.uid}/@op/Document.GetVersions`, {
    json: { params: {}, context: {} },
    headers: { 'fetch-document': 'versionLabel' },
    ok: null,
  });
  const labels = (versions.data?.entries ?? []).map((v) => v.versionLabel).sort();
  expect(
    'versioned contract has versions 0.1, 0.2, 1.0',
    JSON.stringify(labels) === JSON.stringify(FIXTURE.versions.labels),
    JSON.stringify(labels),
  );
  expect(
    'versioned contract live document is 1.0+ (checked out)',
    contract.data?.versionLabel === '1.0+',
    contract.data?.versionLabel,
  );
  manifest.docs.versionedContract = {
    uid: contract.data?.uid,
    path: contractPath,
    liveLabel: contract.data?.versionLabel,
    versions: labels,
  };

  const aclPath = `${FIXTURE.root}/${FIXTURE.acl.name}`;
  const acl = await get(`/path${enc(aclPath)}/@acl`);
  const local = (acl.data?.acl ?? []).find((a) => a.name === 'local')?.ace ?? [];
  for (const want of FIXTURE.acl.aces) {
    expect(
      `acl folder grants ${want.username}:${want.permission} locally`,
      local.some(
        (a) => a.username === want.username && a.permission === want.permission && a.granted,
      ),
      JSON.stringify(local.map((a) => [a.username, a.permission])),
    );
  }
  const aclDocPath = `${aclPath}/${FIXTURE.acl.doc}`;
  const aclDoc = await get(`/path${enc(aclDocPath)}/@acl`);
  const docLocal = (aclDoc.data?.acl ?? []).find((a) => a.name === 'local')?.ace ?? [];
  expect(
    `acl memo grants ${FIXTURE.restrictedUser}:WriteVersion locally`,
    docLocal.some((a) => a.username === FIXTURE.restrictedUser && a.permission === 'WriteVersion'),
    JSON.stringify(docLocal.map((a) => [a.username, a.permission])),
  );
  manifest.docs.acl = {
    path: aclPath,
    uid: (await byPath(aclPath)).data?.uid,
    local: local.map((a) => `${a.username}:${a.permission}`),
  };
  manifest.docs.aclMemo = {
    path: aclDocPath,
    uid: (await byPath(aclDocPath)).data?.uid,
    local: docLocal.map((a) => `${a.username}:${a.permission}`),
  };

  const deniedPath = `${FIXTURE.root}/${FIXTURE.denied.name}`;
  const deniedAcl = await get(`/path${enc(deniedPath)}/@acl`);
  const deniedLocal = (deniedAcl.data?.acl ?? []).find((a) => a.name === 'local')?.ace ?? [];
  const blocks = deniedLocal.some(
    (a) => a.username === 'Everyone' && a.permission === 'Everything' && a.granted === false,
  );
  expect(
    'restricted folder blocks inheritance',
    blocks,
    JSON.stringify(deniedLocal.map((a) => [a.username, a.permission, a.granted])),
  );
  manifest.docs.denied = { path: deniedPath, uid: (await byPath(deniedPath)).data?.uid };
  if (PARITY_USER_PASS) {
    const asUser = basicAuthorization({
      username: FIXTURE.restrictedUser,
      password: PARITY_USER_PASS,
    });
    // By name, not by status: a guest-enabled Nuxeo answers a bad password 401, but a request
    // whose header was lost 200 as `Anonymous` — which would also be refused the folder below.
    const who = await checkFetchIdentity(`${NUXEO_URL}${ME_PATH}`, asUser, FIXTURE.restrictedUser);
    expect(
      `${FIXTURE.restrictedUser} signs in as itself with PARITY_USER_PASS`,
      who.ok,
      who.problem,
    );
    const refused = await call('GET', `/path${enc(deniedPath)}`, { auth: asUser, ok: null });
    const allowed = await call('GET', `/path${enc(FIXTURE.root)}`, { auth: asUser, ok: null });
    expect(
      `${FIXTURE.restrictedUser} can read the workspace`,
      who.ok && allowed.status === 200,
      `HTTP ${allowed.status}`,
    );
    expect(
      `${FIXTURE.restrictedUser} is refused the restricted folder`,
      who.ok && (refused.status === 403 || refused.status === 404),
      `HTTP ${refused.status}`,
    );
    manifest.deniedStatusForParityUser = refused.status;
  } else {
    console.log(`  [skip] ${FIXTURE.restrictedUser} checks: PARITY_USER_PASS not set`);
  }

  for (const key of ['pdf', 'image', 'video', 'unknown']) {
    const m = FIXTURE.media[key];
    const p = `${FIXTURE.root}/${FIXTURE.media.name}/${m.name}`;
    const d = await byPath(p, { properties: '*' });
    const blob = d.data?.properties?.['file:content'];
    expect(
      `${key} fixture is a ${m.type} holding ${m.file} (${m.mime})`,
      d.data?.type === m.type && blob?.name === m.file && blob?.['mime-type'] === m.mime,
      `${d.data?.type} ${blob?.name} ${blob?.['mime-type']}`,
    );
    // The bytes too: metadata alone passes a blob replaced under the same name and type, while
    // `manifest.assets` records the local file's digest as if the server held it.
    const stored = d.data?.uid ? await storedSha256(d.data.uid) : { status: 0, sha256: null };
    const want = assets[m.file].sha256;
    expect(
      `${key} fixture's stored bytes are ${m.file}'s (sha256)`,
      stored.status === 200 && stored.sha256 === want,
      `HTTP ${stored.status}, sha256 ${stored.sha256} where ${m.file} is ${want}`,
    );
    manifest.docs[`media-${key}`] = {
      uid: d.data?.uid,
      path: p,
      type: d.data?.type,
      blob: blob?.name,
      mime: blob?.['mime-type'],
      digest: blob?.digest,
      sha256: stored.sha256,
    };
  }

  const emptyPath = `${FIXTURE.root}/${FIXTURE.empty.name}`;
  const empty = await get(`/path${enc(emptyPath)}/@children`);
  expect(
    'empty folder has no children',
    (empty.data?.entries ?? []).length === 0 && empty.status === 200,
    `HTTP ${empty.status}`,
  );
  manifest.docs.empty = { path: emptyPath, uid: (await byPath(emptyPath)).data?.uid };

  // Collection verification.
  // Find the collection by title through User.GetCollections
  const userColls = await call('POST', '/automation/User.GetCollections', {
    json: { params: { searchTerm: '' }, context: {} },
    ok: null,
  });
  const coll = (userColls.data?.entries ?? []).find((e) => e.title === FIXTURE.collection.title);
  expect(
    'collection was created',
    userColls.status === 200 && Boolean(coll),
    `HTTP ${userColls.status}, found: ${Boolean(coll)}`,
  );
  if (coll?.uid) {
    // Get members using GET with queryParams as the app does
    const membersResp = await call(
      'GET',
      `/search/pp/default_content_collection/execute?queryParams=${encodeURIComponent(coll.uid)}`,
      { ok: null },
    );
    const collEntries = membersResp.data?.entries ?? [];
    expect(
      'collection has 1 member',
      membersResp.status === 200 && collEntries.length === 1,
      `HTTP ${membersResp.status}, ${collEntries.length} members`,
    );
    const collDoc = collEntries[0];
    expect(
      'collection member is paged-001',
      collDoc?.title === 'Paged item 001',
      `member title: ${collDoc?.title}`,
    );
    manifest.docs.collection = {
      uid: coll.uid,
      title: FIXTURE.collection.title,
      memberCount: collEntries.length,
      firstMember: collDoc?.title,
    };
  } else {
    manifest.docs.collection = { found: false };
  }

  manifest.assets = assets;
  manifest.verification = { failures };
  const out = opts.manifest
    ? resolve(opts.manifest)
    : resolve(EVIDENCE_ROOT, 'nxsat-308-parity', opts.workspace, 'seed-manifest.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest  ${out}`);
  return failures;
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────

/** Ask Nuxeo who this script is, or stop: every write and every read below assumes it is USER. */
async function requireIdentity(when) {
  const who = await checkFetchIdentity(`${NUXEO_URL}${ME_PATH}`, AUTH, USER);
  if (!who.ok) {
    refuse(
      `identity guard ${when}: ${who.problem}. Nothing was ${when === 'before seeding' ? 'changed' : 'certified'}; ` +
        'a fixture written or verified as the wrong user is not the fixture.',
    );
  }
  console.log(`identity  ${who.user} (${when})`);
}

const status = await call('GET', `${NUXEO_URL}/nuxeo/runningstatus`, { ok: null }).catch(() => ({
  status: 0,
}));
if (status.status !== 200) {
  refuse(
    `${NUXEO_URL}/nuxeo/runningstatus answered ${status.status}; start your Nuxeo first (README.md).`,
  );
}
await requireIdentity(
  CHECK_ONLY ? 'before checking' : REMOVE ? 'before removing' : 'before seeding',
);

if (REMOVE) {
  await remove();
  process.exit(0);
}

const assets = ensureAssets();
if (!CHECK_ONLY) {
  console.log(`seeding ${FIXTURE.root} on ${NUXEO_URL}`);
  const t0 = Date.now();
  await seed();
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log('verifying');
const failures = await verify(assets);
await requireIdentity('after verifying');
console.log(failures.length ? `\n${failures.length} verification(s) FAILED` : '\nfixture verified');
process.exit(failures.length ? 1 : 0);
