#!/usr/bin/env node
/**
 * Controls for `seed.mjs`, run against a stand-in for the parts of the Nuxeo REST API it calls.
 *
 *   node business-apps/packages/payers-claims-demo/demo/seed.selftest.mjs
 *
 * **What this proves, and what it does not.** The stand-in is an in-memory server written here,
 * from what Nuxeo's REST API is documented to do: documents by path and by id, batch upload, the
 * `Document.Untrash` operation, page providers, `$currentUser` replaced by the person asking,
 * aggregates, users and groups, a document's ACLs, `Document.AddPermission` and
 * `Document.RemovePermission`, a search index that lags behind the repository, NXQL through
 * `Repository.Query`, a search endpoint whose index has not yet seen what was trashed, as
 * OpenSearch's can lag, and trash renaming a document to `<name>._<time>_.trashed` (the document
 * alone: its children are neither flagged nor moved, which Nuxeo may do differently). So a pass
 * proves the script's logic: preconditions, version 0.3.0 refused, each claim brought along the
 * claim lifecycle to its status, from a new claim's state and from 0.3.0's, a claim that cannot be
 * stopping the run, and a claim read back in another state failing it, a second run that adds and
 * moves nothing, a trashed record
 * restored, a document of another type left alone, a user or a group the seed did not create left
 * alone, the demo's people put back, and checks that fail when a page provider, its aggregates or
 * a user's rights are wrong. Since 0.4.1, the appeals too: version 0.4.0 refused, each case's
 * checklist written as `data.mjs` has it and put back when changed by hand, one read back otherwise
 * failing the run, and `data.mjs` held to the Case page's checklist card (`appeals.mjs`) before the
 * server is asked anything. It says nothing about whether a real server accepts
 * the stand-in model or answers as the stand-in does: only a run against one shows that.
 *
 * It runs the real `seed.mjs` as a command, against a server on 127.0.0.1, with a user and a
 * password made up for the run. Node 24 and nothing else. CI does not run it.
 *
 * Exit 0 when every control behaves as required, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appealProblems, readAppealChecklist } from './appeals.mjs';
import { CASES, CLAIMS, LETTER_TEMPLATES, MEMBERS, USERS } from './data.mjs';
import { LETTERS_DIR, letterProblems, offered } from './letters.mjs';
import { pathBetween, readLifecycle } from './lifecycle.mjs';

const LIFECYCLE = readLifecycle();
const DEMO = dirname(fileURLToPath(import.meta.url));
const SEED = process.argv[2] ?? join(DEMO, 'seed.mjs');
const ROOT = '/default-domain/workspaces/payers-demo';
const PAGE_PROVIDERS = [
  'member_claims',
  'member_cases',
  'provider_claims',
  'payers_claim_documents',
  'payers_unassigned_claims',
  'payers_my_claims',
  'payers_pending_claims',
  'payers_open_appeals',
];
/** `seed.mjs`'s marker on a user or a group it created. */
const MARKER = 'Payers kit demo (fictional)';

const failures = [];
let controls = 0;
function expect(condition, what, output = '') {
  controls++;
  if (!condition)
    failures.push(`${what}${output ? `\n${output.trim().replace(/^/gm, '    ')}` : ''}`);
}

/**
 * The stand-in server. `renameOnTrash` is Nuxeo's default; `brokenProvider` makes one page
 * provider return nothing; `pageSize` caps what a page holds, so paging is exercised;
 * `administrator: false` makes NUXEO_USER an ordinary user; `noAggregations` answers as a page
 * provider that queries the repository does, with none; `guestFor` answers that user's `/me` as
 * `Anonymous`, as a server that lets guests in does when a password is refused; `groupless` answers
 * that user's `/me` with none of their groups; `indexLag` answers the queue page providers, which
 * read the search index, with nothing for that many requests, as an index not yet caught up does;
 * `membersWrite` gives the platform's `members` group, which every user is in, ReadWrite
 * everywhere, as a server configured so would. A claim follows the stand-in model's `payersClaim`
 * lifecycle, read from its XML as the seed reads it, starting `submitted`, and keeps claim:status
 * in step with each transition, as the model's event handler does; `statusOnly` answers the claim
 * of that number, read back by its id, in `submitted` whatever its state, as a server whose state
 * and status had come apart would. `workflowModel: false` answers as version 0.3.0, which has no
 * claims review workflow, `caseChecklist: false` as version 0.4.0, whose case schema has no
 * checklist, and `openAppeals: false` as version 0.5.1, whose queues' search document has no field
 * for the open-appeals queue's facets, and `openAppealsDrift` answers that page provider wrongly:
 * `'decided'` with every appeal, the decided one among them, and `'grievance'` with every case
 * not decided, grievances among them; `checklistDrift` answers the case of that number, read back by its id, with its first
 * checklist entry not done, as a server that had dropped what was written would. Since 0.7.0,
 * `appealWorkflow: false` answers as version 0.6.1, which has no appeal review workflow, and
 * `decisionDrift` answers the case of that number, read back by its id, with no decision. Since
 * 0.8.0, `letters: false` answers as version 0.7.0, whose Claim type has no `Correspondence` facet,
 * and a `types` without `LetterTemplate` as a server without nuxeo-agentic-letters;
 * `languageDrift` answers the claim of that number, read back by its id, with no `corr:language`,
 * and `templateDrift` the letter template of that name with another `ltpl:letter`.
 */
