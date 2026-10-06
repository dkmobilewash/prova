import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agreementRate,
  auditTargets,
  classifyOutcome,
  planFilesUnder,
  printedScalesOnPage,
  summarise,
  type AuditPage,
} from "./scaleAudit";

/**
 * The audit's own arithmetic, which is the part that decides what a run MEANS.
 *
 * The run itself needs real drawings and lives in `scaleAudit.eval.ts`, skipped
 * unless somebody points it at files. What is testable here is how the two
 * readings are classified and how the headline is computed — and getting that
 * wrong would make a bad result look good, which is worse than no result.
 */

const page = (over: Partial<AuditPage> = {}): AuditPage => ({
  file: "A-102.pdf",
  pageNumber: 1,
  outcome: "AGREES",
  derived: '1/8" = 1\'-0"',
  printed: '1/8" = 1\'-0"',
  printedAll: ['1/8" = 1\'-0"'],
  found: 30,
  agreed: 6,
  inheritedError: 0.00315,
  reason: null,
  widthPt: 3024,
  heightPt: 2160,
  ...over,
});

/** Text items as `planPdf` reports them, which is all this function reads. */
const items = (...strs: string[]) => strs.map((str) => ({ str }));

describe("reading the scales printed on a page", () => {
  it("finds one in a title block, among the sheet number and the firm's address", () => {
    expect(
      printedScalesOnPage(items("SECOND FLOOR PLAN", "A-102", "SCALE: 1/8\" = 1'-0\"", "SOME ARCHITECTS LLP")),
    ).toEqual(['1/8" = 1\'-0"']);
  });

  it("FINDS ONE CAPTIONED UNDER A VIEW, which is where a real sheet put it", () => {
    // The defect this replaced: a real export printed `1/4" = 1'-0"` at x=958 on
    // a 3,024pt page — beneath the drawing, nowhere near the title-block corner
    // — while its block said `SCALE: AS NOTED`. Looking only in the corner read
    // that sheet as having no answer key at all.
    expect(printedScalesOnPage(items("ENLARGED PLAN", `1/4" = 1'-0"`, "SCALE: AS NOTED"))).toEqual([
      '1/4" = 1\'-0"',
    ]);
  });

  it("reads the unspaced form and the typographic prime marks", () => {
    expect(printedScalesOnPage(items(`SCALE 1/4"=1'-0"`))).toEqual(['1/4" = 1\'-0"']);
    expect(printedScalesOnPage(items(`SCALE: 1/4″ = 1′-0″`))).toEqual(['1/4" = 1\'-0"']);
  });

  it("reads a three-place fraction", () => {
    expect(printedScalesOnPage(items(`SCALE: 3/32" = 1'-0"`))).toEqual(['3/32" = 1\'-0"']);
  });

  it("RETURNS BOTH when a sheet carries a plan AND an enlarged detail", () => {
    // Both correct. Picking one would manufacture an agreement, which is the one
    // thing an audit must not do.
    const found = printedScalesOnPage(items("PLAN", `1/8" = 1'-0"`, "ENLARGED", `1/2" = 1'-0"`));
    expect(found).toHaveLength(2);
    expect(found).toContain('1/8" = 1\'-0"');
    expect(found).toContain('1/2" = 1\'-0"');
  });

  it("reports one entry when the SAME scale is captioned twice", () => {
    expect(printedScalesOnPage(items(`1/4" = 1'-0"`, `1/4" = 1'-0"`))).toHaveLength(1);
  });

  it("IGNORES A GENERAL NOTE THAT STATES A SCALE, which is what the length filter is for", () => {
    // The mutation that found this: dropping the length filter leaves the
    // disclaimer below harmless, because it holds no `X = Y` figure. THIS
    // sentence does, it is ordinary on an ordinary sheet, and without the filter
    // it becomes a second printed scale — turning a checkable page into
    // `MANY_PRINTED` and costing the audit its answer key.
    const note = `DETAILS ARE DRAWN AT 1/2" = 1'-0" UNLESS NOTED OTHERWISE ON THE SHEET`;
    expect(note.length).toBeGreaterThan(60);
    expect(printedScalesOnPage(items(note))).toEqual([]);
    // And the caption beside it is still read.
    expect(printedScalesOnPage(items(note, `1/4" = 1'-0"`))).toEqual(['1/4" = 1\'-0"']);
  });

  it("IGNORES A PARAGRAPH THAT MENTIONS SCALE, which a real sheet carries", () => {
    // Verbatim from a real title block: a disclaimer about not scaling off
    // prints. Prose, however much it says "scale".
    const disclaimer =
      "This Drawing is the property of H.G.B.D., INTERNATIONAL and is not to be reproduced or copied in " +
      "whole or in part. Do not scale dimensions from prints. plans and details are not always drawn to " +
      "scale. Use dimensions given or consult the Architect for further clarification.";
    expect(printedScalesOnPage(items(disclaimer))).toEqual([]);
  });

  it("finds nothing where a sheet states no scale", () => {
    expect(printedScalesOnPage(items("UPPER LEVEL FLOOR PLAN", "A-102"))).toEqual([]);
    expect(printedScalesOnPage(items("SCALE: NTS"))).toEqual([]);
    expect(printedScalesOnPage(items("SCALE: AS NOTED"))).toEqual([]);
    expect(printedScalesOnPage([])).toEqual([]);
  });

  it("finds nothing for a metric ratio rather than guessing an imperial one", () => {
    expect(printedScalesOnPage(items("SCALE 1:100"))).toEqual([]);
  });

  it("is not fooled by a date, a revision or a sheet count", () => {
    expect(printedScalesOnPage(items("REV 3", "ISSUED 09/14/2026", "SHEET 2 OF 48"))).toEqual([]);
  });
});

