import { prisma } from "@prova/db";
import { findJob } from "./findJob";
import { rankByName } from "../resolve";
import { matchScore, matchWords } from "../spoken";
import type { CommandContext, CommandDefinition, CommandInput, HandoffCommandDefinition, Resolution } from "../commands";

/**
 * A purchase order line, as a HANDOFF onto the job's Buyout page.
 *
 * "Make a PO to ABC Supply for 200 sheets of 5/8 type X" names a vendor, a
 * quantity and a material. Code finds the vendor and the estimate line the
 * material belongs to; the card opens that line's row on /buyout with the
 * quantity and vendor filled in. The PRICE is never on the card: the row
 * offers the vendor's quote on file or a typed price, which is the
 * comparison the page exists for (billing.ts's old exclusion reason). Add
 * to draft PO is the write; issuing and sending stay their own buttons.
 */

const MAX_CHOICES = 6;
const QUANTITY = /^\d+(?:\.\d+)?$/;

async function resolveDraftPurchaseOrder(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const status = await prisma.job.findFirst({ where: { id: job.id, companyId: ctx.companyId }, select: { status: true } });
  if (status?.status === "ESTIMATE") {
    return { kind: "refuse", reason: `${job.name} is still an estimate. Buyout opens once it is contracted.` };
  }

  // Vendor: a chip's id, re-asserted in-company, or the name said.
  let vendor: { id: string; name: string } | null = null;
  if (input.vendorId) {
    vendor = await prisma.vendor.findFirst({ where: { id: input.vendorId, companyId: ctx.companyId }, select: { id: true, name: true } });
    if (!vendor) return { kind: "refuse", reason: "That vendor isn't on your account." };
  } else {
    const said = input.vendorName ?? "";
    if (!said) return { kind: "need", missing: "which vendor the PO is to" };
    const rows = rankByName(
      await prisma.vendor.findMany({
        where: { companyId: ctx.companyId, name: { contains: said, mode: "insensitive" } },
        select: { id: true, name: true },
        take: 20,
      }),
      said,
    );
    if (rows.length === 0) return { kind: "refuse", reason: `No vendor called "${said}" on your account. Add them first.`, href: "/vendors" };
    if (rows.length > 1) {
      return { kind: "clarify", field: "vendorId", question: "Which vendor?", options: rows.slice(0, MAX_CHOICES).map((r) => ({ value: r.id, label: r.name })) };
    }
    vendor = rows[0];
  }

  // The estimate line the material belongs to.
  const lines = await prisma.jobLineItem.findMany({
    where: { jobId: job.id, isDeleted: false, NOT: { costCategory: "LABOR" } },
    select: { id: true, description: true, unit: true },
    orderBy: { createdAt: "asc" },
  });
  let line: (typeof lines)[number] | undefined;
  if (input.lineItemId) {
    line = lines.find((l) => l.id === input.lineItemId);
    if (!line) return { kind: "refuse", reason: "That line is no longer on this job." };
  } else {
    const material = input.material ?? "";
    if (!material) return { kind: "need", missing: "what material the PO is for" };
    const words = matchWords(material);
    const scored = lines.map((l) => ({ l, score: matchScore(words, l.description) }));
    const top = Math.max(0, ...scored.map((s) => s.score));
    const best = scored.filter((s) => top > 0 && s.score === top).map((s) => s.l);
    if (best.length === 0) {
      return {
        kind: "refuse",
        reason: `Nothing on ${job.name}'s estimate matches "${material}". A PO line is bought against an estimate line; add the line first, or pick it on Buyout.`,
        href: `/jobs/${job.id}/buyout`,
      };
    }
    if (best.length > 1) {
      return { kind: "clarify", field: "lineItemId", question: "Which line on the estimate?", options: best.slice(0, MAX_CHOICES).map((l) => ({ value: l.id, label: l.description, detail: l.unit ?? undefined })) };
    }
    line = best[0];
  }

  const quantity = (input.quantity ?? "").replace(/,/g, "").trim();
  if (!quantity) return { kind: "need", missing: `how many ${line.unit ?? "units"} of ${line.description}` };
  if (!QUANTITY.test(quantity) || Number(quantity) <= 0) {
    return { kind: "need", missing: `the quantity as a number — "${input.quantity}" is not one` };
  }

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, vendorId: vendor.id, vendorName: vendor.name, lineItemId: line.id, lineDescription: line.description, quantity },
    preview: [
      { label: "Job", value: job.name },
      { label: "Vendor", value: vendor.name },
      { label: "Line", value: line.description },
      { label: "Quantity", value: `${quantity}${line.unit ? ` ${line.unit}` : ""}` },
      { label: "Price", value: "picked on Buyout — the vendor's quote on file, or typed" },
      { label: "Sent", value: "no — it lands on a draft PO; issuing and sending are their own buttons" },
    ],
    warnings: [],
  };
}

export const draftPurchaseOrderCommand: HandoffCommandDefinition = {
  name: "draft_purchase_order",
  description:
    "Starts a purchase order line on a contracted job: finds the vendor and the estimate line the material belongs to, and opens that line on the job's Buyout page with the vendor and quantity filled in, e.g. 'make a PO to ABC Supply for 200 sheets of 5/8 type X on Hutto'. The person picks the price there and presses Add to draft PO. Needs the job, the vendor, the material and the quantity in the person's words. Does not set a price, issue the PO, send it to the vendor, close it or remove a line, and does not add a material that is not already a line on the estimate.",
  capability: "VIEW_JOB_COSTS",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "draftPurchaseOrderLine",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/buyout?draft=${proposalId}`,
  title: "Start a purchase order",
  verb: "Preparing the purchase order",
  button: "Open Buyout",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      vendorName: { type: "string", description: "The vendor or supplier, as the person named it, e.g. ABC Supply." },
      material: { type: "string", description: "The material in the person's words, e.g. '5/8 type X'. Keep fractions and trade words as said." },
      quantity: { type: "string", description: "How many, as digits exactly as said, e.g. 200. Never compute it." },
    },
  },
  continuationKeys: ["jobId", "vendorId", "lineItemId"],
  resolve: resolveDraftPurchaseOrder,
};

export const purchaseOrderCommands: CommandDefinition[] = [draftPurchaseOrderCommand];
