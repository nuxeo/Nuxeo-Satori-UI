/**
 * Phase 7, demo step 2: **the same panel inside a CRM page.**
 *
 * The claim: a page of another system shows a record page's panel, the claim's summary card and
 * its card from the core system, drawn by the layout engine inside `<nuxeo-record-panel>`, which
 * the page includes with one script tag; the panel signs in with a token the page's own server
 * exchanged for its user, given to the panel by `postMessage`, sent only in a header; the panel
 * refuses a page, and a frame, of an origin the configuration does not name; and its styles and the
 * page's do not meet.
 *
 * ## Against a stand-in, not the add-on
 *
 * The local Nuxeo is read-only here and has no `nuxeo-agentic-embedded`, so this runs against the
 * demo's stand-in (`nuxeo-agentic-embedded/demo/demo.mjs`), which this file starts itself:
 * a stand-in Nuxeo that serves the panel's built files, the host's origins, the exchange, a claim,
 * its type, its layout and `Connector.Read`; and a fictional CRM. The stand-in mirrors the add-on's
 * rules where the panel meets them, and **is not the add-on**: what proves the exchange and the
 * guard is the add-on's Java tests. What this proves is **the panel, in a real browser**, against
 * an interface shaped as the add-on's.
 *
 * ## Which checks are load-bearing, and which are not
 *
 * **Load-bearing**, each failing if the thing it names does not work:
 *
 * - Step 2: the panel draws the claim's card from Nuxeo and its card from the core system, through
 *   the layout engine, inside the CRM page; only the cards the page names.
 * - Step 3: the exchange is the CRM server's alone, with Basic credentials and no Origin; every REST
 *   API request carries the token as a Bearer header; none sends a cookie; no address holds the
 *   token; the token is nowhere in the page's markup.
 * - Step 4: the CRM's loud heading styles do not reach the panel's headings; the CRM's own elements
 *   keep them; the page's root element is left as it was.
 * - Step 5: a frame of another origin on the page posts a token to the panel, with the panel's own
 *   id, and the panel never uses it. Seen failing: with the panel's origin and source checks taken
 *   out, the panel sent the frame's token.
 * - Step 6: the same page on an origin the host does not name: the panel refuses to draw, asks for
 *   no token, and reads nothing. Two layers hold it, and this step passes while either does: the
 *   server answers that page's lookup of the host's origins with a 404, and the panel checks its
 *   page's origin against the origins it is given. With the panel's check taken out the step stayed
 *   green, on the server's 404; the panel's own check is `record-panel.component.spec.ts`'s
 *   "refuses a page the configuration does not name", which goes red without it.
 * - Step 7: a token the server refuses as expired is replaced through the handshake, and the
 *   record is drawn with the fresh one.
 *
 * **Negative**: step 8, no browser console errors but the two refusals steps 6 and 7 provoke on
 * purpose, a 404 and a 401.
 *
 * That is 6 load-bearing steps and 1 negative one, after the set-up.
 *
 * ## What this deliberately does not cover
 *
 * - The add-on on a server: no Nuxeo here runs it (its README, "Not done, and not checked").
 * - A write refused: the stand-in's scope rule is its own mirror of `PanelScope`, so a check on it
 *   would certify the stand-in. `PanelScopeTest` and `PanelTokenGuardTest` are the proof.
 *
 * Prerequisites, with no Nuxeo:
 *   npx nx build nuxeo-embedded-panels
 *   EVIDENCE_HEADLESS=1 npm run beta:evidence -- embedded-panels
 * Ports 18093 and 18094 on the loopback interface must be free.
 */

import { startDemo } from '../../../nuxeo-agentic-embedded/demo/demo.mjs';

/** No Nuxeo, so no credentials: the stand-in signs nobody in with them. */
export const skipHttpCredentials = true;

const NUXEO_PORT = 18093;
const CRM_PORT = 18094;
const TOKEN_TYPE = 'nuxeo-record-panel:token';
const READY = 'nuxeo-record-panel:ready';

