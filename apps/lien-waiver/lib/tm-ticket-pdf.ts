import { LineCapStyle } from "pdf-lib";
import { BODY_PT, CAPTION_PT, Flow, INK, MARGIN, PAGE, QUIET, TITLE_PT } from "./pdf";
import { SIGNATURE_BOX, TM_LINE_KINDS, TM_LINE_LABELS, type CheckedTicket } from "./tm-ticket";

/**
 * The T&M / extra-work ticket as a PDF, on the same Flow as the change order
 * request (lib/pdf.ts): who, which job, the day, what the work was, the crew
 * and their hours, what was used, and the superintendent's signature as it
 * was drawn on the phone, with the name and title they typed under it.
 *
 * Hours and quantities only -- there is no money anywhere on this page, and
 * content.test.ts fails the build if a "$" or a price word reaches it.
 */

const HEADING_PT = 11;
/** The signature is drawn at this fraction of SIGNATURE_BOX: 270 x 90 pt. */
const SIGNATURE_SCALE = 0.45;
const COL = { hours: 300, qty: 380, unitX: 392, descriptionX: 450 } as const;

export const TM_FOOTER = "Prepared with C-Stream's free T&M ticket tool. C-Stream is not a law firm and does not give legal advice.";

export async function renderTicketPdf(ticket: CheckedTicket, foreman: string): Promise<Uint8Array> {
  const f = await Flow.create(`T&M ticket ${ticket.number}: ${ticket.summary}`, "C-Stream free T&M ticket tool");
  const { regular, bold } = f;
  const field = (label: string, value: string) => f.write(`${label}: ${value}`, { before: 2 });
  const heading = (text: string, before = 10) => f.write(text, { font: bold, size: HEADING_PT, before });

  f.write(`T&M / EXTRA WORK TICKET NO. ${ticket.number}`, { size: TITLE_PT + 4, font: bold });
  field("Date of work", ticket.date);
  heading("From (subcontractor)");
  field("Company", ticket.companyName);
  field("Foreman", foreman);
  heading("To (general contractor)");
  field("Company", ticket.gc);
  heading("Project");
  field("Name", ticket.project);

  heading("Extra work", 12);
  f.write(ticket.summary, { font: bold, before: 2 });
  if (ticket.details) f.write(ticket.details, { before: 2 });

  // The crew and their hours.
  heading("Crew", 14);
  f.ensure(BODY_PT * 3);
  f.y -= BODY_PT * 1.35;
  f.page.drawText("Name", { x: MARGIN.x, y: f.y, size: BODY_PT, font: bold, color: INK });
  f.right("Hours", COL.hours, bold);
  for (const member of ticket.crew) {
    f.ensure(BODY_PT * 1.35);
    f.y -= BODY_PT * 1.35;
    f.page.drawText(member.name, { x: MARGIN.x, y: f.y, size: BODY_PT, font: regular, color: INK });
    f.right(member.hours, COL.hours);
  }
  f.y -= BODY_PT * 1.5;
  f.right(`Total crew hours: ${ticket.totalHours}`, COL.hours, bold);

  // What was used, one block per kind that has any.
  for (const kind of TM_LINE_KINDS) {
    const lines = ticket[kind];
    heading(TM_LINE_LABELS[kind].title, 14);
    if (!lines.length) {
      f.write("None listed.", { before: 2, color: QUIET });
      continue;
    }
    f.ensure(BODY_PT * 3);
    f.y -= BODY_PT * 1.35;
    f.right("Qty", COL.qty, bold);
    f.page.drawText("Unit", { x: COL.unitX, y: f.y, size: BODY_PT, font: bold, color: INK });
    f.page.drawText("Description", { x: MARGIN.x, y: f.y, size: BODY_PT, font: bold, color: INK });
    for (const line of lines) {
      const wrapped = f.wrap(line.description, regular, BODY_PT, COL.qty - MARGIN.x - 60);
      f.ensure(BODY_PT * 1.35 * wrapped.length);
      wrapped.forEach((part, index) => {
        f.y -= BODY_PT * 1.35;
        f.page.drawText(part, { x: MARGIN.x, y: f.y, size: BODY_PT, font: regular, color: INK });
        if (index === 0) {
          f.right(line.quantity, COL.qty);
          f.page.drawText(line.unit, { x: COL.unitX, y: f.y, size: BODY_PT, font: regular, color: INK });
        }
      });
    }
  }

  // The superintendent's signature, as drawn.
  const signatureHeight = SIGNATURE_BOX.height * SIGNATURE_SCALE;
  f.ensure(signatureHeight + 110);
  heading("General contractor's superintendent", 18);
  f.write("Signed on the foreman's phone to acknowledge the work, hours and quantities listed above.", { before: 2, size: CAPTION_PT + 1, color: QUIET });
  f.y -= 6;
  f.page.drawSvgPath(ticket.signature, {
    x: MARGIN.x,
    y: f.y,
    scale: SIGNATURE_SCALE,
    borderColor: INK,
    // Line width is in the path's own (unscaled) units: 1.35 pt on paper.
    borderWidth: 3,
    borderLineCap: LineCapStyle.Round,
  });
  f.y -= signatureHeight;
  f.page.drawLine({ start: { x: MARGIN.x, y: f.y - 2 }, end: { x: MARGIN.x + SIGNATURE_BOX.width * SIGNATURE_SCALE, y: f.y - 2 }, thickness: 0.6, color: INK });
  f.y -= 4;
  field("Name", ticket.superName);
  field("Title", ticket.superTitle);
  field("Email", ticket.superEmail);
  f.write(`This PDF is emailed to the foreman and to ${ticket.superEmail} together.`, { before: 8, size: CAPTION_PT + 1, color: QUIET, width: PAGE.width - 2 * MARGIN.x });

  return f.finish(TM_FOOTER);
}
