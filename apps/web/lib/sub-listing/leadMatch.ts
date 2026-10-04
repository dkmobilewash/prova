/**
 * IS THIS LISTED SUBCONTRACTOR ALREADY A LEAD?
 *
 * The same drywall sub appears on five award packets in a year, and that is the
 * point rather than a nuisance: five `PROJECT` signals on ONE lead is a
 * prospect you know something about, while five leads with one signal each is a
 * CRM that has learned nothing and a band that reads *Too thin to call* on all
 * five.
 *
 * ── WHY THIS SUGGESTS AND NEVER DECIDES ──
 *
 * `SalesLead` has `companyName` and no licence number, no city and no unique
 * constraint, so the only thing available to match on is a name somebody typed
 * against a name an agency's clerk typed. "Valley Interior Systems" and "Valley
 * Interiors Inc." are the same company about as often as they are not, and
 * there is no evidence in either string that settles it.
 *
 * So this returns CANDIDATES, ranked, and the review screen makes a person
 * choose between attaching and creating. An automatic merge on a name is the
 * same class of error as the one the whole feature is built to avoid — a
 * confident wrong answer that every code-level guard passes, because attaching
 * a signal to the wrong company produces a perfectly well-formed lead that is
 * about somebody else.
 *
 * The honest fix is a licence number on `SalesLead`: a contractor licence is
 * the one identifier in this trade that is unique, printed on the document, and
 * typed by neither party. That is a schema change, which the working agreement
 * says is announced in Slack before the push — so it is deliberately NOT in
 * this slice, and it is the first thing to do in the next one.
 *
 * Pure: no prisma, no network. The caller hands in the leads it already read.
 */

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

export type LeadCandidate<T> = {
  lead: T;
  /**
   * `SAME` — the names are identical once entity suffixes and punctuation go.
   * `POSSIBLE` — every word of one name appears in the other, which is a real
   * company often enough ("Valley Interior" vs "Valley Interior Systems") and a
   * different one often enough that nothing here may act on it.
   */
  confidence: "SAME" | "POSSIBLE";
};

function words(normalised: string): string[] {
  return normalised.split(" ").filter(Boolean);
}

/**
 * Existing leads that might be this listed subcontractor, best first.
 *
 * Returns an empty array rather than a nearest guess when nothing matches: "no
 * candidate" is a useful and common answer here, since the whole purpose of
 * reading a public listing is to find companies nobody has entered yet.
 */
export function leadCandidatesFor<T extends { companyName: string }>(
  listedName: string,
  leads: readonly T[],
): LeadCandidate<T>[] {
  const target = normaliseCompanyName(listedName);
  if (!target) return [];
  const targetWords = words(target);

  const candidates: LeadCandidate<T>[] = [];

  for (const lead of leads) {
    const existing = normaliseCompanyName(lead.companyName);
    if (!existing) continue;

    if (existing === target) {
      candidates.push({ lead, confidence: "SAME" });
      continue;
    }

    const existingWords = words(existing);
    // A single shared word is not a resemblance — "Western Fireproofing" and
    // "Western Electric" share everything that is not the trade.
    if (targetWords.length < 2 && existingWords.length < 2) continue;

    const shorter = targetWords.length <= existingWords.length ? targetWords : existingWords;
    const longer = shorter === targetWords ? existingWords : targetWords;
    if (shorter.length >= 2 && shorter.every((word) => longer.includes(word))) {
      candidates.push({ lead, confidence: "POSSIBLE" });
    }
  }

  return candidates.sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === "SAME" ? -1 : 1,
  );
}
