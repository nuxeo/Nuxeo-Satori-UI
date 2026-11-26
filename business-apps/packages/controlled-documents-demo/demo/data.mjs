/**
 * The controlled documents kit's fictional register: five engineering documents of a fictional
 * pumping station, each a chain of revisions, the last one current. Every name, project and person
 * is made up.
 *
 * A chain's first revision names its series; each later one is created naming the one before it
 * in `docctl:supersedes`, so the server gives it that revision's number and the next revision, and
 * marks the one before it superseded. The numbers are the server's: the seed never writes one.
 */

/** The workspace and the folder the records go in, under /default-domain/workspaces. */
export const WORKSPACE = {
  name: 'controlled-documents-demo',
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
    revisions: ['A'],
    fields: {
      category: 'Drawing',
      discipline: 'Electrical',
      originator: 'mlind',
      description:
        'Single-line diagram of the station, from the incoming supply to the motor starters.',
    },
    issued: [45],
    purpose: ['For information'],
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

/** Titles, by chain: the document's, with its revision. */
export const TITLES = {
  'pump-house-ga': 'Pump house general arrangement',
  'intake-screen': 'Intake screen chamber details',
  'single-line': 'Station single-line diagram',
  'pump-performance': 'Pump performance specification',
  commissioning: 'Commissioning procedure',
};

/** Each revision of a chain, in order: its place in the folder, and what the seed writes on it. */
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
    },
  }));
}

/** The day `offset` days from `today`'s UTC day, as Nuxeo stores a day: its midnight UTC. */
export function dayFrom(offset, today = new Date()) {
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
  );
  return day.toISOString();
}
