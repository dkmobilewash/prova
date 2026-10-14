/**
 * THE BID PACKAGE — proposal, scope sheet, GC forms and cut sheets as ONE PDF.
 *
 * The last manual hour of every bid, and nothing in this app touched it. A
 * press count of all nine estimating steps on one real bid reached step 9 and
 * stopped: there is no way to assemble a package and no way to submit one. Of
 * the 34 sub-tasks in that workflow, this is one of only three the code does
 * not do at all.
 *
 * What an estimator does instead, today: print the proposal, download the GC's
 * bid form, find the manufacturer cut sheets, open Acrobat or Preview, combine,
 * reorder, save, name it. The combining is the part a computer should do.
 *
 * ── WHY A DEPENDENCY, AGAINST THIS REPO'S OWN STANDING ARGUMENT ──
 *
 * `plan-ingest/planFixtures.ts` deliberately hand-writes PDFs and says why:
 * *"`pdf-lib` would be one npm install, but a production dependency added for a
 * test needs its licence checked against the rules for this work, and a minimal
 * PDF is a documented format."* That reasoning is correct and it does not reach
 * this file. WRITING a page from nothing is a documented format; MERGING
 * somebody else's PDF means renumbering every indirect object, rewriting the
 * cross-reference table and reconciling resource dictionaries and font
 * subsets — for a file a general contractor produced with software nobody here
 * chose. Hand-rolling that is how a bid goes out with a blank page in it.
 *
 * `pdf-lib@1.17.1` is MIT, which the licensing rules allow with attribution.
 * Its last release was 2022 — stale, recorded here rather than discovered
 * later, and acceptable because the format it reads is frozen and the surface
 * used is four calls wide (`load`, `create`, `copyPages`, `save`).
 *
 * ── WHAT THIS FILE WILL NOT DO ──
 *
 * It does not re-render the proposal. `jobs/[id]/proposal/page.tsx` is
 * print-styled HTML plus the browser's own Save as PDF, and a second renderer
 * of a document that decides who pays when scope is disputed is two sources of
 * one legal text. The person prints the proposal the way they already do and
 * it comes in as a part, like the GC's form does.
 *
 * It stores nothing. Parts arrive as bytes, the merged file goes back as bytes,
 * and no row is written — so assembling a package costs nothing and a wrong one
 * is thrown away rather than cleaned up. Attachment STORAGE is a schema
 * decision (`BidRequirement` has no `fileUrl`, so there is nowhere to keep a
 * GC's form today) and that goes in Slack before it goes in a migration.
 *
 * ── IT RUNS IN THE BROWSER, AND THAT IS THE WHOLE DESIGN ──
 *
 * The merge happens on the estimator's own machine. Three reasons, in the order
 * they decided it:
 *
 *   - **The documents never leave.** A bid package is a plan set's worth of
 *     confidential material — the GC's form, the specs behind the cut sheets,
 *     the price. The standing rule for this product is that only the Claude API
 *     ever receives document content, and a merge needs no model at all, so the
 *     bytes have no business on a server.
 *   - **There is no body limit to lose to.** A Server Action body is capped at
 *     exactly 1 MB by the framework (`document-uploads.ts` carries that
 *     account, and five actions shipped with guards that could never fire), and
 *     a serverless function's request body is capped well under a real cut
 *     sheet. Uploading each part to blob storage first would dodge both — and
 *     would mean STORING, with a reaper nobody has written. The files are
 *     already on the person's disk; sending them anywhere to staple them
 *     together is work for its own sake.
 *   - **Nothing to clean up.** No row, no blob, no scratch file.
 *
 * So `pdf-lib` is imported DYNAMICALLY inside `buildPackage` rather than at the
 * top of this file: the planning half below is dependency-free and testable
 * anywhere, and a page that shows the control does not ship a PDF library to
 * anybody who never presses it.
 */

/**
 * The order a package is assembled in, and the order is a product decision
 * rather than a preference.
 *
 * THE GC'S OWN FORM IS FIRST because it is the page they open — on public work
 * it is the page that decides whether the bid is responsive at all. The
 * proposal follows it, then the numbers behind the proposal, then the evidence
 * somebody only reads if they doubt something.
 *
 * NOT CONFIGURABLE. One sensible order stated out loud beats a setting nobody
 * sets, and a package whose order varies by who built it is one a GC cannot
 * skim.
 */
