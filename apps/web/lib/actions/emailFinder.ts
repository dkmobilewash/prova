"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { findEmailForLead, type FindOutcome } from "@/lib/email-finder/find";
import { InputError, type ActionResultWith } from "./shared";

/**
 * THE EMAIL FINDER'S TWO BUTTONS — one lead, or a batch of the oldest leads
 * with no email. See `lib/email-finder/find.ts` for how an address is found.
 *
 * Three rules every write here keeps:
 *   - an existing email is NEVER overwritten — the write is conditional on the
 *     column still being empty, so a caller typing one mid-run wins;
 *   - `emailVerifiedAt` is set ONLY on the verifier's ok/catch_all verdict. A
 *     guess with no verifier key is stored as a guess: source "pattern",
 *     verified null;
 *   - a suppressed lead (`doNotContact`) is never looked up at all.
 */

/** Copied from sales.ts's private `assertSalesAccess`, deliberately not imported. */
function assertSalesAccess(context: { company: { isProvaOperator: boolean }; role: string }) {
  if (!context.company.isProvaOperator) throw new InputError("Not found");
  if (context.role !== "OWNER") throw new InputError("Only the account owner can use the sales CRM");
}

/** A batch's time budget: Vercel kills the function at the page's maxDuration (60s). */
const BATCH_BUDGET_MS = 45_000;
const BATCH_PARALLEL = 5;

function deps(deadline: number) {
  return {
    searchKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    verifyKey: process.env.MILLIONVERIFIER_API_KEY || undefined,
    deadline,
  };
}

type LeadForFinder = {
  id: string;
  companyName: string;
  city: string | null;
  contactName: string | null;
  website: string | null;
};

/** Writes what was found. Returns false when somebody filled the email first. */
async function save(lead: LeadForFinder, outcome: FindOutcome): Promise<boolean> {
  const website = outcome.domainWasFound && outcome.domain ? { website: outcome.domain } : {};
  if (!outcome.found) {
    if (website.website) await prisma.salesLead.updateMany({ where: { id: lead.id, website: null }, data: website });
    return false;
  }
  const { count } = await prisma.salesLead.updateMany({
    where: { id: lead.id, OR: [{ email: null }, { email: "" }] },
    data: {
      ...website,
      email: outcome.email,
      emailSource: outcome.source,
      // The verifier's verdict time — the moment its answer came back.
      emailVerifiedAt: outcome.verdict ? new Date() : null,
    },
  });
  return count > 0;
}

export async function findEmailForOneLead(leadId: string): Promise<ActionResultWith<FindOutcome>> {
  const { company, ...user } = await requireCompanyContext();
  try {
    assertSalesAccess({ company, role: user.role });
    const lead = await prisma.salesLead.findUnique({ where: { id: leadId } });
    if (!lead || lead.companyId !== company.id) throw new InputError("Lead not found");
    if (lead.doNotContact) throw new InputError("This lead asked not to be contacted, so no email is looked up.");
    if (lead.email) throw new InputError(`This lead already has an email (${lead.email}); it is never overwritten.`);

    const outcome = await findEmailForLead(lead, deps(performance.now() + BATCH_BUDGET_MS));
    const written = await save(lead, outcome);
    if (outcome.found && !written) throw new InputError("Somebody saved an email on this lead while the search ran; theirs was kept.");

    revalidatePath(`/sales/${leadId}`);
    revalidatePath("/sales");
    return { ok: true, value: outcome };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}

export type EmailBatchSummary = {
  found: number;
  guessed: number;
  none: number;
  /** Leads not reached before the time budget ran out — press again. */
  skipped: number;
  /** Why the `none` leads came back empty, most common first. */
  reasons: { note: string; count: number }[];
};

export async function findEmailsForLeads(limit = 25): Promise<ActionResultWith<EmailBatchSummary>> {
  const { company, ...user } = await requireCompanyContext();
  try {
    assertSalesAccess({ company, role: user.role });
    const take = Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)));
    const leads = await prisma.salesLead.findMany({
      where: { companyId: company.id, doNotContact: false, OR: [{ email: null }, { email: "" }] },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, companyName: true, city: true, contactName: true, website: true },
    });

    const deadline = performance.now() + BATCH_BUDGET_MS;
    const summary: EmailBatchSummary = { found: 0, guessed: 0, none: 0, skipped: 0, reasons: [] };
    const reasons = new Map<string, number>();
    const touched: string[] = [];

    for (let i = 0; i < leads.length; i += BATCH_PARALLEL) {
      if (performance.now() > deadline) {
        summary.skipped += leads.length - i;
        break;
      }
      const chunk = leads.slice(i, i + BATCH_PARALLEL);
      const outcomes = await Promise.all(chunk.map((lead) => findEmailForLead(lead, deps(deadline))));
      for (const [j, outcome] of outcomes.entries()) {
        const written = await save(chunk[j], outcome);
        if (written) touched.push(chunk[j].id);
        if (outcome.found && written) {
          if (outcome.source === "pattern" && !outcome.verdict) summary.guessed++;
          else summary.found++;
        } else if (!outcome.found) {
          summary.none++;
          reasons.set(outcome.note, (reasons.get(outcome.note) ?? 0) + 1);
        }
      }
    }
    summary.reasons = [...reasons].map(([note, count]) => ({ note, count })).sort((a, b) => b.count - a.count).slice(0, 3);

    for (const id of touched) revalidatePath(`/sales/${id}`);
    revalidatePath("/sales");
    return { ok: true, value: summary };
  } catch (err) {
    if (err instanceof InputError) return { ok: false, error: err.message };
    throw err;
  }
}