function standIn({
  user,
  password,
  administrator = true,
  workflowModel = true,
  appealWorkflow = true,
  decisionDrift = null,
  letters = true,
  languageDrift = null,
  templateDrift = null,
  caseChecklist = true,
  openAppeals = true,
  openAppealsDrift = null,
  checklistDrift = null,
  statusOnly = null,
  noAggregations = false,
  guestFor = null,
  groupless = null,
  indexLag = 0,
  membersWrite = false,
  types = [
    'Member',
    'Claim',
    'Case',
    'Provider',
    'ClaimDocument',
    'PayersClaimSearch',
    'LetterTemplate',
  ],
  brokenProvider = null,
  renameOnTrash = true,
  pageSize = 3,
  hangUpOnFirstWrite = false,
  stallBodyOn = null,
  endlessProvider = null,
}) {
  const byPath = new Map();
  const byId = new Map();
  const batches = new Map();
  const blobs = new Map();
  /** Users by id, each with its properties and its password, and groups by name. */
  const users = new Map();
  const groups = new Map();
  /** Each document's local ACL, by its id. */
  const acls = new Map();
  const calls = [];
  const add = (path, type, properties = {}) => {
    const document = {
      'entity-type': 'document',
      uid: randomUUID(),
      path,
      type,
      state: type === 'Claim' ? LIFECYCLE.initial : 'project',
      isTrashed: false,
      properties: { ...properties },
    };
    byPath.set(path, document);
    byId.set(document.uid, document);
    return document;
  };
  const move = (document, path) => {
    byPath.delete(document.path);
    document.path = path;
    byPath.set(path, document);
  };
  const nameOf = (document) => document.path.slice(document.path.lastIndexOf('/') + 1);
  const parentOf = (document) => byPath.get(document.path.slice(0, document.path.lastIndexOf('/')));
  /** Trashed as Nuxeo trashes: flagged, and renamed unless renaming is off. */
  const trash = (document) => {
    document.isTrashed = true;
    if (renameOnTrash)
      move(document, `${document.path}._${Date.now()}${Math.floor(Math.random() * 1000)}_.trashed`);
  };
  const untrash = (document) => {
    document.isTrashed = false;
    const original = /^(.*)\._\d+_\.trashed$/.exec(document.path);
    if (original) move(document, original[1]);
  };
  add('/default-domain', 'Domain');
  add('/default-domain/workspaces', 'WorkspaceRoot');

  const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  const authorization = basic(user, password);
  /** Who a request runs as: NUXEO_USER, a user the seed created, or no one. */
  const principal = (header) => {
    if (header === authorization) return user;
    for (const [id, entry] of users) if (header === basic(id, entry.password)) return id;
    return null;
  };
  /**
   * What `asking` may do on a document, as the `permissions` enricher lists it: read, and change
   * when an ACE on the document or above it gives one of their groups ReadWrite.
   */
  const rights = (document, asking) => {
    const write = ['WriteProperties', 'WriteLifeCycle', 'ReadWrite'];
    if (asking === user) return ['Read', ...write];
    const theirs = [...(users.get(asking)?.properties.groups ?? []), 'members'];
    const segments = document.path.split('/').filter(Boolean);
    const above = segments.map((_, i) => byPath.get(`/${segments.slice(0, i + 1).join('/')}`));
    const writes =
      membersWrite ||
      above.some((place) =>
        (acls.get(place?.uid) ?? []).some(
          (ace) => theirs.includes(ace.username) && ace.permission === 'ReadWrite',
        ),
      );
    return ['Read', ...(writes ? write : [])];
  };
  const view = (document) => {
    const properties = { ...document.properties };
    const blob = blobs.get(document.uid);
    if (blob) properties['file:content'] = { name: blob.name, length: String(blob.bytes.length) };
    // A day written to a date comes back as Nuxeo writes a date: midnight UTC, with its time.
    if (Array.isArray(properties['case:checklist']))
      properties['case:checklist'] = properties['case:checklist'].map((entry) => ({
        ...entry,
        doneOn: /^\d{4}-\d{2}-\d{2}$/.test(entry.doneOn ?? '')
          ? `${entry.doneOn}T00:00:00.000Z`
          : entry.doneOn,
      }));
    return { ...document, properties };
  };
  const write = (document, properties) => {
    const reference = properties['file:content'];
    if (reference && reference['upload-batch']) {
      const uploaded = batches.get(reference['upload-batch'])?.[reference['upload-fileId']];
      if (!uploaded) throw new Error('no such batch');
      blobs.set(document.uid, uploaded);
      delete properties['file:content'];
    }
    Object.assign(document.properties, properties);
  };
  const live = () => [...byId.values()].filter((document) => !document.isTrashed);
  const providers = {
    member_claims: (id) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:member'] === id),
    member_cases: (id) =>
      live().filter((d) => d.type === 'Case' && d.properties['case:member'] === id),
    provider_claims: (id) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:provider'] === id),
    payers_claim_documents: (number) =>
      live().filter((d) => d.type === 'ClaimDocument' && d.properties['claimdoc:claim'] === number),
    payers_unassigned_claims: () =>
      live().filter(
        (d) =>
          d.type === 'Claim' &&
          (d.properties['claim:adjuster'] ?? null) === null &&
          ['submitted', 'inReview'].includes(d.properties['claim:status']),
      ),
    // Given the adjuster's name: the seed passes $currentUser, which the server replaces.
    payers_my_claims: (adjuster) =>
      live().filter((d) => d.type === 'Claim' && d.properties['claim:adjuster'] === adjuster),
    payers_pending_claims: () =>
      live().filter(
        (d) => d.type === 'Claim' && ['inReview', 'pended'].includes(d.properties['claim:status']),
      ),
    // Version 0.6.0's: appeals not yet decided, open or in review.
    payers_open_appeals: () =>
      live().filter(
        (d) =>
          d.type === 'Case' &&
          (openAppealsDrift === 'grievance' || d.properties['case:category'] === 'appeal') &&
          (openAppealsDrift === 'decided' ||
            ['open', 'inReview'].includes(d.properties['case:state'])),
      ),
  };
  /** A terms aggregate over the records found, as the search index answers it. */
  const terms = (found, property) => {
    const counts = new Map();
    for (const d of found) {
      const key = d.properties[property];
      if (key !== null && key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { buckets: [...counts].map(([key, docCount]) => ({ key, docCount })) };
  };
  /** The one NXQL query the seed makes: a parent's trashed children by a name pattern. */
  const TRASHED_QUERY =
    /^SELECT \* FROM Document WHERE ecm:parentId = '([^']+)' AND ecm:isTrashed = 1 AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:name LIKE '([^']+)'$/;
  const page = (entries, index) => ({
    entries: entries.slice(index * pageSize, (index + 1) * pageSize).map(view),
    isNextPageAvailable: (index + 1) * pageSize < entries.length,
  });

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    const asking = principal(request.headers.authorization);
    if (asking === null) return send(401, { message: 'Unauthorized' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname).replace(/^\/nuxeo\/api\/v1/, '');
    const index = Number(url.searchParams.get('currentPageIndex') ?? 0);
    const { method } = request;
    calls.push(`${method} ${path}`);
    // A server that goes away once writing has started: the connection drops, with no answer.
    if (hangUpOnFirstWrite && method === 'POST' && path.startsWith('/path/'))
      return request.socket.destroy();
    // A server that sends its headers, then never the rest of its body.
    if (stallBodyOn === path) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.write('{');
    }
    try {
      if (method === 'GET' && path === '/me') {
        if (asking === user) return send(200, { id: user, isAdministrator: administrator });
        if (asking === guestFor) return send(200, { id: 'Anonymous', isAdministrator: false });
        const member = asking === groupless ? [] : (users.get(asking).properties.groups ?? []);
        return send(200, {
          id: asking,
          isAdministrator: false,
          properties: { groups: member },
          extendedGroups: [...member, 'members'].map((name) => ({ name })),
        });
      }
      // Users and groups: only an administrator may write them, as on a server.
      const writing = method !== 'GET';
      if (
        (path === '/user' ||
          path.startsWith('/user/') ||
          path === '/group' ||
          path.startsWith('/group/')) &&
        writing &&
        !(asking === user && administrator)
      )
        return send(403, { message: 'not an administrator' });
      if (path.startsWith('/user/')) {
        const id = path.slice('/user/'.length);
        const entry = users.get(id);
        if (!entry) return send(404, { message: 'no such user' });
        if (method === 'GET') return send(200, { id, properties: { ...entry.properties } });
        if (method === 'PUT') {
          const { password: secret, ...properties } = JSON.parse(raw).properties;
          Object.assign(entry.properties, properties);
          if (secret) entry.password = secret;
          return send(200, { id, properties: { ...entry.properties } });
        }
      }
      if (method === 'POST' && path === '/user') {
        const { id, properties } = JSON.parse(raw);
        if (users.has(id)) return send(409, { message: 'user exists' });
        const { password: secret, ...rest } = properties;
        const unknown = (rest.groups ?? []).filter((name) => !groups.has(name));
        if (unknown.length > 0) return send(400, { message: `no group ${unknown.join(', ')}` });
        users.set(id, { properties: rest, password: secret });
        return send(201, { id, properties: { ...rest } });
      }
      if (path.startsWith('/group/') && method === 'GET') {
        const group = groups.get(path.slice('/group/'.length));
        return group ? send(200, group) : send(404, { message: 'no such group' });
      }
      if (method === 'POST' && path === '/group') {
        const body = JSON.parse(raw);
        if (groups.has(body.groupname)) return send(409, { message: 'group exists' });
        groups.set(body.groupname, { groupname: body.groupname, properties: body.properties });
        return send(201, groups.get(body.groupname));
      }
      if (method === 'POST' && path === '/automation/Document.AddPermission') {
        const body = JSON.parse(raw);
        const uid = body.input.replace(/^doc:/, '');
        const aces = acls.get(uid) ?? [];
        for (const name of body.params.users)
          aces.push({
            id: `${name}:${body.params.permission}:true:${user}::`,
            username: name,
            permission: body.params.permission,
            granted: true,
            status: 'effective',
          });
        acls.set(uid, aces);
        return send(200, view(byId.get(uid)));
      }
      if (method === 'POST' && path === '/automation/Document.RemovePermission') {
        const body = JSON.parse(raw);
        const uid = body.input.replace(/^doc:/, '');
        acls.set(
          uid,
          (acls.get(uid) ?? []).filter((ace) => ace.id !== body.params.id),
        );
        return send(200, view(byId.get(uid)));
      }
      // A schema, as /config/schemas answers it: the queues' search document, with version 0.6.0's
      // fields for the open-appeals queue's facets.
      if (method === 'GET' && path === '/config/schemas/payers_claim_search') {
        if (!types.includes('PayersClaimSearch')) return send(404, { message: 'no such schema' });
        return send(200, {
          name: 'payers_claim_search',
          '@prefix': 'claimsearch',
          fields: {
            claim_status_agg: 'string[]',
            claim_adjuster_agg: 'string[]',
            ...(openAppeals ? { case_state_agg: 'string[]', case_assignee_agg: 'string[]' } : {}),
          },
        });
      }
      // A type, as /config/types answers it: the Case type with its schemas, version 0.4.1's case
      // schema with the checklist, under its @prefix.
      if (method === 'GET' && path.startsWith('/config/types/')) {
        const type = path.slice('/config/types/'.length);
        if (!types.includes(type)) return send(404, { message: 'no such type' });
        // Since 0.8.0, the Claim type with nuxeo-agentic-letters' facet, which the kit gives it.
        if (type === 'Claim')
          return send(200, {
            parent: 'Document',
            facets: letters ? ['Correspondence'] : [],
            schemas: [],
          });
        if (type !== 'Case') return send(200, {});
        return send(200, {
          parent: 'Document',
          facets: [],
          schemas: [
            { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
            {
              name: 'case',
              '@prefix': 'case',
              fields: {
                number: 'string',
                summary: 'string',
                ...(caseChecklist
                  ? {
                      checklist: {
                        type: 'complex[]',
                        fields: {
                          item: 'string',
                          done: 'boolean',
                          doneBy: 'string',
                          doneOn: 'date',
                        },
                      },
                    }
                  : {}),
              },
            },
          ],
        });
      }
      if (method === 'GET' && path.startsWith('/path/')) {
        const document = byPath.get(path.slice('/path'.length));
        return document ? send(200, view(document)) : send(404, { message: 'not found' });
      }
      if (method === 'POST' && path.startsWith('/path/')) {
        const parent = path.slice('/path'.length);
        if (!byPath.has(parent)) return send(404, { message: 'no parent' });
        const body = JSON.parse(raw);
        // Nuxeo would give the new document another name; the seed must never ask it to.
        if (byPath.has(`${parent}/${body.name}`)) return send(409, { message: 'name taken' });
        const document = add(`${parent}/${body.name}`, body.type);
        write(document, { ...body.properties });
        return send(201, view(document));
      }
      const blob = /^\/id\/([^/]+)\/@blob\/file:content$/.exec(path);
      if (method === 'GET' && blob) {
        response.writeHead(200);
        return response.end(blobs.get(blob[1])?.bytes);
      }
      if (path.startsWith('/id/')) {
        const document = byId.get(path.slice('/id/'.length));
        if (!document) return send(404, { message: 'not found' });
        // The one claim `statusOnly` names, read back by id after the seed wrote it, in submitted.
        const drifted =
          statusOnly !== null && document.properties['claim:number'] === statusOnly
            ? { state: LIFECYCLE.initial }
            : {};
        // The one case `checklistDrift` names, read back with its first entry not done.
        const shown = view(document);
        // The one case `decisionDrift` names, read back with no decision.
        if (decisionDrift !== null && document.properties['case:number'] === decisionDrift)
          shown.properties['case:decision'] = null;
        // Since 0.8.0: the one claim `languageDrift` names, read back with no language, and the one
        // letter template `templateDrift` names, read back as another letter's.
        if (languageDrift !== null && document.properties['claim:number'] === languageDrift)
          shown.properties['corr:language'] = null;
        if (templateDrift !== null && document.properties['tmpl:templateName'] === templateDrift)
          shown.properties['ltpl:letter'] = 'payers.somethingElse';
        if (checklistDrift !== null && document.properties['case:number'] === checklistDrift) {
          const [first, ...rest] = shown.properties['case:checklist'] ?? [];
          if (first)
            shown.properties['case:checklist'] = [
              { ...first, done: false, doneBy: null, doneOn: null },
              ...rest,
            ];
        }
        if (method === 'GET')
          return send(200, {
            ...shown,
            ...drifted,
            ...(request.headers['enrichers-document'] === 'acls'
              ? {
                  contextParameters: {
                    acls: [{ name: 'local', aces: acls.get(document.uid) ?? [] }],
                  },
                }
              : {}),
            ...(request.headers['enrichers-document'] === 'permissions'
              ? { contextParameters: { permissions: rights(document, asking) } }
              : {}),
          });
        if (method === 'PUT') {
          write(document, { ...JSON.parse(raw).properties });
          return send(200, view(document));
        }
      }
      if (method === 'POST' && path === '/upload/') {
        const batchId = randomUUID();
        batches.set(batchId, {});
        return send(201, { batchId });
      }
      const upload = /^\/upload\/([^/]+)\/(\d+)$/.exec(path);
      if (method === 'POST' && upload) {
        batches.get(upload[1])[upload[2]] = {
          bytes: raw,
          name: decodeURIComponent(request.headers['x-file-name']),
        };
        return send(201, { uploaded: 'true' });
      }
      // A lifecycle transition, refused as Nuxeo refuses one the document's state does not allow.
      if (method === 'POST' && path === '/automation/Document.FollowLifecycleTransition') {
        const body = JSON.parse(raw);
        const document = byId.get(body.input.replace(/^doc:/, ''));
        const transition = body.params?.value;
        const allowed =
          document?.type === 'Claim' &&
          (LIFECYCLE.states.get(document.state) ?? []).includes(transition);
        if (!allowed)
          return send(500, {
            message: `Not allowed to follow transition <${transition}> from state <${document?.state}>`,
          });
        document.state = LIFECYCLE.transitions.get(transition);
        document.properties['claim:status'] = document.state;
        return send(200, view(document));
      }
      if (method === 'GET' && path.startsWith('/workflowModel/')) {
        const model = path.slice('/workflowModel/'.length);
        const known =
          (workflowModel && model === 'PayersClaimReview') ||
          (appealWorkflow && model === 'PayersAppealReview');
        return known
          ? send(200, { 'entity-type': 'workflow', name: model })
          : send(404, { message: 'no such workflow model' });
      }
      if (method === 'POST' && path === '/automation/Document.Untrash') {
        const document = byId.get(JSON.parse(raw).input.replace(/^doc:/, ''));
        untrash(document);
        return send(200, view(document));
      }
      // The repository: what is trashed is trashed.
      const repository = method === 'POST' && path === '/automation/Repository.Query';
      // The search index, a moment behind: it has not seen anything trashed yet, so it finds none.
      const searchIndex = method === 'GET' && path === '/search/lang/NXQL/execute';
      if (repository || searchIndex) {
        const body = repository ? JSON.parse(raw).params : null;
        const query = TRASHED_QUERY.exec(
          repository ? (body.query ?? '') : (url.searchParams.get('query') ?? ''),
        );
        if (!query) return send(400, { message: 'a query the stand-in does not know' });
        const [, parent, like] = query;
        const pattern = new RegExp(
          `^${like
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.')}$`,
        );
        const found = searchIndex
          ? []
          : [...byId.values()].filter(
              (d) => d.isTrashed && parentOf(d)?.uid === parent && pattern.test(nameOf(d)),
            );
        return send(200, page(found, repository ? Number(body.currentPageIndex ?? 0) : index));
      }
      const execute = /^\/search\/pp\/([^/]+)\/execute$/.exec(path);
      if (method === 'GET' && execute) {
        const provider = providers[execute[1]];
        if (!provider) return send(404, { message: 'no such page provider' });
        const given = url.searchParams.get('queryParams') ?? undefined;
        const lagging =
          execute[1].startsWith('payers_') &&
          execute[1] !== 'payers_claim_documents' &&
          indexLag-- > 0;
        const found =
          brokenProvider === execute[1] || lagging
            ? []
            : provider(given === '$currentUser' ? asking : given);
        // A provider that always says there is another page.
        if (endlessProvider === execute[1])
          return send(200, { ...page(found, index), isNextPageAvailable: true });
        // The four queue page providers answer their aggregates, as the search index does.
        const queues = {
          payers_unassigned_claims: ['claim_status_agg'],
          payers_my_claims: ['claim_status_agg'],
          payers_pending_claims: ['claim_status_agg', 'claim_adjuster_agg'],
          payers_open_appeals: ['case_state_agg', 'case_assignee_agg'],
        };
        const property = {
          claim_status_agg: 'claim:status',
          claim_adjuster_agg: 'claim:adjuster',
          case_state_agg: 'case:state',
          case_assignee_agg: 'case:assignee',
        };
        const aggregations = Object.fromEntries(
          noAggregations === execute[1] || noAggregations === true
            ? []
            : (queues[execute[1]] ?? []).map((id) => [id, terms(found, property[id])]),
        );
        return send(200, { ...page(found, index), aggregations });
      }
      return send(404, { message: `the stand-in does not answer ${method} ${path}` });
    } catch (error) {
      return send(500, { message: error.message });
    }
  });
  Object.assign(server, { byPath, add, trash, users, groups, acls, blobs, calls, basic });
  return server;
}

/** A run of the real seed, as a command, with the environment given. */
function seed(env, script = SEED) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH, ...env } });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.on('close', (status) => resolve({ status, output }));
  });
}

