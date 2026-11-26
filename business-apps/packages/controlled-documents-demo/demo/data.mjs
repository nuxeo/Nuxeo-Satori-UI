/**
 * The controlled documents kit's fictional register: five engineering documents of a fictional
 * pumping station, each a chain of revisions, the last one current. Every name, project and person
 * is made up.
 *
 * A chain's first revision names its series; each later one is created naming the one before it
 * in `docctl:supersedes`, so the server gives it that revision's number and the next revision, and
 * marks the one before it superseded. The numbers are the server's: the seed never writes one.
 *
 * Since 0.3.0, two chains carry a fictional export-control mark, `mark`: a classification and the
 * groups that may receive the revision. The seed writes it on the chain's first revision, and the
 * server carries it to each one after, whatever the seed sends with it.
 */

/**
 * The workspace and the folder the records go in, under /default-domain/workspaces. A name is 24
 * characters at most: Nuxeo cuts a longer one to `nuxeo.path.segment.maxsize`, 24 by default, and
 * says nothing, so `controlled-documents-demo` was stored as `controlled-documents-dem` and the
 * seed's next request, to the name it had asked for, found nothing.
 */
export const WORKSPACE = {
  name: 'controlled-documents',
  title: 'Controlled documents (demo)',
};
export const FOLDER = { name: 'register', title: 'Document register' };

const PROJECT = 'Riverside Pumping Station';

/**
 * Each chain: its series, the revisions the series writes for it, in order, and each revision's
 * own place, title and fields. `issued` is days before the day the seed runs, so the register reads
 * the same whenever it is seeded.
 */
export const CHAINS = [
  {
    key: 'pump-house-ga',
    series: 'DWG',
    revisions: ['A', 'B', 'C'],
    fields: {
      category: 'Drawing',
      discipline: 'Mechanical',
      originator: 'avega',
      description: 'General arrangement of the pump house: pumps, pipework and the crane rail.',
    },
    issued: [120, 60, 10],
    purpose: ['For review', 'For review', 'For construction'],
  },
  {
    key: 'intake-screen',
    series: 'DWG',
    revisions: ['A', 'B'],
    fields: {
      category: 'Drawing',
      discipline: 'Civil',
      originator: 'kosei',
      description: 'The intake screen chamber, its bar screens and their supports.',
    },
    issued: [90, 30],
    purpose: ['For review', 'For construction'],
  },
  {
    key: 'single-line',
    series: 'DWG',
    // Since 0.3.0, a second revision, so that the seed shows a mark carried to the next one.
    revisions: ['A', 'B'],
    mark: { classification: 'EC-2', groups: ['ec2-cleared'] },
    fields: {
      category: 'Drawing',
      discipline: 'Electrical',
      originator: 'mlind',
      description:
        'Single-line diagram of the station, from the incoming supply to the motor starters.',
    },
    issued: [45, 15],
    purpose: ['For information', 'For construction'],
  },
  {
    key: 'pump-performance',
    series: 'SPEC',
    revisions: ['1', '2'],
    fields: {
      category: 'Specification',
      discipline: 'Mechanical',
      originator: 'avega',
      description: 'Duty points, efficiencies and the tests the pumps are accepted on.',
    },
    issued: [100, 20],
    purpose: ['For review', 'For construction'],
  },
  {
    key: 'commissioning',
    series: 'SPEC',
    revisions: ['1'],
    mark: { classification: 'EC-1', groups: ['ec1-cleared'] },
    fields: {
      category: 'Procedure',
      discipline: 'Process',
      originator: 'kosei',
      description: 'The order the station is commissioned in, system by system, and who signs off.',
    },
    issued: [5],
    purpose: ['For information'],
  },
];

// ------------------------------------------------------------------ since 0.2.0: the people

/**
 * How the seed knows the users and groups it created again: a user's `company`, a group's
 * `description`. It changes no user or group without it.
 */
export const MARKER = 'Controlled documents kit demo (fictional)';

/**
 * The kit's groups: the two `app.json` serves the app to, and, since 0.3.0, the two fictional
 * export-control marks' groups, whose members may receive a revision so marked.
 */
export const GROUPS = [
  { name: 'document-controllers', label: 'Document controllers' },
  { name: 'engineers', label: 'Engineers' },
  { name: 'ec1-cleared', label: 'Cleared for EC-1 (fictional)' },
  { name: 'ec2-cleared', label: 'Cleared for EC-2 (fictional)' },
];

/**
 * The demo's people: the originators the register already names, now users the seed creates, each
 * with the password `CONTROLLED_DOCUMENTS_DEMO_PASSWORD` gives. Fictional.
 */
