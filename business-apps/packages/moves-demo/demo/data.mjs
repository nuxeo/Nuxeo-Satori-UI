/**
 * The moves kit's fictional records, which `seed.mjs` writes. No real company, person, address or
 * move: every name here is made up, every phone number is a 555 number and every address is at
 * example.com.
 *
 * Dates are days from the UTC day the seed runs, so that the queues hold the same records whichever
 * day it is run: `load: 4` is four days from today. `dayFrom` turns them into dates. None falls on
 * the edge of "this week", today or seven days ahead, where the server's clock and a day counted in
 * UTC could disagree.
 *
 * Links are written by key, not by id, since the ids are the server's: an item's `move` and a
 * claim's `move` are a move's number, a claim's `items` its items' tags. The seed writes each as
 * the id of the record it names, `moveitem:move`, `dmg:move` and `dmg:items`, and the move's number
 * as `dmg:moveNumber` too, which the claim's Edit form shows. The open claims queue's Move facet
 * groups by `dmg:move`, and shows each move by its title. A claim's `deliveredOn` is its move's,
 * copied: the late-filing banner's rule and the days to filing read it, and a rule or a
 * computation reads the open record only (layout-v2.md, sections 4 and 5).
 *
 * `EXPECTED` says which records each of the kit's page providers returns, worked out from the data
 * as `moves-demo-model.xml` defines the queries. The seed checks each against the server.
 */

/** The workspace the records go in, and the folder of each type. */
export const WORKSPACE = { name: 'moves-demo', title: 'Moves demo' };
export const FOLDERS = {
  moves: { name: 'moves', title: 'Moves' },
  items: { name: 'inventory', title: 'Inventory' },
  claims: { name: 'claims', title: 'Damage claims' },
};

/** The coordinators', crews' and adjusters' user names: fictional, and not created by the seed. */
export const PEOPLE = {
  coordinators: ['avery.lane', 'jules.hart'],
  crew: ['tomas.reyes', 'nadia.brook', 'ezra.lund', 'mira.solis'],
  adjusters: ['rowan.ellis', 'kai.morgan'],
};