/** `body` given the stand-in and a way to run the seed against it. */
async function against(options, body) {
  const user = `selftest-${randomUUID().slice(0, 8)}`;
  const password = randomUUID();
  const demoPassword = `demo-${randomUUID()}`;
  const server = standIn({ user, password, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (env = {}, script = SEED) =>
    seed(
      {
        NUXEO_URL: url,
        NUXEO_USER: user,
        NUXEO_PASS: password,
        PAYERS_DEMO_PASSWORD: demoPassword,
        NUXEO_TIMEOUT_MS: '2000',
        NUXEO_INDEX_WAIT_MS: '1500',
        ...env,
      },
      script,
    );
  try {
    await body({ server, run, user, password, demoPassword });
  } catch (error) {
    // A control that throws, because the seed left the server in a state it did not expect, is a
    // failed control, not a crash that hides the others.
    expect(false, `a control threw: ${error?.stack ?? error}`);
  } finally {
    server.close();
  }
}

const done = (output) => output.split('\n').find((line) => line.startsWith('Done')) ?? '';
const at = (server, place) => server.byPath.get(`${ROOT}/${place}`);
const ids = (server) => [...server.byPath.values()].map((document) => document.uid).sort();

// Preconditions: exit 2, before anything is written.
{
  const { status, output } = await seed({ NUXEO_USER: '', NUXEO_PASS: randomUUID() });
  expect(status === 2 && /must both be set/.test(output), 'an empty NUXEO_USER is exit 2', output);
}
{
  const { status, output } = await seed({
    NUXEO_URL: 'http://127.0.0.1:9',
    NUXEO_USER: 'selftest',
    NUXEO_PASS: randomUUID(),
    PAYERS_DEMO_PASSWORD: randomUUID(),
  });
  expect(status === 2 && /did not answer/.test(output), 'no server is exit 2', output);
}
await against({}, async ({ server, run }) => {
  const { status, output } = await run({ PAYERS_DEMO_PASSWORD: '' });
  expect(
    status === 2 && /PAYERS_DEMO_PASSWORD must be set/.test(output) && server.calls.length === 0,
    'no demo password is exit 2, before the server is asked anything',
    output,
  );
});
await against({ administrator: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /is not an administrator/.test(output) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'NUXEO_USER who is not an administrator is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ run, user }) => {
  const wrong = randomUUID();
  const { status, output } = await run({ NUXEO_PASS: wrong });
  expect(
    status === 2 && /HTTP 401/.test(output) && !output.includes(wrong) && !output.includes(user),
    'refused credentials are exit 2, and neither half is printed',
    output,
  );
});
await against({ types: ['Member'] }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /no Claim, Case, Provider, ClaimDocument, PayersClaimSearch type/.test(output),
    'the package not installed is exit 2, naming the types it lacks',
    output,
  );
});
await against(
  { types: ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument'] },
  async ({ server, run }) => {
    const { status, output } = await run();
    expect(
      status === 2 &&
        /version 0.2.0 or older .* upgrade it to 0.8.0/.test(output) &&
        server.calls.every((call) => call.startsWith('GET ')),
      'version 0.2.0 of the package, with no queue search type, is exit 2, with nothing written',
      output,
    );
  },
);

await against({ hangUpOnFirstWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /stopped part way; running it again is safe/.test(output),
    'a server that stops answering after writing starts is exit 1, not a precondition',
    output,
  );
});

