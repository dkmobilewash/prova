import { describe, expect, it } from "vitest";
import { parseSubListing } from "./parse";

/**
 * THE PARTITION, OVER TWENTY THOUSAND GENERATED LISTINGS RATHER THAN EIGHTEEN
 * FIXTURES.
 *
 * `parse.test.ts` asserts the partition — four buckets summing to the non-blank
 * line count — across `SUB_LISTING_CASES`. That is 18 documents and 26 rows, and
 * it is the right corpus for asking whether a line lands in the RIGHT bucket,
 * because each fixture is a document somebody looked at.
 *
 * It is a thin corpus for asking whether a line lands in ANY bucket, which is a
 * property of arbitrary text rather than of a document. And that is the guarantee
 * this reader's own header calls its central one — *"nothing VANISHES"* — the
 * guarantee that has been FALSE twice: once when a row with no numeric token
 * dropped out with `agreed: true`, and once when `TOTAL_LINE` matched a whole
 * line and took a real California contractor with it.
 *
 * So this generates listings instead: header lines in and out of place, rows with
 * cells missing, five delimiter styles, blank lines, page furniture, money and
 * percentage lines, names that normalise to nothing (though see the blank-name case
 * below: `"Inc."` is one of them and the reader accepts it), licences of every shape the
 * repo has seen refused.
 *
 * ── WHAT IT DOES NOT CLAIM ──
 *
 * Exactly what the module header says the partition does not prove: nothing about
 * whether a line is in the bucket it BELONGS in. A confident wrong bucket loses a
 * subcontractor as thoroughly as no bucket at all, and that half is
 * `hasDataEvidence` plus the converse cases in `parse.test.ts`. This is the other
 * half, and only the other half.
 *
 * ── AND THE SHAPES IT CANNOT REACH, WHICH MATTERS MORE THAN IT LOOKS ──
 *
 * **None of the generated documents reaches the numbered-box reader, the
 * labelled-column reader, or the generic form refusal.** Those are the three early
 * returns in `parseSubListing`, and they are the only places where `accountedFor` is
 * deliberately NOT the sum of the four reported buckets — a labelled form reports
 * `accountedFor: form.ignored.length` while still returning rows. So two of the
 * properties below are false BY CONSTRUCTION on those paths, and this file both fails
 * to cover them and would go red on correct code if the generator ever produced one.
 * Measured, not assumed: a review censused all 6,000 and found zero.
 *
 * That gap is not cosmetic. The labelled-column reader is where two rows share a
 * line, and the defect that cost this branch a day — a multi-bidder form that could
 * be read and never imported — lived in exactly the shape no corpus here contains.
 * A generator for those forms is worth writing; it is a different generator, because
 * the invariant it would assert is a different invariant.
 *
 * Deterministic: one seed, so a failure is reproducible rather than a story about
 * a run nobody can repeat.
 *
 * **6,000 documents in CI; verified at 20,000 before being committed at this size.**
 * Each of the three cases below walks the whole corpus, so 20,000 cost 6.9 s of
 * every CI run for input space nobody was going to read — 6,000 is still ~330x
 * the fixture corpus and runs in about two seconds. The larger run found nothing
 * the smaller one does not; if this ever goes red, raising `CASES` is the first
 * thing to try, since the seed makes the extra cases deterministic too.
 */
