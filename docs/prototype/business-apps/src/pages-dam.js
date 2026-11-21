// The brand assets (DAM) demo: a file-first starter kit on the same platform (plan sections 13 and 14).
S.asel = new Set();
S.damf = {};
S.damq = '';
Object.assign(RECENT, {
  priya: ['AST-503', 'PRD-3101', 'AST-505', 'AST-508'],
  leo: ['AST-506', 'AST-502', 'PRD-3102'],
  jo: ['AST-507'],
});

// Simple drawings stand in for the photos: no image files, and the theme's own colours.
const ART = {
  jacket: '<path d="M38 42 L48 31 Q60 25 72 31 L82 42 L97 54 L92 98 L84 96 L84 128 L36 128 L36 96 L28 98 L23 54 Z" style="fill:var(--c)"/><path d="M48 31 Q60 14 72 31 Q60 27 48 31 Z" style="fill:var(--c);opacity:.8"/><path d="M60 33 V128" style="stroke:var(--cc);stroke-width:2"/><path d="M42 92 H52 M68 92 H78" style="stroke:var(--cc);stroke-width:2"/>',
  jacketBack: '<path d="M38 42 L48 31 Q60 25 72 31 L82 42 L97 54 L92 98 L84 96 L84 128 L36 128 L36 96 L28 98 L23 54 Z" style="fill:var(--c)"/><path d="M45 33 Q60 8 75 33 Q60 38 45 33 Z" style="fill:var(--c);opacity:.75"/><path d="M40 62 Q60 70 80 62" style="stroke:var(--cc);stroke-width:2;fill:none"/>',
  model: '<circle cx="60" cy="28" r="10" style="fill:var(--c);opacity:.45"/><path d="M42 50 L50 41 Q60 37 70 41 L78 50 L90 60 L86 96 L80 95 L80 112 L40 112 L40 95 L34 96 L30 60 Z" style="fill:var(--c)"/><path d="M46 112 H58 L57 142 H47 Z M62 112 H74 L73 142 H63 Z" style="fill:var(--c);opacity:.6"/>',
  tee: '<path d="M34 38 L50 29 Q60 36 70 29 L86 38 L99 60 L85 66 L85 128 L35 128 L35 66 L21 60 Z" style="fill:var(--c)"/><circle cx="60" cy="72" r="16" style="fill:var(--cc)"/><path d="M60 61 L63 69 L71 69 L65 74 L67 82 L60 77 L53 82 L55 74 L49 69 L57 69 Z" style="fill:var(--c)"/>',
  shoe: '<path d="M16 102 Q20 80 38 77 L56 72 Q69 69 76 82 L96 88 Q109 92 105 104 L20 106 Z" style="fill:var(--c)"/><rect x="14" y="104" width="94" height="9" rx="4" style="fill:var(--c);opacity:.6"/><path d="M50 78 L58 88 M58 76 L66 86 M66 76 L72 84" style="stroke:var(--cc);stroke-width:2"/>',
  hills: '<circle cx="88" cy="36" r="12" style="fill:var(--c);opacity:.5"/><path d="M0 104 Q30 74 60 96 T120 88 V150 H0 Z" style="fill:var(--c);opacity:.45"/><path d="M0 124 Q40 100 76 120 T120 116 V150 H0 Z" style="fill:var(--c)"/><path d="M52 150 Q60 132 72 124" style="stroke:var(--cc);stroke-width:2;fill:none"/>',
  film: '<circle cx="124" cy="24" r="10" style="fill:var(--c);opacity:.5"/><path d="M0 60 Q40 36 80 56 T160 50 V90 H0 Z" style="fill:var(--c);opacity:.45"/><path d="M0 74 Q50 56 100 72 T160 68 V90 H0 Z" style="fill:var(--c)"/>',
};
function damArt(a) {
  const video = a.kind === 'video';
  const floor = video ? '' : '<ellipse cx="60" cy="138" rx="42" ry="5" style="fill:var(--c);opacity:.18"/>';
  return `<svg class="art" viewBox="${video ? '0 0 160 90' : '0 0 120 150'}" aria-hidden="true" style="--c:var(--sat-sys-on-cat-${a.tone}-container);--cc:var(--sat-sys-cat-${a.tone}-container)"><rect width="160" height="150" style="fill:var(--cc)"/>${floor}<g style="opacity:.8">${ART[video ? 'film' : a.pic]}</g></svg>`;
}

const aLink = (id) => `<a href="#/asset/${id}">${esc(ASSETS[id] ? ASSETS[id].n : id)}</a>`;
const prLink = (id) => `<a href="#/product/${id}">${esc(PRODUCTS[id] ? PRODUCTS[id].n : id)}</a>`;
const assetState = (s) => `<span class="st ${ASSET_STATE_TONE[s] || ''}">${ASSET_STATE_LABEL[s] || s}</span>`;
const rightsBadge = (a) => { const r = rightsOf(a); return `<span class="st ${r.tone}">${esc(r.label)}</span>`; };
const rendName = (a, key) => (RENDITIONS[a.kind].find((x) => x[0] === key) || [key, key])[1];
const activeShares = (id) => Object.entries(SHARES).filter(([, s]) => s.assets.includes(id) && !s.revoked && daysTo(s.expires) >= 0);
// What each review said, round by round, kept on the asset so later rounds show it beside the pins.
const DECIDED = { approve: 'approved', changes: 'changes requested', renewed: 'renewed', withdraw: 'withdrawn' };
const reviewItems = (a) => (a.reviews || []).map(([round, by, step, decision, text]) => `<li>${ic('comment')}<div>“${esc(text)}”<div class="muted">${esc(pName(by))}, ${esc(step.toLowerCase())}, round ${round}: ${DECIDED[decision] || esc(decision)}</div></div><span></span></li>`).join('');
const pinList = (pins, from) => pins.map((p, i) => `<li>${ic('pushpin')}<div><strong>${i + 1}.</strong> ${esc(p[3] || 'No note yet')}<div class="muted">${esc(pName(p[2]))}, round ${p[4]}${from != null && i >= from ? ' · new' : ''}</div></div><span></span></li>`).join('');

function acard(id, pick) {
  const a = ASSETS[id];
  return `<div class="acard ${S.asel.has(id) ? 'sel' : ''}">${pick ? `<input type="checkbox" data-act="pick-asset" data-id="${id}" ${S.asel.has(id) ? 'checked' : ''} aria-label="Select ${esc(a.n)}">` : ''}
    <a class="th" href="#/asset/${id}" aria-label="${esc(a.n)}">${damArt(a)}${a.kind === 'video' ? `<span class="kind">${ic('videocam', 1)}0:30</span>` : ''}</a>
    <div class="meta"><strong>${esc(a.n)}</strong><span class="row" style="gap:4px">${assetState(a.state)}${rightsBadge(a)}</span></div></div>`;
}

