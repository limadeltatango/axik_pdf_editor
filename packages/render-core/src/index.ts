/**
 * Generic worker/render scheduling primitives shared between desktop/Chromium.
 *
 * Does not select a GPU or imply that PDF.js paints vectors on the GPU. Raster,
 * upload and compositor timings must be measured separately before acceleration
 * claims can be made.
 */
export type RenderPriority = 0 | 1 | 2; // 0 visible, 1 near viewport, 2 thumbnail

function abortError(reason: string): Error {
  const error = new Error(reason);
  error.name = "AbortError";
  return error;
}

interface QueuedTask {
  key: string;
  priority: RenderPriority;
  controller: AbortController;
  start: () => void;
  reject: (reason: unknown) => void;
}

export class BoundedRenderQueue {
  private readonly maxParallel: number;
  private readonly maxQueued: number;
  private pending: QueuedTask[] = [];
  private active = new Map<string, AbortController>();
  private disposed = false;

  constructor(maxParallel = 2, maxQueued = 32) {
    if (!Number.isSafeInteger(maxParallel) || maxParallel < 1 || maxParallel > 16) {
      throw new RangeError("Parallel rendering must be between 1 and 16 jobs.");
    }
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > 10000) {
      throw new RangeError("Queue size must be between 1 and 10000 jobs.");
    }
    this.maxParallel = maxParallel;
    this.maxQueued = maxQueued;
  }

  schedule<T>(
    key: string,
    priority: RenderPriority,
    render: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.disposed) return Promise.reject(abortError("Render scheduler is disposed."));
    if (!key || key.length > 300) return Promise.reject(new RangeError("Invalid job key."));
    this.cancel(key);
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const task: QueuedTask = {
        key, priority, controller, reject,
        start: () => {
          this.active.set(key, controller);
          Promise.resolve()
            .then(() => render(controller.signal))
            .then(resolve, reject)
            .finally(() => {
              if (this.active.get(key) === controller) this.active.delete(key);
              this.pump();
            });
        }
      };
      this.pending.push(task);
      this.pending.sort((a, b) => a.priority - b.priority);
      if (this.pending.length > this.maxQueued) {
        const evicted = this.pending.pop()!;
        evicted.controller.abort();
        evicted.reject(abortError("Render queue capacity exceeded."));
      }
      this.pump();
    });
  }

  cancel(key: string): void {
    const controller = this.active.get(key);
    if (controller) {
      controller.abort();
      this.active.delete(key);
    }
    const retained: QueuedTask[] = [];
    for (const task of this.pending) {
      if (task.key === key) {
        task.controller.abort();
        task.reject(abortError("Render job superseded."));
      } else retained.push(task);
    }
    this.pending = retained;
  }

  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    for (const task of this.pending) {
      task.controller.abort();
      task.reject(abortError("Render job cancelled."));
    }
    this.pending = [];
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
  }

  get stats(): { running: number; queued: number } {
    return { running: this.active.size, queued: this.pending.length };
  }

  private pump(): void {
    while (!this.disposed && this.active.size < this.maxParallel && this.pending.length) {
      const task = this.pending.shift()!;
      if (!task.controller.signal.aborted) task.start();
    }
  }
}

/**
 * Bounded ownership-aware resource cache. A future GPU or Canvas renderer may
 * cache tiles here and supply a destroy callback for GPU texture disposal.
 */
export class ByteBudgetCache<T> {
  private readonly maxBytes: number;
  private readonly items = new Map<string, { value: T; bytes: number; dispose: (value: T) => void }>();
  private occupiedBytes = 0;

  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 ** 3) {
      throw new RangeError("Cache budget must be a positive, bounded byte count.");
    }
    this.maxBytes = maxBytes;
  }

  get(key: string): T | undefined {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    this.items.delete(key);
    this.items.set(key, entry); // refresh least-recently-used order
    return entry.value;
  }

  set(key: string, value: T, bytes: number, dispose: (value: T) => void): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError("Invalid cache entry byte count.");
    this.delete(key);
    if (bytes > this.maxBytes) {
      dispose(value);
      return false;
    }
    while (this.occupiedBytes + bytes > this.maxBytes) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.items.set(key, { value, bytes, dispose });
    this.occupiedBytes += bytes;
    return true;
  }

  delete(key: string): void {
    const previous = this.items.get(key);
    if (!previous) return;
    this.items.delete(key);
    this.occupiedBytes -= previous.bytes;
    previous.dispose(previous.value);
  }

  clear(): void {
    for (const key of [...this.items.keys()]) this.delete(key);
  }

  get stats(): { count: number; bytes: number; budget: number } {
    return { count: this.items.size, bytes: this.occupiedBytes, budget: this.maxBytes };
  }
}

export type PerformanceStage =
  | "file-read" | "pdf-open" | "page-raster" | "texture-upload"
  | "gpu-composite" | "preview-plan" | "save";

export class PerformanceSamples {
  private readonly samples = new Map<PerformanceStage, number[]>();
  constructor(private readonly maxPerStage = 200) {
    if (!Number.isSafeInteger(maxPerStage) || maxPerStage < 5 || maxPerStage > 10_000) {
      throw new RangeError("Invalid performance sample capacity.");
    }
  }

  record(stage: PerformanceStage, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const values = this.samples.get(stage) ?? [];
    values.push(elapsedMs);
    if (values.length > this.maxPerStage) values.shift();
    this.samples.set(stage, values);
  }

  summarize(stage: PerformanceStage): { samples: number; p50: number; p95: number } | undefined {
    const values = this.samples.get(stage);
    if (!values?.length) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
    return { samples: sorted.length, p50: at(.5), p95: at(.95) };
  }
}
