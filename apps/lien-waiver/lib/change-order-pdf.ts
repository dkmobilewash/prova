import { formatCents, formatHundredths, LINE_KINDS, LINE_LABELS, PCO_STATUSES, type CheckedChangeOrder } from "./change-order";
import { BODY_PT, CAPTION_PT, Flow, INK, MARGIN, PAGE, QUIET, TITLE_PT } from "./pdf";

/**
 * The change order request as a PDF, with the waiver's page, margins, type
 * sizes and pen-advance measuring (lib/pdf.ts `Flow`) -- the same reasons
 * apply: a phone's print path is unreliable, and a drawn PDF opens anywhere.
 *
 * Not a statutory form, so there is no copied text to preserve: this is the
 * sub's own request, laid out the way a GC's office reads one -- who, which
 * job, what changed, the priced lines, the total, the days, the backup, and
 * a blank signature block for the GC.
 */

const HEADING_PT = 11;

/** Right edges of the money columns, and where the description column ends. */
const COL = { qty: 380, price: 470, amount: PAGE.width - MARGIN.x, descriptionWidth: 260 } as const;

export const PCO_FOOTER = "Prepared with C-Stream's free change order request tool. C-Stream is not a law firm and does not give legal advice.";

export async function renderChangeOrderPdf(order: CheckedChangeOrder, preparedBy: string): Promise<Uint8Array> {
  const f = await Flow.create(
    `Change order request${order.pcoNumber ? ` ${order.pcoNumber}` : ""}: ${order.title}`,
    "C-Stream free change order request tool",
  );
  const { regular, bold } = f;
  const field = (label: string, value: string) => f.write(`${label}: ${value}`, { before: 2 });

  // Who, which job, and where it stands.
  f.write(`CHANGE ORDER REQUEST${order.pcoNumber ? ` NO. ${order.pcoNumber}` : ""}`, { size: TITLE_PT + 4, font: bold, color: INK });
  f.write(`Status: ${PCO_STATUSES[1]}`, { font: bold, before: 4 });
  field("Date", order.date);
  f.write("From (subcontractor)", { font: bold, size: HEADING_PT, before: 10 });
  field("Company", order.companyName);
  field("Prepared by", preparedBy);
  f.write("To (general contractor)", { font: bold, size: HEADING_PT, before: 10 });
  field("Company", order.gc);
  f.write("Project", { font: bold, size: HEADING_PT, before: 10 });
  field("Name", order.project);
  if (order.projectAddress) field("Address", order.projectAddress);

  f.write("Description of the change", { font: bold, size: HEADING_PT, before: 12 });
  f.write(order.title, { font: bold, before: 2 });
  f.write(order.description, { before: 2 });

  // The priced lines, one block per kind that has any.
  f.write("Cost", { font: bold, size: HEADING_PT, before: 14 });
  for (const kind of LINE_KINDS) {
    const lines = order.lines[kind];
    if (!lines.length) continue;
    f.ensure(BODY_PT * 4);
    f.y -= 8;
    f.y -= BODY_PT * 1.35;
    f.page.drawText(LINE_LABELS[kind].title, { x: MARGIN.x, y: f.y, size: BODY_PT, font: bold, color: INK });
    f.right("Qty", COL.qty, bold);
    f.right("Unit price", COL.price, bold);
    f.right("Amount", COL.amount, bold);
    for (const line of lines) {
      const wrapped = f.wrap(line.description, regular, BODY_PT, COL.descriptionWidth);
      f.ensure(BODY_PT * 1.35 * wrapped.length);
      wrapped.forEach((part, index) => {
        f.y -= BODY_PT * 1.35;
        f.page.drawText(part, { x: MARGIN.x, y: f.y, size: BODY_PT, font: regular, color: INK });
        if (index === 0) {
          f.right(`${line.quantity} ${line.unit}`, COL.qty);
          f.right(`$${line.unitPrice}`, COL.price);
          f.right(`$${formatCents(line.amountCents)}`, COL.amount);
        }
      });
    }
    f.y -= BODY_PT * 1.35;
    f.right(`${LINE_LABELS[kind].title} subtotal`, COL.price, bold);
    f.right(`$${formatCents(order.subtotals[kind])}`, COL.amount, bold);
  }
  if (LINE_KINDS.every((kind) => !order.lines[kind].length)) f.write("No priced lines.", { before: 4, color: QUIET });

  f.ensure(BODY_PT * 6);
  f.y -= 6;
  f.rule();
  f.y -= 4;
  for (const [label, cents, font] of [
    ["Subtotal", order.subtotalCents, regular],
    [`Markup (${formatHundredths(order.markupBasisPoints)}%)`, order.markupCents, regular],
    ["Total requested", order.totalCents, bold],
  ] as const) {
    f.y -= BODY_PT * 1.5;
    f.right(label, COL.price, font);
    f.right(`$${formatCents(cents)}`, COL.amount, font);
  }

  f.write("Schedule impact", { font: bold, size: HEADING_PT, before: 14 });
  f.write(`${order.scheduleDays} ${order.scheduleDays === 1 ? "day" : "days"} added to the schedule.`, { before: 2 });

  f.write("Backup", { font: bold, size: HEADING_PT, before: 12 });
  if (order.backup.length) {
    f.write("Listed by the subcontractor and sent separately; not part of this PDF:", { before: 2, color: QUIET });
    for (const name of order.backup) f.write(`- ${name}`, { x: MARGIN.x + 12, before: 1 });
  } else {
    f.write("None listed.", { before: 2, color: QUIET });
  }

  // The GC's block: blank lines for a pen, or for a PDF signature.
  f.ensure(150);
  f.write("General contractor acceptance", { font: bold, size: HEADING_PT, before: 18 });
  f.write(`On signature below, the status of this request is ${PCO_STATUSES[2]}.`, { before: 2, size: CAPTION_PT + 1, color: QUIET });
  for (const label of ["Signature", "Name", "Title", "Date"]) {
    f.y -= 26;
    f.page.drawText(`${label}:`, { x: MARGIN.x, y: f.y, size: BODY_PT, font: regular, color: INK });
    f.page.drawLine({ start: { x: MARGIN.x + 60, y: f.y - 1.5 }, end: { x: MARGIN.x + 340, y: f.y - 1.5 }, thickness: 0.6, color: INK });
  }

  return f.finish(PCO_FOOTER);
}
