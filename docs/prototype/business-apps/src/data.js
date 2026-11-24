// Demo data. Everything is fictional: people, providers, numbers and addresses.
const TODAY = new Date('2026-11-21T09:00:00Z');

// Plan items, as numbered in docs/presales-business-apps-plan.md.
const PLAN = {
  qw: { t: 'Quick wins', when: 'now' },
  s0: { t: 'Step 0 · Align', when: 'now' },
  s1: { t: 'Step 1 · Model drives screens', when: 'now' },
  s2: { t: 'Step 2 · Layouts v2', when: 'now' },
  s3: { t: 'Step 3 · Home and queues', when: 'next' },
  s4: { t: 'Step 4 · Workflow and lifecycle', when: 'next' },
  s5: { t: 'Step 5 · Server actions', when: 'next' },
  s6: { t: 'Step 6 · Agent app builder', when: 'then' },
  s7: { t: 'Step 7 · Starter kits', when: 'then' },
  s8: { t: 'Step 8 · Studio bridge', when: 'later' },
  b5: { t: 'Beyond the feedback (5)', when: 'later' },
  ootb: { t: 'Out of the box (7)', when: 'next' },
  dec: { t: 'Decisions (9)', when: 'now' },
  d11: { t: 'Designer additions (11)', when: 'next' },
};

const PERSONAS = {
  dana: { n: 'Dana Lee', ini: 'DL', role: 'Claims adjuster', groups: ['claims-adjusters'] },
  morgan: { n: 'Morgan Chen', ini: 'MC', role: 'Claims supervisor', groups: ['claims-supervisors', 'claims-adjusters'] },
  sam: { n: 'Sam Patel', ini: 'SP', role: 'Appeals case specialist', groups: ['appeals'] },
  riley: { n: 'Riley Brooks', ini: 'RB', role: 'Member services', groups: ['member-services'], phiMasked: true },
};
const BUILDER = { n: 'Alex Rivera', ini: 'AR', role: 'Presales engineer' };

const APPS = [
  { id: 'claims', n: 'Claims', d: 'Adjusters and supervisors work claims', icon: 'health_record', groups: ['claims-adjusters', 'claims-supervisors'] },
  { id: 'appeals', n: 'Appeals and grievances', d: 'Case specialists work cases', icon: 'gavel', groups: ['appeals'] },
  { id: 'service', n: 'Member services', d: 'Answer members, log callbacks', icon: 'phone', groups: ['member-services'] },
  { id: 'documents', n: 'Documents', d: 'The general ECM client (browse, search, versions)', icon: 'folder', groups: [] },
];

const MEMBERS = {
  'MEMBER-100048': {
    first: 'John', last: 'Smith', dob: '1952-05-19', hicn: '738238550B', medicare: '6W52Y86MF55',
    phone: '(555) 010-4418', email: 'jsmith@example.com', street: '1200 Harbor Blvd', city: 'Oakland', state: 'CA', zip: '94607',
    plan: 'Gold PPO', since: '2019-01-01', pcp: 'Dr. Ana Ruiz', status: 'active', risk: 'Medium',
  },
  'MEMBER-100049': {
    first: 'Maria', last: 'Alvarez', dob: '1988-11-02', hicn: '512904431A', medicare: '2K81R33QT07',
    phone: '(555) 010-7721', email: 'malvarez@example.com', street: '45 Orchard Lane', city: 'Fresno', state: 'CA', zip: '93721',
    plan: 'Silver HMO', since: '2022-03-01', pcp: 'Dr. Kofi Mensah', status: 'active', risk: 'Low',
  },
  'MEMBER-100051': {
    first: 'Wei', last: 'Chen', dob: '1969-02-27', hicn: '903117842C', medicare: '7P44D19LM62',
    phone: '(555) 010-3390', email: 'wchen@example.com', street: '9 Ridge Road', city: 'San Jose', state: 'CA', zip: '95112',
    plan: 'Gold PPO', since: '2016-07-01', pcp: 'Dr. Ana Ruiz', status: 'active', risk: 'High',
  },
};

