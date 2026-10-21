/**
 * Page helpers shared by the Beta phase evidence harness.
 *
 * The `screenshot`, `step`, `login`, `goToDoc` and `baseUrl` members are a
 * deliberate superset of the contract the per-ticket steps files were written
 * against, so they can be reused verbatim by the phase runner. The bug-fix
 * capture (`scripts/collect-evidence/story-runner.mjs`) now uses these helpers
 * directly rather than keeping a second, weaker dialect of its own.
 *
 * The additions are the verification members — `check`, `expectVisible`,
 * `expectText`, `expectNoConsoleErrors`. A capture that records whatever
 * happened to be on screen proves nothing; every phase step must assert
 * something before it photographs it.
 */

import { resolve } from 'node:path';
import { requireNuxeoCredentials } from './nuxeo-credentials.mjs';

const DEFAULT_BASE_URL = 'http://localhost:4200';
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

/**
 * @typedef {object} StepRecord
 * @property {number} index
 * @property {string} label
 * @property {string[]} screenshots
 * @property {{ name: string, passed: boolean, detail?: string }[]} checks
 * @property {string[]} [notes] stated limitations, not assertions
 */

/**
 * Thrown by `requirePrecondition` when a steps file's stated environment does not
 * hold. The runner treats it as its own verdict rather than a failure, because the
 * two need different responses: a failed check means fix the code, an unmet
 * precondition means fix the environment or run a different steps file.
 */
export class PreconditionError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PreconditionError';
  }
}

/**
 * `NUXEO_USER` / `NUXEO_PASS` for a steps file, or a `PreconditionError` naming what is missing.
 *
 * There is no default (NXSAT-649) — see `nuxeo-credentials.mjs`. A `PreconditionError` rather
 * than a plain `Error`, because both runners key their verdict on it — `precondition-not-met`,
 * not `error`: a missing pair is the environment, and reporting it as `[error] steps aborted`
 * invites someone to change working code. Their exit codes differ: `phase-runner.mjs` exits 2,
 * while `story-runner.mjs` exits 1 for every `precondition-not-met` capture.
 *
 * Under either runner this rarely fires for `NUXEO_USER` / `NUXEO_PASS` themselves. Both refuse
 * a missing pair with exit 2 before any step runs, unless the file exported
 * `skipHttpCredentials = true`.
 *
 * @param {string} purpose completes "must both be set to …"
 * @returns {import('./nuxeo-credentials.mjs').NuxeoCredentials}
 */
export function requireStepCredentials(purpose) {
  return requireNuxeoCredentials(purpose, { errorClass: PreconditionError });
}

/**
 * Build the helpers object handed to a steps file.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} outDir absolute directory for screenshots
 * @param {object} recorder
 * @param {StepRecord[]} recorder.steps accumulating step records
 * @param {string[]} recorder.consoleErrors captured browser console errors
 * @param {object} [options]
 * @param {ReturnType<import('./identity-guard.mjs').createIdentityMonitor> | null} [options.identity]
 *   the identity guard (`phase-runner.mjs` passes one whenever the run sends credentials). With
 *   it, every step boundary asks Nuxeo who the previous step ran as; see `step`.
 */