describe("the partition holds for arbitrary text, not just for the fixtures", () => {
  const CASES = 6000;

  function generate(count: number) {
    let seed = 20261005;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length) % xs.length];
    const chance = (p: number) => rnd() < p;

    const NAMES = ["Valley Interior Systems", "Acme Lath Systems, Inc.", "Northstate Drywall",
      "Summit Acoustics LLC", "Baker Plastering", "Sierra Wall & Ceiling", "Keystone Acoustical",
      "A", "", "   ", "&", "Inc.", "ACME DRYWALL INC"];
    const CITIES = ["Fontana, CA", "Riverside, CA", "Ontario CA", "Fontana", "", "Union City"];
    const LICS = ["C-9 884201", "C-35 650118", "884201", "92", "1162318", "88420199", "", "N/A", "Lic. 884201"];
    const REGS = ["1000012345", "2000099999", "", "PW-LR-1001079292", "394"];
    const SCOPES = ["Metal stud framing and drywall", "Lath and cement plaster", "Acoustical ceilings",
      "Fireproofing", "Interior finish carpentry", "", "Scope of work: trim",
      "Metal stud framing, drywall and"];
    const HEADERS = ["Project: Lincoln Elementary", "Agency: Riverside USD",
      "Prime Contractor: Swinerton Builders", "Bid Date: 2026-03-04", "Subcontractor List",
      "Name           City          License       Portion of Work"];
    const JUNK = ["Total Base Bid: $18,450,000", "Page 2 of 4", "-----",
      "NOTE: subject to approval", "", "   ", "\t", "Addendum No. 3 acknowledged", "1",
      "$1,250,000.00", "100%", "5%"];

    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const lines: string[] = [];
      for (let h = Math.floor(rnd() * 4); h > 0; h--) lines.push(pick(HEADERS));
      if (chance(0.7)) lines.push("");
      for (let r = 1 + Math.floor(rnd() * 8); r > 0; r--) {
        const cells = [pick(NAMES), pick(CITIES), pick(LICS), pick(REGS), pick(SCOPES)]
          .filter(() => chance(0.82));
        lines.push(cells.join(pick(["\t", "  ", "    ", " | ", "\t\t"])));
        if (chance(0.18)) lines.push(pick(JUNK));
        if (chance(0.08)) lines.push("");
      }
      if (chance(0.15)) lines.push(pick(JUNK));
      out.push(lines.join("\n"));
    }
    return out;
  }

  const listings = generate(CASES);

  /**
   * THE CONTROL, AND IT IS THE WHOLE DIFFERENCE BETWEEN A FUZZ RUN AND A FUZZ
   * RUN ABOUT NOTHING. A generator that emitted blank strings would satisfy every
   * assertion below — the partition is trivially true of a document with no lines.
   * So the corpus is required to actually exercise all four buckets and to produce
   * documents the reader objects to.
   *
   * ── IT USED TO ASSERT TOTALS, AND SIX DOCUMENTS SATISFIED IT ──
   *
   * Measured by a review: replacing all but SIX of the 6,000 with empty strings left
   * this control and both property cases green. `> 0` on a total is a floor of one
   * document per bucket, so the corpus could silently shrink by three orders of
   * magnitude with the whole file passing — and the file's whole claim is that it
   * walks 6,000.
   *
   * So the floor is a RATE now, per document rather than per corpus. The numbers are
   * deliberately well under what the generator produces (measured at baseline: 3.8
   * rows, 0.26 unread lines and 0.39 problems per document, and 51% agreeing) so an
   * ordinary generator change does not red it, while anything that stops exercising a
   * path does.
   */
  it("generates a corpus that reaches every bucket, at a rate rather than at all", () => {
    expect(listings).toHaveLength(CASES);
    let rows = 0, header = 0, ignored = 0, unread = 0, problems = 0, agreed = 0;
    for (const text of listings) {
      const r = parseSubListing(text);
      rows += r.reconciliation.rowsParsed;
      header += r.reconciliation.headerLines;
      ignored += r.reconciliation.ignoredLines;
      unread += r.reconciliation.unreadLines;
      problems += r.problems.length;
      if (r.reconciliation.agreed) agreed += 1;
    }
    /* A RATE PER DOCUMENT, not a total. Each floor is roughly a quarter of what the
       generator measures at, so this is a liveness check on the path rather than a
       pin on the generator's exact mix. */
    for (const [label, n, perDocument] of [
      ["rows", rows, 1],
      ["header", header, 0.5],
      ["ignored", ignored, 0.5],
      ["unread", unread, 0.05],
      ["problems", problems, 0.05],
      ["agreed", agreed, 0.1],
    ] as const) {
      expect(
        n / CASES,
        `the corpus produces ${n} ${label} across ${CASES} documents — under ${perDocument} each, this path is barely walked`,
      ).toBeGreaterThan(perDocument);
    }
    // And it is not uniformly clean either, or the unread/problem paths go unwalked.
    expect(agreed, "every generated document agreed — the corpus is too tidy").toBeLessThan(CASES);
  });

  it("never throws, and classifies every non-blank line exactly once", () => {
    const failures: string[] = [];
    for (const text of listings) {
      let parsed;
      try {
        parsed = parseSubListing(text);
      } catch (error) {
        failures.push(`threw ${String(error)} on ${JSON.stringify(text)}`);
        continue;
      }
      const r = parsed.reconciliation;
      const sum = r.rowsParsed + r.headerLines + r.ignoredLines + r.unreadLines;
      const trueNonBlank = text.split("\n").filter((line) => line.trim() !== "").length;

      if (r.nonBlankLines !== trueNonBlank) failures.push(`nonBlankLines ${r.nonBlankLines} != ${trueNonBlank} on ${JSON.stringify(text)}`);
      if (sum !== r.accountedFor) failures.push(`buckets sum to ${sum}, accountedFor ${r.accountedFor} on ${JSON.stringify(text)}`);
      if (r.accountedFor !== r.nonBlankLines) failures.push(`accountedFor ${r.accountedFor} != nonBlankLines ${r.nonBlankLines} on ${JSON.stringify(text)}`);
      if (r.rowsParsed !== parsed.rows.length) failures.push(`rowsParsed disagrees with rows.length on ${JSON.stringify(text)}`);
      if (r.unreadLines !== parsed.unread.length) failures.push(`unreadLines disagrees with unread.length on ${JSON.stringify(text)}`);
      if (r.ignoredLines !== parsed.ignored.length) failures.push(`ignoredLines disagrees with ignored.length on ${JSON.stringify(text)}`);

      const expectAgreed = r.accountedFor === r.nonBlankLines && r.unreadLines === 0 && parsed.problems.length === 0;
      if (r.agreed !== expectAgreed) failures.push(`agreed ${r.agreed} != ${expectAgreed} on ${JSON.stringify(text)}`);
    }
    // The first few, named, rather than a bare count — a seed and a document is
    // what makes a failure here actionable.
    expect(failures.slice(0, 3)).toEqual([]);
  });

  /**
   * A row is a company this app will CALL. One with no name is a row whose name
   * cell the reader lost, and it would reach the screen looking importable.
   *
   * ── WHAT THIS DOCSTRING CLAIMED, AND WHAT IT ACTUALLY ASSERTS ──
   *
   * It said the generator "includes names that normalise to nothing (`""`, `"   "`,
   * `"&"`, `"Inc."`) and asserts none of them becomes a row's name". The first half
   * is true and the second is FALSE, measured: **1,611 of the 22,714 generated rows
   * are named exactly `"Inc."`**, and this case is green over every one of them.
   * `isNameCandidate` wants three consecutive letters and `Inc` has them.
   *
   * What it asserts is narrower and still worth having: no row reaches the screen
   * with a BLANK name. Whether `Inc.` alone should be a lead is a product question
   * about `isNameCandidate` rather than about the partition, and answering it here
   * would be this file changing what it is for.
   *
   * ── AND IT IS THE WEAKEST CASE IN THIS FILE, SAID PLAINLY ──
   *
   * Review could not kill it from the name path: dropping the three-letter rule from
   * `isNameCandidate`, and breaking `fieldSpans`'s empty test, left it green
   * separately and together. The property is guaranteed one layer down — `fieldSpans`
   * trims every chunk and drops the empty ones, so every field reaching `readRow` is
   * a non-empty trimmed string. It is killable (assigning `""` to a row's name reds
   * it), so it is not vacuous, but it is insurance against a future reader rather
   * than a live guard on this one.
   */
  it("never produces a row whose company name is blank", () => {
    const offenders: string[] = [];
    for (const text of listings) {
      for (const row of parseSubListing(text).rows) {
        if (row.name.trim() === "") offenders.push(JSON.stringify(text));
      }
    }
    expect(offenders.slice(0, 3)).toEqual([]);
  });
});
