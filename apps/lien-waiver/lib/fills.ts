import { SLOTS, type SlotKind } from "./statutes/slots";
import type { Fills } from "./statutes/render";
import type { BuiltForm, SlotId } from "./statutes/types";
import { slotsAsked } from "./statutes/forms";
import { unsupportedCharacters } from "./winansi";

/**
 * What a person typed, checked and put in the shape it prints in. Shared by
 * the on-screen preview and the PDF route, so the two cannot disagree about
 * how "48250" or "2026-09-30" reads on the form.
 */

export const MAX_FILL_LENGTH = 200;

/** "48250" -> "48,250.00". Accepts digits with optional commas and up to
 * two decimals; anything else is refused rather than guessed at. */
export function formatMoney(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction.padEnd(2, "0")}`;
}

/** "2026-09-30" (what a date input gives) -> "09/30/2026". The date is
 * the one the person picked -- no clock, no time zone, no "today". */
export function formatDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${month}/${day}/${year}`;
}

function format(kind: SlotKind, raw: string): string | null {
  if (kind === "money") return formatMoney(raw);
  if (kind === "date") return formatDate(raw);
  return raw.replace(/\s+/g, " ").trim();
}

export type FillErrors = Partial<Record<SlotId, string>>;

export function checkFills(form: BuiltForm, raw: Partial<Record<string, string>>): { fills: Fills; errors: FillErrors } {
  const fills: Fills = {};
  const errors: FillErrors = {};
  for (const { slot, label } of slotsAsked(form)) {
    const spec = SLOTS[slot];
    const value = (raw[slot] ?? "").trim();
    if (!value) {
      if (spec.required) errors[slot] = `${label} is needed.`;
      continue;
    }
    if (value.length > MAX_FILL_LENGTH) {
      errors[slot] = `${label} is longer than ${MAX_FILL_LENGTH} characters.`;
      continue;
    }
    const bad = unsupportedCharacters(value);
    if (bad.length) {
      errors[slot] = `${label} has characters the form cannot print (${bad.join(" ")}). Use plain letters, numbers and punctuation.`;
      continue;
    }
    const formatted = format(spec.kind, value);
    if (formatted === null) {
      errors[slot] = spec.kind === "money" ? `${label} should be an amount like 48,250.00.` : `${label} should be a date.`;
      continue;
    }
    fills[slot] = formatted;
  }
  return { fills, errors };
}
