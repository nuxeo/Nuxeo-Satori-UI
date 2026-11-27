import { defineRecordPanel } from './app/record-panel.element';
import { panelServerOf } from './app/panel-server';

// The panel's one script: a page includes it with one tag, and writes `<nuxeo-record-panel>`. The
// server it talks to is the one it was loaded from, read from its own address, never from the page.
const server = panelServerOf(import.meta.url);
if (server) {
  defineRecordPanel(server);
} else {
  console.error(
    "[nuxeo-record-panel] not defined: its script was not loaded from a Nuxeo server's /nuxeo/agentic-ui/embedded/ over https",
  );
}
