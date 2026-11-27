import { account } from './account';
import { loadCatalogue } from './catalogue';
import { constructsOf, countsOf } from './constructs';
import { convert } from './convert';
import { describeElement, pluginInterface } from './elements';
import { inventory } from './inventory';
import { secondCount } from './second-count';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { M3_CUSTOM_BUNDLE, m3CorpusFiles } from './testing/m3-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();

describe('the custom elements of a package', () => {
  const pkg = readStudioPackage(syntheticPackage({ bundle: m3CorpusFiles() }));
  const read = inventory(pkg);
  const [exposure, escalate] = read.customElements;

  it('finds each element the custom bundle defines, and where the package uses it', () => {
    expect(
      read.customElements.map((element) => [element.name, element.index, element.path]),
    ).toEqual([
      ['acme-claim-exposure', 0, M3_CUSTOM_BUNDLE],
      ['acme-claim-escalate', 1, M3_CUSTOM_BUNDLE],
    ]);
    expect(exposure.uses).toEqual([`${UI}/document/claim/nuxeo-claim-view-layout.html`]);
    expect(escalate.uses).toEqual([M3_CUSTOM_BUNDLE]);
  });

  it('reads its properties, behaviours, bindings, events and operations without running it', () => {
    expect(exposure.definition).toBe('polymer');
    expect(exposure.properties).toEqual([
      expect.objectContaining({ name: 'document', type: 'Object', internal: false }),
      expect.objectContaining({ name: 'threshold', type: 'Number', value: '10000' }),
    ]);
    expect(exposure.behaviours).toEqual(['Nuxeo.I18nBehavior']);
    expect(exposure.methods).toEqual(['_outstanding', '_ratio', '_isHigh']);
    expect(exposure.reads).toEqual([
      'document.properties.cl:number',
      'document.properties.cl:amount',
      'document.properties.cl:reserve',
    ]);
    expect(exposure.texts).toEqual([
      'label.claim.number',
      'label.claim.outstanding',
      'label.claim.reserveRatio',
      'label.claim.highExposure',
    ]);
    expect(exposure.events).toEqual([]);
    expect(exposure.conditions).toEqual([
      'dom-if [[_isHigh(document.properties.cl:amount, threshold)]]',
    ]);

    expect(escalate.behaviours).toEqual(['Nuxeo.I18nBehavior', 'Nuxeo.FiltersBehavior']);
    expect(escalate.inherited).toEqual(expect.arrayContaining(['hasPermission', 'fire', 'i18n']));
    expect(escalate.events.map((event) => event.name)).toEqual([
      'claim-escalated',
      'document-updated',
      'notify',
    ]);
    expect(escalate.operations).toEqual([
      expect.objectContaining({ operation: 'Claim.Escalate', element: 'nuxeo-operation' }),
    ]);
    expect(escalate.listeners).toEqual(['tap → _escalate']);
    expect(escalate.properties.find((property) => property.name === '_running')?.internal).toBe(
      true,
    );
    expect(pluginInterface(escalate)).toEqual({
      inputs: ['document', 'reason'],
      models: [],
      outputs: ['claimEscalated', 'documentUpdated', 'notify'],
    });
    expect(describeElement(escalate).join('\n')).toContain(
      'runs: Claim.Escalate (nuxeo-operation)',
    );
  });

  it("keeps what an element holds as the element's, not the rest of the file's", () => {
    // Neither element's script nor its dom-if is a construct of the custom bundle of its own.
    expect(read.scripts.filter((script) => script.path === M3_CUSTOM_BUNDLE)).toEqual([]);
    expect(read.conditions.filter((condition) => condition.path === M3_CUSTOM_BUNDLE)).toEqual([]);
    expect(read.elements.has('paper-button')).toBe(false);
    expect(read.customCode).toEqual([
      { path: M3_CUSTOM_BUNDLE, hasCode: true, hasOtherCode: false },
    ]);
    const kinds = constructsOf(read)
      .filter((construct) => construct.file === M3_CUSTOM_BUNDLE)
      .map((construct) => construct.id);
    expect(kinds).toEqual([
      `slot-contribution:${M3_CUSTOM_BUNDLE}#1`,
      `custom-element:${M3_CUSTOM_BUNDLE}#1`,
      `custom-element:${M3_CUSTOM_BUNDLE}#2`,
    ]);
    // The second count, from the text alone, agrees.
    const first = countsOf(constructsOf(read));
    const second = secondCount(pkg, read);
    expect(second.get(`custom-element ${M3_CUSTOM_BUNDLE}`)).toBe(2);
    expect([...second].sort()).toEqual([...first].sort());
  });

  it('lists each element among the decisions, and not as an element the catalogue lacks', () => {
    const { decisions } = account(read, catalogue);
    expect(decisions).toContain(
      `custom element acme-claim-exposure in ${M3_CUSTOM_BUNDLE} is for an agent to write as a Layer 2 plugin, libs/extensions/acme-claim-exposure, with the plugin command, and a person to accept`,
    );
    expect(decisions.filter((line) => line.startsWith('element acme-claim'))).toEqual([]);
  });

  it('proposes each element as a plugin until a person accepts it', () => {
    const conversion = convert(pkg, read, catalogue);
    const entries = conversion.report.constructs.filter((entry) => entry.kind === 'custom-element');
    expect(entries.map((entry) => [entry.label, entry.outcome, entry.to])).toEqual([
      ['the custom element acme-claim-exposure', 'proposed', 'libs/extensions/acme-claim-exposure'],
      ['the custom element acme-claim-escalate', 'proposed', 'libs/extensions/acme-claim-escalate'],
    ]);
    expect(
      conversion.report.constructs.find(
        (entry) => entry.id === `slot-contribution:${M3_CUSTOM_BUNDLE}#1`,
      ),
    ).toEqual(
      expect.objectContaining({
        outcome: 'reported',
        note: expect.stringContaining('acme-claim-escalate, a custom element of the package'),
      }),
    );
  });
});

