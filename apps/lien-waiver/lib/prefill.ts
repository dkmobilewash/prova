import { STATE_CONTENT } from "./content";
import { FORM_KEYS, STATES, type FormKey, type SlotId, type StateCode } from "./statutes/types";

/**
 * URL PRE-FILL (Diego, 2026-10-14): an outreach link can open a waiver that
 * is already started --
 *
 *   /lien-waiver/start?state=CA&type=cp&company=Test%20Drywall%20Inc&gc=Test%20GC&ref=TEST-0001
 *
 * Everything here is a SUGGESTION for a blank. It never submits, never skips
 * a screen or a warning (`type` only pre-selects the two answers on the
 * waiver-type screen, which is still shown), and never touches the statutory
 * text: a value can only land in a blank, and only through the same checks
 * (lib/fills.ts) as anything a person types. With no parameters nothing in
 * this file runs, and the tool is exactly what it was.
 *
 * Unknown parameters -- email, phone, anything else -- are dropped, never
 * read: a link must not be able to put somebody's address into the send
 * step.
 */

export const PREFILL_FIELDS = ["company", "license", "owner", "project", "address", "gc"] as const;
export type PrefillField = (typeof PREFILL_FIELDS)[number];

/**
 * Which blank each parameter fills, per state, because the four statutes name
 * their blanks differently. Read off the forms themselves (slotsAsked), and
 * prefill.test.ts fails if an entry names a blank that state's forms do not
 * have.
 *
 *  - `address` is California's and Texas's "Job Location", Nevada's "Property
 *    Location", and Arizona's job description -- Arizona's forms say "on the
 *    job of [owner] located at [___]" and have no separate location blank.
 *  - Nevada's forms have no owner blank, California's no project name.
 *  - No state's form has a contractor licence blank, so `license` maps to
 *    nothing anywhere. It is accepted (so a link carrying it is not wrong)
 *    and ignored, as every parameter with no blank is.
 *
 * A form without one of these blanks simply never shows the value: the
 * values sit in the same bag of answers as everything typed, and a form
 * reads only the blanks it has.
 */
export const PREFILL_MAP: Record<StateCode, Partial<Record<PrefillField, SlotId>>> = {
  AZ: { company: "companyName", gc: "customer", owner: "owner", project: "project", address: "jobDescription" },
  CA: { company: "companyName", gc: "customer", owner: "owner", address: "jobLocation" },
  NV: { company: "companyName", gc: "customer", project: "project", address: "jobLocation" },
  TX: { company: "companyName", gc: "customer", owner: "owner", project: "project", address: "jobLocation" },
};

/** `type=` codes: Conditional/Unconditional, Progress/Final. */
export const TYPE_CODES: Record<string, FormKey> = {
  cp: "CONDITIONAL_PROGRESS",
  up: "UNCONDITIONAL_PROGRESS",
  cf: "CONDITIONAL_FINAL",
  uf: "UNCONDITIONAL_FINAL",
};

export const MAX_LENGTH = 120;
export const MAX_ADDRESS_LENGTH = 200;
/** A tracking code: letters, digits, dot, dash, underscore. Anything else is
 * not a code we issued, and is dropped rather than cleaned up. */
const REF_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

/** Plain text or nothing: tags removed, then any stray angle bracket, then
 * control characters; whitespace collapsed; trimmed; cut to `max`. React
 * escapes what it renders anyway -- this is so a link cannot even put markup
 * INTO a blank, where it would print on a legal form. */
export function sanitizeText(raw: string | null | undefined, max: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFC")
    .replace(/<\s*(script|style)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned || null;
}

export function sanitizeRef(raw: string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return REF_PATTERN.test(value) ? value : null;
}

export interface Prefill {
  state: StateCode | null;
  form: FormKey | null;
  values: Partial<Record<PrefillField, string>>;
  ref: string | null;
}

/** Everything a link can say, cleaned. Only the known keys are read. */
export function parsePrefill(params: URLSearchParams): Prefill {
  const stateRaw = (params.get("state") ?? "").trim().toUpperCase();
  const typeRaw = (params.get("type") ?? "").trim().toLowerCase();
  const values: Partial<Record<PrefillField, string>> = {};
  for (const field of PREFILL_FIELDS) {
    const value = sanitizeText(params.get(field), field === "address" ? MAX_ADDRESS_LENGTH : MAX_LENGTH);
    if (value) values[field] = value;
  }
  const form = TYPE_CODES[typeRaw] ?? null;
  return {
    state: STATES.find((code) => code === stateRaw) ?? null,
    form: form && FORM_KEYS.includes(form) ? form : null,
    values,
    ref: sanitizeRef(params.get("ref")),
  };
}

/** True when a link asked for anything at all -- the only case in which the
 * tool behaves differently from a plain visit. */
export function hasPrefill(prefill: Prefill): boolean {
  return Boolean(prefill.form || prefill.ref || Object.keys(prefill.values).length);
}

/** The answers a link supplies for one state's blanks. */
export function prefillAnswers(state: StateCode, values: Prefill["values"]): Partial<Record<SlotId, string>> {
  const answers: Partial<Record<SlotId, string>> = {};
  for (const [field, slot] of Object.entries(PREFILL_MAP[state]) as Array<[PrefillField, SlotId]>) {
    const value = values[field];
    if (value) answers[slot] = value;
  }
  return answers;
}

/** The query string to carry from /start to a state's page: the known keys
 * only, so an email or phone number in a link is not passed along either. */
export function forwardQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of ["type", ...PREFILL_FIELDS, "ref"]) {
    const value = params.get(key);
    if (value !== null) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}

export const stateSlug = (state: StateCode) => STATE_CONTENT[state].slug;
