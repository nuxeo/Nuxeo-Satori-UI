import { provideZonelessChangeDetection, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NxsAvatarComponent } from './avatar/avatar.component';
import { NXS_NAMED_COLORS } from './named-colors';
import type { NxsAvatarColor } from './primitives';
import { NxsTagComponent } from './tag/tag.component';

/**
 * `--mat-sys-surface` / `--mat-sys-on-surface` and the tag's gray roles, as `mat.theme` compiles them
 * for the palettes this repository ships: Storybook's light azure, and the application's dark azure,
 * rose and cyan themes, each in both theme types so a customer flipping one is covered too.
 *
 * The axe runtime layer owns the contrast verdict (`docs/accessibility.md`), but no screen renders
 * the built-in avatar or tag in every colour — screens use Satori's — so it has no node to judge.
 * This holds the palette to the bar on the themes it will meet instead.
 */
const THEMES = {
  'light azure': { surface: '#faf9fd', text: '#1a1b1f', grayBg: '#e9e7eb', grayText: '#44474e' },
  'dark azure': { surface: '#121316', text: '#e3e2e6', grayBg: '#292a2c', grayText: '#e0e2ec' },
  'light rose': { surface: '#fff8f8', text: '#201a1b', grayBg: '#f1e5e6', grayText: '#514346' },
  'dark rose': { surface: '#171213', text: '#ece0e1', grayBg: '#2f2829', grayText: '#f3dde1' },
  'light cyan': { surface: '#f7faf9', text: '#191c1c', grayBg: '#e6e9e7', grayText: '#3f4948' },
  'dark cyan': { surface: '#101414', text: '#e0e3e2', grayBg: '#272b2a', grayText: '#dae5e4' },
} as const;

/** Each name's hue range in degrees, start to end, wrapping past 360 for red. */
const HUE_RANGES: Readonly<Record<NxsAvatarColor, readonly [number, number]>> = {
  red: [345, 15],
  orange: [15, 40],
  yellow: [40, 65],
  green: [90, 150],
  teal: [165, 195],
  blue: [195, 240],
  purple: [265, 310],
  pink: [320, 345],
};

type Rgb = readonly [number, number, number];
const rgb = (hex: string): Rgb => {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`not #rrggbb: ${hex}`);
  const channel = (at: number) => parseInt(value.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
};
/** `color-mix(in srgb, a p%, b)`: a straight mix of the encoded channels. */
const mix = (a: Rgb, b: Rgb, percent: number): Rgb => {
  const channel = (i: 0 | 1 | 2) => (a[i] * percent + b[i] * (100 - percent)) / 100;
  return [channel(0), channel(1), channel(2)];
};
const luminance = (color: Rgb): number => {
  const [r, g, b] = color.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const hue = ([r, g, b]: Rgb): number => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const delta = max - Math.min(rn, gn, bn);
  if (delta === 0) return Number.NaN;
  const sector =
    max === rn
      ? ((gn - bn) / delta) % 6
      : max === gn
        ? (bn - rn) / delta + 2
        : (rn - gn) / delta + 4;
  return (sector * 60 + 360) % 360;
};
const inRange = (degrees: number, [start, end]: readonly [number, number]): boolean =>
  start <= end ? degrees >= start && degrees <= end : degrees >= start || degrees <= end;

const COLORS = Object.keys(NXS_NAMED_COLORS) as NxsAvatarColor[];
const CASES = COLORS.flatMap((color) =>
  Object.entries(THEMES).map(([theme, values]) => [color, theme, values] as const),
);

