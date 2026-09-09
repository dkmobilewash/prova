import { prisma } from "@prova/db";
import { resolveJob } from "../resolve";
import type { CommandContext, CommandInput, Resolution } from "../commands";

/**
 * The job a command is about.
 *
 * `jobId` arrives only from a chip (it is a continuation key, never a
 * schema property), and is re-asserted in-company here regardless of
 * where it came from. Otherwise the name the person used is resolved:
 * nothing matching is a refusal with the page to go to, several matching
 * is a chip row, and one matching is the job. Every branch but the last
 * is a Resolution the caller returns as-is, so "which job?" is asked the
 * same way by every command that needs one.
 */
export type FoundJob = { kind: "job"; job: { id: string; name: string } };

export async function findJob(ctx: CommandContext, input: CommandInput): Promise<FoundJob | Resolution> {
  if (input.jobId) {
    const row = await prisma.job.findFirst({
      where: { id: input.jobId, companyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!row) return { kind: "refuse", reason: "That job isn't on your account." };
    return { kind: "job", job: row };
  }
  const jobName = input.jobName ?? "";
  if (!jobName) return { kind: "need", missing: "which job" };
  const found = await resolveJob(ctx.companyId, jobName);
  if (found.kind === "none") {
    return { kind: "refuse", reason: `No job matches "${jobName}".`, href: "/dashboard" };
  }
  if (found.kind === "many") {
    return { kind: "clarify", field: "jobId", question: "Which job?", options: found.options };
  }
  return { kind: "job", job: { id: found.match.id, name: found.match.name } };
}
