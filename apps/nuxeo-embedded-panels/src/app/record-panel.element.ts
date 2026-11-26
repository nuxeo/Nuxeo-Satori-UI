import { type ApplicationRef, type ComponentRef, createComponent } from '@angular/core';
import { createApplication } from '@angular/platform-browser';

import { panelProviders } from './panel-providers';
import { type PanelServer } from './panel-server';
import { RecordPanelComponent } from './record-panel.component';

/** The element a page writes to show a record's panel. */
export const PANEL_TAG = 'nuxeo-record-panel';

/** A language tag: `en`, `fr`, `pt-BR`. */
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/** The cards an attribute names: ids, separated by commas or spaces; `null` for all of them. */
export function cardsOf(value: string | null): readonly string[] | null {
  if (value === null) return null;
  const ids = value
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id));
  return ids.length > 0 ? ids : null;
}

/**
 * The panel's language, as the application's catalogues are named, by the language alone: its own
 * `lang`, else the page's, else English. Read when the panel starts.
 */
export function languageOf(element: HTMLElement): string {
  for (const candidate of [
    element.getAttribute('lang'),
    element.ownerDocument.documentElement.lang,
  ]) {
    if (candidate && LANGUAGE.test(candidate))
      return (candidate.split('-')[0] ?? 'en').toLowerCase();
  }
  return 'en';
}

/**
 * Defines `<nuxeo-record-panel>`, once per page:
 *
 * ```html
 * <script type="module" src="https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/main.js"></script>
 * <nuxeo-record-panel host="crm" record-id="…" cards="claim,payment"></nuxeo-record-panel>
 * ```
 *
 * Its attributes are what is not secret: the host's id, the record's id, the cards, a language. The
 * token is never one: the page gives it through the handshake (`panel-handshake.ts`). The element
 * holds a shadow root of its own, and the panel's application draws in a shadow root of its own
 * inside it, so that neither the page's styles reach the panel nor the panel's the page. Each
 * element has its own application, started when it is added to the page and destroyed when it is
 * removed, with its token.
 */
export function defineRecordPanel(
  server: PanelServer,
  registry: CustomElementRegistry = customElements,
): void {
  if (registry.get(PANEL_TAG)) return;

  class NuxeoRecordPanelElement extends HTMLElement {
    static readonly observedAttributes = ['record-id', 'host', 'cards'];

    private readonly root: ShadowRoot;
    private application: ApplicationRef | null = null;
    private component: ComponentRef<RecordPanelComponent> | null = null;
    private generation = 0;

    constructor() {
      super();
      this.root = this.attachShadow({ mode: 'open' });
    }

    connectedCallback(): void {
      void this.start(++this.generation);
    }

    disconnectedCallback(): void {
      this.generation++;
      this.stop();
    }

    attributeChangedCallback(): void {
      this.push();
    }

    private async start(generation: number): Promise<void> {
      this.stop();
      const application = await createApplication({
        providers: panelProviders(server, languageOf(this)),
      });
      if (generation !== this.generation || !this.isConnected) {
        application.destroy();
        return;
      }
      const host = this.ownerDocument.createElement('div');
      host.className = 'nuxeo-record-panel';
      this.root.replaceChildren(host);
      this.component = createComponent(RecordPanelComponent, {
        environmentInjector: application.injector,
        hostElement: host,
      });
      application.attachView(this.component.hostView);
      this.application = application;
      this.push();
    }

    private push(): void {
      const component = this.component;
      if (!component) return;
      component.setInput('recordId', this.getAttribute('record-id'));
      component.setInput('host', this.getAttribute('host'));
      component.setInput('cards', cardsOf(this.getAttribute('cards')));
    }

    private stop(): void {
      this.application?.destroy();
      this.application = null;
      this.component = null;
      this.root.replaceChildren();
    }
  }

  registry.define(PANEL_TAG, NuxeoRecordPanelElement);
}