export function createHelpers(page, outDir, recorder, { identity = null } = {}) {
  let current = null;
  /**
   * Every step boundary's identity check, in order, so `finish` can drain them all — not only the
   * latest. `awaited` is set when an `await` reads the boundary in time (see `step`).
   * @type {{ step: StepRecord, promise: Promise<void>, awaited: boolean, reported: boolean }[]}
   */
  const boundaries = [];
  /** A boundary that failed while nobody was awaiting it; thrown at the next step or at `finish`. */
  let identityFailure = null;
  /** A boundary that was not awaited, so it proves nothing about its step; thrown by `finish`. */
  let unawaitedFailure = null;

  function ensureStep() {
    if (!current) {
      current = { index: recorder.steps.length + 1, label: 'unlabelled', screenshots: [], checks: [], notes: [] };
      recorder.steps.push(current);
    }
    return current;
  }

  /**
   * Ask Nuxeo who `step`'s results were obtained as. A rejection is recorded on that step as a
   * failed precondition and thrown as a `PreconditionError`: the result is invalid, and the cause
   * is the environment or the harness, not the product.
   *
   * @param {StepRecord} step
   * @param {string} at
   */
  async function verifyIdentity(step, at) {
    if (!identity) return;
    const entry = await identity.verify(at);
    if (entry.ok) return;
    const detail = entry.reports
      .filter((r) => !r.ok)
      .map((r) => `[${r.channel}] ${r.problem}`)
      .join('; ');
    step.checks.push({ name: `precondition: identity guard ${at}`, passed: false, detail });
    console.log(`  [FAIL] precondition: identity guard ${at} - ${detail}`);
    throw new PreconditionError(
      `identity guard ${at}: the results were not obtained as the expected user, so they are invalid — ${detail}`,
    );
  }

  /**
   * Before a step opens, and in `finish`: record every boundary that was not awaited, then throw
   * a boundary failure nobody awaited.
   *
   * Not awaited, a boundary's check ran alongside the next step's work, so it may have judged
   * that work's identity instead of its own step's. Whether it has finished by now says nothing:
   * one that finished quickly ran alongside the next step just the same. So the step records a
   * failed check, the run's identity is rejected (`manifest.identity.valid: false`), and `finish`
   * makes the run `precondition-not-met`.
   */
  function closeBoundaries({ throwHeld = true } = {}) {
    for (const b of boundaries) {
      if (b.awaited || b.reported) continue;
      b.reported = true;
      const at = `after step ${b.step.index}`;
      const detail =
        `h.step(...) was not awaited, so the identity check ${at} ran alongside the next step and ` +
        'may have judged that step instead — write `await h.step(...)`';
      b.step.checks.push({ name: 'the identity guard ran between this step and the next', passed: false, detail });
      identity?.reject(at, detail);
      unawaitedFailure ??= new PreconditionError(`identity guard ${at}: ${detail}`);
    }
    if (throwHeld && identityFailure) throw identityFailure;
  }

  /**
   * `promise` as a thenable that marks `boundary` awaited when an `await` reads it in time.
   *
   * `await` reads `then` from a job of its own, after the caller's statement and before any timer
   * or I/O callback. So a read that comes while `sync.now` is set is a chained `.then()` /
   * `.catch()` — the boundary stays unawaited unless the chain itself is awaited, which is why
   * the chain is tracked too — and one after `sync.late` is set came after the next step's work
   * could start.
   *
   * Timing cannot tell an `await` from a discarded `Promise.all([h.step(...)])`, which reads `then`
   * from a job too. That is why the assertion audit requires every call to be `await h.step(...);`.
   *
   * @param {Promise<void>} promise
   * @param {{ awaited: boolean }} boundary
   * @param {{ now: boolean, late: boolean }} sync
   * @returns {PromiseLike<void> & Pick<Promise<void>, 'catch' | 'finally'>}
   */
  function tracked(promise, boundary, sync) {
    return {
      then(onFulfilled, onRejected) {
        if (!sync.now && !sync.late) boundary.awaited = true;
        const derived = promise.then(onFulfilled, onRejected);
        // Observed, not swallowed: an awaited chain still receives the rejection.
        derived.catch(() => undefined);
        return tracked(derived, boundary, sync);
      },
      catch(onRejected) {
        return this.then(undefined, onRejected);
      },
      finally(onFinally) {
        return this.then(
          (value) => Promise.resolve(onFinally?.()).then(() => value),
          (err) => Promise.resolve(onFinally?.()).then(() => Promise.reject(err)),
        );
      },
    };
  }

  return {
    baseUrl: process.env['APP_URL'] ?? DEFAULT_BASE_URL,

    /**
     * Open a new named step. Everything captured or asserted afterwards is
     * attributed to it, so the manifest reads as a narrative.
     *
     * Under the identity guard, opening a step is also where the previous one is judged: Nuxeo is
     * asked who it ran as before this step does anything (NXSAT-643). That check is asynchronous,
     * so a steps file must `await h.step(...)` — directly, or by awaiting a `.then()` chained on
     * it. Not awaited, the step still opens and the check runs alongside it, so it cannot speak
     * for the previous step: that step records a failed check, and the run ends
     * `precondition-not-met`. `finish` waits for every check either way.
     *
     * @param {string} msg
     * @returns {PromiseLike<void> & Pick<Promise<void>, 'catch' | 'finally'>}
     */
    step(msg) {
      closeBoundaries();
      const previous = current;
      current = { index: recorder.steps.length + 1, label: msg, screenshots: [], checks: [], notes: [] };
      recorder.steps.push(current);
      console.log(`\n[step ${current.index}] ${msg}`);
      if (!identity || !previous) return Promise.resolve();
      const promise = verifyIdentity(previous, `after step ${previous.index}`);
      const entry = { step: previous, promise, awaited: false, reported: false };
      boundaries.push(entry);
      // Held, so it is never an unhandled rejection: a failure nobody awaited is thrown at the next
      // boundary, or by `finish`. An `await` still receives it, through `tracked`.
      promise.catch((err) => {
        identityFailure ??= err;
      });
      const sync = { now: true, late: false };
      queueMicrotask(() => {
        sync.now = false;
      });
      setImmediate(() => {
        sync.late = true;
      });
      return tracked(promise, entry, sync);
    },

    /**
     * The guard's last word on a run whose steps all returned: the final step is judged the way
     * every earlier one was at its successor's `step` call. `phase-runner.mjs` calls this; a
     * steps file does not need to.
     */
    async finish() {
      // Every boundary drained before any failure is rethrown, so none is still running when the
      // runner closes the browser and writes the manifest.
      closeBoundaries({ throwHeld: false });
      await Promise.allSettled(boundaries.map((b) => b.promise));
      if (identityFailure) throw identityFailure;
      if (unawaitedFailure) throw unawaitedFailure;
      if (identity && current) await verifyIdentity(current, `after step ${current.index}`);
    },

    /**
     * Declare that from here on the browser is deliberately signed in as `username` — the
     * permission-denied steps sign in as a restricted user. Recorded in the manifest, so the
     * switch is part of the evidence. Without it the guard rejects the next boundary, which is
     * the point: an unannounced change of identity is exactly what it exists to catch.
     *
     * Only the app channel moves. `page.request` keeps the run's own credentials.
     *
     * @param {string} username
     * @param {string} reason
     */
    signedInAs(username, reason) {
      identity?.expectApp(username, reason, `step ${ensureStep().index}`);
      this.note(`identity: the browser is signed in as ${username} from here — ${reason}`);
    },

    /**
     * Declare that from here on the app may be signed out — a steps file that signs out to drive
     * the sign-in form. Recorded like `signedInAs`. Without it, a run that signed in and is found
     * signed out at a boundary is rejected: losing the session is one way to hide a result that was
     * obtained as someone else. A session the app still holds must be the run's own user.
     *
     * @param {string} reason
     */
    signedOut(reason) {
      identity?.expectSignedOut(reason, `step ${ensureStep().index}`);
      this.note(`identity: the app may be signed out from here — ${reason}`);
    },

    /**
     * Record a stated limitation — something this run deliberately does **not**
     * cover — without pretending it is an assertion.
     *
     * `check(name, true)` was being used for this, and the Phase 1 review named
     * that pattern as a defect: a check that cannot fail inflates the total while
     * certifying nothing. A note says the same thing honestly and stays out of the
     * count.
     *
     * @param {string} text
     */
    note(text) {
      const s = ensureStep();
      (s.notes ??= []).push(text);
      console.log(`  [note] ${text}`);
    },

    /**
     * Assert something about the *environment* that the rest of the steps file
     * depends on, and abort the run if it does not hold.
     *
     * This exists because of a real, misleading record in the evidence corpus. A
     * `phase-0-no-backend` run — a steps file whose own header says it "fails by
     * design against a live Nuxeo" — was run with Nuxeo up, and recorded 9 of 13
     * checks failed. Every failure had one cause: the precondition did not hold.
     * Nothing distinguished it from a run that found nine real defects.
     *
     * A precondition mismatch is not a failure to iterate on. Fix the environment,
     * or run the steps file that matches it.
     *
     * @param {string} name
     * @param {boolean} condition
     * @param {string} detail what to do about it, not just what went wrong
     */
    requirePrecondition(name, condition, detail) {
      const met = Boolean(condition);
      this.check(`precondition: ${name}`, met, detail);
      if (!met) throw new PreconditionError(`${name} — ${detail}`);
      return met;
    },

    /**
     * Capture a screenshot into the phase output directory.
     * @param {string} name descriptive slug, e.g. "browse-tree-expanded"
     * @param {import('@playwright/test').Locator} [locator] scrolled into view first
     * @returns {Promise<string>} absolute file path
     */
    async screenshot(name, locator) {
      const s = ensureStep();
      const slug = `${String(s.index).padStart(2, '0')}-${name}`;
      if (locator) {
        // Best effort: a locator that cannot scroll still gets the viewport shot below.
        await locator.scrollIntoViewIfNeeded().catch(() => {});
      }
      const file = resolve(outDir, `${slug}.png`);
      await page.screenshot({ path: file, fullPage: false });
      s.screenshots.push(`${slug}.png`);
      console.log(`  [shot] ${slug}.png`);
      return file;
    },

    /**
     * Record a named pass/fail assertion against the current step.
     * Never throws — the run continues so that the evidence set stays complete
     * and every failure is visible in one report rather than only the first.
     * @param {string} name
     * @param {boolean} condition
     * @param {string} [detail] shown in the report when the check fails
     */
    check(name, condition, detail) {
      const s = ensureStep();
      const passed = Boolean(condition);
      s.checks.push({ name, passed, ...(detail && !passed ? { detail } : {}) });
      console.log(`  [${passed ? 'pass' : 'FAIL'}] ${name}${passed || !detail ? '' : ` - ${detail}`}`);
      return passed;
    },

    /**
     * Assert a selector becomes visible, then record the result.
     * @param {string} name
     * @param {string} selector
     * @param {number} [timeout]
     */
    async expectVisible(name, selector, timeout = 10_000) {
      try {
        await page.locator(selector).first().waitFor({ state: 'visible', timeout });
        return this.check(name, true);
      } catch {
        return this.check(name, false, `selector not visible within ${timeout}ms: ${selector}`);
      }
    },

    /**
     * Assert that a selector's text contains an expected substring.
     * @param {string} name
     * @param {string} selector
     * @param {string} expected
     */
    async expectText(name, selector, expected) {
      try {
        const actual = (await page.locator(selector).first().innerText({ timeout: 10_000 })).trim();
        return this.check(name, actual.includes(expected), `expected "${expected}" in "${actual}"`);
      } catch {
        return this.check(name, false, `could not read text of ${selector}`);
      }
    },

    /**
     * Assert nothing was logged to the browser console as an error during the
     * run so far. Catches the class of regression a screenshot cannot show.
     *
     * `ignore` exists for errors that are genuinely environmental — a service
     * the local instance does not provide, for example. Every ignored error is
     * still counted and reported, so suppressions stay visible rather than
     * quietly hiding a regression.
     *
     * @param {string} [name]
     * @param {(string|RegExp)[]} [ignore] patterns matched against the error text
     */
    expectNoConsoleErrors(name = 'no browser console errors', ignore = []) {
      const matches = (text) =>
        ignore.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)));
      const all = recorder.consoleErrors;
      const ignored = all.filter(matches);
      const unexpected = all.filter((e) => !matches(e));
      if (ignored.length) {
        console.log(`  [note] ${ignored.length} console error(s) ignored by pattern`);
      }
      const suffix = ignored.length ? ` (${ignored.length} ignored by pattern)` : '';
      return this.check(
        name,
        unexpected.length === 0,
        `${unexpected.length} unexpected error(s)${suffix}: ${unexpected.slice(0, 3).join(' | ')}`,
      );
    },

    /**
     * Assert the current page has no WCAG 2.1 AA violations, via axe-core.
     *
     * The Beta bar is WCAG 2.1 AA (`docs/adf-hx-beta-plan.md`, Phase 6), and nothing
     * measured it. Only `serious` and `critical` impacts fail by default: `minor`
     * and `moderate` findings on a POC surface would make this unpassable, and a
     * gate that cannot pass gets bypassed. Every violation is still recorded, at
     * every impact, so the debt is visible rather than filtered away.
     *
     * `@axe-core/playwright` is installed the same way Playwright is — with
     * `--no-save`, so CI installs stay unaffected:
     *   npm install --no-save @axe-core/playwright
     *
     * @param {string} [name]
     * @param {object} [opts]
     * @param {string[]} [opts.ignore] axe rule ids to exclude from the verdict
     * @param {('minor'|'moderate'|'serious'|'critical')[]} [opts.failOn]
     * @param {string} [opts.include] CSS selector to scope the scan
     */
    async expectNoA11yViolations(name = 'no WCAG 2.1 AA violations', opts = {}) {
      const { ignore = [], failOn = ['serious', 'critical'], include } = opts;

      let AxeBuilder;
      try {
        ({ default: AxeBuilder } = await import('@axe-core/playwright'));
      } catch {
        // Deliberately a failed check, not a silent skip: a run that claims an
        // accessibility assertion and quietly did not make one is worse than a red.
        return this.check(
          name,
          false,
          '@axe-core/playwright is not installed, so no scan ran. `npm install --no-save @axe-core/playwright`',
        );
      }

      let results;
      try {
        let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
        if (include) builder = builder.include(include);
        results = await builder.analyze();
      } catch (err) {
        return this.check(name, false, `axe scan failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const violations = results.violations.filter((v) => !ignore.includes(v.id));
      const ignored = results.violations.filter((v) => ignore.includes(v.id));
      const blocking = violations.filter((v) => failOn.includes(v.impact));

      const s = ensureStep();
      // Recorded as notes so the full picture survives into the report without
      // inflating the check count with one entry per rule.
      for (const v of [...violations].sort((a, b) => a.impact.localeCompare(b.impact))) {
        const where = v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ');
        (s.notes ??= []).push(`a11y ${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s): ${where})`);
      }
      for (const v of ignored) {
        (s.notes ??= []).push(`a11y ignored by rule id: ${v.id} (${v.nodes.length} node(s))`);
      }
      if (violations.length) {
        console.log(`  [note] ${violations.length} a11y violation(s); ${blocking.length} at ${failOn.join('/')}`);
      }

      return this.check(
        name,
        blocking.length === 0,
        `${blocking.length} ${failOn.join('/')} violation(s): ${blocking.map((v) => v.id).join(', ')}` +
          ` (${violations.length - blocking.length} lower-impact recorded${ignored.length ? `, ${ignored.length} ignored` : ''})`,
      );
    },

    /**
     * Navigate to an app route, e.g. `/#/browse/default-domain`.
     * @param {string} route
     */
    async goTo(route) {
      const url = route.startsWith('http') ? route : `${this.baseUrl}${route}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
    },

    /**
     * Navigate directly to a document detail page.
     * @param {string} uid Nuxeo document UID
     */
    async goToDoc(uid) {
      await this.goTo(`/#/doc/${uid}`);
    },

    /**
     * Authenticate by injecting the session `AuthService` writes after a
     * successful login, avoiding the SSO UI. Credentials come from the
     * environment, with no default: unset, this throws a `PreconditionError`
     * rather than signing in as an identity nobody asked for. The comment here
     * said "never hardcoded" for as long as the two lines below it defaulted to
     * the local Docker administrator pair (NXSAT-649).
     *
     * The injected session is what the app's interceptor reads to put a Basic
     * header on its `/nuxeo` requests, so it authenticates the app's XHRs, not
     * only the route guard. The runner's `httpCredentials` reach `page.request`
     * and nothing in the browser: Nuxeo never challenges, so a challenge-based
     * credential is never sent (NXSAT-643; measured in `identity-guard.mjs`).
     *
     * The first navigation boots the app with no session, and on a server that
     * allows guests the app then stores `Anonymous` as a cookie session and
     * picks up a guest `JSESSIONID`. So the cookies are cleared, and the
     * storage overwritten, before the reload that signs in — a guest session
     * cannot be adopted. The identity guard checks the outcome at the next step
     * boundary.
     */
    async login() {
      const { username: user, password: pass } = requireStepCredentials('sign the evidence run in');

      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      const session = {
        kind: 'basic',
        username: user,
        basic: Buffer.from(`${user}:${pass}`).toString('base64'),
        isAdministrator: user.toLowerCase() === 'administrator',
        groups: [],
      };

      await page.context().clearCookies();
      await page.evaluate(
        ({ key, value, signedOutKey }) => {
          localStorage.removeItem(key);
          sessionStorage.setItem(key, value);
          sessionStorage.removeItem(signedOutKey);
        },
        { key: SESSION_KEY, value: JSON.stringify(session), signedOutKey: SIGNED_OUT_KEY },
      );
      identity?.expectApp(user, 'h.login()', `step ${ensureStep().index}`);
      // The boot above ran signed out; the session's requests start at the reload.
      identity?.sessionInstalled();

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
    },
  };
}
