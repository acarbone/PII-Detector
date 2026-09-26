import { performance } from "node:perf_hooks";

export interface ProgressStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface ProgressOptions {
  total: number;
  /** Defaults to process.stderr so stdout carries only the report (REQ-PRG-03). */
  stream?: ProgressStream;
  /** Monotonic clock in ms; injectable for tests. */
  now?: () => number;
  /** Minimum ms between TTY redraws (≤ 10 fps). */
  throttleMs?: number;
  barWidth?: number;
}

export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms)) return "--";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

/** Live progress on stderr: an in-place bar on a TTY, 10% milestones otherwise (REQ-PRG-01/02). */
export class Progress {
  private readonly total: number;
  private readonly stream: ProgressStream;
  private readonly now: () => number;
  private readonly throttleMs: number;
  private readonly barWidth: number;
  private readonly tty: boolean;
  private readonly startedAt: number;
  private completed = 0;
  private pii = 0;
  private errors = 0;
  private lastRender = -Infinity;
  private lastMilestone = 0;
  private finished = false;

  constructor(opts: ProgressOptions) {
    this.total = opts.total;
    this.stream = opts.stream ?? process.stderr;
    this.now = opts.now ?? (() => performance.now());
    this.throttleMs = opts.throttleMs ?? 100;
    this.barWidth = opts.barWidth ?? 30;
    this.tty = Boolean(this.stream.isTTY);
    this.startedAt = this.now();
    if (this.tty) this.render();
  }

  /** Records one completed line. */
  tick(outcome: { isPii?: boolean; status: "ok" | "error" }): void {
    this.completed++;
    if (outcome.status === "error") this.errors++;
    else if (outcome.isPii) this.pii++;

    if (this.tty) {
      if (this.completed === this.total || this.now() - this.lastRender >= this.throttleMs) this.render();
    } else {
      const milestone = this.total === 0 ? 10 : Math.floor((this.completed / this.total) * 10);
      if (milestone > this.lastMilestone) {
        this.lastMilestone = milestone;
        this.stream.write(this.status() + "\n");
      }
    }
  }

  /** Final redraw; leaves the cursor on a fresh line. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.tty) {
      this.render();
      this.stream.write("\n");
    } else if (this.lastMilestone < 10) {
      this.stream.write(this.status() + "\n");
    }
  }

  /** `62/120  52% | 9.1 lines/s | ETA 6s | PII 24 | errors 0` */
  status(): string {
    const elapsed = this.now() - this.startedAt;
    const rate = elapsed > 0 ? this.completed / (elapsed / 1000) : 0;
    const remaining = this.total - this.completed;
    const eta = remaining === 0 ? 0 : rate > 0 ? (remaining / rate) * 1000 : Infinity;
    const pct = this.total === 0 ? 100 : Math.floor((this.completed / this.total) * 100);
    const width = String(this.total).length;
    return (
      `${String(this.completed).padStart(width)}/${this.total} ${String(pct).padStart(3)}% | ` +
      `${rate.toFixed(1)} lines/s | ETA ${formatDuration(eta)} | PII ${this.pii} | errors ${this.errors}`
    );
  }

  private bar(): string {
    const filled = this.total === 0 ? this.barWidth : Math.round((this.completed / this.total) * this.barWidth);
    return `[${"█".repeat(filled)}${"░".repeat(this.barWidth - filled)}]`;
  }

  private render(): void {
    this.lastRender = this.now();
    let line = `${this.bar()} ${this.status()}`;
    const cols = this.stream.columns;
    if (cols && line.length > cols - 1) line = line.slice(0, cols - 1);
    // \r + clear-to-end-of-line redraws in place.
    this.stream.write(`\r${line}\x1b[K`);
  }
}
