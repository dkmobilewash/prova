// The G702 and G703 as a PDF, drawn in the BROWSER with the pdf-lib that
// `lib/estimating/bid-package.ts` already brought in (its header carries the
// licence and the reasons it runs client-side; both apply here unchanged).
// Nothing is stored and no server sees the bytes: where a pay application
// should LIVE as a file is an open decision, and until it is made the
// download is the whole feature.
//
// LAYOUT, NOT WORDING. The sheets follow the AIA G702 / G703 arrangement —
// the nine numbered lines, the change-order summary, the certification and
// notary fields, columns A–I — because that is what a GC's accounting desk
// reads without being taught. The AIA's own certification paragraphs are
// their copyrighted text and are NOT reproduced; the signature, notary and
// architect blocks are labelled blank fields and the sheet says so. The
// figures are the only thing filled in, and they come from `g702Document`,
// which the test reads back out of these bytes.
//
// `pdf-lib` is imported dynamically inside `buildG702Pdf`, as bid-package
// does, so the certificate page does not ship a PDF library to anyone who
// never presses Download.

import { money } from "@/lib/money";
import { formatPercent, G702_LINES, type G702Document, type G703Row } from "./g702";

type PdfLib = typeof import("pdf-lib");
type PdfPage = import("pdf-lib").PDFPage;
type PdfFont = import("pdf-lib").PDFFont;

const LETTER_PORTRAIT: [number, number] = [612, 792];
const LETTER_LANDSCAPE: [number, number] = [792, 612];
const MARGIN = 36;

/** Standard-14 Helvetica is WinAnsi: a character outside Latin-1 makes
 * pdf-lib throw on encode, and a line-item description is free text. */
export function safe(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

interface Pen {
  page: PdfPage;
  font: PdfFont;
  bold: PdfFont;
  ink: import("pdf-lib").RGB;
}

function text(
  pen: Pen,
  str: string,
  x: number,
  y: number,
  opts: { size?: number; bold?: boolean; align?: "left" | "right"; maxWidth?: number } = {},
) {
  const size = opts.size ?? 8;
  const font = opts.bold ? pen.bold : pen.font;
  let s = safe(str);
  if (opts.maxWidth) {
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > opts.maxWidth) s = `${s.slice(0, -4)}...`;
  }
  const width = font.widthOfTextAtSize(s, size);
  pen.page.drawText(s, { x: opts.align === "right" ? x - width : x, y, size, font });
}

function hline(pen: Pen, x1: number, x2: number, y: number, thickness = 0.5) {
  pen.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness });
}

function vline(pen: Pen, x: number, y1: number, y2: number, thickness = 0.5) {
  pen.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness });
}

function box(pen: Pen, x: number, y: number, w: number, h: number) {
  pen.page.drawRectangle({ x, y, width: w, height: h, borderWidth: 0.5, borderColor: pen.ink, opacity: 0 });
}

/** A labelled line with a blank to be written on: "Label: ________". */
function blank(pen: Pen, label: string, x: number, y: number, width: number) {
  text(pen, label, x, y, { size: 7 });
  const lx = x + pen.font.widthOfTextAtSize(safe(label), 7) + 4;
  hline(pen, lx, x + width, y - 1.5, 0.4);
}

