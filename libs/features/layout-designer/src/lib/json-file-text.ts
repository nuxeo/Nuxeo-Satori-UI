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
 * A width is measured as Prettier measures one for ASCII, the CJK blocks, Hangul, the full-width
 * forms and emoji; a rarer wide character is counted as one column.
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
/** The blocks whose characters take two columns: East Asian wide and full-width. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

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
    total += WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
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
