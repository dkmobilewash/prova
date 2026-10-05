/**
 * THE CONTRACTOR LICENCE NUMBER, TURNED INTO THE KEY CSLB ACTUALLY STORES.
 *
 * `SalesLead.licenceNumber` exists to be JOINED ON, and as of 2026-10-05 the
 * thing it joins to has been MEASURED rather than assumed. California's CSLB
 * publishes a free bulk CSV, no registration and no fee, whose primary key is the
 * licence number a §4104 listing already prints — and whose `BusinessPhone`
 * column is populated on **5,003 of the 5,007 wall-and-ceiling firms counted
 * across 25 counties (99.92%)**. A §4104 listing carries no telephone number at
 * all, so that column is the difference between a lead nobody can ring and a lead
 * somebody can.
 *
 * This module is the ONE place that turns something printed, pasted or typed into
 * that key. It is pure: no prisma, no network, no form handling, so the rule can
 * be executed by a test rather than argued about.
 *
 * ── THE KEY'S SHAPE IS MEASURED, AND IT IS NOT WHAT THIS FILE FIRST ASSUMED ──
 *
 * Measured over 5,007 target-set rows and a 32,423-row master sample:
 * `LicenseNo` is a **bare decimal integer, 2 to 7 digits**. No prefix, no
 * punctuation, no embedded space, and **not one value begins with a zero**.
 * Shortest observed `92`, longest `1162318`; a real five-digit (`91594`) and a
 * real three-digit (`102`) exist.
 *
 * This file originally required SIX to eight digits, which is `parse.ts`'s
 * pattern, and that was wrong in both directions for a key:
 *
 *   - **eight digits can never match.** The longest real licence is seven, so an
 *     eight-digit value is a guaranteed false capture — most likely a money or
 *     quantity column that won the licence slot. Refusing it loses nothing.
 *   - **the six-digit floor drops real licences.** Two of the 5,007 are shorter.
 *     The floor is not wrong where it lives — it defends `parse.ts`'s
 *     COLUMN-INFERRED read, where *"a five-digit run is a ZIP code"* out of the
 *     place-of-business column, a failure that file records paying for. That is a
 *     question about WHICH COLUMN a number came from, and it is already settled
 *     by the time anything reaches here: this function is handed a field
 *     `parse.ts` has already decided is a licence, or a box a person typed into
 *     under a label saying so. Carrying the floor down here would be the same
 *     guard applied to a question it is not about.
 *
 * ── TWO NORMALISATIONS THE DOCUMENTS FORCE ──
 *
 * **The class prefix.** A contractor holds ONE number under several
 * classifications, so a listing prints `C-9 884201` on the framing row and
 * `C-35 884201` on the plaster row for one man. `parse.ts`'s `licenceOnly` keeps
 * that prefix in the value it returns — deliberately, because it is reading what
 * the document said — so a naive equality join misses every prefixed row, and the
 * repo's own fixtures all write that form. The class is a fact about the scope of
 * work, not about who holds the licence, and it is not part of the key.
 *
 * **Leading zeros.** The repo's own harvest of 26 real Caltrans post-bid files
 * records that a licence prints as bare digits *"with leading zeros significant
 * (`061234`)"*. CSLB stores none, so `061234` and `61234` are one licence and
 * stripping is MANDATORY rather than tidy — and note which way the old rule
 * failed: `061234` is six characters and passed the floor, while the same
 * licence written bare as `61234` did not.
 *
 * ── NOTHING IS LOST, AND NOTHING HERE IS A CLAIM ──
 *
 * Normalising is safe because this is not where the CLAIM lives.
 * `lib/sub-listing/signals.ts` quotes what the document printed, with its source
 * URL and line number, and that sentence is what a person reads down a telephone.
 * This produces the key beside it.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not validate a licence against CSLB, check a checksum, or decide
 * whether a number is live, expired or bonded. `parse.ts` says the same of its
 * own reader — *"Recognised, never validated"* — and for the same reason: a
 * subcontractor dropped because an unverified identifier looked wrong is a lead
 * lost to a guess. A number of the right SHAPE is stored; whether it exists is
 * what the lookup is for.
 *
 * It also does no classification matching, and anything added here that does must
 * read the measurement first: the classification strings in the CSLB data are
 * inconsistently hyphenated (`C-9` but `C35` and `D50`, separated by `"| "`, with
 * the `C61/` dropped), so a filter written `C-35` or `C9` matches NOTHING and
 * goes green — this repo's own recurring failure shape. EIFS and fireproofing are
 * both C-35 and neither is D-12; suspended ceilings is C-61/D-50.
 *
 * And two facts the CSLB data does not contain, so that nothing built on this
 * implies otherwise: there is **no email address** anywhere in it ("Email
 * addresses are not provided", on all three CSLB pages), and there is **no line
 * type** — nothing says whether a number is a desk line or a mobile, which is the
 * fact an automated dialler would turn on. A key that finds a telephone number is
 * not permission to dial it.
 */

