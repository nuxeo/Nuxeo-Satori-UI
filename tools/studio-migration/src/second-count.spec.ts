import { constructsOf, countsOf } from './constructs';
import { inventory } from './inventory';
import { secondCount, withoutHtmlComments } from './second-count';
import { readStudioPackage } from './studio-package';
import {
  syntheticBundleFiles,
  syntheticPackage,
  type SyntheticPackageOptions,
} from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';

function counts(options?: SyntheticPackageOptions) {
  const pkg = readStudioPackage(syntheticPackage(options));
  const read = inventory(pkg);
  return {
    first: countsOf(constructsOf(read)),
    second: secondCount(pkg, read),
    constructs: constructsOf(read),
  };
}

describe('the constructs of a package', () => {
  const { constructs } = counts();

  it('gives each construct its own id', () => {
    expect(new Set(constructs.map((c) => c.id)).size).toBe(constructs.length);
  });

  it('accounts for every file: through what it holds, or as a construct of its own', () => {
    const files = new Set(constructs.map((c) => c.file));
    expect(files.size).toBe(4 + Object.keys(syntheticBundleFiles()).length);
  });

  it('makes a container with nothing in it a construct of its own', () => {
    const empty = counts({ bundle: { 'data/i18n/messages-de.json': '{}' } }).constructs;
    expect(empty.filter((c) => c.file === 'data/i18n/messages-de.json')).toEqual([
      expect.objectContaining({ kind: 'file', label: 'translations, holding nothing' }),
    ]);
  });
});

describe('the second count', () => {
  it('agrees with the first on every file of the synthetic package', () => {
    const { first, second } = counts();
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
    expect(first.get(`theme-property ${UI}/themes/acme/theme.html`)).toBe(5);
    expect(first.get(`dashboard-card ${UI}/nuxeo-home.html`)).toBe(3);
  });

  it('counts a Polymer mixin as one property, nested braces and all', () => {
    const path = `${UI}/themes/acme/theme.html`;
    const theme = syntheticBundleFiles()[path].replace(
      '--paper-input-container: { color: #1d1d1f; };',
      '--paper-input-container: { color: #1d1d1f; --inner: { x: y; }; };',
    );
    const { first, second } = counts({ bundle: { [path]: theme } });
    expect(second.get(`theme-property ${path}`)).toBe(first.get(`theme-property ${path}`));
  });

  it('skips what comments hold', () => {
    expect(withoutHtmlComments('a<!-- b -->c<!-- d')).toBe('ac');
    expect(withoutHtmlComments('no comment')).toBe('no comment');
  });

  // Negative control: the second count is only worth having if it can disagree.
  it('disagrees when the text holds what the parser does not take for a construct', () => {
    const path = `${UI}/nuxeo-home.html`;
    const home = syntheticBundleFiles()[path].replace(
      '</template>',
      '<script>const card = "<nuxeo-card >";</script></template>',
    );
    const { first, second } = counts({ bundle: { [path]: home } });
    expect(second.get(`dashboard-card ${path}`)).toBe(4);
    expect(first.get(`dashboard-card ${path}`)).toBe(3);
  });
});
