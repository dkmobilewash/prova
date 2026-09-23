import type { DeterminationMarker } from "@/lib/determination-standing";

/**
 * Parsing for the two facts forms on a job's Compliance tab: what a
 * prevailing-wage determination document says about itself, and the four
 * public-works facts on the job. Pure, so the refusals are tested without
 * a database and the create and edit actions cannot parse differently.
 *
 * EVERY DATE HERE IS ENTERED, NEVER STAMPED. A bid-advertisement date is
 * the date that picks which determination governs the job (8 CCR 16000);
 * an issue date and an expiration date are printed on the document. None
 * of them is "today", so no form here defaults one, and a blank stays
 * blank — the standing line reports "unchecked" rather than a guess.
 *
 * Refusals are RETURNED, never thrown: production redacts a thrown Server
 * Action message to a digest (CLAUDE.md), and "that date isn't valid" is
 * exactly the sentence a person needs to read.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type DeterminationFactsInput = {
  determinationRef: string | null;
  issuedOn: Date | null;
  expiresOn: Date | null;
  expirationMarker: DeterminationMarker | null;
};

export type JobComplianceFactsInput = {
  siteCounty: string | null;
  publicWorks: boolean | null;
  bidAdvertisedOn: Date | null;
  awardingBody: string | null;
};

const MARKERS: readonly DeterminationMarker[] = ["NONE", "SINGLE", "DOUBLE"];

/** The `<select>` options for the asterisk, shared by the create and edit
 * forms so the two cannot offer different words for the same value. */
export const MARKER_OPTIONS: readonly { value: "" | DeterminationMarker; label: string }[] = [
  { value: "", label: "Not recorded" },
  { value: "NONE", label: "No asterisk" },
  { value: "SINGLE", label: "* single — holds for the life of the project" },
  { value: "DOUBLE", label: "** double — a predetermined increase applies after it" },
];

/** The `<select>` options for whether the job is public works. Null is
 * "not recorded", which is deliberately NOT the same answer as "no". */
export const PUBLIC_WORKS_OPTIONS: readonly { value: "" | "yes" | "no"; label: string }[] = [
  { value: "", label: "Not recorded" },
  { value: "yes", label: "Yes — paid in whole or in part with public funds" },
  { value: "no", label: "No — private work" },
];

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value : null;
}

/** A `YYYY-MM-DD` from a date input, as the UTC-midnight instant every
 * dated record here is stored at. Blank is null. Anything else that is not
 * a real calendar day (2026-02-30, 2026-13-01, free text) is a refusal
 * naming the field, not a `Date` that silently rolled over into March. */
export function calendarDayFromForm(formData: FormData, key: string, label: string): Parsed<Date | null> {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: `The ${label} isn't a valid date.` };
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: `The ${label} isn't a valid date.` };
  }
  return { ok: true, value: date };
}

export function determinationFactsFromForm(formData: FormData): Parsed<DeterminationFactsInput> {
  const issued = calendarDayFromForm(formData, "issuedOn", "issue date");
  if (!issued.ok) return issued;
  const expires = calendarDayFromForm(formData, "expiresOn", "expiration date");
  if (!expires.ok) return expires;

  const rawMarker = String(formData.get("expirationMarker") ?? "").trim();
  let expirationMarker: DeterminationMarker | null = null;
  if (rawMarker) {
    if (!MARKERS.includes(rawMarker as DeterminationMarker)) {
      return { ok: false, error: "Choose one of the asterisk options for the expiration date." };
    }
    expirationMarker = rawMarker as DeterminationMarker;
  }

  if (issued.value && expires.value && expires.value.getTime() < issued.value.getTime()) {
    return { ok: false, error: "The expiration date is before the issue date — check the document." };
  }

  return {
    ok: true,
    value: {
      determinationRef: text(formData, "determinationRef"),
      issuedOn: issued.value,
      expiresOn: expires.value,
      expirationMarker,
    },
  };
}

export function jobComplianceFactsFromForm(formData: FormData): Parsed<JobComplianceFactsInput> {
  const advertised = calendarDayFromForm(formData, "bidAdvertisedOn", "bid-advertisement date");
  if (!advertised.ok) return advertised;

  const rawPublic = String(formData.get("publicWorks") ?? "").trim();
  let publicWorks: boolean | null = null;
  if (rawPublic === "yes") publicWorks = true;
  else if (rawPublic === "no") publicWorks = false;
  else if (rawPublic) return { ok: false, error: "Choose whether this job is public works, or leave it as not recorded." };

  return {
    ok: true,
    value: {
      siteCounty: text(formData, "siteCounty"),
      publicWorks,
      bidAdvertisedOn: advertised.value,
      awardingBody: text(formData, "awardingBody"),
    },
  };
}
