/** One cell of an exported row. `null` and `undefined` are written as an empty cell. */
export type NxsCsvCell = string | number | null | undefined;

/**
 * The marker that tells Excel a file is UTF-8. Without it Excel reads the bytes as Windows-1252, so
 * an em dash arrives as `â€”` and every accent or non-Latin letter is garbled.
 */
const BYTE_ORDER_MARK = '﻿';

/** A cell that starts with one of these is run as a formula by Excel and Sheets. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(cell: NxsCsvCell): string {
  const text = cell === null || cell === undefined ? '' : String(cell);
  // A leading apostrophe makes the spreadsheet show the text as it is instead of calculating it.
  // A title is user-supplied, so `=HYPERLINK(...)` as a document name must not run. Only text can
  // be a formula: a number such as -12 is data and stays a number, so it can be summed.
  const safe = typeof cell === 'string' && FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Rows as CSV text: every cell quoted, quotes doubled, rows ending in CRLF as RFC 4180 writes
 * them, and a cell that would run as a spreadsheet formula made plain text.
 */
export function nxsCsvText(rows: readonly (readonly NxsCsvCell[])[]): string {
  return rows.map((row) => row.map(cellText).join(',')).join('\r\n');
}

/**
 * Downloads CSV as `filename`, starting with the UTF-8 byte order mark so Excel reads it right.
 * `content` is CSV text, or a CSV file the server produced.
 */
export function nxsDownloadCsv(
  filename: string,
  content: string | Blob,
  doc: Document = document,
): void {
  const blob = new Blob([BYTE_ORDER_MARK, content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
