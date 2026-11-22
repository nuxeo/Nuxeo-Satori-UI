/**
 * CSS colours and their contrast, as WCAG 2.1 defines it: the relative luminance of each colour
 * (success criterion 1.4.3, and its definition of relative luminance), and the ratio between them.
 * A translucent colour is composited over what it sits on; a translucent background over white,
 * the page's own colour.
 */

export interface Rgba {
  /** 0 to 255. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0 to 1. */
  readonly a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const NAMED: Readonly<Record<string, Rgba>> = {
  white: WHITE,
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

/** The colour a CSS value names, or `null` for one this does not read, such as `var(--x)`. */
export function parseColour(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (Object.hasOwn(NAMED, text)) return NAMED[text];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const digits =
      hex.length <= 4 ? [...hex].map((digit) => digit + digit) : (hex.match(/../g) ?? []);
    const [r, g, b, a = 'ff'] = digits;
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a, 16) / 255 };
  }
  // rgb() and rgba(), with commas or with spaces and a slash before the alpha.
  const functional = /^rgba?\(\s*([^)]*)\)$/.exec(text)?.[1];
  if (functional) {
    const parts = functional.split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    const channel = (part: string): number | null => {
      const number = Number.parseFloat(part);
      if (Number.isNaN(number)) return null;
      return Math.min(255, Math.max(0, part.endsWith('%') ? (number * 255) / 100 : number));
    };
    const [r, g, b] = parts.slice(0, 3).map(channel);
    const alphaPart = parts[3] ?? '1';
    const alphaNumber = Number.parseFloat(alphaPart);
    const a = alphaPart.endsWith('%') ? alphaNumber / 100 : alphaNumber;
    if (r === null || g === null || b === null || Number.isNaN(a)) return null;
    return { r, g, b, a: Math.min(1, Math.max(0, a)) };
  }
  return null;
}

/** The colour seen when `top` is drawn over `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const blend = (front: number, back: number): number => front * top.a + back * (1 - top.a);
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b), a: 1 };
}

/** WCAG 2.1's relative luminance of an opaque colour. */
export function relativeLuminance(colour: Rgba): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** The contrast ratio of a foreground over a background, from 1 to 21. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const back = background.a < 1 ? composite(background, WHITE) : background;
  const front = foreground.a < 1 ? composite(foreground, back) : foreground;
  const [lighter, darker] = [relativeLuminance(front), relativeLuminance(back)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}
