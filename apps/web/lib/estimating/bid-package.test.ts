import { describe, expect, it } from "vitest";
import {
  PACKAGE_MAX_BYTES,
  PACKAGE_SLOTS,
  PACKAGE_SLOT_LABEL,
  SKIP_SENTENCE,
  buildPackage,
  isEncryptedPdfError,
  looksLikePdf,
  packageFileName,
  packageStamp,
  planPackage,
  type PackagePart,
} from "./bid-package";
import { planSetPdf, sheetOf } from "../plan-ingest/planFixtures";

/**
 * ASSEMBLING A BID PACKAGE.
 *
 * ── THE FIXTURES ARE REAL PDFs AND THERE IS NO BINARY IN THE TREE ──
 *
 * `planFixtures.planSetPdf` writes real multi-page PDFs from placed text, and
 * it exists because customer plan sets, specs and quotes are confidential and
 * *"never use real customer files in tests or fixtures"*. A bid package is made
 * of the most confidential documents this product touches, so the same rule
 * applies with more force: every byte below is generated at run time and every
 * word in it is invented.
 *
 * That writer is also the reason this suite can prove a MERGE rather than
 * assert about one — pdf-lib reads back what another writer produced, which is
 * the real thing the feature does to a GC's form.
 */

/** A real PDF of `pages` pages, each carrying its own text so a merged file can
 *  be checked for having kept the right ones. */
function pdfOf(label: string, pages: number): Uint8Array {
  return new Uint8Array(
    planSetPdf(
      Array.from({ length: pages }, (_, index) =>
        sheetOf({ block: [`${label} page ${index + 1}`] }),
      ),
    ),
  );
}

const part = (over: Partial<PackagePart> & { slot: PackagePart["slot"] }): PackagePart => ({
  name: `${over.slot}.pdf`,
  bytes: pdfOf(over.slot, 1),
  ...over,
});

describe("the slots are a complete, labelled list", () => {
  it("labels every slot, so one added cannot reach a screen unnamed", () => {
    for (const slot of PACKAGE_SLOTS) {
      expect(PACKAGE_SLOT_LABEL[slot].label.length).toBeGreaterThan(0);
      expect(PACKAGE_SLOT_LABEL[slot].covers.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PACKAGE_SLOT_LABEL)).toHaveLength(PACKAGE_SLOTS.length);
  });

  it("PUTS THE GC'S OWN FORM FIRST", () => {
    // Not cosmetic. On public work the GC's form is what decides whether a bid
    // is responsive, and it is the page they open. The proposal comes after it.
    expect(PACKAGE_SLOTS[0]).toBe("GC_BID_FORM");
    expect(PACKAGE_SLOTS.indexOf("PROPOSAL")).toBeLessThan(PACKAGE_SLOTS.indexOf("SCOPE_SHEET"));
    expect(PACKAGE_SLOTS.indexOf("SCOPE_SHEET")).toBeLessThan(PACKAGE_SLOTS.indexOf("CUT_SHEETS"));
  });

  it("gives every skip reason a sentence", () => {
    for (const sentence of Object.values(SKIP_SENTENCE)) expect(sentence.length).toBeGreaterThan(0);
  });
});

