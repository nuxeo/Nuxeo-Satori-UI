/**
 * The Payers kit's demo records. **Everything here is fictional:** the people, providers, numbers,
 * addresses and documents. The people, claims and cases are the business-apps prototype's
 * (docs/prototype/business-apps/src/data.js), with one member and one case more, so the kit and
 * the prototype tell the same story. The numbers below are this file's own.
 *
 * - Social security numbers are in 987-65-4320 to 987-65-4329, a range set aside for
 *   advertising and never issued.
 * - Telephone numbers are in 555-0100 to 555-0199, set aside for fiction.
 * - Provider NPIs start with 0; every real one starts with 1 or 2.
 * - E-mail addresses are at example.com.
 * - The people who work the claims and cases are `USERS`, in the groups the kit's rules name
 *   (`GROUPS`). The seed creates them, so the demo can sign in as an adjuster and as member
 *   services. Their password is the one in PAYERS_DEMO_PASSWORD, never one written here.
 *
 * Each record is found again by its number, which names its document, so `seed.mjs` updates it
 * rather than adding another when run twice. A member, provider or claim is referred to by its
 * number here; the seed writes the document's id in its place.
 */

/** The groups the kit's layouts, queues, home and menu name in `app.rules.inGroup`. */
export const GROUPS = [
  { name: 'claims-adjusters', label: 'Claims adjusters' },
  { name: 'claims-supervisors', label: 'Claims supervisors' },
  { name: 'member-services', label: 'Member services' },
];

/**
 * What each group may do, by place in the seeded workspace: `''` is the workspace, which its
 * folders inherit, and `claims` its claims folder. Hiding something from a group is not a control;
 * a permission is. Every group reads every record, and adjusters and supervisors may also change
 * claims, which approving one needs. No demo group may change a member, so none of the demo's
 * people is offered a member's Edit form, which lists every property, the social security number
 * among them.
 */
export const GRANTS = [
  { place: '', group: 'claims-adjusters', permission: 'Read' },
  { place: '', group: 'claims-supervisors', permission: 'Read' },
  { place: '', group: 'member-services', permission: 'Read' },
  { place: 'claims', group: 'claims-adjusters', permission: 'ReadWrite' },
  { place: 'claims', group: 'claims-supervisors', permission: 'ReadWrite' },
];

/**
 * The demo's people: the claims' adjusters and the cases' assignees below. Morgan Chen
 * supervises as well as adjusts.
 *
 * The last two work the claims review workflow's demo
 * (`scripts/beta-harness/steps/payers-claims-workflow.mjs`), on claims it writes for each run:
 * Alex Rivera determines them, and Jordan Kim, a supervisor and nothing else, approves those over
 * 5,000 dollars. They hold none of the claims below, so that what the workflow does never changes
 * the figures phase 1's demo counts as Dana Lee and as member services.
 */
export const USERS = [
  { username: 'dana.lee', firstName: 'Dana', lastName: 'Lee', groups: ['claims-adjusters'] },
  {
    username: 'morgan.chen',
    firstName: 'Morgan',
    lastName: 'Chen',
    groups: ['claims-adjusters', 'claims-supervisors'],
  },
  { username: 'riley.brooks', firstName: 'Riley', lastName: 'Brooks', groups: ['member-services'] },
  { username: 'sam.patel', firstName: 'Sam', lastName: 'Patel', groups: ['member-services'] },
  { username: 'alex.rivera', firstName: 'Alex', lastName: 'Rivera', groups: ['claims-adjusters'] },
  { username: 'jordan.kim', firstName: 'Jordan', lastName: 'Kim', groups: ['claims-supervisors'] },
];

/** The workflow demo's two people, by what they do in it. */
export const WORKFLOW_ADJUSTER = 'alex.rivera';
export const WORKFLOW_SUPERVISOR = 'jordan.kim';

export const MEMBERS = [
  {
    number: 'MEMBER-100048',
    firstName: 'John',
    lastName: 'Smith',
    birthDate: '1952-05-19',
    address: { street: '1200 Harbor Blvd', city: 'Oakland', zip: '94607', country: 'US' },
    phone: '(510) 555-0148',
    email: 'jsmith@example.com',
    plan: 'Gold PPO',
    status: 'active',
    ssn: '987-65-4320',
  },
  {
    number: 'MEMBER-100049',
    firstName: 'Maria',
    lastName: 'Alvarez',
    birthDate: '1988-11-02',
    address: { street: '45 Orchard Lane', city: 'Fresno', zip: '93721', country: 'US' },
    phone: '(559) 555-0149',
    email: 'malvarez@example.com',
    plan: 'Silver HMO',
    status: 'active',
    ssn: '987-65-4321',
  },
  {
    number: 'MEMBER-100051',
    firstName: 'Wei',
    lastName: 'Chen',
    birthDate: '1969-02-27',
    address: { street: '9 Ridge Road', city: 'San Jose', zip: '95112', country: 'US' },
    phone: '(408) 555-0151',
    email: 'wchen@example.com',
    plan: 'Gold PPO',
    status: 'lapsed',
    ssn: '987-65-4322',
  },
  {
    number: 'MEMBER-100052',
    firstName: 'Ruth',
    lastName: 'Okafor',
    birthDate: '1941-07-30',
    address: { street: '300 Bay Street', city: 'Sacramento', zip: '95814', country: 'US' },
    phone: '(916) 555-0152',
    email: 'rokafor@example.com',
    plan: 'Bronze HMO',
    status: 'terminated',
    ssn: '987-65-4323',
  },
];

