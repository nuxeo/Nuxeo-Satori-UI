// Task forms, cases, capture, search, reports, notifications and the app switcher.
const radio = (name, opts, val) => `<div class="chk" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" data-act="tf" ${v === val ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>`;
S.tf = {};

// ---- a task form generated from the workflow node's variables (Step 4)
P.task = (r) => {
  const id = r[1], t = TASKS[id];
  if (!t) return P.notFound();
  if (t.target.startsWith('AST')) return P.assetTask(r);
  // A draft belongs to this task, not to its id: an id freed by Undo and reused by a new task must
  // not hand the new task the old one's choices. It also belongs to the owner who wrote it: a task
  // reassigned to someone else starts empty for them, rather than offering the last owner's choices.
  const f = (S.tf[id] = S.tf[id] && S.tf[id].task === t && S.tf[id].owner === t.who ? S.tf[id] : { task: t, owner: t.who, decision: '', allowed: '', reason: '', comment: '', errors: {} });
  const isClaim = t.target.startsWith('CLAIM'), c = isClaim ? CLAIMS[t.target] : CASES[t.target];
  const stale = isClaim && !t.done && !OPEN_STATES.includes(c.state);
  const need = STEP_GROUPS[t.node], notMine = !!need && !inGroup([need]);
  // A draft is its owner's. Anyone else who opens the task reads the form empty and disabled, never the
  // owner's unsaved choices, and cannot change what the owner will later complete.
  const own = !t.done && !stale && !notMine && t.who === S.persona;
  const v = own ? f : { decision: '', allowed: '', reason: '', comment: '', errors: {} };
  const e = v.errors, er = (k) => (e[k] ? `<div class="err" id="e-${k}">${esc(e[k])}</div>` : '');
  let form = '';
  if (t.node === 'Determine') {
    form = `<div class="f"><span>Decision (required)</span>${radio('decision', [['approve', 'Approve'], ['deny', 'Deny'], ['pend', 'Pend for information']], v.decision)}</div>${er('decision')}
      ${v.decision === 'approve' ? `<label class="f"><span>Allowed amount, USD (required, at most the billed ${money(c.billed)})</span><input type="number" min="0.01" step="0.01" data-act="tfv" data-k="allowed" value="${esc(v.allowed)}" ${e.allowed ? 'aria-invalid="true" aria-describedby="e-allowed"' : ''}></label>${er('allowed')}${c.billed > SUPERVISOR_LIMIT ? `<p class="help">Over ${moneyText(SUPERVISOR_LIMIT)}, approving sends the claim to a supervisor (step “Supervisor approval”).</p>` : ''}` : ''}
      ${v.decision === 'deny' ? `<label class="f"><span>Denial reason (required when denying)</span><select data-act="tfv" data-k="reason" ${e.reason ? 'aria-invalid="true" aria-describedby="e-reason"' : ''}><option value="">Choose a reason</option>${DENIAL_REASONS.map(([k, l]) => `<option value="${k}" ${v.reason === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>${er('reason')}<p class="help">Shown only when the decision is Deny: a field rule in the task layout.</p>` : ''}
      ${v.decision ? `<label class="f"><span>Letter to send</span><select data-act="noop"><option>${v.decision === 'deny' ? 'Denial with appeal rights' : v.decision === 'approve' ? 'Approval and payment notice' : 'Request for information'}</option></select></label>` : ''}`;
  } else if (t.node === 'Supervisor approval') {
    // The approver sees what the approval pays, not just a button.
    form = `<p>Approving pays <strong>${moneyText(c.allowed ?? c.billed)}</strong> of the ${moneyText(c.billed)} billed${c.allowed == null ? ': no allowed amount was set, so this is the billed amount' : ', as determined'}.</p><div class="f"><span>Decision (required)</span>${radio('decision', [['approve', 'Approve payment'], ['return', 'Return to the adjuster']], v.decision)}</div>${er('decision')}`;
  } else if (t.node === 'Medical review') {
    form = `<div class="f"><span>Recommendation (required)</span>${radio('decision', [['uphold', 'Uphold the denial'], ['overturn', 'Overturn the denial']], v.decision)}</div>${er('decision')}<label class="sw" style="margin:8px 0"><input type="checkbox" data-act="noop"><span>I attest that I reviewed the medical records</span></label>`;
  } else if (t.node === 'Decision') {
    form = `<p>The medical review recommends: <strong>${t.recommendation === 'overturn' ? 'overturn the denial' : 'uphold the denial'}</strong>.</p><div class="f"><span>Decision (required)</span>${radio('decision', [['uphold', 'Uphold the denial'], ['overturn', 'Overturn the denial']], v.decision)}</div>${er('decision')}<p class="help" style="margin-left:0">The member is sent the decision letter, with its reasons and any further appeal rights.</p>`;
  } else {
    form = `<div class="f"><span>Outcome (required)</span>${radio('decision', [['resolved', 'Resolved on the call'], ['follow', 'Needs follow-up']], v.decision)}</div>${er('decision')}`;
  }
  const facts = isClaim
    ? `<dl class="kv"><div><dt>Member</dt><dd>${mLink(c.member)}</dd></div><div><dt>Provider</dt><dd>${pLink(c.provider)}</dd></div><div><dt>Billed</dt><dd>${money(c.billed)}</dd></div><div><dt>Diagnosis</dt><dd>${c.dx}</dd></div><div><dt>Lines</dt><dd>${c.lines.map((l) => l[0]).join(', ')}</dd></div></dl>${c.flag ? `<div class="banner warn" style="margin-top:12px">${ic('flag')}${esc(c.flag)}</div>` : ''}`
    : `<dl class="kv"><div><dt>Member</dt><dd>${mLink(c.member)}</dd></div><div><dt>Type</dt><dd>${c.type}</dd></div><div><dt>Deadline</dt><dd>${sla(c.due)}</dd></div></dl>`;
  return head(esc(t.n), `${esc(t.wf)} · step “${esc(t.node)}” · on ${tLink(t.target)} · ${sla(t.due)}`, ['s4', 's2']) +
    (t.done ? (t.closedByState ? `<div class="banner">${ic('info')}Closed when ${t.target} moved to ${CLAIM_STATE_LABEL[t.closedByState]} from its own page.</div>` : `<div class="banner ok">${ic('circle_check')}Completed. The claim moved on.</div>`) : stale ? `<div class="banner warn">${ic('info')}${t.target} is ${CLAIM_STATE_LABEL[c.state]}, so this task no longer applies.</div>` : '') +
    `<div class="split"><div class="card"><h2>Task form</h2>${notMine ? `<div class="banner warn">${ic('lock')}“${esc(t.node)}” is for ${need}. You can read it but not complete it.</div>` : t.who !== S.persona ? `<div class="banner warn">${ic('lock')}Assigned to ${esc(pName(t.who))}. You can read it but not complete it.</div>` : ''}
      <fieldset class="tf" ${own ? '' : 'disabled'}>${form}<label class="f"><span>Comment (type @ to mention someone)</span><textarea data-act="tfv" data-k="comment">${esc(v.comment)}</textarea></label></fieldset>
      ${Object.keys(e).length ? `<div class="banner err" role="alert">${ic('critical')}${Object.keys(e).length} field${Object.keys(e).length > 1 ? 's' : ''} to correct.</div>` : ''}
      <div class="row"><button class="primary" data-act="complete" data-id="${id}" ${t.done || stale || notMine || t.who !== S.persona ? 'disabled' : ''}>Complete task</button><button data-act="reassign" data-id="${id}">${ic('reassign', 1)}Reassign</button></div></div>
    <div><div class="card"><h2>${isClaim ? 'Claim' : 'Case'} at a glance</h2>${facts}</div><div class="card"><h2>Documents</h2>${(isClaim ? c.docs : Object.keys(DOCS).filter((d) => DOCS[d].case === t.target)).map((d) => `<div class="field">${ic('pdf', 1)}<span style="flex:1">${esc(DOCS[d].n)}</span><button class="sm link" data-act="preview" data-id="${d}">Preview</button></div>`).join('') || '<p class="muted">None attached.</p>'}</div></div></div>` +
    note('<strong>Plan:</strong> this form is built from the workflow step’s own variables, not hard-coded (Step 4). The denial reason appears only for a denial, and the allowed amount cannot exceed the billed amount: a field rule and a cross-field check (Step 2). Checked on Nuxeo 2025: each task names its step’s variable schema (<code>taskInfo.schemas</code> → <code>var_&lt;node&gt;</code>) and its layout, so this is client work. <a href="#/start/feasibility">Feasibility</a>.');
};

// ---- a case: a folder on the server, opened as a record with its documents, checklist and timeline
P.case = (r) => {
  const id = r[1], k = CASES[id];
  if (!k) return P.notFound();
  const missing = k.checklist.filter((x) => !x[1]).length;
  const docs = Object.entries(DOCS).filter(([, d]) => d.case === id);
  return ptags(['s1', 'b5', 's5']) +
    `<div class="rec"><div class="ricon">${ic('gavel')}</div><div><h1>${esc(k.title)}</h1><div class="crumbs">${k.type} · ${id} · ${mLink(k.member)} · ${cLink(k.claim)}</div></div>${caseState(k.state)}<span class="gap"></span>
      <button data-act="op-records" data-id="${id}">${ic('send', 1)}Request documents</button><button data-act="letter" data-id="${id}">${ic('mail', 1)}Generate letter</button>${Object.entries(TASKS).filter(([, t]) => t.target === id && !t.done).map(([tid, t]) => `<a href="#/task/${tid}"><button class="primary">${esc(t.n)}</button></a>`).join('')}</div>
    <div class="facts"><div><span>Regulatory deadline</span><strong>${d8(k.due)}</strong>${sla(k.due)}</div><div><span>Received</span><strong>${d8(k.rcvd)}</strong></div><div><span>Missing documents</span><strong>${missing}</strong></div><div><span>Assignee</span><strong>${esc(pName(k.assignee))}</strong></div></div>
    <div class="split"><div>
      <div class="card"><h2>Required documents</h2><ul class="cl">${k.checklist.map(([n, d], i) => `<li>${d ? ic('circle_check') : ic('circle_dot')}<span style="flex:1">${esc(n)}${d ? ` · <a href="#" data-act="preview" data-id="${d}">${esc(DOCS[d].n)}</a>` : ' <span class="badge">Missing</span>'}</span>${d ? '' : `<button class="sm tonal" data-act="check-upload" data-id="${id}" data-i="${i}">${ic('upload', 1)}Upload</button>`}</li>`).join('')}</ul></div>
      <div class="card"><div class="row sp"><h2>Documents in this case</h2><span class="badge">Children of the case folder</span></div><table><tbody>${docs.map(([d]) => docRow(d)).join('')}</tbody></table><div class="drop" style="margin-top:12px">Drop files here. They are stored in the case folder; nobody needs to open Browse.</div></div>
      <div class="card"><h2>Timeline</h2><ul class="tl">${[...S.log.filter((x) => x.on === id).map((x) => [null, x.icon, x.t, 'Just now']), ...k.timeline.slice().reverse()].map(([d, icon, t, src]) => `<li>${ic(icon)}<div>${esc(t)}<div class="muted">${esc(src)}</div></div><time>${d ? d8(d) : 'Just now'}</time></li>`).join('')}</ul>
        <label class="f"><span>Add a note (type @ to mention someone)</span><textarea id="cnote" data-act="noop"></textarea></label><button class="sm tonal" data-act="case-note" data-id="${id}">Add note</button></div>
    </div><div>
      <div class="card"><h2>People</h2>${k.people.map(([p, role]) => `<div class="field">${PERSONAS[p] ? `<span class="avatar sm">${PERSONAS[p].ini}</span>${esc(PERSONAS[p].n)}` : `${ic('physician', 1)}${esc(p)}`}<span class="gap"></span><span class="muted">${esc(role)}</span></div>`).join('')}</div>
      <div class="card"><h2>${ic('governance', 1)} Retention and holds</h2><p>Kept 10 years after closure (rule <code>appeals-10y</code>).</p><label class="sw"><input type="checkbox" data-act="hold" data-id="${id}" ${k.hold ? 'checked' : ''}><span>Legal hold</span></label><p class="help" style="margin-left:0">A hold stops deletion and retention expiry until it is lifted. The server enforces it.</p></div>
      ${infoPanel({ state: caseState(k.state), by: k.assignee, tags: [k.type] })}</div></div>` +
    note('<strong>Plan:</strong> a Case is folderish on the server. Today it is sent to Browse; here it opens as a record with a Documents tab for its children (Step 1), a required-documents checklist, a timeline that merges capture, workflow, notes and operations, and retention and legal hold (section 5).');
};

// ---- inbound capture: classify, match, extract, link, and create the work (section 5)
P.inbox = () => head('Inbox', 'Mail, scans and faxes, classified and matched to the right member, claim or case. Nothing is filed until someone confirms.', ['b5', 's5']) +
  INBOX.map((x) => `<div class="card"><div class="row sp"><h2>${ic(x.ch === 'Email' ? 'mail' : x.ch === 'Scan' ? 'scan_document' : 'printer')} ${esc(x.subj)}</h2>${x.done ? '<span class="st ok">Filed</span>' : `<span class="badge">${x.ch}</span>`}</div>
    <p class="muted">From ${esc(x.from)} · ${esc(x.file)}</p>
    <div class="grid3"><div><h3>Document type</h3><p>${esc(x.cls[0])} <span class="badge ${x.cls[1] < 80 ? '' : 'c'}">${x.cls[1]}% sure</span></p></div>
      <div><h3>Belongs to</h3><p>${x.member ? `${mLink(x.member[0])} <span class="badge c">${x.member[1]}%</span><br>${tLink(x.target[0])} <span class="badge c">${x.target[1]}%</span>` : '<span class="muted">No confident match. Choose one.</span>'}</p></div>
      <div><h3>Extracted fields</h3><dl class="side-kv">${x.fields.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl></div></div>
    ${x.done ? '' : `<div class="row"><button class="primary" data-act="file-in" data-id="${x.id}" ${x.member ? '' : 'disabled'}>File it and notify the assignee</button><button data-act="toast" data-msg="Opened the matching picker">Choose another record</button><button class="link" data-act="toast" data-msg="Marked as not a document for this workspace">Not ours</button></div>`}</div>`).join('') +
  note('<strong>Plan:</strong> inbound capture (section 5). <code>AI.Classify</code> exists in the AI package, which is off today; the confidence shown here is what a reviewer needs to trust the suggestion. Low confidence never files on its own.');

// ---- search over business records, with type-specific filters
// What the plain-words query is read as. The filters show it, and the results apply exactly it, so
// the page can never list a claim its own criteria exclude.
const SEARCH = { over: 5000, codes: { 27447: 'Total knee replacement', 29881: 'Knee arthroscopy' } };
P.search = () => {
  const codes = Object.keys(SEARCH.codes);
  const results = Object.entries(CLAIMS).filter(([, c]) => OPEN_STATES.includes(c.state) && c.billed > SEARCH.over && c.lines.some(([code]) => codes.includes(code)));
  return head('Search', 'Search by what people know: member ID, name, date of birth, claim number, provider or amount.', ['s3', 'b5']) +
  `<div class="card"><div class="row"><label class="f" style="flex:1;margin:8px 0"><span>Ask in plain words (AI package)</span><input type="text" value="open claims over $5,000 for knee procedures" data-act="noop"></label><button class="primary" data-act="toast" data-msg="Searching claims: state is open, billed over 5000, procedure ${codes.join(' or ')}">${ic('search', 1)}Search</button></div>
  <p class="muted" style="margin:4px 0 0">Read as: claims, still under review, billed over ${moneyText(SEARCH.over)}, with procedure ${codes.map((k) => `${k} (${SEARCH.codes[k].toLowerCase()})`).join(' or ')}.</p>
  <div class="row"><label class="f" style="width:180px"><span>Record type</span><select><option>Claims</option><option>Members</option><option>Cases</option></select></label><label class="f" style="width:180px"><span>State</span><select><option>Open</option><option>Any</option></select></label><label class="f" style="width:180px"><span>Billed over</span><input type="number" value="${SEARCH.over}"></label><label class="f" style="width:260px"><span>Procedure</span><select><option>Knee (${codes.join(', ')})</option><option>Any</option></select></label><label class="f" style="width:220px"><span>Provider</span><select><option>Any</option>${Object.values(PROVIDERS).map((p) => `<option>${esc(p.n)}</option>`).join('')}</select></label></div></div>
  <div class="card" style="padding:4px 8px"><table><thead><tr><th>Claim</th><th>Member</th><th>Procedure</th><th class="num">Billed</th><th>State</th></tr></thead><tbody>${results.map(([id, c]) => { const line = c.lines.find(([code]) => codes.includes(code)); return `<tr><td>${cLink(id)}</td><td>${mLink(c.member)}</td><td>${esc(line[1])} <span class="badge">${line[0]}</span></td><td class="num">${money(c.billed)}</td><td>${claimState(c.state)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No claims match.</td></tr>'}</tbody></table></div>
  <div class="card"><h2>Saved searches for your team</h2><div class="field">${ic('bookmark', 1)}<span style="flex:1">Knee and hip claims over $5,000</span><span class="muted">claims-supervisors</span></div><div class="field">${ic('bookmark', 1)}<span style="flex:1">Out-of-network claims this month</span><span class="muted">claims-adjusters</span></div></div>`;
};

// ---- business reporting: KPIs and charts, each bar drills down to the list behind it
P.reports = () => {
  const by = CLAIM_STATES.map((s) => [s, Object.values(CLAIMS).filter((c) => c.state === s).length]).filter((x) => x[1]);
  const max = Math.max(...by.map((x) => x[1]));
  const aging = [['0–7 days', 3], ['8–14', 2], ['15–30', 1], ['31+', 1]];
  return head('Reports', 'Built from search aggregates. Every bar opens the list behind it.', ['b5', 's3']) +
    `<div class="kpis"><a class="kpi" href="#/claims"><span>Claims received, November</span><strong>184</strong><em>+12% on October</em></a><a class="kpi" href="#/claims"><span>Determined within 30 days</span><strong>96%</strong><em>Target 95%</em></a><a class="kpi warn" href="#/queue/highvalue"><span>Pended for information</span><strong>14</strong><em>Median 6 days pended</em></a><a class="kpi" href="#/queue/appeals"><span>Appeals overturned</span><strong>18%</strong><em>Last 90 days</em></a></div>
    <div class="grid2"><div class="card"><h2>Claims by state</h2><div class="bars">${by.map(([s, n]) => `<a href="#/claims/${s}">${CLAIM_STATE_LABEL[s]}<i style="width:${(n / max) * 100}%"></i><span>${n}</span></a>`).join('')}</div></div>
    <div class="card"><h2>Open claims by age</h2><div class="vbars">${aging.map(([l, n]) => `<div><span>${n}</span><i style="height:${n * 30}px"></i>${l}</div>`).join('')}</div></div>
    <div class="card"><h2>Billed by provider, open claims</h2><div class="bars">${Object.entries(PROVIDERS).map(([pid, p]) => { const v = Object.values(CLAIMS).filter((c) => c.provider === pid && !['paid', 'closed'].includes(c.state)).reduce((s, c) => s + c.billed, 0); return `<a href="#/provider/${pid}">${esc(p.n)}<i style="width:${(v / 33000) * 100}%"></i><span>$${Math.round(v / 1000)}k</span></a>`; }).join('')}</div></div>
    <div class="card"><h2>Scheduled exports</h2><div class="field">${ic('calendar', 1)}<span style="flex:1">Monthly timeliness report to the compliance team</span><span class="muted">1st of the month, CSV</span></div><div class="field">${ic('calendar', 1)}<span style="flex:1">Weekly pended-claims list</span><span class="muted">Mondays, CSV</span></div></div></div>`;
};

// ---- notifications
P.notifications = () => {
  const mine = NOTIFS.map((n, i) => ({ ...n, i })).filter((n) => n.to === S.persona);
  return head('Notifications', 'Assignments, mentions, deadlines and documents that arrived for your work.', ['b5']) +
    `<div class="row" style="margin-bottom:12px"><button class="sm" data-act="read-all">Mark all as read</button><span class="gap"></span><label class="sw"><input type="checkbox" checked data-act="noop"><span>Email me when something is assigned to me</span></label></div>
    <div class="card"><ul class="tl">${mine.map((n) => `<li>${ic(n.icon)}<div><a href="${n.h}" data-act="read" data-i="${n.i}">${esc(n.t)}</a>${n.unread && !S.read.has(n.i) ? ' <span class="badge c">New</span>' : ''}</div><time>${n.when}</time></li>`).join('') || '<li><span></span><span class="muted">Nothing new.</span><span></span></li>'}</ul></div>`;
};

// ---- several apps on one server, chosen by group (section 5)
P.apps = () => head('Apps on this server', 'One Nuxeo, several purpose-built apps. Each has its own navigation, home and branding, and shows only to its groups.', ['b5', 's0']) +
  `<div class="apps">${APPS.filter((a) => (a.kit === me().kit || a.kit === 'any') && !a.external).map((a) => `<a href="${a.id === 'documents' ? '#/more' : '#/home'}" data-act="${a.id === 'documents' ? 'go-docs' : 'go-app'}" data-id="${a.id}">${ic(a.icon)}<span><strong>${esc(a.n)}</strong><br><span class="muted">${esc(a.d)}</span><br><span class="badge">${a.groups.length ? a.groups.join(', ') : 'everyone'}</span></span></a>`).join('')}</div>` +
  note('Today the server serves one app, and presets switch branding per browser on demo servers only. This page is a later decision (section 9).');

// ---- the ECM side stays available, but is not the default experience
P.more = () => head('Documents', 'The general ECM functions are still here for the document side of the work.', ['ootb', 's0']) +
  `<div class="grid3">${[['folder', 'Browse', 'Folders and files, as in Nuxeo Satori UI today'], ['bookmark', 'Collections', 'Hand-picked sets of documents'], ['star', 'Favorites', 'Your shortcuts'], ['trash', 'Trash', 'Restore deleted documents']].map(([i, n, d]) => `<div class="card"><h2>${ic(i, 1)} ${n}</h2><p class="muted">${d}</p><button class="sm" data-act="toast" data-msg="Opens the existing Nuxeo Satori UI page">Open</button></div>`).join('')}</div>` +
  note('In a business app these entries are optional and hidden by default; they are one manifest switch away (section 7).');
