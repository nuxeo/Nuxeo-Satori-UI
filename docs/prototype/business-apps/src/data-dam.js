// The second demo: a brand team's assets (DAM) for a fictional outdoor apparel brand. Same platform,
// another starter kit, and here the file is the business record (plan sections 13 and 14).
Object.assign(PLAN, {
  c13: { t: 'Beyond Payers (13)', when: 'next' },
  p14: { t: 'Every account (14)', when: 'next' },
});

Object.assign(PERSONAS, {
  priya: { n: 'Priya Shah', ini: 'PS', role: 'Brand asset manager', groups: ['brand-team'], kit: 'dam', app: 'brand' },
  leo: { n: 'Leo Martin', ini: 'LM', role: 'Creative director', groups: ['creative-review'], kit: 'dam', app: 'brand' },
  jo: { n: 'Jo Rivera', ini: 'JR', role: 'Licensor reviewer, Starfield Studios', groups: ['licensor-starfield'], kit: 'dam', app: 'licensing', external: true },
});
for (const [k, p] of Object.entries(PERSONAS)) {
  p.kit = p.kit || 'payers';
  p.app = p.app || { sam: 'appeals', riley: 'service' }[k] || 'claims';
}
APPS.forEach((a) => Object.assign(a, a.id === 'documents' ? { kit: 'any', org: '' } : { kit: 'payers', org: 'Acme Health' }));
APPS.splice(
  3,
  0,
  { id: 'brand', n: 'Brand assets', d: 'The brand team and creative review work assets and products', icon: 'image', groups: ['brand-team', 'creative-review'], kit: 'dam', org: 'Acme Outdoor' },
  { id: 'licensing', n: 'Licensing portal', d: 'Licensors approve licensed artwork and see nothing else', icon: 'shield_lock', groups: ['licensor-starfield'], kit: 'dam', org: 'Acme Outdoor', external: true },
);

// Products have no file: they are records, like a Member. `shots` are the views each colourway needs.
const PRODUCTS = {
  'PRD-3101': { n: 'Trailhead Rain Jacket', style: 'AO-3101', season: 'Spring 2027', colorways: ['Moss', 'Slate'], shots: ['Front', 'Back', 'On model', 'Detail'], channels: ['E-commerce', 'Wholesale'], launch: '2027-01-15' },
  'PRD-3102': { n: 'Ridge Runner Trail Shoe', style: 'AO-3102', season: 'Spring 2027', colorways: ['Ember'], shots: ['Side', 'Detail', 'Campaign'], channels: ['E-commerce', 'Social'], launch: '2027-02-01' },
  'PRD-3150': { n: 'Starfield Saga Graphic Tee', style: 'AO-3150', season: 'Spring 2027', colorways: ['Night'], shots: ['Artwork', 'Front'], channels: ['E-commerce', 'Wholesale'], launch: '2027-03-01', licensed: 'Starfield Studios' },
};

