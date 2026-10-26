import { prisma, type BidInvitationOrigin, type TradeScope } from "@prova/db";
import { createInvitationOnProject } from "@/lib/estimating/bid-project";
import type { ActionResultWith } from "@/lib/actions/shared";
import { runAgentAfterResponse } from "@/lib/agents/onEvent";
import { bidDatesProblem } from "@/lib/bid-dates";

/**
 * The body of "log a bid invitation", lifted out of the Server Action so
 * two callers can share it: `createBidInvitation` (the contact page's
 * form, which keeps its throw) and the Ask command `log_bid_invitation`,
 * which needs the id back and its refusals as sentences — production
 * redacts a thrown Server Action message, and a card cannot show a
 * sentence that never arrives.
 *
 * Same arrangement as create-job.ts and job-schedule.ts beside it: a plain
 * object in, a plain result out. No FormData, no `requireCompanyContext`,
 * no `revalidatePath`. The caller supplies the company it already verified
 * and does its own revalidation, so this can also run from a database
 * test. The contact is asserted in-company HERE, in the write itself,
 * because this is the boundary a card's server-held payload crosses.
 *
 * `reuseOpenDuplicate` is the Ask command's option, like create-job.ts's
 * `refuseDuplicateName`: a re-asked sentence, or two cards resolved before
 * either was tapped, must not log the same invitation twice. An
 * invitation from the same contact for the same project (case-insensitive)
 * that is still INVITED or SUBMITTED is that invitation, and the existing
 * row's id comes back with `alreadyExisted`. The form does not set it, so
 * the contact page behaves exactly as it always has — a GC re-inviting on
 * a project that was LOST is a new row either way, since a closed bid is
 * never "the same invitation".
 */
export const PROJECT_NAME_REQUIRED = "Project name is required";
export const CONTACT_NOT_FOUND = "Contact not found";

/** The two statuses under which an invitation is still open. The Ask
 * read tool bid_status uses the same pair. */
const OPEN_STATUSES = ["INVITED", "SUBMITTED"] as const;

export type CreateBidInvitationInput = {
  contactId: string;
  projectName: string;
  /** A calendar day at UTC midnight, or unset. */
  dueDate?: Date | null;
  /** Wall-clock minutes after midnight on `dueDate` — see lib/bid-dates.ts. */
  dueMinute?: number | null;
  /** Job walk / pre-bid meeting day (UTC midnight) and optional wall-clock minute. */
  walkDate?: Date | null;
  walkMinute?: number | null;
  /** Last day RFIs are accepted (UTC midnight). */
  rfiCutoffDate?: Date | null;
  notes?: string | null;
  tradeScope?: TradeScope | null;
  /** Already validated as a decimal string. #133: the contact page's
   * create form sends this when the person filled it in (optional,
   * blank by default -- most invitations still arrive unpriced). The
   * Ask card never sends one; see log_bid_invitation's own comment for
   * why that stays true. */
  bidAmount?: string | null;
  /** Put the invitation on this existing project (another GC's invitation
   * for the same job). Unset: a project of its own is made with it. */
  bidProjectId?: string | null;
  /** Whether we went and asked this GC (default: they invited us). */
  origin?: BidInvitationOrigin;
};

export type CreateBidInvitationResult = {
  bidInvitationId: string;
  contactName: string;
  /** True when `reuseOpenDuplicate` found an open invitation from this
   * contact for this project already; `bidInvitationId` is then that
   * row's and nothing was written. */
  alreadyExisted: boolean;
};

export type CreateBidInvitationOptions = {
  reuseOpenDuplicate?: boolean;
};

