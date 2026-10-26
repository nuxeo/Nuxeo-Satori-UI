#!/usr/bin/env node
/**
 * Seed the local Nuxeo repository with the content "Acme Insurance" browses in
 * the mock-customer screencast.
 *
 * ## Why this exists rather than a fixture in the app
 *
 * The scene has to show a customer-built UI reading **real documents out of a
 * real repository**. Mocking the data in the application would make the whole
 * recording worthless, so the documents are created through the ordinary Nuxeo
 * REST API and the application then reads them the same way any client would.
 * Everything this writes is a genuine `Workspace`/`Folder`/`File`/`Note` with a
 * genuine blob, indexed by the same OpenSearch instance the product uses.
 *
 * ## What it writes
 *
 * - `/default-domain/workspaces/acme-insurance` — the customer's workspace, with
 *   three folders and a dozen documents carrying real Dublin Core metadata and
 *   text blobs, so full-text search has something to find.
 *
 * Nothing about configuration: the manifest the screencast applies is a fragment
 * the scene serves beside the bundle, as a configuration package's would be, not
 * a document in the repository.
 *
 * Idempotent: the workspace is deleted and rebuilt on every run.
 *
 * Usage:
 *   node tools/video/mock-customer/seed-nuxeo.mjs
 *   node tools/video/mock-customer/seed-nuxeo.mjs --check   # verify only
 *
 * Credentials come from `NUXEO_USER` / `NUXEO_PASS`, with no default. They used to
 * fall back to the local Docker instance's administrator pair, citing CLAUDE.md,
 * which said the same; both were corrected by NXSAT-649. Run directly, a missing
 * pair exits 2 before anything is written; imported (scene 3 calls `check()`),
 * the first request throws instead, so the caller decides. Nothing here is
 * ever pointed at a deployed server: `NUXEO_BASE` defaults to localhost:8080 and
 * the script refuses a non-loopback host unless `--allow-remote` is passed.
 */

import {
  basicAuthorization,
  nuxeoCredentialsOrExit,
  requireNuxeoCredentials,
} from '../../../scripts/beta-harness/nuxeo-credentials.mjs';

const BASE = (process.env['NUXEO_BASE'] ?? 'http://localhost:8080').replace(/\/$/, '');

const ARGS = new Set(process.argv.slice(2));

/** Where the customer's content lives. */
export const ACME_WORKSPACE_PATH = '/default-domain/workspaces/acme-insurance';

function assertLocal() {
  const host = new URL(BASE).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local && !ARGS.has('--allow-remote')) {
    throw new Error(
      `${BASE} is not loopback. This script writes documents; pass --allow-remote if you really mean it.`,
    );
  }
}

// Read per request, not at import: scene 3 imports this module for `check()`, and an import that
// exits would take the recording with it.
const authHeader = () =>
  basicAuthorization(requireNuxeoCredentials('seed or check the mock-customer content'));

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE}/nuxeo/api/v1${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function exists(path) {
  const res = await fetch(`${BASE}/nuxeo/api/v1/path${path}`, {
    headers: { Authorization: authHeader() },
  });
  return res.status === 200;
}

async function removeIfPresent(path) {
  if (!(await exists(path))) return false;
  await api(`/path${path}`, { method: 'DELETE' });
  return true;
}

async function createChild(parentPath, { type, name, properties }) {
  return api(`/path${parentPath}`, {
    method: 'POST',
    body: { 'entity-type': 'document', type, name, properties },
  });
}

/** Upload a text blob into a batch and attach it to a new `File` document. */
async function createFileWithBlob(parentPath, { name, title, text, properties = {} }) {
  const batch = await api('/upload', { method: 'POST' });
  const batchId = batch['batchId'];
  await fetch(`${BASE}/nuxeo/api/v1/upload/${batchId}/0`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'text/plain',
      'X-Upload-Type': 'normal',
      'X-File-Name': `${name}.txt`,
      'X-File-Type': 'text/plain',
      'X-File-Size': String(Buffer.byteLength(text)),
    },
    body: text,
  }).then((res) => {
    if (!res.ok) throw new Error(`blob upload for ${name} → HTTP ${res.status}`);
  });

  return createChild(parentPath, {
    type: 'File',
    name,
    properties: {
      'dc:title': title,
      ...properties,
      'file:content': { 'upload-batch': batchId, 'upload-fileId': '0' },
    },
  });
}

/**
 * The content itself.
 *
 * Written as insurance documents rather than lorem ipsum for one practical
 * reason: the screencast searches for "hurricane" and "flood" and the results
 * have to be recognisably relevant on screen, which only works if the blobs
 * really contain those words and OpenSearch really indexed them.
 */
