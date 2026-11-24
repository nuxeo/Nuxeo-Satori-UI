// "What do I need to do today?": the home page, the queues and the record lists (Step 3, Step 1).
const RECENT = {
  dana: ['CLAIM-000131', 'MEMBER-100048', 'CLAIM-000143', 'PRV-203'],
  morgan: ['CLAIM-000141', 'CLAIM-000131', 'MEMBER-100051'],
  sam: ['CASE-2041', 'MEMBER-100049', 'CLAIM-000144'],
  riley: ['CASE-2042', 'MEMBER-100048'],
};
function recLink(id) {
  if (id.startsWith('AST')) return [aLink(id), 'Asset · ' + esc(PRODUCTS[ASSETS[id].product].n), ASSETS[id].kind === 'video' ? 'videocam' : 'image'];
  if (id.startsWith('PRD')) return [prLink(id), 'Product · ' + esc(PRODUCTS[id].style), 'box'];
  if (id.startsWith('CLAIM')) return [cLink(id), 'Claim · ' + esc(mName(CLAIMS[id].member)), 'health_record'];
  if (id.startsWith('CASE')) return [kLink(id), esc(CASES[id].type) + ' · ' + esc(mName(CASES[id].member)), 'gavel'];
  if (id.startsWith('MEMBER')) return [mLink(id), 'Member · ' + id, 'user'];
  return [`<a href="#/provider/${id}">${esc(PROVIDERS[id].n)}</a>`, 'Provider · NPI ' + PROVIDERS[id].npi, 'physician'];
}
function kpis() {
  if (me().kit === 'dam') return damKpis();
  const g = me().groups, my = Object.values(CLAIMS).filter((c) => c.assignee === S.persona && OPEN_STATES.includes(c.state));
  const k = (label, value, foot, h, tone) => `<a class="kpi ${tone || ''}" href="${h}"><span>${label}</span><strong>${value}</strong><em>${foot}</em></a>`;
  if (g.includes('claims-supervisors')) {
    const hv = queueItems(QUEUES[2]);
    return k('Awaiting my approval', myTasks().length, 'Supervisor approval step', '#/home') + k('Over $5,000 in review', hv.length, money(hv.reduce((s, c) => s + c.billed, 0)) + ' billed', '#/queue/highvalue') + k('Team overdue', Object.values(CLAIMS).filter((c) => c.due && daysTo(c.due) < 0 && OPEN_STATES.includes(c.state)).length, 'Past determination date', '#/reports', 'bad') + k('Days to determine', '6.2', 'Average, last 30 days', '#/reports');
  }
  if (g.includes('claims-adjusters')) {
    return k('My open claims', my.length, 'Assigned to you', '#/queue/mine') + k('Due this week', my.filter((c) => c.due && daysTo(c.due) >= 0 && daysTo(c.due) <= 7).length, 'Determination date', '#/queue/mine', 'warn') + k('Overdue', my.filter((c) => c.due && daysTo(c.due) < 0).length, 'Past determination date', '#/queue/mine', 'bad') + k('Unassigned', queueItems(QUEUES[0]).length, 'Waiting in the team queue', '#/queue/unassigned');
  }
  if (g.includes('appeals')) {
    const open = Object.values(CASES).filter((c) => c.type === 'Appeal' && !['decided', 'closed'].includes(c.state));
    return k('Open appeals', open.length, 'Assigned to you', '#/queue/appeals') + k('Regulatory deadline in 14 days', open.filter((c) => daysTo(c.due) <= 14).length, '30-day limit', '#/queue/appeals', 'warn') + k('Missing documents', open.reduce((s, c) => s + c.checklist.filter((x) => !x[1]).length, 0), 'On your checklists', '#/case/CASE-2041', 'warn') + k('Decided this month', 9, '100% within deadline', '#/reports');
  }
  return k('Callbacks today', myTasks().length, 'From grievances', '#/queue/callbacks', 'warn') + k('Open grievances', Object.values(CASES).filter((c) => c.type === 'Grievance' && !['decided', 'closed'].includes(c.state)).length, 'All members', '#/queue/callbacks') + k('Calls logged', 23, 'This week', '#/home');
}
P.home = () => {
  const p = me(), t = myTasks(), q = myQueues();
  const tasks = t.length ? `<table><thead><tr><th>Task</th><th>On</th><th>Workflow</th><th>Due</th></tr></thead><tbody>${t.map((x) => `<tr><td><a href="#/task/${x.id}">${esc(x.n)}</a></td><td>${tLink(x.target)}</td><td>${esc(x.wf)}</td><td>${sla(x.due)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing assigned to you. Take something from a queue.</p>';
  const queues = q.map((x) => { const it = queueItems(x); return `<div class="field"><span style="flex:1"><a href="#/queue/${x.id}">${esc(x.n)}</a> <span class="badge">${x.pp}</span></span><strong>${it.length}</strong></div>`; }).join('');
  const recent = (RECENT[S.persona] || []).map((id) => { const [l, s, icon] = recLink(id); return `<li>${ic(icon)}<div>${l}<div class="muted">${s}</div></div><span></span></li>`; }).join('');
  return head(`Good morning, ${esc(p.n.split(' ')[0])}`, `${esc(p.role)} · Friday 21 November 2026 · the cards, queues and menu on this page come from the rules for your group.`, ['s3', 'ootb', 'd11']) +
    `<div class="kpis">${kpis()}</div>
    <div class="split"><div>
      <div class="card"><div class="row sp"><h2>My tasks</h2><span class="muted">${t.length} open</span></div>${tasks}</div>
      <div class="card"><h2>My queues</h2>${queues}</div>
    </div><div>
      <div class="card ai"><h2>${ic('ai')}Today, in short</h2><p>${esc(aiBrief())}</p><p class="muted" style="margin:0">Needs the AI package, which is off today. Shown so the place is designed in (section 5, AI on the record).</p></div>
      <div class="card"><h2>Recently worked</h2><ul class="tl">${recent}</ul></div>
    </div></div>` +
    (me().kit === 'dam' ? note('<strong>Plan:</strong> the same home as the claims app, from another starter kit (section 14). The cards, queues and menu come from the rules for each group: the brand team, creative review, and an outside licensor who sees only what was sent to it.') : '') +
    (me().kit === 'dam' ? '' : note('<strong>Plan:</strong> a home per group (Step 3). Change “Viewing as” in the header to see an adjuster, a supervisor, a case specialist and member services get different cards, queues and menus from one configuration, through rules on each card (section 11, disagreement 1).'));
};
function aiBrief() {
  if (me().kit === 'dam') return damBrief();
  const g = me().groups;
  if (g.includes('claims-supervisors')) return 'CLAIM-000141 ($15,880) is pended for medical records and waits for your approval tomorrow. One claim on the team is past its determination date.';
  if (g.includes('claims-adjusters')) return 'You have 2 claims to determine. CLAIM-000143 is 2 days overdue. CLAIM-000131 is flagged: the knee replacement is billed at 2.4 times this provider’s average. Two new claims are unassigned.';
  if (g.includes('appeals')) return 'CASE-2041 has 11 days left on its regulatory deadline and is missing medical records and a provider statement. An appeal letter in the inbox matches it.';
  return 'One member callback is due today: John Smith, about a pharmacy charge from January.';
}

// ---- a queue: a page provider, typed columns, row actions and bulk actions
P.queue = (r) => {
  const q = QUEUES.find((x) => x.id === r[1]);
  if (!q) return P.notFound();
  if (!inGroup(q.groups)) return head(esc(q.n)) + `<div class="banner warn">${ic('lock')}This queue is shown to ${q.groups.join(', ')}. You are viewing as ${esc(me().n)}.</div>`;
  const it = queueItems(q), sel = S.sel;
  for (const picked of [...sel]) if (!it.some((x) => x.id === picked)) sel.delete(picked);
  const bulk = sel.size ? `<div class="banner"><strong>${sel.size} selected</strong><span class="gap"></span><button class="sm tonal" data-act="bulk-assign">${ic('reassign', 1)}Assign</button><button class="sm tonal" data-act="bulk-all" data-n="${it.length}">${ic('bolt_circle', 1)}Update all ${it.length} results</button><button class="sm" data-act="csv">${ic('download', 1)}Export CSV</button></div>` : '';
  let table;
  if (q.of === 'claim') {
    table = `<table><thead><tr><th><span class="sr">Select</span></th><th>Claim</th><th>Member</th><th>Provider</th><th class="num">Billed</th><th>State</th><th>Received</th><th>Determination</th><th>Assignee</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${it.map((c) => `<tr class="${sel.has(c.id) ? 'sel' : ''}"><td><input type="checkbox" data-act="pick" data-id="${c.id}" ${sel.has(c.id) ? 'checked' : ''} aria-label="Select ${c.id}"></td><td>${cLink(c.id)}${c.flag ? ` <span class="badge" title="${esc(c.flag)}">${ic('flag', 1)}Flag</span>` : ''}</td><td>${mLink(c.member)}</td><td>${pLink(c.provider)}</td><td class="num">${money(c.billed)}</td><td>${claimState(c.state)}</td><td>${d8(c.rcvd)}</td><td>${sla(c.due)}</td><td>${who(c.assignee)}</td><td>${c.assignee ? `<button class="sm link" data-act="assign" data-id="${c.id}">Reassign</button>` : `<button class="sm tonal" data-act="take" data-id="${c.id}">Take it</button>`}</td></tr>`).join('')}</tbody></table>`;
  } else if (q.of === 'case') {
    table = `<table><thead><tr><th>Case</th><th>Type</th><th>Member</th><th>Claim</th><th>State</th><th>Received</th><th>Regulatory deadline</th><th>Missing</th><th>Assignee</th></tr></thead><tbody>${it.map((c) => `<tr><td>${kLink(c.id)}</td><td>${esc(c.type)}</td><td>${mLink(c.member)}</td><td>${cLink(c.claim)}</td><td>${caseState(c.state)}</td><td>${d8(c.rcvd)}</td><td>${sla(c.due)}</td><td>${c.checklist.filter((x) => !x[1]).length} documents</td><td>${who(c.assignee)}</td></tr>`).join('')}</tbody></table>`;
  } else if (q.of === 'asset') {
    // The open task on each asset says who has it now.
    const task = (aid) => Object.values(TASKS).find((t) => t.target === aid && !t.done);
    table = `<table><thead><tr><th><span class="sr">Preview</span></th><th>Asset</th><th>Product</th><th>State</th><th>Rights</th><th>Live in</th><th>With</th></tr></thead><tbody>${it.map((x) => { const t = task(x.id); return `<tr><td><span class="mini ${x.kind}">${damArt(x)}</span></td><td>${me().external ? esc(x.n) : aLink(x.id)}</td><td>${esc(PRODUCTS[x.product].n)}</td><td>${assetState(x.state)}</td><td>${rightsBadge(x)}</td><td>${x.usage.length ? x.usage.map((u) => esc(u[0])).join(', ') : '<span class="muted">Nowhere</span>'}</td><td>${t ? `<a href="#/task/${Object.keys(TASKS).find((k) => TASKS[k] === t)}">${esc(t.n)}</a><br>${who(t.who)}` : '<span class="muted">No open task</span>'}</td></tr>`; }).join('')}</tbody></table>`;
  } else {
    table = `<table><thead><tr><th>Product</th><th>Style</th><th>Launch</th><th class="num">Shots approved</th><th>Missing</th></tr></thead><tbody>${it.map((x) => { const st = shotStatus(x.id); return `<tr><td>${prLink(x.id)}</td><td>${esc(x.style)}</td><td>${d8(x.launch)}</td><td class="num">${st.filter((s) => s.status === 'ok').length} of ${st.length}</td><td>${x.colorways.map((cw) => { const m = missingShots(x.id).filter((s) => s.colorway === cw).map((s) => s.shot); return m.length ? `<strong>${esc(cw)}:</strong> ${m.map(esc).join(', ')}` : ''; }).filter(Boolean).join('<br>')}</td></tr>`; }).join('')}</tbody></table>`;
  }
  const facets = q.of === 'asset' || q.of === 'product' ? [] : q.of === 'claim' ? [['State', [...new Set(it.map((c) => CLAIM_STATE_LABEL[c.state]))]], ['Provider', [...new Set(it.map((c) => PROVIDERS[c.provider].n))]], ['Billed', ['Under $1,000', '$1,000 to $5,000', 'Over $5,000']]] : [['Type', ['Appeal', 'Grievance']], ['Missing documents', ['Yes', 'No']]];
  return head(esc(q.n), `${it.length} item${it.length === 1 ? '' : 's'} · page provider <code>${q.pp}</code> · shown to ${q.groups.join(', ')}`, ['s3', 's5', 'b5']) +
    `<div class="row" style="margin-bottom:12px">${facets.map(([f, vals]) => `<label class="f" style="margin:8px 0;width:220px"><span>${f}</span><select aria-label="${f}"><option>Any</option>${vals.map((v) => `<option>${esc(v)}</option>`).join('')}</select></label>`).join('')}</div>${bulk}<div class="card" style="padding:4px 8px">${it.length ? table : '<p class="muted" style="padding:16px">The queue is empty.</p>'}</div>` +
    (q.of === 'asset' || q.of === 'product' ? note('<strong>Plan:</strong> the same queue as the claims app (Step 3): a server page provider, typed columns and the open task. For assets the columns are a preview, the lifecycle state, the rights badge and where the asset is live.') : '') +
    (q.of === 'asset' || q.of === 'product' ? '' : note('<strong>Plan:</strong> a work queue is a server page provider plus typed columns plus actions (Step 3). <em>Take it</em> and <em>Assign</em> are row actions; <em>Update all results</em> runs over the whole query through the Bulk Action Framework, not just the rows on screen (section 5).'));
};

// ---- record lists, generated from each type's schemas unless a layout names the columns (Step 1)
P.members = () => head('Members', 'Generated list for the Member type, with a computed age and a combined name.', ['s1', 'ootb']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Member ID</th><th>Name</th><th class="num">Age</th><th>Plan</th><th>Primary care</th><th>Status</th></tr></thead><tbody>${Object.entries(MEMBERS).map(([id, m]) => `<tr><td>${id}</td><td>${mLink(id)}</td><td class="num">${ageOf(m.dob)}</td><td>${esc(m.plan)}</td><td>${esc(m.pcp)}</td><td><span class="st ok">Active</span></td></tr>`).join('')}</tbody></table></div>`;
P.claims = (r) => {
  const st = CLAIM_STATE_LABEL[r[1]] ? r[1] : null;
  const list = Object.entries(CLAIMS).filter(([, c]) => !st || c.state === st);
  return head(st ? `Claims · ${CLAIM_STATE_LABEL[st]}` : 'Claims', st ? `${list.length} claim${list.length === 1 ? '' : 's'} in this state, opened from Reports. <a href="#/claims">Show all claims</a>` : 'Every claim, with typed columns: money, state, dates and links to the member and provider.', ['s1', 'ootb']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Claim</th><th>Member</th><th>Provider</th><th class="num">Billed</th><th class="num">Paid</th><th>Service date</th><th>State</th><th>Assignee</th></tr></thead><tbody>${list.map(([id, c]) => `<tr><td>${cLink(id)}</td><td>${mLink(c.member)}</td><td>${pLink(c.provider)}</td><td class="num">${money(c.billed)}</td><td class="num">${money(c.paid)}</td><td>${d8(c.svc)}</td><td>${claimState(c.state)}</td><td>${who(c.assignee)}</td></tr>`).join('')}</tbody></table></div>`;
};
P.cases = () => head('Cases', 'Cases are folders on the server, but open as records here, not in a file browser.', ['s1', 'b5']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Case</th><th>Title</th><th>Type</th><th>Member</th><th>State</th><th>Deadline</th><th>Assignee</th></tr></thead><tbody>${Object.entries(CASES).map(([id, c]) => `<tr><td>${kLink(id)}</td><td>${esc(c.title)}</td><td>${c.type}</td><td>${mLink(c.member)}</td><td>${caseState(c.state)}</td><td>${sla(c.due)}</td><td>${who(c.assignee)}</td></tr>`).join('')}</tbody></table></div>`;
P.providers = () => head('Providers', 'No layout file ships for Provider, so this list and its page are generated from the provider schema.', ['ootb', 's1']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Name</th><th>NPI</th><th>Specialty</th><th>City</th><th>Network</th></tr></thead><tbody>${Object.entries(PROVIDERS).map(([id, p]) => `<tr><td><a href="#/provider/${id}">${esc(p.n)}</a></td><td>${p.npi}</td><td>${p.spec}</td><td>${p.city}</td><td>${p.net}</td></tr>`).join('')}</tbody></table></div>`;