export async function createBidInvitationRecord(
  companyId: string,
  input: CreateBidInvitationInput,
  options: CreateBidInvitationOptions = {},
): Promise<ActionResultWith<CreateBidInvitationResult>> {
  // The action's own rule, in the action's own words, before any read.
  const projectName = input.projectName.trim();
  if (!projectName) return { ok: false, error: PROJECT_NAME_REQUIRED };
  const datesProblem = bidDatesProblem({
    dueDate: input.dueDate ?? null,
    dueMinute: input.dueMinute ?? null,
    walkDate: input.walkDate ?? null,
    walkMinute: input.walkMinute ?? null,
    rfiCutoffDate: input.rfiCutoffDate ?? null,
  });
  if (datesProblem) return { ok: false, error: datesProblem };

  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, companyId },
    select: { id: true, name: true },
  });
  if (!contact) return { ok: false, error: CONTACT_NOT_FOUND };

  if (options.reuseOpenDuplicate) {
    const open = await prisma.bidInvitation.findFirst({
      where: {
        companyId,
        contactId: contact.id,
        projectName: { equals: projectName, mode: "insensitive" },
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });
    if (open) {
      return { ok: true, value: { bidInvitationId: open.id, contactName: contact.name, alreadyExisted: true } };
    }
  }

  const created = await createInvitationOnProject(
    companyId,
    {
      contactId: contact.id,
      projectName,
      dueDate: input.dueDate ?? null,
      dueMinute: input.dueMinute ?? null,
      walkDate: input.walkDate ?? null,
      walkMinute: input.walkMinute ?? null,
      rfiCutoffDate: input.rfiCutoffDate ?? null,
      notes: input.notes?.trim() || null,
      tradeScope: input.tradeScope ?? null,
      bidAmount: input.bidAmount ?? null,
      ...(input.origin ? { origin: input.origin } : {}),
    },
    { bidProjectId: input.bidProjectId },
  );
  if (!created.ok) return { ok: false, error: created.error };
  // AI agents: research the new bid after the response (lib/agents/onEvent.ts; switch and cap apply).
  runAgentAfterResponse({ companyId, agent: "BID_RESEARCH", bidInvitationId: created.value.id });

  return { ok: true, value: { bidInvitationId: created.value.id, contactName: contact.name, alreadyExisted: false } };
}

// ─────────────────────────────────────────────────────────────────────────
// "SAME JOB FROM ANOTHER GC" — the cross-GC half of the duplicate question.
//
// `reuseOpenDuplicate` above answers "is this the invitation I already
// logged": same contact, same name, still open. It deliberately says nothing
// about a DIFFERENT GC inviting us to the same project, which is the normal
// case for a sub — the same hospital from four GCs in a morning — and until
// now four rows that were one job looked like four jobs.
//
// THIS DECIDES NOTHING AND WRITES NOTHING. It is a pure function over rows the
// caller already read, and what it returns is a sentence for a person: "Same
// name and due date as Riverside Medical from Acme Builders". Nothing is
// merged, linked or hidden on the strength of it. There is no project entity
// to merge into (that is the BidProject design, which needs both founders'
// sign-off and a migration), and a fuzzy match must never move data anyway —
// the same posture `wonJobId` takes.
//
// THE RULES, in the order they are applied:
//
//   1. Only OPEN invitations (INVITED, SUBMITTED), and only from a DIFFERENT
//      contact. Same contact is the `reuseOpenDuplicate` case, not this one.
//   2. Two due dates more than 30 days apart: never the same job. A re-tender
//      is a new invitation (see `wonJobId`'s comment), and this is its shape.
//   3. The names carry different NUMBERS ("Phase 1" / "Phase 2", "Building 3"
//      / "Building 4"): never the same job, whatever else agrees.
//   4. The same site address (street number and street, normalised): the
//      same job.
//   5. The same name (identical significant words, at least two of them):
//      the same job.
//   6. A similar name (at least 60% of the significant words shared) AND a
//      supporting fact — due dates within 7 days, or the same city: the same
//      job. A similar name alone is not enough; "Starbucks Remodel" is many
//      jobs.
//
// The address and city come from the `Site:` line in the notes, because
// `BidInvitation` has no address column (`lib/bid-invite-read.ts` writes that
// line when an invitation is pasted). An invitation with no such line simply
// cannot match on the address or the city — unknown, never a pass.
// ─────────────────────────────────────────────────────────────────────────

/** What is being checked: an invitation about to be logged, or one on file. */
export type SameJobCandidate = {
  /** Excluded from the comparison when the candidate is itself on file. */
  id?: string | null;
  /** The inviting GC; null when not picked yet, which compares against every GC. */
  contactId: string | null;
  projectName: string;
  /** `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  /** The `Site:` line's value ("1200 Main St, Riverside CA"), or null. */
  site: string | null;
};

