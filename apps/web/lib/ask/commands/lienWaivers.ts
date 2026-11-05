import { prisma } from "@prova/db";
import { findJob } from "./findJob";
import { loadPayApplication } from "@/lib/pay-application-query";
import { isFinalBilling } from "@/lib/billing/closeout-billing";
import { waiverOfferFor } from "@/lib/lien-waiver-followups";
import { money } from "@/lib/money";
import type { CommandContext, CommandDefinition, CommandInput, HandoffCommandDefinition, Resolution } from "../commands";

/**
 * A lien waiver for a pay application, as a HANDOFF onto the Billing tab.
 *
 * It is the Billing tab's own offer ("Issue the conditional progress waiver
 * for application #4"), reached by a sentence: `waiverOfferFor` decides the
 * amount (the application's current payment due, G702 line 8), the through
 * date (its period-to) and progress or final, exactly as the page does, and
 * the card opens the SAME issue form. THE EXCEPTIONS ARE NEVER IN IT: the
 * excepted amount is the one figure this app refuses to fill in for anybody
 * (lib/lien-waiver.ts), so the payload has no field for it and the form
 * opens with it empty. Issuing is the form's button; sending the waiver or
 * its signing link to the GC stays on the waiver's own row.
 */

async function resolvePrepareLienWaiver(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const said = (input.payAppNumber ?? "").replace(/^#/, "").trim();
  if (!said) return { kind: "need", missing: "which pay application the waiver is for, by number" };
  if (!/^\d+$/.test(said)) return { kind: "need", missing: `the pay application's number — "${input.payAppNumber}" is not one` };

  const invoice = await prisma.invoice.findFirst({
    where: { jobId: job.id, number: Number(said) },
    select: { id: true, number: true, periodTo: true },
  });
  if (!invoice) return { kind: "refuse", reason: `${job.name} has no pay application #${said}.`, href: `/jobs/${job.id}/billing` };
  const certificate = await loadPayApplication(job.id, invoice.id, ctx.companyId);
  if (!certificate?.isPayApplication) {
    return { kind: "refuse", reason: `#${said} on ${job.name} is an invoice, not a pay application; issue its waiver on the Billing tab.`, href: `/jobs/${job.id}/billing#lien-waivers` };
  }
  const existing = await prisma.lienWaiver.findFirst({ where: { invoiceId: invoice.id, revokedAt: null }, select: { id: true } });
  const offer = waiverOfferFor({
    invoiceId: invoice.id,
    number: invoice.number,
    currentPaymentDue: certificate.summary.currentPaymentDue,
    periodTo: invoice.periodTo,
    final: isFinalBilling(certificate.summary),
    hasWaiver: false,
  });
  if (!offer) return { kind: "refuse", reason: `Nothing is due on application #${said}, so there is no payment for a waiver to cover.` };

  return {
    kind: "ready",
    resolved: { form: "waiver", jobId: job.id, jobName: job.name, invoiceId: offer.invoiceId, invoiceNumber: offer.invoiceNumber, amount: offer.amount, throughDate: offer.throughDate, stage: offer.stage },
    preview: [
      { label: "Job", value: job.name },
      { label: "Waiver", value: `conditional ${offer.stage === "FINAL" ? "final" : "progress"}, for application #${offer.invoiceNumber}` },
      { label: "Amount", value: `${money(offer.amount)} — that application's current payment due` },
      { label: "Through", value: offer.throughDate ?? "entered on the form (the application has no period-to)" },
      { label: "Exceptions", value: "blank — you fill them in on the form; the app never does" },
      { label: "Sent", value: "no — issue it on the form, then send it from the waiver's row" },
    ],
    warnings: [],
    ...(existing ? { existing: { label: `Application #${offer.invoiceNumber} already has a waiver`, href: `/jobs/${job.id}/billing#lien-waivers` } } : {}),
  };
}

export const prepareLienWaiverCommand: HandoffCommandDefinition = {
  name: "prepare_lien_waiver",
  description:
    "Prepares the lien waiver for a pay application: opens the job's Issue a waiver form with the conditional progress (or final) waiver, the amount due and the through date that application carries, e.g. 'send the lien waiver for Hutto pay app 4'. The person reads it, fills in any exceptions, and issues it there; sending it is a separate button on the waiver. Needs the job and the pay application number. Does not fill in exceptions or an excepted amount, does not send, sign, mark signed, correct or withdraw a waiver, and does not choose an unconditional form.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "createLienWaiver",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/billing?draft=${proposalId}`,
  title: "Prepare the lien waiver",
  verb: "Preparing the lien waiver",
  button: "Open the waiver form",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      payAppNumber: { type: "string", description: "The pay application number as said, digits only, e.g. 4." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolvePrepareLienWaiver,
};

export const lienWaiverCommands: CommandDefinition[] = [prepareLienWaiverCommand];
