/**
 * A stand-in for the parts of a Nuxeo server the media kit's seed and its demo's steps file call,
 * on the loopback interface: documents by path and id, their permissions, batch uploads, the kit's
 * page providers, a delivery package decided as `nuxeo-agentic-assets` 0.5.0 decides one, and, since
 * the kit's 0.2.0, a version's files downloaded and marked as its watermark says.
 *
 * **What it is for.** No server has the add-on 0.5.0 or this kit: the local Nuxeo is read-only and
 * has the add-on's 0.1.0. So the seed's controls (`seed.selftest.mjs`) and phase 9's demo step 1
 * (`scripts/beta-harness/steps/media-delivery.mjs`) run here. What the server decides is held by the
 * add-on's own tests, in Nuxeo's test framework (`MediaDeliveryTest`): this stand-in answers as they
 * hold it, so that the demo's script and its data are checked, not the server.
 *
 * **The delivery decision, as the add-on's `Deliveries` and `AssetRights` make it,** from the kit's
 * own rights policy, read from `bundle/OSGI-INF/media-demo-rights.xml`: the version must be one the
 * filer may read, live; each file its `<delivery>` lists is decided for the delivery's territory by
 * its rule's channel, in this order: the version's rights not ended, its channels holding the
 * channel, its territories holding the territory, a window of its film open there for the channel
 * today; and the file must be there. Refused whole, the answer is 403 with the add-on's message and
 * nothing is made; delivered, the server's record of it is written over what the filer wrote.
 *
 * **The watermark, as the add-on 0.5.0 applies the policy's `<watermark>`** (its `Watermark`,
 * `AssetRights.watermarked`, `WatermarkedFiles` and `Deliveries`):
 *
 * - **a delivery** marks each file its `<deliveries>` names, for the distributor, the text the
 *   policy's with its names filled in, and records `watermarked`, `watermarkedFor`, `watermark` and
 *   the file marked, `watermarkedFile`; a file it names that is not a picture refuses the delivery
 *   whole, `watermark-unavailable`. The others are recorded `watermarked: false`, and not held;
 * - **a download,** at `@blob` or `/nxfile/`, is decided as the add-on decides one, which names no
 *   territory, then held to the watermark: a use it marks is refused unmarked, 403
 *   `watermark-required`, to anyone in none of its `<except>` groups, an administrator included;
 * - **`Asset.GetWatermarked`** serves a use the watermark marks, for its reader, once its rights
 *   allow it. The file marked is not the server's: where the add-on draws the text across the
 *   picture, the stand-in answers an 8 by 8 grey JPEG holding the text in a comment, so that what
 *   the demo checks of it, a JPEG apart from the file and its text naming its reader, can be read.
 *
 * Every request is kept (`requests`), and every credential is checked: Basic, against `users`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_FILE = join(KIT, 'bundle', 'OSGI-INF', 'media-demo-rights.xml');

/** The attributes of each `<name .../>` element in `xml`, in order. */
function elements(xml, name) {
  const found = [];
  for (const [, attributes] of xml.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'g'))) {
    found.push(
      Object.fromEntries(
        [...attributes.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
      ),
    );
  }
  return found;
}

/**
 * `xml` without its comments, each cut out from its `<!--` to the end of its `-->`, so that a
 * policy element named in a comment is not read as one. An unclosed comment runs to the end, as an
 * XML parser would refuse it. Not a sanitiser: the file is the kit's own, and nothing of it is
 * written anywhere.
 */
function withoutComments(xml) {
  let text = '';
  let at = 0;
  for (let open = xml.indexOf('<!--', at); open !== -1; open = xml.indexOf('<!--', at)) {
    text += xml.slice(at, open);
    const close = xml.indexOf('-->', open + 4);
    at = close === -1 ? xml.length : close + 3;
  }
  return text + xml.slice(at);
}

