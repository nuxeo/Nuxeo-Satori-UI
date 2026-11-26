/**
 * A stand-in for the Nuxeo server and the development server's configuration, answered inside the
 * browser by `page.route`: the capture steps run with no server at all, and nothing they do can
 * write to one. What it answers is what the app reads to boot signed in, the moves kit's layout of
 * a damage claim, the kit's model of the type, three claims, the search for a number, and the
 * uploads, which it keeps on the claims as `Blob.AttachOnDocument` would.
 *
 * Every request is logged. One it does not know is answered 404 and logged as unknown, so that a
 * step can check that the page asked for nothing unexpected.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formParts } from './photos.mjs';

const FORMAT = 'nuxeo-agentic-ui-config/1';

/** The person signed in: a driver, in the kit's drivers' group, no administrator. */
export const DRIVER = 'driver1';

/**
 * The claims: one the driver may write, found by its move's number; one the driver may only read;
 * one whose permissions say Write and whose server refuses the upload, as a server whose rules are
 * its own may. Every name is fictional.
 */
export const CLAIMS = {
  writable: {
    uid: '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3003',
    title: 'Dresser top scratched in transit',
    number: 'DC-3003',
    move: 'MV-2003',
    permissions: ['Read', 'ReadWrite', 'Write', 'WriteProperties', 'Browse'],
  },
  readOnly: {
    uid: '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3005',
    title: 'Mirror cracked on unloading',
    number: 'DC-3005',
    move: 'MV-2005',
    permissions: ['Read', 'Browse'],
  },
  refused: {
    uid: '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3004',
    title: 'Lamp shade dented',
    number: 'DC-3004',
    move: 'MV-2004',
    permissions: ['Read', 'Write'],
    refuseUploads: true,
  },
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ kit: string, upload: (claim: object, request: object) => 'store' | 'store-then-drop' | 'drop' | 'refuse' }} options
 */
