import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { nxsCsvText, nxsDownloadCsv } from './csv-export';

describe('nxsCsvText', () => {
  it('quotes every cell and ends rows with CRLF', () => {
    expect(
      nxsCsvText([
        ['Title', 'Type'],
        ['Report', 'File'],
      ]),
    ).toBe('"Title","Type"\r\n"Report","File"');
  });

  it('doubles a quote inside a cell and keeps commas and line breaks in one cell', () => {
    expect(nxsCsvText([['Say "hi", then\nleave']])).toBe('"Say ""hi"", then\nleave"');
  });

  it('writes null, undefined and numbers without a placeholder', () => {
    expect(nxsCsvText([[null, undefined, 3, 0.1, '']])).toBe('"","","3","0.1",""');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd', '=HYPERLINK("http://x","y")'])(
    'makes %j plain text, so a spreadsheet does not run it as a formula',
    (cell) => {
      expect(nxsCsvText([[cell]])).toBe(`"'${cell.replaceAll('"', '""')}"`);
    },
  );

  it('keeps a negative number a number, since only text can be a formula', () => {
    expect(nxsCsvText([[-12, -0.5, '-12']])).toBe(`"-12","-0.5","'-12"`);
  });

  it('leaves text that merely contains an operator, and an em dash, as it is', () => {
    expect(nxsCsvText([['a=b', 'x-y', '11/10/2026', '—']])).toBe('"a=b","x-y","11/10/2026","—"');
  });
});

describe('nxsDownloadCsv', () => {
  let created: Blob[];
  let click: Mock<() => void>;
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    click = vi.fn<() => void>();
    revoke = vi.fn();
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:csv-1';
      }),
      revokeObjectURL: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  async function bytes(blob: Blob): Promise<number[]> {
    return [...new Uint8Array(await blob.arrayBuffer())];
  }

  it('starts the file with the UTF-8 byte order mark, then the text as UTF-8', async () => {
    nxsDownloadCsv('search-results.csv', nxsCsvText([['—']]));
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('text/csv;charset=utf-8');
    // EF BB BF is the UTF-8 byte order mark; E2 80 94 is the em dash, in quotes.
    expect(await bytes(created[0] as Blob)).toEqual([
      0xef, 0xbb, 0xbf, 0x22, 0xe2, 0x80, 0x94, 0x22,
    ]);
  });

  it('puts the mark in front of a CSV file the server produced', async () => {
    nxsDownloadCsv('export.csv', new Blob(['uid,title\n1,A\n']));
    const data = await bytes(created[0] as Blob);
    expect(data.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    // `Blob.text()` drops a leading mark, so the rest is read from the bytes after it.
    expect(new TextDecoder().decode(new Uint8Array(data.slice(3)))).toBe('uid,title\n1,A\n');
  });

  it('downloads under the given name and releases the object URL', () => {
    const anchors: HTMLAnchorElement[] = [];
    const doc = document.implementation.createHTMLDocument('csv');
    const make = doc.createElement.bind(doc);
    vi.spyOn(doc, 'createElement').mockImplementation(((tag: string) => {
      const element = make(tag);
      if (element instanceof HTMLAnchorElement) anchors.push(element);
      return element;
    }) as typeof doc.createElement);

    nxsDownloadCsv('trash.csv', 'a', doc);

    expect(anchors[0]?.download).toBe('trash.csv');
    expect(anchors[0]?.getAttribute('href')).toBe('blob:csv-1');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:csv-1');
  });

  it('releases the object URL even when the click throws', () => {
    click.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => nxsDownloadCsv('a.csv', 'a')).toThrow('blocked');
    expect(revoke).toHaveBeenCalledWith('blob:csv-1');
  });
});
