import { prisma } from "@prova/db";
import { logPayment } from "@/lib/actions/billing";
import { createInvoiceRecord, NOT_INVOICEABLE, retainageWithheldFor } from "@/lib/billing/create-invoice";
import { money } from "@/lib/money";
import { addDays, parseAmount } from "../numbers";
import { resolveOpenInvoice, type ResolvedInvoice } from "../resolve";
import { formDataFrom, throughAction } from "./adapter";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Exclusion,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Money, phase 3: the two writes an office manager makes most and can
 * least afford to have wrong. Both are T3 and both are DIRECT, because
 * both refuse in sentences: `createInvoiceRecord` is the action's body
 * lifted into lib/billing (the form keeps its throw, the card gets the
 * sentence), and `logPayment` already returned ActionResult since #213
 * for exactly this reason.
 *
 * THE RULE, restated where it costs the most: no figure on a card came
 * from the model. The amount is the person's own typed digits, parsed by
 * lib/ask/numbers.ts or asked for; the balance owing, the retainage
 * withheld and the due date are computed here by the same arithmetic the
 * pages and the actions use — cents, the job's rate, the GC's terms — so
 * the card cannot disagree with the job page beneath it.
 *
 * What is deliberately NOT here: pay applications (a per-line AIA document
 * with its own composer), invoice status, and anything that deletes. Each
 * has its reason in `billingExclusions`. Retainage releases WERE on that
 * list until phase 4d, waiting for "a card that can show the balance it
 * draws down"; they are commands/retainage.ts now, over the same three
 * figures the job page's panel shows.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

// --------------------------------------------------------------- invoice

async function resolveDraftInvoice(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) return { kind: "need", missing: "which job to invoice" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  const detail = await prisma.job.findFirst({
    where: { id: job.id, companyId: ctx.companyId },
    select: {
      status: true,
      retainagePercent: true,
      contact: { select: { name: true, paymentTermsDays: true } },
      invoiceCounter: { select: { lastNumber: true } },
    },
  });
  if (!detail) return { kind: "refuse", reason: "That job isn't on your account." };
  if (detail.status === "ESTIMATE") {
    return { kind: "refuse", reason: `${NOT_INVOICEABLE}: ${job.name} is still an estimate.`, href: `/jobs/${job.id}` };
  }

  const amount = parseAmount(input.amount);
  if (!amount) {
    return {
      kind: "need",
      missing: input.amount
        ? `the invoice amount as a plain number — "${input.amount}" isn't one`
        : "the invoice amount",
    };
  }

  const description = input.description ?? "";
  const terms = detail.contact.paymentTermsDays;
  const dueAt = terms != null && terms > 0 ? addDays(ctx.today, terms) : null;
  const retainagePercent = detail.retainagePercent == null ? null : Number(detail.retainagePercent);
  const withheld = retainageWithheldFor(amount.value, retainagePercent);
  const lastNumber = detail.invoiceCounter?.lastNumber ?? 0;

  const preview: PreviewLine[] = [
    { label: "Job", value: `${job.name} · ${detail.contact.name}` },
    { label: "Invoice", value: lastNumber > 0 ? `next in sequence (the last was #${lastNumber})` : "#1, the first on this job" },
    { label: "Amount", value: amount.display },
  ];
  if (description) preview.push({ label: "For", value: description });
  preview.push({
    label: "Retainage withheld",
    value: withheld ? `${money(Number(withheld))} (${retainagePercent}% per the job's terms)` : "none — the job has no retainage rate",
  });
  preview.push({
    label: "Due",
    value: dueAt ? `${dueAt} (Net ${terms} from today, ${detail.contact.name}'s terms)` : "not set — set it on the job page if it matters",
  });

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, amount: amount.value, description: description || null, dueAt },
    preview,
    warnings: description ? [] : ["No description. The GC will see an invoice number and an amount and nothing else."],
  };
}

