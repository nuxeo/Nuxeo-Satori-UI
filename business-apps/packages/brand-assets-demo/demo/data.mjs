/**
 * The brand assets kit's fictional records, for the fictional outdoor apparel brand Acme Outdoor:
 * what `seed.mjs` writes, and what the demo (`scripts/beta-harness/steps/brand-assets-demo.mjs`)
 * expects. No real brand, product, studio or person: the studio is the brand's own, and the
 * pictures are drawn by `png.mjs`, not photographed or downloaded.
 *
 * **Dates are relative to the day the seed runs,** so that the demo shows a rights-ending banner
 * and a rights-ended one whatever the day: an asset's rights end `rightsEndInDays` days after it,
 * and a shot is due `dueInDays` days after it. Run the seed again on the day of a demo.
 */

/** Where the seed writes, under /default-domain/workspaces: the kit's own workspace. */
export const WORKSPACE = {
  name: 'acme-brand-assets',
  title: 'Acme Outdoor brand assets (demo)',
  description: 'Fictional products and pictures for the brand assets kit. No real brand or person.',
};

/** The folders inside it, by document name. */
export const FOLDERS = { products: 'Products', assets: 'Assets', shots: 'Shot list' };

/**
 * The kit's reviewer group, which the server's directory holds and the kit's review policy names
 * (`bundle/OSGI-INF/brand-assets-demo-review.xml`): its members may send an asset's review back,
 * approve it or reject it, where they are granted the assets add-on's ReviewAsset permission.
 */
export const REVIEWERS = 'creative-review';

/**
 * The one permission the seed grants, since 0.2.5: ReviewAsset to the reviewer group on the assets
 * folder, which every asset there inherits. Without it no one, an administrator included, may decide
 * a review on the server.
 */
export const GRANTS = [{ folder: 'assets', group: REVIEWERS, permission: 'ReviewAsset' }];

/**
 * Every document the seed writes carries this as its `dc:source`, and the seed changes no
 * document at one of its places that does not: one without it is someone else's.
 */
export const MARKER = 'Acme Outdoor brand assets demo (fictional)';

export const PRODUCTS = [
  {
    style: 'AO-3101',
    title: 'Trailhead Rain Jacket',
    season: 'Spring 2027',
    colorways: ['Moss', 'Slate'],
    channels: ['E-commerce', 'Wholesale'],
    launch: '2027-01-15',
  },
  {
    style: 'AO-3102',
    title: 'Ridge Runner Trail Shoe',
    season: 'Spring 2027',
    colorways: ['Ember'],
    channels: ['E-commerce', 'Social'],
    launch: '2027-02-01',
  },
];

const ALL_CHANNELS = ['E-commerce', 'Wholesale', 'Social', 'Print'];
const STUDIO = 'Acme Outdoor studio';

/**
 * The pictures. `picture` is what `png.mjs` draws for each: a shape and two colours, as RGB.
 * Asset 503's rights end within 30 days and asset 505's have ended, so the asset page shows each
 * banner on one of them; the others are cleared.
 */
export const ASSETS = [
  {
    id: 'ast-501',
    title: 'Trailhead Rain Jacket, Moss, front',
    product: 'AO-3101',
    colorway: 'Moss',
    shot: 'Front',
    rightsEndInDays: 400,
    channels: ALL_CHANNELS,
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor. Shot by its own studio.',
    picture: {
      shape: 'jacket',
      size: [1200, 1500],
      background: [214, 226, 205],
      ink: [74, 102, 62],
    },
  },
  {
    id: 'ast-502',
    title: 'Trailhead Rain Jacket, Moss, back',
    product: 'AO-3101',
    colorway: 'Moss',
    shot: 'Back',
    rightsEndInDays: 180,
    channels: ALL_CHANNELS,
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor. Shot by its own studio.',
    picture: {
      shape: 'jacket-back',
      size: [1200, 1500],
      background: [206, 222, 210],
      ink: [66, 96, 70],
    },
  },
  {
    id: 'ast-503',
    title: 'Trailhead Rain Jacket, Moss, on model',
    product: 'AO-3101',
    colorway: 'Moss',
    shot: 'On model',
    rightsEndInDays: 20,
    channels: ['E-commerce', 'Social'],
    regions: 'North America and Europe',
    credit: STUDIO,
    rights: "Acme Outdoor, under the model's release, which ends on the rights end date.",
    picture: {
      shape: 'model',
      size: [1200, 1500],
      background: [200, 226, 224],
      ink: [52, 104, 98],
    },
  },
  {
    id: 'ast-504',
    title: 'Trailhead Rain Jacket, Slate, front',
    product: 'AO-3101',
    colorway: 'Slate',
    shot: 'Front',
    rightsEndInDays: 365,
    channels: ALL_CHANNELS,
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor. Shot by its own studio.',
    picture: {
      shape: 'jacket',
      size: [1200, 1500],
      background: [208, 216, 228],
      ink: [70, 84, 110],
    },
  },
  {
    id: 'ast-505',
    title: 'Into the Hills, campaign hero',
    product: 'AO-3102',
    colorway: 'Ember',
    shot: 'Campaign',
    campaign: 'Into the Hills',
    rightsEndInDays: -10,
    channels: ['E-commerce', 'Social', 'Print'],
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor, for the Into the Hills campaign only.',
    picture: {
      shape: 'hills',
      size: [1800, 1200],
      background: [246, 222, 196],
      ink: [176, 92, 40],
    },
  },
  {
    id: 'ast-506',
    title: 'Ridge Runner Trail Shoe, Ember, detail',
    product: 'AO-3102',
    colorway: 'Ember',
    shot: 'Detail',
    rightsEndInDays: 250,
    channels: ALL_CHANNELS,
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor. Shot by its own studio.',
    picture: { shape: 'shoe', size: [1500, 1200], background: [244, 214, 204], ink: [168, 62, 44] },
  },
];

