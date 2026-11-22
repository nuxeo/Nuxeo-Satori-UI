/**
 * A ZIP reader for packages a customer hands over, which are untrusted input.
 *
 * Everything stays in memory: no entry is written to disk, so an entry name cannot place a file
 * anywhere, and nothing in the archive is ever run. It reads the two compression methods a Nuxeo
 * package uses (stored and deflated) and refuses, with the reason, everything a Studio package
 * never needs: encryption, ZIP64, archives split over several parts, names that are absolute or
 * climb with `..`, the same name twice, and data whose checksum or size does not match what the
 * archive declares. The limits bound what a hostile archive can cost: how many entries, how many
 * bytes in all once inflated, and how far one entry may inflate per compressed byte.
 *
 * Node has no ZIP reader of its own, and the repository's other reader
 * (`scripts/verify-package-zip.mjs`) calls the system `unzip`, which Windows does not have.
 */
import { crc32, inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;
const STORED = 0;
const DEFLATED = 8;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8_NAME = 0x800;

export interface ZipLimits {
  /** Most entries one archive may hold. */
  readonly maxEntries: number;
  /** Most bytes all of an archive's entries may hold once inflated. */
  readonly maxTotalBytes: number;
  /** Most bytes one entry may inflate to for each compressed byte. */
  readonly maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 1_000,
};

export class ZipError extends Error {
  override readonly name = 'ZipError';
}

/** The archive's files by name, in the order its central directory lists them. Directories are left out. */
export function readZip(
  archive: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ReadonlyMap<string, Buffer> {
  const end = findEndOfCentralDirectory(archive);
  const disk = archive.readUInt16LE(end + 4);
  const centralDisk = archive.readUInt16LE(end + 6);
  const entriesOnDisk = archive.readUInt16LE(end + 8);
  const entryCount = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);

  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported: a Studio package never needs one');
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipError('archives split over several parts are not supported');
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError(
      `the archive holds ${entryCount} entries, more than the ${limits.maxEntries} allowed`,
    );
  }
  if (centralOffset + centralSize > end) {
    throw new ZipError('the central directory runs past the end of the archive');
  }

  const files = new Map<string, Buffer>();
  let total = 0;
  let position = centralOffset;
  for (let index = 1; index <= entryCount; index++) {
    if (
      position + CENTRAL_HEADER_LENGTH > end ||
      archive.readUInt32LE(position) !== CENTRAL_DIRECTORY_HEADER
    ) {
      throw new ZipError(
        `entry ${index}: there is no central directory header where one should be`,
      );
    }
    const flags = archive.readUInt16LE(position + 8);
    const method = archive.readUInt16LE(position + 10);
    const expectedCrc = archive.readUInt32LE(position + 16);
    const compressedSize = archive.readUInt32LE(position + 20);
    const size = archive.readUInt32LE(position + 24);
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const localOffset = archive.readUInt32LE(position + 42);
    const nameStart = position + CENTRAL_HEADER_LENGTH;
    position = nameStart + nameLength + extraLength + commentLength;
    if (position > end) {
      throw new ZipError(`entry ${index}: its header runs past the central directory`);
    }

    const name = entryName(archive.subarray(nameStart, nameStart + nameLength), flags, index);
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipError(`${name}: encrypted entries are not supported`);
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError(`${name}: ZIP64 entries are not supported`);
    }
    if (name.endsWith('/')) {
      if (size !== 0) throw new ZipError(`${name}: a directory entry holds data`);
      continue;
    }
    if (files.has(name)) {
      throw new ZipError(`${name}: the archive holds this name twice`);
    }
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`${name}: compression method ${method} is not supported`);
    }

    total += size;
    if (total > limits.maxTotalBytes) {
      throw new ZipError(
        `the archive inflates to more than the ${limits.maxTotalBytes} bytes allowed`,
      );
    }
    if (method === DEFLATED && size > Math.max(compressedSize, 1) * limits.maxRatio) {
      throw new ZipError(
        `${name}: ${compressedSize} bytes would inflate to ${size}, more than ${limits.maxRatio} times their size`,
      );
    }

    const data = entryData(archive, localOffset, compressedSize, centralOffset, name);
    const content = method === STORED ? stored(data, size, name) : inflated(data, size, name);
    if (crc32(content) !== expectedCrc) {
      throw new ZipError(`${name}: its checksum does not match its content`);
    }
    files.set(name, content);
  }
  // The entries read must fill the central directory exactly. An end record that understates the
  // count would otherwise hide the entries beyond it from this reader while other tools list them,
  // which is how a bundle could carry files the inventory never sees.
  if (position !== centralOffset + centralSize) {
    throw new ZipError(
      `the central directory holds more than the ${entryCount} entries its end record declares`,
    );
  }
  return files;
}

