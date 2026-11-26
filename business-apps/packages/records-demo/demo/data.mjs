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
 * being deleted by the rule itself. A demo's minute; a real schedule says years. It takes the kit's
 * records files and the add-on's physical records.
 */
export const RULE = {
  name: 'records-demo-one-minute',
  title: 'Records demo: one minute, then a disposition review',
  durationMillis: 60_000,
  docTypes: ['RecordsFile', 'PhysicalRecord'],
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

/**
 * The repository's custody desk, at its root, where the records add-on takes custody requests only,
 * and who files them there: a records manager, as the clerk of the records centre.
 */
export const DESK = { name: 'custody-desk', title: 'Custody desk' };
export const CUSTODY_GRANTS = [{ group: 'records-managers', permission: 'RecordCustody' }];

/**
 * The records centre, a folder of the workspace, and its locations, each inside the one before it: a
 * site, a room, shelves and positions. Each has a name of its own, by which the physical records
 * below name where they are kept.
 */
export const CENTRE = { name: 'records-centre', title: 'Records centre' };
export const LOCATIONS = [
  { name: 'northfield', title: 'Northfield records centre', kind: 'site', in: null },
  { name: 'room-1', title: 'Room 1', kind: 'room', in: 'northfield' },
  { name: 'shelf-a', title: 'Shelf A', kind: 'shelf', in: 'room-1' },
  { name: 'shelf-b', title: 'Shelf B', kind: 'shelf', in: 'room-1' },
  { name: 'a-01', title: 'Position A-01', kind: 'position', in: 'shelf-a' },
  { name: 'a-02', title: 'Position A-02', kind: 'position', in: 'shelf-a' },
  { name: 'b-01', title: 'Position B-01', kind: 'position', in: 'shelf-b' },
];

/**
 * The physical records: a box, a file and a volume, each kept at a position, under the same rule as
 * the electronic records. One is to be transferred, not destroyed; one is put under a legal hold, so
 * that a run leaves it out.
 */
export const PHYSICAL = [
  {
    name: 'finance-2016-box-1',
    title: 'Finance 2016, box 1: invoices',
    kind: 'box',
    at: 'a-01',
    disposition: 'destroy',
  },
  {
    name: 'personnel-2009-file-3',
    title: 'Personnel 2009, file 3: a fictional former employee',
    kind: 'file',
    at: 'a-02',
    disposition: 'transfer',
    transferTo: 'The county record office, a fictional archive',
  },
  {
    name: 'board-2014-volume-2',
    title: 'Board minutes 2014, volume 2',
    kind: 'volume',
    at: 'b-01',
    disposition: 'destroy',
    hold: 'A fictional audit: kept until it closes',
  },
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
