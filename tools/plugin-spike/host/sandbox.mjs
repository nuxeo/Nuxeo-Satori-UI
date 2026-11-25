// @ts-check
/**
 * Runs inside `<iframe sandbox="allow-scripts">`: loads the bundle the host already verified,
 * through the loader's own executor, so the browser checks these bytes against the same
 * `integrity` too, then places the element.
 *
 * The host passes the bundle's URL, its integrity and the host's own origin in the frame's
 * fragment. The fragment decides nothing beyond this frame's own behaviour: a wrong URL or
 * integrity only stops the frame loading, and the origin only decides where the report goes.
 */
import { browserLoaderHost } from '../src/plugin-loader.mjs';

const params = new URLSearchParams(location.hash.slice(1));
const parentOrigin = params.get('parent') ?? '';
const url = params.get('url') ?? '';
const integrity = params.get('integrity') ?? '';

/** @param {Record<string, unknown>} message */
function tellHost(message) {
  if (/^https?:\/\/[^/]+$/.test(parentOrigin)) window.parent.postMessage(message, parentOrigin);
}

const frame = browserLoaderHost(document, customElements);
frame.execute(url, integrity).then(
  () => {
    const defined = frame.isDefined('spike-sample-plugin');
    tellHost({ type: 'spike-frame-loaded', defined });
    if (defined) document.body.append(document.createElement('spike-sample-plugin'));
  },
  (error) => tellHost({ type: 'spike-frame-loaded', defined: false, error: String(error) }),
);
