/**
 * Display formatting for the market and live-research views. Dates are
 * formatted from their YYYY-MM-DD part as sent (no time-zone conversion).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUS = "−";

function parts(date: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!match) return null;
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { y: Number(match[1]), m, d: Number(match[3]) };
}

/** "Sep 29, 2026" */
export function formatDay(date: string | null | undefined): string {
  const p = parts(date);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
}

/** "Sep 29" */
export function formatDayShort(date: string | null | undefined): string {
  const p = parts(date);
  return p ? `${MONTHS[p.m - 1]} ${p.d}` : "";
}

/** "Sep ’26" */
export function formatMonthYear(date: string | null | undefined): string {
  const p = parts(date);
  return p ? `${MONTHS[p.m - 1]} ’${String(p.y).slice(2)}` : "";
}

export function formatYear(date: string | null | undefined): string {
  const p = parts(date);
  return p ? String(p.y) : "";
}

const priceFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 1234.5 → "1,234.50" */
export function formatPrice(value: number): string {
  return priceFormat.format(value);
}

export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** Signed with a real minus sign: "+1.23", "−1.23". */
export function formatSigned(value: number, decimals = 2): string {
  const abs = Math.abs(value).toFixed(decimals);
  return `${value < 0 && Number(abs) !== 0 ? MINUS : "+"}${abs}`;
}

/** Signed percent: "+1.2%", "−3.4%". */
export function formatPct(value: number, decimals = 1): string {
  return `${formatSigned(value, decimals)}%`;
}

/** A tick label: "0%", "+10%", "−2.5%". */
export function formatPctTick(value: number): string {
  if (value === 0) return "0%";
  const decimals = Number.isInteger(value) ? 0 : 1;
  return formatPct(value, decimals);
}

/** 1_234_567 → "1.23M"; below a million, grouped digits. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return formatCount(value);
}

/** Money with a unit suffix: "$901.2M", "$94.93B"; other currencies by code ("EUR 901.2M"). */
export function formatMoney(value: number, currency: string): string {
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1e12) body = `${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) body = `${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) body = `${(abs / 1e6).toFixed(1)}M`;
  else body = formatCount(abs);
  const sign = value < 0 ? MINUS : "";
  return currency === "USD" ? `${sign}$${body}` : `${sign}${currency} ${body}`;
}

/** A measured duration: "85 ms", "1.8 s". */
export function formatDuration(ms: number): string {
  if (ms < 100) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Elapsed time as "m:ss". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/** Milliseconds between two ISO timestamps, or null when either is missing or unparsable. */
export function msBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

/** The host of a URL (without "www."), or null when it does not parse. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Path, query and fragment of a URL, for a browser-style address bar. */
export function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    return rest === "/" ? "" : rest;
  } catch {
    return "";
  }
}

/** First letter for a monogram. */
export function monogram(name: string | null | undefined): string {
  const letter = (name ?? "").trim().replace(/^\W+/, "").charAt(0).toUpperCase();
  return letter || "·";
}