export const MOVES = [
  {
    number: 'MV-2001',
    title: 'Quinlan household, Fairhaven to Lakemont',
    customer: 'Morgan Quinlan',
    customerPhone: '+1 555 010 2001',
    customerEmail: 'morgan.quinlan@example.com',
    origin: '14 Larkspur Lane, Fairhaven',
    destination: '220 Shore Road, Lakemont',
    load: -15,
    delivery: -12,
    deliveredOn: -12,
    state: 'Delivered',
    coordinator: 'avery.lane',
    crewLead: 'tomas.reyes',
    crew: ['tomas.reyes', 'nadia.brook'],
    truck: 'TRK-07',
    declaredValue: 42000,
    notes: 'Piano moved by the crew lead; stairs at the destination.',
  },
  {
    number: 'MV-2002',
    title: 'Okonkwo apartment, Riverside to Pine Hollow',
    customer: 'Ada Okonkwo',
    customerPhone: '+1 555 010 2002',
    customerEmail: 'ada.okonkwo@example.com',
    origin: '8 Mill Street, Apt 3B, Riverside',
    destination: '51 Birch Court, Pine Hollow',
    load: -48,
    delivery: -45,
    deliveredOn: -45,
    state: 'Delivered',
    coordinator: 'jules.hart',
    crewLead: 'ezra.lund',
    crew: ['ezra.lund', 'mira.solis'],
    truck: 'TRK-03',
    declaredValue: 18000,
    notes: 'Boxes left packed in the garage at the destination.',
  },
  {
    number: 'MV-2003',
    title: 'Lindgren family, Harbor Point to Cedar Falls',
    customer: 'Petra Lindgren',
    customerPhone: '+1 555 010 2003',
    customerEmail: 'petra.lindgren@example.com',
    origin: '3 Quay Row, Harbor Point',
    destination: '77 Orchard Way, Cedar Falls',
    load: -2,
    delivery: 3,
    state: 'In transit',
    coordinator: 'avery.lane',
    crewLead: 'nadia.brook',
    crew: ['nadia.brook', 'ezra.lund'],
    truck: 'TRK-11',
    declaredValue: 35000,
    notes: 'Long distance: one overnight stop.',
  },
  {
    number: 'MV-2004',
    title: 'Marsh studio, Old Town to Brookside',
    customer: 'Rafe Marsh',
    customerPhone: '+1 555 010 2004',
    customerEmail: 'rafe.marsh@example.com',
    origin: '19 Kiln Yard, Old Town',
    destination: '6 Weir Lane, Brookside',
    load: 4,
    delivery: 5,
    state: 'Booked',
    coordinator: 'jules.hart',
    crewLead: 'mira.solis',
    crew: ['mira.solis'],
    truck: 'TRK-03',
    declaredValue: 9000,
    notes: 'Artwork to be crated on the day.',
  },
  {
    number: 'MV-2005',
    title: 'Delacroix home, Westfield to Fairhaven',
    customer: 'Ines Delacroix',
    customerPhone: '+1 555 010 2005',
    customerEmail: 'ines.delacroix@example.com',
    origin: '402 Linden Avenue, Westfield',
    destination: '9 Heron Close, Fairhaven',
    load: 9,
    delivery: 12,
    state: 'Packed',
    coordinator: 'avery.lane',
    crewLead: 'tomas.reyes',
    crew: ['tomas.reyes', 'mira.solis'],
    truck: 'TRK-07',
    declaredValue: 27000,
    notes: 'Packed two weeks ahead at the customer’s request.',
  },
  {
    number: 'MV-2006',
    title: 'Ishikawa house, Lakemont to Harbor Point',
    customer: 'Ren Ishikawa',
    customerPhone: '+1 555 010 2006',
    customerEmail: 'ren.ishikawa@example.com',
    origin: '31 Ridge Road, Lakemont',
    destination: '12 Quay Row, Harbor Point',
    load: 2,
    delivery: 3,
    state: 'Cancelled',
    coordinator: 'jules.hart',
    crewLead: 'ezra.lund',
    crew: ['ezra.lund'],
    truck: 'TRK-11',
    declaredValue: 22000,
    notes: 'Cancelled by the customer; deposit refunded.',
  },
  {
    number: 'MV-2007',
    title: 'Abernathy townhouse, Cedar Falls to Riverside',
    customer: 'Theo Abernathy',
    customerPhone: '+1 555 010 2007',
    customerEmail: 'theo.abernathy@example.com',
    origin: '5 Bell Street, Cedar Falls',
    destination: '88 Wharf Lane, Riverside',
    load: -32,
    delivery: -30,
    deliveredOn: -30,
    state: 'Delivered',
    coordinator: 'avery.lane',
    crewLead: 'nadia.brook',
    crew: ['nadia.brook', 'tomas.reyes'],
    truck: 'TRK-07',
    declaredValue: 31000,
  },
  {
    number: 'MV-2008',
    title: 'Ferrante flat, Brookside to Westfield',
    customer: 'Lucia Ferrante',
    customerPhone: '+1 555 010 2008',
    customerEmail: 'lucia.ferrante@example.com',
    origin: '27 Mill Race, Brookside',
    destination: '140 Linden Avenue, Westfield',
    load: -5,
    delivery: -2,
    state: 'In transit',
    coordinator: 'jules.hart',
    crewLead: 'mira.solis',
    crew: ['mira.solis', 'ezra.lund'],
    truck: 'TRK-11',
    declaredValue: 14000,
    notes: 'Truck held at the depot for a repair: delivery late.',
  },
];

/** Each move's inventory, by its number: a tag, what it is, its room, its condition, its value. */
export const ITEMS = [
  ['MV-2001', 'A01', 'Oak dining table', 'Dining room', 'Good', 1800],
  ['MV-2001', 'A02', 'Glass display cabinet', 'Living room', 'Good', 950],
  ['MV-2001', 'A03', 'Upright piano', 'Living room', 'Worn', 4200],
  ['MV-2001', 'A04', 'Kitchen china, 24 pieces, boxed', 'Kitchen', 'Good', 600],
  ['MV-2002', 'B01', 'Leather sofa', 'Living room', 'Good', 2100],
  ['MV-2002', 'B02', 'Television, 55 inch', 'Living room', 'Good', 700],
  ['MV-2002', 'B03', 'Bookcase', 'Office', 'Scratched', 250],
  ['MV-2003', 'C01', 'Queen bed frame', 'Bedroom', 'Good', 900],
  ['MV-2003', 'C02', 'Washing machine', 'Kitchen', 'Good', 650],
  ['MV-2004', 'D01', 'Drafting table', 'Office', 'Good', 400],
  ['MV-2004', 'D02', 'Framed prints, six', 'Office', 'Good', 300],
  ['MV-2005', 'E01', 'Dresser', 'Bedroom', 'Worn', 500],
  ['MV-2006', 'F01', 'Garden tools, boxed', 'Garage', 'Good', 150],
  ['MV-2007', 'G01', 'Walnut desk', 'Office', 'Good', 1200],
  ['MV-2007', 'G02', 'Floor lamp', 'Living room', 'Good', 180],
  ['MV-2007', 'G03', 'Mirror, gilt frame', 'Bedroom', 'Scratched', 450],
  ['MV-2008', 'H01', 'Sectional sofa', 'Living room', 'Good', 2600],
  ['MV-2008', 'H02', 'Chest freezer', 'Garage', 'Good', 500],
].map(([move, tag, title, room, condition, declaredValue]) => ({
  move,
  tag,
  title,
  room,
  condition,
  declaredValue,
}));

