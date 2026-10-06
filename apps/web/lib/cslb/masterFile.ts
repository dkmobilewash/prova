/**
 * THE CSLB MASTER LICENCE FILE, TURNED INTO SOMETHING JOINABLE.
 *
 * A §4104 subcontractor listing prints a licence number and no telephone number.
 * California's CSLB publishes a free bulk CSV keyed on that licence number whose
 * `BusinessPhone` column is populated on 243,543 of 243,786 rows — 99.9%. This
 * module turns one row of that file into a record the phone fill can join to a
 * `SalesLead`. It is pure: no prisma, no network, no file system, so every rule
 * below is executed by a test rather than argued about.
 *
 * ── EVERY SHAPE HERE WAS MEASURED, AND TWO OF THEM ARE NOT WHAT I ASSUMED ──
 *
 * Measured 2026-10-06 over 621 whole records read from the head of the live file.
 * The numbers in the table are that sample; the row count above is the whole file,
 * counted 2026-10-05.
 *
 *   | column | shape |
 *   | --- | --- |
 *   | `BusinessPhone` | ONE shape, `(999) 999 9999` — note the SPACE, not a hyphen |
 *   | `LicenseNo` | bare digits, no punctuation, no leading zero |
 *   | `PrimaryStatus` | `CLEAR` plus five spellings of suspension |
 *   | `Classifications(s)` | separated by `"| "`, and `C-9` is hyphenated while `C99`/`D99` are not |
 *
 * **The phone format is the one I nearly guessed wrong, and the near-miss is
 * worth recording because of HOW it happened.** A scratch file left by an earlier
 * session held a ten-digit run, which read exactly like a bare phone number and
 * would have had this module expecting `5551234567`. It was a cookie expiry
 * timestamp in a `curl` cookie jar — a needle that was already on the page, in a
 * different guise, which is the vacuous-signal trap CLAUDE.md records under the
 * #61 watcher. Nothing here is built on it; the table above comes from the column
 * by name.
 *
 * **And the hyphen inconsistency has a cause rather than being noise.** `C-9` is
 * hyphenated and `C35` is not because both are THREE characters: the hyphen pads a
 * single-digit class to the width of a two-digit one. So it is formatting, not
 * semantics, and the normalisation is simply to drop it — which matters, because
 * `lib/sales-licence.ts` records that a filter written `C-35` or `C9` matches
 * NOTHING in this data and goes green, this repo's favourite failure shape.
 *
 * ── THE JOIN KEY IS NOT COMPUTED HERE ──
 *
 * `licenceKey` in `lib/sales-licence.ts` is the one implementation of what a CSLB
 * licence number is, and this module calls it rather than carrying a second copy.
 * That is deliberate and it is the #526 lesson: a canonical rule with a
 * hand-rolled duplicate beside it is a rule whose test cannot see the code that
 * actually runs. The same function normalises what a listing printed and what this
 * file stores, so the two sides of the join cannot drift apart.
 *
 * ── WHAT THIS REFUSES, AND THE ONE THING IT DELIBERATELY DOES NOT ──
 *
 * A row with no usable licence key is refused: it cannot be joined to anything, so
 * there is nothing to do with it. A row whose phone cannot be read is KEPT with a
 * null phone, because the name, city and classifications are still true and still
 * worth having.
 *
 * **A suspended licence is NOT refused.** `PrimaryStatus` is `CLEAR` on 94.8% of
 * the file and some flavour of suspension on the rest — a lapsed bond, a workers'
 * comp gap. Those are real firms with real telephones, and a bond suspension is
 * commercially interesting rather than disqualifying: it is a reason to ring
 * somebody, not a reason to hide them. So the status travels with the record and
 * the caller decides. CLAUDE.md's entry on the percentage refusal is the general
 * form — where a human already reads the result, "claim it and say what is
 * doubtful" beats "refuse it", and the refusal is the option that looks
 * responsible while quietly costing the most.
 *
 * ── TWO FACTS THIS FILE DOES NOT CONTAIN ──
 *
 * There is **no email address** anywhere in it, by statute rather than by
 * omission (B&P Code §27, stated on CSLB's own pages). And there is **no line
 * type** — nothing says whether a number is a desk line or a mobile. A key that
 * finds a telephone number is not permission to dial it.
 */

import { licenceKey } from "../sales-licence";

/** The columns this module reads. The file has 52; these are the ones used. */
export const CSLB_COLUMNS = {
  licence: "LicenseNo",
  businessName: "BusinessName",
  fullBusinessName: "FullBusinessName",
  secondName: "BUS-NAME-2",
  phone: "BusinessPhone",
  city: "City",
  county: "County",
  status: "PrimaryStatus",
  classifications: "Classifications(s)",
} as const;

/** `CLEAR` is CSLB's word for a licence in good standing. Not `ACTIVE`. */
export const GOOD_STANDING = "CLEAR";

