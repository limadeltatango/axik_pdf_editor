/**
 * APDF-45 — Explicit user-granted file saving for Chromium File System Access.
 *
 * This is a bounded alpha backend, NOT an arbitrary filesystem command.
 * Real Windows native file transactions and revision-baseline policy are separate
 * release gates. Never use this API to overwrite a file opened by drag/drop,
 * download or a regular <input type=file> (there is no trusted writable handle).
 */
import { documentFingerprint } from "@axik/recovery";

const MAX_SAVE_BYTES = 100 * 1024 * 1024;
export const PDF_PICKER_TYPES = [{
  description: "PDF Document",
  accept: { "application/pdf": [".pdf"] }
}] as const;

export interface WritableFileStreamLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface ExplicitFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry(other: ExplicitFileHandle): Promise<boolean>;
  createWritable(options?: { mode?: "exclusive" | "siloed" }): Promise<WritableFileStreamLike>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: object) => Promise<ExplicitFileHandle[]>;
  showSaveFilePicker?: (options?: object) => Promise<ExplicitFileHandle>;
}

export interface SelectedEditablePdf {
  file: File;
  handle: ExplicitFileHandle;
}
export class FileChangedError extends Error {
  constructor() {
    super("The original PDF changed outside Axik since it was opened. Save has been blocked.");
    this.name = "FileChangedError";
  }
}
export class FileSaveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileSaveSafetyError";
  }
}

export function supportsEditablePicker(): boolean {
  return typeof window !== "undefined" &&
    typeof (window as FilePickerWindow).showOpenFilePicker === "function";
}
export function supportsSavePicker(): boolean {
  return typeof window !== "undefined" &&
    typeof (window as FilePickerWindow).showSaveFilePicker === "function";
}

export async function pickEditablePdf(): Promise<SelectedEditablePdf> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) throw new FileSaveSafetyError("This browser does not support opening writable file handles.");
  const handles = await picker({
    multiple: false,
    types: PDF_PICKER_TYPES,
    excludeAcceptAllOption: false
  });
  const handle = handles[0];
  if (!handle || typeof handle.getFile !== "function" ||
      typeof handle.createWritable !== "function" ||
      typeof handle.isSameEntry !== "function") {
    throw new FileSaveSafetyError("A safe, writable file handle was not provided.");
  }
  const file = await handle.getFile();
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new FileSaveSafetyError("Please choose a PDF file.");
  }
  if (!file.size || file.size > MAX_SAVE_BYTES) {
    throw new FileSaveSafetyError("Save-enabled alpha supports PDF files up to 100 MiB.");
  }
  return { file, handle };
}

/** Must be initiated synchronously from a real user click to preserve activation. */
export function promptForSaveTarget(suggestedName: string): Promise<ExplicitFileHandle> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (!picker) throw new FileSaveSafetyError("Save As is not supported in this webview.");
  const safeName = suggestedName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .slice(0, 140);
  return picker({
    suggestedName: safeName.toLowerCase().endsWith(".pdf") ? safeName : safeName + ".pdf",
    types: PDF_PICKER_TYPES
  });
}

function assertPdf(bytes: Uint8Array): void {
  if (bytes.byteLength < 100 || bytes.byteLength > MAX_SAVE_BYTES) {
    throw new FileSaveSafetyError("The edited PDF is empty or exceeds the alpha save limit.");
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!prefix.startsWith("%PDF-")) {
    throw new FileSaveSafetyError("Writer output does not have a valid PDF header.");
  }
}
async function assertOriginalUnchanged(handle: ExplicitFileHandle, expectedHash: string): Promise<void> {
  const original = await handle.getFile();
  if (!original.size || original.size > MAX_SAVE_BYTES) {
    throw new FileSaveSafetyError("Original PDF is unavailable or too large for safe overwrite.");
  }
  const observedHash = await documentFingerprint(new Uint8Array(await original.arrayBuffer()));
  if (expectedHash !== observedHash) throw new FileChangedError();
}

