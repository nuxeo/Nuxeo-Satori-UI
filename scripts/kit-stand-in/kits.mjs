/**
 * How the kit stand-in (`scripts/kit-stand-in.mjs`) reads each demo kit's `demo/data.mjs`: which
 * of its exports are records, of which type, in which folder, and which property each value is
 * written to.
 *
 * **Why per kit.** A kit's `data.mjs` holds its records in its own words (`number`, `soldOn: -12`,
 * a title linked by its number), and its `seed.mjs` turns them into properties as it writes them.
 * That mapping is not exported: each seed runs as soon as it is imported. So it is written again
 * here, once per kit, as the seed writes it; `kit-stand-in.selftest.mjs` holds each mapping to
 * its seed's property names and to the kit's `content-model.json`, so that a seed that moves on
 * without this file is caught.
 *
 * Each kit gives:
 *
 * - `folders(data)`: the folders of the kit's workspace, by the key each record names, as the
 *   seed creates them under `/default-domain/workspaces/<WORKSPACE.name>`;
 * - `records(data, { id, day, today })`: every record, in the order the seed writes them, each
 *   `{ key, type, folder, name, properties }`. `key` is what `EXPECTED` lists the record by, its
 *   number or tag, and is unique within the kit; `name` is the seed's document name; `id(key)` is
 *   the stand-in's id of another record, for a link the seed writes as an id; `day(days)` is the
 *   seed's date, days from today's UTC day, or `null` for none.
 *
 * Only kits whose `data.mjs` exports `EXPECTED` are here: the stand-in answers a page provider from
 * it, and evaluates no NXQL.
 */