const ALL_CHANNELS = ['E-commerce', 'Wholesale', 'Social', 'Print'];
const FULL = { channels: ALL_CHANNELS, regions: 'Worldwide', until: null, release: null };
// `pic` and `tone` pick the drawing that stands in for the photo. `rights.until` ends the photographer's
// licence and `rights.release` the model release; the earlier of the two ends the asset's use.
const ASSETS = {
  'AST-501': { n: 'Trailhead Rain Jacket, Moss, front', kind: 'image', pic: 'jacket', tone: 'green', product: 'PRD-3101', colorway: 'Moss', shot: 'Front', state: 'approved', v: 2, size: '48 MB', px: '6000 × 7500', by: 'Northpeak Studio', tags: ['jacket', 'rain', 'moss green', 'studio'], rights: FULL, usage: [['E-commerce', 'Product page, Trailhead Rain Jacket in Moss', '2026-11-12']] },
  'AST-502': { n: 'Trailhead Rain Jacket, Moss, back', kind: 'image', pic: 'jacketBack', tone: 'green', product: 'PRD-3101', colorway: 'Moss', shot: 'Back', state: 'inReview', v: 2, round: 2, size: '46 MB', px: '6000 × 7500', by: 'Northpeak Studio', tags: ['jacket', 'rain', 'moss green'], rights: FULL, usage: [], pins: [[50, 22, 'leo', 'Hood shadow is too dark', 1]] },
  'AST-503': { n: 'Trailhead Rain Jacket, Moss, on model', kind: 'image', pic: 'model', tone: 'teal', product: 'PRD-3101', colorway: 'Moss', shot: 'On model', state: 'approved', v: 1, size: '52 MB', px: '6000 × 7500', by: 'Northpeak Studio', tags: ['jacket', 'on model', 'outdoor'], rights: { channels: ['E-commerce', 'Social'], regions: 'North America and Europe', until: '2027-06-30', release: '2026-12-15' }, usage: [['E-commerce', 'Product page, Trailhead Rain Jacket in Moss', '2026-11-12'], ['Social', 'Spring teaser post', '2026-11-18']] },
  'AST-504': { n: 'Trailhead Rain Jacket, Slate, front', kind: 'image', pic: 'jacket', tone: 'blue', product: 'PRD-3101', colorway: 'Slate', shot: 'Front', state: 'approved', v: 1, size: '47 MB', px: '6000 × 7500', by: 'Northpeak Studio', tags: ['jacket', 'rain', 'slate', 'studio'], rights: FULL, usage: [], embargo: '2027-01-15' },
  'AST-505': { n: 'Into the Hills, campaign hero', kind: 'image', pic: 'hills', tone: 'orange', product: 'PRD-3102', colorway: 'Ember', shot: 'Campaign', campaign: 'Into the Hills', state: 'approved', v: 3, size: '120 MB', px: '9000 × 6000', by: 'Northpeak Agency', tags: ['campaign', 'landscape', 'trail'], rights: { channels: ['E-commerce', 'Social', 'Print'], regions: 'Worldwide', until: '2027-12-31', release: null }, usage: [] },
  'AST-506': { n: 'Into the Hills, 30-second film', kind: 'video', len: 30, pic: 'hills', tone: 'orange', product: 'PRD-3102', campaign: 'Into the Hills', state: 'inReview', v: 3, round: 3, size: '2.4 GB', px: '3840 × 2160, 0:30', by: 'Northpeak Agency', tags: ['campaign', 'film'], rights: { channels: ['E-commerce', 'Social'], regions: 'Worldwide', until: '2027-12-31', release: null }, usage: [], notes: [['0:04', 'leo', 'The logo comes in too early', 3], ['0:21', 'leo', 'Hold the shoe close-up a second longer', 3]] },
  'AST-507': { n: 'Starfield Saga tee artwork', kind: 'image', pic: 'tee', tone: 'purple', product: 'PRD-3150', colorway: 'Night', shot: 'Artwork', state: 'licensorReview', v: 2, round: 2, size: '18 MB', px: '4500 × 5400', by: 'Acme Outdoor design', tags: ['licensed', 'graphic tee'], licensed: 'Starfield Studios', rights: { channels: ['E-commerce', 'Wholesale'], regions: 'North America', until: '2027-12-31', release: null }, usage: [], pins: [[50, 42, 'jo', 'Keep 10 mm of clear space around the logo', 1]] },
  'AST-508': { n: 'Ridge Runner Trail Shoe, Ember, detail', kind: 'image', pic: 'shoe', tone: 'red', product: 'PRD-3102', colorway: 'Ember', shot: 'Detail', state: 'draft', v: 1, size: '39 MB', px: '6000 × 7500', by: 'Northpeak Studio', tags: [], suggested: [['trail shoe', 97], ['outsole', 91], ['orange', 88], ['studio', 72]], rights: FULL, usage: [] },
};

const ASSET_STATE_LABEL = { draft: 'Draft', inReview: 'In review', licensorReview: 'With the licensor', changes: 'Changes requested', approved: 'Approved', archived: 'Archived' };
const ASSET_STATE_TONE = { draft: '', inReview: 'info', licensorReview: 'info', changes: 'warn', approved: 'ok', archived: '' };
// assetLifecycle: transitions a person can choose. Review steps move the asset through tasks instead.
const ASSET_TRANSITIONS = {
  draft: [['submit', 'Submit for review', 'inReview']],
  changes: [['resubmit', 'Submit a new round', 'inReview']],
  approved: [['archive', 'Archive', 'archived']],
  archived: [['restore', 'Restore', 'approved']],
  inReview: [],
  licensorReview: [],
};
// Renditions and the channel whose rights cover each one.
const RENDITIONS = {
  image: [['original', 'Original', 'TIFF, full size', 'Print'], ['print', 'Print', 'TIFF, 300 dpi, CMYK', 'Print'], ['web', 'Web', 'JPEG, 2000 px', 'E-commerce'], ['square', 'Social square', 'JPEG, 1080 × 1080', 'Social'], ['story', 'Social story', 'JPEG, 1080 × 1920', 'Social']],
  video: [['original', 'Original', 'ProRes, 4K', 'Print'], ['web', 'Web', 'MP4, 1080p', 'E-commerce'], ['social', 'Social cut', 'MP4, 1080 × 1920, 15 s', 'Social']],
};

const SHARES = {
  'S-7Q2K': { assets: ['AST-505'], to: 'Northpeak Agency', email: 'studio@northpeak.example', expires: '2026-11-28', watermark: true, renditions: ['web', 'square'], by: 'priya', made: '2026-11-19' },
};

Object.assign(TASKS, {
  'T-601': { n: 'Review the back shot', wf: 'Asset approval', node: 'Creative review', target: 'AST-502', who: 'leo', due: '2026-11-24' },
  'T-602': { n: 'Review the film cut', wf: 'Asset approval', node: 'Creative review', target: 'AST-506', who: 'leo', due: '2026-11-22' },
  'T-603': { n: 'Approve licensed artwork', wf: 'Licensed product approval', node: 'Licensor approval', target: 'AST-507', who: 'jo', due: '2026-11-26' },
  'T-604': { n: 'Renew the model release', wf: 'Rights renewal', node: 'Rights renewal', target: 'AST-503', who: 'priya', due: '2026-12-01' },
});
Object.assign(STEP_GROUPS, { 'Creative review': 'creative-review', 'Licensor approval': 'licensor-starfield', 'Rights renewal': 'brand-team' });
Object.assign(DECISIONS, { 'Creative review': ['approve', 'changes'], 'Licensor approval': ['approve', 'changes'], 'Rights renewal': ['renewed', 'withdraw'] });

