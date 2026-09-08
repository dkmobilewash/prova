import { prisma, type Prisma } from "@prova/db";
import { linkToken } from "@/lib/tokens";
import type { Actor, CommandInput, CommandMode, CommandName, PreviewLine, ResolvedPayload } from "./commands";

/**
 * Writing the AskProposal row.
 *
 * The only table the ask layer writes for itself. A business row is only
 * ever written by `execute` in a command, after a person's tap; this row is
 * what the tap refers to. It carries the server-held `resolved` payload the
 * confirm action will execute, so nothing the browser echoes back is ever
 * trusted for an id.
 */
export const PROPOSAL_TTL_MINUTES = 30;

export type ProposalRecord = {
  actor: Actor;
  command: CommandName;
  mode: CommandMode;
  question: string;
  input: CommandInput;
  resolved: ResolvedPayload;
  preview: PreviewLine[];
  model: string;
  toolUseId: string;
  toolUseIdsInContext: string[];
  /** Present when the command refused in `resolve` (or the natural key
   * already existed): the row is stamped REFUSED at birth, so it is an
   * audit line and never a confirmable card. */
  refused?: string;
};

export async function recordProposal(
  record: ProposalRecord,
  now: Date = new Date(),
): Promise<{ id: string; expiresAt: Date }> {
  const id = linkToken();
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000);
  await prisma.askProposal.create({
    data: {
      id,
      companyId: record.actor.companyId,
      createdByUserId: record.actor.userId,
      command: record.command,
      mode: record.mode,
      question: record.question.slice(0, 1000),
      input: record.input as Prisma.InputJsonValue,
      resolved: record.resolved as Prisma.InputJsonValue,
      preview: record.preview as unknown as Prisma.InputJsonValue,
      model: record.model,
      toolUseId: record.toolUseId,
      toolUseIdsInContext: record.toolUseIdsInContext,
      expiresAt,
      ...(record.refused ? { outcome: "REFUSED", outcomeNote: record.refused.slice(0, 1000) } : {}),
    },
  });
  return { id, expiresAt };
}
