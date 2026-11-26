/**
 * The designer's writer of a JSON file: a value, as the repository's Prettier writes a file holding
 * it when it lays the file out afresh, so that what the designer saves is the bytes of a file a
 * person writes and formats in the repository (libs/features/layout-designer/README.md, "Byte for
 * byte").
 *
 * That is Prettier 3's JSON layout with the repository's `.prettierrc`, `printWidth` 100 and
 * every other option its default, given the value written on one line,
 * `prettier.format(JSON.stringify(value), { parser: 'json', printWidth: 100 })`:
 *
 * - an object or an array is written on one line, `{ "key": value, … }` or `[a, b]`, when that
 *   line fits in 100 columns, the comma after it counted, and otherwise one entry a line, two
 *   spaces deeper, and the closing bracket on its own line;
 * - an array of two or more objects, or of two or more arrays, each of more than one entry, is
 *   always written one entry a line, and so is every object or array that holds one;
 * - an array of numbers that does not fit is filled: as many numbers on a line as fit;
 * - a key and its value are never split: a value that does not fit breaks inside itself, or not at
 *   all, as a long text does;
 * - keys and texts are written as `JSON.stringify` writes them, and numbers as Prettier prints
 *   them: `1e21`, not `1e+21`;
 * - and the file ends with a newline.
 *
 * Its spec holds it to Prettier itself, on every kit's files and on a corpus of generated values.
 * A width is measured as Prettier measures one: a wide or full-width character is two columns, an
 * emoji two, or one for an emoji drawn as text, such as ©, and a combining mark, a variation
 * selector or a control character none. An emoji is told by Unicode's own properties here, and by
 * a list of emoji in Prettier, so a sequence the two read differently may be measured apart.
 */

const PRINT_WIDTH = 100;
const INDENT = '  ';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const NOT_ASCII = /[^\x20-\x7F]/u;
/** An emoji, a sequence joined by zero-width joiners or a flag included, as one character. */
const EMOJI =
  /\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
/** An emoji drawn as text unless asked otherwise, such as ©, which takes one column. */
const TEXT_EMOJI = /^\P{Emoji_Presentation}$/u;
/**
 * The characters that take two columns, as ranges, first and last of each, in order: Unicode's
 * East Asian Wide and Fullwidth characters (EastAsianWidth.txt, `W` and `F`), as the
 * `get-east-asian-width` package that Prettier 3 counts columns with lists them.
 */
const WIDE: readonly number[] = [
  0x1100, 0x115f, 0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ec, 0x23f0, 0x23f0, 0x23f3, 0x23f3,
  0x25fd, 0x25fe, 0x2614, 0x2615, 0x2630, 0x2637, 0x2648, 0x2653, 0x267f, 0x267f, 0x268a, 0x268f,
  0x2693, 0x2693, 0x26a1, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26ce,
  0x26d4, 0x26d4, 0x26ea, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26f5, 0x26fa, 0x26fa, 0x26fd, 0x26fd,
  0x2705, 0x2705, 0x270a, 0x270b, 0x2728, 0x2728, 0x274c, 0x274c, 0x274e, 0x274e, 0x2753, 0x2755,
  0x2757, 0x2757, 0x2795, 0x2797, 0x27b0, 0x27b0, 0x27bf, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b50,
  0x2b55, 0x2b55, 0x2e80, 0x2e99, 0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x303e, 0x3041, 0x3096,
  0x3099, 0x30ff, 0x3105, 0x312f, 0x3131, 0x318e, 0x3190, 0x31e5, 0x31ef, 0x321e, 0x3220, 0x3247,
  0x3250, 0xa48c, 0xa490, 0xa4c6, 0xa960, 0xa97c, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe10, 0xfe19,
  0xfe30, 0xfe52, 0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0xff01, 0xff60, 0xffe0, 0xffe6, 0x16fe0, 0x16fe4,
  0x16ff0, 0x16ff6, 0x17000, 0x18cd5, 0x18cff, 0x18d1e, 0x18d80, 0x18df2, 0x1aff0, 0x1aff3, 0x1aff5,
  0x1affb, 0x1affd, 0x1affe, 0x1b000, 0x1b122, 0x1b132, 0x1b132, 0x1b150, 0x1b152, 0x1b155, 0x1b155,
  0x1b164, 0x1b167, 0x1b170, 0x1b2fb, 0x1d300, 0x1d356, 0x1d360, 0x1d376, 0x1f004, 0x1f004, 0x1f0cf,
  0x1f0cf, 0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f200, 0x1f202, 0x1f210, 0x1f23b, 0x1f240, 0x1f248,
  0x1f250, 0x1f251, 0x1f260, 0x1f265, 0x1f300, 0x1f320, 0x1f32d, 0x1f335, 0x1f337, 0x1f37c, 0x1f37e,
  0x1f393, 0x1f3a0, 0x1f3ca, 0x1f3cf, 0x1f3d3, 0x1f3e0, 0x1f3f0, 0x1f3f4, 0x1f3f4, 0x1f3f8, 0x1f43e,
  0x1f440, 0x1f440, 0x1f442, 0x1f4fc, 0x1f4ff, 0x1f53d, 0x1f54b, 0x1f54e, 0x1f550, 0x1f567, 0x1f57a,
  0x1f57a, 0x1f595, 0x1f596, 0x1f5a4, 0x1f5a4, 0x1f5fb, 0x1f64f, 0x1f680, 0x1f6c5, 0x1f6cc, 0x1f6cc,
  0x1f6d0, 0x1f6d2, 0x1f6d5, 0x1f6d8, 0x1f6dc, 0x1f6df, 0x1f6eb, 0x1f6ec, 0x1f6f4, 0x1f6fc, 0x1f7e0,
  0x1f7eb, 0x1f7f0, 0x1f7f0, 0x1f90c, 0x1f93a, 0x1f93c, 0x1f945, 0x1f947, 0x1f9ff, 0x1fa70, 0x1fa7c,
  0x1fa80, 0x1fa8a, 0x1fa8e, 0x1fac6, 0x1fac8, 0x1fac8, 0x1facd, 0x1fadc, 0x1fadf, 0x1faea, 0x1faef,
  0x1faf8, 0x20000, 0x2fffd, 0x30000, 0x3fffd,
];