/** The kit's policy, as the stand-in decides by it: the add-on reads the same file through XMap. */
export function kitPolicy(xml = readFileSync(POLICY_FILE, 'utf8')) {
  const text = withoutComments(xml);
  const delivery = /<delivery>([\s\S]*?)<\/delivery>/.exec(text)?.[1] ?? '';
  const marked = /<watermark\b[\s\S]*?<\/watermark>/.exec(text)?.[0] ?? null;
  const outside = text
    .replace(/<delivery>[\s\S]*?<\/delivery>/, '')
    .replace(/<watermark\b[\s\S]*?<\/watermark>/, '');
  const original = elements(outside, 'original')[0];
  const rules = new Map();
  /** The uses the policy marks as previews, served whatever the rights. */
  const previews = new Set();
  const rule = (key, element) => {
    rules.set(key, element.channel ?? null);
    if (element.preview === 'true') previews.add(key);
  };
  if (original) rule('original', original);
  for (const blob of elements(outside, 'blob')) rule(`blob ${blob.xpath}`, blob);
  for (const rendition of elements(outside, 'rendition'))
    rule(`rendition ${rendition.name}`, rendition);
  const files = [
    ...elements(delivery, 'original').map(() => ({ use: 'original', name: null })),
    ...elements(delivery, 'blob').map((blob) => ({ use: 'blob', name: blob.xpath })),
  ];
  return {
    rightsEnd: elements(outside, 'rightsEnd')[0]?.xpath,
    channels: elements(outside, 'channels')[0]?.xpath,
    territories: elements(outside, 'territories')[0]?.xpath,
    windows: elements(outside, 'windows')[0]?.xpath,
    windowsDocument: elements(outside, 'windows')[0]?.document,
    windowsDocumentType: elements(outside, 'windows')[0]?.type,
    originalXpath: original?.xpath ?? 'file:content',
    rules,
    previews,
    delivery: files,
    watermark: marked === null ? null : watermarkOf(marked),
  };
}

/**
 * The policy's `<watermark>`: its text, its placement, each occasion it marks with the uses it names
 * there, `null` for every use of it, and the groups it exempts from previews and downloads.
 */
function watermarkOf(xml) {
  const head = elements(xml, 'watermark')[0] ?? {};
  const occasion = (name) => {
    const block = new RegExp(`<${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${name}>)`).exec(xml);
    if (!block) return undefined;
    const inner = block[1] ?? '';
    const uses = [
      ...elements(inner, 'original').map(() => 'original'),
      ...elements(inner, 'blob').map((blob) => `blob ${blob.xpath}`),
      ...elements(inner, 'rendition').map((rendition) => `rendition ${rendition.name}`),
    ];
    return uses.length === 0 ? null : uses;
  };
  return {
    text: head.text ?? '',
    placement: head.placement ?? 'tiled',
    previews: occasion('previews'),
    downloads: occasion('downloads'),
    deliveries: occasion('deliveries'),
    except: elements(xml, 'except').map((each) => each.group),
  };
}

/** Whether the watermark marks `key` on `occasion`: `previews`, `downloads` or `deliveries`. */
function marks(watermark, occasion, key) {
  const uses = watermark?.[occasion];
  return uses !== undefined && (uses === null || uses.includes(key));
}

/** The watermark's text, its names filled in, as `Watermark.text` fills them. */
export function fillWatermark(watermark, { recipient, user, day, territory }) {
  const values = { recipient, user, day, territory };
  return watermark.text.replace(/\{(recipient|user|day|territory)\}/g, (_, name) =>
    String(values[name] ?? ''),
  );
}

/**
 * The stand-in's marked picture: an 8 by 8 grey baseline JPEG holding `text` in a comment. Not the
 * server's mark, which the add-on draws across the picture and keeps no comment of; only something a
 * reader can tell from the file, and whose text can be read back.
 */
export function standInJpeg(text) {
  const segment = (marker, bytes) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, Buffer.from(bytes)]);
  };
  const oneCode = (tableClass) => [tableClass, 1, ...new Array(15).fill(0), 0];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xfe, Buffer.from(text, 'utf8')),
    segment(0xdb, [0, ...new Array(64).fill(1)]),
    segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]),
    segment(0xc4, oneCode(0x00)),
    segment(0xc4, oneCode(0x10)),
    segment(0xda, [1, 1, 0x00, 0, 63, 0]),
    // One block: its DC difference 0 and its end of block, each the one code, 0, then padding.
    Buffer.from([0x3f, 0xff, 0xd9]),
  ]);
}

