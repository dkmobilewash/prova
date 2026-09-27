import { describe, expect, it } from "vitest";
import { QUOTE_FIXTURES, quotePdf } from "./quoteFixtures";

/**
 * THE FIXTURES ARE REAL PDFs, PROVED WITHOUT SPENDING A PENNY.
 *
 * `quoteRead.eval.ts` measures how well a model reads a quote. It is run by
 * hand, it costs real money, and it is only worth running if the file handed to
 * the model is a document at all — a fixture whose cross-reference offsets are
 * wrong would come back as a model failure, and somebody would spend an
 * afternoon on the prompt.
 *
 * So this file reads every fixture back with `pdfjs-dist`, the library this app
 * already ships for the takeoff viewer, and requires the text to come out. It
 * runs in CI, in a second, for nothing.
 *
 * WHAT IT IS ACTUALLY GUARDING is the byte offsets. Everything else in a minimal
 * PDF is a fixed string; the xref table is arithmetic over the bytes written so
 * far, and it is the one part that silently rots the moment somebody adds a line
 * to the writer. A reader that accepts a malformed xref by scanning for objects
 * would hide it — pdfjs is strict enough not to.
 */

/** pdf.js in Node — the legacy build is the one that runs outside a browser. Imported lazily so the unit suite does not pay for it
 *  unless this file runs. */
async function textOf(pdf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // No system fonts to hunt for: these fixtures use Helvetica, one of the base
    // fourteen, which needs no embedding.
    //
    // NO `disableWorker` HERE, and its absence is deliberate. It was in the first
    // version and typecheck refused it — it is not an option in this pdfjs
    // version's types, and the test passed anyway, which means it had been
    // silently ignored all along. The legacy build does not spawn a worker in
    // Node. A cast to keep it would have preserved a line that does nothing.
    useSystemFonts: false,
    // ERRORS ONLY, and the reason is not tidiness. Without it every call prints
    // `Ensure that the standardFontDataUrl API parameter is provided` — nine
    // lines per run in CI — and that parameter CANNOT be provided here: this
    // build of pdfjs-dist ships no `standard_fonts` directory to point it at.
    //
    // It is also irrelevant to what this file checks. That data is glyph
    // outlines, needed to DRAW text; `getTextContent` reads the content stream's
    // string operators and needs none of it, which is why the assertions below
    // pass with the warning present. Silenced rather than left to teach people
    // that warnings in this suite are normal.
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("\n");
  await doc.destroy();
  return text;
}

describe("the synthetic quote fixtures are documents a reader can open", () => {
  it("writes a PDF whose text comes back out", async () => {
    const pdf = quotePdf(["Total price: $184,500.00", "Exclusions: firestopping"]);
    // A PDF header and trailer, before anything harder is claimed.
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("%%EOF");

    const text = await textOf(pdf);
    expect(text).toContain("184,500.00");
    expect(text).toContain("firestopping");
  });

  it("round-trips the characters a PDF string has to escape", async () => {
    // `(`, `)` and `\` end a string literal or start an escape. An unescaped one
    // produces a file that opens and shows the wrong text, or none — which as a
    // fixture would read as the model misreading the document.
    const text = await textOf(quotePdf(["Alt 2 (deduct) -$6,250", "C:\\jobs\\north"]));
    expect(text).toContain("(deduct)");
    expect(text).toContain("C:\\jobs\\north");
  });

  it("opens every case in the eval's own list, and each says what it should", async () => {
    // THE SIZE ASSERTION FIRST: an empty fixture list would make every loop below
    // vacuous, which is the shape this repo keeps paying for.
    expect(QUOTE_FIXTURES.length).toBeGreaterThanOrEqual(7);
    expect(new Set(QUOTE_FIXTURES.map((f) => f.id)).size).toBe(QUOTE_FIXTURES.length);

    for (const fixture of QUOTE_FIXTURES) {
      const text = await textOf(quotePdf(fixture.lines));
      // Every fixture is marked synthetic, which is both a naming convention and
      // the check that this really is the invented document and not something
      // that wandered in from a customer.
      expect(text, `${fixture.id} should open and be marked synthetic`).toContain("ZZ SYNTHETIC");
      // And a line only this case carries, so a fixture cannot pass by being
      // some OTHER fixture — the mixed-up-file failure that would make the
      // eval's per-case verdicts meaningless.
      const marker = fixture.lines.find((line) => line.length > 12 && !line.includes("ZZ SYNTHETIC"));
      expect(marker, `${fixture.id} needs a line long enough to identify it`).toBeTruthy();
      const words = marker!.split(/\s+/).filter((w) => w.length > 3);
      expect(words.length, `${fixture.id}'s marker line should have real words`).toBeGreaterThan(0);
      expect(text, `${fixture.id} should contain its own marker line`).toContain(words[0]);
    }
  }, 30_000);

  it("keeps the four no-single-total cases, which are what the eval is for", () => {
    // Named rather than counted, because these are the cases where "never invent
    // a number" is actually tested — a plain total is the easy half. If somebody
    // trims the fixture list, this says which ones cannot go.
    const ids = QUOTE_FIXTURES.map((f) => f.id);
    for (const id of ["range-no-single-total", "base-plus-alternates", "unit-price-no-quantity", "not-a-quote"]) {
      expect(ids, `${id} is one of the cases the eval exists to measure`).toContain(id);
    }
  });
});
