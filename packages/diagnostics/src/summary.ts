import type { DiagnosticCode, DiagnosticEvent } from "./types";

export interface DiagnosticCount {
  code: DiagnosticCode;
  count: number;
}
export interface TimingSummary {
  code: DiagnosticCode;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}
export interface DiagnosticSummary {
  schema: 1;
  totalEvents: number;
  errorEvents: number;
  byCode: DiagnosticCount[];
  timings: TimingSummary[];
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregate only already-whitelisted event codes and numeric timings.
 * This is intentionally content-free and safe to include in support bundles.
 */
export function summarizeDiagnostics(events: readonly DiagnosticEvent[]): DiagnosticSummary {
  const counts = new Map<DiagnosticCode, number>();
  const timings = new Map<DiagnosticCode, number[]>();
  let errors = 0;
  for (const event of events) {
    counts.set(event.code, (counts.get(event.code) ?? 0) + 1);
    if (event.level === "error") errors++;
    const duration = event.metrics?.durationMs;
    if (typeof duration === "number" && Number.isFinite(duration) &&
        duration >= 0 && duration <= 1e12) {
      const sample = timings.get(event.code) ?? [];
      sample.push(duration);
      timings.set(event.code, sample);
    }
  }
  return {
    schema: 1,
    totalEvents: events.length,
    errorEvents: errors,
    byCode: [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    timings: [...timings.entries()].map(([code, samples]) => {
      const sorted = samples.slice().sort((a, b) => a - b);
      return {
        code, samples: sorted.length,
        p50Ms: rounded(percentile(sorted, .5)),
        p95Ms: rounded(percentile(sorted, .95)),
        maxMs: rounded(sorted[sorted.length - 1] ?? 0)
      };
    }).sort((a, b) => b.p95Ms - a.p95Ms)
  };
}