describe("the headline: agreement where both readings exist", () => {
  it("counts only the pages that had something to check", () => {
    const rate = agreementRate([
      page({ outcome: "AGREES" }),
      page({ outcome: "AGREES" }),
      page({ outcome: "AGREES" }),
      page({ outcome: "DISAGREES" }),
    ]);
    expect(rate).toBeCloseTo(0.75, 5);
  });

  it("EXCLUDES `NO_TITLE_SCALE`, because there was nothing to be right about", () => {
    // Counting it either way would move the headline for a reason that is not
    // about accuracy. A sheet printing no scale cannot check this feature.
    const withNone = agreementRate([
      page({ outcome: "AGREES" }),
      page({ outcome: "DISAGREES" }),
      ...Array.from({ length: 50 }, () => page({ outcome: "NO_TITLE_SCALE", printed: null })),
    ]);
    expect(withNone).toBeCloseTo(0.5, 5);
  });

  it("COUNTS A MISS AGAINST IT, because an answer existed and was not found", () => {
    // `MISSED` is the title block naming a scale the geometry declined to find.
    // Excluding it would let a reader that refuses everything score 100%.
    const rate = agreementRate([page({ outcome: "AGREES" }), page({ outcome: "MISSED", derived: null })]);
    expect(rate).toBeCloseTo(0.5, 5);
  });

  it("excludes `DECLINED`, where neither reading found anything", () => {
    const rate = agreementRate([page({ outcome: "AGREES" }), page({ outcome: "DECLINED", derived: null, printed: null })]);
    expect(rate).toBe(1);
  });

  it("IS NULL RATHER THAN 100% WHEN NOTHING WAS CHECKABLE", () => {
    // The real export's own case. "100% of nothing" is the number that would
    // ship a feature on no evidence.
    expect(agreementRate([page({ outcome: "NO_TITLE_SCALE", printed: null })])).toBeNull();
    expect(agreementRate([])).toBeNull();
  });

  it("is null when every page errored, rather than reporting a clean run", () => {
    expect(agreementRate([page({ outcome: "ERROR" }), page({ outcome: "ERROR" })])).toBeNull();
  });
});

describe("the summary", () => {
  it("puts every page in exactly one bucket", () => {
    const pages = [
      page({ outcome: "AGREES" }),
      page({ outcome: "DISAGREES" }),
      page({ outcome: "NO_TITLE_SCALE" }),
      page({ outcome: "MANY_PRINTED" }),
      page({ outcome: "MISSED" }),
      page({ outcome: "DECLINED" }),
      page({ outcome: "ERROR" }),
    ];
    const s = summarise(pages);
    expect(s.pages).toBe(7);
    expect(
      s.AGREES + s.DISAGREES + s.NO_TITLE_SCALE + s.MANY_PRINTED + s.MISSED + s.DECLINED + s.ERROR,
    ).toBe(7);
  });

  it("reports zeroes rather than gaps for an empty run", () => {
    const s = summarise([]);
    expect(s).toEqual({
      pages: 0,
      AGREES: 0,
      DISAGREES: 0,
      NO_TITLE_SCALE: 0,
      MANY_PRINTED: 0,
      MISSED: 0,
      DECLINED: 0,
      ERROR: 0,
    });
  });
});

/**
 * THE JUDGEMENT ITSELF, which was untested until a mutation said so.
 *
 * Flipping `DISAGREES` to `AGREES` inside `auditPlanFile` — the audit calling a
 * wrong scale right, the one thing it exists to notice — left the whole suite
 * GREEN, because every test above reaches the arithmetic and none reached the
 * classification. So it came out of that function and into this table.
 */
describe("what two readings make", () => {
  const EIGHTH = '1/8" = 1\'-0"';
  const QUARTER = '1/4" = 1\'-0"';

  it("AGREES only when the two name the SAME scale", () => {
    expect(classifyOutcome(EIGHTH, [EIGHTH])).toBe("AGREES");
  });

  it("DISAGREES when they name different ones — the row to open", () => {
    expect(classifyOutcome(EIGHTH, [QUARTER])).toBe("DISAGREES");
    expect(classifyOutcome(QUARTER, [EIGHTH])).toBe("DISAGREES");
  });

  it("NO_TITLE_SCALE when it derived one and the sheet prints none", () => {
    expect(classifyOutcome(EIGHTH, [])).toBe("NO_TITLE_SCALE");
  });

  it("MISSED when the sheet PRINTS a scale and the geometry declined", () => {
    // There was an answer on the sheet and it was not found. The only kind of
    // decline that counts against the headline.
    expect(classifyOutcome(null, [EIGHTH])).toBe("MISSED");
  });

  it("DECLINED when neither found anything — usually the right answer", () => {
    expect(classifyOutcome(null, [])).toBe("DECLINED");
  });

  it("keeps MISSED and DECLINED distinct, which is the whole point of both", () => {
    expect(classifyOutcome(null, [EIGHTH])).not.toBe(classifyOutcome(null, []));
  });
});

