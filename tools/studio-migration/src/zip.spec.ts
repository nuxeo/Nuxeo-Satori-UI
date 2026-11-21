import { DEFAULT_ZIP_LIMITS, readZip, ZipError } from './zip';
import { writeZip } from './testing/zip-writer';

describe('readZip', () => {
  it('reads stored and deflated entries, in order, and leaves directories out', () => {
    const archive = writeZip([
      { name: 'web/', data: '', method: 0 },
      { name: 'web/a.html', data: '<p>a</p>', method: 0 },
      { name: 'web/b.json', data: JSON.stringify({ key: 'value'.repeat(50) }) },
      { name: 'empty.txt', data: '' },
    ]);
    const files = readZip(archive);
    expect([...files.keys()]).toEqual(['web/a.html', 'web/b.json', 'empty.txt']);
    expect(files.get('web/a.html')?.toString()).toBe('<p>a</p>');
    expect(JSON.parse(files.get('web/b.json')?.toString() ?? 'null')).toEqual({
      key: 'value'.repeat(50),
    });
    expect(files.get('empty.txt')?.length).toBe(0);
  });

  it('finds the end record behind a comment, even one holding its signature', () => {
    const signature = Buffer.alloc(4);
    signature.writeUInt32LE(0x06054b50);
    const archive = writeZip([{ name: 'a.txt', data: 'a' }], {
      comment: `before ${signature.toString('latin1')} after`,
    });
    expect(readZip(archive).get('a.txt')?.toString()).toBe('a');
  });

  it('turns backslashes into slashes', () => {
    const archive = writeZip([{ name: 'ui\\a.html', data: 'a' }]);
    expect([...readZip(archive).keys()]).toEqual(['ui/a.html']);
  });

  // Negative controls: each archive below is broken in one way, and each must be refused.
  describe('refuses', () => {
    const refusal = (archive: Buffer, limits = DEFAULT_ZIP_LIMITS) => {
      try {
        readZip(archive, limits);
      } catch (error) {
        expect(error).toBeInstanceOf(ZipError);
        return (error as Error).message;
      }
      throw new Error('the archive was accepted');
    };

    it('what is not a ZIP archive', () => {
      expect(refusal(Buffer.from('not an archive at all, but long enough to search'))).toMatch(
        /no end-of-central-directory record/,
      );
      expect(refusal(Buffer.alloc(0))).toMatch(/no end-of-central-directory record/);
    });

    it('a name that climbs out of the archive', () => {
      expect(refusal(writeZip([{ name: '../outside.txt', data: 'x' }]))).toMatch(/"\.\." segment/);
      expect(refusal(writeZip([{ name: 'ui\\..\\..\\x', data: 'x' }]))).toMatch(/"\.\." segment/);
      expect(refusal(writeZip([{ name: 'a//b', data: 'x' }]))).toMatch(/empty/);
    });

    it('an absolute name', () => {
      expect(refusal(writeZip([{ name: '/etc/passwd', data: 'x' }]))).toMatch(/absolute/);
      expect(refusal(writeZip([{ name: 'C:/x.txt', data: 'x' }]))).toMatch(/absolute/);
    });

    it('a name holding a NUL character', () => {
      const rawName = Buffer.from('a\0b.txt', 'latin1');
      expect(refusal(writeZip([{ name: 'ignored', data: 'x', override: { rawName } }]))).toMatch(
        /NUL/,
      );
    });

    it('the same name twice', () => {
      const archive = writeZip([
        { name: 'a.txt', data: 'one' },
        { name: 'a.txt', data: 'two' },
      ]);
      expect(refusal(archive)).toMatch(/holds this name twice/);
    });

    it('an encrypted entry', () => {
      expect(refusal(writeZip([{ name: 'a.txt', data: 'x', override: { flags: 0x801 } }]))).toMatch(
        /encrypted/,
      );
    });

    it('a compression method other than stored or deflated', () => {
      expect(refusal(writeZip([{ name: 'a.txt', data: 'x', method: 12 }]))).toMatch(
        /compression method 12/,
      );
    });

    it('a ZIP64 archive', () => {
      expect(
        refusal(writeZip([{ name: 'a.txt', data: 'x' }], { declaredEntries: 0xffff })),
      ).toMatch(/ZIP64/);
    });

    it('content whose checksum does not match', () => {
      expect(refusal(writeZip([{ name: 'a.txt', data: 'x', override: { crc: 12345 } }]))).toMatch(
        /checksum/,
      );
    });

    it('a stored entry whose declared size is not its size', () => {
      const archive = writeZip([{ name: 'a.txt', data: 'abc', method: 0, override: { size: 2 } }]);
      expect(refusal(archive)).toMatch(/stored as 3 bytes but declares 2/);
    });

    it('a deflated entry that inflates to more than it declares', () => {
      const archive = writeZip([{ name: 'a.txt', data: 'x'.repeat(5000), override: { size: 10 } }]);
      expect(refusal(archive)).toMatch(/does not inflate to the 10 bytes it declares/);
    });

    it('a deflated entry that inflates to less than it declares', () => {
      const archive = writeZip([{ name: 'a.txt', data: 'abc', override: { size: 50 } }]);
      expect(refusal(archive)).toMatch(/inflates to 3 bytes, not the 50 it declares/);
    });

    it('more entries than allowed', () => {
      const archive = writeZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b' },
      ]);
      expect(refusal(archive, { ...DEFAULT_ZIP_LIMITS, maxEntries: 1 })).toMatch(
        /2 entries, more than the 1 allowed/,
      );
    });

    it('more bytes in all than allowed', () => {
      const archive = writeZip([
        { name: 'a.txt', data: 'a'.repeat(600) },
        { name: 'b.txt', data: 'b'.repeat(600) },
      ]);
      expect(refusal(archive, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 1000 })).toMatch(
        /more than the 1000 bytes allowed/,
      );
    });

    it('an entry that inflates further than the ratio allows, as a ZIP bomb does', () => {
      const archive = writeZip([{ name: 'bomb.txt', data: Buffer.alloc(100_000) }]);
      expect(refusal(archive, { ...DEFAULT_ZIP_LIMITS, maxRatio: 10 })).toMatch(
        /more than 10 times their size/,
      );
    });

    it('a truncated archive', () => {
      const archive = writeZip([{ name: 'a.txt', data: 'abc' }]);
      const end = archive.subarray(archive.length - 22);
      // The entry's local header and data are gone; the central directory points into nothing.
      const truncated = Buffer.concat([archive.subarray(0, 10), end]);
      expect(refusal(truncated)).toMatch(/central directory runs past|no central directory header/);
    });
  });
});
