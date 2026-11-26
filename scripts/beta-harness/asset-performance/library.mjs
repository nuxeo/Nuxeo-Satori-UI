/**
 * The brand assets kit's library at volume, synthetic: 100,000 `AcmeAsset` records that exist only
 * in this process, answered as Nuxeo answers the kit's `acme_asset_library` page provider. What the
 * performance check's stand-in serves (`stand-in.mjs`); nothing here talks to a server.
 *
 * Each record is a function of its number, so a run is repeatable and nothing is stored: the
 * product, colourway, shot and rights end come from the number, through a fixed mix. The rights end
 * is counted in days from the day the library is made, in UTC, as the page provider's `date_range`
 * aggregate counts it (`now/d`, `now+31d/d`).
 *
 * What it answers as Nuxeo does, read from the kit's page provider definition
 * (`business-apps/packages/brand-assets-demo/bundle/OSGI-INF/brand-assets-demo-model.xml`) and
 * the queue's reader (`libs/shared/queues/src/lib/facets.ts`):
 *
 * - **Paging:** `pageSize` and `currentPageIndex`, `pageSize` held to the provider's
 *   `maxPageSize` of 100, with `resultsCount`, `numberOfPages` and `isNextPageAvailable`.
 * - **The search index's window**, as Nuxeo 2025.10.18 answered it over OpenSearch's default
 *   `max_result_window` of 10,000 (docs/api-integrations.md, section 33): `resultsCountLimit` is
 *   the window whatever the query holds, and `resultsCount` the exact count, past it too. A page
 *   that ends past the window, `currentPageIndex` times `pageSize` plus `pageSize` above it, is
 *   refused ({@link PastWindowError}), even where the results run out before it. On the last page
 *   whose next one would end past it, `isNextPageAvailable` is false, and `isLastPageAvailable`
 *   only while the whole count and a page fit in it. `numberOfPages` is not held to it.
 * - **Order:** the provider's own, `dc:expired` ascending, records with no end last, as the search
 *   index puts a missing value; or `sortBy` and `sortOrder` on one of the asset's single values.
 * - **Facets:** the four aggregates, `acme_rights_agg` (`date_range`, Ended, Ending and Cleared),
 *   `acme_shot_agg`, `acme_product_agg` and `acme_type_agg` (`terms`, the 10 largest), every record
 *   in the last one's `AcmeAsset` bucket, since the stand-in holds no video. A bucket chosen is sent as a
 *   parameter named after its aggregate, a JSON array of keys. A record is kept when it is in any
 *   chosen bucket of each aggregate chosen in; each aggregate's buckets are counted with the other
 *   aggregates' choices and not its own, and a chosen bucket that holds nothing is listed in
 *   `extendedBuckets` at 0.
 *
 * What it does not: any query time of the index's own, also the deeper pages' within the window.
 * `stand-in.mjs` adds the latency.
 */

/** How many assets the library holds unless told otherwise: phase 5's "100,000 synthetic assets". */
export const LIBRARY_SIZE = 100_000;

/** The kit's page provider, as `queues/library.json` names it. */
export const PAGE_PROVIDER = 'acme_asset_library';

/** The provider's `maxPageSize`: Nuxeo answers a larger `pageSize` with this many. */
export const MAX_PAGE_SIZE = 100;

/** The provider's `pageSize`, which `queues/library.json` also sets. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * OpenSearch's default `index.max_result_window`, the index setting the local Nuxeo's indices
 * leave at its default: the most results a page may end at.
 */
export const RESULT_WINDOW = 10_000;

/**
 * What Nuxeo 2025.10.18 answers, HTTP 500, to a page of a provider the search index serves that
 * ends past the window: measured with `pageSize=1&currentPageIndex=10000`, and `50` and `200`.
 */
export const PAST_WINDOW_MESSAGE =
  'org.nuxeo.runtime.RuntimeServiceException: org.opensearch.client.opensearch._types.OpenSearchException: Request failed: [search_phase_execution_exception] all shards failed';

/** A page asked for that ends past the window: the server refuses it whole. */
export class PastWindowError extends Error {
  constructor(offset, pageSize, window) {
    super(`a page from result ${offset} of ${pageSize} ends past the window of ${window}`);
    this.name = 'PastWindowError';
  }
}

/** A terms aggregate's `size` in the provider: how many of its largest buckets it returns. */
const TERMS_SIZE = 10;