export const PROVIDERS = [
  {
    number: 'PRV-201',
    name: 'Northside Pharmacy',
    npi: '0000000201',
    specialty: 'Pharmacy',
    network: 'inNetwork',
    phone: '(510) 555-0101',
    address: { street: '18 Grand Avenue', city: 'Oakland', zip: '94612', country: 'US' },
  },
  {
    number: 'PRV-202',
    name: 'Lakeview Medical Group',
    npi: '0000000202',
    specialty: 'Multi-specialty',
    network: 'inNetwork',
    phone: '(559) 555-0102',
    address: { street: '700 Lakeview Drive', city: 'Fresno', zip: '93710', country: 'US' },
  },
  {
    number: 'PRV-203',
    name: 'Summit Health Partners',
    npi: '0000000203',
    specialty: 'Orthopedics',
    network: 'outOfNetwork',
    phone: '(408) 555-0103',
    address: { street: '2 Summit Plaza', city: 'San Jose', zip: '95110', country: 'US' },
  },
];

/** `adjuster: null` is an unassigned claim: the two still submitted are in the queue. */
export const CLAIMS = [
  {
    number: 'CLAIM-000130',
    member: 'MEMBER-100048',
    provider: 'PRV-202',
    serviceDate: '2025-05-04',
    received: '2025-05-09',
    billedAmount: 9723,
    allowedAmount: 9100,
    status: 'paid',
    adjuster: 'dana.lee',
    diagnosis: 'I10',
  },
  {
    number: 'CLAIM-000131',
    member: 'MEMBER-100048',
    provider: 'PRV-203',
    serviceDate: '2026-08-25',
    serviceStart: '2026-08-25',
    serviceEnd: '2026-08-27',
    received: '2026-11-10',
    billedAmount: 7358,
    allowedAmount: null,
    status: 'inReview',
    adjuster: 'dana.lee',
    diagnosis: 'M17.11',
  },
  {
    number: 'CLAIM-000132',
    member: 'MEMBER-100048',
    provider: 'PRV-201',
    serviceDate: '2025-01-10',
    received: '2025-01-14',
    billedAmount: 9087,
    allowedAmount: 8650,
    status: 'paid',
    adjuster: 'dana.lee',
    diagnosis: 'E11.9',
  },
  {
    number: 'CLAIM-000140',
    member: 'MEMBER-100049',
    provider: 'PRV-202',
    serviceDate: '2026-11-03',
    received: '2026-11-18',
    billedAmount: 1240,
    allowedAmount: null,
    status: 'submitted',
    adjuster: null,
    diagnosis: 'J06.9',
  },
  {
    number: 'CLAIM-000141',
    member: 'MEMBER-100051',
    provider: 'PRV-203',
    serviceDate: '2026-10-12',
    received: '2026-10-20',
    billedAmount: 15880,
    allowedAmount: null,
    status: 'pended',
    adjuster: 'morgan.chen',
    diagnosis: 'M48.06',
  },
  {
    number: 'CLAIM-000142',
    member: 'MEMBER-100049',
    provider: 'PRV-201',
    serviceDate: '2026-11-09',
    received: '2026-11-19',
    billedAmount: 640,
    allowedAmount: null,
    status: 'submitted',
    adjuster: null,
    diagnosis: 'Z79.4',
  },
  {
    number: 'CLAIM-000143',
    member: 'MEMBER-100051',
    provider: 'PRV-202',
    serviceDate: '2026-09-30',
    received: '2026-10-06',
    billedAmount: 6410,
    allowedAmount: null,
    status: 'inReview',
    adjuster: 'dana.lee',
    diagnosis: 'K80.20',
  },
  {
    number: 'CLAIM-000144',
    member: 'MEMBER-100049',
    provider: 'PRV-203',
    serviceDate: '2026-09-14',
    received: '2026-09-20',
    billedAmount: 2980,
    allowedAmount: 0,
    status: 'denied',
    adjuster: 'dana.lee',
    diagnosis: 'S83.511A',
  },
];

export const CASES = [
  {
    number: 'CASE-2030',
    title: 'Complaint about a long wait for an appointment',
    member: 'MEMBER-100048',
    claim: null,
    category: 'grievance',
    state: 'closed',
    received: '2026-06-03',
    due: '2026-07-03',
    assignee: 'riley.brooks',
    summary: 'The member waited five weeks for a specialist appointment. Resolved with a referral.',
  },
  {
    number: 'CASE-2041',
    title: 'Appeal of denied knee arthroscopy',
    member: 'MEMBER-100049',
    claim: 'CLAIM-000144',
    category: 'appeal',
    state: 'inReview',
    received: '2026-11-02',
    due: '2026-12-02',
    assignee: 'sam.patel',
    summary:
      'The member appeals the denial of claim CLAIM-000144 as not medically necessary. Medical ' +
      'records were requested from the provider.',
  },
  {
    number: 'CASE-2042',
    title: 'Billing complaint about pharmacy charge',
    member: 'MEMBER-100048',
    claim: 'CLAIM-000132',
    category: 'grievance',
    state: 'open',
    received: '2026-11-15',
    due: '2026-12-15',
    assignee: 'riley.brooks',
    summary: 'The member called about the January pharmacy charge on claim CLAIM-000132.',
  },
];

/** Each with a short text file, which says it is fictional. */
export const CLAIM_DOCUMENTS = [
  { number: 'DOC-1', title: 'Pharmacy invoice', claim: 'CLAIM-000132', category: 'Invoice' },
  { number: 'DOC-2', title: 'CMS-1500 claim form', claim: 'CLAIM-000131', category: 'Claim form' },
  { number: 'DOC-3', title: 'Operative report', claim: 'CLAIM-000131', category: 'Medical record' },
  {
    number: 'DOC-4',
    title: 'Prior authorization',
    claim: 'CLAIM-000141',
    category: 'Authorization',
  },
];
