/**
 * `plans.duration` is a Postgres `interval`, and it is the one column on this
 * table that cannot be round-tripped naively through a form.
 *
 * Postgres does not store the text you give it. It stores a normalised
 * month/day/microsecond triple and prints that back with its *own*
 * abbreviations, so what a form writes and what it later reads are different
 * strings for the same value:
 *
 *   "1 month"   → "1 mon"
 *   "12 months" → "1 year"
 *   "18 months" → "1 year 6 mons"
 *   "1 week"    → "7 days"      (weeks are folded into days on the way in)
 *
 * So parsing and rendering have to agree, which is why they live together
 * here rather than being split between a form helper and `format.ts`. This
 * module is deliberately not `server-only`: the client form parses a stored
 * value to prefill its fields, and the server action composes the literal it
 * writes, and a disagreement between those two is exactly the bug this file
 * exists to prevent.
 */

/**
 * The units an operator may choose.
 *
 * No "week": Postgres rewrites it to days on the way in, so a plan entered as
 * "1 week" would read back "7 days" and look like someone else had edited it.
 * Offering only units that survive the round trip is cheaper than explaining
 * that.
 */
export const DURATION_UNITS = ["day", "month", "year"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export type Duration = { count: number; unit: DurationUnit };

/** Long enough for any subscription; short enough that a stray digit is caught. */
export const MAX_DURATION_COUNT = 120;

/** Both the words we write and the abbreviations Postgres prints back. */
const ALIASES: Record<string, DurationUnit> = {
  day: "day",
  days: "day",
  mon: "month",
  mons: "month",
  month: "month",
  months: "month",
  year: "year",
  years: "year",
};

/** `(count)(unit)` pairs. Requires letters after the digits, so a time
 *  component like "00:00:00" never matches and leaves a non-empty remainder. */
const PAIR = /(\d+)\s*([a-z]+)/g;

/**
 * Read a stored interval back into the two fields the form edits.
 *
 * Returns null for anything this form cannot represent — a compound interval
 * mixing days with months, a time component, a negative interval. That is a
 * value someone set in SQL, not through this app, and the form says so rather
 * than silently rounding it.
 */
export function parseDuration(
  value: string | null | undefined,
): Duration | null {
  if (!value) return null;

  const text = value.trim().toLowerCase();
  const pairs = [...text.matchAll(PAIR)];
  if (pairs.length === 0) return null;

  // Nothing may be left over. Catches "1 mon 00:00:00", "-1 mons", "1.5 years".
  if (text.replace(PAIR, "").trim() !== "") return null;

  const parts: Duration[] = [];
  for (const [, count, word] of pairs) {
    const unit = ALIASES[word];
    if (!unit) return null;
    parts.push({ count: Number(count), unit });
  }

  if (parts.length === 1) return parts[0];

  // "1 year 6 mons" is what Postgres prints for 18 months, so it is a value
  // this form *did* write and has to be able to read. Collapsing it back to
  // months round-trips exactly: 18 months re-entered normalises to the same
  // interval.
  if (parts.length === 2 && parts[0].unit === "year" && parts[1].unit === "month") {
    return { count: parts[0].count * 12 + parts[1].count, unit: "month" };
  }

  return null;
}

/** The literal handed to Postgres. Plural is safe for 1 and for 0. */
export function composeDuration({ count, unit }: Duration): string {
  return `${count} ${unit}s`;
}

/**
 * How a duration reads in a table: "1 month", "3 months", "1 year".
 *
 * An unparseable interval is shown verbatim rather than as "—": it is a real
 * value the operator may need to see, and this app is not entitled to hide a
 * column it does not fully understand.
 */
export function formatDuration(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "—";

  const parsed = parseDuration(value);
  if (!parsed) return value;

  return `${parsed.count} ${parsed.unit}${parsed.count === 1 ? "" : "s"}`;
}
