import { encodeDiagnosticZip } from "./zip";
import { diagnostics } from "./recorder";
import {
  type DiagnosticRuntime, type ExportManifest
} from "./types";

export interface ExportOptions {
  includeEnvironment: boolean;
  includeGpuDetails: boolean;
}

interface SafeEnvironment {
  platform?: string;
  userAgent?: string;
  locale?: string;
  timezoneOffsetMinutes?: number;
  hardwareConcurrency?: number;
  deviceMemoryGiB?: number;
  devicePixelRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  webgl?: "webgl2" | "webgl" | "unavailable";
  gpuVendor?: string;
  gpuRenderer?: string;
}

function limited(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Defense in depth for environment string fields; no absolute paths, URLs,
  // newline data, or unbounded dynamically supplied values.
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[a-zA-Z]:\\[^\s]+/g, "[path]")
    .replace(/[\r\n\t\x00-\x1f]/g, " ")
    .slice(0, maxLength);
}

function collectEnvironment(withGpu: boolean): SafeEnvironment {
  const info: SafeEnvironment = {
    platform: limited(navigator.platform, 80),
    userAgent: limited(navigator.userAgent, 250),
    locale: limited(navigator.language, 30),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: (navigator as Navigator & {deviceMemory?: number}).deviceMemory,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };

  if (withGpu) {
    // Optional: this can be fingerprinting-sensitive and is NEVER collected
    // unless the user separately enables it in the export dialog.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      info.webgl = "unavailable";
      return info;
    }
    info.webgl = typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl";
    try {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) {
        info.gpuVendor = limited(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), 120);
        info.gpuRenderer = limited(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), 160);
      } else {
        info.gpuVendor = limited(gl.getParameter(gl.VENDOR), 120);
        info.gpuRenderer = limited(gl.getParameter(gl.RENDERER), 160);
      }
    } catch {
      // Disabled or reset GPU contexts are legitimate.
    } finally {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
  return info;
}

export interface SupportBundle {
  blob: Blob;
  filename: string;
  manifest: ExportManifest;
}

export async function createSupportBundle(
  runtime: DiagnosticRuntime,
  appVersion: string,
  options: ExportOptions
): Promise<SupportBundle> {
  const recent = await diagnostics.recent();
  const now = new Date();
  const includeEnvironment = Boolean(options.includeEnvironment);
  const includeGpuDetails = Boolean(options.includeGpuDetails && includeEnvironment);
  const events = recent.sessions
    .flatMap((session) => session.events)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) ||
      a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence);
  const manifest: ExportManifest = {
    format: "axik-pdf-diagnostics", schema: 1,
    createdAt: now.toISOString(), app: "Axik PDF Editor",
    runtime, appVersion, sessionCount: recent.sessions.length,
    eventCount: events.length, collectionEnabled: diagnostics.enabled,
    persistentStorageAvailable: recent.localStorageAvailable,
    includesEnvironment: includeEnvironment,
    includesGpuDetails: includeGpuDetails,
    excludes: [
      "PDF pages, bytes and text", "PDF filenames and local filesystem paths",
      "Document fingerprints and hashes", "Comments and annotation contents",
      "PDF URLs and browser tab URLs", "Passwords, tokens and credentials",
      "Raw exception messages and stack traces", "Screenshots and user inputs"
    ]
  };
  const readme = [
    "AXIK PDF EDITOR — LOCAL DIAGNOSTIC BUNDLE (schema v1)",
    "",
    "This ZIP was created locally by an explicit user action; the app does not upload it.",
    "Attach the ZIP to your support report or ChatGPT conversation to analyze issues.",
    "Review this ZIP before sharing. System details can identify your computer.",
    "",
    "manifest.json: schema, app/runtime, included categories and privacy exclusions.",
    "events.jsonl: ordered fixed diagnostic codes, numeric performance metrics and safe error categories.",
    "environment.json: browser/OS characteristics and optional GPU model (only if opted in).",
    "",
    "Not collected: PDF contents, names, paths, URLs, hashes, comments,",
    "annotation text, passwords, raw exception messages or stack traces.",
    "The native print-spooler / OS crash collection adapter is not yet implemented.",
    ""
  ].join("\n");
  const entries = [
    { name: "README.txt", text: readme },
    { name: "manifest.json", text: JSON.stringify(manifest, null, 2) + "\n" },
    { name: "events.jsonl", text: events.map((event) => JSON.stringify(event)).join("\n") + "\n" }
  ];
  if (includeEnvironment) {
    entries.push({
      name: "environment.json",
      text: JSON.stringify(collectEnvironment(includeGpuDetails), null, 2) + "\n"
    });
  }
  const archive = encodeDiagnosticZip(entries, now);
  // Explicit ArrayBuffer copy avoids BlobPart typing ambiguity for cross-runtime
  // array-buffer views on TypeScript's strict DOM typings.
  const copied = new Uint8Array(archive.byteLength);
  copied.set(archive);
  const blob = new Blob([copied.buffer], { type: "application/zip" });
  return {
    blob, manifest,
    filename: "axik-pdf-diagnostics-" + now.toISOString().replace(/[:.]/g, "-") + ".zip"
  };
}

/** Invoked only after the person has clicked Export in the Diagnostics panel. */
export function downloadSupportBundle(bundle: SupportBundle): void {
  const url = URL.createObjectURL(bundle.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = bundle.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
