// Interactions. Everything changes in memory only; a reload starts the demo again.
let onOk = null;
function ask(title, body, okLabel, fn, danger) {
  onOk = fn;
  modal(`<h2 id="dt">${title}</h2>${body}<div class="row end"><button data-act="close">Cancel</button><button class="${danger ? 'danger' : 'primary'}" data-act="ok">${okLabel}</button></div>`);
}
const logOn = (on, icon, t) => S.log.unshift({ on, icon, t });
const nextId = (map, prefix) => prefix + (Math.max(0, ...Object.keys(map).map((k) => Number(k.slice(prefix.length)) || 0)) + 1);
const personaOpts = (sel) => Object.entries(PERSONAS).map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(p.n)}, ${esc(p.role)}</option>`).join('');
function setState(id, to, extra, alsoUndo) {
  const c = CLAIMS[id], before = { ...c };
  c.state = to;
  Object.assign(c, extra || {});
  logOn(id, 'steps', `State changed to ${CLAIM_STATE_LABEL[to]} by ${me().n}`);
  toast(`${id} moved to ${CLAIM_STATE_LABEL[to]}`, () => { Object.assign(c, before); S.log.shift(); if (alsoUndo) alsoUndo(); });
}

function completeTask(id) {
  const t = TASKS[id], f = S.tf[id], e = {};
  if (!f.decision) e.decision = 'Choose a decision.';
  if (t.node === 'Determine' && f.decision === 'approve') {
    const v = Number(f.allowed), billed = CLAIMS[t.target].billed;
    if (f.allowed === '' || Number.isNaN(v)) e.allowed = 'Enter the allowed amount.';
    else if (v > billed) e.allowed = `The allowed amount cannot be more than the billed ${moneyText(billed)}.`;
  }
  if (t.node === 'Determine' && f.decision === 'deny' && !f.reason) e.reason = 'Choose a denial reason. It is required when you deny a claim.';
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
      if (f.decision === 'approve') setState(t.target, 'approved', { allowed: Number(f.allowed) }, reopen);
      else if (f.decision === 'deny') setState(t.target, 'denied', { denial: f.reason, allowed: 0 }, reopen);
      else setState(t.target, 'pended', null, reopen);
    } else setState(t.target, f.decision === 'approve' ? 'approved' : 'inReview', f.decision === 'approve' ? { allowed: c.billed } : {}, reopen);
  } else {
    logOn(t.target, 'circle_check', `${t.n} completed by ${me().n}: ${f.decision}`);
    toast(`${t.n} completed`, () => { reopen(); S.log.shift(); });
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
  if (['pick', 'hold', 'tf', 'persona', 'ltype', 'noop', 'tfv'].includes(a)) return; // handled on change
  if (el.tagName === 'A' && a !== 'read' && a !== 'go-app' && a !== 'go-docs') ev.preventDefault();
  switch (a) {
    case 'close': closeModal(); break;
    case 'ok': { const keep = onOk && onOk($('#modal')) === false; if (!keep) { closeModal(); render(); } break; }
    case 'toast': toast(el.dataset.msg); break;
    case 'take': {
      const c = CLAIMS[id];
      c.assignee = S.persona;
      if (c.state === 'submitted') c.state = 'inReview';
      logOn(id, 'user_task', `Taken by ${me().n}`);
      toast(`${id} is yours`, () => { c.assignee = null; c.state = 'submitted'; S.log.shift(); });
      render();
      break;
    }
    case 'assign': case 'reassign': case 'bulk-assign': {
      const ids = a === 'bulk-assign' ? [...S.sel] : a === 'reassign' ? [TASKS[id].target] : [id];
      ask('Assign to', `<label class="f"><span>Person</span><select id="as">${personaOpts('dana')}</select></label><p class="muted">${ids.length} item${ids.length > 1 ? 's' : ''}. The server refuses it if the workflow step does not allow reassignment.</p>`, 'Assign', (d) => {
        const p = d.querySelector('#as').value;
        ids.forEach((x) => { if (CLAIMS[x]) CLAIMS[x].assignee = p; if (a === 'reassign') TASKS[id].who = p; logOn(x, 'reassign', `Assigned to ${PERSONAS[p].n} by ${me().n}`); });
        S.sel.clear();
        toast(`Assigned to ${PERSONAS[p].n}`);
      });
      break;
    }
    case 'bulk-all': {
      const n = Number(el.dataset.n);
      ask(`Update all ${n} results?`, `<label class="f"><span>Set</span><select><option>Assignee to Dana Lee</option><option>Priority to high</option></select></label><p class="muted">Runs on the server over the queue’s whole query, through the Bulk Action Framework, not only the rows on screen.</p><div class="meter" id="bm" hidden><i style="width:0"></i></div>`, 'Run', (d) => {
        const m = d.querySelector('#bm'), bar = m.querySelector('i');
        m.hidden = false;
        let p = 0;
        const t = setInterval(() => { p += 25; bar.style.width = p + '%'; if (p >= 100) { clearInterval(t); closeModal(); S.sel.clear(); render(); toast(`Updated ${n} items`); } }, 250);
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
          setState(id, to, { denial: v, allowed: 0 });
        }, true);
      } else { setState(id, to); render(); }
      break;
    }
    case 'op-records': {
      const rec = CLAIMS[id] ? PROVIDERS[CLAIMS[id].provider].n : 'Summit Health Partners';
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
      ask(`Edit ${esc(m.first + ' ' + m.last)}`, `<div class="grid2" style="gap:0 12px"><label class="f"><span>First name (required)</span><input type="text" id="fn" value="${esc(m.first)}"></label><label class="f"><span>Last name (required)</span><input type="text" value="${esc(m.last)}"></label></div><label class="f"><span>Date of birth</span><input type="date" value="${m.dob}"></label><label class="f"><span>Phone</span><input type="text" value="${esc(m.phone)}"></label><label class="f"><span>Street</span><input type="text" value="${esc(m.street)}"></label><div class="grid2" style="gap:0 12px"><label class="f"><span>City</span><input type="text" value="${esc(m.city)}"></label><label class="f"><span>ZIP (5 digits)</span><input type="text" id="zip" value="${m.zip}"></label></div><div class="err" id="zipe"></div>`, 'Save', (d) => {
        const z = d.querySelector('#zip');
        if (!/^\d{5}$/.test(z.value)) { z.setAttribute('aria-invalid', 'true'); d.querySelector('#zipe').textContent = 'Enter a 5-digit ZIP code.'; z.focus(); return false; }
        m.zip = z.value;
        m.first = d.querySelector('#fn').value || m.first;
        toast('Saved. Only the changed properties were sent.');
      });
      break;
    }
    case 'edit-claim': {
      const c = CLAIMS[id];
      ask(`Edit ${id}`, `<label class="f"><span>Allowed amount, USD (at most ${moneyText(c.billed)})</span><input type="number" id="al" value="${c.allowed ?? ''}"></label><div class="err" id="ale"></div>${c.state === 'denied' ? `<label class="f"><span>Denial reason (shown because the claim is denied)</span><select>${DENIAL_REASONS.map(([k, l]) => `<option ${k === c.denial ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}`, 'Save', (d) => {
        const f = d.querySelector('#al'), v = Number(f.value);
        if (f.value !== '' && v > c.billed) { f.setAttribute('aria-invalid', 'true'); d.querySelector('#ale').textContent = 'The allowed amount cannot be more than the billed amount.'; f.focus(); return false; }
        c.allowed = f.value === '' ? null : v;
        toast('Saved');
      });
      break;
    }
    case 'start-case':
      ask('Start a case', `<label class="f"><span>Type</span><select id="ct"><option>Grievance</option><option>Appeal</option></select></label><label class="f"><span>About claim</span><select id="cc">${Object.entries(CLAIMS).filter(([, c]) => c.member === id).map(([k]) => `<option>${k}</option>`).join('')}</select></label>`, 'Start', (d) => {
        const n = nextId(CASES, 'CASE-');
        CASES[n] = { title: d.querySelector('#ct').value + ' for ' + mName(id), type: d.querySelector('#ct').value, member: id, claim: d.querySelector('#cc').value, state: 'open', rcvd: '2026-11-21', due: '2026-12-21', assignee: S.persona, hold: false, determination: null, people: [[S.persona, 'Owner']], checklist: [['Member statement', null]], timeline: [['2026-11-21', 'gavel', 'Case started from the member page', me().n]] };
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
    case 'go-app': S.persona = { claims: 'dana', appeals: 'sam', service: 'riley' }[id] || 'dana'; S.sel.clear(); render(); break;
    case 'go-docs': break;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'persona') { S.persona = el.value; S.sel.clear(); render(); toast(`Viewing as ${me().n}, ${me().role}`); }
  else if (a === 'pick') { S.sel[el.checked ? 'add' : 'delete'](el.dataset.id); render(); }
  else if (a === 'hold') { const k = CASES[el.dataset.id]; k.hold = el.checked; logOn(el.dataset.id, 'governance', `Legal hold ${k.hold ? 'set' : 'lifted'} by ${me().n}`); toast(k.hold ? 'Legal hold set: nothing in this case can be deleted' : 'Legal hold lifted'); render(); }
  else if (a === 'tf') { const tid = route()[1]; S.tf[tid].decision = el.value; S.tf[tid].errors = {}; render(); const r = $(`#main input[name=decision][value="${el.value}"]`); r && r.focus(); }
  else if (a === 'ltype') { S.layoutType = el.value; const L = LAYOUTS[el.value]; S.layoutField = L ? (L.flatMap((c) => c.f || [])[0] || [''])[0] : ''; render(); }
});
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-act=tfv]');
  if (el) S.tf[route()[1]][el.dataset.k] = el.value;
});
document.addEventListener('submit', (ev) => {
  if (ev.target.dataset.act === 'gsearch') { ev.preventDefault(); location.hash = '#/search'; }
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
  render();
});
if (location.hash === '#main') history.replaceState(null, '', '#/start');
render();
