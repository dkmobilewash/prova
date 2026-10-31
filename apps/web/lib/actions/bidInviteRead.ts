"use server";

import { prisma } from "@prova/db";
import { anthropicFailureCode, anthropicIsConfigured, BID_INVITE_PROMPT_VERSION, extractBidInvite } from "@prova/integrations";
import { inviteReadFailed, INVITE_READ_NOT_CONFIGURED, inviteReadSwitchedOff } from "@/lib/bid/inviteReaderAccess";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimAskAllowance, markAskAllowanceFailure } from "@/lib/ask/allowance";
import { inviteTextProblem, siteFromNotes, suggestionFromExtraction, type BidInviteSuggestion } from "@/lib/bid-invite-read";
import { findSameJobFromOtherGc, type SameJobMatch } from "@/lib/estimating/bid-invitation";
import { actionFail, type ActionResultWith } from "./shared";

/**
 * Reading a pasted bid invitation into the "Log a bid" form, and saying when
 * the same job is already on file from another GC.
 *
 * NEITHER ACTION WRITES ANYTHING about a bid. The read returns a proposal the
 * form fills itself with; `createBidInvitation` — unchanged — is the only thing
 * that creates a row, when a person presses "Log invitation". The same
 * arrangement as `quoteRead.ts`, and its own file for the same reason: a reader
 * of `estimating.ts` should not find a model call among the writers.
 *
 * WHICH SWITCH, AND WHY NOT A NEW ONE. Every other reader has its own
 * `AiFeature` member, and this one should too — but a member is a Postgres
 * enum value, adding one is a migration, and this change makes none (the
 * project-level bid model and anything touching the schema waits for both
 * founders). So it runs behind `BID_RESEARCH`, the switch for the AI that
 * already works on a bid nobody has priced yet from the GC's side of it, and
 * its settings description says so. Its spend is a `bid-research` row.
 *
 * THE SPEND IS ONE ASSISTANT QUESTION from the monthly allowance — the Ask
 * box's unit, because a pasted email is a question's cost shape (a page of
 * text, no file), and the same ledger, because a second ledger is how a bill
 * stops adding up. Claimed BEFORE the call; a failed call is marked, never
 * released (`lib/ask/allowance.ts` says why).
 */

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

export type BidInviteReadResult = BidInviteSuggestion & {
  /** What the allowance said after claiming. */
  note: string;
};

/** The GCs a bid can be logged against — the same set `/bids` offers. */
async function loggableGcs(companyId: string) {
  return prisma.contact.findMany({
    where: {
      companyId,
      OR: [{ accountType: null }, { accountType: { in: ["GENERAL_CONTRACTOR", "DEVELOPER"] } }],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Reads pasted invitation text and proposes the form's fields. WRITES NOTHING. */
export async function readBidInvitationText(textRaw: string): Promise<ActionResultWith<BidInviteReadResult>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS) as ActionResultWith<BidInviteReadResult>;
  const { company, ...user } = context;

  // NO MODEL KEY ON THIS SERVER: say so, and claim nothing. Checked first —
  // before the paste and before the allowance — because nothing about the
  // paste can fix it, and a question charged for a call that cannot happen
  // is the contractor walk's defect (`inviteReaderAccess.ts`). The form
  // normally says this up front; this is the half that survives a stale page.
  if (!anthropicIsConfigured()) return { ok: false, error: INVITE_READ_NOT_CONFIGURED };

  const text = String(textRaw ?? "").trim();
  const problem = inviteTextProblem(text);
  if (problem) return { ok: false, error: problem };

  // The per-company switch before anything is claimed or sent. Logging a bid
  // by hand still works with it off, so the sentence can say so.
  const gate = await aiGate(company.id, "BID_RESEARCH");
  if (!gate.ok) return { ok: false, error: inviteReadSwitchedOff(gate.error) };

  const spend = await claimAskAllowance(company.id, { questions: 1, pages: 0 });
  if (!spend.ok) return { ok: false, error: spend.error };

  let extraction: Awaited<ReturnType<typeof extractBidInvite>>;
  try {
    extraction = await extractBidInvite({
      text,
      model: gate.model,
      onUsage: (usage) =>
        recordAskUsage({
          companyId: company.id,
          userId: user.id,
          model: gate.model,
          usage,
          // `proposal`: the read fills a form a person saves. Nothing is filed.
          outcome: "proposal",
          feature: "bid-research",
          promptVersion: BID_INVITE_PROMPT_VERSION,
        }),
    });
  } catch (err) {
    await markAskAllowanceFailure(spend.claim);
    // Ids only — never the pasted text, which is somebody's email.
    console.error("[bid-invite-read] the extractor failed after its allowance was claimed", {
      companyId: company.id,
      err,
    });
    return { ok: false, error: inviteReadFailed(anthropicFailureCode(err)) };
  }

  const gcs = await loggableGcs(company.id);
  const suggestion = suggestionFromExtraction(text, extraction, gcs);
  const left = spend.left.questions;
  return {
    ok: true,
    value: {
      ...suggestion,
      note: `Read with one assistant question — ${left} left this month. Check every field before you log it.`,
    },
  };
}

export type SameJobCheckInput = {
  contactId: string | null;
  projectName: string;
  /** `YYYY-MM-DD` or empty. */
  dueDate: string | null;
  /** The form's notes; a `Site:` line in them is read for the address. */
  notes: string | null;
};

/**
 * The open invitations from OTHER GCs that look like the job being logged.
 * Read-only and deterministic — no model, no allowance — so the form can ask
 * as the fields change. See `findSameJobFromOtherGc` for the rules.
 */
export async function checkSameJobFromOtherGc(input: SameJobCheckInput): Promise<ActionResultWith<SameJobMatch[]>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS) as ActionResultWith<SameJobMatch[]>;

  const projectName = String(input.projectName ?? "").trim();
  if (!projectName) return { ok: true, value: [] };
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? "") ? input.dueDate : null;

  const open = await prisma.bidInvitation.findMany({
    where: { companyId: context.company.id, status: { in: ["INVITED", "SUBMITTED"] } },
    select: {
      id: true,
      contactId: true,
      projectName: true,
      status: true,
      dueDate: true,
      notes: true,
      contact: { select: { name: true } },
    },
  });

  return {
    ok: true,
    value: findSameJobFromOtherGc(
      { contactId: input.contactId || null, projectName, dueDate, site: siteFromNotes(input.notes) },
      open.map((row) => ({
        id: row.id,
        contactId: row.contactId,
        contactName: row.contact.name,
        projectName: row.projectName,
        status: row.status,
        dueDate: row.dueDate === null ? null : row.dueDate.toISOString().slice(0, 10),
        site: siteFromNotes(row.notes),
      })),
    ),
  };
}