/** An invitation on file, as the comparison needs it. */
export type SameJobInvitation = {
  id: string;
  contactId: string;
  contactName: string;
  projectName: string;
  status: string;
  dueDate: string | null;
  site: string | null;
};

export type SameJobMatch = {
  id: string;
  contactId: string;
  contactName: string;
  projectName: string;
  /** Short phrases, in the order they are said: "same name", "same due date". */
  reasons: string[];
  /** "Same name and due date as Riverside Medical from Acme Builders". */
  sentence: string;
};

/** Words that say nothing about WHICH job: dropped before comparing names. */
const NAME_STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "at", "for", "to", "in", "on", "re",
  "project", "bid", "bids", "itb", "invitation", "rfp", "rfq", "proposal", "new",
]);

/** Spellings that mean the same word. Small on purpose: every entry is a way
 * for two different names to look alike. */
const NAME_SYNONYMS: Record<string, string> = {
  ctr: "center",
  centre: "center",
  bldg: "building",
  hosp: "hospital",
  med: "medical",
  ofc: "office",
  univ: "university",
  elem: "elementary",
  apts: "apartments",
  apt: "apartments",
  mob: "medical office building",
  ti: "tenant improvement",
};

/** The significant words of a project name, lower case and de-punctuated. */
export function nameTokens(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .flatMap((word) => (NAME_SYNONYMS[word] ?? word).split(" "));
  return [...new Set(words.filter((word) => !NAME_STOP_WORDS.has(word)))];
}

const isNumberToken = (token: string) => /\d/.test(token);

/** Street-suffix spellings, so "123 Main St." and "123 Main Street" agree. */
const STREET_WORDS: Record<string, string> = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  rd: "road",
  dr: "drive",
  ln: "lane",
  ct: "court",
  pl: "place",
  pkwy: "parkway",
  hwy: "highway",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
};

/** The street part of a site line — before the first comma, suite dropped —
 * normalised, or null when there is no street number to anchor it. */