export const PACKAGE_SLOTS = [
  "GC_BID_FORM",
  "PROPOSAL",
  "SCOPE_SHEET",
  "ADDENDA",
  "COMPLIANCE",
  "CUT_SHEETS",
] as const;

export type PackageSlot = (typeof PACKAGE_SLOTS)[number];

/** What each slot is called where a person can see it, and what belongs in it.
 *  A TOTAL record, so a slot added above cannot reach a screen without a
 *  label — the shape `CostCategory` landed after a missing member. */
export const PACKAGE_SLOT_LABEL: Record<PackageSlot, { label: string; covers: string }> = {
  GC_BID_FORM: { label: "GC bid form", covers: "the contractor's own form, signed" },
  PROPOSAL: { label: "Proposal", covers: "your letter, printed to PDF" },
  SCOPE_SHEET: { label: "Scope sheet", covers: "the schedule of values behind the price" },
  ADDENDA: { label: "Addenda", covers: "what you acknowledged" },
  COMPLIANCE: { label: "Insurance, licence and bond", covers: "certificates the ITB asks for" },
  CUT_SHEETS: { label: "Cut sheets", covers: "manufacturer data for named products" },
};

/** One candidate for the package. `bytes` is null for a part somebody named and
 *  did not supply — a real state, and one the manifest has to report rather
 *  than drop, because a missing bid form is why a bid gets rejected. */
export type PackagePart = {
  slot: PackageSlot;
  /** What to call it in the manifest. The uploaded file's own name, or the
   *  stored document's label — never a generated one, because the person is
   *  checking this list against files they recognise. */
  name: string;
  bytes: Uint8Array | null;
};

/** Why a part did not make it in. Each one is reported by name; nothing is
 *  silently dropped, which is the whole reason this type exists. */
export type SkipReason = "NO_FILE" | "EMPTY" | "NOT_A_PDF" | "ENCRYPTED" | "UNREADABLE" | "TOO_LARGE";

export const SKIP_SENTENCE: Record<SkipReason, string> = {
  NO_FILE: "no file was attached",
  EMPTY: "the file is empty",
  NOT_A_PDF: "that is not a PDF",
  ENCRYPTED: "that PDF is password-protected",
  UNREADABLE: "that PDF could not be read",
  TOO_LARGE: "that file is over the size limit",
};

/**
 * The ceiling on one assembled package.
 *
 * 40 MB because a GC bid portal is the thing on the other end of this: the
 * portals this product targets cap an upload well below that, and a package
 * nobody can submit is worse than one that refuses to build. Checked on the
 * INPUT bytes as they accumulate rather than only on the result, so a 300 MB
 * set of cut sheets is refused before it is merged rather than after.
 */
export const PACKAGE_MAX_BYTES = 40 * 1024 * 1024;

/** A PDF starts with `%PDF-`. Checked on the bytes rather than taken from a
 *  content type, because the content type is the caller's claim and these bytes
 *  reach a general contractor. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

export type PlannedPart = { slot: PackageSlot; name: string; bytes: Uint8Array };
export type SkippedPart = { slot: PackageSlot; name: string; reason: SkipReason };

export type PackagePlan = {
  /** In `PACKAGE_SLOTS` order, and within a slot in the order given. */
  include: PlannedPart[];
  skip: SkippedPart[];
};

/**
 * What would go in, in what order, and what would not — decided WITHOUT
 * touching a PDF library.
 *
 * Pure and separate from the merge on purpose: the ordering is the part with a
 * product decision in it, so it is the part that has to be testable at every
 * input. The merge is then four library calls over an already-decided list.
 *
 * STABLE WITHIN A SLOT. Three cut sheets arrive in the order the person picked
 * them and stay in it; `PACKAGE_SLOTS` only decides which group goes first.
 */
