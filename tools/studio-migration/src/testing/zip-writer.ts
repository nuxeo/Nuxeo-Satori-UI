/**
 * Test-only: writes ZIP archives, well-formed or deliberately not, so the reader's refusals can be
 * seen failing on purpose. Each `override` corrupts one field of one entry exactly as a hostile or
 * broken archive would.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipWriterEntry {
  readonly name: string;
  readonly data: Buffer | string;
  /** 8 (deflated, the default) or 0 (stored). Any other value is written as is. */
  readonly method?: number;
  readonly override?: {
    readonly flags?: number;
    readonly crc?: number;
    /** The uncompressed size the headers declare, instead of the real one. */
    readonly size?: number;
    /** Written into the name field byte for byte, instead of `name` in UTF-8. */
    readonly rawName?: Buffer;
  };
}

export interface ZipWriterOptions {
  readonly comment?: string;
  /** The total entry count the end record declares, instead of the real one. */
  readonly declaredEntries?: number;
}

const UTF8_NAME = 0x800;

export function writeZip(
  entries: readonly ZipWriterEntry[],
  options: ZipWriterOptions = {},
): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.override?.rawName ?? Buffer.from(entry.name, 'utf8');
    const content = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(content) : content;
    const flags = entry.override?.flags ?? UTF8_NAME;
    const crc = entry.override?.crc ?? crc32(content);
    const size = entry.override?.size ?? content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const count = options.declaredEntries ?? entries.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, directory, end, comment]);
}
