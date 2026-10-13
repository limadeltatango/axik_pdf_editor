import {
  DIAGNOSTIC_CODES, MAX_EVENTS_PER_SESSION, MAX_STORED_SESSIONS, RETENTION_DAYS,
  errorKind, sanitizedMetrics,
  type DiagnosticArea, type DiagnosticCode, type DiagnosticEvent,
  type DiagnosticLevel, type DiagnosticRuntime, type NumericMetrics,
  type StoredDiagnosticSession
} from "./types";
import { clearSessions, readSessions, saveSession } from "./storage";

const ENABLED_KEY = "axik-pdf-diagnostics-enabled-v1";
const ALLOWED_AREAS: readonly DiagnosticArea[] = [
  "app", "ui", "document", "render", "annotation", "print",
  "storage", "extension", "native", "performance"
];

function randomId(): string {
  return crypto.randomUUID();
}

function readEnabledPreference(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true; // Storage failure does not prevent local in-memory reporting.
  }
}

function validEvent(value: unknown): DiagnosticEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<DiagnosticEvent>;
  if (raw.schema !== 1 ||
      typeof raw.sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.sessionId) ||
      !Number.isSafeInteger(raw.sequence) ||
      (raw.sequence ?? -1) < 0 ||
      typeof raw.timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.timestamp) ||
      !Number.isFinite(Date.parse(raw.timestamp)) ||
      !ALLOWED_AREAS.includes(raw.area as DiagnosticArea) ||
      !DIAGNOSTIC_CODES.includes(raw.code as DiagnosticCode) ||
      !["info", "warn", "error"].includes(raw.level as string)) {
    return undefined;
  }
  const result: DiagnosticEvent = {
    schema: 1, sessionId: raw.sessionId,
    sequence: raw.sequence!, timestamp: raw.timestamp,
    area: raw.area!, code: raw.code!, level: raw.level!
  };
  const metrics = sanitizedMetrics(raw.metrics);
  if (metrics) result.metrics = metrics;
  const safeKind = errorKind({ name: raw.errorKind });
  if (safeKind !== "Unknown") result.errorKind = safeKind;
  return result;
}

export interface RecentDiagnostics {
  sessions: StoredDiagnosticSession[];
  eventCount: number;
  persistentStorageAvailable: boolean;
}

/**
 * No content recording, no network API, no disk-file access.
 *
 * The recorder records fixed event codes, numeric metrics and whitelisted error
 * classes only. It deliberately does not log raw errors/stack traces because
 * those often include private paths, filenames, URLs or PDF contents.
 */
export class DiagnosticRecorder {
  private sessionId = randomId();
  private startedAt = new Date().toISOString();
  private runtime: DiagnosticRuntime = "unknown";
  private appVersion = "0.0.0";
  private events: DiagnosticEvent[] = [];
  private nextSequence = 0;
  private enabledState = readEnabledPreference();
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private storageWorking = true;
  private installed = false;