export function planPackage(parts: readonly PackagePart[]): PackagePlan {
  const include: PlannedPart[] = [];
  const skip: SkippedPart[] = [];
  let running = 0;

  for (const slot of PACKAGE_SLOTS) {
    for (const part of parts) {
      if (part.slot !== slot) continue;
      const { name, bytes } = part;
      if (bytes === null) {
        skip.push({ slot, name, reason: "NO_FILE" });
      } else if (bytes.length === 0) {
        skip.push({ slot, name, reason: "EMPTY" });
      } else if (!looksLikePdf(bytes)) {
        skip.push({ slot, name, reason: "NOT_A_PDF" });
      } else if (running + bytes.length > PACKAGE_MAX_BYTES) {
        // The ceiling is reached by whichever part crosses it; the parts
        // already counted stay in. Reported by name so the person knows which
        // file to leave out rather than being told the package is too big.
        skip.push({ slot, name, reason: "TOO_LARGE" });
      } else {
        running += bytes.length;
        include.push({ slot, name, bytes });
      }
    }
  }

  return { include, skip };
}

/** What a built package says about itself. Page counts per part, because
 *  "the proposal is 2 pages and the bid form is 1" is how somebody checks a
 *  merge did what they meant without opening the file. */
export type PackageEntry = { slot: PackageSlot; name: string; pages: number; startsOnPage: number };

export type BuiltPackage = {
  /**
   * NULL WHEN NOTHING COULD BE INCLUDED, and that is not tidiness.
   *
   * Measured, because the library's behaviour here is the opposite of the
   * obvious one: `PDFDocument.create()` reports 0 pages, and `save()` on it
   * emits a 583-byte, ONE-PAGE document. So an all-skipped package would have
   * produced a blank PDF named `…-bid-package.pdf`, and a blank page sent to a
   * general contractor is worse than any error this app could show. The type
   * forces the caller to tell the difference.
   */
  bytes: Uint8Array | null;
  entries: PackageEntry[];
  skipped: SkippedPart[];
  totalPages: number;
};

/**
 * Merge the planned parts into one PDF.
 *
 * A PART THAT WILL NOT OPEN IS SKIPPED, NOT THROWN. One corrupt cut sheet must
 * not cost the whole package half an hour before a deadline — it is dropped,
 * named, and the rest is assembled. `ignoreEncryption` is deliberately NOT
 * passed: pdf-lib would then produce pages from a file whose owner password
 * forbids it, which is a decision this app does not get to make on a
 * manufacturer's document. An encrypted part is reported as encrypted.
 */
export async function buildPackage(plan: PackagePlan): Promise<BuiltPackage> {
  // Dynamic so the planning half above stays dependency-free and the proposal
  // page does not ship a PDF library to somebody who never presses Build.
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  const entries: PackageEntry[] = [];
  const skipped = [...plan.skip];

  for (const part of plan.include) {
    let source: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      source = await PDFDocument.load(part.bytes);
    } catch (error) {
      skipped.push({
        slot: part.slot,
        name: part.name,
        reason: isEncryptedPdfError(error) ? "ENCRYPTED" : "UNREADABLE",
      });
      continue;
    }
    const startsOnPage = out.getPageCount() + 1;
    let pages;
    try {
      pages = await out.copyPages(source, source.getPageIndices());
    } catch {
      skipped.push({ slot: part.slot, name: part.name, reason: "UNREADABLE" });
      continue;
    }
    for (const page of pages) out.addPage(page);
    entries.push({ slot: part.slot, name: part.name, pages: pages.length, startsOnPage });
  }

  // Nothing usable means NO FILE, never an empty one — see `bytes` above for
  // the measurement behind this branch.
  if (entries.length === 0) return { bytes: null, entries, skipped, totalPages: 0 };

  const bytes = await out.save();
  return { bytes, entries, skipped, totalPages: out.getPageCount() };
}

