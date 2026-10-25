import type { BidInviteExtraction } from "@prova/integrations/src/bidInvites";
import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

/**
 * Turning what the model read off a pasted invitation into values for the
 * "Log a bid" form — THE CODE HALF of "AI interprets, code computes".
 *
 * PURE. No database, no model, no clock. `lib/actions/bidInviteRead.ts` hands
 * it the pasted text, the model's extraction and this company's GCs, and gets
 * back a suggestion the form fills itself with. Nothing is saved by either.
 *
 * THREE THINGS ARE DECIDED HERE AND NEVER BY THE MODEL:
 *
 *   - WHETHER A VALUE WAS PRINTED AT ALL. Every string the model returns must
 *     appear in the pasted text (case and spacing aside). One that does not was
 *     composed rather than copied, and it is DROPPED and named in `dropped` —
 *     the rule "never invent a field the text doesn't contain" as a check rather
 *     than a sentence in a prompt.
 *   - WHICH CONTACT THE GC IS. An exact match on the normalised company name
 *     against the company's own GCs, or nothing. A fuzzy guess here would log a
 *     bid against the wrong GC and teach their win rate from it.
 *   - WHICH TRADE. A fixed word list per trade, and null when the words name
 *     none or more than one.
 *
 * There is no address, job-walk, bonding or plan-link column on
 * `BidInvitation`, and this change adds none (no schema change without both
 * founders). So those facts go into the invitation's NOTES, one labelled line
 * each, where the person sees them before saving. The `Site:` line is read back
 * by `siteFromNotes` for the "same job from another GC" check.
 */

/** The longest paste accepted. An invitation email is a page or two; a pasted
 * plan-room export of fifty projects is not one invitation. */
export const INVITE_TEXT_MAX = 20_000;
/** Shorter than this cannot be an invitation, and is not worth a paid call. */
export const INVITE_TEXT_MIN = 20;

export function inviteTextProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "Paste the invitation text first.";
  if (trimmed.length < INVITE_TEXT_MIN) {
    return "That's too short to be an invitation. Paste the whole email or listing.";
  }
  if (trimmed.length > INVITE_TEXT_MAX) {
    return `That's ${trimmed.length.toLocaleString("en-US")} characters, and one invitation is rarely over ${INVITE_TEXT_MAX.toLocaleString("en-US")}. Paste one invitation at a time.`;
  }
  return null;
}

/** Lower case, one kind of quote and dash, whitespace collapsed. Used only to
 * ask "was this printed", never to change what is shown. */
function forPresence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `value` appears in `text`, ignoring case and spacing. */
export function printedIn(text: string, value: string): boolean {
  const needle = forPresence(value);
  return needle.length > 0 && forPresence(text).includes(needle);
}

/** `YYYY-MM-DD` and a real calendar day, or null. */
export function isoDateOrNull(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : null;
}

type TradeValue = (typeof TRADE_SCOPE_OPTIONS)[number]["value"];

/**
 * The words that name each trade. Keyed by the canonical option list's own
 * values — `Record<TradeValue, …>` — so a sixth trade does not compile here
 * until somebody says what it is called, and this is not a second copy of the
 * list (the census's "is there a second one" question).
 */
const TRADE_WORDS: Record<TradeValue, RegExp> = {
  METAL_FRAMING_DRYWALL: /\b(drywall|gypsum|metal stud|stud framing|framing|09 ?21|09 ?22|092[12])\b/,
  LATH_PLASTER: /\b(plaster|lath|stucco|09 ?2[34]|092[34])\b/,
  EIFS: /\b(eifs|exterior insulation and finish|07 ?24|0724)\b/,
  ACOUSTICAL_CEILINGS: /\b(acoustical|acoustic ceilings?|ceilings?|act|09 ?51|0951)\b/,
  FIREPROOFING: /\b(fireproofing|sfrm|spray[- ]applied fire|07 ?81|0781)\b/,
};

/** The one trade the words name, or null when they name none or several. */
export function tradeFromText(tradeText: string | null): TradeValue | null {
  if (!tradeText) return null;
  const words = tradeText.toLowerCase();
  const hits = TRADE_SCOPE_OPTIONS.map((option) => option.value).filter((value) => TRADE_WORDS[value].test(words));
  return hits.length === 1 ? hits[0] : null;
}

/** A company name with its legal suffix and punctuation removed, for an EXACT
 * comparison. "Acme Builders, Inc." and "ACME BUILDERS" are the same name;
 * "Acme Builders West" is not. */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(inc|incorporated|llc|l l c|co|corp|corporation|company|ltd|lp|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type GcOption = { id: string; name: string };

/** The one GC whose normalised name equals the printed one, or null. Two GCs
 * normalising to the same name is ambiguous, and ambiguity picks nobody. */
export function matchGc(printed: string, gcs: GcOption[]): GcOption | null {
  const target = normaliseCompanyName(printed);
  if (!target) return null;
  const hits = gcs.filter((gc) => normaliseCompanyName(gc.name) === target);
  return hits.length === 1 ? hits[0] : null;
}

/** The label the `Site:` notes line carries. The duplicate check reads it back. */
export const SITE_LABEL = "Site:";

/** The site line out of an invitation's notes, or null. */
export function siteFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const line of notes.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(SITE_LABEL.toLowerCase())) {
      const value = trimmed.slice(SITE_LABEL.length).trim();
      return value || null;
    }
  }
  return null;
}

