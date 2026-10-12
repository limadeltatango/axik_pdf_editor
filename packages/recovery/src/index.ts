/**
 * Browser IndexedDB draft journal. This preserves annotations only: it is NOT
 * a PDF writer, a backup of the source PDF, or encrypted secure storage.
 * Every record is keyed by the original document's SHA-256 fingerprint.
 */
import {
  validateAnnotation, type Annotation, type EditorState
} from "@axik/document-core";

export const JOURNAL_SCHEMA_VERSION = 1;
const DATABASE_NAME = "axik-pdf-editor-drafts-v1";
const STORE_NAME = "drafts";
const MAX_JOURNAL_ANNOTATIONS = 50_000;

export interface DraftRecord {
  schema: 1;
  fingerprint: string;
  savedAt: string;
  revision: number;
  annotations: Annotation[];
}

export async function documentFingerprint(bytes: Uint8Array): Promise<string> {
  // Copy for compatibility with buffer views and browser implementations that
  // reject SharedArrayBuffer/ResizableArrayBuffer backed views.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return "sha256:" + Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0")).join("");
}

function assertFingerprint(value: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new RangeError("Draft fingerprint must be a SHA-256 hash.");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Draft storage is unavailable in this environment."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "fingerprint" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open draft store."));
    request.onblocked = () => reject(new Error("Draft store is locked by another session."));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return;
      settled = true;
      db.close();
      if (error) reject(error);
      else resolve(result as T);
    };
    let request: IDBRequest<T>;
    try {
      const tx = db.transaction(STORE_NAME, mode);
      request = action(tx.objectStore(STORE_NAME));
      tx.onabort = () => finish(tx.error ?? new Error("Draft transaction aborted."));
      tx.onerror = () => finish(tx.error ?? new Error("Draft storage transaction failed."));
      // For writes, resolve on commit, never just on successful request.
      tx.oncomplete = () => finish(undefined, request.result);
    } catch (error) {
      finish(error);
    }
  });
}

function validRecord(raw: unknown, expectedFingerprint: string): DraftRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Partial<DraftRecord>;
  if (record.schema !== JOURNAL_SCHEMA_VERSION ||
      record.fingerprint !== expectedFingerprint ||
      typeof record.savedAt !== "string" ||
      !Number.isFinite(Date.parse(record.savedAt)) ||
      !Number.isSafeInteger(record.revision) ||
      (record.revision ?? -1) < 0 ||
      !Array.isArray(record.annotations) ||
      record.annotations.length > MAX_JOURNAL_ANNOTATIONS) return undefined;
  try {
    record.annotations.forEach(validateAnnotation);
    if (new Set(record.annotations.map((a) => a.id)).size !== record.annotations.length) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return record as DraftRecord;
}

export async function readDraft(fingerprint: string): Promise<DraftRecord | undefined> {
  assertFingerprint(fingerprint);
  const raw: unknown = await transact("readonly", (store) => store.get(fingerprint));
  return validRecord(raw, fingerprint);
}

export async function writeDraft(fingerprint: string, state: EditorState): Promise<void> {
  assertFingerprint(fingerprint);
  if (state.annotations.length > MAX_JOURNAL_ANNOTATIONS) {
    throw new RangeError("Draft exceeds annotation count limit.");
  }
  const record: DraftRecord = {
    schema: JOURNAL_SCHEMA_VERSION,
    fingerprint,
    revision: state.revision,
    savedAt: new Date().toISOString(),
    annotations: state.annotations.map((annotation) => structuredClone(validateAnnotation(annotation)))
  };
  await transact("readwrite", (store) => store.put(record));
}

export async function deleteDraft(fingerprint: string): Promise<void> {
  assertFingerprint(fingerprint);
  await transact("readwrite", (store) => store.delete(fingerprint));
}
