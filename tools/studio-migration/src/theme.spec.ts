import { themeProperties } from './theme';

describe('themeProperties', () => {
  it('reads plain declarations, var() references and quoted lists', () => {
    const css = `
      html {
        --nuxeo-primary-color: #0066ff;
        --nuxeo-app-header-pill-hover: var(--nuxeo-primary-color);
        --nuxeo-app-font: 'Inter', Arial, sans-serif;
        color: red;
      }`;
    expect(themeProperties(css)).toEqual([
      { name: '--nuxeo-primary-color', value: '#0066ff', mixin: false },
      { name: '--nuxeo-app-header-pill-hover', value: 'var(--nuxeo-primary-color)', mixin: false },
      { name: '--nuxeo-app-font', value: "'Inter', Arial, sans-serif", mixin: false },
    ]);
  });

  it('reads a Polymer mixin as one property, without taking its inner declarations', () => {
    const css = `html {
      --paper-input-container: { color: red; --inner: blue; };
      --after: 1px;
    }`;
    expect(themeProperties(css)).toEqual([
      { name: '--paper-input-container', value: '{ color: red; --inner: blue; }', mixin: true },
      { name: '--after', value: '1px', mixin: false },
    ]);
  });

  it('does not take what a comment or a string holds for a declaration', () => {
    const css = `html {
      /* --commented-out: #000; */
      content: "--in-a-string: x;";
      --real: url("a;b") /* trailing note */;
    }`;
    expect(themeProperties(css)).toEqual([{ name: '--real', value: 'url("a;b")', mixin: false }]);
  });

  it('keeps what looks like a comment inside a quoted value', () => {
    const css = `html { --asset: url("images/*logo*/icon.png") /* a real comment */; }`;
    expect(themeProperties(css)).toEqual([
      { name: '--asset', value: 'url("images/*logo*/icon.png")', mixin: false },
    ]);
  });

  it('reads declarations in nested blocks and the last one before a closing brace', () => {
    const css = `@media (max-width: 1024px) { html { --nested: 2px } } html { --last: 3px }`;
    expect(themeProperties(css).map((p) => [p.name, p.value])).toEqual([
      ['--nested', '2px'],
      ['--last', '3px'],
    ]);
  });

  it('ignores a declaration outside any block, which CSS does not allow', () => {
    expect(themeProperties('--loose: 1px; html { --kept: 2px; }').map((p) => p.name)).toEqual([
      '--kept',
    ]);
  });

  it('ignores a custom property used as a value, not declared', () => {
    expect(themeProperties('html { color: var(--used-only); }')).toEqual([]);
  });
});
