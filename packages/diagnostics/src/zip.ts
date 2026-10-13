/**
 * Dependency-free, uncompressed ZIP (STORE method) for small diagnostic bundles.
 * All entry names are fixed ASCII paths. No PDF data or user-controlled filenames
 * can be added through this entry point. ZIP64 is deliberately unsupported.
 */
const encoder = new TextEncoder();
const MAX_FILES = 8;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export interface ZipEntry {
  readonly name: string;
  readonly text: string;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}
function dosTime(date: Date): {date: number; time: number} {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2)
  };
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  if (size > MAX_TOTAL_BYTES) throw new RangeError("Diagnostics ZIP exceeds the size limit.");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Creates a standards-compatible ZIP with stored entries and CRC32 checksums. */
export function encodeDiagnosticZip(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  if (!entries.length || entries.length > MAX_FILES) {
    throw new RangeError("Unexpected number of diagnostic ZIP entries.");
  }
  const names = new Set<string>();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const stamp = dosTime(now);
  let offset = 0;
  for (const entry of entries) {
    // Fixed conservative names: block traversal, hidden paths and arbitrary input.
    if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?$/.test(entry.name) ||
        names.has(entry.name)) {
      throw new RangeError("Unsafe or duplicate diagnostics ZIP entry name.");
    }
    names.add(entry.name);
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.text);
    if (content.byteLength > MAX_FILE_BYTES) {
      throw new RangeError("A diagnostics report entry is too large.");
    }
    const hash = crc32(content);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);   // ZIP version needed
    write16(localView, 6, 0x0800); // UTF-8 names
    write16(localView, 8, 0);    // compression STORE
    write16(localView, 10, stamp.time);
    write16(localView, 12, stamp.date);
    write32(localView, 14, hash);
    write32(localView, 18, content.byteLength);
    write32(localView, 22, content.byteLength);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, content);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20); // version made by
    write16(centralView, 6, 20); // version needed
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, stamp.time);
    write16(centralView, 14, stamp.date);
    write32(centralView, 16, hash);
    write32(centralView, 20, content.byteLength);
    write32(centralView, 24, content.byteLength);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, offset);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + content.length;
  }

  const directory = concatenate(centralParts);
  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);
  write32(view, 0, 0x06054b50);
  write16(view, 4, 0);
  write16(view, 6, 0);
  write16(view, 8, entries.length);
  write16(view, 10, entries.length);
  write32(view, 12, directory.byteLength);
  write32(view, 16, offset);
  write16(view, 20, 0);
  return concatenate([...localParts, directory, footer]);
}
