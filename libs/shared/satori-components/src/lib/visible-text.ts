/**
 * Format characters that take no space on screen: zero-width space, non-joiner and joiner, the
 * directional marks and embeddings, the word joiner and invisible operators, the byte-order mark,
 * the soft hyphen, the combining grapheme joiner, the Arabic letter mark, the Mongolian vowel
 * separator, the Khmer inherent vowels and the Hangul fillers.
 */
const ZERO_WIDTH = new Set(
  [
    0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e,
    0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066,
    0x2067, 0x2068, 0x2069, 0x3164, 0xfeff, 0xffa0,
  ].map((code) => String.fromCharCode(code)),
);

/** Variation selectors change how the character before them is drawn; alone they draw nothing. */
const isVariationSelector = (char: string): boolean => char >= '\ufe00' && char <= '\ufe0f';

const isBlank = (char: string): boolean => ZERO_WIDTH.has(char) || /\s/.test(char);

/**
 * Text as a reader gets it: without the whitespace and zero-width characters around it, and empty
 * when nothing in it would show on screen.
 *
 * `trim()` alone keeps `'\u200B'` — a zero-width space a paste or a CMS can leave in a field — so a
 * label made of one still reads as a name, and assistive technology announces nothing for a control
 * that looks named. Characters inside the text are kept: a zero-width joiner between two emoji, or a
 * non-joiner in Persian, changes what the text says.
 */
export function nxsVisibleText(text: string | null | undefined): string {
  const value = text ?? '';
  let start = 0;
  let end = value.length;
  while (start < end && isBlank(value[start])) start += 1;
  while (end > start && isBlank(value[end - 1])) end -= 1;
  for (let at = start; at < end; at += 1) {
    if (!isVariationSelector(value[at])) return value.slice(start, end);
  }
  return '';
}

/**
 * The first `count` characters a reader sees in `text`, upper-cased — an avatar's initials. Counted
 * as user-perceived characters, so an accented letter written as a letter and a combining mark, or
 * an emoji written as two code units, is one initial and is never cut in half.
 */
export function nxsInitials(text: string | null | undefined, count: number): string {
  const visible = nxsVisibleText(text);
  if (!visible || count < 1) return '';
  const graphemes =
    typeof Intl.Segmenter === 'function'
      ? Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(visible),
          (s) => s.segment.trim(),
        )
      : Array.from(visible, (c) => c.trim());
  return graphemes
    .filter((grapheme) => nxsVisibleText(grapheme) !== '')
    .slice(0, count)
    .join('')
    .toUpperCase();
}