const PROVIDERS = {
  'PRV-201': { n: 'Northside Pharmacy', npi: '1533525020', spec: 'Pharmacy', city: 'Oakland, CA', net: 'In network' },
  'PRV-202': { n: 'Lakeview Medical Group', npi: '8209633036', spec: 'Multi-specialty', city: 'Fresno, CA', net: 'In network' },
  'PRV-203': { n: 'Summit Health Partners', npi: '7845185841', spec: 'Orthopedics', city: 'San Jose, CA', net: 'Out of network' },
};

// claimLifecycle: the transitions a claim's state allows, as the server would report them.
const CLAIM_STATES = ['submitted', 'inReview', 'pended', 'approved', 'denied', 'paid', 'closed'];
const CLAIM_STATE_LABEL = { submitted: 'Submitted', inReview: 'In review', pended: 'Pended', approved: 'Approved', denied: 'Denied', paid: 'Paid', closed: 'Closed' };
const CLAIM_STATE_TONE = { submitted: 'info', inReview: 'info', pended: 'warn', approved: 'ok', denied: 'bad', paid: 'ok', closed: '' };
const CLAIM_TRANSITIONS = {
  submitted: [['startReview', 'Start review', 'inReview']],
  inReview: [['pend', 'Pend for information', 'pended'], ['approve', 'Approve', 'approved'], ['deny', 'Deny', 'denied']],
  pended: [['resume', 'Resume review', 'inReview']],
  approved: [['pay', 'Mark as paid', 'paid']],
  denied: [['close', 'Close', 'closed']],
  paid: [['close', 'Close', 'closed']],
  closed: [],
};

// A task works on a claim only while the claim is still being decided.
const OPEN_STATES = ['submitted', 'inReview', 'pended'];
// Claim determination: over this billed amount, an approval is the supervisor's step.
const SUPERVISOR_LIMIT = 5000;
// Workflow steps that belong to a group rather than to whoever holds the task: only its members may
// take or complete them, whatever the task's assignee says.
const STEP_GROUPS = { 'Supervisor approval': 'claims-supervisors' };
// The choices each workflow step's form offers. Completion accepts nothing else.
const DECISIONS = {
  Determine: ['approve', 'deny', 'pend'],
  'Supervisor approval': ['approve', 'return'],
  'Medical review': ['uphold', 'overturn'],
  Decision: ['uphold', 'overturn'],
  Callback: ['resolved', 'follow'],
};

const CLAIMS = {
  'CLAIM-000132': { member: 'MEMBER-100048', provider: 'PRV-201', billed: 9087, allowed: 8650, paid: 8650, svc: '2025-01-10', rcvd: '2025-01-14', state: 'paid', assignee: null, due: null, dx: 'E11.9', lines: [['J1817', 'Insulin, 50 units', 9087]], docs: ['DOC-1'] },
  'CLAIM-000130': { member: 'MEMBER-100048', provider: 'PRV-202', billed: 9723, allowed: 9100, paid: 9100, svc: '2025-05-04', rcvd: '2025-05-09', state: 'paid', assignee: null, due: null, dx: 'I10', lines: [['99215', 'Office visit, high complexity', 410], ['93306', 'Echocardiogram', 9313]], docs: [] },
  'CLAIM-000131': { member: 'MEMBER-100048', provider: 'PRV-203', billed: 7358, allowed: null, paid: null, svc: '2026-08-25', rcvd: '2026-11-10', state: 'inReview', assignee: 'dana', due: '2026-11-24', dx: 'M17.11', lines: [['27447', 'Total knee replacement', 6120], ['97110', 'Therapeutic exercise', 1238]], docs: ['DOC-2', 'DOC-3'], flag: 'Billed amount is 2.4 times this provider’s average for code 27447.' },
  'CLAIM-000140': { member: 'MEMBER-100049', provider: 'PRV-202', billed: 1240, allowed: null, paid: null, svc: '2026-11-03', rcvd: '2026-11-18', state: 'submitted', assignee: null, due: '2026-12-02', dx: 'J06.9', lines: [['99213', 'Office visit', 1240]], docs: [] },
  'CLAIM-000141': { member: 'MEMBER-100051', provider: 'PRV-203', billed: 15880, allowed: null, paid: null, svc: '2026-10-12', rcvd: '2026-10-20', state: 'pended', assignee: 'morgan', due: '2026-11-22', dx: 'M48.06', lines: [['63047', 'Lumbar laminectomy', 15880]], docs: ['DOC-4'] },
  'CLAIM-000142': { member: 'MEMBER-100049', provider: 'PRV-201', billed: 640, allowed: null, paid: null, svc: '2026-11-09', rcvd: '2026-11-19', state: 'submitted', assignee: null, due: '2026-12-03', dx: 'Z79.4', lines: [['J1817', 'Insulin, 50 units', 640]], docs: [] },
  'CLAIM-000143': { member: 'MEMBER-100051', provider: 'PRV-202', billed: 6410, allowed: null, paid: null, svc: '2026-09-30', rcvd: '2026-10-06', state: 'inReview', assignee: 'dana', due: '2026-11-19', dx: 'K80.20', lines: [['47562', 'Laparoscopic cholecystectomy', 6410]], docs: [] },
  'CLAIM-000144': { member: 'MEMBER-100049', provider: 'PRV-203', billed: 2980, allowed: 0, paid: 0, svc: '2026-09-14', rcvd: '2026-09-20', state: 'denied', assignee: 'dana', due: null, dx: 'S83.511A', lines: [['29881', 'Knee arthroscopy', 2980]], docs: [], denial: 'NMN' },
};