export const CLAIMS = [
  {
    number: 'DC-3001',
    title: 'Dining table and cabinet damaged',
    move: 'MV-2001',
    items: ['A01', 'A02'],
    filedOn: -10,
    amountClaimed: 1150,
    state: 'In review',
    adjuster: 'rowan.ellis',
    details: 'A leg of the dining table split at the joint; the cabinet’s left door glass cracked.',
  },
  {
    number: 'DC-3002',
    title: 'Piano lid scratched',
    move: 'MV-2001',
    items: ['A03'],
    filedOn: -5,
    amountClaimed: 800,
    state: 'Filed',
    details: 'A scratch along the full length of the piano’s lid.',
  },
  {
    number: 'DC-3003',
    title: 'Television screen cracked',
    move: 'MV-2002',
    items: ['B02'],
    filedOn: -2,
    amountClaimed: 700,
    state: 'Filed',
    // Filed 43 days after its move's delivery: the late claim a banner would flag, if a registered
    // rule could compare the two dates. The claim page shows the days, as a computed field.
    details:
      'The screen was found cracked when the last boxes were unpacked, six weeks after delivery.',
  },
  {
    number: 'DC-3004',
    title: 'Mirror frame chipped',
    move: 'MV-2007',
    items: ['G03'],
    filedOn: -25,
    amountClaimed: 450,
    state: 'Denied',
    adjuster: 'kai.morgan',
    decidedOn: -15,
    details: 'Two chips in the gilt frame.',
    denialReason: 'The inventory at origin records the mirror’s frame as already scratched.',
  },
  {
    number: 'DC-3005',
    title: 'Desk top gouged',
    move: 'MV-2007',
    items: ['G01'],
    filedOn: -26,
    amountClaimed: 1200,
    amountApproved: 600,
    state: 'Paid',
    adjuster: 'rowan.ellis',
    decidedOn: -12,
    details: 'A gouge across the desk top, from a strap.',
  },
];

const OPEN = ['Filed', 'In review'];
const moveOf = (number) => MOVES.find((m) => m.number === number);

/**
 * The records each page provider returns, by number or tag, in its order. The related lists' page
 * providers take a parameter, so theirs are by the record given: a move's number, an item's tag.
 * "This week" is a load or a delivery from today to seven days ahead, of a move not cancelled.
 */
export const EXPECTED = {
  moves_this_week: MOVES.filter(
    (m) => m.state !== 'Cancelled' && [m.load, m.delivery].some((day) => day >= 0 && day <= 7),
  )
    .sort((a, b) => a.load - b.load)
    .map((m) => m.number),
  moves_open_claims: CLAIMS.filter((c) => OPEN.includes(c.state))
    .sort((a, b) => a.filedOn - b.filedOn)
    .map((c) => c.number),
  moves_move_items: Object.fromEntries(
    MOVES.map((m) => [
      m.number,
      ITEMS.filter((i) => i.move === m.number)
        .map((i) => i.tag)
        .sort(),
    ]),
  ),
  moves_move_claims: Object.fromEntries(
    MOVES.map((m) => [
      m.number,
      CLAIMS.filter((c) => c.move === m.number)
        .sort((a, b) => b.filedOn - a.filedOn)
        .map((c) => c.number),
    ]),
  ),
  moves_item_claims: Object.fromEntries(
    ITEMS.map((i) => [
      i.tag,
      CLAIMS.filter((c) => c.items.includes(i.tag))
        .sort((a, b) => b.filedOn - a.filedOn)
        .map((c) => c.number),
    ]),
  ),
};

/** The open claims queue's facets: the seeded open claims in each bucket. */
export const OPEN_BUCKETS = {
  dmg_state_agg: count(CLAIMS.filter((c) => OPEN.includes(c.state)).map((c) => c.state)),
  // By the move's number here: the server's buckets are the moves' ids, which the seed maps back.
  dmg_move_agg: count(CLAIMS.filter((c) => OPEN.includes(c.state)).map((c) => c.move)),
};

function count(keys) {
  const counts = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

/** A claim's delivery day: its move's, which the claim carries. */
export function deliveredOnOf(claim) {
  return moveOf(claim.move)?.deliveredOn;
}

/** `days` from `today`, as the day a date property stores: `YYYY-MM-DD`, in UTC. */
export function dayFrom(days, today = new Date()) {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
