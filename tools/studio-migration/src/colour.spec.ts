import { composite, contrastRatio, parseColour, relativeLuminance } from './colour';
import { resolveThemeProperty, themeProperties } from './theme';

describe('parseColour', () => {
  it('reads hex, rgb(), rgba() and the named colours a theme uses', () => {
    expect(parseColour('#0066ff')).toEqual({ r: 0, g: 102, b: 255, a: 1 });
    expect(parseColour('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#0066ff1a')).toMatchObject({ r: 0, g: 102, b: 255 });
    expect(parseColour('#0066ff1a')?.a).toBeCloseTo(0.102, 3);
    expect(parseColour('rgba(0, 0, 0, 0.15)')).toEqual({ r: 0, g: 0, b: 0, a: 0.15 });
    expect(parseColour('rgb(255 255 255 / 50%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColour('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('reads nothing it cannot be sure of', () => {
    for (const value of [
      'var(--x)',
      'linear-gradient(red, blue)',
      '#12',
      'rgb(1, 2)',
      'hsl(0 0% 0%)',
      'constructor',
    ]) {
      expect(parseColour(value)).toBeNull();
    }
  });
});

describe('contrastRatio', () => {
  it('follows WCAG 2.1: black on white is 21, a colour on itself is 1', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(
      21,
      5,
    );
    expect(contrastRatio({ r: 18, g: 52, b: 86, a: 1 }, { r: 18, g: 52, b: 86, a: 1 })).toBeCloseTo(
      1,
      5,
    );
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
  });

  it('measures the sample theme, whose blue text on its grey page falls just short of AA', () => {
    const blue = parseColour('#0066ff');
    const grey = parseColour('#f5f5f5');
    const white = parseColour('#ffffff');
    if (!blue || !grey || !white) throw new Error('unparsed');
    expect(contrastRatio(white, blue)).toBeCloseTo(4.83, 2);
    expect(contrastRatio(blue, grey)).toBeCloseTo(4.43, 2);
  });

  it('composites a translucent colour over what it sits on', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
    // Faint text is less readable than the same colour opaque.
    const faint = contrastRatio({ r: 0, g: 0, b: 0, a: 0.15 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(faint).toBeLessThan(1.5);
  });
});

describe('resolveThemeProperty', () => {
  const properties = themeProperties(`html {
    --brand: #0066ff;
    --primary: var(--brand);
    --header: var(--primary);
    --with-fallback: var(--missing, #222222);
    --dangling: var(--missing);
    --a: var(--b);
    --b: var(--a);
    --twice: #111111;
    --twice: #222222;
  }`);

  it('follows references through the theme, and uses a fallback when the reference is not set', () => {
    expect(resolveThemeProperty(properties, '--header')).toBe('#0066ff');
    expect(resolveThemeProperty(properties, '--with-fallback')).toBe('#222222');
  });

  it('takes the last value of a property set twice, as CSS does', () => {
    expect(resolveThemeProperty(properties, '--twice')).toBe('#222222');
  });

  it('resolves nothing for a missing reference, a circle, or a property not set', () => {
    expect(resolveThemeProperty(properties, '--dangling')).toBeNull();
    expect(resolveThemeProperty(properties, '--a')).toBeNull();
    expect(resolveThemeProperty(properties, '--not-there')).toBeNull();
  });
});
