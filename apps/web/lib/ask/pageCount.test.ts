import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ASK_PAGE_RULES, attachmentPageCharge, pageChargeNote, pdfPageCount } from "./pageCount";

/**
 * A document is charged its REAL page count, not one.
 *
 * The defect this pins: a 40-page bid package and a one-line CSV costing
 * the same unit of a 300-page allowance. Every case here is built as actual
 * bytes rather than asserted against a stub, because the whole claim is
 * about what is IN the file — a test that hands the counter a number it
 * then returns proves nothing.
 */

/** A classic PDF: page objects sit uncompressed in the file body, which is
 * what a cross-reference TABLE (PDF 1.4 and anything that still emits one)
 * looks like. */
function classicPdf(pages: number): Buffer {
  const objects = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    `2 0 obj << /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] >> endobj`,
    ...Array.from(
      { length: pages },
      (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj`,
    ),
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ];
  return Buffer.from(objects.join("\n"), "latin1");
}

/** A modern PDF: the page objects live inside a Flate-compressed OBJECT
 * STREAM, so nothing about them is visible in the file's own bytes. This is
 * what Word and Acrobat emit, and it is the case a naive scan misses
 * entirely — it would report "cannot count" on the most ordinary file
 * anybody attaches. */
function objectStreamPdf(pages: number): Buffer {
  const inner =
    `<< /Type /Pages /Count ${pages} >>` +
    Array.from({ length: pages }, () => "<< /Type /Page /MediaBox [0 0 612 792] >>").join("");
  const compressed = deflateSync(Buffer.from(inner, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.7\n9 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n", "latin1"),
    compressed,
    Buffer.from("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF", "latin1"),
  ]);
}

describe("counting a PDF's pages", () => {
  it("counts page objects in the file body, and does not mistake the page-tree node for a page", () => {
    // `/Type /Pages` is the TREE, not a page. A pattern without the
    // boundary counts it and every file is one page heavier than it is.
    expect(pdfPageCount(classicPdf(1))).toBe(1);
    expect(pdfPageCount(classicPdf(12))).toBe(12);
    expect(pdfPageCount(classicPdf(40))).toBe(40);
  });

  it("inflates object streams, so an ordinary Word-exported PDF is counted rather than guessed at", () => {
    const pdf = objectStreamPdf(17);
    // The proof that this case is real: nothing readable is in the bytes.
    expect(pdf.toString("latin1")).not.toContain("/Type /Page");
    expect(pdfPageCount(pdf)).toBe(17);
  });

  it("returns null — NOT one — when the page tree cannot be read at all", () => {
    // An encrypted or damaged file. Returning 1 here would be the silent
    // under-charge this module exists to refuse.
    const opaque = Buffer.concat([
      Buffer.from("%PDF-1.7\nstream\n", "latin1"),
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]),
      Buffer.from("\nendstream\n%%EOF", "latin1"),
    ]);
    expect(pdfPageCount(opaque)).toBeNull();
  });

  it("survives a stream that is not Flate at all", () => {
    // A JPEG inside a PDF inflates to nothing and must be skipped, not
    // thrown from — a crash here would take down a question about a file
    // that is perfectly fine.
    const withJpeg = Buffer.concat([
      Buffer.from("%PDF-1.4\n5 0 obj << /Type /XObject /Filter /DCTDecode >>\nstream\n", "latin1"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.from("\nendstream\n6 0 obj << /Type /Page >> endobj\n%%EOF", "latin1"),
    ]);
    expect(pdfPageCount(withJpeg)).toBe(1);
  });
});

describe("what one attachment costs", () => {
  it("charges a PDF its real page count", () => {
    expect(attachmentPageCharge("application/pdf", classicPdf(23))).toEqual({ pages: 23, basis: "pdf" });
  });

  it("charges an uncountable PDF the flat rule, and says which rule it used", () => {
    const opaque = Buffer.from("%PDF-1.7\nnothing readable here\n%%EOF", "latin1");
    expect(attachmentPageCharge("application/pdf", opaque)).toEqual({
      pages: ASK_PAGE_RULES.uncountablePdfPages,
      basis: "pdf-uncountable",
    });
    // The person is TOLD. A charge they cannot account for is the thing
    // that turns an allowance into a support call.
    expect(pageChargeNote(attachmentPageCharge("application/pdf", opaque))).toMatch(
      /couldn't be read, so it is charged as 10/,
    );
  });

  it("charges a photo one page", () => {
    expect(attachmentPageCharge("image/jpeg", Buffer.alloc(900_000))).toEqual({ pages: 1, basis: "image" });
    expect(attachmentPageCharge("image/png", Buffer.alloc(10))).toEqual({ pages: 1, basis: "image" });
  });

  it("charges text and CSV by length, rounded up, never zero", () => {
    const per = ASK_PAGE_RULES.charsPerTextPage;
    expect(attachmentPageCharge("text/csv", Buffer.from("a,b\n1,2"))).toEqual({ pages: 1, basis: "text" });
    expect(attachmentPageCharge("text/plain", Buffer.from("x".repeat(per)))).toEqual({ pages: 1, basis: "text" });
    // One character past a page boundary is two pages, not one — rounding
    // down is the direction that leaks money.
    expect(attachmentPageCharge("text/plain", Buffer.from("x".repeat(per + 1)))).toEqual({
      pages: 2,
      basis: "text",
    });
    expect(attachmentPageCharge("text/plain", Buffer.from("x".repeat(per * 4)))).toEqual({
      pages: 4,
      basis: "text",
    });
  });

  it("never charges zero for a file that exists", () => {
    // Every accepted type, plus a type that cannot reach here. A file that
    // reached the model cost something, so zero is never the answer.
    for (const type of ["application/pdf", "image/webp", "text/plain", "text/csv", "application/x-unknown"]) {
      expect(attachmentPageCharge(type, Buffer.from("x")).pages).toBeGreaterThanOrEqual(1);
    }
  });

  it("phrases an ordinary charge as a plain number of pages", () => {
    expect(pageChargeNote({ pages: 1, basis: "pdf" })).toBe("1 page");
    expect(pageChargeNote({ pages: 12, basis: "pdf" })).toBe("12 pages");
  });
});