await against({ stallBodyOn: '/me' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 2 && /did not answer GET \/me/.test(output),
    'a server whose first answer stalls after its headers is exit 2: no answer is no server',
    output,
  );
});
await against({ endlessProvider: 'member_claims' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /member_claims still reports another page after 100 pages/.test(output),
    'a page provider that never stops reporting another page fails the run, counted in pages',
    output,
  );
});

// Twice, both with Nuxeo's trash renaming and without it.
for (const renameOnTrash of [true, false]) {
  const how = renameOnTrash ? 'renamed on trash' : 'not renamed on trash';
  await against({ renameOnTrash }, async ({ server, run }) => {
    const first = await run();
    expect(first.status === 0, `${how}: a first run exits 0`, first.output);
    expect(
      /39 created, 0 updated, 0 restored from the trash, 10 file\(s\) uploaded/.test(first.output),
      `${how}: a first run creates 39 documents and uploads 10 files, six of them letter templates`,
      first.output,
    );
    expect(
      /People: 9 created, 0 updated, 9 permission\(s\) granted, 0 removed, for 6 users in 3 groups/.test(
        first.output,
      ),
      `${how}: a first run creates 6 users and 3 groups, and grants 9 permissions`,
      first.output,
    );
    // Each claim brought from submitted to its status, along the fewest transitions, and kept so.
    const wanted = CLAIMS.reduce(
      (count, claim) => count + pathBetween(LIFECYCLE, LIFECYCLE.initial, claim.status).length,
      0,
    );
    const transitions = (from) =>
      server.calls
        .slice(from)
        .filter((call) => call.endsWith('/Document.FollowLifecycleTransition')).length;
    const settled = () =>
      CLAIMS.every((claim) => {
        const document = at(server, `claims/${claim.number.toLowerCase()}`);
        return (
          document?.state === claim.status && document.properties['claim:status'] === claim.status
        );
      });
    expect(
      settled() &&
        transitions(0) === wanted &&
        new RegExp(`${wanted} lifecycle transition`).test(first.output),
      `${how}: a first run brings every claim to the state its status names, in ${wanted} transitions`,
      first.output,
    );
    const before = ids(server);
    const callsBefore = server.calls.length;
    const second = await run();
    expect(
      settled() && transitions(callsBefore) === 0,
      `${how}: a second run follows no transition`,
      second.output,
    );
    expect(
      /People: 0 created, 6 updated, 0 permission\(s\) granted, 0 removed/.test(second.output),
      `${how}: a second run creates no user, group or permission`,
      second.output,
    );
    expect(
      second.status === 0 &&
        /0 created, 39 updated, 0 restored from the trash, 0 file\(s\) uploaded/.test(
          second.output,
        ),
      `${how}: a second run creates and uploads nothing (${done(second.output)})`,
      second.output,
    );
    expect(
      JSON.stringify(ids(server)) === JSON.stringify(before),
      `${how}: the same documents with the same ids after two runs`,
    );

    // Edited and trashed by hand: put back and restored, with nothing created in its place.
    const member = at(server, 'members/member-100048');
    member.properties['member:status'] = 'terminated';
    server.trash(member);
    const claim = at(server, 'claims/claim-000140');
    claim.properties['claim:adjuster'] = 'someone';
    const third = await run();
    expect(
      third.status === 0 &&
        /0 created, 39 updated, 1 restored from the trash/.test(third.output) &&
        member.isTrashed === false &&
        member.path === `${ROOT}/members/member-100048` &&
        member.properties['member:status'] === 'active',
      `${how}: a trashed, edited member is restored to its place and put back, with none created`,
      third.output,
    );
    expect(
      JSON.stringify(ids(server)) === JSON.stringify(before),
      `${how}: still the same documents after the restore`,
    );
    expect(
      claim.properties['claim:adjuster'] === null,
      `${how}: an adjuster set by hand is cleared, so the claim is back in the queue`,
    );

    // The whole workspace trashed, and renamed: it comes back to its place.
    server.trash(server.byPath.get(ROOT));
    const fourth = await run();
    expect(
      fourth.status === 0 &&
        /0 created/.test(fourth.output) &&
        server.byPath.get(ROOT)?.isTrashed === false,
      `${how}: a trashed workspace is restored, with nothing created`,
      fourth.output,
    );

    const c131 = at(server, 'claims/claim-000131');
    expect(c131.properties['claim:member'] === member.uid, 'claim:member holds the member id');
    expect(
      at(server, 'cases/case-2041').properties['case:claim'] ===
        at(server, 'claims/claim-000144').uid,
      'case:claim holds the claim id',
    );
    expect(
      at(server, 'cases/case-2030').properties['case:claim'] === null,
      'a case with no claim has none',
    );
  });
}