// ---- the asset library: a grid over a page provider, with filters that work and a selection
P.assets = () => {
  const f = S.damf, q = S.damq.trim().toLowerCase();
  const list = Object.entries(ASSETS).filter(([, a]) => (!f.kind || a.kind === f.kind) && (!f.product || a.product === f.product) && (!f.state || a.state === f.state) && (!f.rights || rightsOf(a).tone === f.rights) && (!q || [a.n, ...a.tags, PRODUCTS[a.product].n, a.campaign || ''].join(' ').toLowerCase().includes(q)));
  for (const s of [...S.asel]) if (!list.some(([id]) => id === s)) S.asel.delete(s);
  const sel = (k, label, opts) => `<label class="f" style="margin:8px 0;width:190px"><span>${label}</span><select data-act="damf" data-k="${k}">${[['', 'Any'], ...opts].map(([v, l]) => `<option value="${v}" ${(f[k] || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const bulk = S.asel.size ? `<div class="banner"><strong>${S.asel.size} selected</strong><span class="gap"></span><button class="sm tonal" data-act="share" data-id="${[...S.asel].join(',')}">${ic('share', 1)}Share</button><button class="sm" data-act="toast" data-msg="Added to the collection “Spring 2027 launch”">${ic('bookmark', 1)}Add to a collection</button></div>` : '';
  return head('Assets', `${list.length} of ${Object.keys(ASSETS).length} assets · page provider <code>assets_search</code>, shown as a grid because these records are pictures`, ['p14', 's3', 'ootb']) +
    `<form class="row" data-act="damq" style="margin-bottom:4px"><label class="f" style="flex:1;margin:8px 0"><span>Search names, tags, products and campaigns</span><input type="text" value="${esc(S.damq)}"></label><button class="primary">${ic('search', 1)}Search</button><button type="button" data-act="toast" data-msg="Find similar needs the AI package, which is off today">${ic('ai', 1)}Find similar</button></form>
    <div class="row" style="margin-bottom:8px">${sel('kind', 'Type', [['image', 'Picture'], ['video', 'Video']])}${sel('product', 'Product', Object.entries(PRODUCTS).map(([id, p]) => [id, p.n]))}${sel('state', 'State', Object.entries(ASSET_STATE_LABEL))}${sel('rights', 'Rights', [['ok', 'Cleared'], ['warn', 'Ending or embargoed'], ['bad', 'Ended']])}</div>
    ${bulk}${list.length ? `<div class="agrid">${list.map(([id]) => acard(id, true)).join('')}</div>` : '<div class="card"><p class="muted">No assets match. Clear a filter.</p></div>'}` +
    note('<strong>Plan:</strong> the file is the record here, so the list is a grid of previews (section 13). The filters are the page provider’s aggregates, the state comes from the asset lifecycle and the rights badge from the licence and model-release dates. <em>Find similar</em> needs the AI package.');
};

// ---- an asset: a record page for a file, preview first
const toSec = (t) => t.split(':').reduce((s, x) => s * 60 + Number(x), 0);
const TIMECODE = /^\d{1,2}:[0-5]\d$/;
P.asset = (r) => {
  const id = r[1], a = ASSETS[id];
  if (!a) return P.notFound();
  const rt = rightsOf(a), ext = !!me().external, live = a.usage.length;
  const task = Object.entries(TASKS).find(([, t]) => t.target === id && !t.done);
  const trans = ext ? '' : (ASSET_TRANSITIONS[a.state] || []).map(([t, l, to]) => `<button class="${t === 'submit' || t === 'resubmit' ? 'primary' : ''}" data-act="atrans" data-id="${id}" data-t="${t}" data-to="${to}">${esc(l)}</button>`).join('');
  const acts = ext ? '' : `<button data-act="share" data-id="${id}">${ic('share', 1)}Share</button><button data-act="publish" data-id="${id}">${ic('publish', 1)}Publish</button>`;
  const renewing = Object.values(TASKS).some((t) => t.target === id && t.node === 'Rights renewal' && !t.done);
  const warn = rt.expired
    ? `<div class="banner err">${ic('shield_clock')}<span><strong>Rights ended on ${d8(rt.end)}.</strong> Downloads, shares and publishing are blocked${live ? `, and it is still live in ${live} place${live === 1 ? '' : 's'}` : ''}.</span></div>`
    : rt.soon
      ? `<div class="banner warn">${ic('shield_clock')}<span><strong>${rt.end === a.rights.release ? 'The model release' : 'The licence'} ends on ${d8(rt.end)}</strong>${live ? `, and this asset is live in ${live} place${live === 1 ? '' : 's'}` : ''}.${renewing ? ' A renewal task is open.' : ''}</span></div>`
      : rt.embargo ? `<div class="banner">${ic('lock')}<span><strong>Embargoed until ${d8(a.embargo)}</strong>, the product launch. It can be shared with a watermark, not published.</span></div>` : '';
  const pins = a.pins || [];
  const preview = `<div class="pv ${a.kind}">${damArt(a)}${pins.map((x, i) => `<span class="pin ${x[4] < (a.round || 1) ? 'done' : ''}" style="left:${x[0]}%;top:${x[1]}%" title="${esc(x[3])}">${i + 1}</span>`).join('')}${a.kind === 'video' ? `<span class="play">${ic('triangle_right')}</span>` : ''}</div>` +
    (a.kind === 'video' ? `<div class="scrub" aria-hidden="true"><i></i>${(a.notes || []).map((n) => `<b style="left:${(toSec(n[0]) / (a.len || 30)) * 100}%"></b>`).join('')}</div><ul class="tl">${(a.notes || []).map((n) => `<li>${ic('comment')}<div><strong>${n[0]}</strong> ${esc(n[2])}<div class="muted">${esc(pName(n[1]))}, round ${n[3]}</div></div><span></span></li>`).join('')}</ul>` : pins.length ? `<ul class="tl" style="margin-top:8px">${pinList(pins)}</ul>` : '') +
    ((a.reviews || []).length ? `<h3>Review comments</h3><ul class="tl">${reviewItems(a)}</ul>` : '');
  const rend = `<table><thead><tr><th>Rendition</th><th>Format</th><th>Covered by</th><th><span class="sr">Download</span></th></tr></thead><tbody>${RENDITIONS[a.kind].map(([k, n, fmt, ch]) => { const why = ext ? 'Not offered to outside reviewers' : mayUse(a, ch, 'download'); return `<tr><td>${esc(n)}</td><td>${esc(fmt)}</td><td>${esc(ch)}</td><td>${why ? `<span class="muted">${esc(why)}</span>` : `<button class="sm link" data-act="dl" data-id="${id}" data-r="${k}">${ic('download', 1)}Download</button>`}</td></tr>`; }).join('')}</tbody></table>`;
  const rights = `<dl class="side-kv"><dt>Channels</dt><dd>${a.rights.channels.map((c) => `<span class="badge">${esc(c)}</span>`).join(' ')}</dd><dt>Regions</dt><dd>${esc(a.rights.regions)}</dd><dt>Licence until</dt><dd>${a.rights.until ? d8(a.rights.until) : 'No end date'}</dd><dt>Model release until</dt><dd>${a.rights.release ? d8(a.rights.release) : 'Not needed'}</dd>${a.embargo ? `<dt>Embargo</dt><dd>Until ${d8(a.embargo)}</dd>` : ''}${a.licensed ? `<dt>Licensed from</dt><dd>${esc(a.licensed)}, whose approval it needs</dd>` : ''}</dl>`;
  const usage = live ? `<table><thead><tr><th>Channel</th><th>Where</th><th>Since</th></tr></thead><tbody>${a.usage.map(([c, w, d]) => `<tr><td>${esc(c)}</td><td>${esc(w)}</td><td>${d8(d)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not published anywhere yet.</p>';
  const tags = `<div class="row" style="gap:6px">${a.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('') || '<span class="muted">No tags yet. A draft needs one before review.</span>'}</div>${!ext && (a.suggested || []).length ? `<h3>Suggested by the AI package, which is off today</h3><div class="row" style="gap:6px">${a.suggested.map(([t, c]) => `<button class="sm tonal" data-act="tag-accept" data-id="${id}" data-t="${esc(t)}">${ic('plus_small', 1)}${esc(t)} · ${c}%</button>`).join('')}</div>` : ''}`;
  const shares = activeShares(id);
  const shareCard = ext ? '' : `<div class="card"><h2>${ic('share', 1)} Shared with</h2>${shares.length ? shares.map(([code, s]) => `<div class="field"><span style="flex:1">${esc(s.to)}<br><span class="muted">${s.renditions.map((k) => esc(rendName(a, k))).join(', ')}${s.watermark ? ' · watermarked' : ''} · until ${d8(s.expires)}</span></span><a href="#/share/${code}">Open</a><button class="sm link" data-act="revoke" data-id="${code}">Revoke</button></div>`).join('') : '<p class="muted">Not shared outside the company.</p>'}</div>`;
  const details = `<div class="card"><h2>${ic('info', 1)} Details</h2><dl class="side-kv"><dt>Product</dt><dd>${ext ? esc(PRODUCTS[a.product].n) : prLink(a.product)}</dd>${a.colorway ? `<dt>Colourway and view</dt><dd>${esc(a.colorway)}${a.shot ? `, ${esc(a.shot)}` : ''}</dd>` : ''}${a.campaign ? `<dt>Campaign</dt><dd>${esc(a.campaign)}</dd>` : ''}<dt>Version</dt><dd>${a.v}${a.round ? `, review round ${a.round}` : ''}</dd><dt>File</dt><dd>${esc(a.size)} · ${esc(a.px)}</dd><dt>From</dt><dd>${esc(a.by)}</dd></dl></div>`;
  const log = S.log.filter((x) => x.on === id);
  const activity = `<div class="card"><h2>Activity</h2><ul class="tl">${log.map((x) => `<li>${ic(x.icon)}<div>${esc(x.t)}</div><time>Just now</time></li>`).join('')}<li>${ic('upload')}<div>Version ${a.v} uploaded by ${esc(a.by)}</div><time>Nov 2026</time></li></ul></div>`;
  return ptags(['p14', 'c13', 's2', 's5']) +
    `<div class="rec"><div class="ricon">${ic(a.kind === 'video' ? 'videocam' : 'image')}</div><div><h1>${esc(a.n)}</h1><div class="crumbs">Asset · ${id} · ${esc(PRODUCTS[a.product].n)}</div></div>${assetState(a.state)}${rightsBadge(a)}<span class="gap"></span>${trans}${acts}</div>` +
    (task && task[1].who === S.persona ? `<div class="banner">${ic('user_task')}<span>You have a task on this asset: <strong>${esc(task[1].n)}</strong>, ${sla(task[1].due)}</span><span class="gap"></span><a href="#/task/${task[0]}"><button class="primary sm">Open the task</button></a></div>` : '') +
    warn +
    `<div class="split"><div><div class="card"><h2>Preview</h2>${preview}</div><div class="card"><h2>${ic('rendition', 1)} Renditions</h2>${rend}</div><div class="card"><h2>Rights and usage</h2>${rights}<h3>Live in</h3>${usage}</div><div class="card"><h2>${ic('tag', 1)} Tags</h2>${tags}</div>${activity}</div><div>${details}${shareCard}</div></div>` +
    note('<strong>Plan:</strong> a record page for a file (section 13). Gap 1 fixes only records with no file; an asset needs the preview first, then renditions, rights and where it is used. Every download, share and publish checks the rights and says why when it refuses, and the server checks again. <em>Publish</em> runs a server action with parameters (Step 5).');
};

// ---- a product: a record with no file, and the shots each colourway still needs
P.product = (r) => {
  const id = r[1], p = PRODUCTS[id];
  if (!p) return P.notFound();
  const st = shotStatus(id), ok = st.filter((x) => x.status === 'ok').length;
  const assets = Object.keys(ASSETS).filter((k) => ASSETS[k].product === id);
  const byColour = p.colorways.map((c) => `<h3>${esc(c)}</h3><ul class="cl">${st.filter((x) => x.colorway === c).map((x) => `<li>${ic(x.status === 'ok' ? 'circle_check' : x.status === 'pending' ? 'timer' : 'circle_dot')}<span style="flex:1">${esc(x.shot)}${x.id ? ` · ${aLink(x.id)} ${assetState(ASSETS[x.id].state)}` : ' <span class="badge">Missing</span>'}</span>${x.status === 'missing' ? `<button class="sm tonal" data-act="req-shot" data-id="${id}" data-c="${esc(c)}" data-s="${esc(x.shot)}">${ic('camera', 1)}Request the shot</button>` : ''}</li>`).join('')}</ul>`).join('');
  return ptags(['p14', 's1', 's2']) +
    `<div class="rec"><div class="ricon">${ic('box')}</div><div><h1>${esc(p.n)}</h1><div class="crumbs">Product · ${esc(p.style)} · ${esc(p.season)}${p.licensed ? ` · licensed from ${esc(p.licensed)}` : ''}</div></div><span class="gap"></span><button data-act="toast" data-msg="Opens the product in the product information system, which owns it">${ic('launch', 1)}Open in the product system</button></div>
    <div class="facts"><div><span>Launch</span><strong>${d8(p.launch)}</strong></div><div><span>Colourways</span><strong>${p.colorways.length}</strong></div><div><span>Shots approved</span><strong>${ok} of ${st.length}</strong></div><div><span>Channels</span><strong>${esc(p.channels.join(', '))}</strong></div></div>
    <div class="split"><div><div class="card"><h2>Required shots</h2>${byColour}</div><div class="card"><h2>Assets</h2><div class="agrid">${assets.map((k) => acard(k)).join('')}</div></div></div><div>${infoPanel({ state: `<span class="st ${ok === st.length ? 'ok' : 'warn'}">${ok === st.length ? 'Ready' : 'Shots missing'}</span>`, by: 'priya', tags: [p.season] })}</div></div>` +
    note('<strong>Plan:</strong> a product has no file, so it is a record like a Member (Step 1). Its required shots work like a case’s required documents: each colourway lists the views it needs and the asset that fills each one. The product system stays the system of record and this page links to it (section 13).');
};
P.products = () => head('Products', 'Records with no file. Each lists the shots it needs for every colourway.', ['p14', 's1']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Product</th><th>Style</th><th>Season</th><th>Colourways</th><th class="num">Shots approved</th><th>Launch</th></tr></thead><tbody>${Object.entries(PRODUCTS).map(([id, p]) => { const st = shotStatus(id); return `<tr><td>${prLink(id)}</td><td>${esc(p.style)}</td><td>${esc(p.season)}</td><td>${p.colorways.map(esc).join(', ')}</td><td class="num">${st.filter((x) => x.status === 'ok').length} of ${st.length}</td><td>${d8(p.launch)}</td></tr>`; }).join('')}</tbody></table></div>`;

// ---- share links: outside people, no account
// A link is made under the rights of its day. Each rendition is checked again, against today's rights and
// the asset's state, on the recipient's page and on every download: archiving or a lapsed licence stops it.
const shareWhyNot = (a, key) => { const rd = RENDITIONS[a.kind].find((x) => x[0] === key); return rd ? mayUse(a, rd[3], 'share') : 'That rendition is not offered.'; };
const shareStatus = (s) => (s.revoked ? ['', 'Revoked'] : daysTo(s.expires) < 0 ? ['', 'Ended'] : ['ok', 'Active']);
P.shares = () => head('Shared links', 'Links for people outside the company, such as an agency or a retailer. Each has its renditions, a watermark and an end date.', ['p14', 'c13']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Link</th><th>Shared with</th><th>Assets</th><th>Renditions</th><th>Ends</th><th>Status</th><th><span class="sr">Open</span></th></tr></thead><tbody>${Object.entries(SHARES).map(([code, s]) => { const [tone, label] = shareStatus(s); return `<tr><td><code>${code}</code></td><td>${esc(s.to)}<br><span class="muted">${esc(s.email)}</span></td><td>${s.assets.map(aLink).join('<br>')}</td><td>${s.renditions.map((k) => esc(rendName(ASSETS[s.assets[0]], k))).join(', ')}${s.watermark ? ' · watermarked' : ''}</td><td>${d8(s.expires)}</td><td><span class="st ${tone}">${label}</span></td><td><a href="#/share/${code}">Open as the recipient</a></td></tr>`; }).join('')}</tbody></table></div>`;
const wmark = () => `<div class="wm" aria-hidden="true">${'<span>ACME OUTDOOR · CONFIDENTIAL</span>'.repeat(14)}</div>`;
P.share = (r) => {
  const code = r[1], s = SHARES[code];
  if (!s) return P.notFound();
  const dead = s.revoked ? 'Acme Outdoor revoked this link.' : daysTo(s.expires) < 0 ? `This link ended on ${d8(s.expires)}.` : '';
  return head(`Shared with ${esc(s.to)}`, `From ${esc(pName(s.by))} at Acme Outdoor · ${dead ? 'no longer available' : `available until ${d8(s.expires)}`}`, ['p14', 'c13']) +
    (dead ? `<div class="banner err">${ic('lock')}${esc(dead)}</div>` : `<div class="agrid">${s.assets.map((id) => { const a = ASSETS[id]; const usable = s.renditions.filter((k) => !shareWhyNot(a, k)); if (!usable.length) return `<div class="acard"><div class="th gone">${ic('lock')}<span>No longer available</span></div><div class="meta"><strong>${esc(a.n)}</strong><span class="muted">${esc(shareWhyNot(a, s.renditions[0]))}</span></div></div>`; return `<div class="acard"><div class="th">${damArt(a)}${s.watermark ? wmark() : ''}</div><div class="meta"><strong>${esc(a.n)}</strong>${s.renditions.map((k) => { const why = shareWhyNot(a, k); return why ? `<span class="muted">${esc(rendName(a, k))}: not available. ${esc(why)}</span>` : `<button class="sm tonal" data-act="share-dl" data-id="${code}" data-a="${id}" data-r="${k}">${ic('download', 1)}${esc(rendName(a, k))}</button>`; }).join('')}</div></div>`; }).join('')}</div>`) +
    note('<strong>Plan:</strong> what someone outside the company sees from a share link, with no account: these assets, these renditions, a watermark, until the end date (section 13). Each download is recorded on the asset, and revoking the link stops it at once.');
};

// ---- review and rights tasks on an asset: the same task form, generated from the step's variables
const STEP_STATE = { 'Creative review': 'inReview', 'Licensor approval': 'licensorReview', 'Rights renewal': 'approved' };
P.assetTask = (r) => {
  const id = r[1], t = TASKS[id], a = ASSETS[t.target];
  // The draft is this task's and its owner's, as in P.task: reassigning the task starts it empty.
  const f = (S.tf[id] = S.tf[id] && S.tf[id].task === t && S.tf[id].owner === t.who ? S.tf[id] : { task: t, owner: t.who, decision: '', comment: '', date: '', pins: [], vnotes: [], errors: {} });
  const need = STEP_GROUPS[t.node], notMine = !!need && !inGroup([need]);
  const stale = !t.done && a.state !== STEP_STATE[t.node];
  const canDo = !t.done && !stale && !notMine && t.who === S.persona;
  // A draft is its owner's: anyone else reads the form empty and disabled (see P.task). A completed task
  // shows what was saved; its draft is kept only so that Undo can give it back.
  const v = canDo ? f : { decision: '', comment: '', date: '', pins: [], vnotes: [], errors: {} };
  const e = v.errors, er = (k) => (e[k] ? `<div class="err" id="e-${k}">${esc(e[k])}</div>` : '');
  const old = a.pins || [], review = t.node !== 'Rights renewal', addable = canDo && review && a.kind !== 'video';
  const draft = v.pins, timedDraft = v.vnotes || [];
  const pv = `<div class="pv ${a.kind} ${addable ? 'addable' : ''}" ${addable ? 'data-act="pin-add" title="Click the picture to add a pin"' : ''}>${damArt(a)}${[...old, ...draft].map((x, i) => `<span class="pin ${i < old.length && x[4] < (a.round || 1) ? 'done' : ''}" style="left:${x[0]}%;top:${x[1]}%">${i + 1}</span>`).join('')}${a.kind === 'video' ? `<span class="play">${ic('triangle_right')}</span>` : ''}</div>`;
  // Clicking the picture is for a mouse. The button and the two position fields do the same from a
  // keyboard or a screen reader: add a pin, then say where it goes, as a share of the width and height.
  const pos = (i, k, label, n) => `<label class="f" style="width:104px;margin:8px 0;flex:none"><span>${label}</span><input type="number" min="0" max="100" step="1" data-act="pin-pos" data-i="${i}" data-k="${k}" value="${n}" aria-label="Pin ${old.length + i + 1}, ${label.toLowerCase()}"></label>`;
  const newPins = draft.map((p, i) => `<div class="field" style="flex-wrap:wrap"><span class="pin static">${old.length + i + 1}</span><input type="text" data-act="pin-note" data-i="${i}" value="${esc(p[3])}" placeholder="What should change here?" aria-label="Note for pin ${old.length + i + 1}" style="flex:1;min-width:180px">${pos(i, 0, 'Across %', p[0])}${pos(i, 1, 'Down %', p[1])}<button class="icon" data-act="pin-del" data-i="${i}" aria-label="Remove pin ${old.length + i + 1}">${ic('x_small')}</button></div>`).join('');
  const len = a.len || 30, clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const timeline = a.kind === 'video' ? `<div class="scrub" aria-hidden="true"><i></i>${[...(a.notes || []).map((n) => n[0]), ...timedDraft.map((n) => n[0])].filter((x) => TIMECODE.test(x) && toSec(x) <= len).map((x) => `<b style="left:${(toSec(x) / len) * 100}%"></b>`).join('')}</div>` : '';
  const timed = canDo && review && a.kind === 'video' ? `<div class="row" style="margin:8px 0"><button class="sm tonal" data-act="vnote-add">${ic('comment', 1)}Add a timed note</button><span class="help" style="margin:0">Each note is pinned to a moment in the film, from 0:00 to ${clock(len)}.</span></div>${timedDraft.map((n, i) => `<div class="field" style="flex-wrap:wrap"><label class="f" style="width:112px;margin:8px 0;flex:none"><span>At (m:ss)</span><input type="text" inputmode="numeric" data-act="vnote-t" data-i="${i}" value="${esc(n[0])}" ${e.notes ? 'aria-invalid="true" aria-describedby="e-notes"' : ''} aria-label="Timed note ${i + 1}, moment in the film"></label><input type="text" data-act="vnote-x" data-i="${i}" value="${esc(n[1])}" placeholder="What should change at this moment?" aria-label="Timed note ${i + 1}" style="flex:1;min-width:200px"><button class="icon" data-act="vnote-del" data-i="${i}" aria-label="Remove timed note ${i + 1}">${ic('x_small')}</button></div>`).join('')}${er('notes')}` : '';
  let form;
  if (review) {
    form = `${timed}${addable ? `<div class="row" style="margin:8px 0"><button class="sm tonal" data-act="pin-add-key">${ic('pushpin', 1)}Add a pin</button><span class="help" style="margin:0">Or click the picture where the change is.</span></div>` : ''}${newPins}
      <div class="f"><span>Decision (required)</span>${radio('decision', [['approve', t.node === 'Licensor approval' ? 'Approve for Acme Outdoor' : 'Approve'], ['changes', 'Request changes']], v.decision)}</div>${er('decision')}
      ${t.node === 'Creative review' && a.licensed && v.decision === 'approve' ? `<p class="help">Approving sends it to ${esc(a.licensed)} for licensor approval.</p>` : ''}`;
  } else {
    form = `<p>The model release ends on <strong>${d8(a.rights.release)}</strong>. The asset is live in ${a.usage.length} place${a.usage.length === 1 ? '' : 's'}${a.usage.length ? `: ${a.usage.map((u) => esc(u[1])).join('; ')}` : ''}.</p>
      <div class="f"><span>Outcome (required)</span>${radio('decision', [['renewed', 'Renewed: enter the new end date'], ['withdraw', 'Not renewed: withdraw it everywhere and archive it']], v.decision)}</div>${er('decision')}
      ${v.decision === 'renewed' ? `<label class="f"><span>New model release end date (required)</span><input type="date" data-act="tfv" data-k="date" value="${esc(v.date)}" ${e.date ? 'aria-invalid="true" aria-describedby="e-date"' : ''}></label>${er('date')}` : ''}`;
  }
  const lock = notMine ? `<div class="banner warn">${ic('lock')}“${esc(t.node)}” is for ${need}. You can read it but not complete it.</div>` : t.who !== S.persona ? `<div class="banner warn">${ic('lock')}Assigned to ${esc(pName(t.who))}. You can read it but not complete it.</div>` : '';
  const glance = `<dl class="side-kv"><dt>Asset</dt><dd>${me().external ? esc(a.n) : aLink(t.target)}</dd><dt>Product</dt><dd>${esc(PRODUCTS[a.product].n)}</dd><dt>Version</dt><dd>${a.v}${a.round ? `, round ${a.round}` : ''}</dd><dt>Rights</dt><dd>${rightsBadge(a)}</dd>${a.licensed ? `<dt>Licence</dt><dd>${esc(a.rights.channels.join(', '))} · ${esc(a.rights.regions)} · until ${d8(a.rights.until)}</dd>` : ''}</dl>`;
  const earlier = (a.kind === 'video' ? (a.notes || []).map((n) => `<li>${ic('comment')}<div><strong>${n[0]}</strong> ${esc(n[2])}<div class="muted">${esc(pName(n[1]))}, round ${n[3]}</div></div><span></span></li>`).join('') : pinList(old)) + reviewItems(a);
  return head(esc(t.n), `${esc(t.wf)} · step “${esc(t.node)}” · on ${me().external ? esc(a.n) : aLink(t.target)} · ${sla(t.due)}`, ['p14', 's4', 'c13']) +
    (t.done ? (t.closedByState ? `<div class="banner">${ic('info')}Closed when ${t.target} was ${ASSET_STATE_LABEL[t.closedByState].toLowerCase()} from its own page.</div>` : `<div class="banner ok">${ic('circle_check')}Completed. The asset moved on.</div>`) : stale ? `<div class="banner warn">${ic('info')}${t.target} is ${ASSET_STATE_LABEL[a.state].toLowerCase()}, so this task no longer applies.</div>` : '') +
    `<div class="split"><div class="card"><h2>${review ? 'Review' : 'Rights renewal'}</h2>${lock}${review ? pv + timeline : ''}<fieldset class="tf" ${canDo ? '' : 'disabled'}>${form}
      <label class="f"><span>Comment${review ? ' (required to request changes without a pin)' : ''}</span><textarea data-act="tfv" data-k="comment" ${e.comment ? 'aria-invalid="true" aria-describedby="e-comment"' : ''}>${esc(v.comment)}</textarea></label>${er('comment')}</fieldset>
      ${Object.keys(e).length ? `<div class="banner err" role="alert">${ic('critical')}${Object.keys(e).length} field${Object.keys(e).length > 1 ? 's' : ''} to correct.</div>` : ''}
      <div class="row"><button class="primary" data-act="complete" data-id="${id}" ${canDo ? '' : 'disabled'}>Complete task</button></div></div>
    <div><div class="card"><h2>At a glance</h2>${glance}</div>${review ? `<div class="card"><h2>Earlier rounds</h2>${earlier ? `<ul class="tl">${earlier}</ul>` : '<p class="muted">This is the first round.</p>'}</div>` : ''}</div></div>` +
    note(t.node === 'Licensor approval'
      ? '<strong>Plan:</strong> an outside user (section 13). Starfield Studios signs in to a portal that shows only the licensed submissions sent to it, and its approval is a workflow step like any other. Each round keeps its pins, so the next round shows what was asked and what changed.'
      : '<strong>Plan:</strong> the same generated task form as the claims app (Step 4), with a review widget: pins on the picture, notes on the film’s timeline, and the earlier rounds beside it. Requesting changes needs a pin or a comment, the same kind of field rule as the denial reason.');
};

function completeAssetTask(id) {
  const t = TASKS[id], f = S.tf[id], a = ASSETS[t.target], e = {};
  const need = STEP_GROUPS[t.node];
  if ((need && !me().groups.includes(need)) || t.who !== S.persona) {
    f.errors = { decision: `Only ${pName(t.who)} can complete this step.` };
    render();
    return;
  }
  if (a.state !== STEP_STATE[t.node]) {
    f.errors = { decision: `${t.target} is ${ASSET_STATE_LABEL[a.state].toLowerCase()}, so this task no longer applies.` };
    render();
    return;
  }
  if (!(DECISIONS[t.node] || []).includes(f.decision)) e.decision = 'Choose a decision.';
  const notes = f.pins.filter((p) => p[3].trim());
  const timed = (f.vnotes || []).filter((n) => n[0].trim() || n[1].trim());
  const len = a.len || 30;
  if (timed.some((n) => !TIMECODE.test(n[0].trim()) || toSec(n[0].trim()) > len)) e.notes = `Give each timed note a moment from 0:00 to ${Math.floor(len / 60)}:${String(len % 60).padStart(2, '0')}, as m:ss.`;
  else if (timed.some((n) => !n[1].trim())) e.notes = 'Every timed note needs a note, or remove it.';
  if (f.decision === 'changes' && !f.comment.trim() && !notes.length && !timed.length) e.comment = a.kind === 'video' ? 'Say what should change: add a timed note, or write a comment.' : 'Say what should change: pin a note to the picture, or write a comment.';
  if (f.pins.length > notes.length) e.comment = 'Every pin needs a note, or remove it.';
  if (f.decision === 'renewed') {
    if (!f.date) e.date = 'Enter the new end date.';
    else if (daysTo(f.date) <= 0) e.date = 'The new end date must be after today.';
  }
  f.errors = e;
  if (Object.keys(e).length) {
    render();
    const first = $('#main [aria-invalid=true]') || $('#main input[name=decision]');
    first && first.focus();
    return;
  }
  // A deep copy: rights, pins and usage change too, and one Undo puts all of it back.
  const before = JSON.parse(JSON.stringify(a));
  const round = a.round || 1;
  t.done = true;
  let nid = null;
  let closed = [];
  let msg;
  // The comment is part of the asset's review history, so the next round shows it beside the pins.
  if (f.comment.trim()) a.reviews = [...(a.reviews || []), [round, S.persona, t.node, f.decision, f.comment.trim()]];
  // Pinned notes are feedback whatever the decision: an approval with notes keeps them too.
  if (notes.length) a.pins = [...(a.pins || []), ...notes.map((p) => [p[0], p[1], S.persona, p[3].trim(), round])];
  if (timed.length) a.notes = [...(a.notes || []), ...timed.map((n) => [n[0].trim(), S.persona, n[1].trim(), round])].sort((x, y) => toSec(x[0]) - toSec(y[0]));
  if (t.node === 'Rights renewal') {
    if (f.decision === 'renewed') {
      a.rights = { ...a.rights, release: f.date };
      msg = `Model release renewed until ${d8(f.date)}`;
    } else {
      a.state = 'archived';
      a.usage = [];
      // Archiving ends the asset's other open work too, in the same Undo.
      closed = Object.values(TASKS).filter((x) => x !== t && x.target === t.target && !x.done);
      closed.forEach((x) => { x.done = true; x.closedByState = 'archived'; });
      msg = `${t.target} withdrawn everywhere and archived`;
    }
  } else if (f.decision === 'changes') {
    a.state = 'changes';
    msg = t.node === 'Licensor approval' ? `Sent back to Acme Outdoor with ${Math.max(1, notes.length)} note${notes.length > 1 ? 's' : ''}` : `Changes requested on ${t.target}`;
  } else if (t.node === 'Creative review' && a.licensed) {
    a.state = 'licensorReview';
    nid = nextId(TASKS, 'T-');
    TASKS[nid] = { n: 'Approve licensed artwork', wf: 'Licensed product approval', node: 'Licensor approval', target: t.target, who: 'jo', due: '2026-11-28' };
    msg = `Approved, and sent to ${a.licensed} for licensor approval`;
  } else {
    a.state = 'approved';
    msg = t.node === 'Licensor approval' ? `Approved by ${a.licensed}` : `${t.target} approved`;
  }
  logOn(t.target, f.decision === 'changes' ? 'comment' : 'circle_check', `${t.n} completed by ${me().n}: ${f.decision === 'changes' ? 'changes requested' : f.decision}${f.comment.trim() ? `, “${f.comment.trim()}”` : ''}`);
  toast(msg, () => {
    restore(a, before);
    if (nid) dropTask(nid);
    t.done = false;
    closed.forEach((x) => { x.done = false; delete x.closedByState; });
    S.log.shift();
  });
  // An outside reviewer may still open an approved or returned licensed asset; see externalMay.
  location.hash = '#/asset/' + t.target;
}

// ---- actions, called from events.js
const today = () => TODAY.toISOString().slice(0, 10);
const DAM_ACTS = {
  atrans(el) {
    const id = el.dataset.id, a = ASSETS[id], t = el.dataset.t, before = JSON.parse(JSON.stringify(a));
    const go = (fn, msg, undoMore) => {
      fn();
      logOn(id, 'steps', `${msg} by ${me().n}`);
      toast(msg, () => { restore(a, before); S.log.shift(); if (undoMore) undoMore(); });
      render();
    };
    if (t === 'submit' || t === 'resubmit') {
      if (!a.tags.length) {
        toast('Add at least one tag first: search and the library filters depend on them');
        return;
      }
      const nid = nextId(TASKS, 'T-'), next = (a.round || 1) + 1;
      go(() => {
        a.state = 'inReview';
        if (t === 'resubmit') { a.v += 1; a.round = next; }
        TASKS[nid] = { n: 'Review the asset', wf: 'Asset approval', node: 'Creative review', target: id, who: 'leo', due: '2026-11-26' };
      }, t === 'submit' ? 'Submitted for review' : `Round ${next} submitted for review`, () => dropTask(nid));
    } else if (t === 'archive') {
      const live = a.usage.length;
      // Archiving ends the asset's open work too, as a claim's own lifecycle moves do, in the same Undo.
      const open = Object.values(TASKS).filter((x) => x.target === id && !x.done);
      const archive = () => go(() => {
        a.state = 'archived';
        a.usage = [];
        open.forEach((x) => { x.done = true; x.closedByState = 'archived'; });
      }, live ? `Archived and withdrawn from ${live} place${live === 1 ? '' : 's'}` : 'Archived', () => open.forEach((x) => { x.done = false; delete x.closedByState; }));
      // Say what archiving ends before it does: where the asset is live, and the work still open on it.
      const ends = [
        live ? `It is live in ${live} place${live === 1 ? '' : 's'}, and archiving withdraws it: ${a.usage.map((u) => esc(u[1])).join('; ')}.` : '',
        open.length ? `It closes the open task${open.length === 1 ? '' : 's'}: ${open.map((x) => esc(x.n)).join(', ')}.` : '',
      ].filter(Boolean);
      if (ends.length) ask(`Archive ${id}?`, ends.map((x) => `<p>${x}</p>`).join(''), 'Archive', archive, true);
      else archive();
    } else if (t === 'restore') go(() => { a.state = 'approved'; }, 'Restored');
  },
  dl(el) {
    const a = ASSETS[el.dataset.id], rd = RENDITIONS[a.kind].find((x) => x[0] === el.dataset.r);
    const why = mayUse(a, rd[3], 'download');
    if (why) { toast(why); return; }
    logOn(el.dataset.id, 'download', `${rd[1]} rendition downloaded by ${me().n}`);
    toast(`Downloading the ${rd[1].toLowerCase()} rendition (${rd[2]})`);
    render();
  },
  share(el) {
    const ids = el.dataset.id.split(',').filter((x) => ASSETS[x]), list = ids.map((x) => ASSETS[x]);
    const keys = RENDITIONS[list[0].kind].map((x) => x[0]).filter((k) => list.every((a) => { const rd = RENDITIONS[a.kind].find((x) => x[0] === k); return rd && !mayUse(a, rd[3], 'share'); }));
    if (!keys.length) {
      const a = list.find((x) => mayUse(x, x.rights.channels[0], 'share')) || list[0];
      toast(`Nothing to share: ${mayUse(a, a.rights.channels[0], 'share') || 'the rights cover no rendition for every asset selected.'}`);
      return;
    }
    const embargo = list.some((a) => rightsOf(a).embargo);
    ask(`Share ${ids.length === 1 ? esc(list[0].n) : `${ids.length} assets`}`, `<label class="f"><span>Shared with</span><input type="text" id="sh-to" value="Northpeak Agency"></label>
      <label class="f"><span>Email</span><input type="text" id="sh-em" value="studio@northpeak.example"></label>
      <div class="f"><span>Renditions they may download</span><div class="chk">${keys.map((k) => `<label><input type="checkbox" name="sh-r" value="${k}" ${k === 'web' ? 'checked' : ''}>${esc(rendName(list[0], k))}</label>`).join('')}</div></div>
      <label class="sw"><input type="checkbox" id="sh-wm" checked ${embargo ? 'disabled' : ''}><span>Watermark${embargo ? ', required while embargoed' : ''}</span></label>
      <label class="f"><span>The link ends</span><select id="sh-x"><option value="3">In 3 days</option><option value="7" selected>In 7 days</option><option value="30">In 30 days</option></select></label>
      <div class="err" id="sh-e"></div><p class="muted">Renditions the rights do not cover, for every asset selected, are not offered.</p>`, 'Send the link', (d) => {
      const to = d.querySelector('#sh-to').value.trim(), picked = [...d.querySelectorAll('input[name=sh-r]:checked')].map((x) => x.value);
      if (!to || !picked.length) { d.querySelector('#sh-e').textContent = to ? 'Choose at least one rendition.' : 'Say who it is for.'; return false; }
      const code = nextId(SHARES, 'S-');
      const end = new Date(TODAY.getTime() + Number(d.querySelector('#sh-x').value) * 864e5).toISOString().slice(0, 10);
      SHARES[code] = { assets: ids, to, email: d.querySelector('#sh-em').value.trim(), expires: end, watermark: embargo || d.querySelector('#sh-wm').checked, renditions: picked, by: S.persona, made: today() };
      ids.forEach((x) => logOn(x, 'share', `Shared with ${to} until ${d8(end)} by ${me().n}`));
      S.asel.clear();
      toast(`Link sent to ${to}, until ${d8(end)}`, () => { delete SHARES[code]; ids.forEach(() => S.log.shift()); });
    });
  },
  revoke(el) {
    const s = SHARES[el.dataset.id];
    s.revoked = true;
    toast(`Link for ${s.to} revoked`, () => { delete s.revoked; });
    render();
  },
  publish(el) {
    const id = el.dataset.id, a = ASSETS[id], p = PRODUCTS[a.product];
    const chans = [...new Set([...p.channels, 'Social'])];
    ask(`Publish ${esc(a.n)}`, `<label class="f"><span>Channel</span><select id="pb-c">${chans.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><dl class="side-kv"><dt>Runs</dt><dd><code>Asset.PublishToChannel</code> on the server</dd><dt>Parameters</dt><dd><code>channel</code>, <code>rendition = web</code>, <code>product = ${esc(p.style)}</code></dd></dl><div class="err" id="pb-e"></div><p class="muted">The rights are checked here before it runs, and again on the server.</p>`, 'Publish', (d) => {
      const ch = d.querySelector('#pb-c').value, why = mayUse(a, ch, 'publish');
      if (why) { d.querySelector('#pb-e').textContent = `It cannot go to ${ch}. ${why}`; return false; }
      if (a.usage.some((u) => u[0] === ch)) { d.querySelector('#pb-e').textContent = `It is already live in ${ch}.`; return false; }
      const where = ch === 'E-commerce' ? `Product page, ${p.n}${a.colorway ? ` in ${a.colorway}` : ''}` : ch === 'Wholesale' ? 'Wholesale portal' : 'Social post';
      const row = [ch, where, today()];
      a.usage.push(row);
      logOn(id, 'publish', `Published to ${ch} by ${me().n}`);
      toast(`Published to ${ch}`, () => { a.usage = a.usage.filter((u) => u !== row); S.log.shift(); });
    });
  },
  'share-dl'(el) {
    const s = SHARES[el.dataset.id], a = ASSETS[el.dataset.a];
    if (shareStatus(s)[1] !== 'Active') { toast('This link no longer works'); return; }
    const why = shareWhyNot(a, el.dataset.r);
    if (why) { toast(`Not available: ${why}`); render(); return; }
    logOn(el.dataset.a, 'download', `${rendName(a, el.dataset.r)} downloaded by ${s.to} through link ${el.dataset.id}`);
    toast(`Downloading ${rendName(a, el.dataset.r)}${s.watermark ? ', watermarked' : ''}`);
  },
  'tag-accept'(el) {
    const a = ASSETS[el.dataset.id], tag = el.dataset.t, before = JSON.parse(JSON.stringify(a));
    a.tags.push(tag);
    a.suggested = (a.suggested || []).filter((x) => x[0] !== tag);
    toast(`Tag “${tag}” added`, () => restore(a, before));
    render();
  },
  'req-shot'(el) {
    logOn(el.dataset.id, 'camera', `Shot requested from Northpeak Studio: ${el.dataset.c}, ${el.dataset.s}`);
    toast(`Shot requested from Northpeak Studio: ${el.dataset.c}, ${el.dataset.s}`);
  },
  'pin-add'(el, ev) {
    const tid = route()[1], f = S.tf[tid];
    if (!f || !mayDraft(tid)) return;
    const b = el.getBoundingClientRect();
    const at = (v, lo, size) => Math.min(97, Math.max(3, Math.round(((v - lo) / size) * 100)));
    f.pins.push([at(ev.clientX, b.left, b.width), at(ev.clientY, b.top, b.height), S.persona, '', ASSETS[TASKS[tid].target].round || 1]);
    render();
    const input = $(`#main input[data-act=pin-note][data-i="${f.pins.length - 1}"]`);
    input && input.focus();
  },
  // A guide link: become the person the page is for, then open it.
  'go-as'(el) {
    const changed = S.persona !== el.dataset.p;
    S.persona = el.dataset.p;
    S.sel.clear();
    S.asel.clear();
    const h = el.getAttribute('href');
    if (location.hash !== h) location.hash = h;
    else render();
    if (changed) toast(`Viewing as ${me().n}, ${me().role}`);
  },
  // The keyboard way to add a pin: it starts in the middle, and its position fields move it.
  'pin-add-key'() {
    const tid = route()[1], f = S.tf[tid];
    if (!f || !mayDraft(tid)) return;
    f.pins.push([50, 50, S.persona, '', ASSETS[TASKS[tid].target].round || 1]);
    render();
    const input = $(`#main input[data-act=pin-note][data-i="${f.pins.length - 1}"]`);
    input && input.focus();
  },
  'vnote-add'() {
    const f = S.tf[route()[1]];
    if (!f || !mayDraft(route()[1])) return;
    (f.vnotes = f.vnotes || []).push(['', '']);
    render();
    const input = $(`#main input[data-act=vnote-t][data-i="${f.vnotes.length - 1}"]`);
    input && input.focus();
  },
  'vnote-del'(el) {
    if (!mayDraft(route()[1])) return;
    S.tf[route()[1]].vnotes.splice(Number(el.dataset.i), 1);
    render();
  },
  'pin-del'(el) {
    if (!mayDraft(route()[1])) return;
    S.tf[route()[1]].pins.splice(Number(el.dataset.i), 1);
    render();
  },
};
const DAM_CHANGE = {
  damf(el) { S.damf[el.dataset.k] = el.value; render(); },
  'pick-asset'(el) { S.asel[el.checked ? 'add' : 'delete'](el.dataset.id); render(); },
  // A position typed into a field moves the pin when the field is left or Enter is pressed.
  'pin-pos'() { render(); },
  // A moment typed in moves its marker on the timeline when the field is left.
  'vnote-t'() { render(); },
};
const DAM_INPUT = {
  'pin-note'(el) { const f = S.tf[route()[1]]; if (f && mayDraft(route()[1]) && f.pins[el.dataset.i]) f.pins[el.dataset.i][3] = el.value; },
  'vnote-t'(el) { const f = S.tf[route()[1]]; if (f && mayDraft(route()[1]) && f.vnotes[el.dataset.i]) f.vnotes[el.dataset.i][0] = el.value; },
  'vnote-x'(el) { const f = S.tf[route()[1]]; if (f && mayDraft(route()[1]) && f.vnotes[el.dataset.i]) f.vnotes[el.dataset.i][1] = el.value; },
  'pin-pos'(el) {
    const f = S.tf[route()[1]], v = Number(el.value);
    if (f && mayDraft(route()[1]) && f.pins[el.dataset.i] && el.value !== '' && !Number.isNaN(v)) f.pins[el.dataset.i][Number(el.dataset.k)] = Math.min(97, Math.max(3, Math.round(v)));
  },
};

// ---- outside users see what was sent to them, and nothing else. The server enforces it; this is the screen.
function externalMay(r) {
  if (!me().external || modeOf(r) !== 'app') return true;
  if (['home', 'notifications'].includes(r[0])) return true;
  if (r[0] === 'task') return !!TASKS[r[1]] && TASKS[r[1]].who === S.persona;
  if (r[0] === 'queue') { const q = QUEUES.find((x) => x.id === r[1]); return !!q && inGroup(q.groups); }
  if (r[0] === 'asset') { const a = ASSETS[r[1]]; return !!a && a.licensed === 'Starfield Studios' && ['licensorReview', 'changes', 'approved'].includes(a.state); }
  return false;
}
P.externalOnly = () => head('Not shared with you', 'Starfield Studios is an outside organisation.') +
  `<div class="banner warn">${ic('lock')}<span>Outside users see only what was sent to them: here, the licensed submissions from Acme Outdoor. The server enforces this with permissions; hiding a page is not a control.</span></div><a href="#/home">Back to my work</a>`;

// ---- the home cards for the brand team, creative review and the licensor
function damKpis() {
  const g = me().groups, n = (qid) => queueItems(QUEUES.find((q) => q.id === qid)).length;
  const k = (label, value, foot, h, tone) => `<a class="kpi ${tone || ''}" href="${h}"><span>${label}</span><strong>${value}</strong><em>${foot}</em></a>`;
  if (g.includes('licensor-starfield')) return k('Waiting for your approval', myTasks().length, 'Licensed submissions', '#/queue/licensed', myTasks().length ? 'warn' : '') + k('Approved this season', 6, 'Starfield Saga products', '#/home') + k('Rounds per approval', '1.8', 'Average, this season', '#/home');
  if (g.includes('creative-review')) return k('Waiting for my review', myTasks().length, 'Creative review step', '#/home', 'warn') + k('In review', n('assets-review'), 'With you or the licensor', '#/queue/assets-review') + k('Approved this month', 42, 'Pictures and films', '#/assets') + k('Days to approve', '1.4', 'Average, last 30 days', '#/assets');
  return k('Rights ending in 30 days', n('assets-rights'), 'Licence or model release', '#/queue/assets-rights', 'warn') + k('In review', n('assets-review'), 'Creative or licensor', '#/queue/assets-review') + k('Products missing shots', n('products-shots'), 'Before launch', '#/queue/products-shots', 'warn') + k('New uploads to describe', n('assets-new'), 'Drafts waiting for tags', '#/queue/assets-new');
}
function damBrief() {
  const g = me().groups;
  if (g.includes('licensor-starfield')) return 'Acme Outdoor sent round 2 of the Starfield Saga tee artwork. Your round 1 note asked for 10 mm of clear space around the logo.';
  if (g.includes('creative-review')) return 'The film cut is due tomorrow, with two notes from round 3 still open. The back shot of the rain jacket is in round 2, and the round 1 note on the hood shadow is marked fixed.';
  return 'The on-model shot of the Trailhead Rain Jacket is live in two places, and its model release ends in 24 days. Three assets are in review, one of them with the licensor. The Slate colourway has only its front shot, embargoed until the January launch.';
}