/** What the panel shows: its state, its cards' fields, and its card headings' styles. */
async function panelOn(page) {
  return page.evaluate(() => {
    const host = document
      .querySelector('nuxeo-record-panel')
      ?.shadowRoot?.querySelector('.nuxeo-record-panel');
    const root = host?.shadowRoot ?? null;
    const heading = root?.querySelector('.record-page h2, .record-page h3, .record-page h4') ?? null;
    const style = heading ? getComputedStyle(heading) : null;
    return {
      state: root?.querySelector('.record-panel')?.getAttribute('data-state') ?? null,
      fields: [...(root?.querySelectorAll('[data-field]') ?? [])].map((element) => ({
        field: element.getAttribute('data-field'),
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
      heading: heading
        ? {
            text: (heading.textContent ?? '').trim(),
            color: style.color,
            font: style.fontFamily,
            transform: style.textTransform,
          }
        : null,
    };
  });
}

async function waitForState(page, states, timeout = 20_000) {
  await page
    .waitForFunction(
      (wanted) => {
        const host = document
          .querySelector('nuxeo-record-panel')
          ?.shadowRoot?.querySelector('.nuxeo-record-panel');
        const state = host?.shadowRoot?.querySelector('.record-panel')?.getAttribute('data-state');
        if (state !== 'ready') return wanted.includes(state);
        // Drawn, and its card from the core system has answered.
        return wanted.includes(state) && !!host.shadowRoot.querySelector('[data-field="paymentStatus"]');
      },
      states,
      { timeout },
    )
    .catch(() => undefined);
}

const fieldText = (shown, name) => shown.fields.find((field) => field.field === name)?.text ?? '';

export default async function run(page, h) {
  await h.step('Set up: the stand-in Nuxeo and the fictional CRM');
  let demo = null;
  try {
    demo = await startDemo({ nuxeoPort: NUXEO_PORT, crmPort: CRM_PORT });
  } catch (error) {
    h.requirePrecondition(
      'the panel is built and ports 18093 and 18094 are free',
      false,
      String(error?.message ?? error),
    );
  }
  // The panel's ready messages, as the page receives them: its id is what a forged token would name.
  await page.addInitScript((ready) => {
    window.__panelIds = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type === ready) window.__panelIds.push(event.data.panel);
    });
  }, READY);

  try {
    // -----------------------------------------------------------------------
    await h.step('The CRM page shows the claim panel, read through the server as the CRM user');
    await page.goto(`${demo.crmOrigin}/`);
    await waitForState(page, ['ready']);
    const shown = await panelOn(page);
    h.check('the panel drew the record page', shown.state === 'ready', `state: ${shown.state}`);
    h.check(
      'the claim card shows the claim number, from Nuxeo',
      fieldText(shown, 'claim:number').includes('CLAIM-000130'),
      JSON.stringify(shown.fields),
    );
    h.check(
      'the card from the core system shows the payment status, through Connector.Read',
      fieldText(shown, 'paymentStatus').includes('Paid') &&
        fieldText(shown, 'policyNumber').includes('POL-FICT-0048'),
      JSON.stringify(shown.fields),
    );
    h.check(
      'only the cards the page names are drawn: the layout notes card is not',
      shown.fields.length > 0 && !shown.fields.some((field) => field.field === 'dc:description'),
      JSON.stringify(shown.fields.map((field) => field.field)),
    );
    await h.screenshot('crm-page-with-the-claim-panel');

    // -----------------------------------------------------------------------
    await h.step('The token: exchanged server to server, then sent in a header only');
    const exchanges = demo.log.filter((entry) => entry.path === '/nuxeo/agentic-embedded/v1/token');
    h.check(
      'the exchange is the CRM server alone, with Basic credentials and no Origin',
      exchanges.length === 1 && exchanges.every((entry) => entry.basic && entry.origin === null),
      JSON.stringify(exchanges),
    );
    const api = demo.log.filter(
      (entry) =>
        entry.server === 'nuxeo' && entry.path.startsWith('/nuxeo/api/v1/') && entry.method !== 'OPTIONS',
    );
    h.check(
      'every REST API request carried the token as a Bearer header',
      api.length >= 3 && api.every((entry) => entry.bearer !== null),
      `${api.length} requests: ${api.map((entry) => `${entry.method} ${entry.path} ${Boolean(entry.bearer)}`).join(', ')}`,
    );
    h.check(
      'no request to the server sent a cookie',
      demo.log.filter((entry) => entry.server === 'nuxeo').every((entry) => !entry.cookie),
    );
    const tokens = [...new Set(api.map((entry) => entry.bearer))];
    h.check(
      'no address requested held the token',
      tokens.length === 1 &&
        demo.log.every((entry) => !tokens.some((token) => `${entry.path}?${entry.query}`.includes(token))),
    );
    const markup = await page.evaluate(() => {
      const outer = document
        .querySelector('nuxeo-record-panel')
        ?.shadowRoot?.querySelector('.nuxeo-record-panel');
      return `${document.documentElement.outerHTML}${outer?.shadowRoot?.innerHTML ?? ''}`;
    });
    h.check(
      'the token is in no attribute and nowhere in the page markup',
      tokens.length === 1 && !markup.includes(tokens[0]),
    );

    // -----------------------------------------------------------------------
    await h.step('Styles: the CRM ones stop at the shadow root, and the panel ones stay inside it');
    const page_ = await page.evaluate(() => {
      const heading = getComputedStyle(document.querySelector('.crm-heading'));
      const button = getComputedStyle(document.querySelector('.crm-button'));
      return {
        heading: { color: heading.color, font: heading.fontFamily, transform: heading.textTransform },
        button: button.backgroundColor,
        rootClass: document.documentElement.className,
        rootStyle: document.documentElement.getAttribute('style'),
      };
    });
    const panelHeading = (await panelOn(page)).heading;
    h.check(
      'the CRM red, monospace, upper-case headings do not reach the panel card headings',
      panelHeading !== null &&
        panelHeading.color !== 'rgb(200, 0, 0)' &&
        !/courier/i.test(panelHeading.font) &&
        panelHeading.transform !== 'uppercase',
      JSON.stringify(panelHeading),
    );
    h.check(
      'the CRM own headings and button keep the CRM styles',
      page_.heading.color === 'rgb(200, 0, 0)' &&
        /courier/i.test(page_.heading.font) &&
        page_.button === 'rgb(255, 230, 0)',
      JSON.stringify(page_),
    );
    h.check(
      'the panel leaves the page root element as it was: no class, no style',
      page_.rootClass === '' && page_.rootStyle === null,
      JSON.stringify({ rootClass: page_.rootClass, rootStyle: page_.rootStyle }),
    );
    // No shot: step 2's shows the same page; these checks read the computed styles.

    // -----------------------------------------------------------------------
    await h.step('Origins: a frame of another origin on the page cannot give the panel a token');
    const [panelId] = await page.evaluate(() => window.__panelIds);
    const frame = page.frames().find((each) => each.url().startsWith(`${demo.otherOrigin}/`));
    h.requirePrecondition('the CRM page shows a frame of another origin', Boolean(frame), page.url());
    const forged = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJBZG1pbmlzdHJhdG9yIn0.Zm9yZ2Vk';
    const before = demo.log.length;
    await frame.evaluate(
      ({ type, panel, token }) => window.parent.postMessage({ type, panel, token }, '*'),
      { type: TOKEN_TYPE, panel: panelId, token: forged },
    );
    await page.waitForTimeout(1500);
    h.check(
      'the frame named the panel own id, and the panel never sent its token',
      typeof panelId === 'string' && panelId.length > 0 && !demo.log.some((entry) => entry.bearer === forged),
      `panel id ${panelId}; ${demo.log.length - before} requests since`,
    );
    h.check('the panel still shows the claim', (await panelOn(page)).state === 'ready');

    // -----------------------------------------------------------------------
    await h.step('Origins: the same page on an origin the configuration does not name is refused');
    const exchangesBefore = demo.exchanges();
    const logBefore = demo.log.length;
    await page.goto(`${demo.otherOrigin}/`);
    await waitForState(page, ['refused']);
    const refused = await panelOn(page);
    const since = demo.log.slice(logBefore);
    h.check('the panel refuses to draw on that page', refused.state === 'refused', `state: ${refused.state}`);
    h.check(
      'it asked that page for no token: the CRM exchanged none',
      !since.some((entry) => entry.path === '/crm/nuxeo-token') && demo.exchanges() === exchangesBefore,
      JSON.stringify(since.map((entry) => `${entry.server} ${entry.method} ${entry.path} ${entry.status}`)),
    );
    h.check(
      'the server gave that page no origins and no data',
      since.some((entry) => entry.path === '/nuxeo/agentic-embedded/v1/hosts/crm' && entry.status === 404) &&
        !since.some((entry) => entry.path.startsWith('/nuxeo/api/') || entry.path.startsWith('/nuxeo/agentic-ui-config/')),
    );
    await h.screenshot('refused-on-an-origin-the-host-does-not-name');

    // -----------------------------------------------------------------------
    await h.step('Expiry: a token the server refuses is replaced through the handshake');
    const exchangesAtStart = demo.exchanges();
    const logAtStart = demo.log.length;
    demo.expireNextToken();
    await page.goto(`${demo.crmOrigin}/`);
    await waitForState(page, ['ready']);
    const reads = demo.log
      .slice(logAtStart)
      .filter((entry) => entry.method === 'GET' && entry.path === `/nuxeo/api/v1/id/${demo.claimId}`);
    h.check(
      'the first read was refused 401, and the second, with a fresh token, answered',
      reads.length === 2 &&
        reads[0].status === 401 &&
        reads[1].status === 200 &&
        reads[0].bearer !== reads[1].bearer,
      JSON.stringify(reads.map((entry) => entry.status)),
    );
    h.check(
      'the panel asked its page again, and the CRM exchanged once more, then drew the record',
      demo.exchanges() - exchangesAtStart === 2 && (await panelOn(page)).state === 'ready',
      `exchanges: ${demo.exchanges() - exchangesAtStart}`,
    );
    // No shot: the record redrawn looks as step 2's does; the log above is what shows the refresh.

    // -----------------------------------------------------------------------
    await h.step('Health');
    h.note(
      'Steps 6 and 7 provoke two refusals on purpose: the host origins refused to a page they do not name (404), and an expired token (401).',
    );
    h.expectNoConsoleErrors('no browser console errors but the refusals provoked on purpose', [
      /^HTTP 404 \/nuxeo\/agentic-embedded\/v1\/hosts\/crm$/,
      new RegExp(`^HTTP 401 /nuxeo/api/v1/id/${demo.claimId}$`),
    ]);
  } finally {
    await demo?.close();
  }
}