export function normaliseStreet(site: string | null): string | null {
  if (!site) return null;
  const street = site
    .split(",")[0]
    .toLowerCase()
    .replace(/(\b(suite|ste|unit)\b|#)\s*\S+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_WORDS[word] ?? word)
    .join(" ");
  // An address without a number ("Main Street") names a road, not a site.
  return /^\d/.test(street) ? street : null;
}

/** The city of a site line, with a trailing state code and zip dropped, or
 * null. After the street when the line opens with a street number ("1200 Main
 * St, Riverside, CA 92501"), otherwise the line's first part ("Riverside, CA"). */
export function normaliseCity(site: string | null): string | null {
  if (!site) return null;
  const parts = site.split(",").map((part) => part.trim()).filter(Boolean);
  const cityPart = /^\d/.test(parts[0] ?? "") ? parts[1] : parts[0];
  if (!cityPart) return null;
  const city = cityPart
    .toLowerCase()
    .replace(/\b\d{5}(-\d{4})?\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+[a-z]{2}\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return city || null;
}

/** Whole days between two `YYYY-MM-DD` strings. */
function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Days within which two due dates support a similar name. */
export const SAME_JOB_DATE_WINDOW_DAYS = 7;
/** Days beyond which two due dates rule a match out (a re-bid). */
export const SAME_JOB_REBID_DAYS = 30;
/** Share of significant words two names need in common to be "similar". */
export const SAME_JOB_NAME_SIMILARITY = 0.6;

/** One invitation on file against the candidate: the reasons, or null. */
export function sameJobReasons(candidate: SameJobCandidate, other: SameJobInvitation): string[] | null {
  if (other.status !== "INVITED" && other.status !== "SUBMITTED") return null;
  if (candidate.id && candidate.id === other.id) return null;
  if (candidate.contactId !== null && candidate.contactId === other.contactId) return null;

  const days = candidate.dueDate && other.dueDate ? daysApart(candidate.dueDate, other.dueDate) : null;
  if (days !== null && days > SAME_JOB_REBID_DAYS) return null;

  const mine = nameTokens(candidate.projectName);
  const theirs = nameTokens(other.projectName);
  const myNumbers = mine.filter(isNumberToken).sort().join(" ");
  const theirNumbers = theirs.filter(isNumberToken).sort().join(" ");
  if (myNumbers && theirNumbers && myNumbers !== theirNumbers) return null;

  const shared = mine.filter((token) => theirs.includes(token)).length;
  const union = new Set([...mine, ...theirs]).size;
  const similarity = union === 0 ? 0 : shared / union;
  const sameName = mine.length >= 2 && shared === mine.length && shared === theirs.length;
  const similarName = !sameName && similarity >= SAME_JOB_NAME_SIMILARITY;

  const myStreet = normaliseStreet(candidate.site);
  const sameStreet = myStreet !== null && myStreet === normaliseStreet(other.site);
  const myCity = normaliseCity(candidate.site);
  const sameCity = myCity !== null && myCity === normaliseCity(other.site);
  const closeDates = days !== null && days <= SAME_JOB_DATE_WINDOW_DAYS;

  const matched = sameStreet || sameName || (similarName && (closeDates || sameCity));
  if (!matched) return null;

  const reasons: string[] = [];
  if (sameName) reasons.push("same name");
  else if (similarName) reasons.push("similar name");
  if (sameStreet) reasons.push("same site address");
  else if (sameCity) reasons.push("same city");
  if (days === 0) reasons.push("same due date");
  else if (closeDates) reasons.push(`due dates ${days} ${days === 1 ? "day" : "days"} apart`);
  return reasons;
}

/** "same name", "same due date" → "Same name and due date". A repeated "same"
 * is folded when the sentence already opened with one. */
export function joinSameJobReasons(reasons: string[]): string {
  const opensSame = reasons[0]?.startsWith("same ") ?? false;
  const folded = reasons.map((reason, index) =>
    index > 0 && opensSame && reason.startsWith("same ") ? reason.slice("same ".length) : reason,
  );
  const text =
    folded.length <= 1 ? (folded[0] ?? "") : `${folded.slice(0, -1).join(", ")} and ${folded[folded.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every open invitation from ANOTHER GC that looks like the same job as the
 * candidate, strongest first (more reasons first, then soonest due).
 */
export function findSameJobFromOtherGc(
  candidate: SameJobCandidate,
  invitations: SameJobInvitation[],
): SameJobMatch[] {
  const found: { match: SameJobMatch; dueDate: string | null }[] = [];
  for (const other of invitations) {
    const reasons = sameJobReasons(candidate, other);
    if (!reasons) continue;
    found.push({
      dueDate: other.dueDate,
      match: {
        id: other.id,
        contactId: other.contactId,
        contactName: other.contactName,
        projectName: other.projectName,
        reasons,
        sentence: `${joinSameJobReasons(reasons)} as ${other.projectName} from ${other.contactName}`,
      },
    });
  }
  return found
    .sort((a, b) => {
      if (a.match.reasons.length !== b.match.reasons.length) return b.match.reasons.length - a.match.reasons.length;
      if (a.dueDate === b.dueDate) return a.match.contactName.localeCompare(b.match.contactName);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    })
    .map((one) => one.match);
}

/**
 * For the bid list: each open invitation's matches among the OTHER open
 * invitations, keyed by id. Invitations with none are absent, so a lookup
 * that misses means "nothing to say".
 */
export function sameJobFlags(open: SameJobInvitation[]): Map<string, SameJobMatch[]> {
  const flags = new Map<string, SameJobMatch[]>();
  for (const invitation of open) {
    if (invitation.status !== "INVITED" && invitation.status !== "SUBMITTED") continue;
    const matches = findSameJobFromOtherGc(
      {
        id: invitation.id,
        contactId: invitation.contactId,
        projectName: invitation.projectName,
        dueDate: invitation.dueDate,
        site: invitation.site,
      },
      open,
    );
    if (matches.length > 0) flags.set(invitation.id, matches);
  }
  return flags;
}