function drawG702(pen: Pen, doc: G702Document) {
  const { header, lines } = doc;
  const right = LETTER_PORTRAIT[0] - MARGIN;
  let y = LETTER_PORTRAIT[1] - MARGIN;

  text(pen, "APPLICATION AND CERTIFICATE FOR PAYMENT", MARGIN, y, { size: 13, bold: true });
  text(pen, "Page 1 of the application; continuation sheet follows", right, y, { size: 7, align: "right" });
  y -= 11;
  text(pen, "Laid out to follow AIA Document G702. This is not an AIA form; the figures come from the schedule of values.", MARGIN, y, {
    size: 6.5,
  });
  y -= 16;

  // Header: parties on the left, numbers on the right.
  const mid = MARGIN + 300;
  const partyBlock = (label: string, name: string, extra: string[], top: number) => {
    text(pen, label, MARGIN, top, { size: 6.5, bold: true });
    text(pen, name, MARGIN + 64, top, { size: 8, maxWidth: mid - MARGIN - 70 });
    let yy = top;
    for (const line of extra) {
      yy -= 9;
      text(pen, line, MARGIN + 64, yy, { size: 7, maxWidth: mid - MARGIN - 70 });
    }
    return yy - 12;
  };
  let ly = y;
  ly = partyBlock("TO (GC / OWNER):", header.to.name, header.to.lines, ly);
  ly = partyBlock("FROM (CONTRACTOR):", header.from.name, header.from.lines, ly);
  ly = partyBlock("PROJECT:", header.project, header.projectLocation ? [header.projectLocation] : [], ly);
  ly = partyBlock("CONTRACT FOR:", header.contractFor ?? "", [], ly);
  ly = partyBlock("VIA (ARCHITECT):", "", [], ly);

  const field = (label: string, value: string | null, top: number) => {
    text(pen, label, mid, top, { size: 6.5, bold: true });
    if (value) text(pen, value, right, top, { size: 8, align: "right" });
    else hline(pen, mid + 110, right, top - 1.5, 0.4);
  };
  let ry = y;
  field("APPLICATION NO:", String(header.applicationNumber), ry);
  ry -= 14;
  field("PERIOD TO:", header.periodTo, ry);
  ry -= 14;
  field("APPLICATION DATE:", header.applicationDate, ry);
  ry -= 14;
  field("PROJECT / CONTRACT NO:", header.projectNumber, ry);
  ry -= 14;
  field("CONTRACT DATE:", header.contractDate, ry);
  ry -= 16;
  text(pen, "DISTRIBUTION TO:", mid, ry, { size: 6.5, bold: true });
  let bx = mid + 80;
  for (const who of ["Owner", "Architect", "Contractor"]) {
    box(pen, bx, ry - 2, 7, 7);
    text(pen, who, bx + 10, ry, { size: 6.5 });
    bx += 58;
  }

  y = Math.min(ly, ry - 18);
  hline(pen, MARGIN, right, y, 0.8);
  y -= 14;

  // The nine lines.
  text(pen, "CONTRACTOR'S APPLICATION FOR PAYMENT", MARGIN, y, { size: 9, bold: true });
  y -= 14;
  const amountX = MARGIN + 300;
  for (const line of G702_LINES) {
    text(pen, `${line.number}.`, MARGIN, y, { size: 8 });
    text(pen, line.label.toUpperCase(), MARGIN + 14, y, { size: 8, bold: line.key === "currentPaymentDue" });
    text(pen, money(lines[line.key]), amountX, y, { size: 8, align: "right", bold: line.key === "currentPaymentDue" });
    hline(pen, MARGIN + 14, amountX, y - 3, 0.3);
    y -= 13;
    if (line.key === "retainageToDate") {
      // The split the form offers and this app does not derive: the total
      // above is the sum of per-invoice snapshots, and no rate is reached
      // for here (lib/pay-application.ts, PayAppSummaryInput).
      blank(pen, "a.      % of completed work", MARGIN + 24, y, amountX - MARGIN - 24);
      y -= 11;
      blank(pen, "b.      % of stored material", MARGIN + 24, y, amountX - MARGIN - 24);
      y -= 13;
    }
  }

  // Change order summary, to the right of the lines.
  const coX = amountX + 16;
  const coW = right - coX;
  const coTop = y + 13 * 11 + 24;
  box(pen, coX, coTop - 86, coW, 86);
  text(pen, "CHANGE ORDER SUMMARY", coX + 4, coTop - 10, { size: 6.5, bold: true });
  text(pen, "ADDITIONS", coX + coW * 0.5, coTop - 22, { size: 6 });
  text(pen, "DEDUCTIONS", coX + coW * 0.77, coTop - 22, { size: 6 });
  hline(pen, coX, coX + coW, coTop - 25, 0.3);
  const coRows = ["Approved in previous months", "Approved this month", "TOTALS"];
  let cy = coTop - 36;
  for (const label of coRows) {
    text(pen, label, coX + 4, cy, { size: 6.5 });
    hline(pen, coX + coW * 0.48, coX + coW * 0.72, cy - 1.5, 0.3);
    hline(pen, coX + coW * 0.75, coX + coW - 4, cy - 1.5, 0.3);
    cy -= 12;
  }
  hline(pen, coX, coX + coW, cy + 6, 0.3);
  text(pen, "NET CHANGES BY CHANGE ORDER", coX + 4, cy - 4, { size: 6.5, bold: true });
  text(pen, money(lines.netChangeByChangeOrders), coX + coW - 4, cy - 4, { size: 7, align: "right" });

  // Certification and notary — fields only, no wording.
  y -= 10;
  hline(pen, MARGIN, right, y, 0.8);
  y -= 12;
  text(pen, "CONTRACTOR'S CERTIFICATION", MARGIN, y, { size: 8, bold: true });
  text(pen, "ARCHITECT'S / GC'S CERTIFICATE FOR PAYMENT", mid, y, { size: 8, bold: true });
  y -= 10;
  text(pen, "Certification and notary wording is left to the form your GC requires; this sheet fills in the figures only.", MARGIN, y, {
    size: 6,
  });
  y -= 16;
  const colW = mid - MARGIN - 16;
  const leftFields = [
    "Contractor:",
    "By (signature):",
    "Name and title:",
    "Date:",
    "State of:",
    "County of:",
    "Subscribed and sworn to before me this        day of                    ,",
    "Notary public:",
    "My commission expires:",
  ];
  const rightFields = ["Amount certified: $", "Architect / GC:", "By (signature):", "Name and title:", "Date:"];
  let fy = y;
  for (const label of leftFields) {
    blank(pen, label, MARGIN, fy, colW);
    fy -= 14;
  }
  let gy = y;
  for (const label of rightFields) {
    blank(pen, label, mid, gy, right - mid);
    gy -= 14;
  }
  text(
    pen,
    "If the amount certified differs from the amount applied for, the certifier initials the figures on this application and the continuation sheet that changed.",
    mid,
    gy - 2,
    { size: 5.5, maxWidth: right - mid },
  );
}

