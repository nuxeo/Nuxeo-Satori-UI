import { PANEL_TAG, cardsOf, defineRecordPanel, languageOf } from './record-panel.element';

const SERVER = {
  origin: 'https://nuxeo.example.com',
  base: 'https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/',
};

describe('<nuxeo-record-panel>', () => {
  beforeAll(() => defineRecordPanel(SERVER));

  it('is defined once, however often its script runs', () => {
    const defined = customElements.get(PANEL_TAG);
    expect(defined).toBeDefined();
    defineRecordPanel(SERVER);
    expect(customElements.get(PANEL_TAG)).toBe(defined);
  });

  it('holds a shadow root of its own from the start', () => {
    const element = document.createElement(PANEL_TAG);
    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot?.mode).toBe('open');
  });

  it('reads the record, the host and the cards from its attributes, and never a token', () => {
    const observed = (customElements.get(PANEL_TAG) as unknown as { observedAttributes: string[] })
      .observedAttributes;
    expect(observed).toEqual(['record-id', 'host', 'cards']);
    expect(observed.some((name) => /token|secret|auth/i.test(name))).toBe(false);
  });

  it('reads the cards an attribute names, ids only', () => {
    expect(cardsOf('claim, payment')).toEqual(['claim', 'payment']);
    expect(cardsOf('claim payment')).toEqual(['claim', 'payment']);
    expect(cardsOf('<script>, payment')).toEqual(['payment']);
    expect(cardsOf('')).toBeNull();
    expect(cardsOf(null)).toBeNull();
  });

  it('is in its own language, else the page one, else English', () => {
    const element = document.createElement('div');
    element.setAttribute('lang', 'fr-CA');
    expect(languageOf(element)).toBe('fr');
    element.removeAttribute('lang');
    document.documentElement.lang = 'de';
    expect(languageOf(element)).toBe('de');
    document.documentElement.lang = 'x';
    expect(languageOf(element)).toBe('en');
    document.documentElement.lang = '';
  });
});
