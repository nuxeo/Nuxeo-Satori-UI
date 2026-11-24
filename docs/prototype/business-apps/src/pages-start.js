// The guide: what this is, the glossary, a demo path, the plan map, the gaps and the decisions.
const PAGES = [
  ['App', '#/home', 'My work (home per group)', ['s3', 'ootb']],
  ['App', '#/queue/unassigned', 'Work queue with row and bulk actions', ['s3', 's5', 'b5']],
  ['App', '#/member/MEMBER-100048', 'Member record page', ['qw', 's1', 's2']],
  ['App', '#/claim/CLAIM-000131', 'Claim record page with lifecycle and actions', ['s2', 's4', 's5']],
  ['App', '#/task/T-501', 'Task form from workflow variables', ['s4', 's2']],
  ['App', '#/case/CASE-2041', 'Case as a record: checklist, timeline, hold', ['s1', 'b5']],
  ['App', '#/provider/PRV-203', 'Generated page, no layout file', ['ootb']],
  ['App', '#/inbox', 'Inbound capture and classification', ['b5']],
  ['App', '#/search', 'Business search', ['s3', 'b5']],
  ['App', '#/reports', 'Reports with drill-down', ['b5']],
  ['App', '#/notifications', 'Notifications', ['b5']],
  ['App', '#/apps', 'Several apps on one server', ['b5']],
  ['App', '#/more', 'ECM functions, optional', ['ootb']],
  ['App', '#/assets', 'Brand assets: the library, with filters', ['p14', 's3'], 'priya'],
  ['App', '#/asset/AST-503', 'Asset page: preview, renditions, rights, usage', ['p14', 'c13', 's2'], 'priya'],
  ['App', '#/product/PRD-3101', 'Product with the shots it still needs', ['p14', 's1'], 'priya'],
  ['App', '#/task/T-601', 'Creative review with pins on the picture', ['p14', 's4'], 'leo'],
  ['App', '#/task/T-603', 'Licensor approval, as an outside user', ['p14', 'c13'], 'jo'],
  ['App', '#/share/S-7Q2K', 'A share link, as its recipient sees it', ['p14', 'c13'], 'priya'],
  ['Build', '#/build/agent', 'App builder agent', ['s6']],
  ['Build', '#/build/model', 'Data model', ['s1']],
  ['Build', '#/build/layout', 'Record layout designer', ['s2', 'd11']],
  ['Build', '#/build/queues', 'Queues and home per group', ['s3', 'd11']],
  ['Build', '#/build/actions', 'Server actions with parameters', ['s5']],
  ['Build', '#/build/kits', 'Starter kits', ['s7']],
  ['Build', '#/build/bridge', 'Studio bridge', ['s8']],
  ['Guide', '#/start/before-after', 'Member: before and after', ['qw', 's0']],
  ['Guide', '#/start/plan', 'Plan map', ['s0']],
  ['Guide', '#/start/gaps', 'Enterprise gaps', ['s0']],
  ['Guide', '#/start/accounts', 'Every account: the plan by use case', ['p14', 'c13']],
  ['Guide', '#/start/feasibility', 'Feasibility: every capability checked', ['s0', 'dec']],
  ['Guide', '#/start/decisions', 'Decisions', ['dec']],
];
// A guide link into the app opens it as the person the page is for, so a page of one demo never shows
// under the other, and an outside user is never sent to a page that is not shared with them. Guide and
// Build links stay as they are.
const DAM_TASK_AS = { 'T-601': 'leo', 'T-602': 'leo', 'T-603': 'jo', 'T-604': 'priya' };
function personaFor(h) {
  if (!h.startsWith('#/') || /^#\/(start|build)(\/|$)/.test(h)) return '';
  const task = (h.match(/^#\/task\/(T-\d+)/) || [])[1];
  if (task && DAM_TASK_AS[task]) return DAM_TASK_AS[task];
  // A queue opens as the first person whose groups may see it, so a link never lands on its locked page.
  const queue = QUEUES.find((x) => x.id === (h.match(/^#\/queue\/([\w-]+)/) || [])[1]);
  if (queue) return (Object.entries(PERSONAS).find(([, p]) => queue.groups.some((g) => p.groups.includes(g))) || ['dana'])[0];
  if (/^#\/(assets?|products?|shares?)(\/|$)/.test(h)) return 'priya';
  return /CASE|inbox/.test(h) ? 'sam' : 'dana';
}
const asLink = (h, who) => { const p = who || personaFor(h); return p ? `data-act="go-as" data-p="${p}"` : ''; };
P.start = () => head('Nuxeo as a platform for business applications', 'A clickable prototype of the plan in <code>docs/presales-business-apps-plan.md</code>. It starts from the business record and the work done on it, not from the folder and the file.', ['s0']) +
  `<div class="grid2"><div class="card"><h2>Three parts</h2>
    <p><a href="#/home"><strong>App</strong></a>: what a claims adjuster, a supervisor, an appeals specialist and member services use every day. Switch who you are with “Viewing as”, which also holds a second demo: a brand team&rsquo;s assets (DAM) for another fictional customer.</p>
    <p><a href="#/build/agent"><strong>Build</strong></a>: how a presales engineer makes that app from the Nuxeo data model, without Angular, with an agent and a designer.</p>
    <p><strong>Guide</strong>: this page, the before and after, the plan map, the gaps and the decisions.</p>
    <p class="muted">Data is fictional and nothing talks to a server. Every page shows, at the top, which plan items it reflects.</p></div>
  <div class="card"><h2>Words we use</h2><dl class="side-kv">
    <dt>Satori</dt><dd>Hyland’s design system, <code>@hylandsoftware/satori-ui</code>, and nothing else.</dd>
    <dt>Nuxeo Satori platform</dt><dd>What customers build on: <code>@nuxeo/satori-platform</code>, with the <code>nxs-</code> components, the extension contract and the Nuxeo client.</dd>
    <dt>Nuxeo Satori UI</dt><dd>The app we ship today (<code>nuxeo-agentic-ui</code>): one example of what the platform builds.</dd>
    <dt>Starter kit</dt><dd>An installable business app: model, configuration, demo data and demo script.</dd>
    <dt>Studio designer</dt><dd>The in-app editor for administrators from the Studio parity plan. This prototype adds the record, queue and action screens it lacks.</dd></dl></div></div>
  <div class="card"><h2>A 10-minute demo path</h2><ol>
    <li>As <strong>Dana</strong>, open <a href="#/home" data-act="go-as" data-p="dana">My work</a>, then <a href="#/queue/unassigned" data-act="go-as" data-p="dana">Unassigned claims</a>, and choose <em>Take it</em> on a claim.</li>
    <li>Open <a href="#/claim/CLAIM-000131" data-act="go-as" data-p="dana">CLAIM-000131</a>: lifecycle buttons, the unusual-amount flag, <em>Request medical records</em>.</li>
    <li>Open its <a href="#/task/T-501" data-act="go-as" data-p="dana">task form</a>. Choose Deny and complete it without a reason, to see the field rule.</li>
    <li>Open <a href="#/member/MEMBER-100048" data-act="go-as" data-p="dana">John Smith</a>: age, combined address, claims and cases. Compare with <a href="#/start/before-after">today</a>.</li>
    <li>Switch to <strong>Riley</strong> (member services): HICN and Medicare ID are masked, and the home is different.</li>
    <li>Switch to <strong>Sam</strong>: <a href="#/case/CASE-2041" data-act="go-as" data-p="sam">CASE-2041</a>, upload a missing document, set a legal hold, then file the letter in the <a href="#/inbox" data-act="go-as" data-p="sam">Inbox</a>.</li>
    <li>Go to <a href="#/build/agent">Build</a>: play the agent, then look at the <a href="#/build/layout">layout designer</a> and <a href="#/build/actions">actions</a>.</li></ol></div>
  <div class="card"><h2>A 5-minute brand assets (DAM) demo</h2><p class="muted">Another fictional customer, Acme Outdoor, on the same platform with another starter kit. Here the file is the business record.</p><ol>
    <li>As <strong>Priya</strong>, brand asset manager, open <a href="#/home" data-act="go-as" data-p="priya">My work</a>: a live asset&rsquo;s model release ends in 24 days.</li>
    <li>Open the <a href="#/product/PRD-3101" data-act="go-as" data-p="priya">Trailhead Rain Jacket</a>: the shots each colourway still needs. Request a missing one.</li>
    <li>Open the <a href="#/asset/AST-503" data-act="go-as" data-p="priya">on-model shot</a>: preview, renditions, rights and where it is live. The print rendition is blocked by its licence.</li>
    <li>Share the <a href="#/asset/AST-504" data-act="go-as" data-p="priya">embargoed Slate shot</a> with an agency: the watermark is forced. Open the link as its recipient from <a href="#/shares" data-act="go-as" data-p="priya">Shared links</a>.</li>
    <li>As <strong>Leo</strong>, creative director, <a href="#/task/T-601" data-act="go-as" data-p="leo">review the back shot</a>: click the picture to pin a note, then request changes.</li>
    <li>As <strong>Jo</strong> at Starfield Studios, an outside licensor, <a href="#/task/T-603" data-act="go-as" data-p="jo">approve the licensed tee artwork</a>, then try to open anything else.</li></ol></div>
  <div class="card" style="padding:4px 8px"><table><thead><tr><th>Part</th><th>Page</th><th>Plan items</th></tr></thead><tbody>${PAGES.map(([g, h, n, t, who]) => `<tr><td>${g}</td><td><a href="${h}" ${asLink(h, who)}>${esc(n)}</a></td><td>${t.map((k) => `<span class="ptag ${PLAN[k].when === 'now' ? 'now' : PLAN[k].when === 'later' ? 'later' : ''}">${esc(PLAN[k].t)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;

P['start/before-after'] = () => head('Member: before and after', 'The same Member record, today in Nuxeo Satori UI and in the target business app.', ['qw', 's0', 's2']) +
  `<div class="grid2"><div class="card"><h2>Today</h2><div class="wire"><div class="wh">MEMBER-100001 · View · Annotations · Permissions · History · Publishing</div><div class="wb"><div>Browse tree<br>Root › Domain › Members</div><div class="empty">Empty file viewer: a Member has no file</div><div>State, version, dates, contributors, tags…<br><br><strong>Member</strong><br>Beneficiary HICN<br>Birth date</div></div></div>
    <ul><li>The main area is a file viewer for a record with no file.</li><li>Business fields sit at the bottom of the side panel, under the schema name.</li><li>No age, no combined address, no amounts, no related claims or cases.</li><li>File tabs (Annotations, Publishing) on a record that has no file.</li></ul></div>
  <div class="card"><h2>Target</h2><div class="wire"><div class="wh">John Smith · Overview · Claims · Cases · Documents · Activity</div><div class="wb" style="grid-template-columns:1fr 150px"><div><strong>Member info</strong>: ID, date of birth (age 74), HICN, Medicare ID, contact, address<br><br><strong>Claims</strong>: amount, provider, NPI, service date, state<br><br><strong>Cases</strong>: type, claim, state, determination</div><div>Summary<br><br>Details<br><br>Comments</div></div></div>
    <ul><li>Fields in the main area, laid out for the job.</li><li>Computed and combined values from a registered list.</li><li>Related records that pass this member to the query.</li><li>Actions for the work: start a case, generate a letter.</li></ul><a href="#/member/MEMBER-100048" ${asLink('#/member/MEMBER-100048')}><button class="primary">Open the target page</button></a></div></div>` +
  note('The quick win (section 4) closes the first gap alone: for a type with no file, show its layout in the View tab instead of the empty viewer.');

const LANES = [
  ['Now', [['qw', '#/start/before-after'], ['s0', '#/start'], ['s1', '#/build/model'], ['s2', '#/build/layout']]],
  ['Next', [['s3', '#/home'], ['s4', '#/task/T-501'], ['s5', '#/build/actions'], ['ootb', '#/provider/PRV-203'], ['d11', '#/build/queues'], ['p14', '#/start/accounts']]],
  ['Then', [['s6', '#/build/agent'], ['s7', '#/build/kits']]],
  ['Later', [['s8', '#/build/bridge'], ['b5', '#/inbox']]],
];
P['start/plan'] = () => head('Plan map', 'The order of work from section 8 of the plan, with the page that shows each item.', ['s0']) +
  `<div class="lane">${LANES.map(([l, items]) => `<div><h2>${l}</h2>${items.map(([k, h]) => `<a class="item" href="${h}" ${asLink(h)}><strong>${esc(PLAN[k].t)}</strong><small>${esc({ qw: 'Record page for types with no file; group rule; wording', s0: 'Glossary, position next to Web UI, scope, backlog', s1: 'Record pages, cases as records, references', s2: 'Widgets, computations, related records', s3: 'Home per group, queues, business navigation', s4: 'Task forms, lifecycle buttons, SLA', s5: 'Automation chains with parameters', ootb: 'Every type works on install', d11: 'What the designer prototype adds', s6: 'Model in, checked package out', s7: 'Payers first, then cases, contracts, DAM', s8: 'Translate Studio Designer layouts', b5: 'Capture, compliance, reports, AI, several apps', p14: 'A demo of its own for every use case, in four waves' }[k])}</small></a>`).join('')}</div>`).join('')}</div>` +
  `<div class="card" style="margin-top:16px"><h2>Acceptance test</h2><p>A presales engineer rebuilds the Payers Member, Claim and Case screens with no Angular code, in two days or less, and a prospect would accept the result.</p></div>`;

const GAPS = [
  ['Record page, type with no file', 'Opens on the file viewer', '#/member/MEMBER-100048'], ['How fields are shown', 'Schema type picks the control', '#/build/layout'], ['Related records', 'None', '#/member/MEMBER-100048'],
  ['Folderish business objects', 'Sent to Browse', '#/case/CASE-2041'], ['Home', 'Four fixed widgets', '#/home'], ['Navigation', 'ECM functions', '#/build/queues'],
  ['Lists and search', 'Three stock page providers', '#/queue/unassigned'], ['Lifecycle', 'No transition actions', '#/claim/CLAIM-000131'], ['Workflow', 'Stock review variables only', '#/task/T-501'],
  ['Business actions', 'Only actions already in code', '#/build/actions'], ['Personas and conditions', 'Admin, poweruser, external rules', '#/build/queues'], ['What configuration can do', 'Beyond branding it is code', '#/build/layout'],
  ['Generating from the model', 'Nothing reads the model', '#/build/model'], ['Agent app builder', 'Code generators and prompts', '#/build/agent'], ['Business reporting', 'Administrators’ analytics only', '#/reports'],
  ['Compliance', 'No retention or hold screens', '#/case/CASE-2041'], ['AI', 'Off for every user', '#/home'], ['Studio reuse', 'No path', '#/build/bridge'],
  ['Previews', 'Whole file downloaded first', '#/claim/CLAIM-000131'], ['Several apps per server', 'One app; demo presets', '#/apps'], ['Notifications', 'Subscribe and unsubscribe', '#/notifications'], ['Developer package', 'Not published', '#/start/decisions'],
];
P['start/gaps'] = () => head('Enterprise gaps', 'The 22 gaps from section 6, what the app does today, and where this prototype shows the answer.', ['s0']) +
  `<div class="card" style="padding:4px 8px"><table><thead><tr><th>#</th><th>Area</th><th>Today</th><th>In the prototype</th></tr></thead><tbody>${GAPS.map(([a, t, h], i) => `<tr><td>${i + 1}</td><td>${esc(a)}</td><td class="muted">${esc(t)}</td><td><a href="${h}" ${asLink(h)}>See it</a></td></tr>`).join('')}</tbody></table></div>` +
  note('Rows 19 and 22 are engineering work with no screen of their own: streaming previews and publishing <code>@nuxeo/satori-platform</code>.');

P['start/decisions'] = () => head('Decisions', 'What the prototype assumes, and who has to decide it.', ['dec']) +
  `<div class="grid2"><div class="card"><h2>Decisions needed (section 9)</h2><ol>${['The position next to Web UI (Nuxeo Product)', 'Reopening the Beta scope decision that put workflow and business records out', 'Letting configuration bind buttons to Automation chains on the server', 'A registered list of computations for layouts: how small, and its security review', 'Loading customer code into the shipped app, or keeping “build your own app from the template”', 'Access to the Satori design system for presales and partners', 'Who owns the starter kits: presales, product, or both', 'The glossary'].map((d) => `<li>${esc(d)}</li>`).join('')}</ol></div>
  <div class="card"><h2>Where the two plans disagree (section 11)</h2><ul><li><strong>One configuration for everyone</strong> against a home per group. The prototype uses rules on cards and menu entries, so it keeps one configuration.</li><li><strong>An assistant with no tools</strong> against an agent that reads the model. The prototype shows the agent on a development server; the in-app assistant stays for production.</li><li><strong>No free JavaScript</strong>, which both agree on. Computations are a registered list.</li></ul>
  <h2 style="margin-top:16px">Settled by a check on Nuxeo 2025</h2><ul><li>Task forms: the server sends each step’s variable schema.</li><li>Page provider definitions are readable over REST.</li><li>Allowed lifecycle transitions are not: that needs a small enricher of ours.</li></ul><p><a href="#/start/feasibility">Every capability, checked</a></p></div></div>`;

// ---- feasibility: what each capability needs, from the checks against two local Nuxeo 2025 servers
const FEAS = [
  ['Read the data model', 'Works today', 'ok', 'config/types, schemas and facets answered', 'Us', '#/build/model'],
  ['Record page for a type with no file', 'Client work', 'info', 'Layouts exist; the View tab picks the viewer from one table', 'Us', '#/member/MEMBER-100048'],
  ['Widgets, computed and combined fields', 'Client work', 'info', 'Presentation over properties the API returns', 'Us', '#/build/layout'],
  ['Related records, records that point here', 'Client work + Studio', 'info', 'NXQL answered; references are documentResolver constraints', 'Us + model', '#/member/MEMBER-100048'],
  ['Group rules for home, menus, queues', 'Client work', 'info', '/api/v1/me returns the groups', 'Us', '#/build/queues'],
  ['Queues, business search, KPIs, reports', 'Client work + Studio', 'info', 'Page provider definitions and 6 aggregates answered', 'Us + page providers', '#/queue/unassigned'],
  ['Update all results', 'Client work', 'info', 'Bulk.RunAction takes a query or a provider', 'Us', '#/queue/unassigned'],
  ['Task forms from the workflow step', 'Client work', 'info', 'taskInfo.schemas = var_Task2556, layoutResource named', 'Us', '#/task/T-501'],
  ['Start a workflow, task banner', 'Client work + Studio', 'info', 'Context.StartWorkflow; runnableWorkflows and pendingTasks enrichers', 'Us + workflows', '#/claim/CLAIM-000131'],
  ['Lifecycle buttons from allowed transitions', 'Our server work', 'c', 'FollowLifecycleTransition exists; nothing lists allowed transitions', 'Us (enricher)', '#/claim/CLAIM-000131'],
  ['Buttons that run server logic', 'Client work + decision', 'warn', '342 operations listed with parameters; the chains do not exist yet', 'Us + Studio + decision 3', '#/build/actions'],
  ['Timeline and comments', 'Client work', 'info', '@audit and @comment answered', 'Us', '#/case/CASE-2041'],
  ['Streaming previews', 'Client work', 'info', 'Ranged download returned 206', 'Us', '#/claim/CLAIM-000131'],
  ['In-app notifications', 'Client or our server work', 'info', 'No platform API; build from tasks and audit', 'Us', '#/notifications'],
  ['Legal hold and retention', 'Platform add-on', 'warn', 'No retention or hold operations installed', 'Platform', '#/case/CASE-2041'],
  ['Letters from templates', 'Platform add-on', 'warn', 'No Template Rendering; a basic Render.Document letter works', 'Platform', '#/case/CASE-2041'],
  ['Inbound mail and scans', 'Platform capture path', 'warn', 'Nothing ingests mail or scans; AI.Classify exists once filed', 'Platform + AI package', '#/inbox'],
  ['Masking HICN and Medicare ID', 'Decision', 'bad', 'Screen masking is easy but not a control; no per-field read permission known', 'Platform decision', '#/member/MEMBER-100048'],
  ['Several apps on one server', 'Our server work + decision', 'c', 'The config servlet serves one configuration', 'Us', '#/apps'],
  ['AI summaries, NL search, classification', 'AI package work', 'warn', '12 AI.* operations installed, calling HAIP; UI switch is off', 'AI package + us', '#/search'],
  ['Unusual-amount flag', 'Our work', 'c', 'AI.Anomalies reads audit, not amounts; a rule over aggregates needs no AI', 'Us', '#/claim/CLAIM-000131'],
  ['App builder agent', 'Our work', 'c', 'Every read it needs answered; skill and MCP server to build', 'Us', '#/build/agent'],
  ['Payers starter kit', 'Needs the Payers model', 'bad', 'Neither local server has Member, Claim or Case', 'Presales', '#/build/kits'],
  ['@mentions, Studio bridge', 'Not proven', 'bad', 'Not tested', 'Platform to confirm', '#/build/bridge'],
];
const ASKS = [
  ['From you', ['The Payers model and demo data (Studio project or export)', 'A demo server with the Satori package and dev mode on', 'The Claude token: organization, approval under Hyland’s AI use requirements, health-data terms, a spending cap', 'Decisions 2, 3 and 5', 'Presales time for the walkthrough and the two-day test']],
  ['From the platform and backend team', ['Retention Management on demo servers', 'Template Rendering, or agreement that a basic letter is enough', 'A decision on protecting fields like HICN', 'A capture path for mail, scans and faxes', 'SMTP on demo servers', 'Confirm @mentions and where Studio Designer layouts can be read']],
  ['From the AI package owners', ['A Claude provider with the official Anthropic Java SDK, key from the server environment, claude-opus-5-5', 'Field extraction into a schema, record summaries with related records, classification that finds the member or claim', 'The customer’s content model in AI.NlToNxql’s context']],
];
P['start/feasibility'] = () => head('Feasibility', 'Every capability in this prototype, checked on 21 November 2026 against two local Nuxeo 2025 servers with read-only calls, and against the code.', ['s0', 'dec']) +
  `<div class="banner ok">${ic('circle_check')}<span><strong>Nothing here is blocked by the platform.</strong> Most of it is client work; five items need someone else, listed below.</span></div>
  <div class="card" style="padding:4px 8px"><table><thead><tr><th>Capability</th><th>Verdict</th><th>Evidence</th><th>Who</th></tr></thead><tbody>${FEAS.map(([c, v, tone, e, w, h]) => `<tr><td><a href="${h}" ${asLink(h)}>${esc(c)}</a></td><td><span class="st ${tone === 'c' ? '' : tone}">${esc(v)}</span></td><td class="muted">${esc(e)}</td><td>${esc(w)}</td></tr>`).join('')}</tbody></table></div>
  <div class="grid3">${ASKS.map(([t, items]) => `<div class="card"><h2>${esc(t)}</h2><ol>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('')}</div>
  <div class="card ai"><h2>${ic('ai')}AI with a Claude token</h2><p>Claude runs inside the AI package on the Nuxeo server, so the key never reaches the browser. Model <code>claude-opus-5-5</code>; structured outputs for classification and extraction; the content model cached in the prompt for natural-language search; the Batches API for back-filling a repository. Health data needs approved data terms before real members are sent.</p></div>` +
  note('Full report with evidence: <code>docs/presales-business-apps-feasibility.md</code>.');

// ---- every account: the waves in section 14, by use case. This page is public, so it names no account.
const COVER = [
  ['Health payers and public health', 3, ['ok', 'Covered'], 'Payers and claims', 1, '#/home', 'dana'],
  ['Brand and product DAM', 4, ['bad', 'Weak'], 'Brand assets (DAM)', 1, '#/assets', 'priya'],
  ['Property and casualty insurance', 4, ['warn', 'Partly'], 'Property and casualty claims', 2],
  ['Banking', 2, ['warn', 'Partly'], 'Onboarding and disputes', 2],
  ['Engineering document control', 2, ['bad', 'Not covered'], 'Controlled documents', 3],
  ['Operations with outside parties', 2, ['warn', 'Partly'], 'Case management', 3],
  ['Media and entertainment', 1, ['bad', 'Weak'], 'Media assets and rights', 4],
  ['Records management', 1, ['warn', 'Partly'], 'Records management', 4],
  ['Not known yet', 1, ['', 'To confirm'], 'Chosen with presales', 0],
];
const WAVES = [
  [1, 'Prove both shapes', 'A record with no file (Payers), and a file that is the record (brand DAM).', ['A record page for files: preview first, then renditions, rights and usage', 'An asset library with filters, and review with pins and rounds', 'Rights checked on every download, share and publish', 'Share links with a watermark and an end date'], 'the Payers screens, and a product and asset page, rebuilt in two days each'],
  [2, 'Records that live elsewhere', 'Insurers and banks keep the claim or the account in a core system.', ['Live data from the core system on the record page', 'A Nuxeo panel inside the core system or the CRM', 'E-signature as a workflow step', 'Spanish and the Nordic languages', 'Retention and legal hold, moved up from Later'], 'a property claim page that shows core-system data beside its documents'],
  [3, 'Outside people, controlled documents', 'Contractors, suppliers, dealers, agents and licensors take part in the work.', ['Outside users with scoped access, invitations and expiry', 'Revisions, numbering, and review cycles with comment resolution', 'Transmittals, and CAD and BIM viewing through a partner viewer', 'French'], 'a transmittal to an outside contractor and its comment cycle'],
  [4, 'Media rights, records at scale', 'Rights by territory and window, and records kept for many clients.', ['Rights by territory and release window, localised versions, delivery to distributors', 'Retention schedules, disposition review, physical records', 'Separation between client organisations on one system'], 'a film delivered to a distributor within its window, and a disposition run with its approval'],
];
P['start/accounts'] = () => head('Every account', 'The plan in section 14: the twenty accounts from section 13, grouped by what they use Nuxeo for, and the wave that brings each group a demo of its own.', ['p14', 'c13']) +
  `<div class="banner">${ic('info')}<span>This page is public, so it groups the accounts by use case and names none of them. Each group's use case is inferred from its industry and is to be confirmed with presales.</span></div>
  <div class="card" style="padding:4px 8px"><table><thead><tr><th>Use case</th><th class="num">Accounts</th><th>Covered today</th><th>Starter kit</th><th>Wave</th><th>In this prototype</th></tr></thead><tbody>${COVER.map(([u, n, [tone, v], kit, w, h, who]) => `<tr><td>${esc(u)}</td><td class="num">${n}</td><td><span class="st ${tone}">${v}</span></td><td>${esc(kit)}</td><td>${w ? `Wave ${w}` : '—'}</td><td>${h ? `<a href="${h}" data-act="go-as" data-p="${who}">See it</a>` : '<span class="muted">Not yet</span>'}</td></tr>`).join('')}</tbody></table></div>
  <div class="lane">${WAVES.map(([w, t, why, caps, test]) => `<div><h2>Wave ${w}: ${esc(t)}</h2><p class="muted">${esc(why)}</p><ul style="padding-left:18px">${caps.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p><strong>Acceptance test:</strong> ${esc(test)}.</p></div>`).join('')}</div>` +
  note('Wave 1 has a working flow here for both of its kits. The brand demo also previews wave 3: its share links and its licensor portal are outside users with scoped access.');
