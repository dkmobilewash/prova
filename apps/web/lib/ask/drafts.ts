import { prisma } from "@prova/db";
import type { CommandName } from "./commands";

/**
 * Loading a HANDOFF card on the page it hands off to.
 *
 * A HANDOFF card's primary is a link to a page with `?draft=<cardId>`.
 * The page calls one of the loaders below during its render and passes
 * the result to its form, which opens prefilled. Nothing in the URL but
 * the id is read, and every prefilled value comes from the row's
 * server-held `resolved` payload — the same rule as the tap on a DIRECT
 * card: the browser chooses whether, never what.
 *
 * A draft loads only when ALL of these hold, and quietly returns null
 * otherwise, so the page renders its ordinary blank form (with a notice,
 * see components/AskDraftNotice.tsx) rather than an error:
 *   - the row is this company's and was proposed by this person;
 *   - it is for the command this page owns, in HANDOFF mode — a card for
 *     the punch list cannot prefill the RFI form by editing the URL;
 *   - it is unsettled and unclaimed, so a saved draft loads once;
 *   - it has not expired.
 *
 * The first load stamps `openedAt`. That is an audit line, and it is also
 * what stops the dashboard reattaching a card whose form is already open
 * somewhere (`loadAskProposal` refuses an opened card). Stamping inside a
 * page render is a write during render, which is unusual and deliberate:
 * it is idempotent (guarded on `openedAt IS NULL`), records a fact about
 * the request that just happened, and the alternative — a client effect
 * calling a Server Action after mount — would leave a gap in which the
 * card could be reattached and the form opened twice.
 */
export type Viewer = { company: { id: string }; id: string };

export type RfiDraft = {
  proposalId: string;
  jobId: string;
  subject: string;
  question: string;
  drawingReference: string | null;
  specSection: string | null;
};

export type PunchDraft = { proposalId: string; jobId: string; description: string };

const MAX_ID = 128;

const str = (payload: Record<string, unknown>, key: string): string | null =>
  typeof payload[key] === "string" && (payload[key] as string) !== "" ? (payload[key] as string) : null;

async function loadDraftRow(
  viewer: Viewer,
  proposalId: string | undefined,
  command: CommandName,
): Promise<Record<string, unknown> | null> {
  if (!proposalId || proposalId.length > MAX_ID) return null;
  const row = await prisma.askProposal.findFirst({
    where: { id: proposalId, companyId: viewer.company.id },
    select: {
      createdByUserId: true,
      command: true,
      mode: true,
      outcome: true,
      claimedAt: true,
      expiresAt: true,
      openedAt: true,
      resolved: true,
    },
  });
  if (!row || row.createdByUserId !== viewer.id) return null;
  if (row.command !== command || row.mode !== "HANDOFF") return null;
  if (row.outcome || row.claimedAt) return null;
  if (row.expiresAt < new Date()) return null;
  if (!row.openedAt) {
    await prisma.askProposal.updateMany({
      where: { id: proposalId, openedAt: null },
      data: { openedAt: new Date() },
    });
  }
  const resolved = row.resolved;
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) return null;
  return resolved as Record<string, unknown>;
}

/** The RFI form's prefill, or null. See the module comment for when. */
export async function loadRfiDraft(viewer: Viewer, proposalId: string | undefined): Promise<RfiDraft | null> {
  const payload = await loadDraftRow(viewer, proposalId, "raise_rfi");
  if (!payload || !proposalId) return null;
  const jobId = str(payload, "jobId");
  const subject = str(payload, "subject");
  const question = str(payload, "question");
  if (!jobId || !subject || !question) return null;
  return {
    proposalId,
    jobId,
    subject,
    question,
    drawingReference: str(payload, "drawingReference"),
    specSection: str(payload, "specSection"),
  };
}

/** The punch list form's prefill, or null. */
export async function loadPunchDraft(viewer: Viewer, proposalId: string | undefined): Promise<PunchDraft | null> {
  const payload = await loadDraftRow(viewer, proposalId, "add_punch_item");
  if (!payload || !proposalId) return null;
  const jobId = str(payload, "jobId");
  const description = str(payload, "description");
  if (!jobId || !description) return null;
  return { proposalId, jobId, description };
}
