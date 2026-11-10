import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseCsvRecords } from "@/lib/catalog-import";
import { guessColumns, priceListTable, readRow } from "@/lib/estimating/priceList";

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({ company: { id: "c" }, id: "u", role: "OWNER", jobFunction: null }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({ prisma: {} }));
const { readPriceListPdf } = await import("./priceList");

const csv = readFileSync(new URL("../../e2e/fixtures/supplier-price-list.csv", import.meta.url), "utf8");

/** The fixture as a typed PDF quote: one column per field, each DESCRIPTION drawn word by word, the way PDF writers split text. */
async function quotePdf(): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([792, 612]);
  const xs = [20, 90, 330, 450, 490, 540, 610];
  let y = 590;
  for (const record of parseCsvRecords(csv)) {
    record.cells.forEach((cell, col) => {
      if (cell === "") return;
      if (col === 1) {
        let x = xs[col];
        for (const word of cell.split(" ")) {
          page.drawText(word, { x, y, size: 8, font });
          x += font.widthOfTextAtSize(word + " ", 8);
        }
      } else page.drawText(cell, { x: xs[col], y, size: 8, font });
    });
    y -= 20;
  }
  const bytes = await pdf.save();
  return new File([bytes.slice().buffer as ArrayBuffer], "northgate-quote.pdf", { type: "application/pdf" });
}

describe("a price list sent as a PDF", () => {
  it("reads into the same rows, columns and prices as the spreadsheet", async () => {
    const form = new FormData();
    form.set("file", await quotePdf());
    const result = await readPriceListPdf(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fromPdf = priceListTable(result.value.text);
    const fromCsv = priceListTable(csv);
    const read = (t: typeof fromCsv) => t.rows.map((r) => readRow(r, guessColumns(t.header)!, 500)).map((r) => [r.key, r.ourUnit, r.ourPrice]);
    expect(fromPdf.header).toEqual(fromCsv.header);
    expect(read(fromPdf)).toEqual(read(fromCsv));
    expect(read(fromPdf).filter(([, , p]) => p !== null).length).toBeGreaterThan(15);
  });
  it("a PDF with no text says it is probably a scan", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const form = new FormData();
    form.set("file", new File([(await pdf.save()).slice().buffer as ArrayBuffer], "scan.pdf"));
    expect(await readPriceListPdf(form)).toMatchObject({ ok: false, error: expect.stringMatching(/scan/) });
  });
});
