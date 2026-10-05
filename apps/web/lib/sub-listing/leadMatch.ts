/**
 * IS THIS LISTED SUBCONTRACTOR ALREADY A LEAD?
 *
 * The same drywall sub appears on five award packets in a year, and that is the
 * point rather than a nuisance: five `PROJECT` signals on ONE lead is a
 * prospect you know something about, while five leads with one signal each is a
 * CRM that has learned nothing and a band that reads *Too thin to call* on all
 * five.
 *
 * ── TWO KINDS OF EVIDENCE, AND ONLY ONE OF THEM IS TYPED BY ANYBODY ──
 *
 * This header said for weeks that "`SalesLead` has `companyName` and no licence
 * number", that the only thing available to match on was therefore a name, and
 * that a licence column was "deliberately NOT in this slice… the first thing to
 * do in the next one". **That slice shipped.** `SalesLead.licenceNumber` and
 * `registrationNumber` exist, `importSubListing` writes both, and the sentence
 * telling the next reader they did not exist is the kind this repo pays for —
 * a claim about what the code LACKS, which is the direction that stops people
 * looking.
 *
 * So there are now two kinds of evidence and they are not equal:
 *
 *   - **an identifier** — a CSLB contractor licence or a DIR public-works
 *     registration. Unique, printed on the document, and typed by neither
 *     party to this transaction.
 *   - **a name** — typed by whoever entered the lead, against a name typed by
 *     an agency's clerk. "Valley Interior Systems" and "Valley Interiors Inc."
 *     are the same company about as often as they are not, and there is no
 *     evidence in either string that settles it.
 *
 * ── WHY THIS OFFERS MORE THAN THE IMPORT MERGES, ON PURPOSE ──
 *
 * `importSubListing` merges two records automatically only when an identifier
 * matches AND the normalised name corroborates it, because a licence a person
 * hand-typed can carry a transposed digit and one such digit would weld two
 * firms together for good.
 *
 * This function is the same decision with a PERSON in it, so it is allowed to
 * surface what the import declined. Withholding a licence collision from the
 * reviewer does not prevent the bad merge — it hides the collision, and the
 * reviewer creates the duplicate by hand not knowing it existed. That is
 * CLAUDE.md's refusal trap: where a human already gates the outcome, showing
 * the doubtful thing and naming the doubt beats refusing to show it.
 *
 * What it still never does is DECIDE. It returns candidates, and the review
 * screen makes a person choose between attaching and creating. An automatic
 * merge on a name is the error the whole feature is built to avoid — a
 * confident wrong answer every code-level guard passes, because attaching a
 * signal to the wrong company produces a perfectly well-formed lead that is
 * about somebody else.
 *
 * ── THE ONE CASE IT WILL NOT OFFER AS AN ATTACHMENT ──
 *
 * Both sides printed an identifier of the same kind and they DISAGREE. The
 * documents have already said these are two registrants, and no amount of name
 * agreement un-says it — so an identical name over contradicting licences is
 * not a strong candidate, it is two companies. Those come back under
 * `differentRegistrant`, which the screen shows as a NOTE and can never render
 * as something to click. Dropping them silently was the other option and it is
 * worse than either: a suppression nobody can see is this file deciding, which
 * is the one thing its title says it does not do.
 *
 * ── THE KEY IS BUILT THE WAY THE IMPORT BUILDS IT, NOT A SECOND WAY ──
 *
 * The licence goes through `licenceNumberFrom`, because a listing prints
 * `C-9 884201` on the framing row and `C-35 884201` on the plaster row for one
 * man and the class is a fact about scope of work rather than about who holds
 * the licence. The registration is compared VERBATIM, because that is what
 * `importSubListing` stores (`registration: row.registration`) — comparing it
 * any other way here would make the stored value and the matched value two
 * different keys. If registration ever needs canonicalising it needs it in
 * both places, in one function, and not by this file quietly going first.
 *
 * Pure: no prisma, no network. The caller hands in the leads it already read.
 */

import { licenceNumberFrom } from "@/lib/sales-licence";

/** The entity suffixes that carry no identity, longest first so "incorporated"
 *  is stripped before "inc" can match inside it. */
const ENTITY_SUFFIXES = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "and sons",
  "llc",
  "l l c",
  "inc",
  "corp",
  "ltd",
  "llp",
  "lp",
  "pc",
  "co",
] as const;

/**
 * A company name reduced to the part that carries identity.
 *
 * Punctuation, case and entity suffixes go; WORDS DO NOT. Stripping trade words
 * was considered and refused: "Baker Drywall" and "Baker Plastering" are two
 * companies, and a normaliser that collapses them would merge them silently.
 */
