import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agreementRate,
  auditTargets,
  classifyOutcome,
  planFilesUnder,
  printedScaleFromTitleBlock,
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
  found: 30,
  agreed: 6,
  inheritedError: 0.00315,
  reason: null,
  widthPt: 3024,
  heightPt: 2160,
  ...over,
});

describe("reading a scale out of title-block text", () => {
  it("finds it among the sheet number, the date and the firm's address", () => {
    // A title block is a flattened run of its region's strings, which is what
    // `titleBlockText` hands over — the scale is in the middle of it.
    const text = "SECOND FLOOR PLAN   A-102   SCALE: 1/8\" = 1'-0\"   ISSUED 2026-09-14   SOME ARCHITECTS LLP";
    expect(printedScaleFromTitleBlock(text)).toBe('1/8" = 1\'-0"');
  });

  it("reads the unspaced form and the typographic prime marks", () => {
    expect(printedScaleFromTitleBlock(`SCALE 1/4"=1'-0"`)).toBe('1/4" = 1\'-0"');
    expect(printedScaleFromTitleBlock(`SCALE: 1/4″ = 1′-0″`)).toBe('1/4" = 1\'-0"');
  });

  it("reads a three-place fraction", () => {
    expect(printedScaleFromTitleBlock(`SCALE: 3/32" = 1'-0"`)).toBe('3/32" = 1\'-0"');
  });

  it("SKIPS `AS NOTED` AND TAKES THE REAL SCALE BESIDE IT", () => {
    // A sheet carrying both should yield the real one, and the reason this works
    // is that `standardScaleFromText` already answers null for `AS NOTED` —
    // reused rather than re-decided here.
    expect(printedScaleFromTitleBlock(`SCALE: AS NOTED   1/4" = 1'-0"`)).toBe('1/4" = 1\'-0"');
  });

  it("answers null for a sheet that states no scale", () => {
    expect(printedScaleFromTitleBlock("UPPER LEVEL FLOOR PLAN   A-102   SOME ARCHITECTS LLP")).toBeNull();
    expect(printedScaleFromTitleBlock("SCALE: NTS")).toBeNull();
    expect(printedScaleFromTitleBlock("SCALE: AS NOTED")).toBeNull();
    expect(printedScaleFromTitleBlock(null)).toBeNull();
    expect(printedScaleFromTitleBlock("")).toBeNull();
  });

  it("answers null for a metric ratio rather than guessing an imperial one", () => {
    expect(printedScaleFromTitleBlock("SCALE 1:100")).toBeNull();
  });

  it("is not fooled by a date or a revision number", () => {
    expect(printedScaleFromTitleBlock("REV 3   ISSUED 09/14/2026   SHEET 2 OF 48")).toBeNull();
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
      page({ outcome: "MISSED" }),
      page({ outcome: "DECLINED" }),
      page({ outcome: "ERROR" }),
    ];
    const s = summarise(pages);
    expect(s.pages).toBe(6);
    expect(s.AGREES + s.DISAGREES + s.NO_TITLE_SCALE + s.MISSED + s.DECLINED + s.ERROR).toBe(6);
  });

  it("reports zeroes rather than gaps for an empty run", () => {
    const s = summarise([]);
    expect(s).toEqual({ pages: 0, AGREES: 0, DISAGREES: 0, NO_TITLE_SCALE: 0, MISSED: 0, DECLINED: 0, ERROR: 0 });
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
    expect(classifyOutcome(EIGHTH, EIGHTH)).toBe("AGREES");
  });

  it("DISAGREES when they name different ones — the row to open", () => {
    expect(classifyOutcome(EIGHTH, QUARTER)).toBe("DISAGREES");
    expect(classifyOutcome(QUARTER, EIGHTH)).toBe("DISAGREES");
  });

  it("NO_TITLE_SCALE when it derived one and the sheet prints none", () => {
    expect(classifyOutcome(EIGHTH, null)).toBe("NO_TITLE_SCALE");
  });

  it("MISSED when the sheet PRINTS a scale and the geometry declined", () => {
    // There was an answer on the sheet and it was not found. The only kind of
    // decline that counts against the headline.
    expect(classifyOutcome(null, EIGHTH)).toBe("MISSED");
  });

  it("DECLINED when neither found anything — usually the right answer", () => {
    expect(classifyOutcome(null, null)).toBe("DECLINED");
  });

  it("keeps MISSED and DECLINED distinct, which is the whole point of both", () => {
    expect(classifyOutcome(null, EIGHTH)).not.toBe(classifyOutcome(null, null));
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