const G703_COLUMNS: Array<{ letter: string; title: string; width: number; align: "left" | "right"; cell: (r: G703Row) => string }> = [
  { letter: "A", title: "ITEM NO.", width: 34, align: "left", cell: (r) => String(r.itemNo) },
  { letter: "B", title: "DESCRIPTION OF WORK", width: 190, align: "left", cell: (r) => r.description },
  { letter: "C", title: "SCHEDULED VALUE", width: 76, align: "right", cell: (r) => money(r.scheduledValue) },
  { letter: "D", title: "FROM PREVIOUS APPLICATION", width: 76, align: "right", cell: (r) => money(r.fromPrevious) },
  { letter: "E", title: "THIS PERIOD", width: 72, align: "right", cell: (r) => money(r.thisPeriod) },
  { letter: "F", title: "MATERIALS PRESENTLY STORED (NOT IN D OR E)", width: 76, align: "right", cell: (r) => money(r.materialsStored) },
  { letter: "G", title: "TOTAL COMPLETED AND STORED TO DATE (D+E+F)", width: 78, align: "right", cell: (r) => money(r.totalCompletedAndStored) },
  { letter: "%", title: "(G / C)", width: 38, align: "right", cell: (r) => formatPercent(r.percent) },
  { letter: "H", title: "BALANCE TO FINISH (C - G)", width: 76, align: "right", cell: (r) => money(r.balanceToFinish) },
  // Blank on purpose: retainage is withheld per invoice, not per line.
  { letter: "I", title: "RETAINAGE (IF VARIABLE RATE)", width: 56, align: "right", cell: () => "" },
];

const G703_ROW_HEIGHT = 12;