// The appeals: their checklists written, checked, and held to the Case page's checklist card.
await against({ caseChecklist: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.4.0 or older .* no case:checklist .* upgrade it to 0.8.0/.test(output) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.4.0 of the package, whose case schema has no checklist, is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the appeals, exits 0', first.output);
  const checklist = (number) =>
    at(server, `cases/${number.toLowerCase()}`)?.properties['case:checklist'];
  const appeals = CASES.filter((kase) => kase.category === 'appeal');
  expect(
    appeals.length === 3,
    'data.mjs seeds three appeals',
    JSON.stringify(appeals.map((k) => k.number)),
  );
  expect(
    appeals.every(
      (kase) => JSON.stringify(checklist(kase.number)) === JSON.stringify(kase.checklist),
    ),
    "each appeal's checklist is written as data.mjs has it, entry for entry",
    JSON.stringify(appeals.map((kase) => checklist(kase.number))),
  );
  expect(
    CASES.filter((kase) => kase.category !== 'appeal').every(
      (kase) => JSON.stringify(checklist(kase.number)) === '[]',
    ),
    'every other case is written with no checklist',
  );
  expect(
    appeals.every((kase) => first.output.includes(`An appeal's record page, ${kase.number}: `)),
    "the run prints each appeal's record page",
    first.output,
  );
  // Changed by hand: the appeal's entry ticked, and a grievance given one. Both are put back.
  const appeal = at(server, 'cases/case-2041');
  appeal.properties['case:checklist'] = [
    { item: 'medicalRecords', done: true, doneBy: 'dana.lee', doneOn: '2026-11-20' },
  ];
  at(server, 'cases/case-2042').properties['case:checklist'] = [
    { item: 'appealLetter', done: true, doneBy: 'riley.brooks', doneOn: '2026-11-16' },
  ];
  const second = await run();
  expect(
    second.status === 0 &&
      JSON.stringify(checklist('CASE-2041')) ===
        JSON.stringify(CASES.find((kase) => kase.number === 'CASE-2041').checklist) &&
      JSON.stringify(checklist('CASE-2042')) === '[]',
    'a checklist changed by hand is put back, and one given to a grievance emptied',
    second.output,
  );
});
// Version 0.6.0's open-appeals queue: a server on 0.5.1 has no field for its facets.
await against({ openAppeals: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.5.1 or older .* no open-appeals queue: upgrade it to 0.8.0/.test(output) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.5.1 of the package, with no open-appeals queue, is exit 2, with nothing written',
    output,
  );
});
// The open appeals the seed checks: the appeals not decided, and neither the decided one nor a
// grievance, however open. A queue that holds either fails the run, naming it.
await against({ openAppealsDrift: 'decided' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /payers_open_appeals holds CASE-2043, which it should not/.test(output),
    'an open-appeals queue that holds the decided appeal fails the run',
    output,
  );
});
await against({ openAppealsDrift: 'grievance' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /payers_open_appeals holds CASE-2042, which it should not/.test(output),
    'an open-appeals queue that holds an open grievance fails the run',
    output,
  );
});
await against({}, async ({ server, run }) => {
  const first = await run();
  const held = (number) =>
    first.status === 0 && at(server, `cases/${number.toLowerCase()}`) !== undefined;
  expect(
    held('CASE-2041') && held('CASE-2044') && /queues\/open-appeals/.test(first.output),
    'a first run seeds the two open appeals, and prints their queue',
    first.output,
  );
  // A decided appeal reopened by hand is put back, and so leaves the queue again.
  at(server, 'cases/case-2043').properties['case:state'] = 'inReview';
  const second = await run();
  expect(
    second.status === 0 && at(server, 'cases/case-2043').properties['case:state'] === 'decided',
    'a decided appeal reopened by hand is put back as decided',
    second.output,
  );
});
await against({ checklistDrift: 'CASE-2043' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /The cases' checklists or decisions are not as seeded/.test(output) &&
      /CASE-2043 holds /.test(output),
    "a case read back with another checklist than it was given fails the seed's check",
    output,
  );
});
// Since 0.7.0: the decided appeal's decision, written and read back.
await against({}, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 0 &&
      at(server, 'cases/case-2043').properties['case:decision'] === 'upheld' &&
      ['case-2030', 'case-2041', 'case-2042', 'case-2044'].every(
        (name) => at(server, `cases/${name}`).properties['case:decision'] === null,
      ),
    'the decided appeal is written with its decision, upheld, and every other case with none',
    output,
  );
});
await against({ decisionDrift: 'CASE-2043' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /The cases' checklists or decisions are not as seeded/.test(output) &&
      /CASE-2043's decision is null, not "upheld"/.test(output),
    "a case read back with no decision when it was given one fails the seed's check",
    output,
  );
});
await against({ appealWorkflow: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.6.1 or older .* no PayersAppealReview workflow .* upgrade it to 0.8.0/.test(
        output,
      ) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.6.1 of the package, with no appeal review workflow, is exit 2, with nothing written',
    output,
  );
});

