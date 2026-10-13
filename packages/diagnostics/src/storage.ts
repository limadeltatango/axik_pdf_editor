import {
  MAX_STORED_SESSIONS, RETENTION_DAYS,
  type StoredDiagnosticSession
} from "./types";

const DATABASE_NAME = "axik-pdf-local-diagnostics-v1";
const OBJECT_STORE = "sessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable; diagnostics are memory-only."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Diagnostics database unavailable."));
    request.onblocked = () => reject(new Error("Diagnostics database is blocked."));
  });
}

function isSession(value: unknown): value is StoredDiagnosticSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredDiagnosticSession>;
  return session.schema === 1 &&
    typeof session.sessionId === "string" && session.sessionId.length <= 64 &&
    typeof session.updatedAt === "string" && Number.isFinite(Date.parse(session.updatedAt)) &&
    Array.isArray(session.events) && session.events.length <= 600;
}

/** Atomic session replacement with lazy expiry and session count bounds. */
export async function saveSession(snapshot: StoredDiagnosticSession): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      const store = transaction.objectStore(OBJECT_STORE);
      let completed = false;
      const fail = (cause: unknown) => {
        if (completed) return;
        completed = true;
        reject(cause);
      };
      transaction.oncomplete = () => {
        if (completed) return;
        completed = true;
        resolve();
      };
      transaction.onabort = () => fail(transaction.error ?? new Error("Diagnostics save aborted."));
      transaction.onerror = () => fail(transaction.error ?? new Error("Diagnostics save failed."));
      store.put(snapshot);
      const request = store.getAll();
      request.onsuccess = () => {
        // Keep the newest bounded sessions; never store an unbounded history.
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const known = (request.result as unknown[]).filter(isSession);
        const valid = known.filter((session) => Date.parse(session.updatedAt) >= cutoff);
        valid.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        const keep = new Set(valid.slice(0, MAX_STORED_SESSIONS).map((session) => session.sessionId));
        for (const entry of request.result as Array<{sessionId?: string}>) {
          if (typeof entry.sessionId === "string" && !keep.has(entry.sessionId)) {
            store.delete(entry.sessionId);
          }
        }
      };
    });
  } finally {
    database.close();
  }
}

export async function readSessions(): Promise<StoredDiagnosticSession[]> {
  const database = await openDatabase();
  try {
    // Read and prune in one transaction. This also expires old history when
    // collection has been disabled and no new writes are scheduled.
    return await new Promise<StoredDiagnosticSession[]>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      const store = transaction.objectStore(OBJECT_STORE);
      let kept: StoredDiagnosticSession[] = [];
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result as unknown[];
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        kept = all.filter(isSession)
          .filter((session) => Date.parse(session.updatedAt) >= cutoff)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .slice(0, MAX_STORED_SESSIONS);
        const keys = new Set(kept.map((session) => session.sessionId));
        for (const raw of all) {
          if (raw && typeof raw === "object") {
            const id = (raw as {sessionId?: unknown}).sessionId;
            if (typeof id === "string" && !keys.has(id)) {
              store.delete(id);
            }
          }
        }
      };
      transaction.oncomplete = () => resolve(kept);
      transaction.onerror = () => reject(transaction.error ?? new Error("Diagnostics read/prune failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Diagnostics read/prune aborted."));
    });
  } finally {
    database.close();
  }
}

export async function clearSessions(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Diagnostics clear failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Diagnostics clear aborted."));
    });
  } finally {
    database.close();
  }
}