const DAY_MS = 86_400_000;

/** Where the seed writes, and so where a synthetic asset says it is. */
const ASSETS_PATH = '/default-domain/workspaces/acme-brand-assets/assets';
const ASSETS_FOLDER_UID = 'a55e7f00-0000-4000-8000-000000000000';

const PRODUCT_NAMES = [
  'Trailhead Rain Jacket',
  'Ridge Runner Trail Shoe',
  'Summit Down Parka',
  'Canyon Hiking Short',
  'Basecamp Fleece',
  'Switchback Pack',
  'Alpine Merino Tee',
  'Riverbend Sandal',
];
/** 400 products, AO-3101 to AO-3500: more than the Product facet's 10, so it is truncated. */
const PRODUCT_COUNT = 400;
const COLORWAYS = ['Moss', 'Slate', 'Ember', 'Glacier', 'Sand', 'Night', 'Fern', 'Rust'];
const SHOTS = ['Front', 'Back', 'Side', 'Detail', 'On model', 'Flat lay', 'Campaign', 'Lifestyle'];
const CAMPAIGNS = ['Into the Hills', 'First Light', 'Weather Anything', 'Long Way Round'];
const ALL_CHANNELS = ['E-commerce', 'Wholesale', 'Social', 'Print'];
const REGIONS = ['Worldwide', 'North America and Europe', 'Europe', 'North America'];
const STUDIO = 'Acme Outdoor studio';

/** The three rights buckets, in the page provider's order. */
export const RIGHTS_BUCKETS = ['Ended', 'Ending', 'Cleared'];

export const AGGREGATES = {
  acme_rights_agg: { type: 'date_range', field: 'dc:expired' },
  acme_shot_agg: { type: 'terms', field: 'acmeasset:shot' },
  acme_product_agg: { type: 'terms', field: 'acmeasset:product' },
  // The kit's Type facet, from 0.2.2: every synthetic record is a picture, AcmeAsset.
  acme_type_agg: { type: 'terms', field: 'ecm:primaryType' },
};

/** The fields a header may sort by: each a single value of the asset. */
const SORTABLE = new Set([
  'dc:expired',
  'dc:title',
  'acmeasset:product',
  'acmeasset:colorway',
  'acmeasset:shot',
]);

