import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCents, formatHundredths, LINE_KINDS, LINE_LABELS, PCO_STATUSES, type CheckedChangeOrder } from "./change-order";
import { advance, BODY_PT, CAPTION_PT, FRAME_PT, MARGIN, PAGE, TITLE_PT } from "./pdf";

/**
 * The change order request as a PDF, with the waiver's page, margins, type
 * sizes and pen-advance measuring (lib/pdf.ts) -- the same reasons apply:
 * a phone's print path is unreliable, and a drawn PDF opens anywhere.
 *
 * Not a statutory form, so there is no copied text to preserve: this is the
 * sub's own request, laid out the way a GC's office reads one -- who, which
 * job, what changed, the priced lines, the total, the days, the backup, and
 * a blank signature block for the GC.
 */

const INK = rgb(0.07, 0.07, 0.07);
const QUIET = rgb(0.38, 0.38, 0.38);
const HEADING_PT = 11;

/** Right edges of the money columns, and where the description column ends. */
const COL = { qty: 380, price: 470, amount: PAGE.width - MARGIN.x, descriptionWidth: 260 } as const;

export const PCO_FOOTER = "Prepared with C-Stream's free change order request tool. C-Stream is not a law firm and does not give legal advice.";

export async function renderChangeOrderPdf(order: CheckedChangeOrder, preparedBy: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Change order request${order.pcoNumber ? ` ${order.pcoNumber}` : ""}: ${order.title}`);
  doc.setCreator("C-Stream free change order request tool");
  doc.setProducer("C-Stream");

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = PAGE.height - MARGIN.top;
  };
  newPage();
  const bottom = MARGIN.bottom + 18;
  const ensure = (height: number) => {
    if (y - height < bottom) newPage();
  };

  /** Wrap `text` to `width`, breaking only between words. */
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && advance(font, candidate, size) > width) {
          out.push(line);
          line = word;
        } else line = candidate;
      }
      out.push(line);
    }
    return out;
  };

  const write = (text: string, opts: { size?: number; font?: PDFFont; x?: number; width?: number; before?: number; color?: typeof INK } = {}) => {
    const size = opts.size ?? BODY_PT;
    const font = opts.font ?? regular;
    const x = opts.x ?? MARGIN.x;
    y -= opts.before ?? 0;
    for (const line of wrap(text, font, size, opts.width ?? PAGE.width - MARGIN.x - x)) {
      ensure(size * 1.35);
      y -= size * 1.35;
      if (line) page.drawText(line, { x, y, size, font, color: opts.color ?? INK });
    }
  };

  const right = (text: string, edge: number, font: PDFFont = regular, size = BODY_PT) =>
    page.drawText(text, { x: edge - advance(font, text, size), y, size, font, color: INK });

  const rule = (thickness = 0.6) => page.drawLine({ start: { x: MARGIN.x, y: y - 4 }, end: { x: PAGE.width - MARGIN.x, y: y - 4 }, thickness, color: INK });

  const field = (label: string, value: string) => write(`${label}: ${value}`, { before: 2 });

  // Who, which job, and where it stands.
  write(`CHANGE ORDER REQUEST${order.pcoNumber ? ` NO. ${order.pcoNumber}` : ""}`, { size: TITLE_PT + 4, font: bold });
  write(`Status: ${PCO_STATUSES[1]}`, { font: bold, before: 4 });
  field("Date", order.date);
  write("From (subcontractor)", { font: bold, size: HEADING_PT, before: 10 });
  field("Company", order.companyName);
  field("Prepared by", preparedBy);
  write("To (general contractor)", { font: bold, size: HEADING_PT, before: 10 });
  field("Company", order.gc);
  write("Project", { font: bold, size: HEADING_PT, before: 10 });
  field("Name", order.project);
  if (order.projectAddress) field("Address", order.projectAddress);

  write("Description of the change", { font: bold, size: HEADING_PT, before: 12 });
  write(order.title, { font: bold, before: 2 });
  write(order.description, { before: 2 });

  // The priced lines, one block per kind that has any.
  write("Cost", { font: bold, size: HEADING_PT, before: 14 });
  for (const kind of LINE_KINDS) {
    const lines = order.lines[kind];
    if (!lines.length) continue;
    ensure(BODY_PT * 4);
    y -= 8;
    y -= BODY_PT * 1.35;
    page.drawText(LINE_LABELS[kind].title, { x: MARGIN.x, y, size: BODY_PT, font: bold, color: INK });
    right("Qty", COL.qty, bold);
    right("Unit price", COL.price, bold);
    right("Amount", COL.amount, bold);
    for (const line of lines) {
      const wrapped = wrap(line.description, regular, BODY_PT, COL.descriptionWidth);
      ensure(BODY_PT * 1.35 * wrapped.length);
      wrapped.forEach((part, index) => {
        y -= BODY_PT * 1.35;
        page.drawText(part, { x: MARGIN.x, y, size: BODY_PT, font: regular, color: INK });
        if (index === 0) {
          right(`${line.quantity} ${line.unit}`, COL.qty);
          right(`$${line.unitPrice}`, COL.price);
          right(`$${formatCents(line.amountCents)}`, COL.amount);
        }
      });
    }
    y -= BODY_PT * 1.35;
    right(`${LINE_LABELS[kind].title} subtotal`, COL.price, bold);
    right(`$${formatCents(order.subtotals[kind])}`, COL.amount, bold);
  }
  if (LINE_KINDS.every((kind) => !order.lines[kind].length)) write("No priced lines.", { before: 4, color: QUIET });

  ensure(BODY_PT * 6);
  y -= 6;
  rule();
  y -= 4;
  for (const [label, cents, font] of [
    ["Subtotal", order.subtotalCents, regular],
    [`Markup (${formatHundredths(order.markupBasisPoints)}%)`, order.markupCents, regular],
    ["Total requested", order.totalCents, bold],
  ] as const) {
    y -= BODY_PT * 1.5;
    right(label, COL.price, font);
    right(`$${formatCents(cents)}`, COL.amount, font);
  }

  write("Schedule impact", { font: bold, size: HEADING_PT, before: 14 });
  write(`${order.scheduleDays} ${order.scheduleDays === 1 ? "day" : "days"} added to the schedule.`, { before: 2 });

  write("Backup", { font: bold, size: HEADING_PT, before: 12 });
  if (order.backup.length) {
    write("Listed by the subcontractor and sent separately; not part of this PDF:", { before: 2, color: QUIET });
    for (const name of order.backup) write(`- ${name}`, { x: MARGIN.x + 12, before: 1 });
  } else {
    write("None listed.", { before: 2, color: QUIET });
  }

  // The GC's block: blank lines for a pen, or for a PDF signature.
  ensure(150);
  write("General contractor acceptance", { font: bold, size: HEADING_PT, before: 18 });
  write(`On signature below, the status of this request is ${PCO_STATUSES[2]}.`, { before: 2, size: CAPTION_PT + 1, color: QUIET });
  for (const label of ["Signature", "Name", "Title", "Date"]) {
    y -= 26;
    page.drawText(`${label}:`, { x: MARGIN.x, y, size: BODY_PT, font: regular, color: INK });
    page.drawLine({ start: { x: MARGIN.x + 60, y: y - 1.5 }, end: { x: MARGIN.x + 340, y: y - 1.5 }, thickness: 0.6, color: INK });
  }

  pages.forEach((current, index) => {
    current.drawText(PCO_FOOTER, { x: MARGIN.x, y: MARGIN.bottom - 10, size: FRAME_PT, font: regular, color: QUIET });
    current.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: MARGIN.x,
      y: MARGIN.bottom - 10 - (FRAME_PT + 3),
      size: FRAME_PT,
      font: regular,
      color: QUIET,
    });
  });

  return doc.save();
}