/**
 * The videos, each an `AcmeVideo`: two short films generated from a test pattern by ffmpeg, a few
 * kilobytes of WebM each, not filmed or downloaded; `video.file` is its file under `demo/videos/`,
 * and the README, "The videos", has the command that made it. Asset 511 holds no Print channel, so
 * its original, the master, is refused and its web cut, the server's transcoded videos, served; it
 * runs 12 seconds, long enough for Nuxeo's storyboard, which it makes from 10. Asset 512 is cleared
 * everywhere, and too short for a storyboard.
 */
export const VIDEOS = [
  {
    id: 'ast-511',
    title: 'Into the Hills, campaign film',
    product: 'AO-3102',
    colorway: 'Ember',
    shot: 'Film',
    campaign: 'Into the Hills',
    rightsEndInDays: 300,
    channels: ['E-commerce', 'Social'],
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor, for the Into the Hills campaign only.',
    video: { file: 'ast-511.webm', mimeType: 'video/webm', seconds: 12, size: [160, 90] },
  },
  {
    id: 'ast-512',
    title: 'Trailhead Rain Jacket, Moss, turntable',
    product: 'AO-3101',
    colorway: 'Moss',
    shot: 'Turntable',
    rightsEndInDays: 200,
    channels: ALL_CHANNELS,
    regions: 'Worldwide',
    credit: STUDIO,
    rights: 'Acme Outdoor. Shot by its own studio.',
    video: { file: 'ast-512.webm', mimeType: 'video/webm', seconds: 4, size: [90, 120] },
  },
];

/**
 * Each product's shot list: the shots it needs, by colourway. `asset` is the asset that fills one;
 * `null`, it is missing, as the product page's "Missing shots" card lists it.
 */
export const SHOTS = [
  { product: 'AO-3101', colorway: 'Moss', shot: 'Front', asset: 'ast-501', dueInDays: 7 },
  { product: 'AO-3101', colorway: 'Moss', shot: 'Back', asset: 'ast-502', dueInDays: 7 },
  { product: 'AO-3101', colorway: 'Moss', shot: 'On model', asset: 'ast-503', dueInDays: 14 },
  { product: 'AO-3101', colorway: 'Slate', shot: 'Front', asset: 'ast-504', dueInDays: 14 },
  { product: 'AO-3101', colorway: 'Slate', shot: 'Back', asset: null, dueInDays: 21 },
  { product: 'AO-3102', colorway: 'Ember', shot: 'Side', asset: null, dueInDays: 28 },
  { product: 'AO-3102', colorway: 'Ember', shot: 'Detail', asset: 'ast-506', dueInDays: 28 },
  { product: 'AO-3102', colorway: 'Ember', shot: 'Campaign', asset: 'ast-505', dueInDays: 35 },
];

/** A shot's document name: its product, colourway and shot, lower case, with hyphens. */
export function shotName({ product, colorway, shot }) {
  return [product, colorway, shot]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A shot's title, as its page names it. */
export function shotTitle({ product, colorway, shot }) {
  const name = PRODUCTS.find((each) => each.style === product)?.title ?? product;
  return `${name}, ${colorway}, ${shot.toLowerCase()}`;
}

/**
 * The day `days` days after `today`'s, in this machine's zone, as Nuxeo stores a day: `YYYY-MM-DD`.
 * The browser that shows it reads a stored day as written (AGENTS/08-bug-patterns.md, pattern 29).
 */
export function dayAfter(today, days) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