async function executeDraftInvoice(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const amount = str(payload, "amount");
  if (!jobId || !jobName || !amount) return { ok: false as const, error: "That card can't be executed. Ask again." };
  const dueAt = str(payload, "dueAt");
  const result = await createInvoiceRecord(ctx.companyId, jobId, {
    amount,
    description: str(payload, "description"),
    dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`) : null,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  const { invoiceId, number } = result.value;
  return {
    ok: true as const,
    message: `Invoice #${number} for ${money(Number(amount))} is on ${jobName}.`,
    created: { label: `Invoice #${number}, ${jobName}`, href: `/jobs/${jobId}`, targetType: "Invoice", targetId: invoiceId },
  };
}

export const draftInvoiceCommand: DirectCommandDefinition = {
  name: "draft_invoice",
  description:
    "Bills the client on a job: creates the next-numbered invoice for an amount the person stated, with an optional description of what it covers. Needs the job and the amount as the person said it; ask if either is missing, and never work out an amount yourself. Retainage is withheld at the job's own rate and the due date follows the GC's payment terms, both computed by the app and shown on the card. Does NOT submit a per-line AIA pay application (that is done on the job page), does not send anything to the GC, does not mark anything paid, and refuses while the job is still an estimate.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "DIRECT",
  action: "createInvoice",
  core: "createInvoiceRecord",
  title: "Bill the client",
  verb: "Preparing the invoice",
  button: "Create invoice",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job to invoice, as the person named it. Required." },
      amount: {
        type: "string",
        description: "The invoice amount exactly as the person said it, digits only, e.g. 12500 or 12,500.00. Required; never compute or round it.",
      },
      description: {
        type: "string",
        description: "What the invoice covers, in the person's words, e.g. 'September progress, levels 1-2'. Omit if not said.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveDraftInvoice,
  execute: executeDraftInvoice,
};

// --------------------------------------------------------------- payment

async function resolveLogPayment(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) return { kind: "need", missing: "which job the payment is for" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  const amount = parseAmount(input.amount);
  if (!amount) {
    return {
      kind: "need",
      missing: input.amount ? `the amount received as a plain number — "${input.amount}" isn't one` : "the amount received",
    };
  }

  // A chip carries the invoice id; the model carries at most a number.
  // Either way the balance is read again here, never trusted from the
  // chip, and re-asserted on this job.
  let invoice: ResolvedInvoice;
  if (input.invoiceId) {
    const row = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, jobId: job.id, job: { companyId: ctx.companyId } },
      select: { id: true, number: true, amount: true, payments: { select: { amount: true } } },
    });
    if (!row) return { kind: "refuse", reason: "That invoice isn't on this job." };
    const amountCents = Math.round(Number(row.amount) * 100);
    const paidCents = row.payments.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    invoice = { id: row.id, number: row.number, amountCents, paidCents, remainingCents: amountCents - paidCents };
    if (invoice.remainingCents <= 0) {
      return { kind: "refuse", reason: `Invoice #${invoice.number} on ${job.name} is already paid in full.`, href: `/jobs/${job.id}` };
    }
  } else {
    const found = await resolveOpenInvoice(ctx.companyId, job.id, input.invoiceNumber);
    if (found.kind === "settled") {
      return {
        kind: "refuse",
        reason: `Invoice #${found.invoice.number} on ${job.name} is already paid in full — there is nothing left to log a payment against.`,
        href: `/jobs/${job.id}`,
      };
    }
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: input.invoiceNumber
          ? `There is no invoice ${input.invoiceNumber} on ${job.name}.`
          : `No invoice on ${job.name} has a balance owing.`,
        href: `/jobs/${job.id}`,
      };
    }
    if (found.kind === "many") {
      return { kind: "clarify", field: "invoiceId", question: `Which invoice on ${job.name}?`, options: found.options };
    }
    invoice = found.match;
  }

  // The action's own ceiling, checked first with the same cents arithmetic
  // so the person gets the sentence instead of a card whose button can
  // only fail. The action checks again on the tap regardless.
  if (amount.cents > invoice.remainingCents) {
    return {
      kind: "refuse",
      reason: `That would bring total payments to ${money((invoice.paidCents + amount.cents) / 100)}, more than the ${money(
        invoice.amountCents / 100,
      )} invoice total. Only ${money(invoice.remainingCents / 100)} is left owing on invoice #${invoice.number}.`,
      href: `/jobs/${job.id}`,
    };
  }

  const after = invoice.remainingCents - amount.cents;
  const method = input.method ?? null;
  const note = input.note ?? null;
  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Invoice", value: `#${invoice.number} · ${money(invoice.amountCents / 100)} · ${money(invoice.remainingCents / 100)} owing` },
    { label: "Payment", value: amount.display },
    { label: "Owing after", value: after === 0 ? "nothing — this pays it off" : money(after / 100) },
  ];
  if (method) preview.push({ label: "Method", value: method });
  if (note) preview.push({ label: "Note", value: note });
  preview.push({ label: "Received", value: "recorded as the moment you tap" });

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: amount.value,
      method,
      note,
    },
    preview,
    warnings: [],
  };
}