async function writeAndVerify(
  handle: ExplicitFileHandle,
  edited: Uint8Array,
  expectedHash: string
): Promise<void> {
  let writable: WritableFileStreamLike | undefined;
  try {
    writable = await handle.createWritable({ mode: "exclusive" });
    await writable.write(edited);
    await writable.close();
  } catch (cause) {
    await writable?.abort?.(cause).catch(() => undefined);
    throw cause;
  }
  const written = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const writtenHash = await documentFingerprint(written);
  if (expectedHash !== writtenHash) {
    throw new FileSaveSafetyError("Post-write verification failed; restore from the separately saved backup.");
  }
}

/**
 * Save As is deliberately restricted to a new/empty selected destination.
 * Never overwrite an arbitrary nonempty target silently from the file picker.
 */
export async function safeSaveAs(
  target: ExplicitFileHandle,
  edited: Uint8Array,
  openedSource?: ExplicitFileHandle
): Promise<string> {
  assertPdf(edited);
  if (!target || typeof target.getFile !== "function" ||
      typeof target.createWritable !== "function") {
    throw new FileSaveSafetyError("No user-approved save destination.");
  }
  if (openedSource && await openedSource.isSameEntry(target)) {
    throw new FileSaveSafetyError("Save As cannot overwrite the original. Use Save with backup protection.");
  }
  // A newly chosen file may already exist; avoid destroying unrelated files.
  try {
    const existing = await target.getFile();
    if (existing.size > 0) {
      throw new FileSaveSafetyError("That destination already contains a file. Choose a new filename.");
    }
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === "NotFoundError")) throw cause;
  }
  const expected = await documentFingerprint(edited);
  await writeAndVerify(target, edited, expected);
  return expected;
}

/**
 * Save Current enforces:
 *  1. a previously user-picked original handle;
 *  2. a separately picked, empty backup destination distinct from original;
 *  3. content-hash conflict check before backup AND before overwrite;
 *  4. verified durable backup of the original;
 *  5. file-handle exclusive writable stream and verified replacement.
 *
 * Browser file-system providers vary; a fully atomic Windows native Save is a
 * separate task. In every error after backup, backup remains for recovery.
 */
export async function safeOverwriteOriginal({
  originalHandle, backupHandle, sourceFingerprint, originalBytes, editedBytes
}: {
  originalHandle: ExplicitFileHandle;
  backupHandle: ExplicitFileHandle;
  sourceFingerprint: string;
  originalBytes: Uint8Array;
  editedBytes: Uint8Array;
}): Promise<string> {
  assertPdf(originalBytes);
  assertPdf(editedBytes);
  if (!/^sha256:[0-9a-f]{64}$/.test(sourceFingerprint)) {
    throw new FileSaveSafetyError("Original fingerprint not ready.");
  }
  if (typeof originalHandle.isSameEntry !== "function" ||
      typeof backupHandle.isSameEntry !== "function") {
    throw new FileSaveSafetyError("The platform cannot safely compare original and backup locations.");
  }
  if (await originalHandle.isSameEntry(backupHandle)) {
    throw new FileSaveSafetyError("Backup must not be the same file as the original.");
  }
  await assertOriginalUnchanged(originalHandle, sourceFingerprint);

  const memoryHash = await documentFingerprint(originalBytes);
  if (memoryHash !== sourceFingerprint) throw new FileSaveSafetyError("Loaded source data has changed.");
  const backupFile = await backupHandle.getFile();
  if (backupFile.size > 0) {
    throw new FileSaveSafetyError("Backup destination already contains data; choose a new filename.");
  }
  await writeAndVerify(backupHandle, originalBytes, memoryHash);
  await assertOriginalUnchanged(originalHandle, sourceFingerprint);
  const newHash = await documentFingerprint(editedBytes);
  await writeAndVerify(originalHandle, editedBytes, newHash);
  return newHash;
}

export function backupSuggestedName(originalName: string): string {
  const stem = originalName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  return stem.slice(0, 90) + ".axik-before-save.pdf";
}
