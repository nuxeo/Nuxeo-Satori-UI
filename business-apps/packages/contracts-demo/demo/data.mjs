/**
 * The contracts kit's fictional records, which `seed.mjs` writes. No real company, person or
 * contract: every name here is made up.
 *
 * Dates are days from the UTC day the seed runs, so that the renewals queue holds the same
 * contracts whichever day it is run: `end: 30` is thirty days from today. `dayFrom` turns them into
 * dates. None ends within a day of the 90-day boundary, where the server's clock and a day counted
 * in UTC could disagree.
 *
 * `EXPECTED` says which contracts each of the kit's page providers returns, worked out from their
 * status and end as `contracts-demo-model.xml` defines the queries: active and ending within 90
 * days, active, and terminated. The seed checks each against the server.
 */

/** The workspace the records go in, and the folder that holds them. */
export const WORKSPACE = { name: 'contracts-demo', title: 'Contracts demo' };
export const FOLDER = { name: 'contracts', title: 'Contracts' };

/** The contract managers' user names: fictional, and not created by the seed. */
export const OWNERS = ['avery.quinn', 'jordan.blake'];

export const CONTRACTS = [
  {
    number: 'CTR-1001',
    title: 'Facilities maintenance',
    counterparty: 'Bramblewood Facilities Ltd',
    category: 'Services',
    status: 'Active',
    value: 48000,
    currency: 'USD',
    start: -335,
    end: 30,
    noticeDays: 60,
    autoRenew: true,
    owner: 'avery.quinn',
    notes: 'Covers the two fictional offices; renewed once before.',
  },
  {
    number: 'CTR-1002',
    title: 'Analytics platform licence',
    counterparty: 'Corvid Analytics',
    category: 'Licence',
    status: 'Active',
    value: 120000,
    currency: 'EUR',
    start: -655,
    end: 75,
    noticeDays: 90,
    autoRenew: false,
    owner: 'jordan.blake',
    notes: 'Seat count to review before renewal.',
  },
  {
    number: 'CTR-1003',
    title: 'Office lease, Harbour Street',
    counterparty: 'Tessera Leasing',
    category: 'Lease',
    status: 'Active',
    value: 360000,
    currency: 'GBP',
    start: -330,
    end: 400,
    noticeDays: 180,
    autoRenew: false,
    owner: 'avery.quinn',
    notes: null,
  },
  {
    number: 'CTR-1004',
    title: 'Catering services',
    counterparty: 'Larkspur Catering',
    category: 'Services',
    status: 'Terminated',
    value: 18500,
    currency: 'USD',
    start: -160,
    end: 200,
    noticeDays: 30,
    autoRenew: false,
    owner: 'jordan.blake',
    terminationReason: 'Repeated late deliveries. Ended early by mutual agreement.',
    notes: null,
  },
  {
    number: 'CTR-1005',
    title: 'Print supply',
    counterparty: 'Halden Print Co.',
    category: 'Supply',
    status: 'Expired',
    value: 9200,
    currency: 'USD',
    start: -405,
    end: -40,
    noticeDays: 30,
    autoRenew: false,
    owner: 'avery.quinn',
    notes: null,
  },
  {
    number: 'CTR-1006',
    title: 'Mutual non-disclosure',
    counterparty: 'Quillon Software',
    category: 'NDA',
    status: 'Draft',
    value: null,
    currency: null,
    start: 10,
    end: 740,
    noticeDays: null,
    autoRenew: false,
    owner: 'jordan.blake',
    notes: "Awaiting the other party's signature.",
  },
  {
    number: 'CTR-1007',
    title: 'Courier services',
    counterparty: 'Fernhill Couriers',
    category: 'Services',
    status: 'Active',
    value: 26000,
    currency: 'USD',
    start: -375,
    end: -10,
    noticeDays: 30,
    autoRenew: false,
    owner: 'avery.quinn',
    notes: 'Ended ten days ago and still marked active: the record page says so.',
  },
];

/** The contracts each page provider returns, by number, as the stand-in model defines them. */
export const EXPECTED = {
  contracts_up_for_renewal: CONTRACTS.filter((c) => c.status === 'Active' && c.end <= 90)
    .sort((a, b) => a.end - b.end)
    .map((c) => c.number),
  contracts_active: CONTRACTS.filter((c) => c.status === 'Active').map((c) => c.number),
  contracts_terminated: CONTRACTS.filter((c) => c.status === 'Terminated').map((c) => c.number),
};

/** `days` from `today`, as the day a date property stores: `YYYY-MM-DD`, in UTC. */
export function dayFrom(days, today = new Date()) {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
