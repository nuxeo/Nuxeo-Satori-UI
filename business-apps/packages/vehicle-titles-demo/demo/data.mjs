/**
 * The vehicle titles kit's fictional records, which `seed.mjs` writes. No real dealership, lender,
 * person, vehicle or title: every name here is made up, the makes and models among them, every
 * phone number is a 555 number, every address is at example.com, and every VIN starts `1VTDM0000`
 * and runs in sequence, so that none is a real vehicle's.
 *
 * Dates are days from the UTC day the seed runs, so that the queues and banners hold the same
 * records whichever day it is run: `soldOn: -12` is 12 days ago. `dayFrom` turns them into dates.
 *
 * A deal's `title` and `tradeInTitle` are written by the title's number, not by id, since the ids
 * are the server's: the seed writes each as the id of the title it names, as the deal page's
 * `document-link` fields read it. So the titles are written first.
 *
 * A deal's checklist is written whole, an entry for every document its cards list: the six every
 * deal needs, and the three a financed deal needs besides (`REQUIRED_DOCUMENTS`,
 * `FINANCE_DOCUMENTS`, the same ids as the VehicleDeal page's two checklist cards). An entry is done
 * when the deal's `received` names it. The deals missing documents queue lists a sold deal with an
 * entry not done, so a deal needs an entry for each of its documents to be listed: the seed writes
 * them (the README's "Deals missing documents" says why).
 *
 * `EXPECTED` says which records each of the kit's page providers returns, worked out from the data
 * as `vehicle-titles-demo-model.xml` defines the queries. The seed checks each against the server.
 */

/** The workspace the records go in, and the folder of each type. */
export const WORKSPACE = { name: 'vehicle-titles-demo', title: 'Vehicle deals and titles demo' };
export const FOLDERS = {
  titles: { name: 'titles', title: 'Titles' },
  deals: { name: 'deals', title: 'Deals' },
};

/** The people's user names: fictional, and not created by the seed. */
export const PEOPLE = {
  salespeople: ['dario.whitlock', 'amara.oyelaran'],
  financeManagers: ['selma.okonkwo'],
  clerks: ['ines.calloway', 'bram.vasquez'],
};

/** The documents every deal needs, by the id its checklist card gives each. */
export const REQUIRED_DOCUMENTS = [
  'driversLicense',
  'insurance',
  'buyersOrder',
  'odometer',
  'titleApplication',
  'deliveryReceipt',
];
/** The documents a financed deal, a loan or a lease, needs besides. */
export const FINANCE_DOCUMENTS = ['creditApplication', 'financeContract', 'lenderApproval'];
/** The statuses of a deal that is sold: the deals missing documents queue lists these only. */
export const SOLD = ['Contracted', 'Funded', 'Delivered'];
/** How many days a title may stay open before it is overdue: the queue's and the banner's. */
export const OVERDUE_AFTER_DAYS = 30;

const ALL = [...REQUIRED_DOCUMENTS, ...FINANCE_DOCUMENTS];

