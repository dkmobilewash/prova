import { money } from "@/lib/money";

/**
 * Figures a person TYPED, parsed by code.
 *
 * The rule the whole Ask feature rests on is that the model never supplies
 * a number: it hands over the person's own words and deterministic code
 * decides what they mean. A money command is where that rule is worth the
 * most, so the parsing is strict rather than clever. "$12,500", "12,500.00"
 * and "12500" are one amount; "12.5k", "about twelve grand" and "12500-ish"
 * are not an amount, and the command asks for one rather than guessing.
 *
 * Every accepted string is normalised to the form the action's own
 * `decimalFromForm` accepts, and displayed with the same formatter the
 * pages use, so the card and the job page can never disagree on a figure.
 */
export type ParsedAmount = {
  /** "12500.00": what goes in the form field. */
  value: string;
  cents: number;
  /** "$12,500.00": what goes on the card. */
  display: string;
};

const AMOUNT = /^\d+(?:\.\d{1,2})?$/;

export function parseAmount(text: string | undefined): ParsedAmount | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^(?:usd|us\$|\$)\s*/i, "").replace(/,/g, "").replace(/\s+/g, "");
  if (!AMOUNT.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (cents <= 0) return null;
  return { value: (cents / 100).toFixed(2), cents, display: money(cents / 100) };
}

export type ParsedHours = { value: string; display: string };

const HOURS = /^\d+(?:\.\d{1,2})?$/;
/** A single entry is one person's day. More than this is a typo or two
 * days at once, and the action would take it, so the command refuses. */
export const MAX_HOURS_IN_A_DAY = 24;

export function parseHours(text: string | undefined): ParsedHours | null {
  if (!text) return null;
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/\s*(?:hours?|hrs?|h)$/, "")
    .trim();
  if (!HOURS.test(cleaned)) return null;
  const hours = Number(cleaned);
  if (hours <= 0 || hours > MAX_HOURS_IN_A_DAY) return null;
  const value = String(hours);
  return { value, display: `${value} ${hours === 1 ? "hour" : "hours"}` };
}

/** `yyyy-mm-dd` plus whole days, in UTC, so a due date derived from payment
 * terms lands on a calendar day and not an instant. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
