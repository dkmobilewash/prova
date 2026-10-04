import { describe as group, expect, it } from "vitest";
import { SPEC_CASES } from "./specCases";
import { renderedSpecCases } from "./specFixtures";
import { SPEC_FINDING_KINDS } from "@prova/integrations/src/specs";

/**
 * THE FREE HALF OF THE SPEC EVAL — everything about the cases that does not
 * need a model, and therefore runs on every push.
 *
 * A FIXTURE NOBODY HAS OPENED IS A MEASUREMENT ABOUT NOTHING. This repo has the
 * scar twice over: `scratch-cleanup-order.test.ts` went green on a set of 180
 * where the answer was 181, and three arms of the #418 investigation produced
 * confident wrong numbers that only their own controls caught. So every case is
 * rendered to a real PDF and READ BACK with the same pdfjs the app ships, and
 * the words the case asserts on must be in the page text.
 *
 * Without this, a broken line in `quotePdf` would produce an eval that sends
 * six blank pages, gets six empty findings lists, and reports that the reader
 * declines appropriately on every case — a perfect score for a reader that was
 * never shown anything.
 */

async function pageText(pdf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

group("the spec cases are well formed", () => {
  it("has enough cases, and each one has a reason", () => {
    // A SIZE ASSERTION against the list itself: a pattern or a filter that
    // silently emptied this would make every assertion below vacuous, which is
    // the shape CLAUDE.md records under "nothing is ever missing from an empty
    // list".
    expect(SPEC_CASES.length).toBeGreaterThanOrEqual(6);
    for (const kase of SPEC_CASES) {
      expect(kase.why.length, `${kase.id} has no reason`).toBeGreaterThan(30);
      expect(kase.lines.length, `${kase.id} has no document`).toBeGreaterThan(3);
    }
  });

  it("gives every case a unique id", () => {
    const ids = SPEC_CASES.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only expects kinds the extractor can actually return", () => {
    // A case expecting `FINISH_LEVl` would be unsatisfiable forever and would
    // read as the reader failing.
    for (const kase of SPEC_CASES) {
      for (const kind of kase.expectKinds) {
        expect(SPEC_FINDING_KINDS, `${kase.id} expects ${kind}`).toContain(kind);
      }
    }
  });

  it("keeps the empty cases empty, and the others not", () => {
    // The two boundary cases must expect NOTHING, and a case cannot both expect
    // a kind and expect emptiness — that would be unsatisfiable in both
    // directions at once.
    for (const kase of SPEC_CASES) {
      if (kase.expectEmpty) {
        expect(kase.expectKinds, `${kase.id} expects emptiness AND kinds`).toEqual([]);
      }
    }
    expect(SPEC_CASES.filter((k) => k.expectEmpty).length).toBeGreaterThanOrEqual(2);
  });

  it("covers both halves of the asymmetry", () => {
    // At least one case the reader must FIND something on, and at least one
    // where finding something is FATAL. An eval with only the first half
    // measures eagerness; with only the second, timidity.
    expect(SPEC_CASES.some((k) => k.expectKinds.length > 0)).toBe(true);
    expect(SPEC_CASES.some((k) => (k.forbidden?.length ?? 0) > 0)).toBe(true);
  });
});

group("every case renders to a readable PDF", () => {
  it("opens, has one page, and carries the words the case turns on", async () => {
    for (const { kase, pdf } of renderedSpecCases()) {
      const text = await pageText(pdf);
      // The first line is the section heading, and it is what the reader is
      // asked to identify — if it did not make it into the page, the case is
      // measuring a blank sheet.
      const heading = kase.lines[0]!;
      expect(text, `${kase.id}: the heading did not render`).toContain(heading.slice(0, 20));
      // And the SYNTHETIC marking rides along, so a fixture can never be
      // mistaken for a real spec if one escapes into a report.
      expect(text, `${kase.id}: no synthetic marking`).toContain("SYNTHETIC");
    }
  });

  it("renders the FORBIDDEN phrases, so the invention trap is actually set", async () => {
    // THE CONTROL ON THE TRAP. `names-and-excludes` scores a reader FATAL for
    // reporting a mock-up — and that is only a fair test if the page really
    // says "no field mock-up is required". If the phrase never rendered, the
    // case would be scoring the reader for not inventing something it was never
    // shown, which every reader passes.
    const trap = renderedSpecCases().find(({ kase }) => (kase.forbidden?.length ?? 0) > 0);
    expect(trap, "no case carries forbidden phrases").toBeDefined();
    const text = (await pageText(trap!.pdf)).toLowerCase();
    const source = trap!.kase.lines.join(" ").toLowerCase();

    // CHECKED AGAINST THE CASE'S OWN SOURCE, not against every entry in
    // `forbidden` — and the first version of this assertion got that wrong,
    // demanding the page contain "mock up" when the page says "mock-up".
    //
    // The two lists are for different jobs. `forbidden` holds the SPELLINGS A
    // MODEL MIGHT USE in its output, so it carries both hyphenations on
    // purpose; the page carries one of them. What this control has to prove is
    // that the page really says the thing the trap scores on, which is a
    // question about `lines` reaching the PDF.
    const inSource = trap!.kase.forbidden!.filter((phrase) => source.includes(phrase));
    expect(inSource.length, "no forbidden phrase appears in the trap case's own lines").toBeGreaterThan(0);
    for (const phrase of inSource) {
      expect(text, `the trap page does not contain "${phrase}"`).toContain(phrase);
    }
  });

  it("renders the garbled case as genuinely garbled", async () => {
    // Its whole point is text a reader cannot be sure of. If `quotePdf` had
    // silently normalised it, the case would be an ordinary readable section
    // with a confidence ceiling on it, and the ceiling would read as the reader
    // being needlessly timid.
    const garbled = renderedSpecCases().find(({ kase }) => kase.id === "garbled-scan");
    expect(garbled).toBeDefined();
    const text = await pageText(garbled!.pdf);
    // Digits standing in for letters, which is what a bad scan does. Two
    // separate words, so one lucky match cannot carry it — and NOT the heading,
    // which the first version of this assertion mistyped as "5ECTI0N" when the
    // fixture says "SECTI0N". A control whose own expectation is a typo fails
    // on a working fixture, which is the most expensive kind of harness bug.
    expect(text).toContain("GYP5UM");
    expect(text).toContain("B0ARD");
  });
});
