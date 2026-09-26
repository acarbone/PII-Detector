export const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
export const fmtRatio = (v: number | null): string => (v === null ? "n/a" : v.toFixed(2));
export const fmtProb = (v: number | undefined): string => (v === undefined ? "  -  " : v.toFixed(2));
export const fmtInt = (n: number): string => n.toLocaleString("en-US");
export const fmtUsd = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(5) : usd.toFixed(2)}`;
export const lineNo = (n: number, width = 3): string => `#${String(n).padStart(width, "0")}`;

/** Truncates to `max` visible characters with an ellipsis; null = no limit. */
export const truncate = (s: string, max: number | null): string =>
  max === null || s.length <= max ? s : max <= 1 ? s.slice(0, Math.max(0, max)) : `${s.slice(0, max - 1)}…`;

const wrap = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
export interface Palette {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}
const id = (s: string) => s;
export const palette = (color: boolean): Palette =>
  color
    ? { bold: wrap("1"), dim: wrap("2"), red: wrap("31"), green: wrap("32"), yellow: wrap("33"), cyan: wrap("36") }
    : { bold: id, dim: id, red: id, green: id, yellow: id, cyan: id };
