import { describe as group, expect, it } from "vitest";
import { ADDENDUM_CASES } from "./addendumCases";
import { renderedCases } from "./addendumFixtures";
import { normaliseReference } from "@/lib/addenda-overlap";

/**
 * THE FIXTURES, CHECKED FOR FREE, BEFORE ANYBODY PAYS TO MEASURE A MODEL AGAINST
 * THEM.
 *
 * This file exists because the plan-sheet eval shipped with its single most
 * important case measuring NOTHING. The trap sat where the region filter removed
 * it, so the model was never shown the thing it was being scored on, and the case
 * passed — for the wrong reason, looking exactly like a pass for the right one.
 *
 * The same failure is available here in a quieter form: a typo in a line, a
 * reference spelt one way in the document and another in `expected`, or a
 * `mustSend` string that never survives into the PDF. Any of those produces an
 * eval that reports a number about nothing. So every case is rendered, read back
 * with the same library the app ships, and checked.
 *
 * It runs in CI at no cost, which is the point: `absence of a failure is not a
 * pass` applies to fixtures before it applies to models.
 */

async function textOf(pdf: Buffer): Promise<string> {
  // The dynamic import is not a style choice — `planPdf.ts` documents it at
  // length: pdfjs must not be hoisted into a module graph the browser shares.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength),
    useSystemFonts: true,
  }).promise;
  let out = "";
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    out += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

/** Whitespace-insensitive containment: the PDF writer emits each line as its own
 *  `Tj`, and pdfjs rejoins them with spacing that is not the source's. */
function holds(haystack: string, needle: string): boolean {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return flat(haystack).includes(flat(needle));
}

group("every case is a real, readable document", () => {
  it("has cases at all", () => {
    // A pattern that matches nothing passes every downstream assertion. An empty
    // list would make each loop below vacuous, and the eval would report
    // `requested 0, returned 0` as a clean run.
    expect(ADDENDUM_CASES.length).toBeGreaterThanOrEqual(7);
  });

  it("gives every case an id, a reason to exist, and a mustSend", async () => {
    const ids = ADDENDUM_CASES.map((c) => c.id);
    expect(new Set(ids).size, "case ids are unique").toBe(ids.length);
    for (const kase of ADDENDUM_CASES) {
      expect(kase.why.length, `${kase.id} says what it is for`).toBeGreaterThan(20);
      expect(kase.mustSend.length, `${kase.id} names what must reach the model`).toBeGreaterThan(0);
      expect(kase.lines.length, `${kase.id} has a document`).toBeGreaterThan(3);
    }
  });

  it("puts every mustSend string into the rendered PDF", async () => {
    for (const { kase, pdf } of renderedCases()) {
      const text = await textOf(pdf);
      for (const needle of kase.mustSend) {
        expect(holds(text, needle), `${kase.id}: "${needle}" never reached the document`).toBe(true);
      }
    }
  }, 60_000);

  it("puts every EXPECTED reference into the document it is expected from", async () => {
    // Otherwise the eval scores a miss the model could not have avoided, and the
    // report blames a reader for a typo in this file.
    for (const { kase, pdf } of renderedCases()) {
      const text = await textOf(pdf);
      for (const item of kase.expected) {
        expect(holds(text, item.reference), `${kase.id}: expects "${item.reference}" which is not in it`).toBe(
          true,
        );
      }
    }
  }, 60_000);

  it("puts every ABSENT reference into the document too — a trap not shown is not a trap", async () => {
    // THE ONE THIS FILE IS REALLY FOR. `absent` is scored as the fatal failure,
    // so a reference that is not actually IN the document cannot be invented
    // from it, and the case would pass while measuring nothing at all.
    for (const { kase, pdf } of renderedCases()) {
      if (!kase.absent?.length) continue;
      const text = await textOf(pdf);
      for (const trap of kase.absent) {
        expect(holds(text, trap), `${kase.id}: trap "${trap}" is not in the document, so it measures nothing`).toBe(
          true,
        );
      }
    }
  }, 60_000);

  it("keeps every forbidden LABEL out of the document — the inverse trap", async () => {
    // The opposite check to the one above, and it needs to be separate because
    // the two traps fail in opposite directions. `absent` is a reference the
    // letter names and does not change, so it must be present or it cannot be
    // fallen for. A forbidden LABEL is an item number the GC skipped, so it must
    // be ABSENT or the reader would be right to report it — and this case would
    // be scoring a reader for reading correctly.
    for (const { kase, pdf } of renderedCases()) {
      if (!kase.forbiddenLabels?.length) continue;
      const text = await textOf(pdf);
      for (const label of kase.forbiddenLabels) {
        expect(holds(text, label), `${kase.id}: forbids "${label}" but the document contains it`).toBe(false);
      }
    }
  }, 60_000);

  it("keeps expected and absent disjoint once normalised", () => {
    // They are compared by normalised reference in the scorer, so an overlap
    // would make one case both require and forbid the same answer.
    for (const kase of ADDENDUM_CASES) {
      const expected = new Set(kase.expected.map((e) => normaliseReference(e.reference)));
      for (const trap of kase.absent ?? []) {
        expect(
          expected.has(normaliseReference(trap)),
          `${kase.id}: "${trap}" is both expected and forbidden`,
        ).toBe(false);
      }
    }
  });

  it("carries the synthetic marking on every page", async () => {
    // Appended by the writer rather than by a case, so no fixture can be added
    // without it. A reader that meets one of these outside the eval should be
    // able to tell in one line that it is not a real document.
    for (const { kase, pdf } of renderedCases()) {
      const text = await textOf(pdf);
      expect(holds(text, "ZZ SYNTHETIC"), `${kase.id} is marked synthetic`).toBe(true);
    }
  }, 60_000);

  it("states the dates it expects exactly as the document prints them", async () => {
    // `bid-addenda.prisma` keeps these as TEXT so nothing converts them. If a
    // case expected "2026-10-16" from a document printing "October 16, 2026", it
    // would be scoring the opposite of the rule.
    for (const { kase, pdf } of renderedCases()) {
      const text = await textOf(pdf);
      for (const date of [kase.issueDateText, kase.bidDateText]) {
        if (!date) continue;
        expect(holds(text, date), `${kase.id}: expects the date "${date}" which is not printed in it`).toBe(true);
      }
    }
  }, 60_000);
});