/** The text a stand-in JPEG holds in its comment, or `null` for none. */
export function jpegComment(bytes) {
  for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker === 0xfe) return bytes.subarray(at + 4, at + 2 + length).toString('utf8');
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

/** The blob at a simple `files:files/<n>/file` or `<prefix>:<name>` xpath of `properties`. */
function blobAt(properties, xpath) {
  const attachment = /^files:files\/(\d+)\/file$/.exec(xpath);
  if (attachment) return properties['files:files']?.[Number(attachment[1])]?.file ?? null;
  return properties[xpath] ?? null;
}

const asList = (value) =>
  Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
const dayOf = (value) => (typeof value === 'string' ? value.slice(0, 10) : null);

/**
 * What the add-on decides for a delivery of `version` to `territory` on `today`: `{ refused }` for
 * the package's own refusal, or `{ files }`, each `{ use, name, channel, reason, blob }`, with
 * `reason` `null` for a file delivered.
 */
export function decideDelivery(policy, version, film, territory, today) {
  if (!policy.delivery.length) return { refused: 'not-cleared' };
  const properties = version.properties;
  let held;
  if (policy.windowsDocument) {
    // As AssetRightsComponent.windowsOf: of the policy's type, there, live and not in the trash.
    if (
      !policy.windowsDocumentType ||
      !film ||
      film.trashed ||
      film.type !== policy.windowsDocumentType
    )
      return { refused: 'policy-error' };
    held = asList(film.properties[policy.windows]);
  } else {
    held = asList(properties[policy.windows]);
  }
  // As AssetFacts.windows: a window with no territory, channel or first day, or one that ends
  // before it opens, cannot be read, and the rights refuse.
  const windows = [];
  for (const window of held) {
    const territoryOf = typeof window?.territory === 'string' ? window.territory.trim() : '';
    const channelOf = typeof window?.channel === 'string' ? window.channel.trim() : '';
    const from = dayOf(window?.from);
    const until = window?.until == null ? null : dayOf(window.until);
    if (!territoryOf || !channelOf || !from || (window?.until != null && (!until || until < from)))
      return { refused: 'policy-error' };
    windows.push({ territory: territoryOf, channel: channelOf, from, until });
  }
  const end = dayOf(properties[policy.rightsEnd]);
  const channels = asList(properties[policy.channels]).map((each) => String(each).trim());
  const territories = asList(properties[policy.territories]).map((each) => String(each).trim());
  const files = policy.delivery.map(({ use, name }) => {
    const channel = policy.rules.get(name === null ? use : `${use} ${name}`) ?? null;
    const decided = (reason) => ({ use, name, channel, reason, blob: null });
    if (channel === null) return decided('not-cleared');
    if (end !== null && today > end) return decided('rights-ended');
    if (!channels.includes(channel)) return decided('channel-not-covered');
    if (!territories.includes(territory)) return decided('territory-not-covered');
    const open = windows.some(
      (window) =>
        window.territory === territory &&
        window.channel === channel &&
        window.from <= today &&
        (window.until === null || today <= window.until),
    );
    if (!open) return decided('outside-window');
    const blob = blobAt(properties, use === 'original' ? policy.originalXpath : name);
    if (!blob?.digest) return decided('no-such-file');
    return { use, name, channel, reason: null, blob };
  });
  return { files };
}

/**
 * What the add-on decides for a download of the use `key` of `version` on `today`, which names no
 * territory, before its watermark: `null` when served, else the reason. A preview is served whatever
 * the rights; a use with a channel while the rights run, the version's channels hold it, and a
 * window of its film for it is open in any territory the version may go to.
 */
export function decideDownload(policy, version, film, key, today) {
  if (!policy.rules.has(key)) return 'not-cleared';
  if (policy.previews.has(key)) return null;
  const channel = policy.rules.get(key);
  if (channel === null) return 'not-cleared';
  const properties = version.properties;
  if (policy.windowsDocument && (!film || film.trashed || film.type !== policy.windowsDocumentType))
    return 'policy-error';
  const windows = asList(
    policy.windowsDocument ? film.properties[policy.windows] : properties[policy.windows],
  );
  const end = dayOf(properties[policy.rightsEnd]);
  if (end !== null && today > end) return 'rights-ended';
  if (!asList(properties[policy.channels]).includes(channel)) return 'channel-not-covered';
  const territories = asList(properties[policy.territories]);
  if (territories.length === 0) return 'territory-not-covered';
  const open = windows.some(
    (window) =>
      territories.includes(window?.territory) &&
      window?.channel === channel &&
      dayOf(window.from) <= today &&
      (window.until === null || window.until === undefined || today <= dayOf(window.until)),
  );
  return open ? null : 'outside-window';
}

