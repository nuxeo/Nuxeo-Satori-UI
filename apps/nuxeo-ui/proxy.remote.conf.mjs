/**
 * Dev-server proxy to a **hosted** Nuxeo (NXSAT-231), for the nightly E2E run.
 *
 * `proxy.conf.json` hard-codes `http://localhost:8080`, which is right for the local Docker
 * stack and impossible on a CI runner. This file is selected with
 * `ng serve nuxeo-ui -c development,remote` and leaves the local default untouched.
 *
 * `NUXEO_PROXY_TARGET` has no default on purpose: a silent fallback to localhost would make an
 * unconfigured nightly look like a Nuxeo outage, and a fallback to a hosted URL would point
 * a destructive suite at an environment nobody named.
 *
 * `Origin` is set to the Nuxeo origin itself, as the local file does and for the same reason: a
 * hosted Nuxeo's CORS filter answers a browser POST carrying `Origin: http://localhost:4200`
 * with an HTTP 403 page (first full E2E run, NXSAT-231: the app's `Document.Untrash` was
 * refused while the same call from an API context, which sends no Origin, succeeded). Reads
 * are unaffected, which is why only the write-path specs saw it. The browser still believes it
 * is talking to its own origin; only the upstream hop is rewritten.
 */
const target = process.env.NUXEO_PROXY_TARGET;

if (!target || !/^https?:\/\/[^/]+$/.test(target)) {
  throw new Error(
    'NUXEO_PROXY_TARGET must be set to the Nuxeo origin, e.g. https://host.example.com ' +
      '(scheme and host only, no path). There is deliberately no default.',
  );
}

export default {
  '/nuxeo': {
    target,
    secure: true,
    changeOrigin: true,
    autoRewrite: true,
    // `autoRewrite` fixes the host of a redirect `Location` but keeps the scheme, and a hosted
    // Nuxeo answers with `https://`. The browser then followed `https://localhost:4200/...` to a
    // dev server that speaks plain http, and the e2e identity guard saw API calls leave for a
    // foreign origin (first nightly run, NXSAT-231). The dev server is http, so say so.
    protocolRewrite: 'http',
    headers: { 'X-NXproperties': '*', Origin: target },
  },
};