/** Whether `code` takes two columns: a binary search of {@link WIDE}'s ranges. */
function isWide(code: number): boolean {
  let low = 0;
  let high = WIDE.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (code < WIDE[middle * 2]) high = middle - 1;
    else if (code > WIDE[middle * 2 + 1]) low = middle + 1;
    else return true;
  }
  return false;
}

/** The columns `text` takes, as Prettier counts them. */
function width(text: string): number {
  if (!NOT_ASCII.test(text)) return text.length;
  let total = 0;
  const rest = text.replace(EMOJI, (emoji) => {
    total += TEXT_EMOJI.test(emoji) ? 1 : 2;
    return '';
  });
  for (const character of rest) {
    const code = character.codePointAt(0) ?? 0;
    // Control characters, combining marks and variation selectors take no column.
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    if (code >= 0x300 && code <= 0x36f) continue;
    if (code >= 0xfe00 && code <= 0xfe0f) continue;
    total += isWide(code) ? 2 : 1;
  }
  return total;
}

/** A number as Prettier prints it: lower case, and no `+`, leading zero or needless part in an exponent. */
function numberText(value: number): string {
  return JSON.stringify(value)
    .toLowerCase()
    .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(\d)/, '$1$2$3')
    .replace(/^([+-]?[\d.]+)e[+-]?0+$/, '$1')
    .replace(/^([+-])?\./, '$10.')
    .replace(/(\.\d+?)0+(?=e|$)/, '$1')
    .replace(/\.(?=e|$)/, '');
}

const isList = (value: Json): value is readonly Json[] => Array.isArray(value);
const isMap = (value: Json): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const entriesOf = (value: Json): number =>
  isList(value) ? value.length : isMap(value) ? Object.keys(value).length : 0;

function scalarText(value: Json): string {
  return typeof value === 'number' ? numberText(value) : JSON.stringify(value);
}

/** `value` on one line. */
function flat(value: Json): string {
  if (isList(value)) return value.length === 0 ? '[]' : `[${value.map(flat).join(', ')}]`;
  if (isMap(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${flat(item)}`).join(', ')} }`;
  }
  return scalarText(value);
}

/**
 * Whether `value` is written one entry a line whatever the width: an array of two or more objects,
 * or of two or more arrays, each of more than one entry; or anything that holds one.
 */
function alwaysBroken(value: Json): boolean {
  if (isList(value)) {
    const each = value.every(
      (item, index) =>
        (isList(item) || isMap(item)) &&
        entriesOf(item) > 1 &&
        (index === value.length - 1 || isList(item) === isList(value[index + 1])),
    );
    return (value.length > 1 && each) || value.some(alwaysBroken);
  }
  return isMap(value) && Object.values(value).some(alwaysBroken);
}

/**
 * `value`, starting at `column`, `depth` levels deep, with `after` columns written after it on its
 * line: the comma that separates it from the next entry.
 */
function print(value: Json, column: number, depth: number, after: number): string {
  if (entriesOf(value) === 0) return flat(value);
  if (!alwaysBroken(value)) {
    const line = flat(value);
    if (column + width(line) + after <= PRINT_WIDTH) return line;
  }
  const inner = INDENT.repeat(depth + 1);
  const closing = INDENT.repeat(depth);
  if (isList(value)) {
    if (value.length > 1 && value.every((item) => typeof item === 'number')) {
      return `[\n${filled(value as readonly number[], inner)}\n${closing}]`;
    }
    const items = value.map(
      (item, index) =>
        inner + print(item, inner.length, depth + 1, index < value.length - 1 ? 1 : 0),
    );
    return `[\n${items.join(',\n')}\n${closing}]`;
  }
  const entries = Object.entries(value as { readonly [key: string]: Json });
  const lines = entries.map(([key, item], index) => {
    const head = `${JSON.stringify(key)}: `;
    const at = inner.length + width(head);
    return inner + head + print(item, at, depth + 1, index < entries.length - 1 ? 1 : 0);
  });
  return `{\n${lines.join(',\n')}\n${closing}}`;
}

/** Numbers, as many on each line as fit, each but the last with its comma. */
function filled(numbers: readonly number[], inner: string): string {
  const parts = numbers.map((item, index) =>
    index < numbers.length - 1 ? `${numberText(item)},` : numberText(item),
  );
  let text = inner + parts[0];
  let column = inner.length + width(parts[0]);
  for (const part of parts.slice(1)) {
    if (column + 1 + width(part) <= PRINT_WIDTH) {
      text += ` ${part}`;
      column += 1 + width(part);
    } else {
      text += `\n${inner}${part}`;
      column = inner.length + width(part);
    }
  }
  return text;
}

/**
 * `value` as a file: its JSON, as `JSON.stringify` gives it, laid out as the repository's Prettier
 * lays it out afresh, with a last newline. What `JSON.stringify` leaves out, such as a key whose
 * value is `undefined`, is left out.
 */
export function jsonFileText(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return `${print(JSON.parse(json) as Json, 0, 0, 0)}\n`;
}