function drawG703Header(pen: Pen, doc: G702Document, pageNo: number, pageCount: number) {
  const right = LETTER_LANDSCAPE[0] - MARGIN;
  let y = LETTER_LANDSCAPE[1] - MARGIN;
  text(pen, "CONTINUATION SHEET", MARGIN, y, { size: 13, bold: true });
  text(pen, `Page ${pageNo} of ${pageCount}`, right, y, { size: 7, align: "right" });
  y -= 10;
  text(pen, "Laid out to follow AIA Document G703. This is not an AIA form.", MARGIN, y, { size: 6.5 });
  y -= 13;
  const h = doc.header;
  text(pen, `APPLICATION NO: ${h.applicationNumber}`, MARGIN, y, { size: 7 });
  text(pen, `APPLICATION DATE: ${h.applicationDate}`, MARGIN + 150, y, { size: 7 });
  text(pen, `PERIOD TO: ${h.periodTo ?? "____________"}`, MARGIN + 320, y, { size: 7 });
  text(pen, `PROJECT: ${h.project}`, MARGIN + 470, y, { size: 7, maxWidth: right - MARGIN - 470 });
  y -= 18;

  // Column headers, two rows: letter, then title (wrapped by hand to three
  // words a line at most — the titles are fixed text).
  const top = y;
  let x = MARGIN;
  for (const col of G703_COLUMNS) {
    text(pen, col.letter, x + col.width / 2 - 2, top, { size: 7, bold: true });
    const words = col.title.split(" ");
    let line = "";
    let ty = top - 9;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (pen.font.widthOfTextAtSize(next, 5.5) > col.width - 4 && line) {
        text(pen, line, x + 2, ty, { size: 5.5 });
        ty -= 7;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) text(pen, line, x + 2, ty, { size: 5.5 });
    x += col.width;
  }
  y = top - 34;
  hline(pen, MARGIN, x, y, 0.8);
  hline(pen, MARGIN, x, top + 9, 0.8);
  return y;
}

function drawG703Row(pen: Pen, row: G703Row | null, totals: G702Document["continuation"]["totals"] | null, y: number) {
  let x = MARGIN;
  for (const col of G703_COLUMNS) {
    let value = "";
    if (row) value = col.cell(row);
    else if (totals) {
      value =
        col.letter === "A"
          ? ""
          : col.letter === "B"
            ? "GRAND TOTALS"
            : col.letter === "C"
              ? money(totals.scheduledValue)
              : col.letter === "D"
                ? money(totals.fromPrevious)
                : col.letter === "E"
                  ? money(totals.thisPeriod)
                  : col.letter === "F"
                    ? money(totals.materialsStored)
                    : col.letter === "G"
                      ? money(totals.totalCompletedAndStored)
                      : col.letter === "%"
                        ? formatPercent(totals.percent)
                        : col.letter === "H"
                          ? money(totals.balanceToFinish)
                          : "";
    }
    const bold = totals !== null;
    if (col.align === "right") text(pen, value, x + col.width - 3, y, { size: 7, align: "right", bold });
    else text(pen, value, x + 3, y, { size: 7, maxWidth: col.width - 6, bold });
    x += col.width;
  }
  hline(pen, MARGIN, x, y - 3.5, totals ? 0.8 : 0.25);
}

export async function buildG702Pdf(doc: G702Document): Promise<Uint8Array> {
  const pdf: PdfLib = await import("pdf-lib");
  const out = await pdf.PDFDocument.create();
  out.setTitle(`Application for payment #${doc.header.applicationNumber} - ${doc.header.project}`);
  const font = await out.embedFont(pdf.StandardFonts.Helvetica);
  const bold = await out.embedFont(pdf.StandardFonts.HelveticaBold);

  const ink = pdf.rgb(0, 0, 0);
  drawG702({ page: out.addPage(LETTER_PORTRAIT), font, bold, ink }, doc);

  const rows = doc.continuation.rows;
  const usable = LETTER_LANDSCAPE[1] - MARGIN - 88 - MARGIN - 20;
  const perPage = Math.max(1, Math.floor(usable / G703_ROW_HEIGHT) - 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < pageCount; p++) {
    const pen: Pen = { page: out.addPage(LETTER_LANDSCAPE), font, bold, ink };
    let y = drawG703Header(pen, doc, p + 1, pageCount) - 10;
    for (const row of rows.slice(p * perPage, (p + 1) * perPage)) {
      drawG703Row(pen, row, null, y);
      y -= G703_ROW_HEIGHT;
    }
    if (p === pageCount - 1) drawG703Row(pen, null, doc.continuation.totals, y - 2);
    // Column rules, drawn last so they sit over the row lines.
    let x = MARGIN;
    const top = LETTER_LANDSCAPE[1] - MARGIN - 45;
    for (const col of [...G703_COLUMNS, null]) {
      vline(pen, x, y - 8, top, 0.4);
      if (col) x += col.width;
    }
  }

  return out.save();
}

/** The file a download gets. Page-independent so the test can pin it. */
export function g702FileName(doc: G702Document): string {
  const project = doc.header.project.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `G702-G703 ${project} application ${doc.header.applicationNumber}.pdf`;
}
