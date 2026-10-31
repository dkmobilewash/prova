import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { drawnStrings } from "./pdfDrawnStrings.testutil";
import { buildPurchaseOrderPdf, purchaseOrderFileName, purchaseOrderTotal, type PurchaseOrderDocument } from "./purchase-order-pdf";
import { poLineAmount } from "./purchase-orders";

const doc: PurchaseOrderDocument = {
  number: 7,
  status: "ISSUED",
  issuedOn: "Oct 30, 2026",
  from: { name: "Drywall Co", lines: ["9 Shop Ln"] },
  vendor: { name: "Foundation Supply", lines: ["Sam", "555-0100"] },
  jobName: "Riverside Clinic",
  shipTo: "12 River Rd",
  contractNumber: "SC-44",
  lines: [
    { description: "5/8 type X board", quantity: 10000, unit: "SF", unitPrice: 0.75 },
    { description: "Track", quantity: 3, unit: null, unitPrice: 0.1 },
  ],
};

describe("the purchase order PDF", () => {
  it("prints the parties, every line and a total read back out of the bytes", async () => {
    const strings = await drawnStrings(await buildPurchaseOrderPdf(doc));
    expect(strings.length).toBeGreaterThan(20);
    expect(strings).not.toContain("NOT-DRAWN");
    for (const fact of ["PURCHASE ORDER 7", "Drywall Co", "Foundation Supply", "Riverside Clinic", "12 River Rd", "SC-44", "Oct 30, 2026"]) {
      expect(strings, fact).toContain(fact);
    }
    for (const line of doc.lines) {
      expect(strings).toContain(line.description);
      expect(strings).toContain(money(line.unitPrice));
      expect(strings).toContain(money(poLineAmount(line)));
    }
    expect(purchaseOrderTotal(doc)).toBe(7500.3);
    expect(strings).toContain(money(7500.3));
  });

  it("marks a draft so it cannot pass for a commitment, and an issued order is not marked", async () => {
    const draft = await drawnStrings(await buildPurchaseOrderPdf({ ...doc, status: "DRAFT", issuedOn: null }));
    expect(draft).toContain("DRAFT - NOT ISSUED");
    expect(draft).not.toContain("Oct 30, 2026");
    expect(await drawnStrings(await buildPurchaseOrderPdf(doc))).not.toContain("DRAFT - NOT ISSUED");
  });

  it("writes no terms", async () => {
    const text = (await drawnStrings(await buildPurchaseOrderPdf(doc))).join(" ");
    expect(text).not.toMatch(/terms|conditions|warrant|indemn|shall/i);
  });

  it("runs a long order onto further pages with the total once", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ description: `Line ${i + 1}`, quantity: 1, unit: "EA", unitPrice: 10 }));
    const bytes = await buildPurchaseOrderPdf({ ...doc, lines });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    const strings = await drawnStrings(bytes);
    expect(strings).toContain("Line 80");
    expect(strings.filter((s) => s === "TOTAL")).toHaveLength(1);
    expect(strings).toContain(money(800));
  });

  it("does not throw on text Helvetica cannot encode, and names the file", async () => {
    await expect(buildPurchaseOrderPdf({ ...doc, vendor: { name: "日本語 Supply", lines: [] } })).resolves.toBeInstanceOf(Uint8Array);
    expect(purchaseOrderFileName({ jobName: "Riverside / Clinic", number: 7 })).toBe("Riverside-Clinic-PO-7.pdf");
  });
});
