// Interactions. Everything changes in memory only; a reload starts the demo again.
let onOk = null;
function ask(title, body, okLabel, fn, danger) {
  onOk = fn;
  modal(`<h2 id="dt">${title}</h2>${body}<div class="row end"><button data-act="close">Cancel</button><button class="${danger ? 'danger' : 'primary'}" data-act="ok">${okLabel}</button></div>`);
}
const logOn = (on, icon, t) => S.log.unshift({ on, icon, t });
const nextId = (map, prefix) => prefix + (Math.max(0, ...Object.keys(map).map((k) => Number(k.slice(prefix.length)) || 0)) + 1);
// Put a record back exactly as its snapshot had it: a field the change added (a denial reason, a
// payment) goes too, which Object.assign alone would leave behind.
function restore(target, snapshot) {
  for (const key of Object.keys(target)) if (!(key in snapshot)) delete target[key];
  Object.assign(target, snapshot);
}
// Undo of a generated task removes the task and its form draft together.
function dropTask(id) {
  delete TASKS[id];
  delete S.tf[id];
}
// Only people of the record's own demo: each demo is another customer, with its own people.
const personaOpts = (sel, group, kit = 'payers') => Object.entries(PERSONAS).filter(([, p]) => p.kit === kit && (!group || p.groups.includes(group))).map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(p.n)}, ${esc(p.role)}</option>`).join('');
function setState(id, to, extra, alsoUndo) {
  const c = CLAIMS[id], before = { ...c };
  c.state = to;
  Object.assign(c, extra || {});
  logOn(id, 'steps', `State changed to ${CLAIM_STATE_LABEL[to]} by ${me().n}`);
  toast(`${id} moved to ${CLAIM_STATE_LABEL[to]}`, () => { restore(c, before); S.log.shift(); if (alsoUndo) alsoUndo(); });
}

// A move from the claim's own page. One that ends the review (approve, deny, pay, close) closes the
// claim's open tasks too, in the same undo, so no task is left that could move the claim back.
function moveFromPage(id, to, extra) {
  const closing = OPEN_STATES.includes(to) ? [] : Object.values(TASKS).filter((t) => t.target === id && !t.done);
  closing.forEach((t) => { t.done = true; t.closedByState = to; });
  setState(id, to, extra, () => closing.forEach((t) => { t.done = false; delete t.closedByState; }));
}

// Only the person who may complete a task writes its draft. The form is disabled for anyone else, and the
// same rule holds where the draft is written.
function mayDraft(tid) {
  const t = TASKS[tid], need = t && STEP_GROUPS[t.node];
  return !!t && !t.done && t.who === S.persona && (!need || me().groups.includes(need));
}

function completeTask(id) {
  if (TASKS[id].target.startsWith('AST')) return completeAssetTask(id);
  const t = TASKS[id], f = S.tf[id], e = {};
  const need = STEP_GROUPS[t.node];
  if (need && !me().groups.includes(need)) {
    f.errors = { decision: `Only ${need} can complete “${t.node}”.` };
    render();
    return;
  }
  const claim = t.target.startsWith('CLAIM') ? CLAIMS[t.target] : null;
  if (claim && !OPEN_STATES.includes(claim.state)) {
    f.errors = { decision: `${t.target} is ${CLAIM_STATE_LABEL[claim.state]}, so this task no longer applies.` };
    render();
    return;
  }
  // Only a choice this step's form offers counts; anything else is treated as no choice at all.
  if (!(DECISIONS[t.node] || []).includes(f.decision)) e.decision = 'Choose a decision.';
  if (t.node === 'Determine' && f.decision === 'approve') {
    const v = Number(f.allowed), billed = CLAIMS[t.target].billed;
    if (f.allowed === '' || Number.isNaN(v)) e.allowed = 'Enter the allowed amount.';
    // An approval pays something; paying nothing is a denial, which has its own reason.
    else if (v <= 0) e.allowed = 'Enter an amount above $0.00. To pay nothing, deny the claim instead.';
    else if (v > billed) e.allowed = `The allowed amount cannot be more than the billed ${moneyText(billed)}.`;
  }
  if (t.node === 'Determine' && f.decision === 'deny' && !f.reason) e.reason = 'Choose a denial reason. It is required when you deny a claim.';
  if (t.node === 'Supervisor approval' && f.decision === 'approve' && claim && !((claim.allowed ?? claim.billed) > 0)) e.decision = 'The allowed amount is $0.00, so there is nothing to approve. Return it to the adjuster.';
  f.errors = e;
  if (Object.keys(e).length) {
    render();
    const first = $('#main [aria-invalid=true]') || $('#main input[name=decision]');
    first && first.focus();
    return;
  }
  t.done = true;
  // One undo for the whole completion: the task reopens with whatever the task moved.
  const reopen = () => { t.done = false; };
  if (t.target.startsWith('CLAIM')) {
    const c = CLAIMS[t.target];
    if (t.node === 'Determine') {
      if (f.decision === 'approve' && c.billed > SUPERVISOR_LIMIT) {
        // The workflow's next step is supervisor approval, so the claim stays in review until it is done.
        const before = { ...c }, sid = nextId(TASKS, 'T-');
        c.allowed = Number(f.allowed);
        // A decision ends the wait for information: a pended claim is back in review (the snapshot undoes it).
        if (c.state === 'pended') c.state = 'inReview';
        TASKS[sid] = { n: 'Approve high-value claim', wf: 'Claim determination', node: 'Supervisor approval', target: t.target, who: 'morgan', due: '2026-11-24' };
        logOn(t.target, 'user_task', `Determined by ${me().n}, allowed ${moneyText(c.allowed)}: sent to Morgan Chen for supervisor approval`);
        toast(`Over ${moneyText(SUPERVISOR_LIMIT)}: sent to Morgan Chen for approval`, () => { restore(c, before); dropTask(sid); reopen(); S.log.shift(); });
      } else if (f.decision === 'approve') setState(t.target, 'approved', { allowed: Number(f.allowed) }, reopen);
      else if (f.decision === 'deny') setState(t.target, 'denied', { denial: f.reason, allowed: 0 }, reopen);
      else {
        // Pending waits for information; it is not a decision, so the determination task stays open.
        t.done = false;
        setState(t.target, 'pended', null);
      }
    } else if (f.decision === 'approve') setState(t.target, 'approved', { allowed: c.allowed ?? c.billed }, reopen);
    else {
      // Returned: the determination goes back to the adjuster as a task of its own.
      const rid = nextId(TASKS, 'T-');
      TASKS[rid] = { n: 'Determine claim', wf: 'Claim determination', node: 'Determine', target: t.target, who: c.assignee || 'dana', due: '2026-11-25' };
      setState(t.target, 'inReview', {}, () => { reopen(); dropTask(rid); });
    }
  } else {
    // Every outcome on a case leads somewhere: a next task, or a decided case. One Undo takes it all back.
    const k = CASES[t.target], before = { ...k };
    let next = null, msg = `${t.n} completed`;
    if (t.node === 'Callback' && f.decision === 'follow') {
      next = { n: 'Follow up with the member', wf: t.wf, node: 'Callback', target: t.target, who: t.who, due: '2026-11-25' };
      msg = 'Follow-up task created';
    } else if (t.node === 'Callback') {
      Object.assign(k, { state: 'decided', determination: 'Resolved on the call' });
      msg = `${t.target} resolved on the call`;
    } else if (t.node === 'Medical review') {
      next = { n: 'Decide the appeal', wf: t.wf, node: 'Decision', target: t.target, who: k.assignee || 'sam', due: k.due, recommendation: f.decision };
      msg = 'Sent for the appeal decision';
    } else if (t.node === 'Decision') {
      Object.assign(k, { state: 'decided', determination: f.decision === 'overturn' ? 'Denial overturned' : 'Denial upheld' });
      msg = `${t.target}: ${k.determination.toLowerCase()}`;
    }
    const nid = next ? nextId(TASKS, 'T-') : null;
    if (next) TASKS[nid] = next;
    logOn(t.target, 'circle_check', `${t.n} completed by ${me().n}: ${f.decision}${next ? `; next: ${next.n}` : ''}`);
    toast(msg, () => { restore(k, before); if (nid) dropTask(nid); reopen(); S.log.shift(); });
  }
  location.hash = '#/' + (t.target.startsWith('CLAIM') ? 'claim/' : 'case/') + t.target;
}

document.addEventListener('click', (ev) => {
  // Before any route logic: its href is #main, which the router would read as a page.
  if (ev.target.closest('a.skip')) { ev.preventDefault(); $('#main').focus(); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  if (a === 'dia-bg') { if (ev.target === el) closeModal(); return; }
  if (['pick', 'hold', 'tf', 'persona', 'ltype', 'noop', 'tfv', 'damf', 'pick-asset', 'pin-note', 'pin-pos', 'vnote-t', 'vnote-x'].includes(a)) return; // handled on change
  if (el.tagName === 'A' && a !== 'read' && a !== 'go-app' && a !== 'go-docs') ev.preventDefault();
  switch (a) {
    case 'close': closeModal(); break;
    case 'ok': { const keep = onOk && onOk($('#modal')) === false; if (!keep) { closeModal(); render(); } break; }
    case 'toast': toast(el.dataset.msg); break;
    case 'take': {
      const c = CLAIMS[id], before = { ...c };
      c.assignee = S.persona;
      if (c.state === 'submitted') c.state = 'inReview';
      logOn(id, 'user_task', `Taken by ${me().n}`);
      toast(`${id} is yours`, () => { restore(c, before); S.log.shift(); });
      render();
      break;
    }
    case 'assign': case 'reassign': case 'bulk-assign': {
      const ids = a === 'bulk-assign' ? [...S.sel] : a === 'reassign' ? [TASKS[id].target] : [id];
      const need = a === 'reassign' ? STEP_GROUPS[TASKS[id].node] : null;
      ask('Assign to', `<label class="f"><span>Person</span><select id="as">${personaOpts(need ? 'morgan' : 'dana', need)}</select></label>${need ? `<p class="help" style="margin-left:0">“${esc(TASKS[id].node)}” belongs to ${need}: only its members are offered.</p>` : ''}<p class="muted">${ids.length} item${ids.length > 1 ? 's' : ''}. The server refuses it if the workflow step does not allow reassignment.</p>`, 'Assign', (d) => {
        const p = d.querySelector('#as').value;
        // The list above is only what is offered; the check is here, as a server would make it.
        if (PERSONAS[p].kit !== 'payers') { toast(`${PERSONAS[p].n} works for another customer`); return false; }
        if (need && !PERSONAS[p].groups.includes(need)) { toast(`${PERSONAS[p].n} is not in ${need}`); return false; }
        // Reassigning a task moves that task. The claim's assignee (its adjuster) moves only when the
        // claim itself is assigned, or when the task is the adjuster's own determination: handing the
        // supervisor's step to another supervisor must not make the supervisor the claim's adjuster.
        const movesClaim = a !== 'reassign' || TASKS[id].node === 'Determine';
        ids.forEach((x) => {
          if (CLAIMS[x] && movesClaim) CLAIMS[x].assignee = p;
          if (a === 'reassign') TASKS[id].who = p;
          logOn(x, 'reassign', a === 'reassign' ? `${TASKS[id].n} reassigned to ${PERSONAS[p].n} by ${me().n}` : `Assigned to ${PERSONAS[p].n} by ${me().n}`);
        });
        S.sel.clear();
        toast(`Assigned to ${PERSONAS[p].n}`);
      });
      break;
    }
    case 'bulk-all': {
      const n = Number(el.dataset.n);
      ask(`Update all ${n} results?`, `<label class="f"><span>Set</span><select><option>Assignee to Dana Lee</option><option>Priority to high</option></select></label><p class="muted">Runs on the server over the queue’s whole query, through the Bulk Action Framework, not only the rows on screen.</p><div class="meter" id="bm" role="progressbar" aria-label="Updating results" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><i style="width:0"></i></div>`, 'Run', (d) => {
        const m = d.querySelector('#bm'), bar = m.querySelector('i');
        m.hidden = false;
        let p = 0;
        d.querySelector('[data-act=ok]').disabled = true;
        const t = setInterval(() => {
          // Closed mid-run (Cancel, Escape): stop, and say nothing changed rather than report success.
          if (!m.isConnected) { clearInterval(t); toast('Stopped before it finished. Nothing was changed.'); return; }
          p += 25; bar.style.width = p + '%'; m.setAttribute('aria-valuenow', String(p));
          if (p >= 100) { clearInterval(t); closeModal(); S.sel.clear(); render(); toast(`Updated ${n} items`); }
        }, 250);
        return false;
      });
      break;
    }
    case 'csv': toast(`Exported ${S.sel.size} rows to CSV`); break;
    case 'transition': {
      const to = el.dataset.to;
      if (el.dataset.t === 'deny') {
        ask(`Deny ${id}?`, `<label class="f"><span>Denial reason (required)</span><select id="dr"><option value="">Choose a reason</option>${DENIAL_REASONS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label><div class="err" id="dre"></div><p class="muted">The member gets a denial letter with appeal rights.</p>`, 'Deny', (d) => {
          const v = d.querySelector('#dr').value;
          if (!v) { d.querySelector('#dr').setAttribute('aria-invalid', 'true'); d.querySelector('#dre').textContent = 'Choose a reason.'; d.querySelector('#dr').focus(); return false; }
          moveFromPage(id, to, { denial: v, allowed: 0 });
        }, true);
      } else if (el.dataset.t === 'approve') {
        // An approval says what it pays: the amount is shown, can be changed, and must be above $0.00.
        const c = CLAIMS[id];
        ask(`Approve ${id}?`, `<label class="f"><span>Allowed amount, USD (above $0.00, at most ${moneyText(c.billed)})</span><input type="number" min="0.01" step="0.01" id="aa" value="${c.allowed ?? c.billed}"></label><div class="err" id="aae"></div><p class="muted">${c.allowed == null ? 'No allowed amount was set, so this starts from the billed amount.' : 'The amount set during the determination.'} Marking the claim paid pays this amount.</p>`, 'Approve', (d) => {
          const f = d.querySelector('#aa'), v = Number(f.value);
          const bad = f.value === '' || Number.isNaN(v) || v <= 0 ? 'Enter an amount above $0.00. To pay nothing, deny the claim instead.' : v > c.billed ? 'The allowed amount cannot be more than the billed amount.' : '';
          if (bad) { f.setAttribute('aria-invalid', 'true'); d.querySelector('#aae').textContent = bad; f.focus(); return false; }
          moveFromPage(id, to, { allowed: v });
        });
      } else {
        // Paying records the payment: the allowed amount, or the billed amount when none was set.
        // It rides in the same state change, so the same Undo takes it back.
        const c = CLAIMS[id];
        moveFromPage(id, to, to === 'paid' ? { paid: c.allowed ?? c.billed } : undefined);
        render();
      }
      break;
    }
    case 'op-records': {
      // The provider of the claim the record is about: the claim itself, or a case's own claim.
      const about = CLAIMS[id] || CLAIMS[CASES[id]?.claim];
      const rec = about ? PROVIDERS[about.provider].n : 'the provider on file';
      ask('Send a records request?', `<p>To <strong>${esc(rec)}</strong>, due in 14 days.</p><dl class="side-kv"><dt>Runs</dt><dd><code>Claim.RequestMedicalRecords</code> on the server</dd><dt>Parameters</dt><dd><code>recipient = ${esc(rec)}</code>, <code>dueInDays = 14</code></dd></dl>`, 'Send request', () => {
        logOn(id, 'send', `Medical records requested from ${rec}, due Dec 5, 2026`);
        toast('Request sent, due Dec 5, 2026');
      });
      break;
    }
    case 'letter':
      ask('Generate a letter', `<label class="f"><span>Template</span><select id="lt"><option>Acknowledgement of appeal</option><option>Request for information</option><option>Determination notice</option></select></label><p class="muted">Rendered on the server from a template, then filed under Documents.</p>`, 'Generate', (d) => {
        const t = d.querySelector('#lt').value;
        logOn(id, 'mail', `Letter “${t}” generated and filed`);
        toast(`“${t}” added to Documents`);
      });
      break;
    case 'edit-member': {
      const m = MEMBERS[id];
      ask(`Edit ${esc(m.first + ' ' + m.last)}`, `<div class="grid2" style="gap:0 12px"><label class="f"><span>First name (required)</span><input type="text" id="fn" value="${esc(m.first)}"></label><label class="f"><span>Last name (required)</span><input type="text" id="ln" value="${esc(m.last)}"></label></div><div class="err" id="namee"></div><label class="f"><span>Date of birth</span><input type="date" id="dob" value="${esc(m.dob)}"></label><label class="f"><span>Phone</span><input type="text" id="ph" value="${esc(m.phone)}"></label><label class="f"><span>Street</span><input type="text" id="st" value="${esc(m.street)}"></label><div class="grid2" style="gap:0 12px"><label class="f"><span>City</span><input type="text" id="ct" value="${esc(m.city)}"></label><label class="f"><span>ZIP (5 digits)</span><input type="text" id="zip" value="${esc(m.zip)}"></label></div><div class="err" id="zipe"></div>`, 'Save', (d) => {
        const q = (s) => d.querySelector(s), fn = q('#fn'), ln = q('#ln'), z = q('#zip');
        for (const [el, msg] of [[fn, 'Enter a first name.'], [ln, 'Enter a last name.']]) {
          if (!el.value.trim()) { el.setAttribute('aria-invalid', 'true'); q('#namee').textContent = msg; el.focus(); return false; }
        }
        if (!/^\d{5}$/.test(z.value)) { z.setAttribute('aria-invalid', 'true'); q('#zipe').textContent = 'Enter a 5-digit ZIP code.'; z.focus(); return false; }
        Object.assign(m, { first: fn.value.trim(), last: ln.value.trim(), dob: q('#dob').value || m.dob, phone: q('#ph').value.trim(), street: q('#st').value.trim(), city: q('#ct').value.trim(), zip: z.value });
        toast('Saved. Only the changed properties were sent.');
      });
      break;
    }
    case 'edit-claim': {
      const c = CLAIMS[id];
      // The allowed amount is the determination's to set. Once the claim is decided it is what was
      // approved (or $0.00 on a denial): changing it then would pay an amount nobody approved.
      const amountOpen = OPEN_STATES.includes(c.state);
      const amountField = amountOpen
        ? `<label class="f"><span>Allowed amount, USD (at most ${moneyText(c.billed)})</span><input type="number" min="0" step="0.01" id="al" value="${c.allowed ?? ''}"></label><div class="err" id="ale"></div>`
        : `<p><strong>${c.state === 'denied' ? 'Allowed' : 'Approved'} amount: ${moneyText(c.allowed ?? 0)}</strong>. It was set when the claim was ${CLAIM_STATE_LABEL[c.state].toLowerCase()}; changing it needs a new determination.</p>`;
      ask(`Edit ${id}`, `${amountField}${c.state === 'denied' ? `<label class="f"><span>Denial reason (shown because the claim is denied)</span><select id="dr2">${DENIAL_REASONS.map(([k, l]) => `<option value="${k}" ${k === c.denial ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}`, 'Save', (d) => {
        if (!amountOpen) {
          if (c.state === 'denied') c.denial = d.querySelector('#dr2').value;
          toast('Saved');
          return;
        }
        const f = d.querySelector('#al'), v = Number(f.value);
        if (f.value !== '' && (Number.isNaN(v) || v < 0)) { f.setAttribute('aria-invalid', 'true'); d.querySelector('#ale').textContent = 'The allowed amount cannot be below $0.00.'; f.focus(); return false; }
        // $0.00 belongs to a denied claim; on any other it would approve a zero payment.
        if (f.value !== '' && v === 0 && c.state !== 'denied') { f.setAttribute('aria-invalid', 'true'); d.querySelector('#ale').textContent = 'Only a denied claim has an allowed amount of $0.00. To pay nothing, deny the claim.'; f.focus(); return false; }
        if (f.value !== '' && v > c.billed) { f.setAttribute('aria-invalid', 'true'); d.querySelector('#ale').textContent = 'The allowed amount cannot be more than the billed amount.'; f.focus(); return false; }
        c.allowed = f.value === '' ? null : v;
        if (c.state === 'denied') c.denial = d.querySelector('#dr2').value;
        toast('Saved');
      });
      break;
    }
    case 'start-case':
      ask('Start a case', `<label class="f"><span>Type</span><select id="ct"><option>Grievance</option><option>Appeal</option></select></label><label class="f"><span>About claim</span><select id="cc">${Object.entries(CLAIMS).filter(([, c]) => c.member === id).map(([k]) => `<option>${k}</option>`).join('')}</select></label>`, 'Start', (d) => {
        const n = nextId(CASES, 'CASE-');
        // A case starts with its first task, owned by the team that works that kind of case, so it
        // cannot sit with nothing to move it on.
        const type = d.querySelector('#ct').value, appeal = type === 'Appeal', owner = appeal ? 'sam' : 'riley';
        CASES[n] = { title: type + ' for ' + mName(id), type, member: id, claim: d.querySelector('#cc').value, state: 'open', rcvd: '2026-11-21', due: '2026-12-21', assignee: owner, hold: false, determination: null, people: [[owner, appeal ? 'Case specialist' : 'Member services']], checklist: [['Member statement', null]], timeline: [['2026-11-21', 'gavel', `Case started from the member page by ${me().n}`, me().n]] };
        TASKS[nextId(TASKS, 'T-')] = appeal
          ? { n: 'Medical review', wf: 'Appeal review', node: 'Medical review', target: n, who: owner, due: '2026-12-05' }
          : { n: 'Call the member back', wf: 'Grievance handling', node: 'Callback', target: n, who: owner, due: '2026-11-24' };
        setTimeout(() => (location.hash = '#/case/' + n));
        toast(`${n} started`);
      });
      break;
    case 'preview': {
      const doc = DOCS[id];
      modal(`<h2 id="dt">${esc(doc.n)}</h2><div class="drop" style="padding:48px 16px">${ic('pdf')}<br>Preview of ${esc(doc.n)} (${doc.size})<br><span class="muted">Streamed from the server a piece at a time (gap 19), so a large file starts at once.</span></div><div class="row end"><button data-act="close">Close</button></div>`);
      break;
    }
    case 'upload': toast('Added under this member. Suggested category: Correspondence'); break;
    case 'check-upload': {
      const k = CASES[id], i = Number(el.dataset.i), name = k.checklist[i][0];
      const did = nextId(DOCS, 'DOC-');
      DOCS[did] = { n: name + '.pdf', cat: name, size: '410 KB', case: id };
      k.checklist[i][1] = did;
      logOn(id, 'upload', `${name} uploaded by ${me().n} and filed in the case`);
      toast(`${name} filed in ${id}`, () => { k.checklist[i][1] = null; delete DOCS[did]; S.log.shift(); });
      render();
      break;
    }
    case 'case-note': {
      const v = ($('#cnote').value || '').trim();
      if (!v) { toast('Write a note first'); break; }
      logOn(id, 'comment', `${me().n}: ${v}`);
      toast(v.includes('@') ? 'Note added; the people you mentioned were notified' : 'Note added');
      render();
      break;
    }
    case 'comment': toast('Comment posted'); break;
    case 'complete': completeTask(id); break;
    case 'agent-next': S.agentStep = Math.min(S.agentStep + 1, AGENT.length - 1); render(); break;
    case 'agent-reset': S.agentStep = 0; render(); break;
    case 'lf': S.layoutField = el.dataset.f; render(); break;
    case 'read': S.read.add(Number(el.dataset.i)); break;
    case 'read-all': NOTIFS.forEach((n, i) => n.to === S.persona && S.read.add(i)); render(); break;
    case 'file-in': {
      const x = INBOX.find((y) => y.id === id);
      const target = x.target[0], did = nextId(DOCS, 'DOC-');
      if (target.startsWith('CLAIM')) { DOCS[did] = { n: x.file, cat: x.cls[0], size: '1.1 MB', claim: target }; CLAIMS[target].docs.push(did); }
      else DOCS[did] = { n: x.file, cat: x.cls[0], size: '1.1 MB', case: target };
      x.done = true;
      logOn(target, 'inbox', `${x.cls[0]} filed from the inbox (${x.ch.toLowerCase()})`);
      toast(`Filed to ${target}; the assignee was notified`);
      render();
      break;
    }
    case 'go-app': S.persona = { claims: 'dana', appeals: 'sam', service: 'riley', brand: 'priya', licensing: 'jo' }[id] || 'dana'; S.sel.clear(); render(); break;
    case 'go-docs': break;
    default: if (DAM_ACTS[a]) DAM_ACTS[a](el, ev);
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'persona') {
    // Another demo is another customer: start it from its own home rather than on the other one's page.
    const kit = me().kit;
    S.persona = el.value;
    S.sel.clear();
    S.asel.clear();
    if (me().kit !== kit && ['app', 'share'].includes(modeOf(route())) && location.hash !== '#/home') location.hash = '#/home';
    else render();
    toast(`Viewing as ${me().n}, ${me().role}`);
  }
  else if (a === 'pick') { S.sel[el.checked ? 'add' : 'delete'](el.dataset.id); render(); }
  else if (a === 'hold') { const k = CASES[el.dataset.id]; k.hold = el.checked; logOn(el.dataset.id, 'governance', `Legal hold ${k.hold ? 'set' : 'lifted'} by ${me().n}`); toast(k.hold ? 'Legal hold set: nothing in this case can be deleted' : 'Legal hold lifted'); render(); }
  else if (a === 'tf') { const tid = route()[1]; if (!mayDraft(tid)) return; S.tf[tid].decision = el.value; S.tf[tid].errors = {}; render(); const r = $(`#main input[name=decision][value="${el.value}"]`); r && r.focus(); }
  else if (DAM_CHANGE[a]) DAM_CHANGE[a](el);
  else if (a === 'ltype') { S.layoutType = el.value; const L = LAYOUTS[el.value]; S.layoutField = L ? (L.flatMap((c) => c.f || [])[0] || [''])[0] : ''; render(); }
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-act=tfv]');
  if (el && mayDraft(route()[1])) S.tf[route()[1]][el.dataset.k] = el.value;
  const d = ev.target.closest('[data-act]');
  if (d && DAM_INPUT[d.dataset.act]) DAM_INPUT[d.dataset.act](d);
});
document.addEventListener('submit', (ev) => {
  const act = ev.target.dataset.act;
  if (act === 'damq' || (act === 'gsearch' && me().kit === 'dam')) {
    ev.preventDefault();
    S.damq = ev.target.querySelector('input').value;
    if (location.hash !== '#/assets') location.hash = '#/assets';
    else render();
  } else if (act === 'gsearch') { ev.preventDefault(); location.hash = '#/search'; }
});
document.addEventListener('keydown', (e) => {
  const m = $('#modal').firstChild;
  if (e.key === 'Escape' && m) closeModal();
  if (e.key === 'Tab' && m) {
    const els = [...$('#modal').querySelectorAll('button,input,select,textarea,a[href]')].filter((x) => !x.hidden && !x.disabled);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); els.at(-1).focus(); }
    else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
  }
});
// `#main` is the skip link's target, never a page. The click handler stops the jump, but the
// fragment also arrives from a new tab, a bookmark or the address bar: give the page back its
// previous address and move focus to the content, as the skip link means to.
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') {
    history.replaceState(null, '', renderedHash || '#/start');
    $('#main').focus();
    return;
  }
  S.sel.clear();
  S.asel.clear();
  render();
});
if (location.hash === '#main') history.replaceState(null, '', '#/start');
render();