const DOCS = {
  'DOC-1': { n: 'Pharmacy invoice.pdf', cat: 'Invoice', size: '220 KB', claim: 'CLAIM-000132' },
  'DOC-2': { n: 'CMS-1500 claim form.pdf', cat: 'Claim form', size: '480 KB', claim: 'CLAIM-000131' },
  'DOC-3': { n: 'Operative report.pdf', cat: 'Medical record', size: '1.2 MB', claim: 'CLAIM-000131' },
  'DOC-4': { n: 'Prior authorization.pdf', cat: 'Authorization', size: '310 KB', claim: 'CLAIM-000141' },
  'DOC-5': { n: 'Member ID card.png', cat: 'ID card', size: '90 KB', member: 'MEMBER-100048' },
  'DOC-6': { n: 'EOB January 2025.pdf', cat: 'Explanation of benefits', size: '140 KB', member: 'MEMBER-100048' },
  'DOC-7': { n: 'Appeal letter.pdf', cat: 'Appeal request', size: '260 KB', case: 'CASE-2041' },
  'DOC-8': { n: 'Original EOB.pdf', cat: 'Explanation of benefits', size: '150 KB', case: 'CASE-2041' },
};

const DENIAL_REASONS = [['NMN', 'Not medically necessary'], ['NAUTH', 'No prior authorization'], ['DUP', 'Duplicate claim'], ['ELIG', 'Member not eligible on date of service'], ['CODE', 'Coding error']];

const CASES = {
  'CASE-2041': {
    title: 'Appeal of denied knee arthroscopy', type: 'Appeal', member: 'MEMBER-100049', claim: 'CLAIM-000144', state: 'inReview',
    rcvd: '2026-11-02', due: '2026-12-02', assignee: 'sam', hold: false, determination: null,
    people: [['sam', 'Case specialist'], ['Dr. Kofi Mensah', 'Treating physician'], ['Dr. Ana Ruiz', 'Medical reviewer']],
    checklist: [['Appeal letter', 'DOC-7'], ['Original explanation of benefits', 'DOC-8'], ['Medical records', null], ['Provider statement', null]],
    timeline: [
      ['2026-11-02', 'mail', 'Appeal letter received by mail and classified', 'Capture'],
      ['2026-11-03', 'user_task', 'Case assigned to Sam Patel', 'Workflow'],
      ['2026-11-05', 'comment', '@Dr. Ana Ruiz can you review the arthroscopy notes once they arrive?', 'Sam Patel'],
      ['2026-11-12', 'send', 'Medical records requested from Summit Health Partners', 'Operation'],
    ],
  },
  'CASE-2042': {
    title: 'Billing complaint about pharmacy charge', type: 'Grievance', member: 'MEMBER-100048', claim: 'CLAIM-000132', state: 'open',
    rcvd: '2026-11-15', due: '2026-12-15', assignee: 'riley', hold: false, determination: null,
    people: [['riley', 'Member services']], checklist: [['Member statement', null]], timeline: [['2026-11-15', 'phone', 'Member called about the January pharmacy charge', 'Riley Brooks']],
  },
};