// data.mjs held to the Case page's checklist card, by `appeals.mjs`, as the seed holds it.
{
  const card = readAppealChecklist();
  const problems = (cases, claims = CLAIMS) =>
    appealProblems({ cases, claims, users: USERS }, card);
  const appeal = CASES.find((kase) => kase.number === 'CASE-2041');
  const withEntry = (entry) => [{ ...appeal, checklist: [...appeal.checklist, entry] }];
  expect(
    problems(
      withEntry({ item: 'decisionLetter', done: false, doneBy: 'sam.patel', doneOn: '2026-11-20' }),
    ).length === 0,
    'an entry not done may still say who and when, as an item asked for and not received does',
  );
  expect(
    problems(CASES).length === 0,
    "data.mjs agrees with the Case page's checklist",
    problems(CASES).join('\n'),
  );
  expect(
    card.items.map((item) => item.id).join() ===
      'appealLetter,reviewerAssigned,medicalRecords,providerStatement,decisionLetter',
    "the Case page's checklist is read from its layout, in its order",
    JSON.stringify(card.items),
  );
  const cases = [
    [
      'an appeal against a claim that is not denied',
      problems(
        [appeal],
        CLAIMS.map((claim) =>
          claim.number === appeal.claim ? { ...claim, status: 'paid' } : claim,
        ),
      ),
      /CASE-2041 appeals CLAIM-000144, which is paid, not denied/,
    ],
    [
      'an appeal against no claim',
      problems([{ ...appeal, claim: null }]),
      /CASE-2041 is an appeal against no claim/,
    ],
    [
      'an entry for an item the card does not list',
      problems(
        withEntry({ item: 'peerToPeer', done: true, doneBy: 'sam.patel', doneOn: '2026-11-06' }),
      ),
      /"peerToPeer" is not an item the Case page's checklist lists/,
    ],
    [
      'an item twice',
      problems(withEntry({ ...appeal.checklist[0] })),
      /"reviewerAssigned" is there twice/,
    ],
    [
      'an item done by someone not of the demo',
      problems(
        withEntry({ item: 'decisionLetter', done: true, doneBy: 'someone', doneOn: '2026-11-06' }),
      ),
      /names someone, who is not one of the demo's people/,
    ],
    [
      'an item done on a day that does not exist',
      problems(
        withEntry({
          item: 'decisionLetter',
          done: true,
          doneBy: 'sam.patel',
          doneOn: '2026-02-30',
        }),
      ),
      /names 2026-02-30 as its day, which is not a day/,
    ],
    [
      'an item neither done nor not done',
      problems(withEntry({ item: 'decisionLetter', done: 'yes', doneBy: null, doneOn: null })),
      /is neither done nor not done/,
    ],
    [
      'an item done that does not say when',
      problems(
        withEntry({ item: 'decisionLetter', done: true, doneBy: 'sam.patel', doneOn: null }),
      ),
      /"decisionLetter" is done, and does not say both who did it and when/,
    ],
    [
      'an item not done that names someone not of the demo',
      problems(withEntry({ item: 'decisionLetter', done: false, doneBy: 'someone', doneOn: null })),
      /names someone, who is not one of the demo's people/,
    ],
    [
      'a grievance with a checklist',
      problems([
        { ...CASES.find((kase) => kase.number === 'CASE-2042'), checklist: appeal.checklist },
      ]),
      /CASE-2042 is a grievance, and holds a checklist/,
    ],
    // Since 0.7.0: an appeal's decision, which its review writes when it decides it.
    [
      'a decided appeal with no decision',
      problems([{ ...CASES.find((kase) => kase.number === 'CASE-2043'), decision: undefined }]),
      /CASE-2043 is decided, and its decision is null, not upheld or overturned/,
    ],
    [
      'a decided appeal with a decision its review never writes',
      problems([{ ...CASES.find((kase) => kase.number === 'CASE-2043'), decision: 'upheld!' }]),
      /CASE-2043 is decided, and its decision is upheld!, not upheld or overturned/,
    ],
    [
      'an appeal in review with a decision',
      problems([{ ...appeal, decision: 'overturned' }]),
      /CASE-2041 is inReview, not decided, and holds a decision/,
    ],
    [
      'a grievance with a decision',
      problems([{ ...CASES.find((kase) => kase.number === 'CASE-2042'), decision: 'upheld' }]),
      /CASE-2042 is a grievance, and holds a decision/,
    ],
  ];
  for (const [what, found, pattern] of cases)
    expect(
      found.length === 1 && pattern.test(found[0]),
      `data.mjs with ${what} is refused`,
      found.join('\n'),
    );
  let thrown = '';
  try {
    readAppealChecklist(JSON.stringify({ version: 2, cards: [{ id: 'a', fields: ['dc:title'] }] }));
  } catch (error) {
    thrown = error.message;
  }
  expect(
    /has 0 checklist cards, not one/.test(thrown),
    'a Case layout with no checklist card is refused',
    thrown,
  );

  // The seed itself refuses such data, before it asks the server anything: run from a copy of the
  // kit whose data.mjs has CLAIM-000144 paid, the claim CASE-2041 appeals.
  const copy = mkdtempSync(join(tmpdir(), 'payers-seed-'));
  try {
    const KIT = join(DEMO, '..');
    for (const part of ['demo', 'workflow', 'bundle'])
      cpSync(join(KIT, part), join(copy, part), { recursive: true });
    const data = join(copy, 'demo', 'data.mjs');
    const written = readFileSync(data, 'utf8');
    const paid = written.replace(/(number: 'CLAIM-000144',[\s\S]*?status: )'denied'/, "$1'paid'");
    expect(paid !== written, 'the copy of data.mjs has CLAIM-000144 paid');
    writeFileSync(data, paid);
    await against({}, async ({ server, run }) => {
      const { status, output } = await run({}, join(copy, 'demo', 'seed.mjs'));
      expect(
        status === 1 &&
          /data.mjs disagrees with the Case page's checklist/.test(output) &&
          /CASE-2041 appeals CLAIM-000144, which is paid, not denied/.test(output) &&
          server.calls.length === 0,
        'the seed refuses an appeal against a claim that is not denied, before it asks the server anything',
        output,
      );
    });
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// The claims' lifecycle.
await against({ workflowModel: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.3.0 or older .* no PayersClaimReview workflow .* upgrade it to 0.8.0/.test(
        output,
      ) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.3.0 of the package, with no claims review workflow, is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the lifecycle, exits 0', first.output);
  // As version 0.3.0 left them: in the default lifecycle's first state, now this one's legacy.
  for (const claim of CLAIMS) at(server, `claims/${claim.number.toLowerCase()}`).state = 'project';
  const upgraded = await run();
  expect(
    upgraded.status === 0 &&
      CLAIMS.every((claim) => {
        const document = at(server, `claims/${claim.number.toLowerCase()}`);
        return (
          document.state === claim.status && document.properties['claim:status'] === claim.status
        );
      }) &&
      /moved {4}CLAIM-000130 from project to paid: submit, review, approve, pay/.test(
        upgraded.output,
      ),
    'a claim created before 0.4.0, in project, is brought through submit to its status',
    upgraded.output,
  );
  // Reviewed since, though data.mjs has it submitted: no transition leads back.
  const reviewed = at(server, 'claims/claim-000140');
  reviewed.state = 'inReview';
  const stuck = await run();
  expect(
    stuck.status === 1 &&
      /CLAIM-000140 is inReview, and the claim lifecycle has no way from there to submitted/.test(
        stuck.output,
      ) &&
      reviewed.state === 'inReview',
    'a claim no transition can bring to its status stops the run with exit 1, naming it, its state as it was',
    stuck.output,
  );
});
await against({ statusOnly: 'CLAIM-000131' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /The claims are not in their statuses' states/.test(output) &&
      /CLAIM-000131 is submitted with status inReview, not inReview/.test(output),
    "a claim read back in another state than its status fails the seed's check",
    output,
  );
});

// The demo's people: in their groups, with the demo password, and put back when changed by hand.
await against({}, async ({ server, run, demoPassword }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the people, exits 0', first.output);
  expect(!first.output.includes(demoPassword), 'the demo password is never printed', first.output);
  const dana = server.users.get('dana.lee');
  const morgan = server.users.get('morgan.chen');
  expect(
    dana?.password === demoPassword &&
      JSON.stringify(dana?.properties.groups) === '["claims-adjusters"]' &&
      JSON.stringify(morgan?.properties.groups) === '["claims-adjusters","claims-supervisors"]' &&
      server.users.get('riley.brooks')?.properties.groups.includes('member-services') &&
      dana?.properties.company === MARKER,
    'each user has the demo password, their groups and the marker',
  );
  const aclOf = (place) =>
    (server.acls.get(server.byPath.get(place).uid) ?? [])
      .map((a) => `${a.username}:${a.permission}`)
      .sort();
  expect(
    JSON.stringify(aclOf(ROOT)) ===
      JSON.stringify([
        'claims-adjusters:Read',
        'claims-supervisors:Read',
        'member-services:Read',
      ]) &&
      JSON.stringify(aclOf(`${ROOT}/claims`)) ===
        JSON.stringify(['claims-adjusters:ReadWrite', 'claims-supervisors:ReadWrite']) &&
      aclOf(`${ROOT}/members`).length === 0,
    'the workspace and the claims folder give each group the permissions data.mjs names, once',
    JSON.stringify({ workspace: aclOf(ROOT), claims: aclOf(`${ROOT}/claims`) }),
  );
  // A permission of a demo group that data.mjs does not name is removed; anyone else's stays.
  const ace = (username, permission) => ({
    id: `${username}:${permission}:true:x::`,
    username,
    permission,
    granted: true,
    status: 'effective',
  });
  server.acls.set(server.byPath.get(`${ROOT}/members`).uid, [
    ace('claims-adjusters', 'Everything'),
    ace('someone', 'Write'),
  ]);
  dana.password = 'changed by hand';
  dana.properties.groups = ['member-services'];
  const second = await run();
  expect(
    second.status === 0 &&
      dana.password === demoPassword &&
      JSON.stringify(dana.properties.groups) === '["claims-adjusters"]',
    'a password and groups changed by hand are put back',
    second.output,
  );
  expect(
    /1 removed/.test(second.output) &&
      JSON.stringify(aclOf(`${ROOT}/members`)) === JSON.stringify(['someone:Write']),
    "a demo group's permission data.mjs does not name is removed, and someone else's is kept",
    second.output,
  );
});

// A user or a group of the demo's names that the seed did not create is left alone, and found
// before anything is written.
await against({}, async ({ server, run }) => {
  server.groups.set('member-services', { groupname: 'member-services', properties: {} });
  const { status, output } = await run();
  expect(
    status === 2 &&
      /a group member-services that the seed did not create/.test(output) &&
      server.groups.get('member-services').properties.description === undefined &&
      server.calls.every((call) => call.startsWith('GET ')),
    'a member-services group the seed did not create is exit 2, with nothing written',
    output,
  );
});
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run, before a user is replaced, exits 0');
  server.users.set('sam.patel', {
    properties: { username: 'sam.patel', company: 'Someone else', groups: [] },
    password: 'theirs',
  });
  const { status, output } = await run();
  const sam = server.users.get('sam.patel');
  expect(
    status === 2 &&
      /a user sam.patel that the seed did not create/.test(output) &&
      sam.password === 'theirs' &&
      sam.properties.groups.length === 0,
    'a sam.patel the seed did not create is exit 2, untouched',
    output,
  );
});

