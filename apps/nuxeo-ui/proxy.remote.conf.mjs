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
 * Unlike the local file this sends no `Origin` override. That header exists to satisfy a local
 * Nuxeo's CORS rules; forged against a hosted instance it would just be wrong.
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
    headers: { 'X-NXproperties': '*' },
  },
};