describe('the named colours', () => {
  it('cover every avatar colour, and so every tag colour but gray', () => {
    expect(COLORS.sort()).toEqual(Object.keys(HUE_RANGES).sort());
  });

  it.each(CASES)('%s text on its background holds 4.5:1 in %s', (color, _theme, values) => {
    const { hue: base, background, foreground } = NXS_NAMED_COLORS[color];
    const bg = mix(rgb(base), rgb(values.surface), background);
    const fg = mix(rgb(base), rgb(values.text), foreground);
    expect(contrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CASES)('%s keeps its hue, background and text, in %s', (color, _theme, values) => {
    const { hue: base, background, foreground } = NXS_NAMED_COLORS[color];
    const bg = mix(rgb(base), rgb(values.surface), background);
    const fg = mix(rgb(base), rgb(values.text), foreground);
    expect(inRange(hue(bg), HUE_RANGES[color])).toBe(true);
    expect(inRange(hue(fg), HUE_RANGES[color])).toBe(true);
  });

  it.each(Object.entries(THEMES))('gray tag text holds 4.5:1 in %s', (_theme, values) => {
    expect(contrast(rgb(values.grayBg), rgb(values.grayText))).toBeGreaterThanOrEqual(4.5);
  });

  // Controls for the two checks above. The theme roles these names used to borrow, as light azure
  // compiles them, must fail the hue check, and yellow text as strong as blue's must fail contrast.
  it.each([
    ['teal', '#dae2f9', 'secondary-container'],
    ['green', '#dae2f9', 'secondary-fixed'],
    ['orange', '#d7e3ff', 'primary-fixed'],
    ['pink', '#ecdcff', 'tertiary-fixed'],
  ] as const)('rejects %s on the theme’s %s (%s)', (color, role, _name) => {
    expect(inRange(hue(rgb(role)), HUE_RANGES[color])).toBe(false);
  });

  it('rejects yellow text mixed as strongly as blue’s', () => {
    const { surface, text } = THEMES['light azure'];
    const yellow = rgb(NXS_NAMED_COLORS.yellow.hue);
    const bg = mix(yellow, rgb(surface), NXS_NAMED_COLORS.yellow.background);
    const fg = mix(yellow, rgb(text), NXS_NAMED_COLORS.blue.foreground);
    expect(contrast(bg, fg)).toBeLessThan(4.5);
  });
});

const here = dirname(fileURLToPath(import.meta.url));

describe.each([
  ['avatar', NxsAvatarComponent as Type<unknown>, { initials: 'NK' }],
  ['tag', NxsTagComponent as Type<unknown>, { label: 'Invoice' }],
] as const)('the %s', (name, component, required) => {
  async function render(color: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(component);
    for (const [input, value] of Object.entries(required))
      fixture.componentRef.setInput(input, value);
    fixture.componentRef.setInput('color', color);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it.each(COLORS)('binds the %s hue and its mixes on its host', async (color) => {
    const host = await render(color);
    const { hue: base, background, foreground } = NXS_NAMED_COLORS[color];
    expect(host.style.getPropertyValue('--nxs-named-hue')).toBe(base);
    expect(host.style.getPropertyValue('--nxs-named-background-mix')).toBe(`${background}%`);
    expect(host.style.getPropertyValue('--nxs-named-foreground-mix')).toBe(`${foreground}%`);
  });

  it.each(COLORS)('mixes %s from the bound hue in its stylesheet', (color) => {
    const stylesheet = readFileSync(join(here, name, `${name}.component.scss`), 'utf8');
    const rule = new RegExp(String.raw`:host\(\.nxs-${name}--${color}\)\s*\{([^}]*)\}`).exec(
      stylesheet,
    )?.[1];
    expect(rule).toContain(
      `var(--nxs-${name}-${color}-background, var(--nxs-${name}-named-background))`,
    );
    expect(rule).toContain(
      `var(--nxs-${name}-${color}-foreground, var(--nxs-${name}-named-foreground))`,
    );
  });
});

describe('the gray tag', () => {
  it('binds no hue, keeping the theme’s neutral container', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(NxsTagComponent);
    fixture.componentRef.setInput('label', 'Invoice');
    fixture.componentRef.setInput('color', 'teal');
    fixture.detectChanges();
    fixture.componentRef.setInput('color', 'gray');
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.getPropertyValue('--nxs-named-hue')).toBe('');
  });
});