// What each user may do is checked as them, wherever the permission comes from.
await against({ membersWrite: true }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /riley.brooks may change a member/.test(output) &&
      /riley.brooks holds WriteProperties on a claim/.test(output) &&
      /dana.lee may change an appeal, and would be offered its checklist's tick boxes/.test(output),
    'a server that lets every member change records fails the run: member services may not change a claim, nor adjusters a case',
    output,
  );
});

// Each user must sign in as themself, in their groups: the demo signs in as them.
await against({ guestFor: 'dana.lee' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /dana.lee signs in as Anonymous/.test(output),
    'a user the server answers as Anonymous fails the run',
    output,
  );
});
await against({ groupless: 'riley.brooks' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 &&
      /riley.brooks signs in as riley.brooks, in members, not in member-services/.test(output),
    'a user who is not in their groups fails the run',
    output,
  );
});

// The search index a moment behind: the checks are asked again until it has caught up.
await against({ indexLag: 3 }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 0 && /waiting {2}\d+ disagreement\(s\)/.test(output),
    'a search index that lags is waited for, and the run then passes',
    output,
  );
});

// The aggregates the queues' facets and the home's KPIs read must be answered, by each queue.
for (const [pageProvider, aggregate] of [
  ['payers_unassigned_claims', 'claim_status_agg'],
  ['payers_my_claims', 'claim_status_agg'],
  ['payers_pending_claims', 'claim_status_agg'],
  ['payers_open_appeals', 'case_state_agg'],
]) {
  await against({ noAggregations: pageProvider }, async ({ run }) => {
    const { status, output } = await run();
    expect(
      status === 1 &&
        new RegExp(`${pageProvider}( as \\S+)? answered no ${aggregate}`).test(output),
      `${pageProvider} answering no aggregates fails the run`,
      output,
    );
  });
}

// Two trashed copies of one record: the seed restores only one, so it stops.
await against({}, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run before two trashed copies exits 0');
  const first = at(server, 'providers/prv-201');
  server.trash(first);
  server.add(`${ROOT}/providers/prv-201`, 'Provider');
  server.trash(at(server, 'providers/prv-201'));
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named prv-201/.test(output),
    'two trashed copies of one record stop the run',
    output,
  );
});

// The same, on a server whose pages hold one entry: the second copy is on the next page.
await against({ pageSize: 1 }, async ({ server, run }) => {
  expect((await run()).status === 0, 'a first run, one entry a page, exits 0');
  server.trash(at(server, 'providers/prv-201'));
  server.add(`${ROOT}/providers/prv-201`, 'Provider');
  server.trash(at(server, 'providers/prv-201'));
  const { status, output } = await run();
  expect(
    status === 1 && /holds 2 trashed documents named prv-201/.test(output),
    'two trashed copies stop the run when the second is on the next page',
    output,
  );
});

// A trashed sibling whose name only starts with the record's is not the record: LIKE's `_` and
// `%` match it, the exact name does not.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(`${ROOT}/members`, 'Folder');
  const backup = server.add(`${ROOT}/members/member-100048.backup`, 'Member', {
    'dc:title': 'a backup, not the seed’s',
  });
  server.trash(backup);
  const { status, output } = await run();
  expect(
    status === 0 &&
      /0 restored from the trash/.test(output) &&
      backup.isTrashed === true &&
      backup.properties['dc:title'] === 'a backup, not the seed’s' &&
      at(server, 'members/member-100048')?.uid !== backup.uid,
    'a trashed member-100048.backup is left in the trash, untouched, and the member created',
    output,
  );
  const member = at(server, 'members/member-100048');
  server.trash(member);
  const again = await run();
  expect(
    again.status === 0 &&
      /1 restored from the trash/.test(again.output) &&
      member.isTrashed === false &&
      backup.isTrashed === true,
    'with both trashed, the member is restored and the backup is not',
    again.output,
  );
});

