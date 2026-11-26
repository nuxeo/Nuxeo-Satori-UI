/**
 * The P&C claims kit's fictional records, which `seed.mjs` writes. No real insurer, person, address,
 * policy or claim: every name here is made up, every phone number is a 555 number and every address
 * is at example.com.
 *
 * Dates are days from the UTC day the seed runs, so that the queues and banners hold the same
 * records whichever day it is run: `lossDate: -21` is 21 days ago. `dayFrom` turns them into dates.
 *
 * A claim's `policy` is written by its policy's number, not by id, since the ids are the server's:
 * the seed writes it as the id of the policy it names, `pclaim:policy`, as the claim page's
 * `document-link` reads it. So the policies are written first.
 *
 * `EXPECTED` says which records each of the kit's page providers returns, worked out from the data
 * as `pc-claims-demo-model.xml` defines the queries. The seed checks each against the server.
 */

/** The workspace the records go in, and the folder of each type. */
export const WORKSPACE = { name: 'pc-claims-demo', title: 'Property claims demo' };
export const FOLDERS = {
  policies: { name: 'policies', title: 'Policies' },
  claims: { name: 'claims', title: 'Property claims' },
};

/** The adjusters' user names: fictional, and not created by the seed. */
export const ADJUSTERS = ['noor.halvorsen', 'tobias.renner', 'imani.castell'];

/** The reserve over which an open claim is listed by `pc_high_reserve_claims`, in US dollars. */
export const RESERVE_THRESHOLD = 50000;

export const POLICIES = [
  {
    number: 'POL-PC-1001',
    title: 'Homeowners, 27 Juniper Row',
    holder: 'Wren Achterberg',
    holderEmail: 'wren.achterberg@example.com',
    holderPhone: '+1 555 010 3101',
    propertyAddress: '27 Juniper Row, Fairhaven',
    product: 'Homeowners',
    status: 'In force',
    effective: -400,
    expiry: 330,
    coverageLimit: 650000,
    deductible: 2500,
  },
  {
    number: 'POL-PC-1002',
    title: 'Small business, Calder and Finch Bakery',
    holder: 'Calder and Finch Bakery',
    holderEmail: 'office@calder-finch.example.com',
    holderPhone: '+1 555 010 3102',
    propertyAddress: '9 Market Square, Old Town',
    product: 'Small business',
    status: 'In force',
    effective: -200,
    expiry: 165,
    coverageLimit: 1200000,
    deductible: 10000,
  },
  {
    number: 'POL-PC-1003',
    title: 'Condominium, Unit 4C, 300 Harbor View',
    holder: 'Linnea Osei',
    holderEmail: 'linnea.osei@example.com',
    holderPhone: '+1 555 010 3103',
    propertyAddress: 'Unit 4C, 300 Harbor View, Harbor Point',
    product: 'Condominium',
    status: 'In force',
    effective: -340,
    // Ends in 25 days: the policy page's banner says it ends within 30.
    expiry: 25,
    coverageLimit: 250000,
    deductible: 1000,
  },
  {
    number: 'POL-PC-1004',
    title: 'Landlord, 61 Weir Lane',
    holder: 'Gideon Marsh-Tanaka',
    holderEmail: 'gideon.marsh-tanaka@example.com',
    holderPhone: '+1 555 010 3104',
    propertyAddress: '61 Weir Lane, Brookside',
    product: 'Landlord',
    // Lapsed: the policy page's banner says it is not in force.
    status: 'Lapsed',
    effective: -500,
    expiry: -135,
    coverageLimit: 480000,
    deductible: 5000,
  },
  {
    number: 'POL-PC-1005',
    title: 'Homeowners, 5 Kestrel Close',
    holder: 'Ottoline Brandt',
    holderEmail: 'ottoline.brandt@example.com',
    holderPhone: '+1 555 010 3105',
    propertyAddress: '5 Kestrel Close, Cedar Falls',
    product: 'Homeowners',
    status: 'In force',
    effective: -60,
    expiry: 305,
    coverageLimit: 820000,
    deductible: 2500,
  },
];