const RIGHTS_SOON = 30;
// What the rights allow today. The earlier of the licence end and the model release end wins.
function rightsOf(a) {
  const end = [a.rights.until, a.rights.release].filter(Boolean).sort()[0] || null;
  const days = end ? daysTo(end) : null;
  if (days != null && days < 0) return { tone: 'bad', label: 'Rights ended', end, days, expired: true };
  if (a.embargo && daysTo(a.embargo) > 0) return { tone: 'warn', label: `Embargoed until ${d8(a.embargo)}`, end, days, embargo: true };
  if (days != null && days <= RIGHTS_SOON) return { tone: 'warn', label: `Rights end in ${days} days`, end, days, soon: true };
  return { tone: 'ok', label: 'Cleared', end, days };
}
// May this rendition go out this way ('download', 'share' or 'publish')? A refusal always says why.
function mayUse(a, channel, how) {
  const r = rightsOf(a);
  if (a.state === 'archived') return 'The asset is archived.';
  if (r.expired) return `The rights ended on ${d8(r.end)}.`;
  if (!a.rights.channels.includes(channel)) return `The licence covers ${a.rights.channels.join(', ')} only.`;
  if (how !== 'download' && a.state !== 'approved') return `Its state is “${ASSET_STATE_LABEL[a.state]}”, not “Approved”.`;
  if (how === 'publish' && r.embargo) return `Embargoed until ${d8(a.embargo)}.`;
  return '';
}
// The views a product still needs, by colourway: approved, on its way, or missing.
function shotStatus(pid) {
  const p = PRODUCTS[pid];
  return p.colorways.flatMap((c) => p.shots.map((s) => {
    const a = Object.entries(ASSETS).find(([, x]) => x.product === pid && (x.colorway === c || !x.colorway) && x.shot === s && x.state !== 'archived');
    return { colorway: c, shot: s, id: a ? a[0] : null, status: !a ? 'missing' : a[1].state === 'approved' ? 'ok' : 'pending' };
  }));
}
const missingShots = (pid) => shotStatus(pid).filter((x) => x.status === 'missing');

// `kit` keeps these out of the builder, which is connected to the Payers demo server.
QUEUES.push(
  { kit: 'dam', id: 'assets-review', n: 'Assets in review', pp: 'assets_in_review', groups: ['creative-review', 'brand-team'], of: 'asset', test: (a) => ['inReview', 'licensorReview'].includes(a.state) },
  { kit: 'dam', id: 'assets-rights', n: 'Rights ending in 30 days', pp: 'assets_rights_ending', groups: ['brand-team'], of: 'asset', test: (a) => a.state !== 'archived' && !!rightsOf(a).soon },
  { kit: 'dam', id: 'assets-new', n: 'New uploads to describe', pp: 'assets_drafts', groups: ['brand-team'], of: 'asset', test: (a) => a.state === 'draft' },
  { kit: 'dam', id: 'products-shots', n: 'Products missing shots', pp: 'products_missing_shots', groups: ['brand-team'], of: 'product', test: (p, who, id) => missingShots(id).length > 0 },
  { kit: 'dam', id: 'licensed', n: 'Submissions from Acme Outdoor', pp: 'licensed_submissions', groups: ['licensor-starfield'], of: 'asset', test: (a) => a.licensed === 'Starfield Studios' && a.state === 'licensorReview' },
);

NOTIFS.push(
  { to: 'priya', icon: 'shield_clock', t: 'The model release on AST-503 ends in 24 days, and the asset is live on the product page', h: '#/asset/AST-503', when: '1 h ago', unread: true },
  { to: 'priya', icon: 'comment', t: 'Leo Martin left 2 notes on the Into the Hills film', h: '#/asset/AST-506', when: 'Yesterday', unread: false },
  { to: 'leo', icon: 'user_task', t: '2 assets wait for your review', h: '#/home', when: '20 min ago', unread: true },
  { to: 'jo', icon: 'image', t: 'Acme Outdoor sent round 2 of the Starfield Saga tee artwork', h: '#/task/T-603', when: '3 h ago', unread: true },
);

Object.assign(KITS.find((k) => k.id === 'dam'), {
  n: 'Brand assets (DAM)', installed: true, v: '0.6.0, in this prototype', app: 'brand',
  types: ['Asset (picture, video)', 'Product', 'Campaign'],
  cfg: ['Asset page: preview, renditions, rights', 'Asset library with filters', 'Product page with required shots', '5 queues', 'Review with pins and rounds', 'Share links and a licensing portal'],
  data: '3 products, 8 assets, 1 share link',
  script: ['Rights ending on a live asset', 'A product missing a shot', 'Download and share within the rights', 'Creative review with pins', 'Licensor approval, as an outside user'],
});
KITS.find((k) => k.id === 'payers').app = 'claims';