// Since 0.8.0, the letters: nuxeo-agentic-letters and the kit's facet required, every claim and
// case given its member's language, the six templates kept and checked, and data.mjs's templates
// held to what the add-on takes before the server is asked anything.
await against({ letters: false }, async ({ server, run }) => {
  const { status, output } = await run();
  expect(
    status === 2 &&
      /version 0.7.0 or older .* no letters on claims .* upgrade it to 0.8.0/.test(output) &&
      server.calls.every((call) => call.startsWith('GET ')),
    'version 0.7.0 of the package, with no Correspondence facet on claims, is exit 2, with nothing written',
    output,
  );
});
await against(
  { types: ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument', 'PayersClaimSearch'] },
  async ({ server, run }) => {
    const { status, output } = await run();
    expect(
      status === 2 &&
        /no LetterTemplate type: install nuxeo-agentic-letters/.test(output) &&
        server.calls.every((call) => call.startsWith('GET ')),
      'a server without nuxeo-agentic-letters is exit 2, with nothing written',
      output,
    );
  },
);
await against({}, async ({ server, run }) => {
  const first = await run();
  expect(first.status === 0, 'a first run, for the letters, exits 0', first.output);
  const languages = new Map(MEMBERS.map((member) => [member.number, member.language]));
  expect(
    CLAIMS.every(
      (claim) =>
        at(server, `claims/${claim.number.toLowerCase()}`)?.properties['corr:language'] ===
        languages.get(claim.member),
    ) &&
      CASES.every(
        (kase) =>
          at(server, `cases/${kase.number.toLowerCase()}`)?.properties['corr:language'] ===
          languages.get(kase.member),
      ),
    "every claim and case holds its member's language, for its letters",
  );
  expect(
    at(server, 'claims/claim-000144')?.properties['corr:language'] === 'es' &&
      at(server, 'cases/case-2043')?.properties['corr:language'] === 'en',
    "the Spanish-speaking member's denied claim is in es, the decided appeal in en",
  );
  const kept = LETTER_TEMPLATES.map((template) => ({
    template,
    document: at(server, `templates/${template.name}`),
  }));
  expect(
    kept.length === 6 &&
      kept.every(
        ({ template, document }) =>
          document?.type === 'LetterTemplate' &&
          document.properties['tmpl:templateName'] === template.name &&
          document.properties['tmpl:templateType'] === 'agenticLetter' &&
          JSON.stringify(document.properties['tmpl:applicableTypes']) ===
            JSON.stringify(template.types) &&
          document.properties['ltpl:letter'] === template.letter &&
          document.properties['ltpl:language'] === template.language &&
          JSON.stringify(document.properties['ltpl:conditions']) ===
            JSON.stringify(template.conditions) &&
          server.blobs
            .get(document.uid)
            ?.bytes.equals(readFileSync(join(LETTERS_DIR, template.file))),
      ),
    'the six letter templates are kept in the templates folder, each with its properties and its text',
    JSON.stringify(kept.map(({ document }) => document?.path ?? null)),
  );
  const folder = at(server, 'templates');
  const aces = server.acls.get(folder?.uid) ?? [];
  expect(
    ['claims-adjusters', 'claims-supervisors', 'member-services'].every((group) =>
      aces.some((ace) => ace.username === group && ace.permission === 'Read'),
    ) && !aces.some((ace) => ace.permission === 'ReadWrite'),
    'the templates folder gives every demo group Read, and none ReadWrite',
    JSON.stringify(aces),
  );

  // A template's text changed by hand is put back, and the others are not uploaded again.
  const denial = at(server, 'templates/payers-denial-en');
  server.blobs.set(denial.uid, { bytes: Buffer.from('<p>{{claim:number}}</p>'), name: 'x.html' });
  denial.properties['ltpl:language'] = 'sv';
  const second = await run();
  expect(
    second.status === 0 &&
      /1 file\(s\) uploaded/.test(second.output) &&
      server.blobs
        .get(denial.uid)
        ?.bytes.equals(readFileSync(join(LETTERS_DIR, 'payers-denial-en.html'))) &&
      denial.properties['ltpl:language'] === 'en',
    "a template's text and language changed by hand are put back, uploading that one file alone",
    second.output,
  );

  // Someone outside the demo's groups given ReadWrite on the templates: everyone may change them,
  // as every user is in members, and the run fails, naming them.
  server.acls.set(folder.uid, [
    ...(server.acls.get(folder.uid) ?? []),
    {
      id: 'members:ReadWrite:true:x::',
      username: 'members',
      permission: 'ReadWrite',
      granted: true,
      status: 'effective',
    },
  ]);
  const third = await run();
  expect(
    third.status === 1 && /may change the letter template payers-denial-en/.test(third.output),
    'a letter template a demo user may change fails the run, naming it',
    third.output,
  );
});
await against({ languageDrift: 'CLAIM-000144' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /CLAIM-000144's letters are in null, not es/.test(output),
    'a claim read back with no language fails the run, naming it',
    output,
  );
});
await against({ templateDrift: 'payers-denial-es' }, async ({ run }) => {
  const { status, output } = await run();
  expect(
    status === 1 && /payers-denial-es's ltpl:letter is "payers.somethingElse"/.test(output),
    'a letter template read back as another letter fails the run, naming it',
    output,
  );
});
{
  // The kit's own templates are what the add-on takes; broken copies are refused, before the server
  // is asked anything, naming what each breaks.
  const records = { Claim: CLAIMS, Case: CASES };
  expect(
    letterProblems(LETTER_TEMPLATES, { records, offered }).length === 0,
    "data.mjs's six letter templates are what nuxeo-agentic-letters takes",
    JSON.stringify(letterProblems(LETTER_TEMPLATES, { records, offered })),
  );
  const original = readFileSync(join(LETTERS_DIR, 'payers-denial-es.html'), 'utf8');
  const broken = [
    ['${claim:number}', /holds "\$\{"/, 'a FreeMarker expression'],
    ['<#assign x = 1>', /holds "<#"/, 'a FreeMarker directive'],
    ['#set($x = 1)', /holds a Velocity directive/, 'a Velocity directive'],
    ['<script>x()</script>', /has a <script> tag/, 'a script'],
    ['<p onclick="x()">x</p>', /<p> has the attribute onclick/, 'an event handler'],
    ['<p style="background: url(x)">x</p>', /holds "url\("/, 'a style that fetches a URL'],
    ['{{principal.name}}', /\{\{principal.name\}\} is not one the add-on takes/, 'the person'],
    ['{{ecm:acl}}', /names ecm:acl, which Claim does not have/, 'a system property'],
    ['{{claim:nope}}', /names claim:nope, which Claim does not have/, 'a property Claim lacks'],
    [
      '{{claim:member>member:address>member:city}}',
      /is not one the add-on takes/,
      'two hops through references',
    ],
  ];
  for (const [inserted, refused, what] of broken) {
    const text = original.replace('</body>', `<p>${inserted}</p>\n</body>`);
    const problems = letterProblems(LETTER_TEMPLATES, {
      records,
      offered,
      read: (file) =>
        file === 'payers-denial-es.html'
          ? Buffer.from(text)
          : readFileSync(join(LETTERS_DIR, file)),
    });
    expect(
      problems.some((problem) => problem.startsWith('payers-denial-es') && refused.test(problem)),
      `a template holding ${what} is refused, naming it`,
      JSON.stringify(problems),
    );
  }
  const both = LETTER_TEMPLATES.map((template) =>
    template.name === 'payers-appeal-overturned-en'
      ? { ...template, conditions: ['case:category=appeal'] }
      : template,
  );
  expect(
    letterProblems(both, { records, offered }).some((problem) =>
      /CASE-2043 fits 2 payers.appealOutcome templates in en/.test(problem),
    ),
    'two templates of one letter in one language that fit the same appeal are refused',
  );
  const noEnglish = LETTER_TEMPLATES.filter((template) => template.name !== 'payers-denial-en');
  expect(
    letterProblems(noEnglish, { records, offered }).some((problem) =>
      /payers.denial has no en template/.test(problem),
    ),
    "a letter with no English template, the add-on's default language, is refused",
  );

  // The seed itself refuses such a template, before it asks the server anything: run from a copy
  // of the kit whose Spanish denial letter names the social security number through a FreeMarker
  // expression.
  const copy = mkdtempSync(join(tmpdir(), 'payers-seed-letters-'));
  try {
    const KIT = join(DEMO, '..');
    for (const part of ['demo', 'workflow', 'bundle', 'content-model.json'])
      cpSync(join(KIT, part), join(copy, part), { recursive: true });
    writeFileSync(
      join(copy, 'demo', 'letters', 'payers-denial-es.html'),
      original.replace('</body>', '<p>${claim.member.ssn}</p>\n</body>'),
    );
    await against({}, async ({ server, run }) => {
      const { status, output } = await run({}, join(copy, 'demo', 'seed.mjs'));
      expect(
        status === 1 &&
          /letter templates are not what nuxeo-agentic-letters takes/.test(output) &&
          /payers-denial-es holds "\$\{"/.test(output) &&
          server.calls.length === 0,
        'the seed refuses a letter template the add-on would refuse, before it asks the server anything',
        output,
      );
    });
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

// A place holding another type is left alone.
await against({}, async ({ server, run }) => {
  server.add(ROOT, 'Workspace');
  server.add(`${ROOT}/members`, 'Folder');
  server.add(`${ROOT}/members/member-100048`, 'File', { 'dc:title': 'not the seed’s' });
  const { status, output } = await run();
  expect(
    status === 1 &&
      /is a File, not a Member/.test(output) &&
      at(server, 'members/member-100048').properties['dc:title'] === 'not the seed’s',
    'a File at a member’s place stops the run, untouched',
    output,
  );
});

// The checks are live, page after page.
for (const broken of PAGE_PROVIDERS) {
  await against({ brokenProvider: broken }, async ({ run }) => {
    const { status, output } = await run();
    expect(
      status === 1 && output.includes('The page providers disagree') && output.includes(broken),
      `${broken} returning nothing fails the run`,
      output,
    );
  });
}
await against({ pageSize: 1 }, async ({ run }) => {
  const { status, output } = await run();
  expect(status === 0, 'every page is read: one record a page still checks out', output);
});

if (failures.length > 0) {
  console.error(`seed selftest: ${failures.length} of ${controls} controls failed\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`seed selftest: all ${controls} controls behaved as required.`);
