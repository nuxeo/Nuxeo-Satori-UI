// @ts-check
/**
 * The spike's host page: plants fake session values, runs every load scenario the demo server
 * offers through the loader, and shows what the one accepted plugin reached, in the page and in a
 * sandboxed iframe.
 *
 * Spike code, served only by `tools/plugin-spike/dev/serve.mjs` on 127.0.0.1. The results are
 * also left on `window.spikeResults` for an automated look.
 */
import { browserLoaderHost, loadPlugin } from '../src/plugin-loader.mjs';

/** @typedef {import('../src/plugin-loader.mjs').LoadResult} LoadResult */
/** @typedef {{ name: string, expected: string, frame?: boolean, manifest: unknown }} Scenario */
/** @typedef {{ probe: string, reached: boolean | null, detail: string }} ProbeResult */

const FAKE_SESSION = 'FAKE-session-credential-not-a-secret';
const FAKE_BEARER = 'Bearer FAKE-bearer-token-not-a-secret';

/** @param {string} id */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from the host page`);
  return element;
}

/**
 * The host's own values, which only the host's code should read. Planted before any plugin loads.
 */
function plantFakes() {
  sessionStorage.setItem('spike_session', FAKE_SESSION);
  localStorage.setItem('spike_local', 'FAKE-local-value');
  document.cookie = 'spike_readable=FAKE-readable-cookie; SameSite=Strict; Path=/';
  // The host's own element, defined first, as the shell's are.
  customElements.define('spike-host-widget', class extends HTMLElement {});

  /** @type {Window & { spikeHost?: unknown }} */ (window).spikeHost = {
    nuxeoClient: {
      /** A stand-in for the host's Nuxeo client: one same-origin call, with no header of its own. */
      whoAmI() {
        return xhrJson('/api/whoami?caller=host-client');
      },
    },
  };
  byId('host-state').textContent =
    'Planted: a fake session in sessionStorage, a readable cookie, a fake host client on ' +
    'window.spikeHost, and (from the server) an HttpOnly session cookie.';
}

/**
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<unknown>}
 */
function xhrJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.addEventListener('load', () => resolve(JSON.parse(request.responseText)));
    request.addEventListener('error', () => reject(new Error(`XHR to ${url} failed`)));
    request.send();
  });
}

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/**
 * A `LoaderHost` whose executor runs the verified bundle inside a sandboxed iframe instead of this
 * page. The loader's checks are the same; only where the bytes run differs.
 *
 * @param {HTMLElement} slot
 * @returns {{ host: import('../src/plugin-loader.mjs').LoaderHost, report: Promise<ProbeResult[]> }}
 */
function framedLoaderHost(slot) {
  const inPage = browserLoaderHost(document, customElements);
  /** @type {PromiseWithResolvers<ProbeResult[]>} */
  const { promise: report, resolve: deliver } = Promise.withResolvers();
  let defined = false;
  return {
    report,
    host: {
      fetchBytes: inPage.fetchBytes,
      execute(url, integrity) {
        return new Promise((resolve, reject) => {
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', 'allow-scripts');
          frame.title = 'Sandboxed sample plugin';
          const params = new URLSearchParams({ parent: location.origin, url, integrity });
          frame.src = `/host/sandbox.html#${params}`;
          const timer = setTimeout(() => reject(new Error('the frame never answered')), 5000);
          window.addEventListener('message', (event) => {
            // An opaque-origin frame posts with origin "null"; the source is what identifies it.
            if (event.source !== frame.contentWindow || event.origin !== 'null') return;
            const data = event.data;
            if (data?.type === 'spike-frame-loaded') {
              clearTimeout(timer);
              defined = data.defined === true;
              if (data.error) reject(new Error(data.error));
              else resolve();
            } else if (data?.type === 'spike-plugin-report') {
              deliver(data.results);
            }
          });
          slot.append(frame);
        });
      },
      isDefined: () => defined,
    },
  };
}

/**
 * @param {Scenario} scenario
 * @param {LoadResult} result
 */
function renderRow(scenario, result) {
  const outcome = result.ok ? 'loaded' : result.reason;
  const row = document.createElement('tr');
  row.dataset.scenario = scenario.name;
  row.dataset.match = String(outcome === scenario.expected);
  for (const text of [
    scenario.name,
    scenario.expected,
    outcome === scenario.expected ? outcome : `${outcome} (UNEXPECTED)`,
    result.ok ? `<${result.element}> ${result.version} from ${result.url}` : result.detail,
  ]) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.append(cell);
  }
  byId('scenario-rows').append(row);
}

/**
 * @param {HTMLElement} list
 * @param {ProbeResult[]} results
 */
function renderReport(list, results) {
  for (const result of results) {
    const item = document.createElement('li');
    const verdict = result.reached === null ? 'not tried' : result.reached ? 'REACHED' : 'stopped';
    item.textContent = `${result.probe}: ${verdict}. ${result.detail}`;
    list.append(item);
  }
}

async function main() {
  plantFakes();
  const policy = await getJson('/spike/policy.json');
  /** @type {Scenario[]} */
  const scenarios = await getJson('/spike/scenarios.json');
  const results = [];
  /** @type {ProbeResult[] | null} */
  let inPageReport = null;
  /** @type {ProbeResult[] | null} */
  let framedReport = null;

  for (const scenario of scenarios) {
    if (scenario.frame) {
      const framed = framedLoaderHost(byId('framed-slot'));
      const result = await loadPlugin(scenario.manifest, policy, framed.host);
      renderRow(scenario, result);
      results.push({ name: scenario.name, expected: scenario.expected, result });
      if (result.ok) {
        framedReport = await framed.report;
        renderReport(byId('framed-report'), framedReport);
      }
      continue;
    }

    const result = await loadPlugin(
      scenario.manifest,
      policy,
      browserLoaderHost(document, customElements),
    );
    renderRow(scenario, result);
    results.push({ name: scenario.name, expected: scenario.expected, result });
    if (result.ok) {
      const element = document.createElement(result.element);
      const reported = new Promise((resolve) =>
        element.addEventListener('spike-plugin-report', (event) =>
          resolve(/** @type {CustomEvent<ProbeResult[]>} */ (event).detail),
        ),
      );
      byId('in-page-slot').append(element);
      // The host's own traffic, after the plugin is in: a request with a header set in JavaScript.
      await xhrJson('/api/whoami?caller=host', { Authorization: FAKE_BEARER });
      inPageReport = /** @type {ProbeResult[]} */ (await reported);
    }
  }

  const serverLog = await getJson('/api/whoami-log');
  const log = byId('server-log');
  for (const entry of serverLog) {
    const item = document.createElement('li');
    item.textContent = `${entry.caller}: origin ${entry.origin ?? '(none)'}, session cookie ${entry.cookie ? 'sent' : 'not sent'}, Authorization ${entry.authorization ? 'sent' : 'not sent'}`;
    log.append(item);
  }

  /** @type {Window & { spikeResults?: unknown }} */ (window).spikeResults = {
    scenarios: results,
    inPage: inPageReport,
    framed: framedReport,
    serverLog,
  };
  document.body.dataset.spikeDone = 'true';
}

main().catch((error) => {
  byId('host-state').textContent =
    `The host page failed: ${error instanceof Error ? error.message : error}`;
  document.body.dataset.spikeDone = 'error';
});
