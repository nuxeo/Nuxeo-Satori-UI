// Helpers, widgets, the shell and the router.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (n, s) => `<svg class="i${s ? ' s' : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const S = { persona: 'dana', read: new Set(), agentStep: 0, sel: new Set(), layoutType: 'Member', layoutField: 'member:dob', log: [] };
const P = {}; // page renderers, keyed by the first route segment (or "build/x", "start/x")

const me = () => PERSONAS[S.persona];
const inGroup = (groups) => !groups || !groups.length || groups.some((g) => me().groups.includes(g));
const appOf = (p) => APPS.find((a) => a.id === PERSONAS[p].app) || APPS[0];

// ---- formatting widgets (Step 2: named widgets and registered computations)
// Plain text, for messages and attributes; `money` wraps it for table cells. Built up, never stripped down:
// removing tags from HTML with a pattern is how markup slips through (CodeQL js/incomplete-multi-character-sanitization).
const moneyText = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => (n == null ? '<span class="muted">—</span>' : moneyText(n));
const d8 = (s) => (s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const ageOf = (dob) => {
  const b = new Date(dob + 'T12:00:00Z');
  let a = TODAY.getUTCFullYear() - b.getUTCFullYear();
  const m = TODAY.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && TODAY.getUTCDate() < b.getUTCDate())) a--;
  return a;
};
const daysTo = (s) => Math.round((new Date(s + 'T12:00:00Z') - TODAY) / 864e5);
function sla(due) {
  if (!due) return '<span class="muted">—</span>';
  const n = daysTo(due);
  if (n < 0) return `<span class="sla over">${ic('alarm', 1)}${-n} day${n === -1 ? '' : 's'} overdue</span>`;
  if (n <= 2) return `<span class="sla warn">${ic('timer', 1)}${n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`}</span>`;
  return `<span class="sla ok">${ic('clock', 1)}Due ${d8(due)}</span>`;
}
const claimState = (s) => `<span class="st ${CLAIM_STATE_TONE[s] || ''}">${CLAIM_STATE_LABEL[s] || s}</span>`;
const caseState = (s) => `<span class="st ${{ open: 'info', inReview: 'info', decided: 'ok', closed: '' }[s] || ''}">${{ open: 'Open', inReview: 'In review', decided: 'Decided', closed: 'Closed' }[s] || s}</span>`;
const mName = (id) => (MEMBERS[id] ? `${MEMBERS[id].first} ${MEMBERS[id].last}` : id);
const mLink = (id) => `<a href="#/member/${id}">${esc(mName(id))}</a>`;
const cLink = (id) => `<a href="#/claim/${id}">${id}</a>`;
const kLink = (id) => `<a href="#/case/${id}">${id}</a>`;
const pLink = (id) => `<a href="#/provider/${id}" class="badge c" style="text-decoration:none">${esc(PROVIDERS[id].n)}</a>`;
const tLink = (id) => (id.startsWith('CASE') ? kLink(id) : id.startsWith('AST') ? aLink(id) : id.startsWith('PRD') ? prLink(id) : cLink(id));
const pName = (p) => (PERSONAS[p] ? PERSONAS[p].n : p || '');
function who(p) {
  if (!p) return '<span class="muted">Unassigned</span>';
  const x = PERSONAS[p];
  return x ? `<span class="row" style="gap:6px;flex-wrap:nowrap"><span class="avatar sm">${x.ini}</span>${esc(x.n)}</span>` : esc(p);
}
// A field the layout masks for some groups (section 5, compliance). Hidden on screen, not a security control.
function masked(v) {
  if (!me().phiMasked) return esc(v);
  return `<span class="mask" aria-label="Hidden for your role">••••${esc(String(v).slice(-3))}</span> <span class="badge" title="The layout masks this field for member-services. The server still returns it to people who may read it.">${ic('view_off', 1)}Masked for your role</span>`;
}
const ptags = (keys) => `<div class="ptags" aria-label="Plan items this page shows">${keys.map((k) => `<a class="ptag ${PLAN[k].when === 'now' ? 'now' : PLAN[k].when === 'later' ? 'later' : ''}" href="#/start/plan">${esc(PLAN[k].t)}</a>`).join('')}</div>`;
const note = (html) => `<div class="note">${ic('lightbulb', 1)}<div>${html}</div></div>`;
const head = (title, sub, tags) => (tags ? ptags(tags) : '') + `<h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}`;

function toast(msg, undo) {
  // Only the latest change can be undone. Every change shows a toast, and an earlier Undo restores a
  // snapshot taken before this change, so pressing it would overwrite this change and leave its side
  // effects (a closed task, a new document) behind. A new toast retires every earlier Undo.
  for (const earlier of $$('#toast button')) earlier.remove();
  const d = document.createElement('div');
  d.innerHTML = `<span>${esc(msg)}</span>`;
  if (undo) {
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.onclick = () => { undo(); d.remove(); render(); };
    d.appendChild(b);
  }
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 7000);
}
let opener = null;
function modal(html) {
  opener = document.activeElement;
  $('#modal').innerHTML = `<div class="dia" data-act="dia-bg"><div role="dialog" aria-modal="true" aria-labelledby="dt">${html}</div></div>`;
  const f = $('#modal').querySelector('input,select,textarea,button');
  f && f.focus();
}
function closeModal() {
  $('#modal').innerHTML = '';
  opener && opener.focus && opener.focus();
}

// ---- shell
const route = () => (location.hash.replace(/^#\/?/, '') || 'start').split('?')[0].split('/');
const modeOf = (r) => (r[0] === 'start' ? 'start' : r[0] === 'build' ? 'build' : r[0] === 'share' ? 'share' : 'app');
const myQueues = () => QUEUES.filter((q) => inGroup(q.groups));
function queueItems(q) {
  const src = { claim: CLAIMS, case: CASES, asset: ASSETS, product: PRODUCTS }[q.of];
  return Object.entries(src).filter(([id, x]) => q.test(x, S.persona, id)).map(([id, x]) => ({ id, ...x }));
}
const myTasks = () => Object.entries(TASKS).filter(([, t]) => t.who === S.persona && !t.done).map(([id, t]) => ({ id, ...t }));
const unread = () => NOTIFS.filter((n, i) => n.to === S.persona && n.unread && !S.read.has(i)).length;

function shell(r) {
  const mode = modeOf(r);
  // The rail marks the current mode, not the page, so it says "true"; the menu below names the page.
  const link = (h, icon, label, cur) => `<a href="${h}" ${cur ? 'aria-current="true"' : ''}>${ic(icon)}<span>${label}</span></a>`;
  $('#pnav').innerHTML = `<div class="app-ic">${ic('nuxeo')}</div>` + link('#/start', 'help', 'Guide', mode === 'start') + link('#/home', 'apps', 'App', mode === 'app') + link('#/build/agent', 'build', 'Build', mode === 'build') + `<span class="sp"></span><span class="avatar" title="${esc(mode === 'build' ? BUILDER.n : me().n)}">${mode === 'build' ? BUILDER.ini : me().ini}</span>`;
  // One group per demo: each is a different fictional customer on its own server, built from its own kit.
  const demos = [['payers', 'Payers demo · Acme Health'], ['dam', 'Brand assets demo · Acme Outdoor']];
  const personaSel = `<label class="f" style="margin:0;width:250px"><span>Viewing as</span><select data-act="persona" aria-label="Viewing as">${demos.map(([kit, label]) => `<optgroup label="${label}">${Object.entries(PERSONAS).filter(([, p]) => p.kit === kit).map(([k, p]) => `<option value="${k}" ${k === S.persona ? 'selected' : ''}>${esc(p.n)}, ${esc(p.role)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  if (mode === 'app') {
    const a = appOf(S.persona), n = unread(), ext = !!me().external, dam = a.kit === 'dam';
    const find = dam ? 'Search assets and products' : 'Search members, claims and cases';
    $('#hdr').innerHTML = `<span class="ttl">${esc(a.org)} · ${esc(a.n)}</span>${ext ? `<span class="badge">${ic('lock', 1)}Outside user · Starfield Studios</span>` : `<a class="badge c" href="#/apps" style="text-decoration:none">${ic('apps', 1)}Switch app</a>`}<span class="gap"></span>
      ${ext ? '' : `<form class="gs" data-act="gsearch" role="search"><label class="sr" for="gq">${find}</label><input type="text" id="gq" placeholder="${dam ? find : 'Search members, claims, cases'}"></form>`}
      <a href="#/notifications" class="row" aria-label="Notifications, ${n} unread" style="position:relative;width:40px;height:40px;justify-content:center;color:var(--mat-sys-on-surface-variant)">${ic('bell')}${n ? `<span class="bellc">${n}</span>` : ''}</a>${personaSel}`;
  } else if (mode === 'share') {
    $('#hdr').innerHTML = `<span class="ttl">Acme Outdoor · Shared files</span><span class="badge">${ic('globe', 1)}Opened from a link, with no account</span><span class="gap"></span>${personaSel}`;
  } else if (mode === 'build') {
    $('#hdr').innerHTML = `<span class="ttl">Builder</span><span class="badge c">${ic('cloud_check', 1)}Connected: payers-demo.example (Nuxeo LTS 2025, dev mode on)</span><span class="gap"></span><span class="muted">Signed in as ${BUILDER.n}, ${BUILDER.role}</span>`;
  } else {
    $('#hdr').innerHTML = `<span class="ttl">Prototype guide</span><span class="muted">From a file browser to business applications</span><span class="gap"></span>${personaSel}`;
  }
  const cur = r.join('/');
  // One current page. A list also owns its filtered views (claims/denied), but "Start here" is a page
  // of its own, not the parent of the guide pages beside it.
  const a = (h, icon, label, extra) => `<a href="#/${h}" ${cur === h || (h !== 'home' && h !== 'start' && cur.startsWith(h + '/')) ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${extra || ''}</a>`;
  let nav = '';
  const queueLinks = () => myQueues().map((q) => a('queue/' + q.id, 'list_bullet', esc(q.n), `<span class="cnt">${queueItems(q).length}</span>`)).join('');
  if (mode === 'app' && appOf(S.persona).kit === 'dam') {
    const ext = !!me().external;
    nav = a('home', 'home', 'My work', myTasks().length ? `<span class="cnt">${myTasks().length}</span>` : '') + '<h3>Queues</h3>' + queueLinks() +
      (ext ? '' : '<h3>Records</h3>' + a('assets', 'image', 'Assets') + a('products', 'box', 'Products') + '<h3>Work</h3>' + a('shares', 'share', 'Shared links') + '<h3>More</h3>' + a('more', 'folder', 'Documents (ECM)')) +
      `<div class="navfoot">${ext ? 'An outside user sees only what Acme Outdoor sent to Starfield Studios.' : 'Built from the brand assets starter kit, on the same platform as the claims app.'}</div>`;
  } else if (mode === 'share') {
    nav = '<h3>Shared link</h3><div class="navfoot" style="margin-top:4px">What the recipient sees: no account and no menu, only these files until the link ends.</div>';
  } else if (mode === 'app') {
    const rec = [['members', 'users', 'Members'], ['claims', 'health_record', 'Claims'], ['cases', 'gavel', 'Cases'], ['providers', 'physician', 'Providers']];
    nav = a('home', 'home', 'My work', myTasks().length ? `<span class="cnt">${myTasks().length}</span>` : '') + '<h3>Queues</h3>' + myQueues().map((q) => a('queue/' + q.id, 'list_bullet', esc(q.n), `<span class="cnt">${queueItems(q).length}</span>`)).join('') + '<h3>Records</h3>' + rec.map((x) => a(...x)).join('') + '<h3>Work</h3>' + a('inbox', 'inbox', 'Inbox', `<span class="cnt">${INBOX.filter((x) => !x.done).length}</span>`) + a('search', 'search', 'Search') + (inGroup(['claims-supervisors', 'appeals']) ? a('reports', 'bar_chart', 'Reports') : '') + '<h3>More</h3>' + a('more', 'folder', 'Documents (ECM)') + `<div class="navfoot">Built from the Payers starter kit. Navigation, queues and home differ by group.</div>`;
  } else if (mode === 'build') {
    nav = '<h3>Build an app</h3>' + a('build/agent', 'agent_orchestrator', 'App builder agent') + a('build/model', 'data_models', 'Data model') + a('build/layout', 'form', 'Record layouts') + a('build/queues', 'dashboard', 'Queues and home') + a('build/actions', 'button', 'Actions') + '<h3>Reuse</h3>' + a('build/kits', 'box', 'Starter kits') + a('build/bridge', 'merge', 'Studio bridge') + `<div class="navfoot">Everything here writes the same configuration package a developer could write by hand.</div>`;
  } else {
    nav = '<h3>Guide</h3>' + a('start', 'help', 'Start here') + a('start/before-after', 'compare', 'Member: before and after') + a('start/plan', 'steps', 'Plan map') + a('start/gaps', 'checklist_rtl', 'Enterprise gaps') + a('start/accounts', 'users', 'Every account') + a('start/feasibility', 'circle_check', 'Feasibility') + a('start/decisions', 'gavel', 'Decisions') + `<div class="navfoot">Prototype for discussion. Data is fictional; nothing talks to a server.</div>`;
  }
  $('#nav').innerHTML = nav;
}

// Attributes that identify a control across a re-render. An in-place render (a ticked row, a
// switched hold, a chosen decision) rebuilds the markup, so focus is restored by these, not by node.
const FOCUS_KEYS = ['data-act', 'data-id', 'data-i', 'data-k', 'data-f', 'name', 'value'];
function focusKeyOf(node) {
  if (!node || !node.closest || !node.closest('#main, #hdr, #nav')) return null;
  // `value` tells one radio or checkbox from its siblings. On a field it is what the person typed, which
  // the redraw writes back, so it would no longer match and focus would be lost.
  const parts = FOCUS_KEYS.filter((k) => node.hasAttribute(k) && (k !== 'value' || node.type === 'radio' || node.type === 'checkbox')).map((k) => `[${k}="${CSS.escape(node.getAttribute(k))}"]`);
  return parts.length ? node.tagName.toLowerCase() + parts.join('') : null;
}
let renderedHash = null;
function render() {
  const routeChanged = location.hash !== renderedHash;
  renderedHash = location.hash;
  const keep = routeChanged ? null : focusKeyOf(document.activeElement);
  const r = route();
  const key = r[0] === 'build' || r[0] === 'start' ? (r[1] ? r[0] + '/' + r[1] : r[0]) : r[0];
  const page = externalMay(r) ? P[key] || P.notFound : P.externalOnly;
  shell(r);
  let html;
  try {
    html = page(r);
  } catch (e) {
    console.error(e);
    html = `<div class="banner err">${ic('critical')}This page failed to draw: ${esc(e.message)}</div>`;
  }
  $('#main').innerHTML = html;
  const h = $('#main h1');
  document.title = (h ? h.textContent + ' · ' : '') + 'Nuxeo business apps prototype';
  if (routeChanged) {
    if (h) { h.tabIndex = -1; h.focus(); }
  } else if (keep) {
    const again = document.querySelector(keep);
    if (again) again.focus();
  }
}
P.notFound = () => head('Page not found', 'That address is not part of the prototype.') + '<a href="#/start">Back to the guide</a>';
