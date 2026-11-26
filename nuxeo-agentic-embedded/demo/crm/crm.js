// The CRM's side of the panel's handshake: when the panel says it is ready, or that its token has
// expired, the CRM asks its own server for a token for its signed-in user, and gives it to that
// panel with postMessage, on its own origin. The token is never written into the page, an attribute
// or a URL; the CRM's server never gives the page its client secret or the assertion.
const READY = 'nuxeo-record-panel:ready';
const EXPIRED = 'nuxeo-record-panel:token-expired';
const TOKEN = 'nuxeo-record-panel:token';

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || (data.type !== READY && data.type !== EXPIRED) || typeof data.panel !== 'string') {
    return;
  }
  const answer = await fetch('/crm/nuxeo-token', { method: 'POST' });
  if (!answer.ok) return;
  const { token } = await answer.json();
  window.postMessage({ type: TOKEN, panel: data.panel, token }, window.location.origin);
});