export const USERS = [
  {
    username: 'avega',
    firstName: 'Ana',
    lastName: 'Vega',
    groups: ['document-controllers', 'engineers', 'ec1-cleared', 'ec2-cleared'],
  },
  {
    username: 'kosei',
    firstName: 'Kofi',
    lastName: 'Osei',
    groups: ['engineers', 'ec2-cleared'],
  },
  {
    username: 'mlind',
    firstName: 'Maja',
    lastName: 'Lind',
    groups: ['engineers', 'ec1-cleared'],
  },
];

/**
 * Since 0.3.0: whom each fictional mark lets receive a revision, and whom it excludes, so that the
 * demo shows both. `CLEARED` holds EC-2, the single-line diagram's; `UNCLEARED` does not.
 */
export const CLEARED = 'kosei';
export const UNCLEARED = 'mlind';

/** Who issues the demo's transmittals, and receives one: demo steps 1 and 2. */
export const ENGINEER = 'avega';
export const RECIPIENT = 'kosei';

/**
 * The groups' permissions on the workspace, in its local ACL, which everything in it inherits: both
 * may read and write the register, the transmittals and the review cycles. The server decides the
 * rest: only a receipt's recipient answers it, only a cycle's opener resolves and closes it. Since
 * 0.3.0, document controllers hold the add-on's `ChangeExportMark` too, so that they set, change and
 * remove a revision's mark; engineers do not.
 */
export const GRANTS = [
  { group: 'engineers', permission: 'ReadWrite' },
  { group: 'document-controllers', permission: 'ReadWrite' },
  { group: 'document-controllers', permission: 'ChangeExportMark' },
];

// ------------------------------------------------------------------ since 0.2.0: transmittals and reviews

/** The register of transmittals, whose Create menu offers a transmittal, and the review cycles' folder. */
export const TRANSMITTALS = {
  name: 'transmittals',
  title: 'Transmittals',
  type: 'TransmittalRegister',
};
export const REVIEWS = { name: 'reviews', title: 'Review cycles', type: 'Folder' };

/**
 * The transmittal the seed issues, as `ENGINEER`: two documents by number, each at its current
 * revision, to two recipients, for review. `acknowledgedBy` answer it; the others' receipts await.
 */
export const TRANSMITTAL = {
  name: 'tr-pump-house',
  title: 'Pump house drawings and pump specification, for review',
  issuer: 'avega',
  chains: ['pump-house-ga', 'pump-performance'],
  recipients: ['kosei', 'mlind'],
  purpose: 'review',
  dueInDays: 14,
  message: 'Please review the general arrangement and the duty points before the design freeze.',
  acknowledgedBy: ['kosei'],
};

/**
 * The review cycle the seed opens, on a chain's current revision, as its opener, who may write it.
 * Each reviewer writes one thread in it; the opener resolves those with a `resolution`, and the
 * others stay open, so that the cycle cannot close yet.
 */
export const REVIEW = {
  name: 'review-intake-screen',
  chain: 'intake-screen',
  opener: 'kosei',
  reviewers: ['avega', 'mlind'],
  dueInDays: 10,
  threads: [
    {
      by: 'avega',
      text: 'The bar spacing on section B-B does not match the screen schedule.',
      resolution: 'Schedule corrected to 25 mm spacing.',
    },
    { by: 'mlind', text: 'Show the cable route to the screen drive on the plan.' },
  ],
};

/** Titles, by chain: the document's, with its revision. */
export const TITLES = {
  'pump-house-ga': 'Pump house general arrangement',
  'intake-screen': 'Intake screen chamber details',
  'single-line': 'Station single-line diagram',
  'pump-performance': 'Pump performance specification',
  commissioning: 'Commissioning procedure',
};

/**
 * Each revision of a chain, in order: its place in the folder, and what the seed writes on it. A
 * marked chain's every revision names its mark: the server takes it on the first, and carries the
 * first's to each one after.
 */
export function revisionsOf(chain, today = new Date()) {
  return chain.revisions.map((revision, index) => ({
    name: `${chain.key}-${revision.toLowerCase()}`,
    revision,
    properties: {
      'dc:title': `${TITLES[chain.key]}, revision ${revision}`,
      'dc:description': chain.fields.description,
      'engdoc:category': chain.fields.category,
      'engdoc:discipline': chain.fields.discipline,
      'engdoc:project': PROJECT,
      'engdoc:originator': chain.fields.originator,
      'engdoc:purpose': chain.purpose[index],
      'engdoc:issuedOn': dayFrom(-chain.issued[index], today),
      ...markOf(chain),
    },
  }));
}

/** A chain's mark as the seed writes it, or nothing for an unmarked one. */
export function markOf(chain) {
  return chain.mark
    ? {
        'docmark:classification': chain.mark.classification,
        'docmark:groups': [...chain.mark.groups],
      }
    : {};
}

/** The day `offset` days from `today`'s UTC day, as Nuxeo stores a day: its midnight UTC. */
export function dayFrom(offset, today = new Date()) {
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
  );
  return day.toISOString();
}
