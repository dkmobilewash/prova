import { prisma } from "@prova/db";
import { findJob } from "./findJob";
import { periodEndFromWords, dayLabel } from "../dates";
import { parseAmount } from "../numbers";
import { loadJobRetainage } from "@/lib/billing/retainage-release";
import { money } from "@/lib/money";
import type { CommandContext, CommandDefinition, CommandInput, HandoffCommandDefinition, Resolution } from "../commands";

/**
 * Billing a period, and billing the retainage at closeout, as HANDOFFs onto
 * the job's Billing tab.
 *
 * A pay application is a per-line G702/G703 composed from the schedule of
 * values — the reason `submitPayApplication` was never a card. The card does
 * not try to carry the continuation sheet: it opens the form with the
 * period filled in and the person enters each line's work there. The
 * retainage application opens with the held balance the form already
 * defaults to (or the figure the person said). Each form's own button is
 * the write; neither sends anything to the GC.
 */

async function contractedJob(ctx: CommandContext, input: CommandInput) {
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const row = await prisma.job.findFirst({ where: { id: located.job.id, companyId: ctx.companyId }, select: { status: true } });
  if (row?.status === "ESTIMATE") {
    return { kind: "refuse", reason: `${located.job.name} is still an estimate. Contract it before billing it.` } as const;
  }
  return located;
}

const NOT_SENT = "no — creating it on the form does not send it to the GC";

async function resolveStartPayApplication(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await contractedJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  if (!input.period) return { kind: "need", missing: "which period the pay application covers, e.g. October" };
  const periodTo = periodEndFromWords(input.period, ctx.today);
  if (!periodTo) return { kind: "need", missing: `the period as a month or a date — "${input.period}" is not one` };

  const lines = await prisma.jobLineItem.count({ where: { jobId: job.id, isDeleted: false } });
  if (lines === 0) {
    return { kind: "refuse", reason: `${job.name} has no schedule of values to bill against yet.`, href: `/jobs/${job.id}/estimate` };
  }
  const same = await prisma.invoice.findFirst({
    where: { jobId: job.id, periodTo: new Date(`${periodTo}T00:00:00.000Z`) },
    select: { number: true },
  });
  const counter = await prisma.invoiceCounter.findUnique({ where: { jobId: job.id }, select: { lastNumber: true } });
  const next = (counter?.lastNumber ?? 0) + 1;

  return {
    kind: "ready",
    resolved: { form: "pay_application", jobId: job.id, jobName: job.name, periodTo },
    preview: [
      { label: "Job", value: job.name },
      { label: "Period to", value: dayLabel(periodTo) },
      { label: "Application", value: `#${next} — numbered when you submit it` },
      { label: "This period's work", value: "entered per line on the form, from the schedule of values" },
      { label: "Sent", value: NOT_SENT },
    ],
    warnings: [],
    ...(same ? { existing: { label: `Application #${same.number} already runs to ${dayLabel(periodTo)}`, href: `/jobs/${job.id}/billing` } } : {}),
  };
}

export const startPayApplicationCommand: HandoffCommandDefinition = {
  name: "start_pay_application",
  description:
    "Starts a pay application (AIA G702/G703) for a period on a contracted job: opens the job's pay application form with the period-to filled in, e.g. 'bill Fulton for October' or 'start pay app 5 on Hutto through October 31'. The person enters each line's work there and submits it, which numbers it. Use this when the person names a PERIOD or says pay app/application and gives no amount; an invoice for an amount they state is draft_invoice. Needs the job and the period. Does not fill in percent complete or any line, does not compute an amount, and does not send, submit or mark anything with the GC.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "submitPayApplication",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/billing?draft=${proposalId}`,
  title: "Start a pay application",
  verb: "Preparing the pay application",
  button: "Open the pay application",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      period: { type: "string", description: "The period in the person's words, e.g. 'October' or 'October 31'. Never compute a date." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveStartPayApplication,
};

async function resolveBillRetainage(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const located = await contractedJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;
  const held = (await loadJobRetainage(prisma, job.id)).balanceCents / 100;
  if (!(held > 0)) return { kind: "refuse", reason: `No retainage is held on ${job.name}, so there is nothing to bill.` };

  let amount: string | null = null;
  if (input.amount) {
    const parsed = parseAmount(input.amount);
    if (!parsed) return { kind: "need", missing: `the amount to bill as a figure — "${input.amount}" is not one` };
    if (parsed.cents / 100 > held) {
      return { kind: "refuse", reason: `${parsed.display} is more than the ${money(held)} held on ${job.name}.` };
    }
    amount = parsed.value;
  }
  let periodTo: string | null = null;
  if (input.period) {
    periodTo = periodEndFromWords(input.period, ctx.today);
    if (!periodTo) return { kind: "need", missing: `the period as a month or a date — "${input.period}" is not one` };
  }
  return {
    kind: "ready",
    resolved: { form: "retainage", jobId: job.id, jobName: job.name, amount, periodTo },
    preview: [
      { label: "Job", value: job.name },
      { label: "Amount", value: amount ? money(Number(amount)) : `${money(held)} — the whole balance held; change it on the form` },
      { label: "Period to", value: periodTo ? dayLabel(periodTo) : "the form's default, this month's end" },
      { label: "Sent", value: NOT_SENT },
    ],
    warnings: ["When the GC pays it, log a payment on this application, not a retainage release — doing both counts it twice."],
  };
}

export const billRetainageCommand: HandoffCommandDefinition = {
  name: "bill_retainage",
  description:
    "Bills the retainage held on a job as its own pay application, usually at closeout: opens the job's Bill the retainage form with the held balance (or the amount the person said) and an optional period, e.g. 'bill the retainage on Fulton'. The person creates it there. Does not bill new work, release retainage the GC already paid (that is release_retainage), compute an amount, or send anything to the GC.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "billRetainage",
  handoffHref: (proposalId, resolved) => `/jobs/${String(resolved.jobId)}/billing?draft=${proposalId}`,
  title: "Bill the retainage",
  verb: "Preparing the retainage application",
  button: "Open the retainage form",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job, as the person named it." },
      amount: { type: "string", description: "An amount only if the person said one, digits as said. Omit otherwise; never compute it." },
      period: { type: "string", description: "A period-to only if the person said one, in their words. Omit otherwise." },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveBillRetainage,
};

export const payApplicationCommands: CommandDefinition[] = [startPayApplicationCommand, billRetainageCommand];