export const TITLES = [
  {
    number: 'TTL-6001',
    summary: 'Title TTL-6001, 2025 Velmont Arden',
    issuingState: 'Oregon',
    vin: '1VTDM0000SA500101',
    vehicle: '2025 Velmont Arden',
    owner: 'Brightwater Motors',
    status: 'Submitted to state',
    lienHolder: 'Larkspur Credit Union',
    openedOn: -12,
    submittedOn: -4,
    clerk: 'ines.calloway',
    notes: "New title in the buyer's name, with the credit union's lien recorded on it.",
  },
  {
    // Open 40 days: overdue. Sold twice: once in a deal that was unwound, then again.
    number: 'TTL-6002',
    summary: 'Title TTL-6002, 2022 Harlow Brisk',
    issuingState: 'Oregon',
    vin: '1VTDM0000NA500102',
    vehicle: '2022 Harlow Brisk',
    owner: 'Brightwater Motors',
    status: 'In hand',
    openedOn: -40,
    clerk: 'bram.vasquez',
    notes: 'The title is in hand; the transfer waits for the odometer statement.',
  },
  {
    // A trade-in whose loan the dealership paid off: waiting for the bank to release its lien.
    number: 'TTL-6003',
    summary: 'Title TTL-6003, 2019 Quenby Lark',
    issuingState: 'Washington',
    vin: '1VTDM0000KA510301',
    vehicle: '2019 Quenby Lark',
    owner: 'Tobiah Rennick',
    status: 'Awaiting lien release',
    lienHolder: 'Harrow Valley Bank',
    payoffSentOn: -18,
    openedOn: -20,
    clerk: 'ines.calloway',
  },
  {
    // A trade-in waiting for its lien release, and open 34 days: in both title queues.
    number: 'TTL-6004',
    summary: 'Title TTL-6004, 2018 Harlow Summit',
    issuingState: 'Oregon',
    vin: '1VTDM0000JA510302',
    vehicle: '2018 Harlow Summit',
    owner: 'Juniper Achebe-Holt',
    status: 'Awaiting lien release',
    lienHolder: 'Larkspur Credit Union',
    payoffSentOn: -30,
    openedOn: -34,
    clerk: 'bram.vasquez',
    notes: 'Payoff confirmed by phone; the release has not come.',
  },
  {
    // Issued: never overdue, however long ago it was opened.
    number: 'TTL-6005',
    summary: 'Title TTL-6005, 2024 Velmont Tessel',
    issuingState: 'Idaho',
    vin: '1VTDM0000RA500103',
    vehicle: '2024 Velmont Tessel',
    owner: 'Harrow Valley Bank',
    status: 'Issued',
    lienHolder: 'Harrow Valley Bank',
    openedOn: -60,
    submittedOn: -45,
    issuedOn: -20,
    clerk: 'ines.calloway',
    notes: 'A lease: the bank owns the vehicle, and the title is in its name.',
  },
  {
    number: 'TTL-6006',
    summary: 'Title TTL-6006, 2025 Velmont Arden',
    issuingState: 'Oregon',
    vin: '1VTDM0000SA500104',
    vehicle: '2025 Velmont Arden',
    owner: 'Brightwater Motors',
    status: 'Awaiting title',
    openedOn: -14,
    clerk: 'bram.vasquez',
  },
  {
    // Open 30 days exactly: not overdue, since overdue is more than 30.
    number: 'TTL-6007',
    summary: 'Title TTL-6007, 2023 Harlow Summit',
    issuingState: 'Washington',
    vin: '1VTDM0000PA500105',
    vehicle: '2023 Harlow Summit',
    owner: 'Brightwater Motors',
    status: 'In hand',
    openedOn: -30,
    clerk: 'ines.calloway',
  },
  {
    // Bought at auction 31 days ago, sold since, and its title not yet come: overdue.
    number: 'TTL-6008',
    summary: 'Title TTL-6008, 2021 Quenby Lark',
    issuingState: 'Idaho',
    vin: '1VTDM0000MA500106',
    vehicle: '2021 Quenby Lark',
    owner: 'Brightwater Motors',
    status: 'Awaiting title',
    openedOn: -31,
    clerk: 'bram.vasquez',
    notes: 'Bought at auction; the auction house has not sent the title.',
  },
];

/** Each item of `received` done, by `by`, `daysAgo` days ago; every other item of the deal's not. */
const done = (by, daysAgo, ...items) => items.map((item) => ({ item, by, daysAgo }));