/** A record's document name, as the kits' seeds name one: its number, in lower case, dashed. */
export function nameOf(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const or = (value) => value ?? null;

export const KITS = {
  'vehicle-titles-demo': {
    folders: (data) => data.FOLDERS,
    records(data, { id, day, today }) {
      const titles = data.TITLES.map((title) => ({
        key: title.number,
        type: 'VehicleTitle',
        folder: 'titles',
        name: nameOf(title.number),
        properties: {
          'dc:title': title.summary,
          'vtitle:number': title.number,
          'vtitle:issuingState': title.issuingState,
          'vtitle:vin': title.vin,
          'vtitle:vehicle': title.vehicle,
          'vtitle:owner': title.owner,
          'vtitle:status': title.status,
          'vtitle:lienHolder': or(title.lienHolder),
          'vtitle:payoffSentOn': day(title.payoffSentOn),
          'vtitle:lienReleasedOn': day(title.lienReleasedOn),
          'vtitle:openedOn': day(title.openedOn),
          'vtitle:submittedOn': day(title.submittedOn),
          'vtitle:issuedOn': day(title.issuedOn),
          'vtitle:clerk': or(title.clerk),
          'vtitle:notes': or(title.notes),
        },
      }));
      const deals = data.DEALS.map((deal) => ({
        key: deal.number,
        type: 'VehicleDeal',
        folder: 'deals',
        name: nameOf(deal.number),
        properties: {
          'dc:title': deal.summary,
          'vdeal:number': deal.number,
          'vdeal:buyer': deal.buyer,
          'vdeal:buyerEmail': deal.buyerEmail,
          'vdeal:buyerPhone': deal.buyerPhone,
          'vdeal:vin': deal.vin,
          'vdeal:year': deal.year,
          'vdeal:make': deal.make,
          'vdeal:model': deal.model,
          'vdeal:price': deal.price,
          'vdeal:financeType': deal.financeType,
          'vdeal:lender': or(deal.lender),
          'vdeal:amountFinanced': or(deal.amountFinanced),
          'vdeal:termMonths': or(deal.termMonths),
          'vdeal:tradeIn': deal.tradeIn,
          'vdeal:tradeInVehicle': or(deal.tradeInVehicle),
          'vdeal:tradeInVin': or(deal.tradeInVin),
          'vdeal:tradeInAllowance': or(deal.tradeInAllowance),
          'vdeal:tradeInPayoff': or(deal.tradeInPayoff),
          'vdeal:tradeInTitle': deal.tradeInTitle === undefined ? null : id(deal.tradeInTitle),
          'vdeal:title': deal.title === undefined ? null : id(deal.title),
          'vdeal:status': deal.status,
          'vdeal:salesperson': or(deal.salesperson),
          'vdeal:financeManager': or(deal.financeManager),
          'vdeal:soldOn': day(deal.soldOn),
          'vdeal:deliveredOn': day(deal.deliveredOn),
          'vdeal:notes': or(deal.notes),
          'vdocs:checklist': data.checklistOf(deal, today),
        },
      }));
      return [...titles, ...deals];
    },
  },

  'pc-claims-demo': {
    folders: (data) => data.FOLDERS,
    records(data, { id, day }) {
      const policies = data.POLICIES.map((policy) => ({
        key: policy.number,
        type: 'PropertyPolicy',
        folder: 'policies',
        name: nameOf(policy.number),
        properties: {
          'dc:title': policy.title,
          'ppolicy:number': policy.number,
          'ppolicy:holder': policy.holder,
          'ppolicy:holderEmail': policy.holderEmail,
          'ppolicy:holderPhone': policy.holderPhone,
          'ppolicy:propertyAddress': policy.propertyAddress,
          'ppolicy:product': policy.product,
          'ppolicy:status': policy.status,
          'ppolicy:effective': day(policy.effective),
          'ppolicy:expiry': day(policy.expiry),
          'ppolicy:coverageLimit': policy.coverageLimit,
          'ppolicy:deductible': policy.deductible,
        },
      }));
      const claims = data.CLAIMS.map((claim) => ({
        key: claim.number,
        type: 'PropertyClaim',
        folder: 'claims',
        name: nameOf(claim.number),
        properties: {
          'dc:title': claim.title,
          'pclaim:number': claim.number,
          'pclaim:policy': id(claim.policy),
          'pclaim:lossDate': day(claim.lossDate),
          'pclaim:cause': claim.cause,
          'pclaim:lossLocation': claim.lossLocation,
          'pclaim:lossDescription': claim.lossDescription,
          'pclaim:reportedOn': day(claim.reportedOn),
          'pclaim:status': claim.status,
          'pclaim:adjuster': or(claim.adjuster),
          'pclaim:reserve': claim.reserve,
          'pclaim:denialReason': or(claim.denialReason),
        },
      }));
      return [...policies, ...claims];
    },
  },

  'contracts-demo': {
    folders: (data) => ({ contracts: data.FOLDER }),
    records(data, { day }) {
      return data.CONTRACTS.map((contract) => ({
        key: contract.number,
        type: 'Contract',
        folder: 'contracts',
        name: nameOf(contract.number),
        properties: {
          'dc:title': contract.title,
          'contract:number': contract.number,
          'contract:counterparty': contract.counterparty,
          'contract:category': contract.category,
          'contract:status': contract.status,
          'contract:value': contract.value,
          'contract:currency': contract.currency,
          'contract:start': day(contract.start),
          'contract:end': day(contract.end),
          'contract:noticeDays': contract.noticeDays,
          'contract:autoRenew': contract.autoRenew,
          'contract:owner': contract.owner,
          'contract:terminationReason': or(contract.terminationReason),
          'contract:notes': contract.notes,
        },
      }));
    },
  },

  'moves-demo': {
    folders: (data) => data.FOLDERS,
    records(data, { id, day }) {
      const moves = data.MOVES.map((move) => ({
        key: move.number,
        type: 'Move',
        folder: 'moves',
        name: nameOf(move.number),
        properties: {
          'dc:title': move.title,
          'move:number': move.number,
          'move:customer': move.customer,
          'move:customerPhone': move.customerPhone,
          'move:customerEmail': move.customerEmail,
          'move:origin': move.origin,
          'move:destination': move.destination,
          'move:loadDate': day(move.load),
          'move:deliveryDate': day(move.delivery),
          'move:deliveredOn': day(move.deliveredOn),
          'move:state': move.state,
          'move:coordinator': move.coordinator,
          'move:crewLead': move.crewLead,
          'move:crew': move.crew,
          'move:truck': move.truck,
          'move:declaredValue': move.declaredValue,
          'move:notes': or(move.notes),
        },
      }));
      const items = data.ITEMS.map((item) => ({
        key: item.tag,
        type: 'MoveItem',
        folder: 'items',
        name: nameOf(`${item.move}-${item.tag}`),
        properties: {
          'dc:title': item.title,
          'moveitem:move': id(item.move),
          'moveitem:tag': item.tag,
          'moveitem:room': item.room,
          'moveitem:condition': item.condition,
          'moveitem:declaredValue': item.declaredValue,
        },
      }));
      const claims = data.CLAIMS.map((claim) => ({
        key: claim.number,
        type: 'DamageClaim',
        folder: 'claims',
        name: nameOf(claim.number),
        properties: {
          'dc:title': claim.title,
          'dmg:number': claim.number,
          'dmg:move': id(claim.move),
          'dmg:moveNumber': claim.move,
          'dmg:items': claim.items.map((tag) => id(tag)),
          'dmg:deliveredOn': day(data.deliveredOnOf(claim)),
          'dmg:filedOn': day(claim.filedOn),
          'dmg:amountClaimed': claim.amountClaimed,
          'dmg:amountApproved': or(claim.amountApproved),
          'dmg:state': claim.state,
          'dmg:adjuster': or(claim.adjuster),
          'dmg:details': claim.details,
          'dmg:decidedOn': day(claim.decidedOn),
          'dmg:denialReason': or(claim.denialReason),
        },
      }));
      return [...moves, ...items, ...claims];
    },
  },
};
