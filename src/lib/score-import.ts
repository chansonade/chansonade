import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate';

export const MAX_SCORE_XML_BYTES = 5 * 1024 * 1024;
export const MAX_SCORE_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_ARCHIVE_DECLARED_BYTES = 32 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 64 * 1024;
const INVALID_ARCHIVE = 'L’archive MXL est invalide ou dépasse les limites autorisées.';

// This guard also applies to XML restored from storage or received from sync.
export function checkScoreXML(xml: string): void {
  if (xml.length > MAX_SCORE_XML_BYTES || new TextEncoder().encode(xml).length > MAX_SCORE_XML_BYTES) {
    throw new Error('La partition dépasse la limite de 5 Mio.');
  }
  // Normal MusicXML external DOCTYPEs are allowed; custom entities are not
  // needed for scores and could expand far beyond the size of the input.
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('Le fichier XML est invalide.');
}

function decodeXML(bytes: Uint8Array, container = false): string {
  if (bytes.length > (container ? MAX_CONTAINER_BYTES : MAX_SCORE_XML_BYTES)) {
    throw new Error(container ? INVALID_ARCHIVE : 'La partition dépasse la limite de 5 Mio.');
  }
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Le fichier XML est invalide.'); }
  checkScoreXML(xml);
  return xml;
}

function safePath(name: string): boolean {
  return !!name && name.length <= 512 && !/[\\\0]/.test(name) && !name.startsWith('/') && !name.split('/').includes('..');
}

function archiveEntries(bytes: Uint8Array): Map<string, UnzipFileInfo> {
  const entries = new Map<string, UnzipFileInfo>();
  let declaredBytes = 0;
  // fflate's filter runs before any allocation of the announced output size.
  // Do not use unzipSync to extract: a forged small size could truncate output
  // silently. The streaming pass below checks the real decompressed length.
  unzipSync(bytes, { filter: (entry) => {
    declaredBytes += entry.originalSize;
    if (entries.size >= MAX_ARCHIVE_ENTRIES || entries.has(entry.name) || !safePath(entry.name)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > bytes.length
      || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0
      || declaredBytes > MAX_ARCHIVE_DECLARED_BYTES) throw new Error(INVALID_ARCHIVE);
    entries.set(entry.name, entry);
    return false;
  } });
  if (!entries.size) throw new Error(INVALID_ARCHIVE);
  return entries;
}

function extract(bytes: Uint8Array, entries: Map<string, UnzipFileInfo>, name: string, limit: number): Uint8Array {
  const expected = entries.get(name);
  if (!expected || expected.originalSize > limit || ![0, 8].includes(expected.compression)) throw new Error(INVALID_ARCHIVE);
  let length = 0, complete = false;
  const chunks: Uint8Array[] = [];
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    const entry = entries.get(file.name);
    if (!entry || seen.has(file.name) || file.compression !== entry.compression
      || (file.size !== undefined && file.size !== entry.size)
      || (file.originalSize !== undefined && file.originalSize !== entry.originalSize)) throw new Error(INVALID_ARCHIVE);
    seen.add(file.name);
    if (file.name !== name) return;
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error(INVALID_ARCHIVE);
      length += chunk.length;
      if (length > limit || length > expected.originalSize) throw new Error(INVALID_ARCHIVE);
      chunks.push(chunk);
      if (final) complete = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // A small compressed block bounds allocation even when headers understate
  // the true size. Unwanted images, audio and auxiliary XML are never inflated.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  if (!complete || length !== expected.originalSize || seen.size !== entries.size) throw new Error(INVALID_ARCHIVE);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** Read a bounded UTF-8 MusicXML file or the root score of a bounded MXL. */
export function readMusicXML(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return decodeXML(bytes);
  if (bytes.length > MAX_SCORE_ARCHIVE_BYTES) throw new Error('L’archive MXL dépasse la limite de 10 Mio.');
  try {
    const entries = archiveEntries(bytes);
    let path = '';
    if (entries.has('META-INF/container.xml')) {
      const container = decodeXML(extract(bytes, entries, 'META-INF/container.xml', MAX_CONTAINER_BYTES), true);
      const doc = new DOMParser().parseFromString(container, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error(INVALID_ARCHIVE);
      path = doc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path') || '';
    }
    path ||= [...entries.keys()].find((name) => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name)) || '';
    if (!path || !entries.has(path)) throw new Error('Le fichier MXL ne contient pas de partition MusicXML.');
    return decodeXML(extract(bytes, entries, path, MAX_SCORE_XML_BYTES));
  } catch (error) {
    if (error instanceof Error && [INVALID_ARCHIVE, 'Le fichier MXL ne contient pas de partition MusicXML.', 'Le fichier XML est invalide.'].includes(error.message)) throw error;
    throw new Error(INVALID_ARCHIVE);
  }
}