export const DEALS = [
  {
    number: 'VD-5001',
    summary: 'Marisol Fenwick, 2025 Velmont Arden',
    buyer: 'Marisol Fenwick',
    buyerEmail: 'marisol.fenwick@example.com',
    buyerPhone: '+1 555 010 4101',
    vin: '1VTDM0000SA500101',
    year: '2025',
    make: 'Velmont',
    model: 'Arden',
    price: 38450,
    financeType: 'Loan',
    lender: 'Larkspur Credit Union',
    amountFinanced: 30000,
    termMonths: 60,
    tradeIn: false,
    title: 'TTL-6001',
    status: 'Delivered',
    salesperson: 'dario.whitlock',
    financeManager: 'selma.okonkwo',
    soldOn: -12,
    deliveredOn: -10,
    received: done('selma.okonkwo', 10, ...ALL),
  },
  {
    // Delivered with its odometer statement missing: in the deals missing documents queue.
    number: 'VD-5002',
    summary: 'Tobiah Rennick, 2022 Harlow Brisk',
    buyer: 'Tobiah Rennick',
    buyerEmail: 'tobiah.rennick@example.com',
    buyerPhone: '+1 555 010 4102',
    vin: '1VTDM0000NA500102',
    year: '2022',
    make: 'Harlow',
    model: 'Brisk',
    price: 24900,
    financeType: 'Cash',
    tradeIn: true,
    tradeInVehicle: '2019 Quenby Lark',
    tradeInVin: '1VTDM0000KA510301',
    tradeInAllowance: 9500,
    tradeInPayoff: 6200,
    tradeInTitle: 'TTL-6003',
    title: 'TTL-6002',
    status: 'Delivered',
    salesperson: 'amara.oyelaran',
    soldOn: -20,
    deliveredOn: -19,
    received: done(
      'amara.oyelaran',
      19,
      'driversLicense',
      'insurance',
      'buyersOrder',
      'titleApplication',
      'deliveryReceipt',
    ),
    notes: 'The buyer took the odometer statement home to sign. Chase it.',
  },
  {
    number: 'VD-5003',
    summary: 'Corwin Halloran, 2024 Velmont Tessel',
    buyer: 'Corwin Halloran',
    buyerEmail: 'corwin.halloran@example.com',
    buyerPhone: '+1 555 010 4103',
    vin: '1VTDM0000RA500103',
    year: '2024',
    make: 'Velmont',
    model: 'Tessel',
    price: 41200,
    financeType: 'Lease',
    lender: 'Harrow Valley Bank',
    amountFinanced: 36800,
    termMonths: 36,
    tradeIn: false,
    title: 'TTL-6005',
    status: 'Delivered',
    salesperson: 'dario.whitlock',
    financeManager: 'selma.okonkwo',
    soldOn: -60,
    deliveredOn: -58,
    received: done('selma.okonkwo', 58, ...ALL),
  },
  {
    // Contracted 14 days ago and not funded: the banner. Missing three documents.
    number: 'VD-5004',
    summary: 'Juniper Achebe-Holt, 2025 Velmont Arden',
    buyer: 'Juniper Achebe-Holt',
    buyerEmail: 'juniper.achebe-holt@example.com',
    buyerPhone: '+1 555 010 4104',
    vin: '1VTDM0000SA500104',
    year: '2025',
    make: 'Velmont',
    model: 'Arden',
    price: 39900,
    financeType: 'Loan',
    lender: 'Kestrel Auto Finance',
    amountFinanced: 27500,
    termMonths: 72,
    tradeIn: true,
    tradeInVehicle: '2018 Harlow Summit',
    tradeInVin: '1VTDM0000JA510302',
    tradeInAllowance: 11000,
    tradeInPayoff: 7400,
    tradeInTitle: 'TTL-6004',
    title: 'TTL-6006',
    status: 'Contracted',
    salesperson: 'amara.oyelaran',
    financeManager: 'selma.okonkwo',
    soldOn: -14,
    received: [
      ...done('amara.oyelaran', 14, 'driversLicense', 'insurance', 'buyersOrder', 'odometer'),
      ...done('selma.okonkwo', 13, 'creditApplication', 'financeContract'),
    ],
    notes: "Kestrel asked for two pay stubs before it funds. The lender's approval is not in.",
  },
  {
    number: 'VD-5005',
    summary: 'Delphine Marchetti, 2023 Harlow Summit',
    buyer: 'Delphine Marchetti',
    buyerEmail: 'delphine.marchetti@example.com',
    buyerPhone: '+1 555 010 4105',
    vin: '1VTDM0000PA500105',
    year: '2023',
    make: 'Harlow',
    model: 'Summit',
    price: 29750,
    financeType: 'Cash',
    tradeIn: false,
    title: 'TTL-6007',
    status: 'Delivered',
    salesperson: 'dario.whitlock',
    soldOn: -30,
    deliveredOn: -27,
    received: done('dario.whitlock', 27, ...REQUIRED_DOCUMENTS),
  },
  {
    // Still being worked: not sold, so in no queue, whatever it lacks.
    number: 'VD-5006',
    summary: 'Augustin Pell, 2025 Velmont Tessel',
    buyer: 'Augustin Pell',
    buyerEmail: 'augustin.pell@example.com',
    buyerPhone: '+1 555 010 4106',
    vin: '1VTDM0000SA500107',
    year: '2025',
    make: 'Velmont',
    model: 'Tessel',
    price: 43100,
    financeType: 'Loan',
    lender: 'Larkspur Credit Union',
    amountFinanced: 35000,
    termMonths: 60,
    tradeIn: false,
    status: 'Working',
    salesperson: 'amara.oyelaran',
    received: done('amara.oyelaran', 2, 'driversLicense'),
  },
  {
    // Unwound when its financing fell through: cancelled, so in no queue. Its vehicle was sold
    // again, in VD-5002, so its title lists both deals.
    number: 'VD-5007',
    summary: 'Rosalind Ebbe, 2022 Harlow Brisk',
    buyer: 'Rosalind Ebbe',
    buyerEmail: 'rosalind.ebbe@example.com',
    buyerPhone: '+1 555 010 4107',
    vin: '1VTDM0000NA500102',
    year: '2022',
    make: 'Harlow',
    model: 'Brisk',
    price: 25400,
    financeType: 'Loan',
    lender: 'Kestrel Auto Finance',
    amountFinanced: 21000,
    termMonths: 60,
    tradeIn: false,
    title: 'TTL-6002',
    status: 'Cancelled',
    salesperson: 'dario.whitlock',
    financeManager: 'selma.okonkwo',
    soldOn: -26,
    received: done('dario.whitlock', 26, 'driversLicense', 'buyersOrder'),
    notes: 'The lender declined the application; the vehicle went back to stock.',
  },
  {
    // Funded, and missing the buyer's proof of insurance.
    number: 'VD-5008',
    summary: 'Silas Varnum, 2021 Quenby Lark',
    buyer: 'Silas Varnum',
    buyerEmail: 'silas.varnum@example.com',
    buyerPhone: '+1 555 010 4108',
    vin: '1VTDM0000MA500106',
    year: '2021',
    make: 'Quenby',
    model: 'Lark',
    price: 17600,
    financeType: 'Lease',
    lender: 'Harrow Valley Bank',
    amountFinanced: 15900,
    termMonths: 24,
    tradeIn: false,
    title: 'TTL-6008',
    status: 'Funded',
    salesperson: 'amara.oyelaran',
    financeManager: 'selma.okonkwo',
    soldOn: -7,
    received: done(
      'selma.okonkwo',
      5,
      'driversLicense',
      'buyersOrder',
      'odometer',
      'titleApplication',
      'deliveryReceipt',
      ...FINANCE_DOCUMENTS,
    ),
  },
];