export async function installStandIn(page, { kit, upload }) {
  const config = join(kit, 'bundle', 'agentic-ui-config');
  const model = JSON.parse(readFileSync(join(kit, 'content-model.json'), 'utf8'));
  const view = JSON.parse(
    readFileSync(join(config, 'layouts', 'DamageClaim', 'view.layout.json'), 'utf8'),
  );
  delete view.$schema;
  /** What each claim holds in `files:files`, as uploads add to it. */
  const files = new Map(Object.values(CLAIMS).map((claim) => [claim.uid, []]));
  const log = [];

  const document = (claim, withPermissions) => ({
    'entity-type': 'document',
    uid: claim.uid,
    type: 'DamageClaim',
    title: claim.title,
    path: `/default-domain/workspaces/moves/claims/${claim.number}`,
    isVersion: false,
    isProxy: false,
    isTrashed: false,
    schemas: model.doctypes.DamageClaim.schemas.map((name) => {
      const schema = model.schemas.find((each) => each.name === name);
      return { name, prefix: schema?.prefix ?? name };
    }),
    properties: {
      'dc:title': claim.title,
      'dmg:number': claim.number,
      'dmg:moveNumber': claim.move,
      'files:files': files.get(claim.uid).map((file) => ({ file })),
    },
    contextParameters: withPermissions ? { permissions: claim.permissions } : {},
  });

  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  const answer = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const entry = { method: request.method(), path, query: url.search, known: true };
    log.push(entry);

    if (
      path === '/agentic-ui-config/bootstrap.json' ||
      path === '/agentic-ui-config/manifest.json'
    ) {
      const layer = path.endsWith('bootstrap.json') ? 'bootstrap' : 'manifest';
      return json(route, { format: FORMAT, layer, fragments: [], diagnostics: [] });
    }
    if (path === '/agentic-ui-config/layouts.json')
      return json(route, {
        format: FORMAT,
        layer: 'layouts',
        layouts: [{ type: 'DamageClaim', mode: 'view', component: 'nuxeo.config.moves-demo' }],
        diagnostics: [],
        labels: [],
      });
    if (path === '/agentic-ui-config/layouts/DamageClaim/view.layout.json')
      return json(route, {
        format: FORMAT,
        layer: 'layout',
        type: 'DamageClaim',
        mode: 'view',
        content: view,
      });
    // The app's menu: none of the kit's own, which would send the shell to the kit's queues.
    if (path === '/agentic-ui-config/navigation.json')
      return json(route, { version: 2, entries: [] });
    if (path.startsWith('/agentic-ui-config/')) return route.fulfill({ status: 404, body: '' });
    if (path === '/nuxeo/agentic-ui-apps/apps.json')
      return json(route, { format: FORMAT, layer: 'apps', apps: [] });
    if (path === '/nuxeo/logout') return route.fulfill({ status: 200, body: '' });
    if (path === '/nuxeo/api/v1/me' || path === '/nuxeo/api/v1/me/')
      return json(route, {
        'entity-type': 'user',
        id: DRIVER,
        isAdministrator: false,
        isAnonymous: false,
        properties: {
          username: DRIVER,
          firstName: 'Dana',
          lastName: 'Okafor',
          groups: ['move-drivers'],
        },
        extendedGroups: [{ name: 'move-drivers', label: 'Move drivers' }],
      });
    if (path === '/nuxeo/api/v1/task') return json(route, { 'entity-type': 'tasks', entries: [] });
    if (path === '/nuxeo/api/v1/automation/Repository.Query')
      return json(route, { 'entity-type': 'documents', entries: [] });
    if (path === '/nuxeo/api/v1/config/types/DamageClaim') {
      const type = model.doctypes.DamageClaim;
      return json(route, {
        parent: type.parent,
        facets: type.facets,
        schemas: type.schemas.map((name) => model.schemas.find((each) => each.name === name)),
      });
    }
    if (path === '/nuxeo/api/v1/search/lang/NXQL/execute') {
      const query = url.searchParams.get('query') ?? '';
      // The favourites the shell looks for: none.
      if (query.includes("'Favorites'")) return json(route, { entries: [] });
      const values = url.searchParams.getAll('queryParams');
      entry.lookup = { query, values };
      const found = Object.values(CLAIMS).filter((claim) =>
        values.some((value) => value === claim.number || value === claim.move),
      );
      return json(route, {
        'entity-type': 'documents',
        entries: found.map((claim) => document(claim, false)),
      });
    }
    const byId = /^\/nuxeo\/api\/v1\/id\/([0-9a-f-]{36})$/.exec(path);
    if (byId && request.method() === 'GET') {
      const claim = Object.values(CLAIMS).find((each) => each.uid === byId[1]);
      if (!claim) return json(route, { status: 404, message: 'not found' }, 404);
      return json(route, document(claim, true));
    }
    if (path === '/nuxeo/api/v1/automation/Blob.AttachOnDocument' && request.method() === 'POST') {
      const parts = formParts(
        request.postDataBuffer() ?? Buffer.alloc(0),
        request.headers()['content-type'],
      );
      const params = JSON.parse(parts.get('request')?.bytes.toString('utf8') ?? '{}').params ?? {};
      const file = parts.get('file');
      const claim = Object.values(CLAIMS).find((each) => each.uid === params.document);
      entry.upload = {
        params,
        filename: file?.filename ?? null,
        type: file?.type ?? null,
        bytes: file?.bytes ?? null,
      };
      if (!claim || !file) return json(route, { status: 400, message: 'bad request' }, 400);
      const outcome = claim.refuseUploads ? 'refuse' : upload(claim, entry.upload);
      entry.upload.outcome = outcome;
      if (outcome === 'refuse')
        return json(
          route,
          {
            'entity-type': 'exception',
            status: 403,
            message: 'Privilege WriteProperties is not granted',
          },
          403,
        );
      if (outcome === 'store' || outcome === 'store-then-drop')
        files.get(claim.uid).push({
          name: file.filename,
          'mime-type': file.type,
          length: String(file.bytes.length),
          digest: `stand-in-${files.get(claim.uid).length + 1}`,
        });
      if (outcome === 'drop' || outcome === 'store-then-drop')
        return route.abort('connectionreset');
      return route.fulfill({
        status: 200,
        contentType: file.type ?? 'application/octet-stream',
        body: file.bytes,
      });
    }
    entry.known = false;
    return json(route, { status: 404, message: 'not in the stand-in' }, 404);
  };

  await page.route('**/nuxeo/**', answer);
  await page.route('**/agentic-ui-config/**', answer);
  return { log, files };
}
