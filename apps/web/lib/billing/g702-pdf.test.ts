import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawnStrings } from "@/lib/pdfDrawnStrings.testutil";
import { calculatePayAppLineItem, calculatePayAppSummary, type PayAppLineItemInput } from "@/lib/pay-application";
import { money } from "@/lib/money";
import { formatPercent, g702Document, G702_LINES, party, type G702Document } from "./g702";
import { buildG702Pdf, g702FileName } from "./g702-pdf";

/**
 * THE PDF'S NUMBERS ARE READ BACK OUT OF ITS BYTES and compared with the
 * engine. Not with a mock painter, not with the object handed to the
 * builder: pdf-lib writes every drawn string into the page's content
 * stream as a hex string followed by `Tj`, so the stream can be inflated
 * and scanned for exactly what a reader's PDF viewer will show. A test on
 * the document object alone would pass with a builder that draws nothing.
 *
 * The control that keeps the zero readable: a string the builder was never
 * given must be ABSENT, and the scan must find a plausible number of
 * strings, or an extractor matching nothing would pass every "contains".
 */

function fixture(rowCount: number): G702Document {
  const inputs: PayAppLineItemInput[] = Array.from({ length: rowCount }, (_, i) => ({
    lineItemId: `line-${i}`,
    description: `Line ${i + 1} — ${i % 3 === 0 ? "framing" : i % 3 === 1 ? "board" : "finish"}`,
    scheduledValue: 10_000 + i * 1_234.56,
    previousBilled: 1_000 * i,
    thisPeriodBilled: 500 + i,
    previousMaterialsStored: i % 2 ? 2_000 : 0,
    materialsStoredValue: i % 2 ? -250 : 100,
  }));
  const lineItems = inputs.map(calculatePayAppLineItem);
  return g702Document({
    header: {
      project: "Riverside Clinic",
      projectLocation: "12 River Rd",
      to: party("Acme General", "1 Main St"),
      from: party("Drywall Co", "9 Shop Ln"),
      contractFor: "Framing and drywall",
      applicationNumber: 7,
      applicationDate: "Oct 30, 2026",
      periodTo: "Oct 31, 2026",
      contractDate: "Mar 2, 2026",
      projectNumber: "SC-44",
    },
    lineItems,
    summary: calculatePayAppSummary({ lineItems, previousRetainageWithheld: 3_210.5, thisPeriodRetainageWithheld: 987.65 }),
    netChangeByChangeOrders: -4_321.09,
  });
}

describe("the G702/G703 PDF", () => {
  it("prints every line of the G702 and every cell of the G703 as the engine computed them", async () => {
    const doc = fixture(5);
    const strings = await drawnStrings(await buildG702Pdf(doc));

    // Controls first.
    expect(strings.length).toBeGreaterThan(80);
    expect(strings).not.toContain(money(123_456.78));
    expect(strings.join("\n")).not.toContain("NOT-DRAWN");

    for (const line of G702_LINES) {
      expect(strings, `line ${line.number} ${line.label}`).toContain(money(doc.lines[line.key]));
      expect(strings).toContain(line.label.toUpperCase());
    }
    for (const row of doc.continuation.rows) {
      for (const cell of [
        row.scheduledValue,
        row.fromPrevious,
        row.thisPeriod,
        row.materialsStored,
        row.totalCompletedAndStored,
        row.balanceToFinish,
      ]) {
        expect(strings, `row ${row.itemNo}`).toContain(money(cell));
      }
      expect(strings).toContain(formatPercent(row.percent));
      expect(strings).toContain(String(row.itemNo));
    }
    const totals = doc.continuation.totals;
    for (const cell of [totals.scheduledValue, totals.fromPrevious, totals.thisPeriod, totals.materialsStored, totals.totalCompletedAndStored, totals.balanceToFinish]) {
      expect(strings, "grand totals").toContain(money(cell));
    }
    expect(strings.filter((s) => s === "GRAND TOTALS")).toHaveLength(1);

    // Header fields.
    for (const expected of ["Riverside Clinic", "Acme General", "Drywall Co", "7", "Oct 31, 2026", "Oct 30, 2026", "SC-44", "Mar 2, 2026"]) {
      expect(strings, expected).toContain(expected);
    }
  });

  it("is one portrait G702 page plus landscape G703 pages, paginating a long schedule with the totals once", async () => {
    const doc = fixture(80);
    const bytes = await buildG702Pdf(doc);
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages[0].getWidth()).toBeLessThan(pages[0].getHeight());
    for (const page of pages.slice(1)) expect(page.getWidth()).toBeGreaterThan(page.getHeight());

    const strings = await drawnStrings(bytes);
    expect(strings.filter((s) => s === "GRAND TOTALS")).toHaveLength(1);
    expect(strings).toContain(money(doc.continuation.rows[79].totalCompletedAndStored));
    expect(strings).toContain(`Page ${pages.length - 1} of ${pages.length - 1}`);
  });

  it("leaves a blank, not a guess, where an older application has no period-to date", async () => {
    const doc = fixture(2);
    doc.header.periodTo = null;
    doc.header.contractDate = null;
    const strings = await drawnStrings(await buildG702Pdf(doc));
    expect(strings).toContain("PERIOD TO:");
    expect(strings).not.toContain("Oct 31, 2026");
    expect(strings.some((s) => s.startsWith("PERIOD TO: ____"))).toBe(true);
  });

  it("does not throw on a description Helvetica cannot encode", async () => {
    const doc = fixture(1);
    doc.continuation.rows[0].description = "Fireproofing — 日本語 beam wrap";
    const strings = await drawnStrings(await buildG702Pdf(doc));
    expect(strings.some((s) => s.startsWith("Fireproofing"))).toBe(true);
  });

  it("names the file after the project and the application, without path characters", () => {
    const doc = fixture(1);
    doc.header.project = "Riverside / Clinic: phase 2";
    expect(g702FileName(doc)).toBe("G702-G703 Riverside - Clinic- phase 2 application 7.pdf");
  });
});