const FOLDERS = [
  {
    name: 'claims',
    title: 'Claims',
    description: 'Open and settled claims, 2026 policy year.',
    files: [
      {
        name: 'clm-2026-0431',
        title: 'Claim CLM-2026-0431 — Hurricane Wind Damage',
        properties: {
          'dc:description':
            'Roof and siding damage following Hurricane Delia. Adjuster inspection complete, reserve set at 48,200 USD.',
          'dc:source': 'Field adjuster report',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'CLAIM SUMMARY CLM-2026-0431',
          'Peril: hurricane wind damage. Policy HO-88213. Loss date 2026-03-11.',
          'Insured reports roof covering loss and siding separation on the north elevation',
          'following Hurricane Delia landfall. Field adjuster confirmed 1,850 sq ft of',
          'shingle replacement plus gutter and fascia repair. Reserve 48,200 USD.',
          'Coverage A applies; hurricane deductible of 2% of dwelling limit applied.',
        ].join('\n'),
      },
      {
        name: 'clm-2026-0518',
        title: 'Claim CLM-2026-0518 — Basement Flood',
        properties: {
          'dc:description':
            'Flood water intrusion after storm drain backup. Coverage question referred to underwriting.',
          'dc:source': 'Desk adjuster referral',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'CLAIM SUMMARY CLM-2026-0518',
          'Peril: flood. Policy HO-90551. Loss date 2026-04-02.',
          'Municipal storm drain backup produced 14 inches of standing water in the',
          'finished basement. Surface water exclusion may apply; referred to underwriting',
          'for a coverage position before any payment is released.',
        ].join('\n'),
      },
      {
        name: 'clm-2026-0602',
        title: 'Claim CLM-2026-0602 — Commercial Fire',
        properties: {
          'dc:description':
            'Kitchen fire at insured restaurant. Business interruption schedule attached.',
          'dc:source': 'Large loss unit',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'CLAIM SUMMARY CLM-2026-0602',
          'Peril: fire. Policy CP-41207. Loss date 2026-05-19.',
          'Grease fire originating at the fryer line. Structural damage confined to the',
          'kitchen; smoke damage throughout the dining room. Business interruption',
          'projected at 31 days. Total incurred estimate 214,000 USD.',
        ].join('\n'),
      },
      {
        name: 'clm-2026-0644',
        title: 'Claim CLM-2026-0644 — Auto Collision',
        properties: {
          'dc:description': 'Two-vehicle collision, liability accepted, subrogation opened.',
          'dc:source': 'Auto claims unit',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'CLAIM SUMMARY CLM-2026-0644',
          'Peril: collision. Policy PA-77410. Loss date 2026-06-08.',
          'Rear-end collision at a signalised intersection. Liability accepted for the',
          'insured. Repair estimate 9,340 USD, rental for 11 days. Subrogation file',
          'opened against the third-party carrier.',
        ].join('\n'),
      },
    ],
    notes: [
      {
        name: 'claims-handling-standard',
        title: 'Claims Handling Standard — 2026',
        content: [
          'Acknowledge every new loss within one business day.',
          'Set an initial reserve before the first contact with the insured.',
          'Refer any coverage question to underwriting rather than deciding it in the file.',
          'Close or re-reserve every open claim at 30, 60 and 90 days.',
        ].join('\n'),
        properties: {
          'dc:description': 'The four rules every adjuster is measured against.',
          'dc:source': 'Claims operations',
          'dc:rights': 'Acme Insurance — internal',
        },
      },
    ],
  },
  {
    name: 'policies',
    title: 'Policies',
    description: 'Issued policy documents and endorsements.',
    files: [
      {
        name: 'ho-88213',
        title: 'Policy HO-88213 — Homeowners, Coastal',
        properties: {
          'dc:description':
            'Homeowners policy with a named-storm deductible endorsement. Dwelling limit 610,000 USD.',
          'dc:source': 'Policy administration',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'POLICY HO-88213 — HOMEOWNERS, COASTAL',
          'Dwelling limit 610,000 USD. Personal property 305,000 USD.',
          'Named-storm deductible: 2% of dwelling limit, applies to hurricane losses.',
          'All-other-perils deductible 2,500 USD. Effective 2026-01-01.',
        ].join('\n'),
      },
      {
        name: 'ho-90551',
        title: 'Policy HO-90551 — Homeowners, Inland',
        properties: {
          'dc:description': 'Homeowners policy, no flood endorsement in force.',
          'dc:source': 'Policy administration',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'POLICY HO-90551 — HOMEOWNERS, INLAND',
          'Dwelling limit 385,000 USD. Deductible 1,500 USD.',
          'No flood endorsement in force. Surface water exclusion is unamended.',
          'Effective 2026-02-15.',
        ].join('\n'),
      },
      {
        name: 'cp-41207',
        title: 'Policy CP-41207 — Commercial Property',
        properties: {
          'dc:description':
            'Restaurant package: building, contents and business interruption cover.',
          'dc:source': 'Policy administration',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'POLICY CP-41207 — COMMERCIAL PROPERTY',
          'Building 1,200,000 USD. Contents 340,000 USD.',
          'Business interruption: 12 months actual loss sustained.',
          'Protective safeguards warranty applies to the kitchen suppression system.',
        ].join('\n'),
      },
    ],
    notes: [],
  },
  {
    name: 'underwriting',
    title: 'Underwriting',
    description: 'Referrals, coverage positions and portfolio reviews.',
    files: [
      {
        name: 'coverage-position-0518',
        title: 'Coverage Position — CLM-2026-0518 Flood Referral',
        properties: {
          'dc:description':
            'Underwriting response to the basement flood referral. Position: exclusion applies in part.',
          'dc:source': 'Underwriting desk',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'COVERAGE POSITION — CLM-2026-0518',
          'The policy excludes flood and surface water. The storm drain backup is a',
          'covered water backup peril under the endorsement purchased in 2025, capped',
          'at 25,000 USD. Position: pay to the sub-limit, deny the balance, issue a',
          'reservation of rights letter.',
        ].join('\n'),
      },
      {
        name: 'coastal-portfolio-review',
        title: 'Coastal Portfolio Review — Q2 2026',
        properties: {
          'dc:description':
            'Aggregate hurricane exposure by county, with a recommendation to cap new coastal business.',
          'dc:source': 'Catastrophe modelling team',
          'dc:rights': 'Acme Insurance — internal',
        },
        text: [
          'COASTAL PORTFOLIO REVIEW — Q2 2026',
          'Modelled hurricane aggregate exposure rose 11% quarter on quarter, driven by',
          'new business in two coastal counties. Recommendation: cap new coastal',
          'homeowners business until the reinsurance treaty renews.',
        ].join('\n'),
      },
    ],
    notes: [
      {
        name: 'referral-thresholds',
        title: 'Referral Thresholds',
        content: [
          'Refer to underwriting when: any coverage question arises, incurred exceeds',
          '100,000 USD, the loss involves flood or earth movement, or the policy is',
          'within 60 days of inception.',
        ].join('\n'),
        properties: {
          'dc:description': 'When an adjuster must stop and ask.',
          'dc:source': 'Underwriting desk',
          'dc:rights': 'Acme Insurance — internal',
        },
      },
    ],
  },
];