// Tasks come from workflow nodes; `form` names the node's variables (Step 4).
const TASKS = {
  'T-501': { n: 'Determine claim', wf: 'Claim determination', node: 'Determine', target: 'CLAIM-000131', who: 'dana', due: '2026-11-24' },
  'T-502': { n: 'Determine claim', wf: 'Claim determination', node: 'Determine', target: 'CLAIM-000143', who: 'dana', due: '2026-11-19' },
  'T-503': { n: 'Medical review', wf: 'Appeal review', node: 'Medical review', target: 'CASE-2041', who: 'sam', due: '2026-11-25' },
  'T-504': { n: 'Approve high-value claim', wf: 'Claim determination', node: 'Supervisor approval', target: 'CLAIM-000141', who: 'morgan', due: '2026-11-22' },
  'T-505': { n: 'Call the member back', wf: 'Grievance handling', node: 'Callback', target: 'CASE-2042', who: 'riley', due: '2026-11-21' },
};

// Each queue is a server page provider plus columns plus actions, shown to some groups (Step 3).
const QUEUES = [
  { id: 'unassigned', n: 'Unassigned claims', pp: 'claims_unassigned', groups: ['claims-adjusters', 'claims-supervisors'], of: 'claim', test: (c) => !c.assignee && ['submitted', 'inReview'].includes(c.state) },
  { id: 'mine', n: 'My open claims', pp: 'claims_my_open', groups: ['claims-adjusters'], of: 'claim', test: (c, p) => c.assignee === p && OPEN_STATES.includes(c.state) },
  { id: 'highvalue', n: 'Over $5,000, awaiting review', pp: 'claims_high_value_review', groups: ['claims-supervisors'], of: 'claim', test: (c) => c.billed > 5000 && ['inReview', 'pended'].includes(c.state) },
  { id: 'appeals', n: 'Appeals due in 14 days', pp: 'cases_appeals_due', groups: ['appeals'], of: 'case', test: (c) => c.type === 'Appeal' && !['decided', 'closed'].includes(c.state) && daysTo(c.due) <= 14 },
  { id: 'callbacks', n: 'Member callbacks', pp: 'cases_callbacks', groups: ['member-services'], of: 'case', test: (c) => c.type === 'Grievance' && !['decided', 'closed'].includes(c.state) },
];

const INBOX = [
  { id: 'IN-9001', ch: 'Email', from: 'records@summithealth.example', subj: 'Medical records for claim 000141', file: 'records-000141.pdf', cls: ['Medical record', 96], member: ['MEMBER-100051', 92], target: ['CLAIM-000141', 88], fields: [['Patient', 'Wei Chen'], ['Date of birth', '1969-02-27'], ['Provider NPI', '7845185841'], ['Service date', '2026-10-12']], done: false },
  { id: 'IN-9002', ch: 'Scan', from: 'Mailroom scanner 2', subj: 'Letter: request to review a denial', file: 'scan-2207.pdf', cls: ['Appeal request', 91], member: ['MEMBER-100049', 90], target: ['CASE-2041', 84], fields: [['Member', 'Maria Alvarez'], ['Claim', 'CLAIM-000144'], ['Signed', 'Yes']], done: false },
  { id: 'IN-9003', ch: 'Fax', from: '+1 555 010 0199', subj: '(no subject)', file: 'fax-0918.tif', cls: ['Prior authorization request', 64], member: null, target: null, fields: [['Patient', 'unreadable'], ['Procedure', '29881']], done: false },
];

