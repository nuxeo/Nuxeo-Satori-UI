// Record pages: the business record first, its related records, and the work done on it (Steps 1, 2, 4, 5).
function infoPanel(o) {
  return `<div class="card"><h2>${ic('info', 1)} Details</h2><dl class="side-kv">
    <dt>State</dt><dd>${o.state}</dd><dt>Version</dt><dd>${o.version || '0.1'} <button class="sm link" data-act="toast" data-msg="Version 0.2 created">Create version</button></dd>
    <dt>Last modified</dt><dd>${o.modified || 'Nov 18, 2026'} by ${who(o.by || 'dana')}</dd><dt>Tags</dt><dd>${(o.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ') || '<span class="muted">None</span>'}</dd></dl>
    <label class="f"><span>Comment (type @ to mention someone)</span><textarea data-act="noop" rows="2" aria-label="Comment"></textarea></label><button class="sm tonal" data-act="comment">Post comment</button></div>`;
}
const tabsFor = (base, cur, list) => `<nav class="tabs" aria-label="Record sections">${list.map(([k, l]) => `<a href="#/${base}${k ? '/' + k : ''}" ${cur === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
const docRow = (id) => { const d = DOCS[id]; return `<tr><td>${ic('pdf', 1)} ${esc(d.n)}</td><td><span class="badge">${esc(d.cat)}</span></td><td>${d.size}</td><td><button class="sm link" data-act="preview" data-id="${id}">Preview</button></td></tr>`; };

// ---- Member: the Web UI page presales showed, rebuilt from a layout file with no code
P.member = (r) => {
  const id = r[1], m = MEMBERS[id];
  if (!m) return P.notFound();
  const tab = r[2] || '';
  const claims = Object.entries(CLAIMS).filter(([, c]) => c.member === id);
  const cases = Object.entries(CASES).filter(([, c]) => c.member === id);
  const docs = Object.entries(DOCS).filter(([, d]) => d.member === id || claims.some(([cid]) => d.claim === cid));
  const info = `<div class="card"><div class="row sp"><h2>Member info</h2><span class="badge c" title="Layout file: Member/view.layout.json">Layout: Member · view</span></div><dl class="kv">
      <div><dt>Member ID</dt><dd>${id}</dd></div>
      <div><dt>Date of birth</dt><dd>${d8(m.dob)} <small>(age ${ageOf(m.dob)})</small></dd></div>
      <div><dt>HICN</dt><dd>${masked(m.hicn)}</dd></div>
      <div><dt>Medicare ID</dt><dd>${masked(m.medicare)}</dd></div>
      <div><dt>Contact</dt><dd>${esc(m.first + ' ' + m.last)}<br><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a><br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></dd></div>
      <div><dt>Address</dt><dd>${esc(m.street)}<br>${esc(m.city)}, ${esc(m.state)} ${esc(m.zip)}</dd></div>
      <div><dt>Plan</dt><dd>${esc(m.plan)} <small>since ${d8(m.since)}</small></dd></div>
      <div><dt>Primary care</dt><dd>${esc(m.pcp)}</dd></div></dl></div>`;
  const claimT = `<div class="card"><div class="row sp"><h2>Claims</h2><span class="badge" title="Related-records widget">claims_for_member · member = this record</span></div><table><thead><tr><th>Claim ID</th><th class="num">Amount</th><th>Provider</th><th>Provider NPI</th><th><button class="link" data-act="toast" data-msg="Sorted by service date">Service date ↓</button></th><th>State</th></tr></thead><tbody>${claims.sort((a, b) => b[1].svc.localeCompare(a[1].svc)).map(([cid, c]) => `<tr><td>${cLink(cid)}</td><td class="num">${money(c.billed)}</td><td>${pLink(c.provider)}</td><td>${PROVIDERS[c.provider].npi}</td><td>${d8(c.svc)}</td><td>${claimState(c.state)}</td></tr>`).join('')}</tbody></table></div>`;
  const caseT = `<div class="card"><div class="row sp"><h2>Cases</h2><span class="badge">cases_for_member · member = this record</span></div>${cases.length ? `<table><thead><tr><th>ID</th><th>Type</th><th>Claim</th><th>Received</th><th>State</th><th>Determination</th></tr></thead><tbody>${cases.map(([kid, c]) => `<tr><td>${kLink(kid)}</td><td>${c.type}</td><td>${cLink(c.claim)}</td><td>${d8(c.rcvd)}</td><td>${caseState(c.state)}</td><td>${c.determination || '<span class="muted">Pending</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No cases.</p>'}</div>`;
  const docT = `<div class="card"><div class="row sp"><h2>Documents</h2><button class="sm tonal" data-act="upload" data-on="${id}">${ic('upload', 1)}Add document</button></div><table><thead><tr><th>Name</th><th>Category</th><th>Size</th><th></th></tr></thead><tbody>${docs.map(([did]) => docRow(did)).join('')}</tbody></table><div class="drop" style="margin-top:12px">Drop a file here: it is filed under this member, and its category is suggested from its content.</div></div>`;
  // This member's own records, newest first, after anything changed on them in this session.
  const mine = new Set([...claims.map(([cid]) => cid), ...cases.map(([kid]) => kid)]);
  const recentChanges = S.log.filter((x) => mine.has(x.on)).map((x) => `<li>${ic(x.icon)}<div>${tLink(x.on)}: ${esc(x.t)}</div><time>Just now</time></li>`);
  const history = [
    ...claims.map(([cid, cl]) => [cl.rcvd, `<li>${ic('health_record')}<div>${cLink(cid)} received from ${esc(PROVIDERS[cl.provider].n)}</div><time>${d8(cl.rcvd)}</time></li>`]),
    ...cases.map(([kid, k]) => [k.rcvd, `<li>${ic('gavel')}<div>${kLink(kid)} opened: ${esc(k.title)}</div><time>${d8(k.rcvd)}</time></li>`]),
  ].sort((x, y) => y[0].localeCompare(x[0])).map((x) => x[1]);
  const activity = `<div class="card"><h2>Activity</h2><ul class="tl">${[...recentChanges, ...history].join('') || '<li><span></span><span class="muted">Nothing yet.</span><span></span></li>'}</ul></div>`;
  // The same records, summarised. Written from the data, so it describes this member and stays true.
  const years = TODAY.getUTCFullYear() - Number(m.since.slice(0, 4));
  const paidClaims = claims.filter(([, cl]) => cl.paid);
  const underReview = claims.filter(([, cl]) => OPEN_STATES.includes(cl.state));
  const openCases = cases.filter(([, k]) => !['decided', 'closed'].includes(k.state));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = [
    `Member for ${plural(years, 'year')}.`,
    paidClaims.length ? `${plural(paidClaims.length, 'claim')} paid (${moneyText(paidClaims.reduce((s, [, cl]) => s + cl.paid, 0))}).` : 'No claims paid yet.',
    underReview.length ? `${plural(underReview.length, 'claim')} under review${underReview.some(([, cl]) => cl.flag) ? ', one flagged for an unusual amount' : ''}.` : '',
    openCases.length ? `${plural(openCases.length, 'open case')}: ${openCases.map(([, k]) => k.type.toLowerCase()).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const body = tab === 'claims' ? claimT : tab === 'cases' ? caseT : tab === 'documents' ? docT : tab === 'activity' ? activity : info + claimT + caseT;
  return ptags(['qw', 's1', 's2', 'b5']) +
    `<div class="rec"><div class="ricon">${ic('user')}</div><div><h1>${esc(m.first + ' ' + m.last)}</h1><div class="crumbs">Member · ${id} · ${esc(m.plan)}</div></div><span class="st ok">Active</span><span class="gap"></span>
      <button data-act="edit-member" data-id="${id}">${ic('pencil', 1)}Edit</button><button data-act="start-case" data-id="${id}">${ic('gavel', 1)}Start a case</button><button data-act="letter" data-id="${id}">${ic('mail', 1)}Generate letter</button></div>
    <div class="facts"><div><span>Age</span><strong>${ageOf(m.dob)}</strong></div><div><span>Open claims</span><strong>${claims.filter(([, c]) => !['paid', 'closed'].includes(c.state)).length}</strong></div><div><span>Paid to date</span><strong>${money(claims.reduce((s, [, c]) => s + (c.paid || 0), 0))}</strong></div><div><span>Risk</span><strong>${esc(m.risk)}</strong></div></div>
    ${tabsFor('member/' + id, tab, [['', 'Overview'], ['claims', `Claims (${claims.length})`], ['cases', `Cases (${cases.length})`], ['documents', `Documents (${docs.length})`], ['activity', 'Activity']])}
    <div class="split"><div>${body}</div><div>
      <div class="card ai"><h2>${ic('summary', 1)}Summary</h2><p>${esc(summary)}</p><p class="muted" style="margin:0">Needs the AI package (off today).</p></div>
      ${infoPanel({ state: '<span class="st ok">Active</span>', tags: ['Gold PPO'] })}</div></div>` +
    note('<strong>Plan:</strong> the Member page from the Payers demo, from a layout file and no code (Step 2). Age is a registered computation, the address and contact blocks are combined fields, the Claims and Cases tables are related-records widgets that pass this member to the query, and HICN is masked for member services (switch to Riley). Compare it with <a href="#/start/before-after">today’s page</a>.');
};

// ---- Claim: lifecycle buttons from the allowed transitions, server actions, and the task on it
P.claim = (r) => {
  const id = r[1], c = CLAIMS[id];
  if (!c) return P.notFound();
  const m = MEMBERS[c.member], pr = PROVIDERS[c.provider];
  const task = Object.entries(TASKS).find(([, t]) => t.target === id && !t.done);
  // A denied claim is never paid: its path is Denied, then Closed. A closed claim keeps the path it took.
  const deniedPath = c.state === 'denied' || (c.state === 'closed' && c.denial);
  const order = deniedPath ? ['submitted', 'inReview', 'denied', 'closed'] : ['submitted', 'inReview', 'approved', 'paid', 'closed'];
  const idx = c.state === 'pended' ? 1 : order.indexOf(c.state);
  const stepper = `<div class="step" aria-label="Claim lifecycle">${order.map((s, i) => `<div class="${i < idx ? 'done' : i === idx ? 'cur' : ''}">${i === 1 && c.state === 'pended' ? 'Pended' : CLAIM_STATE_LABEL[s]}</div>`).join('')}</div>`;
  const ro = ['paid', 'closed'].includes(c.state);
  const supervisorOnly = c.billed > SUPERVISOR_LIMIT && !inGroup(['claims-supervisors']);
  const trans = (CLAIM_TRANSITIONS[c.state] || []).map(([t, l, to]) => `<button class="${t === 'approve' ? 'primary' : ''}" data-act="transition" data-id="${id}" data-to="${to}" data-t="${t}" ${t === 'approve' && supervisorOnly ? `disabled title="Over ${moneyText(SUPERVISOR_LIMIT)}, approval is the supervisor's step"` : ''}>${esc(l)}</button>`).join('');
  const total = c.lines.reduce((s, l) => s + l[2], 0);
  const refs = Object.entries(CASES).filter(([, k]) => k.claim === id);
  const log = S.log.filter((x) => x.on === id);
  return ptags(['s2', 's4', 's5', 'b5']) +
    `<div class="rec"><div class="ricon">${ic('health_record')}</div><div><h1>${id}</h1><div class="crumbs">Claim · ${mLink(c.member)} · ${esc(pr.n)}</div></div>${claimState(c.state)}${OPEN_STATES.includes(c.state) ? sla(c.due) : ''}<span class="gap"></span>${trans}
      <button data-act="op-records" data-id="${id}">${ic('send', 1)}Request medical records</button><button class="icon" data-act="edit-claim" data-id="${id}" aria-label="Edit claim" ${ro ? 'disabled title="Read-only once paid or closed"' : ''}>${ic('pencil')}</button></div>
    ${stepper}
    ${task && task[1].who === S.persona ? `<div class="banner">${ic('user_task')}<span>You have a task on this claim: <strong>${esc(task[1].n)}</strong>, ${sla(task[1].due)}</span><span class="gap"></span><a href="#/task/${task[0]}"><button class="primary sm">Open the task form</button></a></div>` : ''}
    ${c.flag ? `<div class="banner warn">${ic('flag')}<span><strong>Unusual amount.</strong> ${esc(c.flag)} <span class="muted">(AI package, off today)</span></span></div>` : ''}
    <div class="split"><div>
      <div class="card"><h2>Claim summary</h2><dl class="kv">
        <div><dt>Member</dt><dd>${mLink(c.member)} <small>age ${ageOf(m.dob)}</small></dd></div><div><dt>Provider</dt><dd>${pLink(c.provider)}<br><small>NPI ${pr.npi} · ${pr.net}</small></dd></div>
        <div><dt>Diagnosis</dt><dd>${c.dx}</dd></div><div><dt>Service date</dt><dd>${d8(c.svc)}</dd></div><div><dt>Received</dt><dd>${d8(c.rcvd)}</dd></div>
        <div><dt>Billed</dt><dd>${money(c.billed)}</dd></div><div><dt>Allowed</dt><dd>${money(c.allowed)}</dd></div><div><dt>Paid</dt><dd>${money(c.paid)}</dd></div>
        ${c.state === 'denied' ? `<div><dt>Denial reason</dt><dd>${esc((DENIAL_REASONS.find((d) => d[0] === c.denial) || ['', '—'])[1])}</dd></div>` : ''}
        <div><dt>Assignee</dt><dd>${who(c.assignee)}</dd></div></dl></div>
      <div class="card"><h2>Service lines</h2><table><thead><tr><th>Code</th><th>Description</th><th class="num">Billed</th></tr></thead><tbody>${c.lines.map((l) => `<tr><td>${l[0]}</td><td>${esc(l[1])}</td><td class="num">${money(l[2])}</td></tr>`).join('')}<tr><td></td><td><strong>Total</strong> <span class="badge">sum of lines</span></td><td class="num"><strong>${money(total)}</strong></td></tr></tbody></table></div>
      <div class="card"><h2>Documents</h2>${c.docs.length ? `<table><tbody>${c.docs.map(docRow).join('')}</tbody></table>` : '<p class="muted">No documents yet. Request them, or drop a file here.</p>'}</div>
      <div class="card"><h2>Cases about this claim</h2>${refs.length ? refs.map(([kid, k]) => `<div class="field">${ic('gavel', 1)}<span style="flex:1">${kLink(kid)} · ${esc(k.title)}</span>${caseState(k.state)}</div>`).join('') : '<p class="muted">None. Records that point at this claim show here automatically.</p>'}</div>
      <div class="card"><h2>Activity</h2><ul class="tl">${log.map((x) => `<li>${ic(x.icon)}<div>${esc(x.t)}</div><time>Just now</time></li>`).join('')}<li>${ic('user_task')}<div>Assigned to ${esc(pName(c.assignee) || 'the team queue')}</div><time>${d8(c.rcvd)}</time></li><li>${ic('scan_document')}<div>Received and classified as a professional claim</div><time>${d8(c.rcvd)}</time></li></ul></div>
    </div><div>${infoPanel({ state: claimState(c.state), by: c.assignee || 'dana', tags: [pr.spec] })}</div></div>` +
    note('<strong>Plan:</strong> the buttons next to the title are the transitions the claim lifecycle allows from its current state, read from the server (Step 4). <em>Request medical records</em> runs a server Automation chain with parameters, a confirmation and a success message (Step 5). Editing is read-only once the claim is paid or closed.');
};

// ---- Provider: no layout file, so everything here is generated (section 7, out of the box)
P.provider = (r) => {
  const id = r[1], p = PROVIDERS[id];
  if (!p) return P.notFound();
  const claims = Object.entries(CLAIMS).filter(([, c]) => c.provider === id);
  return ptags(['ootb', 's1']) + `<div class="rec"><div class="ricon">${ic('physician')}</div><div><h1>${esc(p.n)}</h1><div class="crumbs">Provider · ${id}</div></div><span class="badge c">Generated from the provider schema</span></div>
    <div class="split"><div><div class="card"><h2>provider</h2><dl class="kv"><div><dt>Name</dt><dd>${esc(p.n)}</dd></div><div><dt>NPI</dt><dd>${p.npi}</dd></div><div><dt>Specialty</dt><dd>${p.spec}</dd></div><div><dt>City</dt><dd>${p.city}</dd></div><div><dt>Network</dt><dd>${p.net}</dd></div></dl></div>
    <div class="card"><h2>Claims that point here <span class="badge">from claim:provider</span></h2><table><thead><tr><th>Claim</th><th>Member</th><th class="num">Billed</th><th>State</th></tr></thead><tbody>${claims.map(([cid, c]) => `<tr><td>${cLink(cid)}</td><td>${mLink(c.member)}</td><td class="num">${money(c.billed)}</td><td>${claimState(c.state)}</td></tr>`).join('')}</tbody></table></div></div>
    <div>${infoPanel({ state: '<span class="st">Default</span>', tags: [] })}</div></div>` +
    note('<strong>Out of the box:</strong> nobody wrote a layout for Provider. The page shows its schema’s fields in the main area, no file viewer, and lists the claims whose <code>claim:provider</code> reference points here. A layout file or the agent can refine it later.');
};
