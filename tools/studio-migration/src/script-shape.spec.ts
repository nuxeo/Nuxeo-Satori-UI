import { scriptShape, scriptShapeText } from './script-shape';

const LAYOUT = `
  Polymer({
    is: 'nuxeo-admissionform-view-layout',
    behaviors: [Nuxeo.LayoutBehavior],
    properties: {
      /**
       * @doctype AdmissionForm
       */
      document: {
        type: Object,
      },
    }
  });`;

const results = (options: string[]) => `Polymer({
  is: 'nuxeo-x-search-results',
  attached: function() {
    this.sortOptions = [
      ${options.join(',\n      ')}
    ];
  },
});`;

describe('scriptShape', () => {
  it('is the same for scripts that differ only in names, comments, spacing and trailing commas', () => {
    const other = `Polymer({ is: "nuxeo-claim-edit-layout", behaviors: [Nuxeo.LayoutBehavior], properties: { document: { type: Object } } });`;
    expect(scriptShape(other)).toBe(scriptShape(LAYOUT));
    expect(scriptShapeText(LAYOUT)).toBe(
      'Polymer ( { is : "S" , behaviors : [ Nuxeo . LayoutBehavior ] , properties : { document : { type : Object } } } ) ;',
    );
  });

  // Negative controls: customer code must change the shape, however small.
  it('changes when the script gains a method, a behaviour or a property', () => {
    const withMethod = LAYOUT.replace(
      'properties: {',
      'ready: function() { this.track(); },\n    properties: {',
    );
    const withBehaviour = LAYOUT.replace(
      '[Nuxeo.LayoutBehavior]',
      '[Nuxeo.LayoutBehavior, Acme.Audit]',
    );
    const withProperty = LAYOUT.replace('type: Object,', 'type: Object, observer: "_changed",');
    for (const changed of [withMethod, withBehaviour, withProperty]) {
      expect(scriptShape(changed)).not.toBe(scriptShape(LAYOUT));
    }
  });

  it('counts a run of search sort options as one, whatever their number or which is selected', () => {
    const option = (field: string, selected = false) =>
      `{field: '${field}', label: this.i18n('x.${field}'), order: 'asc'${selected ? ', selected: true' : ''}}`;
    const one = results([option('dc:title')]);
    const seven = results(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((field, i) => option(field, i === 1)),
    );
    expect(scriptShape(seven)).toBe(scriptShape(one));
    expect(scriptShapeText(one)).toContain('this . sortOptions = [ SORT ] ;');
  });

  it('does not take code for a sort option', () => {
    const withCode = results([
      `{field: 'a', label: this.i18n('a'), order: 'asc', onSelect: steal}`,
    ]);
    expect(scriptShapeText(withCode)).not.toContain('SORT');
  });

  it('reads template literals, with and without substitutions, as placeholders', () => {
    expect(scriptShapeText('const a = `plain`; const b = `x ${y + `in ${z}`} w`;')).toBe(
      'const a = "S" ; const b = `T` y + `T` z `T` `T` ;',
    );
  });
});
