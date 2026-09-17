import { lineTotal, orderTotal, unitTotals } from "@/components/purchaseOrderTotals";
import { money } from "@/lib/money";

/**
 * The purchase order as the vendor would read it.
 *
 * THIS IS THE EMAIL SEAM, AND IT DELIBERATELY DOES NOT SEND ANYTHING.
 * Sending a purchase order to a vendor is a real requirement and needs
 * outbound mail credentials this package does not have. The honest partial
 * is the half that does not need them: the document itself, rendered from
 * the rows, on screen, where the person raising the order can read exactly
 * what would go out and paste it into their own mail client today.
 *
 * So this is not a placeholder — it is called by `PurchaseOrderRow`'s
 * preview, which is why it is not the "written, documented, and never
 * called" shape CLAUDE.md warns about. Whoever wires up outbound mail
 * composes the message from THIS function rather than writing a second
 * copy of the layout, and adds the sent-evidence columns in the same change
 * that can actually set them.
 *
 * Plain text rather than HTML or PDF on purpose: it is the one format that
 * is legible in a terminal, in a test assertion, in an email body and in a
 * text box somebody pastes into. A PDF is a rendering decision that should
 * be made when there is a recipient to make it for.
 *
 * Every date here is ALREADY a string in `YYYY-MM-DD`, formatted by the
 * caller from a UTC-midnight column. Nothing in this file constructs or
 * formats a date, so there is no zone for it to get wrong.
 */

export type PurchaseOrderDocumentLine = {
  description: string;
  quantity: number;
  unit: string | null;
  unitCost: number;
  /** The SOV line this is bought against — what a contractor writes in the
   * phase/cost code column. Null when the line is not coded. */
  costCode: string | null;
};

export type PurchaseOrderDocument = {
  number: number;
  title: string;
  jobName: string;
  /** Us: the company doing the buying, and the address the invoice goes to. */
  billToName: string;
  billToAddress: string | null;
  vendorName: string;
  vendorNumber: string | null;
  vendorAddress: string | null;
  shipToAddress: string | null;
  paymentTerms: string | null;
  awardedOn: string;
  expectedOn: string | null;
  notes: string | null;
  lines: PurchaseOrderDocumentLine[];
};

function field(label: string, value: string | null): string[] {
  return value ? [`${label}: ${value}`] : [];
}

/** An address is entered as free text and may be several lines. Indented
 * under its own heading so a three-line address does not read as three
 * unrelated facts. */
function block(label: string, value: string | null): string[] {
  if (!value) return [];
  return [`${label}:`, ...value.split("\n").map((line) => `  ${line.trim()}`)];
}

export function renderPurchaseOrderDocument(order: PurchaseOrderDocument): string {
  const out: string[] = [];

  out.push(`PURCHASE ORDER ${order.number}`);
  out.push(order.title);
  out.push("");
  out.push(`Job: ${order.jobName}`);
  out.push(...field("Awarded", order.awardedOn));
  out.push(...field("Expected", order.expectedOn));
  out.push(...field("Terms", order.paymentTerms));
  out.push("");

  out.push(`Vendor: ${order.vendorName}`);
  out.push(...field("Vendor number", order.vendorNumber));
  out.push(...block("Vendor address", order.vendorAddress));
  out.push("");

  out.push(`Bill to: ${order.billToName}`);
  out.push(...block("Bill to address", order.billToAddress));
  out.push(...block("Ship to", order.shipToAddress));
  out.push("");

  if (order.lines.length === 0) {
    out.push("No line items on this order yet.");
  } else {
    out.push("LINE ITEMS");
    for (const [index, line] of order.lines.entries()) {
      const quantity = line.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 });
      const unit = line.unit ? ` ${line.unit}` : "";
      out.push(
        `${index + 1}. ${line.description}` +
          `${line.costCode ? ` [${line.costCode}]` : ""}` +
          ` — ${quantity}${unit} @ ${money(line.unitCost)} = ${money(lineTotal(line))}`,
      );
    }
    out.push("");
    for (const total of unitTotals(order.lines)) {
      out.push(
        `Total ${total.unit}: ${total.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      );
    }
    out.push(`ORDER TOTAL: ${money(orderTotal(order.lines))}`);
  }

  if (order.notes) {
    out.push("");
    out.push("Notes:");
    out.push(...order.notes.split("\n").map((line) => `  ${line.trim()}`));
  }

  return out.join("\n");
}