async function executeLogPayment(_ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const invoiceId = str(payload, "invoiceId");
  const amount = str(payload, "amount");
  const invoiceNumber = typeof payload.invoiceNumber === "number" ? payload.invoiceNumber : null;
  if (!jobId || !jobName || !invoiceId || !amount || invoiceNumber === null) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Log payment", () =>
    logPayment(jobId, invoiceId, formDataFrom({ amount, method: str(payload, "method"), note: str(payload, "note") })),
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const row = await prisma.payment.findFirst({
    where: { invoiceId },
    orderBy: { receivedAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true as const,
    message: `Logged ${money(Number(amount))} against invoice #${invoiceNumber} on ${jobName}.`,
    created: {
      label: `Payment on invoice #${invoiceNumber}`,
      href: `/jobs/${jobId}`,
      targetType: "Payment",
      targetId: row?.id ?? invoiceId,
    },
  };
}

export const logPaymentCommand: DirectCommandDefinition = {
  name: "log_payment",
  description:
    "Records a payment received from the client against one invoice on a job. Needs the job and the amount received as the person said it; the invoice by number if they gave one, otherwise the one invoice with a balance owing (several means the person picks). Ask for the amount if missing and never work it out. Refuses an amount that would overpay the invoice, in the app's own words. Does NOT create an invoice, does not change an invoice's status, does not record retainage released, and does not delete or edit a payment already logged.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "DIRECT",
  action: "logPayment",
  core: "logPayment",
  title: "Log the payment",
  verb: "Preparing the payment",
  button: "Log payment",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the invoice is on, as the person named it. Required." },
      invoiceNumber: {
        type: "string",
        description: "The invoice number if the person said one, e.g. '3' for 'invoice 3'. Omit if they did not.",
      },
      amount: {
        type: "string",
        description: "The amount received exactly as the person said it, digits only, e.g. 12500 or 12,500.00. Required; never compute or round it.",
      },
      method: { type: "string", description: "How it was paid if said: check, ACH, card, cash. Omit if not said." },
      note: { type: "string", description: "A check number or remittance reference if the person gave one. Omit if not said." },
    },
  },
  continuationKeys: ["jobId", "invoiceId"],
  resolve: resolveLogPayment,
  execute: executeLogPayment,
};

export const billingCommands: DirectCommandDefinition[] = [draftInvoiceCommand, logPaymentCommand];

/** The rest of lib/actions/billing.ts, each with its reason. */
export const billingExclusions: Exclusion[] = [
  { action: "createSignatureRequest", reason: "Mints a bearer link that legally signs a contract (T4 outward); a page action with its own link handling." },
  { action: "signRequest", reason: "The CLIENT signs, on an unauthenticated page, with a token — nothing an assistant inside the app should touch." },
  { action: "revokeSignatureRequest", reason: "Voids a live e-sign link the client may be holding (T5); one deliberate tap on the job page, never a command." },
  { action: "revokeClientPortalAccess", reason: "Kills the GC's portal link (T5 owner administration of an outward token); one deliberate tap on the contact, never a command." },
  { action: "enablePortalAccess", reason: "Mints the GC's portal link (T4 outward); one owner tap on the contact, never a command." },
  { action: "submitPayApplication", reason: "A per-line AIA document composed on the job page from the schedule of values; a card cannot carry a continuation sheet." },
  { action: "updateJobRetainageTerms", reason: "Contract terms that every later invoice snapshots; edited on the job, deliberately not by prompt." },
  { action: "updateInvoiceStatus", reason: "Where a pay application stands with the GC is evidence set from the row, not proposed." },
  { action: "deletePayment", reason: "T5: deletes are never commands." },
  // createRetainageRelease left this list in phase 4d: commands/retainage.ts.
  { action: "deleteRetainageRelease", reason: "T5: deletes are never commands." },
  { action: "disconnectQuickBooks", reason: "Owner administration (T5): a connection an assistant could sever is not a connection." },
  { action: "testQuickBooksConnection", reason: "A diagnostic button on the settings page; returns company info, writes nothing worth a card." },
  { action: "generateJobWipNarrative", reason: "Already an AI feature with its own button on the job page; a command calling a model to call a model is noise." },
  { action: "uploadContractDocument", reason: "Needs a real File; page only until a hand-off mode carries attachments." },
  { action: "deleteContractDocument", reason: "T5: deletes are never commands." },
];