export const CLAIMS = [
  {
    number: 'PC-24001',
    title: 'Kitchen fire, smoke damage throughout',
    policy: 'POL-PC-1001',
    lossDate: -21,
    reportedOn: -20,
    cause: 'Fire',
    lossLocation: '27 Juniper Row, Fairhaven: the kitchen',
    lossDescription:
      'A pan fire spread to the cabinets. The kitchen is gutted; smoke reached every room upstairs.',
    status: 'Investigating',
    adjuster: 'noor.halvorsen',
    reserve: 85000,
  },
  {
    number: 'PC-24002',
    title: 'Burst pipe under the bathroom floor',
    policy: 'POL-PC-1001',
    lossDate: -9,
    reportedOn: -8,
    cause: 'Water',
    lossLocation: '27 Juniper Row, Fairhaven: the upstairs bathroom',
    lossDescription: 'A supply pipe split under the floor; the ceiling below came down.',
    status: 'Reported',
    reserve: 12000,
  },
  {
    number: 'PC-24003',
    title: 'Roof torn in a windstorm, stock soaked',
    policy: 'POL-PC-1002',
    // Reported 38 days after the loss: the claim page's banner says more than 30.
    lossDate: -50,
    reportedOn: -12,
    cause: 'Wind',
    lossLocation: '9 Market Square, Old Town: the bakery and its store room',
    lossDescription:
      'Part of the roof lifted in the storm. Rain soaked the flour store; the owners found it after a holiday closure.',
    status: 'Investigating',
    adjuster: 'tobias.renner',
    reserve: 140000,
  },
  {
    number: 'PC-24004',
    title: 'Hail damage to the balcony glazing',
    policy: 'POL-PC-1003',
    lossDate: -16,
    reportedOn: -15,
    cause: 'Hail',
    lossLocation: 'Unit 4C, 300 Harbor View, Harbor Point: the balcony',
    lossDescription: 'Three glazing panels cracked in a hailstorm.',
    status: 'Approved',
    adjuster: 'imani.castell',
    reserve: 6800,
  },
  {
    number: 'PC-24005',
    title: 'Break-in, electronics taken from storage',
    policy: 'POL-PC-1003',
    // Reported on the 30th day after the loss: no banner, which needs more than 30.
    lossDate: -70,
    reportedOn: -40,
    cause: 'Theft',
    lossLocation: 'Unit 4C, 300 Harbor View, Harbor Point: the shared storage room',
    lossDescription: 'A storage cage was forced; a television and two laptops were taken.',
    status: 'Denied',
    adjuster: 'tobias.renner',
    reserve: 0,
    denialReason:
      "The policy's contents cover excludes property kept in a shared storage room outside the unit.",
  },
  {
    number: 'PC-24006',
    title: 'Front windows broken at the rental',
    policy: 'POL-PC-1004',
    // Reported 50 days after the loss, on a policy that has lapsed since: closed.
    lossDate: -150,
    reportedOn: -100,
    cause: 'Vandalism',
    lossLocation: '61 Weir Lane, Brookside: the street front',
    lossDescription: 'Two ground-floor windows broken overnight while the house stood empty.',
    status: 'Closed',
    adjuster: 'noor.halvorsen',
    reserve: 0,
  },
  {
    number: 'PC-24007',
    title: 'Garage flooded after heavy rain',
    policy: 'POL-PC-1005',
    lossDate: -5,
    reportedOn: -4,
    cause: 'Water',
    lossLocation: '5 Kestrel Close, Cedar Falls: the garage',
    lossDescription:
      'Surface water came in under the door; a freezer and stored furniture stood in it.',
    status: 'Reported',
    reserve: 30000,
  },
  {
    number: 'PC-24008',
    title: 'Lightning strike, electrical fire in the attic',
    policy: 'POL-PC-1005',
    lossDate: -33,
    reportedOn: -31,
    cause: 'Fire',
    lossLocation: '5 Kestrel Close, Cedar Falls: the attic',
    lossDescription: 'Lightning struck the chimney; the wiring in the attic burned.',
    status: 'Approved',
    adjuster: 'noor.halvorsen',
    reserve: 52000,
  },
];

const OPEN = ['Reported', 'Investigating', 'Approved'];
const open = CLAIMS.filter((c) => OPEN.includes(c.status));

/**
 * The records each page provider returns, by number, in its order. The policy's claims take a
 * parameter, so theirs are by the policy given, by its number.
 */
export const EXPECTED = {
  pc_open_claims: [...open].sort((a, b) => a.reportedOn - b.reportedOn).map((c) => c.number),
  pc_high_reserve_claims: open
    .filter((c) => c.reserve > RESERVE_THRESHOLD)
    .sort((a, b) => b.reserve - a.reserve)
    .map((c) => c.number),
  pc_policy_claims: Object.fromEntries(
    POLICIES.map((p) => [
      p.number,
      CLAIMS.filter((c) => c.policy === p.number)
        .sort((a, b) => b.lossDate - a.lossDate)
        .map((c) => c.number),
    ]),
  ),
};

/** The open claims queue's facets: the seeded open claims in each bucket. */
export const OPEN_BUCKETS = {
  pclaim_status_agg: count(open.map((c) => c.status)),
  pclaim_cause_agg: count(open.map((c) => c.cause)),
  pclaim_adjuster_agg: count(open.filter((c) => c.adjuster).map((c) => c.adjuster)),
  // By the policy's number here: the server's buckets are the policies' ids, which the seed maps
  // back, and the queue's Policy facet shows each by its policy's title.
  pclaim_policy_agg: count(open.map((c) => c.policy)),
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
