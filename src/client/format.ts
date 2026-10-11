const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Formats a YYYY-MM-DD date or an ISO timestamp, leaving the year off when it is this year. */
export function formatDate(value: string): string {
  // A bare date is a calendar day, not a UTC instant; parse it as local so it does not shift.
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (date.getFullYear() === new Date().getFullYear() ? dayFormat : dayYearFormat).format(date);
}

export function formatDays(days: number): string {
  if (days < 1) return "today";
  if (days < 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

export function formatMoney(usd: number): string {
  if (usd >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${trim(usd / 1e3)}K`;
  return `$${usd}`;
}

const trim = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Reads "12", "1.5k", "$3M" and the like; returns null for empty or unreadable input. */
export function parseAmount(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "")
    .match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2] as "k" | "m" | "b"] ?? 1;
  return Math.round(Number(match[1]) * scale);
}

export const parseTags = (input: string) =>
  input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

export function hostname(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A link target that is safe to put in href: http(s) only. */
export function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
