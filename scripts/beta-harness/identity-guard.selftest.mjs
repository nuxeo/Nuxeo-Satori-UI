#!/usr/bin/env node
/**
 * Offline controls for the identity guard (NXSAT-643): the judgement in `identity-guard.mjs` and
 * the step-boundary wiring in `helpers.mjs`, with no browser and no server.
 *
 * The live half — a real guest-enabled Nuxeo rejecting a dropped credential and an adopted guest
 * cookie — is `identity-guard.controls.mjs`. This half pins every rule those runs depend on, so a
 * guard edited into one that accepts `Anonymous`, ignores the stored session, or lets a step
 * boundary go unchecked turns this red without a server. Each negative control names the rule it
 * protects; the positives prove the guard does not reject good results, which would make it an
 * always-red gate that gets bypassed.
 *
 *   node scripts/beta-harness/identity-guard.selftest.mjs
 */

import { createHelpers, PreconditionError } from './helpers.mjs';
import {
  checkPageIdentity,
  createIdentityMonitor,
  isAnonymousMe,
  judgeApi,
  judgeApp,
  judgeMe,
  parseStoredSession,
  sameUser,
} from './identity-guard.mjs';

/** @type {{ name: string, kind: 'negative' | 'positive', ok: boolean, detail?: string }[]} */
const controls = [];
/**
 * @param {'negative' | 'positive'} kind
 * @param {string} name
 * @param {boolean} ok
 * @param {unknown} [detail]
 */
function control(kind, name, ok, detail) {
  controls.push({ name, kind, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });
}

const ADMIN = { 'entity-type': 'user', id: 'Administrator', isAnonymous: false };
const GUEST = { 'entity-type': 'user', id: 'Anonymous', isAnonymous: true };
const b64 = (s) => Buffer.from(s).toString('base64');
const basicSession = (username, basic = b64(`${username}:pw`)) =>
  JSON.stringify({ kind: 'basic', username, basic, isAdministrator: true, groups: [] });