const NOTIFS = [
  { to: 'dana', icon: 'user_task', t: 'CLAIM-000140 was assigned to you by Morgan Chen', h: '#/claim/CLAIM-000140', when: '8 min ago', unread: true },
  { to: 'dana', icon: 'alarm', t: 'CLAIM-000143 is 2 days past its determination date', h: '#/claim/CLAIM-000143', when: '1 h ago', unread: true },
  { to: 'dana', icon: 'comment', t: 'Morgan Chen mentioned you on CLAIM-000131: “check the knee code against the auth”', h: '#/claim/CLAIM-000131', when: 'Yesterday', unread: false },
  { to: 'sam', icon: 'inbox', t: 'An appeal letter was matched to CASE-2041', h: '#/inbox', when: '20 min ago', unread: true },
  { to: 'sam', icon: 'alarm', t: 'CASE-2041 regulatory deadline in 11 days', h: '#/case/CASE-2041', when: 'Today', unread: true },
  { to: 'morgan', icon: 'flag', t: 'CLAIM-000141 ($15,880) waits for your approval', h: '#/task/T-504', when: '2 h ago', unread: true },
  { to: 'riley', icon: 'phone', t: 'Callback due today for CASE-2042', h: '#/case/CASE-2042', when: 'Today', unread: true },
];

const KITS = [
  { id: 'payers', n: 'Payers and claims', icon: 'health_record', installed: true, v: '1.0.0', types: ['Member', 'Claim', 'Case', 'Provider', 'ClaimDocument'], cfg: ['3 record pages', '5 queues', '4 home layouts', '6 actions', '2 task forms'], data: '3 members, 8 claims, 2 cases, 8 documents', script: ['Dana’s morning: home, queue, take a claim', 'Determine a claim with the task form', 'Supervisor approves a high-value claim', 'Member services masks protected fields'] },
  { id: 'cases', n: 'Case management', icon: 'gavel', installed: false, v: '0.9.0', types: ['Case', 'Party', 'CaseDocument'], cfg: ['Case page with checklist and timeline', '3 queues', 'SLA clocks'], data: '40 cases', script: ['Intake to decision in 6 steps'] },
  { id: 'contracts', n: 'Contract management', icon: 'sign', installed: false, v: '0.8.0', types: ['Contract', 'Counterparty', 'Obligation'], cfg: ['Contract page', 'Renewals queue', 'Approval workflow'], data: '120 contracts', script: ['Renewal due in 30 days', 'Legal approval with redlines'] },
  { id: 'dam', n: 'DAM and PAM', icon: 'image', installed: false, v: '0.6.0', types: ['Product', 'Asset', 'Deliverable'], cfg: ['Product page with assets', 'Deliverables queue', 'Rights expiry alerts'], data: '60 products, 900 assets', script: ['Launch kit for a product', 'Expired usage rights'] },
];

// What the model endpoint returns for the Payers project (Step 1).
const MODEL = [
  { t: 'Member', file: false, folder: false, schemas: ['member', 'contact', 'address'], refs: [], refBy: ['Claim.claim:member', 'Case.case:member'], lc: 'memberLifecycle: active, inactive', layout: 'contributed' },
  { t: 'Claim', file: false, folder: false, schemas: ['claim', 'claimLine[]'], refs: ['claim:member → Member', 'claim:provider → Provider'], refBy: ['Case.case:claim', 'ClaimDocument.claimdoc:claim'], lc: 'claimLifecycle: 7 states, 9 transitions', layout: 'contributed' },
  { t: 'Case', file: false, folder: true, schemas: ['case', 'caseParty[]'], refs: ['case:member → Member', 'case:claim → Claim'], refBy: [], lc: 'caseLifecycle: open, inReview, decided, closed', layout: 'contributed' },
  { t: 'Provider', file: false, folder: false, schemas: ['provider'], refs: [], refBy: ['Claim.claim:provider'], lc: 'default', layout: 'generated' },
  { t: 'ClaimDocument', file: true, folder: false, schemas: ['file', 'claimdoc'], refs: ['claimdoc:claim → Claim'], refBy: [], lc: 'default', layout: 'generated' },
];
const PAGE_PROVIDERS = ['claims_unassigned', 'claims_my_open', 'claims_high_value_review', 'claims_for_member', 'cases_for_member', 'cases_appeals_due', 'cases_callbacks', 'member_search', 'claim_search'];
const WORKFLOWS = [['Claim determination', 'Determine → Supervisor approval (over $5,000)'], ['Appeal review', 'Intake → Medical review → Decision'], ['Grievance handling', 'Callback → Resolution']];
const VOCABS = [['denialReason', 5], ['claimStatus', 7], ['caseType', 2], ['documentCategory', 9], ['specialty', 31]];
