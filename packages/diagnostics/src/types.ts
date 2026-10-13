/**
 * Content-free diagnostics schema. Events must never carry document bytes,
 * text, filenames, full paths, URLs, hashes, annotations, arbitrary strings,
 * stack traces, process command lines or credentials.
 */
export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;
export const RETENTION_DAYS = 7;
export const MAX_EVENTS_PER_SESSION = 600;
export const MAX_STORED_SESSIONS = 8;
export const MAX_EXPORTED_EVENTS = MAX_EVENTS_PER_SESSION * MAX_STORED_SESSIONS;

export type DiagnosticRuntime = "desktop" | "chromium-extension" | "unknown";
export type DiagnosticArea =
  | "app" | "ui" | "document" | "render" | "annotation" | "print"
  | "storage" | "extension" | "native" | "performance";
export type DiagnosticLevel = "info" | "warn" | "error";
export type ErrorKind =
  | "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError"
  | "AbortError" | "NetworkError" | "QuotaExceededError"
  | "SecurityError" | "NotAllowedError" | "InvalidStateError" | "Unknown";

/** Fixed event codes: accidental free-form user text cannot become an event name. */
export const DIAGNOSTIC_CODES = [
  "APP_START", "APP_READY", "APP_RECOVERED", "UI_EXCEPTION",
  "GLOBAL_ERROR", "GLOBAL_UNHANDLED_REJECTION",
  "PDF_OPEN_START", "PDF_OPEN_OK", "PDF_OPEN_FAILED",
  "PDF_PAGE_LOAD_START", "PDF_PAGE_LOAD_OK", "PDF_PAGE_LOAD_FAILED",
  "PDF_RENDER_START", "PDF_RENDER_OK", "PDF_RENDER_FAILED", "PDF_RENDER_CANCELLED",
  "ANNOTATION_ADDED", "ANNOTATION_UPDATED", "ANNOTATION_REMOVED",
  "ANNOTATION_RESTORED",
  "DRAFT_READ_FAILED", "DRAFT_WRITE_OK", "DRAFT_WRITE_FAILED",
  "PRINT_PLAN_OPEN", "PRINT_PLAN_OK", "PRINT_PLAN_FAILED",
  "PDF_EXPORT_BLOCKED", "PDF_EXPORT_OK", "PDF_EXPORT_FAILED",
  "PDF_SAVE_START", "PDF_SAVE_OK", "PDF_SAVE_FAILED", "PDF_SAVE_CONFLICT",
  "PDF_SAVE_AS_START", "PDF_SAVE_AS_OK", "PDF_SAVE_AS_FAILED",
  "EXTENSION_FETCH_START", "EXTENSION_FETCH_OK",
  "EXTENSION_FETCH_FAILED", "EXTENSION_PERMISSION_DENIED",
  "NATIVE_BRIDGE_FAILED", "GPU_DEVICE_LOST", "GPU_FALLBACK"
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];

/** Numeric-only metrics, with a strictly enumerated schema. */
export type MetricName =
  | "durationMs" | "fileSizeBucketMiB" | "pageCount" | "pageIndex"
  | "zoomPercent" | "annotationCount" | "warningCount" | "sheetCount"
  | "cacheBytes" | "textureUploadMs" | "frameMs";
export type NumericMetrics = Readonly<Partial<Record<MetricName, number>>>;

export interface DiagnosticEvent {
  schema: 1;
  sessionId: string;
  sequence: number;
  timestamp: string;
  area: DiagnosticArea;
  code: DiagnosticCode;
  level: DiagnosticLevel;
  metrics?: NumericMetrics;
  errorKind?: ErrorKind;
}

export interface StoredDiagnosticSession {
  schema: 1;
  sessionId: string;
  runtime: DiagnosticRuntime;
  appVersion: string;
  startedAt: string;
  updatedAt: string;
  events: DiagnosticEvent[];
}

export interface ExportManifest {
  format: "axik-pdf-diagnostics";
  schema: 1;
  createdAt: string;
  app: "Axik PDF Editor";
  runtime: DiagnosticRuntime;
  appVersion: string;
  sessionCount: number;
  eventCount: number;
  collectionEnabled: boolean;
  persistentStorageAvailable: boolean;
  includesEnvironment: boolean;
  includesGpuDetails: boolean;
  /** Explicit exclusions are contractual, not inferred from user data. */
  excludes: readonly string[];
}

const ERRORS: readonly ErrorKind[] = [
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
  "AbortError", "NetworkError", "QuotaExceededError", "SecurityError",
  "NotAllowedError", "InvalidStateError", "Unknown"
];

export function errorKind(value: unknown): ErrorKind {
  // No .message or .stack access: those can contain a user's filename, PDF
  // content, URL, access token or personal data.
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return "Unknown";
  }
  try {
    const name: unknown = (value as { name?: unknown }).name;
    return typeof name === "string" && ERRORS.includes(name as ErrorKind)
      ? name as ErrorKind : "Unknown";
  } catch {
    return "Unknown";
  }
}

const METRIC_NAMES: readonly MetricName[] = [
  "durationMs", "fileSizeBucketMiB", "pageCount", "pageIndex",
  "zoomPercent", "annotationCount", "warningCount", "sheetCount",
  "cacheBytes", "textureUploadMs", "frameMs"
];

/** Strips arbitrary keys, NaN, infinities and unreasonable values. */
export function sanitizedMetrics(metrics?: NumericMetrics): NumericMetrics | undefined {
  if (!metrics) return undefined;
  const safe: Partial<Record<MetricName, number>> = {};
  for (const key of METRIC_NAMES) {
    const value = metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < 0 || value > 1e12) continue;
    safe[key] = Math.round(value * 100) / 100;
  }
  return Object.keys(safe).length ? safe : undefined;
}

/** Approximate logarithmic bucket, not a filename/hash or exact file size. */
export function fileSizeBucketMiB(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength < 0) return 0;
  const mebibytes = byteLength / (1024 * 1024);
  return mebibytes === 0 ? 0 : 2 ** Math.ceil(Math.log2(Math.max(1, mebibytes)));
}