/**
 * The end-of-central-directory record, searched for from the end because a comment of up to 64 KiB
 * may follow it. A match must account for the archive's last byte, so the signature's bytes inside
 * a comment are not taken for the record.
 */
function findEndOfCentralDirectory(archive: Buffer): number {
  const last = archive.length - END_RECORD_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let at = last; at >= first; at--) {
    if (
      archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY &&
      at + END_RECORD_LENGTH + archive.readUInt16LE(at + 20) === archive.length
    ) {
      return at;
    }
  }
  throw new ZipError('not a ZIP archive: it has no end-of-central-directory record');
}

/** The entry's name, as `/`-separated segments that stay inside the archive. */
function entryName(raw: Buffer, flags: number, index: number): string {
  // Bit 11 marks a UTF-8 name. Without it the name is in code page 437, which agrees with
  // Latin-1 on every ASCII name, and a Studio package's names are ASCII.
  const name = raw
    .toString((flags & FLAG_UTF8_NAME) !== 0 ? 'utf8' : 'latin1')
    .replaceAll('\\', '/');
  if (name.length === 0) throw new ZipError(`entry ${index}: it has no name`);
  if (name.includes('\0')) throw new ZipError(`entry ${index}: its name holds a NUL character`);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new ZipError(`${name}: absolute names are not allowed`);
  }
  const segments = name.split('/');
  if (name.endsWith('/')) segments.pop();
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ZipError(`${name}: a name may not hold an empty, "." or ".." segment`);
  }
  return name;
}

/** The entry's compressed bytes, which must end before the central directory starts. */
function entryData(
  archive: Buffer,
  localOffset: number,
  compressedSize: number,
  limit: number,
  name: string,
): Buffer {
  if (
    localOffset + LOCAL_HEADER_LENGTH > limit ||
    archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER
  ) {
    throw new ZipError(`${name}: there is no local header where the central directory says`);
  }
  const start =
    localOffset +
    LOCAL_HEADER_LENGTH +
    archive.readUInt16LE(localOffset + 26) +
    archive.readUInt16LE(localOffset + 28);
  if (start + compressedSize > limit) {
    throw new ZipError(`${name}: its data runs into the central directory`);
  }
  return archive.subarray(start, start + compressedSize);
}

function stored(data: Buffer, size: number, name: string): Buffer {
  if (data.length !== size) {
    throw new ZipError(`${name}: it is stored as ${data.length} bytes but declares ${size}`);
  }
  return Buffer.from(data);
}

function inflated(data: Buffer, size: number, name: string): Buffer {
  let content: Buffer;
  try {
    // One byte of headroom over the declared size: a stream that inflates to more stops there
    // and is refused, rather than being inflated in full first.
    content = inflateRawSync(data, { maxOutputLength: size + 1 });
  } catch (error) {
    throw new ZipError(
      `${name}: it does not inflate to the ${size} bytes it declares (${(error as Error).message})`,
    );
  }
  if (content.length !== size) {
    throw new ZipError(
      `${name}: it inflates to ${content.length} bytes, not the ${size} it declares`,
    );
  }
  return content;
}