/**
 * Is this the library saying the document is password-protected?
 *
 * ── THE MESSAGE, BECAUSE THE TWO OBVIOUS WAYS ARE BOTH DEAD ──
 *
 * Measured against the installed `pdf-lib@1.17.1`, with a real
 * `new EncryptedPDFError()`:
 *
 *   | checked                            | result  |
 *   | ---------------------------------- | ------- |
 *   | `error.name === "EncryptedPDFError"` | `"Error"` — false, always |
 *   | `error instanceof EncryptedPDFError` | **false** |
 *   | `error.constructor.name`             | `"Error"` |
 *   | `error.message`                      | the only thing that identifies it |
 *
 * Both failures are the same cause. pdf-lib ships ES5 and builds its errors
 * through tslib's `__extends`, whose constructor body is
 * `_this = _super.call(this, msg) || this; return _this;` — and
 * `Error.call(this, msg)` RETURNS A FRESH ERROR rather than mutating `this`, so
 * the constructor hands back a plain `Error`. The subclass never exists at run
 * time: no `name`, and nothing for `instanceof` to match.
 *
 * This file shipped the first version and the comment above it argued, wrongly
 * but plausibly, that matching the name was more upgrade-proof than importing
 * the class. It was dead code, and the cost was a sentence: a password-protected
 * cut sheet would have been reported as "that PDF could not be read", which
 * sends somebody looking for a corrupt file instead of asking the manufacturer
 * for an unlocked one. The second version used `instanceof` and was dead for the
 * same reason, caught only because the test asserted it rather than trusting it.
 *
 * So the message it is, matched on the stable clause rather than the whole
 * sentence. `bid-package.test.ts` pins the library's own literal beside this, so
 * an upgrade that rewords it fails a test instead of silently reclassifying
 * every locked PDF as corrupt.
 *
 * ── WHAT IS STILL NOT PROVEN END TO END ──
 *
 * The branch is asserted against the library's real error object. It is NOT
 * driven by feeding `buildPackage` a genuinely encrypted PDF, because nothing
 * here can write one: pdf-lib cannot encrypt, `planFixtures.ts` does not, and a
 * hand-written `/Encrypt` trailer was tried and is rejected as malformed BEFORE
 * the encryption check — so that fixture proves the UNREADABLE branch while
 * looking like it proves this one. Recorded rather than papered over, the same
 * treatment `scaleBar.ts` gives its redundant zero check.
 *
 * `ignoreEncryption` stays unpassed, deliberately: pdf-lib would then emit pages
 * from a document whose owner password forbids it, and that is not a decision
 * this app gets to make about a manufacturer's drawing.
 */
export function isEncryptedPdfError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("is encrypted");
}

/**
 * WHEN A PACKAGE WAS BUILT, to the second, as a file name can carry it.
 *
 * ── WHY THE SECOND AND NOT THE DAY ──
 *
 * The first version stamped the DATE, and a click-through on production found
 * what that costs: two builds of the same bid downloaded as the same name, and
 * the browser silently appended `(1)`. The failure is quiet and specific —
 * build a package, notice a wrong attachment, rebuild, then upload the FIRST
 * one to the GC portal, because both are sitting in Downloads under names that
 * differ by a character nobody reads.
 *
 * Minutes would not have fixed it. The rebuild in that story happens twenty
 * seconds after the mistake is spotted, which is inside the same minute.
 *
 * LOCAL TIME, not UTC: this is the only string in this product that is a label
 * for a human's own filing rather than a stored instant, and "the package I
 * built after lunch" has to sort where they expect. The app's standing rule —
 * dates stored at UTC midnight and rendered in UTC — is about data, and nothing
 * here is stored.
 */
export function packageStamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}

/**
 * What the package is called when it lands in somebody's downloads.
 *
 * The project and the moment, because a GC portal's upload field and an email
 * attachment both show a file name and "package.pdf" is what three bids in a
 * row look like. Punctuation a file system or an upload form would argue about
 * is replaced rather than stripped, so two different projects cannot collapse
 * to the same name.
 *
 * `stamp` comes from `packageStamp` AT THE MOMENT OF THE PRESS, never from the
 * page render. A stamp taken when the page loaded would be identical for every
 * build made from that page, which is precisely the case this is here to stop.
 */
export function packageFileName(projectName: string, stamp: string): string {
  const safe = projectName
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${safe || "bid"}-${stamp}-bid-package.pdf`;
}
