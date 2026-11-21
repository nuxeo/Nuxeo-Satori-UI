// Builder pages for presales: the agent, the data model, and the record layout designer (Steps 1, 2, 6).
const AGENT = [
  { me: 'Build a claims app on the Payers demo server.', a: 'I’m connected to payers-demo.example (Nuxeo LTS 2025, dev mode on). I’ll start by reading the data model.', tools: ['nuxeo.model.read'] },
  { a: 'Found 5 document types, 9 page providers, 3 workflows and 5 vocabularies.\n• Member, Claim and Provider have no file, so they get record pages, not the file viewer.\n• Case is a folder: I’ll open it as a record with a Documents tab.\n• Claim points at Member and Provider, so their pages can list the claims that point at them.', tools: ['nuxeo.pageProviders.list', 'nuxeo.workflows.list'] },
  { me: 'Adjusters work claims. Supervisors approve anything over $5,000. Appeals specialists work appeal cases within 30 days. Member services answer calls and must not see HICN or Medicare ID.', a: 'Then I propose 4 groups, 5 queues, 3 record pages, 2 task forms and 6 actions. Member services gets a masking rule on HICN and Medicare ID. I’m writing the configuration package now.', tools: ['satori.ids.list', 'satori.schema.get'] },
  { a: 'Package written. Checks: the build.mjs checks pass, every ID I used is registered, and every operation is on the allow-list. One warning: Provider has no layout, so its page is generated from the schema.', tools: ['satori.package.validate'] },
  { a: 'It’s live in dev mode, no restart needed. Open the app and try “Viewing as” for each group.', tools: ['satori.preview.url'], link: '#/home' },
  { me: 'Show the age next to the date of birth, and make the denial reason required when a claim is denied.', a: 'Done. Two changes to the draft:\n+ Member/view: member:dob uses the computation “age from a date”\n+ Claim determination task: denialReason is required when decision = deny', tools: ['satori.package.validate'] },
  { me: 'Publish it to pre-prod.', a: 'Built payers-claims-1.0.1.zip (sha256 3f9c…) and published it to the pre-production Marketplace. On a server: nuxeoctl mp-install payers-claims-1.0.1.zip, then restart.', tools: ['marketplace.publish'] },
];
const FILES = [
  [2, 'bundle/agentic-ui-config/manifest.json', 'navigation, queues, home cards, rules'],
  [2, 'bundle/agentic-ui-config/layouts/Member/view.layout.json', 'cards, age, combined address, related claims and cases'],
  [2, 'bundle/agentic-ui-config/layouts/Claim/view.layout.json', 'summary, service lines, documents'],
  [2, 'bundle/agentic-ui-config/layouts/Claim/edit.layout.json', 'read-only when paid or closed'],
  [2, 'bundle/agentic-ui-config/layouts/Case/view.layout.json', 'checklist, timeline, documents tab'],
  [2, 'bundle/agentic-ui-config/tasks/claimDetermination.Determine.layout.json', 'decision, allowed amount, denial reason'],
  [2, 'bundle/agentic-ui-config/actions.json', 'lifecycle buttons, request records, letters'],
  [2, 'bundle/agentic-ui-config/bootstrap.json', 'Acme Health branding'],
  [3, 'package/package.xml', 'depends on nuxeo-agentic-ui'],
];
P['build/agent'] = () => {
  const n = S.agentStep, shown = AGENT.slice(0, n + 1);
  const chat = shown.map((s) => (s.me ? `<div class="msg me"><span class="who">${BUILDER.n}</span>${esc(s.me)}</div>` : '') + `<div class="msg"><span class="who">App builder agent</span>${esc(s.a)}${s.link ? `<br><a href="${s.link}" ${asLink(s.link)}>Open the app</a>` : ''}</div>`).join('');
  const called = new Set(shown.flatMap((s) => s.tools));
  const tools = [['nuxeo.model.read', 'Types, schemas, facets, references, lifecycles'], ['nuxeo.pageProviders.list', 'Server searches the UI can use'], ['nuxeo.workflows.list', 'Workflows, steps and their variables'], ['satori.ids.list', 'Registered IDs a manifest can address'], ['satori.schema.get', 'JSON schemas for manifest and layouts'], ['satori.package.validate', 'The build.mjs checks, plus IDs and allow-list'], ['satori.preview.url', 'Dev-mode preview, no restart'], ['marketplace.publish', 'Pre-production Marketplace only']];
  return head('App builder agent', 'Describe the work; the agent reads the model and writes the configuration package. You review, preview and publish.', ['s6', 's7', 'dec']) +
    `<div class="split"><div class="card"><div class="chat" aria-live="polite">${chat}</div>
      <div class="row" style="margin-top:12px"><label class="f" style="flex:1;margin:0"><span>Message</span><input type="text" value="${n + 1 < AGENT.length ? esc(AGENT[n + 1].me || 'Continue') : 'Done'}" readonly></label><button class="primary" data-act="agent-next" ${n + 1 >= AGENT.length ? 'disabled' : ''}>${ic('send', 1)}Send</button><button data-act="agent-reset">Start over</button></div>
      <p class="help" style="margin-left:0">Scripted for the prototype: each Send plays the next turn.</p></div>
    <div><div class="card"><h2>${ic('bundle', 1)} payers-claims package</h2><div class="tree">${n >= 2 ? FILES.filter((f) => n >= f[0]).map((f) => `<div class="new" title="${esc(f[2])}">+ ${esc(f[1])}</div>`).join('') : '<span class="muted">Nothing written yet.</span>'}</div></div>
      <div class="card"><h2>Checks</h2><div class="checks">${n >= 3 ? `<div>${ic('circle_check', 1)}build.mjs: 14 checks passed</div><div>${ic('circle_check', 1)}Registered IDs: 31 used, 0 unknown</div><div>${ic('circle_check', 1)}Operations on the allow-list: 3 of 3</div><div>${ic('info', 1)}Provider: generated page (no layout)</div>` : '<span class="muted">Run after the package is written.</span>'}</div></div>
      <div class="card"><h2>MCP tools</h2>${tools.map(([t, d]) => `<div class="field">${ic(called.has(t) ? 'circle_check' : 'circle_dot', 1)}<span style="flex:1"><code>${t}</code><br><span class="muted">${d}</span></span></div>`).join('')}</div></div></div>` +
    note('<strong>Plan:</strong> Step 6. The agent runs in the coding tools presales already use, through a skill and an MCP server. It writes the same package a developer or the in-app designer would, so the three never diverge. It uses a development server; the in-app assistant in the designer prototype serves administrators in production (section 11).');
};