/** The documents a deal's checklist cards list: every deal's six, and a financed deal's three. */
export function documentsOf(deal) {
  return deal.financeType === 'Cash' ? REQUIRED_DOCUMENTS : ALL;
}

/**
 * A deal's checklist, as the seed writes it and the checklist card reads it: an entry for each of
 * its documents, in order, done with who and when where `received` names it, and not done, with
 * no one and no day, where it does not.
 */
export function checklistOf(deal, today = new Date()) {
  return documentsOf(deal).map((item) => {
    const got = deal.received.find((entry) => entry.item === item);
    return got
      ? { item, done: true, doneBy: got.by, doneOn: dayFrom(-got.daysAgo, today) }
      : { item, done: false, doneBy: null, doneOn: null };
  });
}

const missing = (deal) => checklistOf(deal).some((entry) => !entry.done);
const titleOpen = (title) => title.status !== 'Issued';
const open = (title) => -title.openedOn;

/**
 * The records each page provider returns, by number, in its order. A title's deals take a
 * parameter, so theirs are by the title given, by its number.
 */
export const EXPECTED = {
  vtitles_deals_missing_documents: DEALS.filter((d) => SOLD.includes(d.status) && missing(d))
    .sort((a, b) => a.soldOn - b.soldOn)
    .map((d) => d.number),
  vtitles_overdue_titles: TITLES.filter((t) => titleOpen(t) && open(t) > OVERDUE_AFTER_DAYS)
    .sort((a, b) => a.openedOn - b.openedOn)
    .map((t) => t.number),
  vtitles_awaiting_lien_release: TITLES.filter((t) => t.status === 'Awaiting lien release')
    .sort((a, b) => a.payoffSentOn - b.payoffSentOn)
    .map((t) => t.number),
  vtitles_title_sales: Object.fromEntries(
    TITLES.map((t) => [
      t.number,
      DEALS.filter((d) => d.title === t.number)
        .sort((a, b) => b.soldOn - a.soldOn)
        .map((d) => d.number),
    ]),
  ),
  vtitles_title_trade_ins: Object.fromEntries(
    TITLES.map((t) => [
      t.number,
      DEALS.filter((d) => d.tradeInTitle === t.number)
        .sort((a, b) => b.soldOn - a.soldOn)
        .map((d) => d.number),
    ]),
  ),
};

/** The lien release queue's facets: the seeded titles awaiting release in each bucket. */
const awaiting = TITLES.filter((t) => t.status === 'Awaiting lien release');
export const LIEN_BUCKETS = {
  vtitle_lienHolder_agg: count(awaiting.map((t) => t.lienHolder)),
  vtitle_issuingState_agg: count(awaiting.map((t) => t.issuingState)),
};

function count(keys) {
  const counts = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

/** `days` from `today`, as the day a date property stores: `YYYY-MM-DD`, in UTC. */
export function dayFrom(days, today = new Date()) {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