/** Basic credentials for `user`, as a client sends them. */
export const basic = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/**
 * Starts the stand-in. `users` maps each user name to `{ password, administrator, groups }`;
 * `today` is the server's day, `yyyy-MM-dd` in UTC; `types` the document types it has.
 */
export async function startStandIn({
  users,
  today,
  types = ['Workspace', 'Folder', 'Film', 'FilmVersion', 'MediaDelivery'],
  policy = kitPolicy(),
}) {
  const docs = new Map();
  const batches = new Map();
  /** Each stored file's bytes, by its digest, as a blob store keeps one file per content. */
  const contents = new Map();
  const requests = [];
  let next = 1;
  const uid = () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
  const add = (path, type, properties = {}) => {
    const doc = {
      'entity-type': 'document',
      uid: uid(),
      path,
      type,
      properties,
      acl: [],
      trashed: false,
    };
    docs.set(path, doc);
    return doc;
  };
  add('/', 'Root');
  add('/default-domain', 'Domain');
  add('/default-domain/workspaces', 'WorkspaceRoot');
  const byUid = (id) => [...docs.values()].find((doc) => doc.uid === id) ?? null;
  const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
  const view = (doc) => ({
    'entity-type': 'document',
    uid: doc.uid,
    path: doc.path,
    type: doc.type,
    title: doc.properties['dc:title'] ?? doc.path.split('/').pop(),
    isTrashed: doc.trashed,
    properties: doc.properties,
  });

  /** Whether `user` holds `permission` on `doc`, by a grant on it or a folder above it, to them or a group. */
  const holds = (user, doc, permission) => {
    if (users[user]?.administrator) return true;
    const principals = [user, ...(users[user]?.groups ?? [])];
    const covers = (granted) =>
      granted === 'Everything' ||
      granted === 'ReadWrite' ||
      (permission === 'Read' && granted === 'Read');
    for (let path = doc.path; ; path = parentOf(path)) {
      const at = docs.get(path);
      if (
        at?.acl.some(
          (ace) => ace.granted && principals.includes(ace.username) && covers(ace.permission),
        )
      )
        return true;
      if (path === '/') return false;
    }
  };

  const fail = (status, message) => ({
    status,
    body: { 'entity-type': 'exception', status, message },
  });

  /** A delivery filed: decided, and written by the server, or refused whole and not made. */
  const deliver = (user, path, properties) => {
    const text = (key) => (typeof properties[key] === 'string' ? properties[key].trim() : '');
    const versionId = text('mdlv:version');
    const distributor = text('mdlv:distributor');
    const territory = text('mdlv:territory');
    if (!/^[A-Za-z0-9-]{1,64}$/.test(versionId))
      return fail(400, 'A delivery names its localised version by its id.');
    // As Deliveries.printable: no control or format character.
    const printable = (value, max) =>
      value !== '' && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
    if (!printable(distributor, 200))
      return fail(400, 'A delivery names its distributor, in 1 to 200 characters.');
    if (!printable(territory, 64))
      return fail(400, 'A delivery names its territory, in 1 to 64 characters.');
    const version = byUid(versionId);
    if (!version || !holds(user, version, 'Read'))
      return fail(403, 'The delivery names no localised version you may read.');
    if (version.trashed)
      return fail(
        409,
        'A delivery is of a live localised version: not a version of it, a proxy or one in the trash.',
      );
    if (version.type !== 'FilmVersion')
      return fail(403, 'The delivery to ' + territory + ' is refused: not-cleared.');
    const film = policy.windowsDocument ? byUid(version.properties[policy.windowsDocument]) : null;
    const decided = decideDelivery(policy, version, film, territory, today);
    if (decided.refused)
      return fail(403, `The delivery to ${territory} is refused: ${decided.refused}.`);
    const refused = decided.files.filter((file) => file.reason !== null);
    if (refused.length > 0) {
      const named = refused
        .map(
          (file) =>
            `${file.name === null ? file.use : `${file.use} ${file.name}`} ${file.reason}${file.channel ? ` for ${file.channel}` : ''}`,
        )
        .join('; ');
      return fail(403, `The delivery to ${territory} is refused whole: ${named}.`);
    }
    // As Deliveries since 0.5.0: each file the watermark's <deliveries> names, marked for the
    // distributor; one that cannot be refuses the delivery whole.
    const watermarked = (file) => marks(policy.watermark, 'deliveries', keyOf(file.use, file.name));
    const unmarkable = decided.files.filter((file) => watermarked(file) && !isPicture(file.blob));
    if (unmarkable.length > 0)
      return fail(
        403,
        `The delivery to ${territory} is refused whole: ${unmarkable
          .map((file) => keyOf(file.use, file.name))
          .join('; ')} cannot be marked as the version's rights require.`,
      );
    const doc = add(path, 'MediaDelivery', {
      ...properties,
      'dc:title': text('dc:title') || `${distributor}, ${territory}`,
      'mdlv:version': versionId,
      'mdlv:distributor': distributor,
      'mdlv:territory': territory,
      'mdlv:deliveredAt': `${today}T${new Date().toISOString().slice(11)}`,
      'mdlv:deliveredBy': user,
      'mdlv:files': decided.files.map((file) => {
        const { use, name, channel, blob } = file;
        const entry = {
          use,
          name,
          channel,
          filename: blob.name,
          mimeType: blob['mime-type'],
          length: Number(blob.length),
          digest: blob.digest,
          watermarked: watermarked(file),
          watermarkedFor: null,
          watermark: null,
          watermarkedFile: null,
        };
        if (!entry.watermarked) return entry;
        const text = fillWatermark(policy.watermark, {
          recipient: distributor,
          user,
          day: today,
          territory,
        });
        return {
          ...entry,
          watermarkedFor: distributor,
          watermark: text,
          watermarkedFile: keep(
            `${base(blob.name)}-watermarked.jpg`,
            'image/jpeg',
            standInJpeg(text),
          ),
        };
      }),
    });
    return { status: 201, body: view(doc) };
  };

  /** A file kept in the stand-in's store, as the REST API answers a stored blob. */
  const keep = (name, type, bytes) => {
    const digest = createHash('md5').update(bytes).digest('hex');
    contents.set(digest, bytes);
    return {
      name,
      'mime-type': type,
      length: String(bytes.length),
      digest,
      digestAlgorithm: 'MD5',
    };
  };
  const isPicture = (blob) => ['image/png', 'image/jpeg'].includes(blob?.['mime-type']);
  /** Whether `user` is in a group the watermark exempts: never an administrator for being one. */
  const exempt = (user) =>
    (users[user]?.groups ?? []).some((group) => policy.watermark?.except.includes(group));
  const keyOf = (use, name) => (name === null ? use : `${use} ${name}`);
  const xpathOf = (key) =>
    key === 'original' ? policy.originalXpath : key.slice(key.indexOf(' ') + 1);
  const filmOf = (version) =>
    policy.windowsDocument ? byUid(version.properties[policy.windowsDocument]) : null;
  const base = (name) => String(name ?? 'file').replace(/\.[A-Za-z0-9]{1,8}$/, '');

  /** A blob property as the REST API takes it, from an upload batch, made a stored blob. */
  const stored = (value) => {
    if (value && typeof value === 'object' && 'upload-batch' in value) {
      const file = batches.get(value['upload-batch'])?.get(String(value['upload-fileId']));
      if (!file) throw new Error('no such upload');
      return keep(file.name, file.type, file.bytes);
    }
    if (Array.isArray(value)) return value.map(stored);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, stored(each)]));
    return value;
  };

  const pageProvider = (name, parameters) => {
    const live = [...docs.values()].filter((doc) => !doc.trashed);
    const byDelivered = (a, b) =>
      String(b.properties['mdlv:deliveredAt']).localeCompare(
        String(a.properties['mdlv:deliveredAt']),
      );
    const entries = {
      media_films: () => live.filter((doc) => doc.type === 'Film'),
      media_film_versions: () =>
        live.filter(
          (doc) => doc.type === 'FilmVersion' && doc.properties['fver:film'] === parameters[0],
        ),
      media_deliveries: () => live.filter((doc) => doc.type === 'MediaDelivery').sort(byDelivered),
      media_version_deliveries: () =>
        live
          .filter(
            (doc) =>
              doc.type === 'MediaDelivery' && doc.properties['mdlv:version'] === parameters[0],
          )
          .sort(byDelivered),
    }[name];
    return entries ? entries() : null;
  };

  const handle = (request, body) => {
    const url = new URL(request.url, 'http://stand-in');
    const api = url.pathname.replace(/^\/nuxeo\/api\/v1/, '');
    const user = Object.keys(users).find(
      (name) => request.headers.authorization === basic(name, users[name].password),
    );
    if (!user)
      return {
        status: 401,
        body: { 'entity-type': 'exception', status: 401, message: 'Unauthorized' },
      };
    const method = request.method;
    if (method === 'GET' && api === '/me')
      return {
        status: 200,
        body: {
          'entity-type': 'user',
          id: user,
          isAdministrator: users[user].administrator === true,
          properties: { groups: users[user].groups ?? [] },
        },
      };
    if (method === 'GET' && api.startsWith('/config/types/'))
      return types.includes(api.slice(14))
        ? { status: 200, body: { name: api.slice(14) } }
        : fail(404, 'no such type');
    if (api === '/upload/' && method === 'POST') {
      const id = `batch-${next++}`;
      batches.set(id, new Map());
      return { status: 201, body: { batchId: id } };
    }
    const upload = /^\/upload\/([^/]+)\/(\d+)$/.exec(api);
    if (upload && method === 'POST') {
      const batch = batches.get(upload[1]);
      if (!batch) return fail(404, 'no such batch');
      batch.set(upload[2], {
        name: decodeURIComponent(request.headers['x-file-name'] ?? 'file'),
        type: request.headers['x-file-type'] ?? 'application/octet-stream',
        bytes: body,
      });
      return { status: 201, body: { uploaded: 'true' } };
    }
    if (api.startsWith('/path')) {
      const path = decodeURIComponent(api.slice(5)) || '/';
      const doc = docs.get(path);
      if (method === 'GET')
        return doc && !doc.trashed && holds(user, doc, 'Read')
          ? { status: 200, body: view(doc) }
          : fail(404, path);
      if (method !== 'POST') return fail(405, method);
      if (!doc || !holds(user, doc, 'ReadWrite'))
        return fail(403, 'Privilege AddChildren is not granted');
      const json = JSON.parse(body.toString('utf8') || '{}');
      const child = `${path === '/' ? '' : path}/${json.name}`;
      if (docs.has(child)) return fail(409, `${child} exists`);
      const properties = stored(json.properties ?? {});
      if (json.type === 'MediaDelivery') return deliver(user, child, properties);
      if (!types.includes(json.type)) return fail(400, `no type ${json.type}`);
      return { status: 201, body: view(add(child, json.type, properties)) };
    }
    const acl = /^\/id\/([^/]+)\/@acl$/.exec(api);
    if (acl && method === 'GET') {
      const doc = byUid(acl[1]);
      return doc
        ? { status: 200, body: { acl: [{ name: 'local', aces: doc.acl }] } }
        : fail(404, acl[1]);
    }
    const id = /^\/id\/([^/]+)$/.exec(api);
    if (id && method === 'GET') {
      const doc = byUid(id[1]);
      return doc && !doc.trashed && holds(user, doc, 'Read')
        ? { status: 200, body: view(doc) }
        : fail(404, id[1]);
    }
    const search = /^\/search\/pp\/([^/]+)\/execute$/.exec(api);
    if (search && method === 'GET') {
      const parameters = url.searchParams.getAll('queryParams');
      const found = pageProvider(search[1], parameters);
      if (found === null) return fail(404, `no page provider ${search[1]}`);
      const readable = found.filter((doc) => holds(user, doc, 'Read'));
      return {
        status: 200,
        body: {
          'entity-type': 'documents',
          resultsCount: readable.length,
          entries: readable.map(view),
        },
      };
    }
    // A version's file downloaded, at @blob or /nxfile/: decided as a download, then held to the
    // watermark, as the add-on's download permission does.
    const blob =
      /^\/id\/([^/]+)\/@blob\/(.+)$/.exec(api) ??
      /^\/nuxeo\/nxfile\/default\/([^/]+)\/(.+)$/.exec(api);
    if (blob && method === 'GET') {
      const doc = byUid(blob[1]);
      if (!doc || doc.trashed || !holds(user, doc, 'Read')) return fail(404, blob[1]);
      const xpath = decodeURIComponent(blob[2]);
      const file = blobAt(doc.properties, xpath);
      if (!file?.digest) return fail(404, xpath);
      if (doc.type === 'FilmVersion') {
        const key = xpath === policy.originalXpath ? 'original' : `blob ${xpath}`;
        const refused = decideDownload(policy, doc, filmOf(doc), key, today);
        if (refused) return fail(403, `refused: ${refused}`);
        const occasion = policy.previews.has(key) ? 'previews' : 'downloads';
        if (marks(policy.watermark, occasion, key) && !exempt(user))
          return fail(403, 'refused: watermark-required');
      }
      return { status: 200, raw: { bytes: contents.get(file.digest), type: file['mime-type'] } };
    }
    if (method === 'POST' && api === '/automation/Asset.GetWatermarked') {
      const json = JSON.parse(body.toString('utf8') || '{}');
      const doc = byUid(String(json.input ?? '').replace(/^doc:/, ''));
      if (!doc || doc.trashed || !holds(user, doc, 'Read')) return fail(404, 'no such document');
      const use = String(json.params?.use ?? '');
      const key =
        use === 'original' ? 'original' : use.startsWith('blob:') ? `blob ${use.slice(5)}` : null;
      if (key === null)
        return fail(
          400,
          'Name the file: original, view:<title>, rendition:<name>, blob:<xpath> or storyboard:<n>.',
        );
      const occasion = policy.previews.has(key) ? 'previews' : 'downloads';
      if (
        doc.type !== 'FilmVersion' ||
        !policy.rules.has(key) ||
        !marks(policy.watermark, occasion, key)
      )
        return fail(404, 'No watermark is drawn on this file: download it as it is.');
      const refused = decideDownload(policy, doc, filmOf(doc), key, today);
      if (refused) return fail(403, `The asset's rights refuse this file: ${refused}.`);
      const file = blobAt(doc.properties, xpathOf(key));
      if (!file?.digest) return fail(404, 'The asset has no such file.');
      if (!isPicture(file))
        return fail(
          409,
          'This file cannot be marked as its rights require, so it is not served: watermark-unavailable.',
        );
      const text = fillWatermark(policy.watermark, {
        recipient: user,
        user,
        day: today,
        territory: '',
      });
      return { status: 200, raw: { bytes: standInJpeg(text), type: 'image/jpeg' } };
    }
    if (method === 'POST' && api === '/automation/Document.AddPermission') {
      if (!users[user].administrator) return fail(403, 'Privilege WriteSecurity is not granted');
      const json = JSON.parse(body.toString('utf8'));
      const doc = byUid(String(json.input ?? '').replace(/^doc:/, ''));
      if (!doc) return fail(404, 'no such document');
      for (const name of json.params.users)
        doc.acl.push({ username: name, permission: json.params.permission, granted: true });
      return { status: 200, body: view(doc) };
    }
    return fail(404, `the stand-in has no ${method} ${api}`);
  };

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://stand-in');
      let answer;
      try {
        answer = handle(request, body);
      } catch (error) {
        answer = fail(500, String(error?.message ?? error));
      }
      requests.push({
        method: request.method,
        path: url.pathname,
        status: answer.status,
        authorization: request.headers.authorization,
        json: /json/.test(request.headers['content-type'] ?? '') ? safeJson(body) : null,
      });
      if (answer.raw) {
        response.writeHead(answer.status, { 'Content-Type': answer.raw.type });
        response.end(answer.raw.bytes);
        return;
      }
      response.writeHead(answer.status, { 'Content-Type': 'application/json' });
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    docs,
    requests,
    byUid,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function safeJson(body) {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}