/**
 * FINDING THE FILES, which is tested because a mutation showed what happens when
 * it silently finds none: a run with no pages, no disagreements and a clean
 * summary, which reads exactly like a good result. A typo in a folder name is
 * all it takes, and that is this repo's most expensive recurring shape.
 */
describe("which files a run reads", () => {
  function aFolder(names: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "scale-audit-"));
    for (const name of names) writeFileSync(join(dir, name), "%PDF-1.4\n");
    return dir;
  }

  it("finds every PDF in a folder, in a stable order", () => {
    const dir = aFolder(["A-102.pdf", "A-101.pdf", "A-103.PDF"]);
    expect(planFilesUnder([dir]).map((f) => f.split("/").pop())).toEqual(["A-101.pdf", "A-102.pdf", "A-103.PDF"]);
  });

  it("ignores everything that is not a PDF", () => {
    const dir = aFolder(["A-101.pdf", "notes.txt", "thumbs.db", "spec.docx"]);
    expect(planFilesUnder([dir])).toHaveLength(1);
  });

  it("takes a single file as well as a folder", () => {
    const dir = aFolder(["A-101.pdf"]);
    expect(planFilesUnder([join(dir, "A-101.pdf")])).toHaveLength(1);
  });

  it("RETURNS NOTHING FOR A PATH THAT DOES NOT EXIST, rather than throwing", () => {
    // Nothing, so the caller's count check turns it into a visible refusal —
    // and the caller must have one, which is why this returns rather than
    // throwing here.
    expect(planFilesUnder(["/no/such/folder/at/all"])).toEqual([]);
  });

  it("returns nothing for a folder with no PDFs in it", () => {
    expect(planFilesUnder([aFolder(["readme.txt"])])).toEqual([]);
  });

  it("does not descend into subfolders, since a bid package is flat", () => {
    const dir = aFolder(["A-101.pdf"]);
    mkdirSync(join(dir, "deeper"));
    writeFileSync(join(dir, "deeper", "A-999.pdf"), "%PDF-1.4\n");
    expect(planFilesUnder([dir])).toHaveLength(1);
  });

  it("expands `~`, which a shell does not inside a quoted variable", () => {
    const dir = aFolder(["A-101.pdf"]);
    const found = planFilesUnder(["~/A-101.pdf"], dir);
    expect(found).toEqual([join(dir, "A-101.pdf")]);
  });

  it("takes several paths at once and keeps them all", () => {
    const one = aFolder(["A-101.pdf"]);
    const two = aFolder(["S-201.pdf"]);
    expect(planFilesUnder([one, two])).toHaveLength(2);
  });
});

describe("splitting what the operator typed", () => {
  it("takes a comma-separated list and a pasted newline list", () => {
    expect(auditTargets("/a.pdf,/b.pdf")).toEqual(["/a.pdf", "/b.pdf"]);
    expect(auditTargets("/a.pdf\n/b.pdf\n")).toEqual(["/a.pdf", "/b.pdf"]);
  });

  it("trims, and drops the empties a trailing comma leaves", () => {
    expect(auditTargets("  /a.pdf , , /b.pdf  ")).toEqual(["/a.pdf", "/b.pdf"]);
  });

  it("gives nothing for nothing, which is what makes the run SKIP", () => {
    expect(auditTargets("")).toEqual([]);
    expect(auditTargets("   ")).toEqual([]);
  });
});

describe("a sheet that prints more than one scale", () => {
  const EIGHTH = '1/8" = 1\'-0"';
  const HALF = '1/2" = 1\'-0"';

  it("IS MANY_PRINTED RATHER THAN CHERRY-PICKED, however well one of them matches", () => {
    // A plan and an enlarged detail on one sheet, both correct. Taking whichever
    // matched the derivation would manufacture an agreement, and a mutation that
    // did exactly that passed a suite written for this feature.
    expect(classifyOutcome(EIGHTH, [EIGHTH, HALF])).toBe("MANY_PRINTED");
    expect(classifyOutcome(HALF, [EIGHTH, HALF])).toBe("MANY_PRINTED");
  });

  it("is MANY_PRINTED even when the geometry declined", () => {
    expect(classifyOutcome(null, [EIGHTH, HALF])).toBe("MANY_PRINTED");
  });

  it("is kept out of the headline, like NO_TITLE_SCALE", () => {
    // There is no single answer key, so agreement is not a thing that can be
    // measured on such a page.
    const rate = agreementRate([
      page({ outcome: "AGREES" }),
      page({ outcome: "MANY_PRINTED", printedAll: [EIGHTH, HALF] }),
    ]);
    expect(rate).toBe(1);
  });
});