  configure(runtime: DiagnosticRuntime, appVersion: string): void {
    this.runtime = runtime;
    this.appVersion = /^[0-9a-zA-Z._-]{1,64}$/.test(appVersion)
      ? appVersion : "unknown";
    if (this.installed) return;
    this.installed = true;
    if (typeof window !== "undefined") {
      window.addEventListener("error", (event: ErrorEvent) => {
        this.recordError("ui", "GLOBAL_ERROR", event.error);
      });
      window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
        this.recordError("app", "GLOBAL_UNHANDLED_REJECTION", event.reason);
      });
    }
    this.record("app", "APP_START");
  }

  get enabled(): boolean { return this.enabledState; }
  get persistentStorageAvailable(): boolean { return this.storageWorking; }
  get currentSessionEventCount(): number { return this.events.length; }

  setEnabled(enabled: boolean): void {
    this.enabledState = enabled;
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
    } catch {
      // In-memory opt-out remains effective even with localStorage blocked.
    }
  }

  record(
    area: DiagnosticArea, code: DiagnosticCode,
    level: DiagnosticLevel = "info",
    metrics?: NumericMetrics
  ): void {
    if (!this.enabledState) return;
    if (!ALLOWED_AREAS.includes(area) || !DIAGNOSTIC_CODES.includes(code)) return;
    const event: DiagnosticEvent = {
      schema: 1, sessionId: this.sessionId,
      sequence: ++this.nextSequence, timestamp: new Date().toISOString(),
      area, code, level
    };
    const safe = sanitizedMetrics(metrics);
    if (safe) event.metrics = safe;
    this.append(event);
  }

  recordError(
    area: DiagnosticArea, code: DiagnosticCode,
    reason?: unknown, metrics?: NumericMetrics
  ): void {
    if (!this.enabledState) return;
    if (!ALLOWED_AREAS.includes(area) || !DIAGNOSTIC_CODES.includes(code)) return;
    const event: DiagnosticEvent = {
      schema: 1, sessionId: this.sessionId,
      sequence: ++this.nextSequence, timestamp: new Date().toISOString(),
      area, code, level: "error",
      errorKind: errorKind(reason)
    };
    const safe = sanitizedMetrics(metrics);
    if (safe) event.metrics = safe;
    this.append(event, true);
  }

  private append(event: DiagnosticEvent, urgent = false): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS_PER_SESSION) {
      this.events.splice(0, this.events.length - MAX_EVENTS_PER_SESSION);
    }
    this.dirty = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush();
    }, urgent ? 0 : 700);
  }

  /** Completes the local IndexedDB write (if available). Never blocks PDF operations. */
  async flush(): Promise<void> {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    if (!this.dirty) {
      await this.writeChain;
      return;
    }
    this.dirty = false;
    const snapshot: StoredDiagnosticSession = {
      schema: 1, sessionId: this.sessionId,
      runtime: this.runtime, appVersion: this.appVersion,
      startedAt: this.startedAt, updatedAt: new Date().toISOString(),
      events: this.events.slice()
    };
    this.writeChain = this.writeChain
      .then(() => saveSession(snapshot))
      .then(() => { this.storageWorking = true; })
      .catch(() => {
        // Failure is reflected in the exported manifest, never thrown into the
        // document editor or re-recorded as a recursive diagnostics event.
        this.storageWorking = false;
      });
    await this.writeChain;
  }

  async recent(): Promise<RecentDiagnostics> {
    await this.flush();
    let stored: StoredDiagnosticSession[] = [];
    try {
      stored = await readSessions();
      // A successful read does not prove the most recent write was durable.
      // Preserve a prior write failure in the exported health indicator.
    } catch {
      this.storageWorking = false;
    }
    const now = Date.now();
    const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const current: StoredDiagnosticSession = {
      schema: 1,
      sessionId: this.sessionId,
      runtime: this.runtime,
      appVersion: this.appVersion,
      startedAt: this.startedAt, updatedAt: new Date().toISOString(),
      events: this.events.slice()
    };
    const byId = new Map<string, StoredDiagnosticSession>();
    for (const session of stored) byId.set(session.sessionId, session);
    if (current.events.length > 0) {
      byId.set(current.sessionId, current);
    }
    const sessions = [...byId.values()]
      .filter((item) => Date.parse(item.updatedAt) >= cutoff)
      .map((item) => ({
        schema: 1 as const, sessionId: item.sessionId,
        runtime: (["desktop", "chromium-extension", "unknown"] as string[])
          .includes(item.runtime) ? item.runtime : "unknown" as DiagnosticRuntime,
        appVersion: /^[a-zA-Z0-9._-]{1,64}$/.test(item.appVersion)
          ? item.appVersion : "unknown",
        startedAt: item.startedAt,
        updatedAt: item.updatedAt,
        // Reconstruct only explicitly permitted properties to avoid exporting
        // extra data injected into IndexedDB by other sources.
        events: item.events.map(validEvent)
          .filter((event): event is DiagnosticEvent => !!event)
          .slice(-MAX_EVENTS_PER_SESSION)
      }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_STORED_SESSIONS);
    return {
      sessions,
      eventCount: sessions.reduce((count, session) => count + session.events.length, 0),
      persistentStorageAvailable: this.storageWorking
    };
  }

  /** Deletes existing history and resets the active in-memory recording. */
  async clear(): Promise<void> {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    await this.writeChain;
    let clearFailure: unknown;
    try {
      await clearSessions();
    } catch (reason) {
      clearFailure = reason;
      this.storageWorking = false;
    }
    // Clearing the active in-memory buffer must still work if IndexedDB is
    // blocked, unavailable or over quota.
    this.events = [];
    this.sessionId = randomId();
    this.startedAt = new Date().toISOString();
    this.nextSequence = 0;
    this.dirty = false;
    if (!clearFailure) this.storageWorking = true;
    if (clearFailure) throw clearFailure;
  }
}

/** One session per app tab/window; no shared personal identifier. */
export const diagnostics = new DiagnosticRecorder();