/** Labels a document or a person puts in front of the number. */
const LABEL = /^(?:cslb\s*)?(?:lic(?:en[cs]e)?\.?)?\s*(?:no\.?|number|#)?\s*:?\s*/i;

/**
 * A classification code anywhere in the cell — `C-9`, `C35`, `D50`, `B`-with-a-
 * number, and the halves of a `C-61/D-50` pair.
 *
 * It must begin with a LETTER, which is what keeps it from eating a short
 * licence: the measured two-digit licence `92` and three-digit `102` carry no
 * letter and cannot match. Removed wherever it appears rather than only at the
 * front, because one cell can carry both classifications of one number —
 * "C-9 884201 / C-35 884201" is one contractor, and leaving the second code in
 * would make its digits look like a second licence.
 *
 * The bare `A`/`B` alternative is there because those two classifications carry no
 * number of their own — a general building contractor's cell reads "B 884201" —
 * and it is restricted to those two letters rather than any letter, so that an
 * unreadable cell stays unreadable instead of being shaved into a number.
 */
const CLASS_CODE = /\b(?:[A-Za-z]{1,2}-?\d{1,2}|[AB])\b/g;

/** What is allowed to be left over once the codes and the digits are gone. */
const SEPARATORS = /[\s.,;/|#:()[\]-]+/g;

/**
 * The document saying there is NO licence, as distinct from the document saying
 * something this cannot read. The repo's Caltrans harvest records the literal
 * `na` in a licence cell; the other two are the same intent spelled differently.
 */
const NOT_RECORDED = new Set(["na", "n/a", "none"]);

/**
 * WHY A CELL YIELDED NO KEY. Distinguishable on purpose rather than collapsed
 * into one null: a reviewer deciding whether a lead can be chased wants to know
 * the difference between "the form said there is no licence", "that is a DIR
 * registration, not a licence" and "nobody can read this".
 */
export type LicenceKeyRefusal =
  /** Nothing was there. */
  | "BLANK"
  /** The document itself said there is none — `na`, `n/a`, `none`. */
  | "NOT_RECORDED"
  /** Words, or a number with words around it. */
  | "NOT_A_NUMBER"
  /** One digit, or only zeros. */
  | "TOO_SHORT"
  /** Eight digits or more, which no California licence is. */
  | "TOO_LONG"
  /** Two different licence-shaped numbers, and nothing here may pick one. */
  | "MORE_THAN_ONE";

export type LicenceKey =
  | { key: string; refusal?: undefined }
  | { key: null; refusal: LicenceKeyRefusal };

/** Digits with leading zeros gone. `"061234"` -> `"61234"`, `"00"` -> `""`. */
function unpadded(digits: string): string {
  return digits.replace(/^0+/, "");
}

/** Could this run of digits be a CSLB licence at all? 2 to 7, measured. */
function couldBeLicence(digits: string): boolean {
  return digits.length >= 2 && digits.length <= 7;
}

/**
 * THE KEY, OR THE REASON THERE ISN'T ONE.
 *
 * Every caller in the app goes through this, so the rule above has exactly one
 * implementation. `importSubListing`'s dedupe used to carry a second copy of it
 * (`/(\d{6,8})\s*$/`, anchored at the end of the string), which is the #526 shape:
 * a canonical rule with a hand-rolled duplicate beside it, where a test on the
 * first cannot see the second — and in that case it also meant the number used to
 * decide IDENTITY and the number STORED were produced by two different rules that
 * nothing compared.
 */
export function licenceKey(raw: string | null | undefined): LicenceKey {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { key: null, refusal: "BLANK" };
  if (NOT_RECORDED.has(trimmed.toLowerCase())) return { key: null, refusal: "NOT_RECORDED" };

  const cleaned = trimmed.replace(LABEL, "").replace(CLASS_CODE, " ");
  const runs = [...new Set((cleaned.match(/\d+/g) ?? []).map(unpadded))];
  if (runs.length === 0) return { key: null, refusal: "NOT_A_NUMBER" };

  /* Runs that cannot be a licence are dropped BEFORE the ambiguity test, not
     counted as rivals to one that can. The case this is for is real and common:
     a pasted cell holding both identifiers, "C-9 884201   1000012345", where the
     ten-digit DIR registration is not a candidate licence at any width. Treating
     it as a second licence would refuse a row whose licence is unambiguous. */
  const candidates = runs.filter(couldBeLicence);
  if (candidates.length === 0) {
    return {
      key: null,
      refusal: runs.some((run) => run.length > 7) ? "TOO_LONG" : "TOO_SHORT",
    };
  }
  if (candidates.length > 1) return { key: null, refusal: "MORE_THAN_ONE" };

  /* Anything left that is neither a number nor punctuation means this cell was
     not a licence cell — "Fontana, CA 92335" carries a perfectly licence-shaped
     five digits and is a place. The column question belongs to `parse.ts`, but a
     cell it hands over whole still has to BE the number. */
  const residue = cleaned.replace(/\d+/g, " ").replace(SEPARATORS, "");
  if (residue !== "") return { key: null, refusal: "NOT_A_NUMBER" };

  return { key: candidates[0] };
}

/**
 * The licence key in something the MACHINE read, or null.
 *
 * The reason is dropped here on purpose: this is the import path, where there is
 * nobody to ask. A row that cannot produce a key still imports with its claims
 * intact — including its LICENCE claim, which quotes whatever the document
 * printed — it simply has nothing to join on.
 */
export function licenceNumberFrom(raw: string | null | undefined): string | null {
  return licenceKey(raw).key;
}

/**
 * Why a typed licence was not accepted, one sentence per reason.
 *
 * A TOTAL record over the refusals a form can show, so a new refusal kind cannot
 * be added without deciding what the person reading it is told. `BLANK` and
 * `NOT_RECORDED` are excluded because they are not refusals in a form at all —
 * most leads have no licence, and someone typing `na` means the same thing as
 * leaving it empty.
 */
const REFUSAL_SENTENCE: Record<
  Exclude<LicenceKeyRefusal, "BLANK" | "NOT_RECORDED">,
  (context: { raw: string; found: string[] }) => string
> = {
  NOT_A_NUMBER: ({ raw }) =>
    `A CSLB licence number is 2 to 7 digits and nothing else, and "${raw}" is not. Leave it blank if you do not have the number — a wrong one looks up as somebody else.`,
  TOO_SHORT: ({ raw }) =>
    `"${raw}" is not a licence number — the shortest in California's own file is two digits.`,
  TOO_LONG: ({ raw }) =>
    `"${raw}" is longer than seven digits, so it cannot be a CSLB licence number — the longest in California's own file is seven. A ten-digit number is usually a DIR public-works registration, which goes in its own column.`,
  MORE_THAN_ONE: ({ found }) =>
    `That is more than one licence number (${found.join(" and ")}). A lead holds one; the rest belong in a note.`,
};

/**
 * The licence from something a PERSON typed, or a refusal naming the reason.
 *
 * A different answer from `licenceNumberFrom`'s silent null, because the two
 * situations are genuinely different and this repo has a scar for conflating
 * them. On the import path there is nobody to ask. In a form the typist IS the
 * person who can fix it — and silently dropping what they typed is the worse
 * failure here, because the screen labels this box as the number a lookup will
 * use. A value that cannot join, displayed under that label, is a promise the
 * data cannot keep.
 *
 * Refusing is NOT the reflex answer, and CLAUDE.md is right that a refusal often
 * costs more than the wrong value it avoids. The test is whether anything
 * downstream can resolve the doubt: for a percentage on a listing row the answer
 * is yes — a reviewer confirms every signal — so the figure is claimed with a
 * concern attached. Here the answer is no. Nothing downstream reviews this field,
 * its only consumer is an exact-match join, and the person who can settle it is
 * already looking at the box.
 *
 * Empty is NOT a refusal, and neither is `na`.
 */
export type TypedLicence =
  | { ok: true; licenceNumber: string | null }
  | { ok: false; why: string };

export function readTypedLicence(raw: string): TypedLicence {
  const trimmed = raw.trim();
  const result = licenceKey(trimmed);
  if (result.key !== null) return { ok: true, licenceNumber: result.key };
  if (result.refusal === "BLANK" || result.refusal === "NOT_RECORDED") {
    return { ok: true, licenceNumber: null };
  }

  /* The candidates, for the one sentence that names them. Derived from the same
     function rather than re-extracted, so a message cannot name numbers the rule
     did not see. */
  const found = [
    ...new Set(
      (trimmed.replace(LABEL, "").replace(CLASS_CODE, " ").match(/\d+/g) ?? []).map(unpadded),
    ),
  ].filter(couldBeLicence);

  return { ok: false, why: REFUSAL_SENTENCE[result.refusal]({ raw: trimmed, found }) };
}