/** What the form is filled with. Every field is a SUGGESTION. */
export type BidInviteSuggestion = {
  /** The matched contact, or null — the person picks. */
  contactId: string | null;
  /** The GC name as printed, whether or not it matched a contact. */
  gcNamePrinted: string | null;
  projectName: string;
  tradeScope: TradeValue | null;
  /** `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  notes: string;
  /** Sentences for beside the form: what was read, what was not, and why. */
  checks: string[];
  /** Fields the model returned that are NOT in the text, so were dropped. */
  dropped: string[];
};

const FIELD_LABELS: Record<
  "gcName" | "projectName" | "siteAddress" | "siteCity" | "tradeText" | "bidDueText" | "bidDueTime" | "jobWalk" | "bonding" | "planLink",
  string
> = {
  gcName: "GC",
  projectName: "project name",
  siteAddress: "address",
  siteCity: "city",
  tradeText: "trade",
  bidDueText: "due date",
  bidDueTime: "due time",
  jobWalk: "job walk",
  bonding: "bonding",
  planLink: "plan link",
};

/**
 * The suggestion for the form, from the pasted text and what the model read.
 *
 * Deliberately total over the extraction's shape: a field the model left as
 * `undefined` (a reply missing a key) is treated exactly as null.
 */
export function suggestionFromExtraction(
  text: string,
  extraction: Partial<BidInviteExtraction>,
  gcs: GcOption[],
): BidInviteSuggestion {
  const dropped: string[] = [];
  const checks: string[] = [];

  /** A printed value, trimmed, or null — and a non-printed one is recorded. */
  const kept = (key: keyof typeof FIELD_LABELS): string | null => {
    const raw = extraction[key];
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (!value) return null;
    if (!printedIn(text, value)) {
      dropped.push(FIELD_LABELS[key]);
      return null;
    }
    return value;
  };

  const gcName = kept("gcName");
  const projectName = kept("projectName") ?? "";
  const siteAddress = kept("siteAddress");
  const siteCity = kept("siteCity");
  const tradeText = kept("tradeText");
  const bidDueText = kept("bidDueText");
  const bidDueTime = kept("bidDueTime");
  const jobWalk = kept("jobWalk");
  const bonding = kept("bonding");
  // A plan link must ALSO be a web address. A line of prose copied into it is
  // not one, and a person clicking it should land somewhere.
  const linkRaw = kept("planLink");
  const planLink = linkRaw && /^https?:\/\/\S+$/i.test(linkRaw) ? linkRaw : null;
  if (linkRaw && !planLink) dropped.push(FIELD_LABELS.planLink);

  // THE DATE IS KEPT ONLY WHEN ITS PRINTED FORM WAS KEPT AND CARRIES A YEAR.
  // The model writes the ISO date, which cannot be substring-checked, so it is
  // tied to `bidDueText`, which can: no printed date, no date. And a printed
  // date with no year in it ("Tuesday, Nov 4") is not a date this form may
  // complete by guessing the year — the person does.
  const iso = isoDateOrNull(extraction.bidDueDate ?? null);
  const printedYear = bidDueText !== null && iso !== null && bidDueText.includes(iso.slice(0, 4));
  // "11/04/26": a two-digit year only counts in a full numeric date, so the 26
  // in "November 26" or "11/26" is never read as the year.
  const yearDigits =
    bidDueText !== null && iso !== null && new RegExp(`\\b\\d{1,2}[/.-]\\d{1,2}[/.-]${iso.slice(2, 4)}\\b`).test(bidDueText);
  const dueDate = iso !== null && (printedYear || yearDigits) ? iso : null;
  if (bidDueText && !dueDate) {
    checks.push(`The due date is printed as "${bidDueText}", which doesn't give a full date. Set it yourself.`);
  }

  // The GC: exact name match to one of this company's GCs, or the person picks.
  const gc = gcName ? matchGc(gcName, gcs) : null;
  if (gcName && !gc) {
    checks.push(`The invitation is from "${gcName}", who isn't in your contacts under that name. Pick the GC, or add them first.`);
  }
  if (!gcName) checks.push("No GC was found in the text. Pick the GC who invited you.");
  if (!projectName) checks.push("No project name was found in the text. Type it in.");

  const tradeScope = tradeFromText(tradeText);
  if (tradeText && !tradeScope) {
    checks.push(`The trade is printed as "${tradeText}", which doesn't name one of your trades clearly. Pick it yourself.`);
  }

  if (dropped.length > 0) {
    checks.push(
      `Left out because the text doesn't say it word for word: ${dropped.join(", ")}. Check the invitation for ${dropped.length === 1 ? "it" : "them"}.`,
    );
  }
  const readingNotes = typeof extraction.readingNotes === "string" ? extraction.readingNotes.trim() : "";
  if (readingNotes) checks.push(readingNotes);

  const site = [siteAddress, siteCity].filter(Boolean).join(", ");
  const lines = [
    site ? `${SITE_LABEL} ${site}` : null,
    bidDueTime ? `Bid due time: ${bidDueTime}` : null,
    jobWalk ? `Job walk: ${jobWalk}` : null,
    bonding ? `Bonding: ${bonding}` : null,
    planLink ? `Plans: ${planLink}` : null,
    tradeText && !tradeScope ? `Trade as printed: ${tradeText}` : null,
  ].filter((line): line is string => line !== null);

  return {
    contactId: gc?.id ?? null,
    gcNamePrinted: gcName,
    projectName,
    tradeScope,
    dueDate,
    notes: lines.join("\n"),
    checks,
    dropped,
  };
}