export type CslbRecord = {
  /** The join key, from `licenceKey` — never computed here. */
  licence: string;
  /** What the file printed in `LicenseNo`, for a message that quotes it. */
  licenceAsFiled: string;
  /** Dialable and punctuated, or null when the column could not be read. */
  phone: string | null;
  /** The most human of the names the file carries. See `displayName`. */
  name: string;
  /** `BusinessName` verbatim, which for a sole owner is surname-first. */
  nameAsFiled: string;
  city: string | null;
  county: string | null;
  /** `PrimaryStatus` verbatim — `CLEAR`, `Contr Bond Susp`, and so on. */
  status: string;
  /** `status === "CLEAR"`. Derived, never stored. */
  inGoodStanding: boolean;
  /** Normalised codes, hyphens dropped: `["C9", "C35"]`. */
  classifications: string[];
};

/** Why a row yielded no record. Only one reason, and it is not about the phone. */
export type CslbRowRefusal =
  /** `LicenseNo` produced no licence key, so there is nothing to join on. */
  | "NO_LICENCE_KEY";

export type CslbRowResult =
  | { record: CslbRecord; refusal?: undefined }
  | { record: null; refusal: CslbRowRefusal };

function cell(row: Record<string, string | undefined>, column: string): string {
  return (row[column] ?? "").trim();
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * THE TELEPHONE NUMBER, PUNCTUATED THE WAY EVERY OTHER NUMBER IN THE WORLD IS.
 *
 * The file prints `(916) 555 1234` — a SPACE where convention puts a hyphen. The
 * digits are the fact and the punctuation is formatting, so this keeps the digits
 * exactly as they came and writes the separator everybody expects. That is the
 * only liberty taken with the value.
 *
 * `SalesLead.phone` is free text today, written verbatim by the hand-typed lead
 * form, so there is no house format to conform to and none is being invented: the
 * aim is a string a person can read down a telephone and a dialler will not choke
 * on.
 *
 * Tolerant of shapes the measured sample did not show, because 621 records out of
 * 243,786 is not a promise about the other 243,165 — a hyphen, a dot, bare digits
 * and a leading country `1` all normalise. What it will NOT do is invent a number:
 * anything that is not exactly ten digits after the country code comes back null,
 * because a seven-digit number with no area code cannot be dialled and a
 * fourteen-digit one is not a telephone number.
 *
 * An all-zero number is refused as well. It is the one value that is unmistakably
 * a placeholder rather than a number somebody mistyped.
 */
export function cslbPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  if (/^0+$/.test(national)) return null;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * THE CLASSIFICATION CODES, WITH THE PADDING HYPHEN GONE.
 *
 * Separated by `"| "` in the file. `C-9` and `C35` are the same kind of thing
 * written two ways, so both become letter-plus-digits with nothing between.
 * Order is preserved and duplicates collapse, because a row really can print the
 * same code twice.
 *
 * Deliberately NOT a closed vocabulary. `lib/sales-licence.ts` argues the opposite
 * case for a FILTER and is right there — a filter over an open vocabulary answers
 * wrongly the first time the data says something new. This is not a filter; it is
 * a reading. Dropping a code nobody has heard of would lose what the file said,
 * and the file is the authority on which codes exist.
 */
export function cslbClassifications(raw: string | null | undefined): string[] {
  const codes = (raw ?? "")
    .split("|")
    .map((part) => part.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((part) => part !== "");
  return [...new Set(codes)];
}

/**
 * THE NAME A PERSON SHOULD SEE, WHICH IS OFTEN NOT `BusinessName`.
 *
 * Measured over 840 wall-and-ceiling rows: `BusinessName` is an INDEX form, so a
 * sole owner is filed as `RODRIGUEZ JOSE` and `MARSH SCOTT DRYWALL`.
 * `FullBusinessName` carries the same firm the right way round — `JOSE RODRIGUEZ`,
 * `SCOTT MARSH DRYWALL` — and is non-empty on 103 of those 840, almost exactly the
 * rows where the two differ.
 *
 * So `FullBusinessName` wins when it is there. This is the name on a call list,
 * and reading somebody their own name backwards is the kind of detail that ends a
 * cold call in the first five seconds.
 *
 * `BUS-NAME-2` is a DBA or a second registered name (non-empty on 92 of 840) and
 * is deliberately not merged in: two names joined by this function would be a
 * string that appears nowhere in the file. It is carried on the record instead,
 * for whoever wants to show it.
 */
export function displayName(row: Record<string, string | undefined>): string {
  const full = cell(row, CSLB_COLUMNS.fullBusinessName);
  return full !== "" ? full : cell(row, CSLB_COLUMNS.businessName);
}

/** One row of the master file as a record, or the reason it cannot be one. */
export function cslbRecordFrom(row: Record<string, string | undefined>): CslbRowResult {
  const licenceAsFiled = cell(row, CSLB_COLUMNS.licence);
  const licence = licenceKey(licenceAsFiled).key;
  if (licence === null) return { record: null, refusal: "NO_LICENCE_KEY" };

  const status = cell(row, CSLB_COLUMNS.status);
  return {
    record: {
      licence,
      licenceAsFiled,
      phone: cslbPhone(cell(row, CSLB_COLUMNS.phone)),
      name: displayName(row),
      nameAsFiled: cell(row, CSLB_COLUMNS.businessName),
      city: orNull(cell(row, CSLB_COLUMNS.city)),
      county: orNull(cell(row, CSLB_COLUMNS.county)),
      status,
      inGoodStanding: status === GOOD_STANDING,
      classifications: cslbClassifications(cell(row, CSLB_COLUMNS.classifications)),
    },
  };
}