/** A fixed, well-spread hash of the asset's number, so the mix does not follow the numbering. */
function mix(n, salt) {
  let x = (n + 1) * 0x9e3779b1 + salt * 0x85ebca6b;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * The asset's rights end, in days from today, or `null` for none: 8% ended up to two years ago, 4%
 * ending within 30 days, 2% with no end, and the rest cleared for up to three years.
 */
function rightsEndInDays(n) {
  const roll = mix(n, 1) % 100;
  const spread = mix(n, 2);
  if (roll < 8) return -1 - (spread % 730);
  if (roll < 12) return spread % 31;
  if (roll < 14) return null;
  return 31 + (spread % 1095);
}

/** `00000123`-style: the asset's number as its name and its title's tail. */
const padded = (n) => String(n + 1).padStart(6, '0');

/** A UUID for the asset, from its number: version 4's shape, as Nuxeo's ids have. */
export function assetUid(n) {
  return `a55e7000-0000-4000-8000-${(n + 1).toString(16).padStart(12, '0')}`;
}

/** The asset's number from its UUID, or `null` for an id that is not one of the library's. */
export function assetNumber(uid, size = LIBRARY_SIZE) {
  const match = /^a55e7000-0000-4000-8000-([0-9a-f]{12})$/.exec(uid);
  if (!match) return null;
  const n = Number.parseInt(match[1], 16) - 1;
  return n >= 0 && n < size ? n : null;
}

const dayString = (epochDay) => new Date(epochDay * DAY_MS).toISOString();

/**
 * The library: its records' compact facts, kept as typed arrays so that 100,000 of them cost a few
 * megabytes, and the documents built from them only when a page asks.
 *
 * `window` is the search index's (`RESULT_WINDOW`). `counted` is how far the index counts: `null`,
 * as Nuxeo has it count, for the exact count; a number, for an index left to count only that far,
 * as OpenSearch's own default `track_total_hits` of 10,000 would, which then reports that many.
 * `windowShown` is whether the answer says what the window is, as Nuxeo's does: `false` answers
 * as a server that refuses past the window without saying where it is, `resultsCountLimit` -1 and
 * a next page while there are records. Both are for the check's negative controls only.
 *
 * @param {{ size?: number, today?: Date, window?: number, counted?: number | null,
 *   windowShown?: boolean }} [options] `today` decides the rights buckets; UTC.
 */
export function createLibrary({
  size = LIBRARY_SIZE,
  today = new Date(),
  window = RESULT_WINDOW,
  counted = null,
  windowShown = true,
} = {}) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`a library of ${size} assets`);
  if (!Number.isSafeInteger(window) || window < 1) throw new Error(`a window of ${window}`);
  if (counted !== null && (!Number.isSafeInteger(counted) || counted < 1)) {
    throw new Error(`a count up to ${counted}`);
  }
  const todayDay = Math.floor(today.getTime() / DAY_MS);
  const product = new Uint16Array(size);
  const colorway = new Uint8Array(size);
  const shot = new Uint8Array(size);
  /** Days from today; `NO_END` for none. */
  const NO_END = 0x7fffffff;
  const ends = new Int32Array(size);
  /** 0 Ended, 1 Ending, 2 Cleared, 3 in no bucket. */
  const rights = new Uint8Array(size);
  for (let n = 0; n < size; n++) {
    // A skewed product mix, so the Product facet's ten largest are a real choice.
    const p = mix(n, 3) % 1000;
    product[n] = p < 400 ? p % 40 : p % PRODUCT_COUNT;
    colorway[n] = mix(n, 4) % COLORWAYS.length;
    shot[n] = mix(n, 5) % SHOTS.length;
    const end = rightsEndInDays(n);
    ends[n] = end === null ? NO_END : end;
    rights[n] = end === null ? 3 : end < 0 ? 0 : end < 31 ? 1 : 2;
  }

  const styleOf = (n) => `AO-${3101 + product[n]}`;
  const titleOf = (n) =>
    `${PRODUCT_NAMES[product[n] % PRODUCT_NAMES.length]}, ${COLORWAYS[colorway[n]]}, ${SHOTS[shot[n]].toLowerCase()} ${padded(n)}`;

  /** The key each aggregate files the asset under, or `null` for none. */
  const bucketKey = {
    acme_rights_agg: (n) => (rights[n] === 3 ? null : RIGHTS_BUCKETS[rights[n]]),
    acme_shot_agg: (n) => SHOTS[shot[n]],
    acme_product_agg: (n) => styleOf(n),
    acme_type_agg: () => 'AcmeAsset',
  };

  const sortValue = {
    'dc:expired': (n) => ends[n],
    'dc:title': titleOf,
    'acmeasset:product': (n) => product[n],
    'acmeasset:colorway': (n) => COLORWAYS[colorway[n]],
    'acmeasset:shot': (n) => SHOTS[shot[n]],
  };

  /** Each order asked for, worked out once: the asset numbers, in it. */
  const orders = new Map();
  function order(field, direction) {
    const key = `${field} ${direction}`;
    let sorted = orders.get(key);
    if (!sorted) {
      const value = sortValue[field];
      const values = Array.from({ length: size }, (_, n) => value(n));
      const sign = direction === 'desc' ? -1 : 1;
      sorted = Uint32Array.from({ length: size }, (_, n) => n).sort((a, b) => {
        const va = values[a];
        const vb = values[b];
        // A record with no rights end goes last either way, as the index puts a missing value.
        if (field === 'dc:expired' && (va === NO_END || vb === NO_END)) {
          if (va === vb) return a - b;
          return va === NO_END ? 1 : -1;
        }
        if (va < vb) return -sign;
        if (va > vb) return sign;
        return a - b;
      });
      orders.set(key, sorted);
    }
    return sorted;
  }

  /** The asset as a page provider's row, with every schema, as `properties: *` asks. */
  function document(n, { full = false } = {}) {
    const uid = assetUid(n);
    const name = `ast-${padded(n)}`;
    const title = titleOf(n);
    const end = ends[n] === NO_END ? null : dayString(todayDay + ends[n]);
    const created = dayString(todayDay - 400 - (mix(n, 6) % 900));
    const modified = dayString(todayDay - (mix(n, 7) % 120));
    const channels =
      rights[n] === 1 && mix(n, 8) % 2 === 0
        ? ['E-commerce', 'Social']
        : ALL_CHANNELS.slice(0, 2 + (mix(n, 9) % 3));
    const wide = mix(n, 10) % 3 === 0;
    const [width, height] = wide ? [1800, 1200] : [1200, 1500];
    const view = (title, index, w, h) => ({
      title,
      description: `${title} size`,
      tag: title === 'Thumbnail' ? 'thumbnail' : title.toLowerCase(),
      filename: `${title}_${name}.png`,
      width: w,
      height: h,
      info: { width: w, height: h, format: 'PNG', depth: 8, colorSpace: 'sRGB' },
      content: {
        name: `${title}_${name}.png`,
        'mime-type': 'image/png',
        encoding: null,
        digestAlgorithm: 'MD5',
        digest: (mix(n, 20 + index) >>> 0).toString(16).padStart(8, '0').repeat(4),
        length: Math.round((w * h) / 9),
        data: `/nuxeo/nxfile/default/${uid}/picture:views/${index}/content/${title}_${name}.png?changeToken=1-0`,
        appLinks: [],
      },
    });
    const scaled = (max) => {
      const ratio = Math.min(1, max / Math.max(width, height));
      return [Math.round(width * ratio), Math.round(height * ratio)];
    };
    const properties = {
      'common:icon-expanded': null,
      'common:icon': '/icons/image.gif',
      'uid:uid': null,
      'uid:major_version': 0,
      'uid:minor_version': 1,
      'dc:description': `Synthetic asset ${padded(n)} of the performance check. Fictional.`,
      'dc:language': null,
      'dc:coverage': null,
      'dc:valid': null,
      'dc:creator': 'acme-studio',
      'dc:modified': modified,
      'dc:lastContributor': 'acme-studio',
      'dc:rights': 'Acme Outdoor. Shot by its own studio.',
      'dc:expired': end,
      'dc:format': null,
      'dc:created': created,
      'dc:title': title,
      'dc:issued': null,
      'dc:nature': null,
      'dc:subjects': [],
      'dc:contributors': ['acme-studio'],
      'dc:source': 'Acme Outdoor brand assets performance check (synthetic)',
      'dc:publisher': null,
      'nxtag:tags': [],
      'file:content': {
        name: `${name}.png`,
        'mime-type': 'image/png',
        encoding: null,
        digestAlgorithm: 'MD5',
        digest: (mix(n, 11) >>> 0).toString(16).padStart(8, '0').repeat(4),
        length: Math.round((width * height) / 4),
        data: `/nuxeo/nxfile/default/${uid}/file:content/${name}.png?changeToken=1-0`,
        appLinks: [],
      },
      'picture:views': [
        view('Thumbnail', 0, ...scaled(150)),
        view('Small', 1, ...scaled(280)),
        view('Medium', 2, ...scaled(1000)),
        view('FullHD', 3, ...scaled(1920)),
        view('OriginalJpeg', 4, width, height),
      ],
      'picture:info': {
        width,
        height,
        format: 'PNG',
        depth: 8,
        colorSpace: 'sRGB',
      },
      'picture:credit': STUDIO,
      'picture:source': null,
      'picture:caption': null,
      'picture:headline': null,
      'picture:origin': null,
      'picture:subheadline': null,
      'picture:genre': null,
      'picture:byline': null,
      'picture:language': null,
      'picture:dateline': null,
      'picture:slugline': null,
      'picture:typage': null,
      'picture:copyright': null,
      'imd:pixel_xdimension': width,
      'imd:pixel_ydimension': height,
      'imd:color_space': 'sRGB',
      'imd:orientation': null,
      'imd:date_time_original': null,
      'imd:image_description': null,
      'imd:equipment': null,
      'imd:exposure_time': null,
      'imd:fnumber': null,
      'imd:focal_length': null,
      'imd:iso_speed_ratings': null,
      'imd:white_balance': null,
      'imd:xresolution': 72,
      'imd:yresolution': 72,
      'imd:user_comment': null,
      'imd:flash': null,
      'imd:image_metadata_processed': true,
      'relatedtext:relatedtextresources': [],
      'acmeasset:product': styleOf(n),
      'acmeasset:colorway': COLORWAYS[colorway[n]],
      'acmeasset:shot': SHOTS[shot[n]],
      'acmeasset:campaign': SHOTS[shot[n]] === 'Campaign' ? CAMPAIGNS[mix(n, 12) % 4] : null,
      'acmeasset:credit': STUDIO,
      'acmeasset:channels': channels,
      'acmeasset:regions': REGIONS[mix(n, 13) % REGIONS.length],
    };
    const permissions = ['Read', 'ReadWrite', 'ReadVersion', 'ReadChildren', 'ReadProperties'];
    return {
      'entity-type': 'document',
      repository: 'default',
      uid,
      path: `${ASSETS_PATH}/${name}`,
      type: 'AcmeAsset',
      state: 'project',
      parentRef: ASSETS_FOLDER_UID,
      isCheckedOut: true,
      isRecord: false,
      retainUntil: null,
      hasLegalHold: false,
      isUnderRetentionOrLegalHold: false,
      isVersion: false,
      isProxy: false,
      changeToken: '1-0',
      isTrashed: false,
      title,
      lastModified: modified,
      properties,
      facets: ['Versionable', 'NXTag', 'Publishable', 'Picture', 'Commentable', 'HasRelatedText'],
      schemas: [
        { name: 'acmeasset', prefix: 'acmeasset' },
        { name: 'common', prefix: 'common' },
        { name: 'dublincore', prefix: 'dc' },
        { name: 'facetedTag', prefix: 'nxtag' },
        { name: 'file', prefix: 'file' },
        { name: 'image_metadata', prefix: 'imd' },
        { name: 'picture', prefix: 'picture' },
        { name: 'relatedtext', prefix: 'relatedtext' },
        { name: 'uid', prefix: 'uid' },
      ],
      contextParameters: full
        ? {
            permissions,
            userVisiblePermissions: ['Read', 'ReadWrite'],
            acls: [
              {
                name: 'inherited',
                aces: [
                  {
                    id: 'brand-team:ReadWrite:true:::',
                    username: { id: 'brand-team', 'entity-type': 'group' },
                    permission: 'ReadWrite',
                    granted: true,
                    status: 'effective',
                  },
                ],
              },
            ],
            renditions: [],
            favorites: { isFavorite: false },
            subscribedNotifications: [],
            collections: [],
            preview: { url: `/nuxeo/api/v1/id/${uid}/@preview/` },
            thumbnail: {
              url: `/nuxeo/api/v1/id/${uid}/@rendition/thumbnail`,
            },
            allowedTransitions: [],
          }
        : { permissions },
    };
  }

  /** The assets an aggregate's chosen keys keep, as a test per asset; none chosen keeps every one. */
  function chosenIn(choices) {
    return Object.entries(choices)
      .filter(([, keys]) => keys.length > 0)
      .map(([aggregate, keys]) => {
        const wanted = new Set(keys);
        const key = bucketKey[aggregate];
        return { aggregate, keeps: (n) => wanted.has(key(n)) };
      });
  }

  /**
   * One page of the page provider's results.
   *
   * @param {{ pageSize?: number, pageIndex?: number, sortBy?: string, sortOrder?: string,
   *   choices?: Record<string, string[]> }} request
   */
  function execute({
    pageSize = DEFAULT_PAGE_SIZE,
    pageIndex = 0,
    sortBy = '',
    sortOrder = '',
    choices = {},
  } = {}) {
    const size_ = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const index = Math.max(0, pageIndex);
    for (const aggregate of Object.keys(choices)) {
      if (!Object.hasOwn(AGGREGATES, aggregate)) throw new Error(`no aggregate "${aggregate}"`);
    }
    const [field = 'dc:expired'] = sortBy ? sortBy.split(',') : [];
    const [direction = 'asc'] = sortOrder ? sortOrder.split(',') : [];
    if (!SORTABLE.has(field)) throw new Error(`the library does not sort by "${field}"`);
    if (direction !== 'asc' && direction !== 'desc') throw new Error(`no order "${direction}"`);
    const skip = index * size_;
    if (skip + size_ > window) throw new PastWindowError(skip, size_, window);

    const tests = chosenIn(choices);
    const counts = Object.fromEntries(Object.keys(AGGREGATES).map((id) => [id, new Map()]));
    const count = (aggregate, n) => {
      const key = bucketKey[aggregate](n);
      if (key === null) return;
      const map = counts[aggregate];
      map.set(key, (map.get(key) ?? 0) + 1);
    };
    const kept = new Uint8Array(size);
    let total = 0;
    for (let n = 0; n < size; n++) {
      let failed = null;
      let failures = 0;
      for (const test of tests) {
        if (!test.keeps(n)) {
          failures += 1;
          failed = test.aggregate;
          if (failures > 1) break;
        }
      }
      if (failures === 0) {
        kept[n] = 1;
        total += 1;
        for (const aggregate of Object.keys(AGGREGATES)) count(aggregate, n);
      } else if (failures === 1) {
        // Counted for the one aggregate it fails: that aggregate's own choice is not applied.
        count(failed, n);
      }
    }

    const entries = [];
    const sorted = order(field, direction);
    let seen = 0;
    for (let at = 0; at < size && entries.length < size_; at++) {
      const n = sorted[at];
      if (!kept[n]) continue;
      if (seen++ < skip) continue;
      entries.push(document(n));
    }
    const reported = counted === null ? total : Math.min(total, counted);
    const pages = Math.ceil(reported / size_);
    const more = index + 1 < pages;
    return {
      'entity-type': 'documents',
      isPaginable: true,
      resultsCount: reported,
      pageSize: size_,
      maxPageSize: MAX_PAGE_SIZE,
      resultsCountLimit: windowShown ? window : -1,
      currentPageSize: entries.length,
      currentPageIndex: index,
      currentPageOffset: skip,
      numberOfPages: pages,
      isPreviousPageAvailable: index > 0,
      // As the index's page provider has them: no next page that would end past the window, and
      // a last page only while the whole count and a page fit in it.
      isNextPageAvailable: windowShown ? more && skip + 2 * size_ <= window : more,
      isLastPageAvailable: windowShown ? more && reported + size_ <= window : more,
      isSortable: true,
      hasError: false,
      errorMessage: null,
      totalSize: reported,
      pageIndex: index,
      pageCount: pages,
      entries,
      aggregations: Object.fromEntries(
        Object.entries(AGGREGATES).map(([id, { type, field: aggregated }]) => [
          id,
          aggregation(id, type, aggregated, counts[id], choices[id] ?? []),
        ]),
      ),
    };
  }

  function aggregation(id, type, field, counted, chosen) {
    const buckets =
      type === 'date_range'
        ? RIGHTS_BUCKETS.map((key, i) => ({
            key,
            fromAsDate: i === 0 ? null : dayString(todayDay + (i === 1 ? 0 : 31)),
            toAsDate: i === 2 ? null : dayString(todayDay + (i === 0 ? 0 : 31)),
            docCount: counted.get(key) ?? 0,
          }))
        : [...counted.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .slice(0, TERMS_SIZE)
            .map(([key, docCount]) => ({ key, fetchedKey: key, docCount }));
    const listed = new Set(buckets.map((bucket) => bucket.key));
    const extended = [
      ...chosen.filter((key) => !listed.has(key)).map((key) => ({ key, docCount: 0 })),
      ...buckets,
    ];
    return {
      'entity-type': 'aggregate',
      id,
      field,
      properties: type === 'terms' ? { size: String(TERMS_SIZE) } : {},
      ranges: [],
      dateRanges:
        type === 'date_range'
          ? [
              { key: 'Ended', toDate: 'now/d' },
              { key: 'Ending', fromDate: 'now/d', toDate: 'now+31d/d' },
              { key: 'Cleared', fromDate: 'now+31d/d' },
            ]
          : [],
      selection: chosen,
      type,
      buckets,
      extendedBuckets: extended,
    };
  }

  return {
    size,
    today: dayString(todayDay),
    window,
    execute,
    /** The asset with this id as the document page reads it, with its enrichers; `null` if none. */
    document(uid) {
      const n = assetNumber(uid, size);
      return n === null ? null : document(n, { full: true });
    },
    /**
     * The asset at `position` in the provider's own order, with `choices` applied: what a check
     * expects a page to start with. `null` past the last.
     */
    at(position, choices = {}) {
      const tests = chosenIn(choices);
      const sorted = order('dc:expired', 'asc');
      let seen = 0;
      for (let at = 0; at < size; at++) {
        const n = sorted[at];
        if (!tests.every((test) => test.keeps(n))) continue;
        if (seen++ === position) return { number: n, uid: assetUid(n), title: titleOf(n) };
      }
      return null;
    },
    /** How many assets `choices` keep. */
    count(choices = {}) {
      const tests = chosenIn(choices);
      let kept = 0;
      for (let n = 0; n < size; n++) if (tests.every((test) => test.keeps(n))) kept += 1;
      return kept;
    },
    title: titleOf,
    uid: assetUid,
  };
}
