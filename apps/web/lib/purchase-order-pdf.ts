// The purchase order as a PDF, drawn in the browser with the pdf-lib the bid
// package and the G702 already use. Nothing is stored or sent: Diego's call is
// download and print only for now.
//
// IT WRITES NO TERMS. Conditions of purchase are legal wording, and the app
// writes none. The sheet carries facts, the lines, the total and blank
// signature fields. A draft says DRAFT across the header, so a draft that
// leaves the building cannot pass for a commitment.

import { safe } from "@/lib/billing/g702-pdf";
import { money } from "@/lib/money";
import { poLineAmount } from "@/lib/purchase-orders";

export interface PurchaseOrderDocument {
  number: number;
  status: "DRAFT" | "ISSUED" | "CLOSED";
  /** Rendered calendar days, or null for a blank to be written in. */
  issuedOn: string | null;
  from: { name: string; lines: string[] };
  vendor: { name: string; lines: string[] };
  jobName: string;
  shipTo: string | null;
  contractNumber: string | null;
  lines: { description: string; quantity: number; unit: string | null; unitPrice: number }[];
}

export function purchaseOrderTotal(doc: Pick<PurchaseOrderDocument, "lines">): number {
  return Math.round(doc.lines.reduce((sum, line) => sum + poLineAmount(line), 0) * 100) / 100;
}

const PAGE: [number, number] = [612, 792];
const MARGIN = 54;
const ROW = 15;
const LEFT = MARGIN;
const RIGHT = PAGE[0] - MARGIN;
const QTY = 370;
const UNIT = 400;
const PRICE = 480;

export async function buildPurchaseOrderPdf(doc: PurchaseOrderDocument): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const out = await PDFDocument.create();
  out.setTitle(`Purchase order ${doc.number} - ${safe(doc.jobName)}`);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0, 0, 0);
  let page = out.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const text = (str: string, x: number, at: number, size = 10, useBold = false, align: "left" | "right" = "left", maxWidth?: number) => {
    const f = useBold ? bold : font;
    let s = safe(str);
    while (maxWidth && s.length > 4 && f.widthOfTextAtSize(s, size) > maxWidth) s = `${s.slice(0, -4)}...`;
    page.drawText(s, { x: align === "right" ? x - f.widthOfTextAtSize(s, size) : x, y: at, size, font: f, color: ink });
  };
  const rule = (at: number, thickness = 0.5) =>
    page.drawLine({ start: { x: LEFT, y: at }, end: { x: RIGHT, y: at }, thickness, color: ink });
  const tableHead = () => {
    text("DESCRIPTION", LEFT, y, 8, true);
    text("QTY", QTY, y, 8, true, "right");
    text("UNIT", UNIT, y, 8, true);
    text("UNIT PRICE", PRICE, y, 8, true, "right");
    text("AMOUNT", RIGHT, y, 8, true, "right");
    y -= 5;
    rule(y, 0.8);
    y -= ROW;
  };

  text(`PURCHASE ORDER ${doc.number}`, LEFT, y, 16, true);
  if (doc.status === "DRAFT") text("DRAFT - NOT ISSUED", RIGHT, y, 12, true, "right");
  if (doc.status === "CLOSED") text("CLOSED", RIGHT, y, 12, true, "right");
  y -= 26;

  const top = y;
  text("FROM", LEFT, y, 8, true);
  y -= 13;
  text(doc.from.name, LEFT, y, 10, false, "left", 240);
  for (const line of doc.from.lines) {
    y -= 12;
    text(line, LEFT, y, 9, false, "left", 240);
  }
  const leftEnd = y;
  y = top;
  text("VENDOR", 310, y, 8, true);
  y -= 13;
  text(doc.vendor.name, 310, y, 10, false, "left", RIGHT - 310);
  for (const line of doc.vendor.lines) {
    y -= 12;
    text(line, 310, y, 9, false, "left", RIGHT - 310);
  }
  y = Math.min(y, leftEnd) - 22;

  const facts: [string, string | null][] = [
    ["DATE ISSUED:", doc.issuedOn],
    ["JOB:", doc.jobName],
    ["DELIVER TO:", doc.shipTo],
    ["CONTRACT NO:", doc.contractNumber],
  ];
  for (const [label, value] of facts) {
    text(label, LEFT, y, 8, true);
    if (value) text(value, LEFT + 90, y, 10, false, "left", RIGHT - LEFT - 90);
    else page.drawLine({ start: { x: LEFT + 90, y: y - 1.5 }, end: { x: 320, y: y - 1.5 }, thickness: 0.4, color: ink });
    y -= 15;
  }
  y -= 12;
  tableHead();

  for (const line of doc.lines) {
    if (y < MARGIN + 110) {
      page = out.addPage(PAGE);
      y = PAGE[1] - MARGIN;
      tableHead();
    }
    text(line.description, LEFT, y, 9, false, "left", QTY - 40 - LEFT);
    text(String(line.quantity), QTY, y, 9, false, "right");
    text(line.unit ?? "", UNIT, y, 9);
    text(money(line.unitPrice), PRICE, y, 9, false, "right");
    text(money(poLineAmount(line)), RIGHT, y, 9, false, "right");
    y -= ROW;
  }
  rule(y + 9, 0.8);
  text("TOTAL", PRICE, y - 4, 10, true, "right");
  text(money(purchaseOrderTotal(doc)), RIGHT, y - 4, 10, true, "right");

  // Blank fields only, with room kept for them by the page break above.
  y -= 42;
  for (const label of ["Authorised by:", "Date:", "Vendor acceptance:", "Date:"]) {
    text(label, LEFT, y, 8);
    page.drawLine({ start: { x: LEFT + 90, y: y - 1.5 }, end: { x: 320, y: y - 1.5 }, thickness: 0.4, color: ink });
    y -= 16;
  }
  return out.save();
}

export function purchaseOrderFileName(doc: Pick<PurchaseOrderDocument, "jobName" | "number">): string {
  const job = doc.jobName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${job || "job"}-PO-${doc.number}.pdf`;
}
