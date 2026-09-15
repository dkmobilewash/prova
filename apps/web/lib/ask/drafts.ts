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
 * A draft loads only when ALL of these hold:
 *   - the row is this company's and was proposed by this person;
 *   - it is for the command this page owns, in HANDOFF mode — a card for
 *     the punch list cannot prefill the RFI form by editing the URL;
 *   - it is unsettled and unclaimed, so a saved draft loads once;
 *   - it has not expired.
 *
 * What comes back otherwise is one of three things the page can act on
 * without an error: `none` (no `?draft=` at all — the ordinary page),
 * `settled` (this person's own card, already saved or withdrawn — the
 * page after the form's own save re-renders with `?draft=` still in the
 * URL, and must NOT tell them the card is gone), or `gone` (everything
 * else, alike — expired, another person's, the wrong page, a made-up id
 * — so a card id in a URL discloses nothing about whose it was; the
 * page shows components/AskDraftNotice.tsx above its blank form).
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

/** The composer's prefill. The address is the one the command read off
 * the Contact row; the composer shows it in an editable field like any
 * other, and the send is the composer's own action, which validates it
 * again. */
export type MessageDraft = {
  proposalId: string;
  toAddress: string;
  toName: string;
  jobId: string | null;
  subject: string;
  body: string;
};

export type DraftLookup<D> =
  | { kind: "none" }
  | { kind: "draft"; draft: D }
  | { kind: "settled" }
  | { kind: "gone" };

const MAX_ID = 128;

const str = (payload: Record<string, unknown>, key: string): string | null =>
  typeof payload[key] === "string" && (payload[key] as string) !== "" ? (payload[key] as string) : null;

async function loadDraftRow(
  viewer: Viewer,
  proposalId: string | undefined,
  command: CommandName,
): Promise<DraftLookup<Record<string, unknown>>> {
  if (proposalId === undefined) return { kind: "none" };
  if (!proposalId || proposalId.length > MAX_ID) return { kind: "gone" };
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
  if (!row || row.createdByUserId !== viewer.id) return { kind: "gone" };
  if (row.command !== command || row.mode !== "HANDOFF") return { kind: "gone" };
  if (row.outcome || row.claimedAt) return { kind: "settled" };
  if (row.expiresAt < new Date()) return { kind: "gone" };
  if (!row.openedAt) {
    await prisma.askProposal.updateMany({
      where: { id: proposalId, openedAt: null },
      data: { openedAt: new Date() },
    });
  }
  const resolved = row.resolved;
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) return { kind: "gone" };
  return { kind: "draft", draft: resolved as Record<string, unknown> };
}

/** The RFI form's prefill. See the module comment for the four answers. */
export async function loadRfiDraft(viewer: Viewer, proposalId: string | undefined): Promise<DraftLookup<RfiDraft>> {
  const found = await loadDraftRow(viewer, proposalId, "raise_rfi");
  if (found.kind !== "draft" || !proposalId) return found as DraftLookup<RfiDraft>;
  const payload = found.draft;
  const jobId = str(payload, "jobId");
  const subject = str(payload, "subject");
  const question = str(payload, "question");
  if (!jobId || !subject || !question) return { kind: "gone" };
  return {
    kind: "draft",
    draft: {
      proposalId,
      jobId,
      subject,
      question,
      drawingReference: str(payload, "drawingReference"),
      specSection: str(payload, "specSection"),
    },
  };
}

/** The punch list form's prefill. */
export async function loadPunchDraft(
  viewer: Viewer,
  proposalId: string | undefined,
): Promise<DraftLookup<PunchDraft>> {
  const found = await loadDraftRow(viewer, proposalId, "add_punch_item");
  if (found.kind !== "draft" || !proposalId) return found as DraftLookup<PunchDraft>;
  const payload = found.draft;
  const jobId = str(payload, "jobId");
  const description = str(payload, "description");
  if (!jobId || !description) return { kind: "gone" };
  return { kind: "draft", draft: { proposalId, jobId, description } };
}

/** The message composer's prefill. A job is optional on an email, so a
 * missing `jobId` is "not tied to a job" rather than "gone". */
export async function loadMessageDraft(
  viewer: Viewer,
  proposalId: string | undefined,
): Promise<DraftLookup<MessageDraft>> {
  const found = await loadDraftRow(viewer, proposalId, "send_email");
  if (found.kind !== "draft" || !proposalId) return found as DraftLookup<MessageDraft>;
  const payload = found.draft;
  const toAddress = str(payload, "toAddress");
  const toName = str(payload, "toName");
  const subject = str(payload, "subject");
  const body = str(payload, "body");
  if (!toAddress || !toName || !subject || !body) return { kind: "gone" };
  return {
    kind: "draft",
    draft: { proposalId, toAddress, toName, jobId: str(payload, "jobId"), subject, body },
  };
}