async function seed() {
  assertLocal();

  // ---- the customer's content ------------------------------------------------
  const removed = await removeIfPresent(ACME_WORKSPACE_PATH);
  if (removed) console.log(`  removed existing ${ACME_WORKSPACE_PATH}`);

  await createChild('/default-domain/workspaces', {
    type: 'Workspace',
    name: 'acme-insurance',
    properties: {
      'dc:title': 'Acme Insurance',
      'dc:description': 'Claims, policies and underwriting for the Acme Insurance book.',
    },
  });
  console.log(`  created ${ACME_WORKSPACE_PATH}`);

  let documents = 0;
  for (const folder of FOLDERS) {
    await createChild(ACME_WORKSPACE_PATH, {
      type: 'Folder',
      name: folder.name,
      properties: { 'dc:title': folder.title, 'dc:description': folder.description },
    });
    const folderPath = `${ACME_WORKSPACE_PATH}/${folder.name}`;

    for (const file of folder.files) {
      await createFileWithBlob(folderPath, file);
      documents += 1;
    }
    for (const note of folder.notes) {
      await createChild(folderPath, {
        type: 'Note',
        name: note.name,
        properties: {
          'dc:title': note.title,
          'note:note': note.content,
          'note:mime_type': 'text/plain',
          ...note.properties,
        },
      });
      documents += 1;
    }
    console.log(`  ${folder.title}: ${folder.files.length + folder.notes.length} documents`);
  }

  return documents;
}

/**
 * Confirm the seeded content is readable **and indexed**.
 *
 * The second half matters: the screencast searches for "hurricane", and a
 * document that exists but has not reached OpenSearch yet produces an empty
 * result list on camera. So this polls the full-text index rather than assuming
 * the write is enough.
 */
export async function check({ quiet = false } = {}) {
  const children = await api(`/path${ACME_WORKSPACE_PATH}/@children`, {
    headers: { properties: 'dublincore' },
  });
  const folders = children['entries'].map((e) => e['title']).sort();

  let hits = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const search = await api(
      `/search/lang/NXQL/execute?query=${encodeURIComponent(
        `SELECT * FROM Document WHERE ecm:fulltext = 'hurricane' AND ecm:path STARTSWITH '${ACME_WORKSPACE_PATH}' AND ecm:isTrashed = 0`,
      )}&pageSize=20`,
      { headers: { properties: 'dublincore' } },
    );
    hits = search['entries'].map((e) => e['title']);
    if (hits.length >= 2) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!quiet) {
    console.log(`  folders: ${folders.join(', ')}`);
    console.log(`  full-text "hurricane" → ${hits.length} hit(s): ${hits.join(' | ')}`);
  }

  const ok = folders.length === 3 && hits.length >= 2;
  if (!ok) throw new Error('seed verification failed — see the lines above');
  return { folders, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  nuxeoCredentialsOrExit('seed or check the mock-customer content');
  if (ARGS.has('--check')) {
    console.log(`\nChecking ${BASE}${ACME_WORKSPACE_PATH}`);
    await check();
    console.log('\nseed: OK\n');
  } else {
    console.log(`\nSeeding ${BASE}`);
    const documents = await seed();
    console.log(`\n  ${documents} documents written. Verifying…`);
    await check();
    console.log('\nseed: OK\n');
  }
}
