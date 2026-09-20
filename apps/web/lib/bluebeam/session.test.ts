import { describe, expect, it } from "vitest";
import { BLUEBEAM_UPLOAD_MAX_BYTES, looksLikePdf, markupSummarySentence, pushDocumentToBluebeamSession } from "./session";

const pdfBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode("%PDF-"));
  return bytes;
};

describe("looksLikePdf — the guard against pushing a non-PDF into Bluebeam", () => {
  it("accepts real PDF bytes", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n%rest of file");
    expect(looksLikePdf(bytes)).toBe(true);
  });

  it("refuses a PNG (or any non-PDF) even with a .pdf-looking name", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(looksLikePdf(bytes)).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it("refuses bytes shorter than the magic number", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PD"))).toBe(false);
  });
});

describe("pushDocumentToBluebeamSession — the size cap, checked before any database read", () => {
  it("refuses a file over the 25MB cap without touching the database", async () => {
    const oversized = pdfBytes(BLUEBEAM_UPLOAD_MAX_BYTES + 1);
    await expect(
      pushDocumentToBluebeamSession("co_1", "job_1", { name: "big.pdf", bytes: oversized, contentType: "application/pdf" }),
    ).rejects.toThrow(/empty or too large/);
  });

  it("refuses a zero-byte file — via the PDF check, since 0 bytes can never carry the %PDF- magic number", async () => {
    await expect(
      pushDocumentToBluebeamSession("co_1", "job_1", { name: "empty.pdf", bytes: new Uint8Array(), contentType: "application/pdf" }),
    ).rejects.toThrow(/isn't a PDF/);
  });

  it("refuses a non-PDF before the size check would even matter", async () => {
    await expect(
      pushDocumentToBluebeamSession("co_1", "job_1", { name: "x.png", bytes: new Uint8Array([1, 2, 3, 4, 5, 6]), contentType: "image/png" }),
    ).rejects.toThrow(/isn't a PDF/);
  });
});

describe("markupSummarySentence", () => {
  it("says plainly when the session has no files yet", () => {
    expect(markupSummarySentence(0, { total: 0, byStatus: {} })).toBe("No files in this session yet.");
  });

  it("says files exist with no markups yet, singular file worded correctly", () => {
    expect(markupSummarySentence(1, { total: 0, byStatus: {} })).toBe("1 file in the session, no markups yet.");
    expect(markupSummarySentence(3, { total: 0, byStatus: {} })).toBe("3 files in the session, no markups yet.");
  });

  it("summarizes markups by status, largest first, without inventing a fixed vocabulary", () => {
    const sentence = markupSummarySentence(2, { total: 5, byStatus: { Approved: 3, Rejected: 2 } });
    expect(sentence).toBe("2 files, 5 markups (3 approved, 2 rejected).");
  });

  it("singularizes one markup correctly", () => {
    const sentence = markupSummarySentence(1, { total: 1, byStatus: { Approved: 1 } });
    expect(sentence).toBe("1 file, 1 markup (1 approved).");
  });
});