// ── judgeMe ──────────────────────────────────────────────────────────────────────────────────────
control(
  'positive',
  'the expected user is accepted',
  judgeMe({ status: 200, body: ADMIN }, 'Administrator').problem === null,
);
control(
  'positive',
  'ids compare case-insensitively, as Nuxeo does',
  judgeMe({ status: 200, body: ADMIN }, 'administrator').problem === null,
);
control(
  'negative',
  'the guest is rejected by its flag',
  judgeMe({ status: 200, body: GUEST }, 'Administrator').problem !== null,
);
control(
  'negative',
  'the guest is rejected by its id when the flag is missing',
  judgeMe({ status: 200, body: { id: 'Anonymous' } }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a flagged guest is rejected under any id',
  judgeMe({ status: 200, body: { id: 'Administrator', isAnonymous: true } }, 'Administrator')
    .problem !== null,
);
control(
  'negative',
  'another user is rejected',
  judgeMe({ status: 200, body: { id: 'jdoe' } }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a 401 is rejected',
  judgeMe({ status: 401, body: null }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a non-200 is rejected even when its body names the user',
  judgeMe({ status: 500, body: ADMIN }, 'Administrator').problem !== null,
);
control(
  'negative',
  'no answer is rejected',
  judgeMe({ status: 0, body: null, error: 'ECONNREFUSED' }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a 200 with no id is rejected',
  judgeMe({ status: 200, body: {} }, 'Administrator').problem !== null,
);
control(
  'negative',
  'a 200 that is not JSON is rejected',
  judgeMe({ status: 200, body: null }, 'Administrator').problem !== null,
);
control(
  'negative',
  'expecting Anonymous proves nothing',
  judgeMe({ status: 200, body: GUEST }, 'Anonymous').problem !== null,
);
control(
  'negative',
  'expecting nobody proves nothing',
  judgeMe({ status: 200, body: ADMIN }, '').problem !== null,
);
control(
  'negative',
  'sameUser matches nothing for a non-string',
  !sameUser(undefined, undefined) && !sameUser('', ''),
);
control('positive', 'isAnonymousMe is false for a real user', !isAnonymousMe(ADMIN));

// ── stored sessions and the app channel ─────────────────────────────────────────────────────────
const parsed = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'sessionStorage',
  basicSession('Administrator', 'QUJD'),
);
control(
  'positive',
  'a basic session yields the header the app sends',
  !('problem' in parsed) &&
    parsed.authorization === 'Basic QUJD' &&
    parsed.username === 'Administrator',
  parsed,
);
const cookie = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'sessionStorage',
  JSON.stringify({ kind: 'cookie', username: 'Anonymous', isAdministrator: false, groups: [] }),
);
control(
  'positive',
  'a cookie session sends no header',
  !('problem' in cookie) && cookie.authorization === null,
  cookie,
);
const legacy = parseStoredSession(
  'agentic_ui_nuxeo_session',
  'localStorage',
  JSON.stringify({ username: 'Administrator', basic: 'QUJD' }),
);
control(
  'positive',
  'a stored value without kind but with basic is read as basic, as the app does',
  !('problem' in legacy) && legacy.kind === 'basic',
  legacy,
);
const template = parseStoredSession(
  'satori_template_session',
  'sessionStorage',
  JSON.stringify({ username: 'Administrator', basic: 'QUJD' }),
);
control(
  'positive',
  "the template app's session is read",
  !('problem' in template) && template.authorization === 'Basic QUJD',
  template,
);
control(
  'negative',
  'a value that is not JSON is a problem',
  'problem' in parseStoredSession('k', 'sessionStorage', '{'),
);
control(
  'negative',
  'a basic session with no basic is a problem',
  'problem' in
    parseStoredSession('k', 'sessionStorage', JSON.stringify({ kind: 'basic', username: 'x' })),
);

control(
  'positive',
  'no stored session is signed-out, and accepted',
  judgeApp(null, null, 'Administrator').state === 'signed-out',
);
control(
  'positive',
  'a basic session for the user, confirmed by /me, is accepted',
  judgeApp(parsed, { status: 200, body: ADMIN }, 'Administrator').ok,
);
control(
  'negative',
  "a guest's cookie session is rejected before /me is asked",
  !judgeApp(cookie, null, 'Administrator').ok,
);
control(
  'negative',
  'a basic session for the user that /me answers as the guest is rejected',
  !judgeApp(parsed, { status: 200, body: GUEST }, 'Administrator').ok,
);
control(
  'negative',
  'a session stored for another user is rejected even when /me agrees with the run',
  !judgeApp(
    parseStoredSession('agentic_ui_nuxeo_session', 'sessionStorage', basicSession('jdoe')),
    { status: 200, body: ADMIN },
    'Administrator',
  ).ok,
);
control(
  'negative',
  'an unreadable session is rejected',
  !judgeApp({ problem: 'x' }, null, 'Administrator').ok,
);
control(
  'negative',
  'the api channel rejects the guest',
  !judgeApi({ status: 200, body: GUEST }, 'Administrator').ok,
);

// ── a fake page, for the probes and the step boundaries ─────────────────────────────────────────
/**
 * Just enough of a Playwright `Page`: `url()`, `evaluate()` over a storage map and a `/me` answer
 * keyed on the header sent, `request.get()`, and `context().clearCookies()`.
 */
function fakePage({
  url = 'http://app.test/#/browse',
  storage = {},
  meFor = () => ADMIN,
  apiMe = ADMIN,
} = {}) {
  const state = { url, storage: { ...storage }, apiMe, meFor, evaluations: 0, headersSeen: [] };
  const page = {
    state,
    url: () => state.url,
    /**
     * Runs the real browser-side function against stand-ins for the globals it touches, so a
     * probe that stopped reading storage the way the app does, or stopped sending the session's
     * header, is caught here rather than only against a live server.
     */
    async evaluate(fn, arg) {
      state.evaluations++;
      const store = (area) => ({ getItem: (k) => state.storage[`${area}:${k}`] ?? null });
      const saved = ['sessionStorage', 'localStorage', 'fetch'].map((k) => [k, globalThis[k]]);
      const stand = {
        sessionStorage: store('sessionStorage'),
        localStorage: store('localStorage'),
        fetch: async (_url, init) => {
          const auth = init?.headers?.['Authorization'] ?? null;
          state.headersSeen.push(auth);
          return { status: 200, json: async () => state.meFor(auth) };
        },
      };
      for (const [k, v] of Object.entries(stand)) {
        Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
      }
      try {
        return await fn(arg);
      } finally {
        for (const [k, v] of saved) {
          Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
        }
      }
    },
    request: {
      async get() {
        return { status: () => 200, json: async () => state.apiMe };
      },
    },
    context: () => ({ clearCookies: async () => undefined }),
  };
  return page;
}

const signedIn = {
  'sessionStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD'),
};
{
  const page = fakePage({
    storage: signedIn,
    meFor: (auth) => (auth === 'Basic QUJD' ? ADMIN : GUEST),
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test');
  control(
    'positive',
    'the page probe sends the stored session header and accepts the user',
    r.ok && page.state.headersSeen[0] === 'Basic QUJD',
    r,
  );
}
{
  const page = fakePage({ storage: signedIn, meFor: () => GUEST });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test');
  control('negative', 'the page probe rejects a session the server answers as the guest', !r.ok, r);
}
{
  const page = fakePage({ url: 'about:blank', storage: signedIn, meFor: () => GUEST });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test');
  control(
    'positive',
    'a page off the app origin is not judged',
    r.ok && r.state === 'not-on-app' && page.state.evaluations === 0,
    r,
  );
}
{
  const page = fakePage({
    storage: { 'localStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD') },
    meFor: (auth) => (auth === 'Basic QUJD' ? ADMIN : GUEST),
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test');
  control(
    'positive',
    "a remembered (localStorage) session is read, as the app's fallback",
    r.ok && r.state === 'authenticated',
    r,
  );
}
{
  const page = fakePage({
    storage: {
      'sessionStorage:agentic_ui_nuxeo_session': JSON.stringify({
        kind: 'cookie',
        username: 'Anonymous',
      }),
      'localStorage:agentic_ui_nuxeo_session': basicSession('Administrator', 'QUJD'),
    },
  });
  const r = await checkPageIdentity(page, 'Administrator', 'http://app.test');
  control('negative', 'sessionStorage is read before localStorage, as the app reads it', !r.ok, r);
}

// ── step boundaries ─────────────────────────────────────────────────────────────────────────────
const quiet = console.log;
/** @param {() => Promise<void>} fn */
async function silently(fn) {
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = quiet;
  }
}

/** @param {ReturnType<typeof fakePage>} page */
function harness(page) {
  const recorder = { steps: [], consoleErrors: [] };
  const identity = createIdentityMonitor({
    page,
    baseUrl: 'http://app.test',
    username: 'Administrator',
  });
  return { recorder, identity, h: createHelpers(page, '/tmp', recorder, { identity }) };
}

await silently(async () => {
  {
    const page = fakePage({ storage: signedIn });
    const { h, identity, recorder } = harness(page);
    await h.step('one');
    h.check('c', true);
    await h.step('two');
    h.check('c', true);
    await h.finish();
    control(
      'positive',
      'awaited steps on a good session: every boundary checked, nothing recorded as failed',
      identity.checks.length === 2 &&
        identity.checks.every((c) => c.ok) &&
        recorder.steps.every((s) => s.checks.every((c) => c.passed)),
      { checks: identity.checks.map((c) => c.at), steps: recorder.steps },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    let thrown = null;
    try {
      await h.step('two');
    } catch (err) {
      thrown = err;
    }
    control(
      'negative',
      'a step that ended as the guest throws a PreconditionError at the next boundary',
      thrown instanceof PreconditionError && /after step 1/.test(thrown.message),
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, recorder } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    let thrown = null;
    try {
      await h.finish();
    } catch (err) {
      thrown = err;
    }
    control(
      'negative',
      'the last step is judged too, by finish()',
      thrown instanceof PreconditionError &&
        recorder.steps[0].checks.some((c) => !c.passed && /identity guard/.test(c.name)),
      { thrown: String(thrown), checks: recorder.steps[0].checks },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, recorder } = harness(page);
    await h.step('one');
    h.step('two'); // not awaited, on purpose
    await h.step('three');
    await h.finish();
    control(
      'negative',
      'an un-awaited step boundary is recorded as a failed check on its step',
      recorder.steps[0].checks.some((c) => !c.passed && /not awaited/.test(c.detail ?? '')),
      recorder.steps[0].checks,
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.meFor = () => GUEST;
    h.step('two'); // not awaited: its rejection must not be lost
    await new Promise((r) => setTimeout(r, 20));
    // Healed before the next boundary, so only the held failure can make it throw.
    page.state.meFor = () => ADMIN;
    let thrown = null;
    try {
      await h.step('three');
    } catch (err) {
      thrown = err;
    }
    control(
      'negative',
      'a boundary that failed while nobody awaited it is thrown at the next one',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h, identity } = harness(page);
    await h.step('one');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
    h.signedInAs('parity-user', 'selftest');
    await h
      .step('two')
      .then(() => h.finish())
      .catch(() => undefined);
    control(
      'positive',
      'a declared switch of browser identity is accepted and recorded',
      identity.checks.every((c) => c.ok) &&
        identity.switches.length === 1 &&
        identity.switches[0].username === 'parity-user',
      { checks: identity.checks, switches: identity.switches },
    );
  }
  {
    const page = fakePage({ storage: signedIn });
    const { h } = harness(page);
    await h.step('one');
    page.state.storage['sessionStorage:agentic_ui_nuxeo_session'] = basicSession(
      'parity-user',
      'UFU=',
    );
    page.state.meFor = (auth) => (auth === 'Basic UFU=' ? { id: 'parity-user' } : ADMIN);
    let thrown = null;
    try {
      await h.step('two');
    } catch (err) {
      thrown = err;
    }
    control(
      'negative',
      'an undeclared switch of browser identity is rejected',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn, apiMe: GUEST });
    const { h } = harness(page);
    await h.step('one');
    let thrown = null;
    try {
      await h.step('two');
    } catch (err) {
      thrown = err;
    }
    control(
      'negative',
      'page.request running as the guest is rejected',
      thrown instanceof PreconditionError,
      String(thrown),
    );
  }
  {
    const page = fakePage({ storage: signedIn, meFor: () => GUEST });
    const recorder = { steps: [], consoleErrors: [] };
    const h = createHelpers(page, '/tmp', recorder);
    await h.step('one');
    await h.step('two');
    await h.finish();
    control(
      'positive',
      'without a monitor (story-runner) steps are unguarded, as before',
      page.state.evaluations === 0,
    );
  }
});

const negatives = controls.filter((c) => c.kind === 'negative');
const failed = controls.filter((c) => !c.ok);
for (const c of controls) {
  console.log(`  [${c.ok ? 'pass' : 'FAIL'}] (${c.kind}) ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
}
console.log(
  failed.length
    ? `\nidentity-guard selftest: FAIL — ${failed.length} of ${controls.length} control(s) failed.`
    : `\nidentity-guard selftest: pass — ${controls.length} controls (${negatives.length} negative, ${controls.length - negatives.length} positive).`,
);
process.exit(failed.length ? 1 : 0);