describe('custom elements, as real bundles may write them', () => {
  /** The M3 corpus's custom bundle with one more element, and M2's corpus for its layout blocks. */
  function withElement(markup: string) {
    const files = { ...m2CorpusFiles(), ...m3CorpusFiles() };
    files[M3_CUSTOM_BUNDLE] = files[M3_CUSTOM_BUNDLE].replace(
      '<nuxeo-slot-content name="claimEscalation"',
      `${markup}\n<nuxeo-slot-content name="claimEscalation"`,
    );
    const pkg = readStudioPackage(syntheticPackage({ bundle: files }));
    return { pkg, read: inventory(pkg) };
  }

  it("counts a layout block an element's template uses as the element's, in both counts", () => {
    const { pkg, read } = withElement(`<dom-module id="acme-policy-panel">
  <template><acme-policy-terms document="[[document]]"></acme-policy-terms><acme-claim-exposure document="[[document]]"></acme-claim-exposure></template>
  <script>Polymer({ is: 'acme-policy-panel', properties: { document: Object, total: { type: Number, readOnly: true }, open: { type: Boolean, notify: true } } });</script>
</dom-module>`);
    const first = countsOf(constructsOf(read));
    expect([...secondCount(pkg, read)].sort()).toEqual([...first].sort());
    // An element used only inside another one is used there.
    const exposure = read.customElements.find((element) => element.name === 'acme-claim-exposure');
    expect(exposure?.uses).toContain(`${M3_CUSTOM_BUNDLE}, in acme-policy-panel`);
    // A read-only property is no input; one it notifies is a model.
    const panel = read.customElements.find((element) => element.name === 'acme-policy-panel');
    expect(pluginInterface(panel as NonNullable<typeof panel>)).toEqual({
      inputs: ['document', 'open'],
      models: ['open'],
      outputs: [],
    });
  });

  it('takes a dom-module whose only script sits in its template for an element, in both counts', () => {
    const { pkg, read } = withElement(`<dom-module id="acme-late-script">
  <template><span>[[document.title]]</span><script>Polymer({ is: 'acme-late-script' });</script></template>
</dom-module>`);
    expect(read.customElements.map((element) => element.name)).toContain('acme-late-script');
    expect([...secondCount(pkg, read)].sort()).toEqual([...countsOf(constructsOf(read))].sort());
  });
});