// ---- the data model as the server reports it, and what the UI does with each type by default
P['build/model'] = () => head('Data model', 'Read from the server: types, schemas, references, lifecycles, workflows, page providers and vocabularies. The UI follows it; it does not edit it.', ['s1', 'ootb']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>Type</th><th>File</th><th>Schemas</th><th>Points at</th><th>Pointed at by</th><th>Lifecycle</th><th>Opens as</th><th>Layout</th><th>In the menu</th></tr></thead><tbody>${MODEL.map((m) => `<tr><td><strong>${m.t}</strong>${m.folder ? ' <span class="badge">folder</span>' : ''}</td><td>${m.file ? 'Yes' : 'No'}</td><td>${m.schemas.map((s) => `<code>${s}</code>`).join(', ')}</td><td>${m.refs.join('<br>') || '—'}</td><td>${m.refBy.join('<br>') || '—'}</td><td>${esc(m.lc)}</td><td>${m.folder ? `<select aria-label="${m.t} opens as"><option>Record</option><option>Folder</option></select>` : m.file ? 'File viewer' : 'Record'}</td><td><span class="badge ${m.layout === 'contributed' ? 'c' : ''}">${m.layout === 'contributed' ? 'From the kit' : 'Generated'}</span></td><td><label class="sw"><input type="checkbox" ${m.t !== 'ClaimDocument' ? 'checked' : ''} aria-label="${m.t} in the menu"><span class="sr">In the menu</span></label></td></tr>`).join('')}</tbody></table></div>
  <div class="grid3"><div class="card"><h2>Page providers</h2>${PAGE_PROVIDERS.map((p) => `<div><code>${p}</code></div>`).join('')}</div><div class="card"><h2>Workflows</h2>${WORKFLOWS.map(([n, d]) => `<p><strong>${n}</strong><br><span class="muted">${d}</span></p>`).join('')}</div><div class="card"><h2>Vocabularies</h2>${VOCABS.map(([n, c]) => `<div class="row sp"><code>${n}</code><span class="muted">${c} entries</span></div>`).join('')}</div></div>` +
  note('<strong>Plan:</strong> Step 1. Types, schemas, facets, vocabularies, workflow models and page provider definitions come from the REST API today (checked on Nuxeo 2025). Only the lifecycle transitions a document allows need a small enricher in <code>nuxeo-agentic-core</code>. <a href="#/start/feasibility">Feasibility</a>.');

// ---- layout designer v2: widgets, registered computations, field rules, related records (Step 2, section 11)
const WIDGETS = ['Text', 'Long text', 'Number', 'Currency', 'Percent', 'Date', 'Relative date', 'Phone', 'Email', 'Address', 'Contact block', 'User or group', 'Vocabulary', 'Document link', 'Chips', 'Status badge', 'Yes or no', 'Image', 'File list', 'Related records'];
const COMPUTE = ['None', 'Age from a date', 'Text template', 'Sum', 'Count', 'Days between two dates', 'Condition'];
const LAYOUTS = {
  Member: [
    { t: 'Member info', f: [['member:id', 'Member ID', 'Text'], ['member:dob', 'Date of birth', 'Date', 'Age from a date'], ['member:hicn', 'HICN', 'Text', '', 'member-services'], ['member:medicare', 'Medicare ID', 'Text', '', 'member-services'], ['contact', 'Contact', 'Contact block', 'Text template'], ['address', 'Address', 'Address', 'Text template'], ['member:plan', 'Plan', 'Vocabulary']] },
    { t: 'Claims', rel: ['claims_for_member', 'member = ${record.uid}', 'Claim ID, Amount, Provider, Provider NPI, Service date, State', 'Service date, newest first'] },
    { t: 'Cases', rel: ['cases_for_member', 'member = ${record.uid}', 'ID, Type, Claim, Received, State, Determination', 'Received, newest first'] },
  ],
  Claim: [
    { t: 'Claim summary', f: [['claim:member', 'Member', 'Document link'], ['claim:provider', 'Provider', 'Document link'], ['claim:billed', 'Billed', 'Currency'], ['claim:allowed', 'Allowed', 'Currency'], ['claim:denialReason', 'Denial reason', 'Vocabulary', 'Condition'], ['ecm:currentLifeCycleState', 'State', 'Status badge']] },
    { t: 'Service lines', f: [['claim:lines', 'Lines', 'Related records'], ['total', 'Total', 'Currency', 'Sum']] },
    { t: 'Cases about this claim', rel: ['cases_for_claim', 'claim = ${record.uid}', 'Case, Title, State', 'Received, newest first'] },
  ],
  Case: [
    { t: 'Required documents', f: [['case:checklist', 'Checklist', 'File list']] },
    { t: 'Documents', rel: ['children', 'parent = ${record.uid}', 'Name, Category, Size', 'Name'] },
    { t: 'Timeline', f: [['timeline', 'Timeline', 'Relative date']] },
  ],
};
P['build/layout'] = () => {
  const type = S.layoutType, L = LAYOUTS[type];
  const fields = L ? L.flatMap((c) => c.f || []) : [];
  const cur = fields.find((x) => x[0] === S.layoutField) || fields[0];
  const canvas = L ? L.map((c) => `<div class="sec"><strong>${esc(c.t)}${c.rel ? ' <span class="badge c">Related records</span>' : ''}</strong>${c.rel ? `<dl class="side-kv"><dt>Query</dt><dd><code>${c.rel[0]}</code> where <code>${esc(c.rel[1])}</code></dd><dt>Columns</dt><dd>${esc(c.rel[2])}</dd><dt>Sort</dt><dd>${esc(c.rel[3])}</dd></dl>` : (c.f || []).map((f) => `<div class="field ${cur && f[0] === cur[0] ? 'sel' : ''}"><button class="link" data-act="lf" data-f="${f[0]}" style="flex:1;justify-content:flex-start">${esc(f[1])}</button><span class="badge">${esc(f[2])}</span>${f[3] && f[3] !== 'None' ? `<span class="badge c">${ic('calculated_field', 1)}${esc(f[3])}</span>` : ''}${f[4] ? `<span class="badge">${ic('view_off', 1)}masked</span>` : ''}</div>`).join('')}</div>`).join('') : `<div class="banner">${ic('info')}No layout file for ${type}: the page is generated from its schema. <button class="sm tonal" data-act="toast" data-msg="Generated a view layout for Provider from its schema">Generate one to refine</button></div>`;
  const insp = cur ? `<label class="f"><span>Label</span><input type="text" value="${esc(cur[1])}"></label>
    <label class="f"><span>Widget</span><select>${WIDGETS.map((w) => `<option ${w === cur[2] ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
    <label class="f"><span>Computed value (registered computations only)</span><select>${COMPUTE.map((w) => `<option ${w === (cur[3] || 'None') ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
    ${cur[3] === 'Text template' ? `<label class="f"><span>Template</span><input type="text" value="${cur[0] === 'address' ? '{street}\\n{city}, {state} {zip}' : '{first} {last}\\n{phone}\\n{email}'}"></label>` : ''}
    ${cur[3] === 'Condition' ? `<div class="sent" style="background:var(--mat-sys-surface-container);border-radius:8px;padding:8px 12px">Shown when the claim state is Denied.</div>` : ''}
    <div class="f"><span>Mask for groups</span><div class="chk">${['member-services', 'claims-adjusters', 'appeals'].map((g) => `<label><input type="checkbox" ${cur[4] === g ? 'checked' : ''}>${g}</label>`).join('')}</div></div>
    <div class="f"><span>Read-only when the state is</span><div class="chk">${['paid', 'closed'].map((s) => `<label><input type="checkbox" ${type === 'Claim' ? 'checked' : ''}>${s}</label>`).join('')}</div></div>` : '<p class="muted">Select a field.</p>';
  const json = L ? JSON.stringify({ version: 2, type, mode: 'view', cards: L.map((c) => (c.rel ? { title: c.t, widget: 'relatedRecords', pageProvider: c.rel[0], parameters: c.rel[1] } : { title: c.t, fields: c.f.map((f) => Object.assign({ field: f[0], widget: f[2] }, f[3] && f[3] !== 'None' ? { compute: f[3] } : {}, f[4] ? { maskFor: [f[4]] } : {})) })) }, null, 2) : '';
  return head('Record layouts', 'Design what a record page shows: cards in the main area, named widgets, computed values and related records.', ['s2', 'd11', 'qw']) +
    `<div class="row" style="margin-bottom:12px"><label class="f" style="width:220px;margin:8px 0"><span>Document type</span><select data-act="ltype">${['Member', 'Claim', 'Case', 'Provider'].map((t) => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="f" style="width:180px;margin:8px 0"><span>Mode</span><select><option>view</option><option>edit</option><option>create</option><option>metadata</option></select></label><span class="gap"></span><a href="#/${type === 'Member' ? 'member/MEMBER-100048' : type === 'Claim' ? 'claim/CLAIM-000131' : type === 'Case' ? 'case/CASE-2041' : 'provider/PRV-203'}" ${asLink('#/' + (type === 'Member' ? 'member/MEMBER-100048' : type === 'Claim' ? 'claim/CLAIM-000131' : type === 'Case' ? 'case/CASE-2041' : 'provider/PRV-203'))}><button>${ic('view', 1)}Preview on a real record</button></a></div>
    <div class="split3"><div class="card"><h2>Widgets</h2>${WIDGETS.map((w) => `<div class="field">${esc(w)}</div>`).join('')}</div><div class="card"><h2>${type}, view mode</h2>${canvas}</div><div class="card"><h2>Field</h2>${insp}</div></div>
    ${json ? `<div class="card"><h2>${ic('code', 1)} The JSON this writes</h2><pre>${esc(json)}</pre></div>` : ''}` +
    note('<strong>Plan:</strong> layout file version 2 (Step 2), and what section 11 says the designer prototype should add: cards in the main area, related records that pass the open record to the query, computed and combined fields, field rules and masking. Computations are a registered list, like rules, so there is no JavaScript in configuration (parity decision 2).');
};
