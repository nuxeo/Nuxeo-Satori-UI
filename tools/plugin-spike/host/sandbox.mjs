// @ts-check
/**
 * Runs inside `<iframe sandbox="allow-scripts">`: loads the bundle the host already verified,
 * through the loader's own executor, so the browser checks these bytes against the same
 * `integrity` too, then places the element.
 *
 * **The frame takes no URL from its address.** The host names the bundle by its path in the
 * frame's fragment, and the frame runs only a path in `FRAME_BUNDLES`, its own fixed list, taking
 * the list's copy rather than the fragment's; anything else is refused before a script is made.
 * The executor then checks that path against the frame's own plugin store with `checkUrl`, as it
 * does for the host. The fragment's `integrity` only decides which bytes the browser will accept,
 * and its `parent` only where the report goes, and only an `http(s)` origin is answered.
 */
import { browserLoaderHost } from '../src/plugin-loader.mjs';

/** The bundles this frame may run, by path on its own server. */
const FRAME_BUNDLES = Object.freeze(['/plugins/frame/sample-plugin.js']);

const params = new URLSearchParams(location.hash.slice(1));
const parentOrigin = params.get('parent') ?? '';
const requested = params.get('bundle') ?? '';
const integrity = params.get('integrity') ?? '';

/** @param {Record<string, unknown>} message */
function tellHost(message) {
  if (/^https?:\/\/[^/]+$/.test(parentOrigin)) window.parent.postMessage(message, parentOrigin);
}

const bundle = FRAME_BUNDLES.find((candidate) => candidate === requested);
const store = `${location.origin}/plugins/`;
const frame = browserLoaderHost(document, customElements, {
  allowedUrlPrefixes: [store],
  baseUrl: `${location.origin}/`,
});

if (bundle === undefined) {
  tellHost({ type: 'spike-frame-loaded', defined: false, error: 'the frame runs no such bundle' });
} else {
  frame.execute(bundle, integrity).then(
    () => {
      const defined = frame.isDefined('spike-sample-plugin');
      tellHost({ type: 'spike-frame-loaded', defined });
      if (defined) document.body.append(document.createElement('spike-sample-plugin'));
    },
    (error) => tellHost({ type: 'spike-frame-loaded', defined: false, error: String(error) }),
  );
}