export function normaliseCompanyName(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/[.,'"`()]/g, "")
    .replace(/[&/+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Repeatedly, because "Acme Drywall Co. Inc." carries two.
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of ENTITY_SUFFIXES) {
      if (name.endsWith(` ${suffix}`)) {
        name = name.slice(0, -(suffix.length + 1)).trim();
        stripped = true;
        break;
      }
    }
  }

  return name;
}
function words(normalised: string): string[] {
  return normalised.split(" ").filter(Boolean);
}

/**
 * The two identifiers a §4104 listing can print, and that a lead can hold.
 *
 * Named rather than inline because `importSubListing` reads the same pair, and
 * an identity question with two shapes is CLAUDE.md's "is there a second list"
 * failure one notch smaller.
 */
export type RegistrantIdentifiers = {
  /** A CSLB contractor licence, already reduced to its digits. */
  licence: string | null;
  /** A DIR public-works registration, as printed. */
  registration: string | null;
};

/**
 * BOTH SIDES PRINTED AN IDENTIFIER OF THE SAME KIND AND THEY DISAGREE — which
 * outranks every resemblance, because the documents have already said these are
 * two registrants and no amount of name agreement un-says it.
 *
 * Lives here, in the pure module, and is read by `importSubListing` too. It was
 * a private function in `lib/actions/sales.ts` until the review screen needed
 * the same answer; two copies of this predicate would be two definitions of
 * "same firm" in one app, free to drift apart in whichever direction nobody
 * tested.
 *
 * One kind agreeing does NOT cancel the other kind disagreeing: a shared
 * licence with contradicting DIR registrations is still two registrants, and
 * the `||` is deliberate.
 */
export function identifiersContradict(
  a: RegistrantIdentifiers,
  b: RegistrantIdentifiers,
): boolean {
  const contradicts = (x: string | null, y: string | null) => x !== null && y !== null && x !== y;
  return contradicts(a.licence, b.licence) || contradicts(a.registration, b.registration);
}

/**
 * WHY THIS NAMES ITS EVIDENCE RATHER THAN ITS CONFIDENCE.
 *
 * These used to be `SAME` and `POSSIBLE`, and the screen rendered them with a
 * TERNARY — `confidence === "SAME" ? "(same name)" : "(similar name)"`. A
 * two-value union invites that, and the moment a third value exists the ternary
 * prints a sentence that is false: a licence match would have read "(similar
 * name)" on a row whose name is nothing like the lead's.
 *
 * So every value names the one thing that matched, each maps to exactly one
 * true sentence on screen, and the screen reads them from a total record that
 * fails to compile when a value is added without a label for it.
 */
export type MatchEvidence =
  | "SAME_LICENCE"
  | "SAME_REGISTRATION"
  | "SAME_NAME"
  | "SIMILAR_NAME";

/**
 * Strongest first. An identifier neither party typed outranks a name both
 * parties did, and the licence outranks the registration because the licence is
 * the key CSLB's own published file is built on — see `lib/sales-licence.ts`.
 *
 * `SIMILAR_NAME` means every word of the shorter name appears in the longer
 * one, which is a real company often enough ("Valley Interior" vs "Valley
 * Interior Systems") and a different one often enough that nothing here may act
 * on it.
 */
const EVIDENCE_RANK: Record<MatchEvidence, number> = {
  SAME_LICENCE: 0,
  SAME_REGISTRATION: 1,
  SAME_NAME: 2,
  SIMILAR_NAME: 3,
};

export type LeadCandidate<T> = {
  lead: T;
  evidence: MatchEvidence;
};

/**
 * A lead the documents say is NOT this row. Carries both values, because "these
 * are different registrants" is a sentence the reviewer can only check if the
 * two numbers are in front of them.
 */
export type DifferentRegistrant<T> = {
  lead: T;
  kind: "licence" | "registration";
  /** What the listing printed. */
  listed: string;
  /** What the lead already holds. */
  existing: string;
};

export type LeadMatches<T> = {
  /** Leads a person may attach this row to, strongest evidence first. */
  attachable: LeadCandidate<T>[];
  /** Leads that cannot be this row. Shown as a note, never as an option. */
  differentRegistrant: DifferentRegistrant<T>[];
};

/**
 * What the listing printed for one subcontractor, as much of it as bears on
 * identity. `name` is the document's own spelling, never normalised by the
 * caller; `licence` and `registration` are as printed, since this function does
 * the canonicalising so no caller can pass a prefixed `C-9 884201` and get a
 * silent miss.
 */
export type ListedRegistrant = {
  name: string;
  licence: string | null;
  registration: string | null;
};

/**
 * Existing leads that might be this listed subcontractor, and the ones that
 * provably are not.
 *
 * `attachable` is empty rather than a nearest guess when nothing matches: "no
 * candidate" is a useful and common answer here, since the whole purpose of
 * reading a public listing is to find companies nobody has entered yet.
 */
export function leadCandidatesFor<
  T extends {
    companyName: string;
    licenceNumber: string | null;
    registrationNumber: string | null;
  },
>(listed: ListedRegistrant, leads: readonly T[]): LeadMatches<T> {
  const listedIds: RegistrantIdentifiers = {
    licence: licenceNumberFrom(listed.licence),
    registration: listed.registration,
  };
  const target = normaliseCompanyName(listed.name);
  const targetWords = words(target);

  const attachable: LeadCandidate<T>[] = [];
  const differentRegistrant: DifferentRegistrant<T>[] = [];

  for (const lead of leads) {
    /* The lead's OWN licence is read as stored, not re-canonicalised. Both
       writers already canonicalise — `importSubListing` stores
       `licenceNumberFrom(row.licence)` and the hand-typed form stores
       `readTypedLicence`'s key — and `importSubListing`'s cross-import lookup is
       an exact equality on this column, so a stored value that needed
       canonicalising would miss there whatever this file did. Canonicalising
       here was written first and removed: it could not change a single outcome,
       which makes it the `spellingIsEnough` shape CLAUDE.md records — a guard
       nobody can check — and it would have HIDDEN a bad stored value from the
       one path that still failed on it. A third writer canonicalises at the
       write. */
    const leadIds: RegistrantIdentifiers = {
      licence: lead.licenceNumber,
      registration: lead.registrationNumber,
    };

    /* The contradiction is read BEFORE any resemblance, and reported with the
       numbers, so the reviewer can see which of the two is wrong when one of
       them is. A licence disagreement is reported in preference to a
       registration one: it is the identifier this trade actually quotes. */
    if (identifiersContradict(listedIds, leadIds)) {
      const kind =
        listedIds.licence !== null &&
        leadIds.licence !== null &&
        listedIds.licence !== leadIds.licence
          ? "licence"
          : "registration";
      const listedValue = kind === "licence" ? listedIds.licence : listedIds.registration;
      const existingValue = kind === "licence" ? leadIds.licence : leadIds.registration;
      /* Both are non-null by the branch above; the guard is here because the
         compiler cannot see that and a `!` would hide a real bug if the
         predicate above ever changed. */
      if (listedValue !== null && existingValue !== null) {
        differentRegistrant.push({ lead, kind, listed: listedValue, existing: existingValue });
      }
      continue;
    }

    if (listedIds.licence !== null && listedIds.licence === leadIds.licence) {
      attachable.push({ lead, evidence: "SAME_LICENCE" });
      continue;
    }

    if (listedIds.registration !== null && listedIds.registration === leadIds.registration) {
      attachable.push({ lead, evidence: "SAME_REGISTRATION" });
      continue;
    }

    /* A name with nothing left after normalisation cannot match a name, but it
       could still have matched an identifier above — which is why this check is
       here rather than at the top of the function, where it used to be. An empty
       name cell, or one holding only the "&" out of "Lath & Plaster", is what a
       badly split column leaves behind, and the licence cell may have read fine.
       NOT "Inc.": that normalises to "inc" and is truthy, because the suffix
       strip requires the name to END WITH " inc". The first test written for this
       used "Inc." and a mutation moving the guard back up survived it. */
    if (!target) continue;
    const existing = normaliseCompanyName(lead.companyName);
    if (!existing) continue;

    if (existing === target) {
      attachable.push({ lead, evidence: "SAME_NAME" });
      continue;
    }

    const existingWords = words(existing);
    // A single shared word is not a resemblance — "Western Fireproofing" and
    // "Western Electric" share everything that is not the trade.
    if (targetWords.length < 2 && existingWords.length < 2) continue;

    const shorter = targetWords.length <= existingWords.length ? targetWords : existingWords;
    const longer = shorter === targetWords ? existingWords : targetWords;
    if (shorter.length >= 2 && shorter.every((word) => longer.includes(word))) {
      attachable.push({ lead, evidence: "SIMILAR_NAME" });
    }
  }

  attachable.sort((a, b) => EVIDENCE_RANK[a.evidence] - EVIDENCE_RANK[b.evidence]);
  return { attachable, differentRegistrant };
}
