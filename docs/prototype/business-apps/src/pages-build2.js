// Builder pages: queues and home per group, actions with parameters, starter kits, Studio bridge.
const GROUPS = ['claims-adjusters', 'claims-supervisors', 'appeals', 'member-services'];
const HOME_CARDS = [
  ['KPI tiles', 'Counts and sums from page-provider aggregates', GROUPS],
  ['My tasks', 'Tasks assigned to me, with due dates', GROUPS],
  ['My queues', 'The queues my groups may see', GROUPS],
  ['Today, in short (AI)', 'Needs the AI package', ['claims-adjusters', 'claims-supervisors', 'appeals']],
  ['Recently worked', 'Records I opened or changed', GROUPS],
  ['Team overdue', 'Claims past their determination date', ['claims-supervisors']],
];
P['build/queues'] = () => head('Queues and home', 'Queues are server searches plus columns plus actions. Home cards and menu entries carry the same “shown when” rules as buttons.', ['s3', 'd11', 'qw']) +
  `<div class="card"><div class="row sp"><h2>Queues</h2><button class="sm tonal" data-act="toast" data-msg="New queue added to the draft">${ic('plus_large', 1)}Add queue</button></div><table><thead><tr><th>Queue</th><th>Page provider</th><th>Columns</th><th>Row actions</th><th>Shown when the user is in</th></tr></thead><tbody>${QUEUES.filter((q) => !q.kit).map((q) => `<tr><td><a href="#/queue/${q.id}" ${asLink('#/queue/' + q.id)}>${esc(q.n)}</a></td><td><select aria-label="Page provider for ${esc(q.n)}">${PAGE_PROVIDERS.map((p) => `<option ${p === q.pp ? 'selected' : ''}>${p}</option>`).join('')}</select></td><td>${q.of === 'claim' ? 'Claim, Member, Provider, Billed, State, Due, Assignee' : 'Case, Type, Member, Deadline, Missing'}</td><td>${q.of === 'claim' ? 'Take it, Assign, Update all results' : 'Open, Request documents'}</td><td>${q.groups.map((g) => `<span class="badge">${g}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h2>Home cards by group</h2><table><thead><tr><th>Card</th>${GROUPS.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody>${HOME_CARDS.map(([n, d, gs]) => `<tr><td><strong>${esc(n)}</strong><br><span class="muted">${esc(d)}</span></td>${GROUPS.map((g) => `<td><input type="checkbox" ${gs.includes(g) ? 'checked' : ''} aria-label="${esc(n)} for ${g}" style="width:18px;height:18px;accent-color:var(--mat-sys-primary)"></td>`).join('')}</tr>`).join('')}</tbody></table>
  <div class="sent" style="background:var(--mat-sys-surface-container);border-radius:8px;padding:8px 12px;margin-top:12px">“Team overdue” is shown when the user is in claims-supervisors.</div></div>
  <div class="card"><h2>Navigation</h2>${[['My work', 'everyone'], ['Queues', 'per queue rule'], ['Members, Claims, Cases, Providers', 'business types marked in Data model'], ['Inbox', 'claims-adjusters, appeals'], ['Reports', 'claims-supervisors, appeals'], ['Documents (ECM)', 'hidden by default']].map(([n, r]) => `<div class="field"><span style="flex:1">${esc(n)}</span><span class="muted">${esc(r)}</span></div>`).join('')}</div>` +
  note('<strong>Plan:</strong> Step 3, and the answer to disagreement 1 in section 11. The designer’s decision keeps one configuration for everyone; putting rules on dashboard cards and menu entries, as it already does on buttons, still gives each group its own home.');

const ACTIONS = [
  { n: 'Lifecycle buttons', where: 'Record header', how: 'Generated from claimLifecycle', params: 'Allowed transitions from the current state', confirm: 'Only for Deny', ok: '“Claim moved to {state}”', when: 'Write permission on the claim' },
  { n: 'Request medical records', where: 'Record header', how: 'Automation chain Claim.RequestMedicalRecords', params: 'recipient = ${record.claim:provider}, dueInDays = 14', confirm: '“Send a records request to {provider}?”', ok: '“Request sent, due {date}”', when: 'Claim or Case, in review or pended, claims-adjusters or appeals' },
  { n: 'Generate letter', where: 'Record header', how: 'Automation chain Letter.Generate (Template Rendering)', params: 'template from the letterTemplate vocabulary, attach to the record', confirm: 'Template picker', ok: '“Letter added to Documents”', when: 'Member, Claim or Case' },
  { n: 'Take it', where: 'Queue rows', how: 'Registered action app.actions.assignToMe', params: '—', confirm: 'None (undo instead)', ok: '“Assigned to you”', when: 'Unassigned, claims-adjusters' },
  { n: 'Update all results', where: 'Queue selection', how: 'Bulk Action Framework, setProperties', params: 'The queue’s whole query, the chosen property values', confirm: '“Update 184 claims?”', ok: 'Progress, then a summary', when: 'claims-supervisors' },
];
P['build/actions'] = () => head('Actions', 'Buttons that run business logic on the server, with parameters, a confirmation, a success message and a refresh.', ['s5', 's4', 'd11']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Action</th><th>Where</th><th>Runs</th><th>Parameters</th><th>Confirmation</th><th>Success message</th><th>Shown when</th></tr></thead><tbody>${ACTIONS.map((a) => `<tr><td><strong>${esc(a.n)}</strong></td><td>${esc(a.where)}</td><td>${esc(a.how)}</td><td><code>${esc(a.params)}</code></td><td>${esc(a.confirm)}</td><td>${esc(a.ok)}</td><td>${esc(a.when)}</td></tr>`).join('')}</tbody></table></div>
  <div class="grid2"><div class="card"><h2>Request medical records</h2>
    <label class="f"><span>Operation (allow-listed)</span><select><option>Claim.RequestMedicalRecords</option><option>Letter.Generate</option><option>Document.FollowLifecycleTransition</option></select></label>
    <label class="f"><span>Parameter: recipient</span><input type="text" value="\${record.claim:provider}"></label><label class="f"><span>Parameter: dueInDays</span><input type="number" value="14"></label>
    <label class="f"><span>Confirmation</span><input type="text" value="Send a records request to {provider}?"></label><label class="f"><span>Success message</span><input type="text" value="Request sent, due {date}"></label>
    <label class="f"><span>After it runs</span><select><option>Refresh the record and its timeline</option><option>Go to the next item in the queue</option></select></label>
    <div class="banner warn">${ic('lock')}The server still checks permission when this runs. Hiding the button is not a control.</div></div>
  <div class="card"><h2>Operation allow-list</h2>${['Claim.RequestMedicalRecords', 'Letter.Generate', 'Document.FollowLifecycleTransition', 'Bulk.RunAction'].map((o) => `<div class="field">${ic('lock', 1)}<code style="flex:1">${o}</code></div>`).join('')}<p class="muted">Configuration can only bind a button to an operation on this list (designer decision 3).</p></div></div>` +
  note('<strong>Plan:</strong> Step 5 changes today’s rule that configuration can only place actions already in code, so it is decision 3 in section 9. The behaviour lives on the server, in Studio, under server permissions. Section 11 lists what the designer prototype still needs here: parameters, confirmation, success message and refresh.');

P['build/kits'] = () => head('Starter kits', 'Installable business apps: a data model, a configuration package, demo data and a demo script.', ['s7', 'ootb']) +
  `<div class="grid2">${KITS.map((k) => `<div class="card"><div class="row sp"><h2>${ic(k.icon, 1)} ${esc(k.n)}</h2>${k.installed ? `<span class="st ok">Installed ${k.v}</span>` : `<span class="badge">${k.v}</span>`}</div>
    <dl class="side-kv"><dt>Data model</dt><dd>${k.types.map((t) => `<code>${t}</code>`).join(', ')}</dd><dt>Configuration</dt><dd>${k.cfg.map(esc).join(' · ')}</dd><dt>Demo data</dt><dd>${esc(k.data)}</dd><dt>Demo script</dt><dd><ol style="margin:0;padding-left:18px">${k.script.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></dd></dl>
    <div class="row">${k.installed ? `<a href="#/home" data-act="go-app" data-id="${k.app}"><button class="tonal">Open the app</button></a>` + '<button data-act="toast" data-msg="Demo data reset to its starting state">Reset demo data</button>' : `<button class="tonal" data-act="toast" data-msg="${esc(k.n)} installed on payers-demo.example">Install on the demo server</button>`}</div></div>`).join('')}</div>` +
  note('<strong>Plan:</strong> Step 7. Payers and claims comes first because presales already has the model and the demo. The designer prototype’s “Legal team starter” template is UI configuration only; a kit also carries the model, demo data and the script.');

const BRIDGE = [
  ['nuxeo-member-view-layout.html', 'layouts/Member/view.layout.json', 'Translated', '7 fields, 2 tables'],
  ['payers-age (custom element)', 'Computation “Age from a date”', 'Check it', 'Matched by what it renders'],
  ['nuxeo-data-table on claims_for_member', 'Related-records widget', 'Translated', 'Parameter: member = this record'],
  ['nuxeo-claim-edit-layout.html', 'layouts/Claim/edit.layout.json', 'Check it', '2 dom-if blocks became field rules'],
  ['nuxeo-operation-button “Request records”', 'Action bound to Claim.RequestMedicalRecords', 'Translated', 'Needs the operation on the allow-list'],
  ['Filter: user.isMember("legal")', 'Rule isMemberOf(legal)', 'Translated', ''],
  ['HTML block with an inline script', '—', 'Not supported', 'No free code in configuration'],
];
P['build/bridge'] = () => head('Studio bridge', 'Bring existing Studio Designer work across: the agent translates Web UI layouts into layout files you review.', ['s8']) +
  `<div class="banner warn">${ic('info')}Later, and not checked: where Studio Designer files can be read from without the Studio API. The data model needs no bridge; it is already on the server.</div>
  <div class="card" style="padding:4px 8px"><table><thead><tr><th>Found in the Studio project</th><th>Becomes</th><th>Status</th><th>Notes</th></tr></thead><tbody>${BRIDGE.map(([a, b, s, n]) => `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td><td><span class="st ${s === 'Translated' ? 'ok' : s === 'Check it' ? 'warn' : 'bad'}">${s}</span></td><td>${esc(n)}</td></tr>`).join('')}</tbody></table></div>` +
  note('<strong>Plan:</strong> Step 8. Anything that cannot be expressed as registered widgets, computations, rules and allow-listed operations is reported, not copied.');
