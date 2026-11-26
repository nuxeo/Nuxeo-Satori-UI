/**
 * The onboarding kit's fictional records: four onboarding cases and three disputes. Every name,
 * company, address and account here is made up; the user names are user names only, which the
 * seed creates no account for. Dates are days from today, counted again on each run.
 */

export const WORKSPACE = {
  name: 'onboarding-demo',
  title: 'Onboarding and disputes (demo)',
};

/** The two registers, whose Create menus offer the kit's types. */
export const REGISTERS = {
  onboarding: { name: 'onboarding', title: 'Onboarding', type: 'OnboardingRegister' },
  disputes: { name: 'disputes', title: 'Disputes', type: 'DisputeRegister' },
};

/**
 * Who may do what, on each register: the officers send cases' agreements for signature and the
 * KYC analysts tick their checklists, so both write the onboarding register; the dispute analysts
 * write the disputes. The groups are the server's: the seed creates none.
 */
export const GRANTS = [
  { register: 'onboarding', group: 'onboarding-officers', permission: 'ReadWrite' },
  { register: 'onboarding', group: 'kyc-analysts', permission: 'ReadWrite' },
  { register: 'disputes', group: 'dispute-analysts', permission: 'ReadWrite' },
];

/** A checklist entry, as layout version 2's checklist card reads one. */
const done = (item, by, daysAgo) => ({ item, done: true, doneBy: by, doneOn: -daysAgo });

export const CASES = [
  {
    number: 'ONB-1001',
    title: 'Business current account for a coffee roaster',
    customer: 'Harbourline Coffee Roasters Ltd',
    customerType: 'Business',
    country: 'Ireland',
    product: 'Business current account',
    status: 'KYC review',
    riskRating: 'Medium',
    openedOn: -6,
    officer: 'mara.okafor',
    notes: 'Two directors; the second director sends their proof of address next week.',
    checklist: [done('identity', 'teo.lindqvist', 4), done('address', 'teo.lindqvist', 3)],
  },
  {
    number: 'ONB-1002',
    title: 'Personal savings account',
    customer: 'Rowan Vale',
    customerType: 'Individual',
    country: 'Portugal',
    product: 'Savings account',
    status: 'Open',
    riskRating: 'Low',
    openedOn: -1,
    officer: 'mara.okafor',
    notes: 'Opened online; documents uploaded by the customer.',
    checklist: [],
  },
  {
    number: 'ONB-1003',
    title: 'Business current account for a design studio',
    customer: 'Quillfeather Studios LLC',
    customerType: 'Business',
    country: 'Netherlands',
    product: 'Business current account',
    status: 'Awaiting signature',
    riskRating: 'Low',
    openedOn: -12,
    officer: 'jun.ferreira',
    notes: 'KYC complete. The account agreement goes to both directors for signature.',
    checklist: [
      done('identity', 'teo.lindqvist', 10),
      done('address', 'teo.lindqvist', 10),
      done('sanctions', 'teo.lindqvist', 9),
      done('pep', 'teo.lindqvist', 9),
      done('sourceOfFunds', 'teo.lindqvist', 7),
      done('riskApproved', 'jun.ferreira', 6),
    ],
  },
  {
    number: 'ONB-1004',
    title: 'Private banking account',
    customer: 'Ines Marlow',
    customerType: 'Individual',
    country: 'Malta',
    product: 'Private banking account',
    status: 'KYC review',
    riskRating: 'High',
    openedOn: -9,
    officer: 'jun.ferreira',
    notes: 'Enhanced due diligence: the source of funds is a sale of shares, statements requested.',
    checklist: [done('identity', 'teo.lindqvist', 8), done('sanctions', 'teo.lindqvist', 8)],
  },
];

export const DISPUTES = [
  {
    number: 'DSP-2001',
    title: 'Card payment the customer did not make',
    customer: 'Rowan Vale',
    account: 'FICT-ACC-0041',
    amount: 249.99,
    reason: 'Unauthorised',
    status: 'Open',
    openedOn: -2,
    dueOn: 12,
    analyst: 'sana.whitlock',
    resolution: '',
  },
  {
    number: 'DSP-2002',
    title: 'Furniture paid for and never delivered',
    customer: 'Harbourline Coffee Roasters Ltd',
    account: 'FICT-ACC-0187',
    amount: 1200,
    reason: 'Not received',
    status: 'Investigating',
    openedOn: -40,
    dueOn: -2,
    analyst: 'sana.whitlock',
    resolution: '',
  },
  {
    number: 'DSP-2003',
    title: 'Subscription charged twice',
    customer: 'Ines Marlow',
    account: 'FICT-ACC-0533',
    amount: 35.5,
    reason: 'Duplicate',
    status: 'Resolved for customer',
    openedOn: -20,
    dueOn: -5,
    analyst: 'sana.whitlock',
    resolution: 'The second charge was refunded on the merchant’s confirmation.',
  },
];

/** The statuses the open-cases and open-disputes page providers list: what the seed checks. */
export const OPEN_CASE_STATUSES = ['Open', 'KYC review', 'Awaiting signature'];
export const OPEN_DISPUTE_STATUSES = ['Open', 'Investigating'];

/** A day `days` from `today`, as `YYYY-MM-DD` at its UTC midnight, as the platform stores a day. */
export function dayFrom(days, today = new Date()) {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The case's account agreement's file name, which a signature request names. */
export function agreementName(number) {
  return `account-agreement-${number.toLowerCase()}.pdf`;
}

/**
 * A small, valid PDF of one page, saying what it is: the case's fictional account agreement, for
 * the e-signature step. Not a real agreement.
 */
export function agreementPdf(kase) {
  const text =
    `Fictional account agreement ${kase.number}: ${kase.product} for ${kase.customer}`.replace(
      /[()\\]/g,
      '',
    );
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
