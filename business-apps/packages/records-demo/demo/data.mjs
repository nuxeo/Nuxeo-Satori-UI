/**
 * The records kit's fictional records, for its seed. No real organisation, office, person or
 * record: the references, titles and offices are made up.
 */

/** The workspace the seed writes the records into, under /default-domain/workspaces, and its folder. */
export const WORKSPACE = { name: 'records-demo', title: 'Records (demo)' };
export const FILES = { name: 'files', title: 'Records files' };

/**
 * The repository's disposition runs folder, at its root, where the records add-on takes requests
 * only: as the retention module keeps its rules in /RetentionRules.
 */
export const RUNS = { name: 'disposition-runs', title: 'Disposition runs' };

/**
 * The retention rule the seed makes in the retention module's /RetentionRules: one minute from when
 * it is attached, with no end action, so that its records wait for a disposition review rather than
 * being deleted by the rule itself. A demo's minute; a real schedule says years.
 */
export const RULE = {
  name: 'records-demo-one-minute',
  title: 'Records demo: one minute, then a disposition review',
  durationMillis: 60_000,
};

/**
 * The kit's two groups, which the server's directory holds, and what each may do in the folder: a
 * records manager starts runs and files audit exports, an approver approves runs.
 */
export const GRANTS = [
  { group: 'records-managers', permission: 'StartDisposition' },
  { group: 'records-approvers', permission: 'ApproveDisposition' },
  { group: 'records-managers', permission: 'ExportRecordsAudit' },
];

/** The records. One is put under a legal hold, so that a run leaves it out. */
export const RECORDS = [
  {
    reference: 'INV-2016-0412',
    title: 'Invoice INV-2016-0412, office supplies',
    series: 'Finance',
    office: 'Northfield',
    closed: '2016-12-31',
  },
  {
    reference: 'INV-2016-0977',
    title: 'Invoice INV-2016-0977, building maintenance',
    series: 'Finance',
    office: 'Northfield',
    closed: '2016-12-31',
  },
  {
    reference: 'PER-2009-0031',
    title: 'Personnel file PER-2009-0031, a fictional former employee',
    series: 'Personnel',
    office: 'Harbour Street',
    closed: '2015-06-30',
  },
  {
    reference: 'CON-2014-0118',
    title: 'Contract CON-2014-0118, cleaning services',
    series: 'Contracts',
    office: 'Harbour Street',
    closed: '2017-03-31',
  },
  {
    reference: 'COR-2017-0560',
    title: 'Correspondence COR-2017-0560, a supplier dispute',
    series: 'Correspondence',
    office: 'Northfield',
    closed: '2018-01-15',
    hold: 'A fictional dispute: kept until it is settled',
  },
];