describe("what goes in, and in what order", () => {
  it("orders by slot regardless of the order they were handed over", () => {
    const plan = planPackage([
      part({ slot: "CUT_SHEETS" }),
      part({ slot: "PROPOSAL" }),
      part({ slot: "GC_BID_FORM" }),
    ]);
    expect(plan.include.map((one) => one.slot)).toEqual(["GC_BID_FORM", "PROPOSAL", "CUT_SHEETS"]);
  });

  it("KEEPS THE PERSON'S OWN ORDER WITHIN A SLOT", () => {
    // Three cut sheets picked in a deliberate order stay in it. The slot list
    // decides which GROUP leads, never how somebody's own attachments sort.
    const plan = planPackage([
      part({ slot: "CUT_SHEETS", name: "studs.pdf" }),
      part({ slot: "CUT_SHEETS", name: "board.pdf" }),
      part({ slot: "CUT_SHEETS", name: "sealant.pdf" }),
    ]);
    expect(plan.include.map((one) => one.name)).toEqual(["studs.pdf", "board.pdf", "sealant.pdf"]);
  });

  it("names a part somebody listed and did not supply, rather than dropping it", () => {
    // A missing bid form is why a bid gets rejected, so silence is the one
    // unacceptable answer here.
    const plan = planPackage([part({ slot: "GC_BID_FORM", name: "AIA form", bytes: null })]);
    expect(plan.include).toHaveLength(0);
    expect(plan.skip).toEqual([{ slot: "GC_BID_FORM", name: "AIA form", reason: "NO_FILE" }]);
  });

  it("refuses a file that is not a PDF, whatever it is called", () => {
    const notPdf = new TextEncoder().encode("PK\u0003\u0004 this is a zip");
    const plan = planPackage([part({ slot: "CUT_SHEETS", name: "data.pdf", bytes: notPdf })]);
    expect(plan.skip[0]).toMatchObject({ name: "data.pdf", reason: "NOT_A_PDF" });
  });

  it("refuses an empty file separately from a wrong one", () => {
    const plan = planPackage([part({ slot: "PROPOSAL", bytes: new Uint8Array() })]);
    expect(plan.skip[0]!.reason).toBe("EMPTY");
  });

  it("names the part that crosses the size ceiling and keeps the rest", () => {
    // Reported per part rather than as "the package is too big", because the
    // person needs to know which file to leave out.
    const big = new Uint8Array(PACKAGE_MAX_BYTES);
    big.set(new TextEncoder().encode("%PDF-"));
    const plan = planPackage([
      part({ slot: "GC_BID_FORM", name: "form.pdf" }),
      part({ slot: "CUT_SHEETS", name: "huge.pdf", bytes: big }),
    ]);
    expect(plan.include.map((one) => one.name)).toEqual(["form.pdf"]);
    expect(plan.skip).toEqual([{ slot: "CUT_SHEETS", name: "huge.pdf", reason: "TOO_LARGE" }]);
  });

  it("recognises a PDF by its bytes and not by its name", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe("the merge itself, on real PDFs", () => {
  it("keeps every page, in slot order, and says where each part starts", async () => {
    const built = await buildPackage(
      planPackage([
        part({ slot: "PROPOSAL", name: "proposal.pdf", bytes: pdfOf("PROPOSAL", 2) }),
        part({ slot: "GC_BID_FORM", name: "form.pdf", bytes: pdfOf("FORM", 1) }),
        part({ slot: "CUT_SHEETS", name: "studs.pdf", bytes: pdfOf("STUDS", 3) }),
      ]),
    );

    expect(built.totalPages).toBe(6);
    expect(built.entries).toEqual([
      { slot: "GC_BID_FORM", name: "form.pdf", pages: 1, startsOnPage: 1 },
      { slot: "PROPOSAL", name: "proposal.pdf", pages: 2, startsOnPage: 2 },
      { slot: "CUT_SHEETS", name: "studs.pdf", pages: 3, startsOnPage: 4 },
    ]);
    expect(built.skipped).toEqual([]);
  });

  it("produces a PDF that opens, which is the only claim worth making", async () => {
    const built = await buildPackage(planPackage([part({ slot: "PROPOSAL", bytes: pdfOf("P", 2) })]));
    expect(built.bytes).not.toBeNull();
    expect(looksLikePdf(built.bytes!)).toBe(true);
    // Read back by the library rather than trusting the writer: a merge that
    // emits bytes nothing can parse is the failure this feature cannot have.
    const { PDFDocument } = await import("pdf-lib");
    const reopened = await PDFDocument.load(built.bytes!);
    expect(reopened.getPageCount()).toBe(2);
  });

  it("DROPS ONE CORRUPT PART AND BUILDS THE REST", async () => {
    // Half an hour before a deadline, one bad cut sheet must not cost the
    // package. It is skipped, named, and everything else is assembled.
    const corrupt = new TextEncoder().encode("%PDF-1.7\nnot really a pdf body");
    const built = await buildPackage(
      planPackage([
        part({ slot: "GC_BID_FORM", name: "form.pdf", bytes: pdfOf("FORM", 1) }),
        part({ slot: "CUT_SHEETS", name: "broken.pdf", bytes: corrupt }),
      ]),
    );
    expect(built.entries.map((one) => one.name)).toEqual(["form.pdf"]);
    expect(built.skipped).toEqual([
      { slot: "CUT_SHEETS", name: "broken.pdf", reason: "UNREADABLE" },
    ]);
    expect(built.totalPages).toBe(1);
  });

  it("SKIPS A PART THAT FAILS TO OPEN AT ALL, not just one that fails to copy", async () => {
    // ── A MUTATION GOT PAST THIS SUITE, WHICH IS WHY THIS CASE EXISTS ──
    //
    // There are TWO ways a part fails: `PDFDocument.load` throws, or it loads
    // and `copyPages` throws. The corrupt fixture above takes the SECOND path —
    // measured, by printing the reason — so changing the first path's reason to
    // anything at all left every test green. `%PDF-` alone passes the magic
    // number check and then fails at load, which is the first path.
    const built = await buildPackage(
      planPackage([part({ slot: "CUT_SHEETS", name: "stub.pdf", bytes: new TextEncoder().encode("%PDF-") })]),
    );
    expect(built.skipped).toEqual([
      { slot: "CUT_SHEETS", name: "stub.pdf", reason: "UNREADABLE" },
    ]);
  });

  it("calls a password-protected PDF password-protected", async () => {
    // ── THE BRANCH THAT WAS DEAD CODE, AND HOW IT IS REACHED ──
    //
    // This was written as `error.name === "EncryptedPDFError"`, which can never
    // be true: pdf-lib ships ES5 and its error classes go through tslib's
    // `__extends`, which never assigns `name`, so it inherits `"Error"`. An
    // encrypted cut sheet would have been reported as unreadable, sending
    // somebody to look for a corrupt file instead of asking the manufacturer
    // for an unlocked one.
    //
    // Asserted against a REAL instance of the library's own error, because
    // nothing here can write an encrypted PDF: pdf-lib cannot, and a
    // hand-written `/Encrypt` trailer is rejected as malformed before the
    // encryption check — which would prove the branch above instead of this
    // one. `bid-package.ts` records that bound.
    const { EncryptedPDFError } = await import("pdf-lib");
    const error: unknown = new EncryptedPDFError();

    // ── NEITHER OBVIOUS CHECK WORKS, AND THIS IS WHERE THAT IS PINNED ──
    //
    // pdf-lib ships ES5 and builds its errors through tslib's `__extends`,
    // whose body is `_this = _super.call(this, msg) || this; return _this`.
    // `Error.call(this, msg)` returns a FRESH error instead of mutating `this`,
    // so the constructor hands back a plain Error: the subclass does not exist
    // at run time. Both of these assertions failed as production code first —
    // the name version shipped, the instanceof version was caught by this test.
    expect((error as Error).name).toBe("Error");
    expect(error instanceof EncryptedPDFError).toBe(false);

    // So the MESSAGE is the only identifier, and the library's own literal is
    // pinned here. An upgrade that rewords it fails this test rather than
    // silently reclassifying every locked PDF as corrupt.
    expect((error as Error).message).toContain("is encrypted");
    expect((error as Error).message).toBe(
      "Input document to `PDFDocument.load` is encrypted. You can use " +
        "`PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.",
    );

    // ── AND THE CLASSIFIER ITSELF, BECAUSE THE ASSERTIONS ABOVE DID NOT ──
    //
    // Everything above is a fact about pdf-lib. A mutation reverting this
    // module's own check to either dead version — the name match, or a bare
    // `return false` — left all of it GREEN, because none of it CALLS the
    // function under test. That is this repo's own rule arriving as a mistake:
    // a census proves the string exists, never that anything computes it; pin
    // the derivation.
    expect(isEncryptedPdfError(error)).toBe(true);
    expect(isEncryptedPdfError(new Error("something else went wrong"))).toBe(false);
    expect(isEncryptedPdfError("not an error")).toBe(false);
    expect(isEncryptedPdfError(null)).toBe(false);

    // And the sentence a person reads has to name the actual problem, or the
    // branch is correct and useless.
    expect(SKIP_SENTENCE.ENCRYPTED).toMatch(/password/i);
  });

  it("carries the plan's own skips through to the built package", async () => {
    const built = await buildPackage(
      planPackage([
        part({ slot: "GC_BID_FORM", name: "form.pdf" }),
        part({ slot: "PROPOSAL", name: "proposal.pdf", bytes: null }),
      ]),
    );
    expect(built.skipped).toEqual([{ slot: "PROPOSAL", name: "proposal.pdf", reason: "NO_FILE" }]);
  });

  it("RETURNS NO FILE when nothing is usable, rather than a blank page", async () => {
    // ── MEASURED, AND THE LIBRARY DOES THE OPPOSITE OF THE OBVIOUS THING ──
    //
    // `PDFDocument.create()` reports 0 pages and `save()` on it emits a
    // 583-byte ONE-PAGE document. So the first version of this returned a
    // blank PDF called `…-bid-package.pdf`, which an estimator could have sent
    // to a general contractor. Null is the only safe answer, and it is the
    // screen's job to say why — a throw would reach production as a redacted
    // digest instead of "no file was attached".
    const built = await buildPackage(planPackage([part({ slot: "PROPOSAL", bytes: null })]));
    expect(built.bytes).toBeNull();
    expect(built.totalPages).toBe(0);
    expect(built.entries).toEqual([]);
    expect(built.skipped).toHaveLength(1);
  });

  it("and the same when every part is corrupt rather than missing", async () => {
    const corrupt = new TextEncoder().encode("%PDF-1.7\nnot really a pdf body");
    const built = await buildPackage(
      planPackage([part({ slot: "CUT_SHEETS", name: "broken.pdf", bytes: corrupt })]),
    );
    expect(built.bytes).toBeNull();
    expect(built.skipped).toHaveLength(1);
  });
});

describe("when it was built", () => {
  // ── THE DEFECT THIS PINS WAS FOUND BY CLICKING PRODUCTION ──
  //
  // The stamp was the DATE. A tester built the package, added a file, built it
  // again, and both landed in Downloads as the same name with the browser
  // quietly appending `(1)`. The quiet part is the danger: the next step is
  // uploading one of them to a GC portal.

  it("goes to the SECOND, because the rebuild happens within the minute", () => {
    const at = new Date(2026, 9, 14, 14, 32, 7);
    expect(packageStamp(at)).toBe("2026-10-14-143207");
  });

  it("gives two builds twenty seconds apart two different names", () => {
    // Exactly the story above: spot the mistake, fix it, build again.
    const first = packageStamp(new Date(2026, 9, 14, 14, 32, 7));
    const second = packageStamp(new Date(2026, 9, 14, 14, 32, 27));
    expect(first).not.toBe(second);
    expect(packageFileName("West Herr Jaguar", first)).not.toBe(
      packageFileName("West Herr Jaguar", second),
    );
  });

  it("pads every field, so names sort in the order they were built", () => {
    expect(packageStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02-030405");
  });

  it("carries no character a file system or an upload form argues about", () => {
    const name = packageFileName("West Herr Jaguar", packageStamp(new Date(2026, 9, 14, 14, 32, 7)));
    // A colon is illegal in a Windows file name and a space is what turns an
    // attachment into `West%20Herr` in somebody's portal.
    expect(name).not.toMatch(/[:\s]/);
    expect(name).toMatch(/^[A-Za-z0-9.-]+$/);
  });
});

describe("what the file is called", () => {
  it("names the project and the moment", () => {
    expect(packageFileName("West Herr Jaguar", "2026-10-14-143207")).toBe(
      "West-Herr-Jaguar-2026-10-14-143207-bid-package.pdf",
    );
  });

  it("replaces punctuation rather than stripping it, so two projects cannot collide", () => {
    expect(packageFileName("Tower A/B", "2026-10-14-143207")).not.toBe(
      packageFileName("Tower AB", "2026-10-14-143207"),
    );
  });

  it("still produces a name for a project called nothing a file system likes", () => {
    expect(packageFileName("///", "2026-10-14-143207")).toBe("bid-2026-10-14-143207-bid-package.pdf");
  });
});
