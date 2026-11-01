import { prisma } from "@prova/db";
import { InputError } from "@/lib/actions/shared";
import type { PackageContents } from "@/lib/submittal-package";

type Latest = { revisionNumber: number; returnedOn: Date | null } | null;

/** Why a revision cannot be recorded yet, in one person's words. */
export function revisionProblem(latest: Latest, sentOn: Date): string | null {
  if (latest && !latest.returnedOn) {
    return `The GC still has revision ${latest.revisionNumber}. Record what came back before sending another.`;
  }
  // History has to stay tellable in order: a resubmission can't predate the
  // response that caused it.
  if (latest?.returnedOn && sentOn < latest.returnedOn) {
    return `Revision ${latest.revisionNumber} came back ${latest.returnedOn.toISOString().slice(0, 10)}. The new one can't be sent before that.`;
  }
  return null;
}

const newest = { orderBy: { revisionNumber: "desc" as const } };

/** Read before an email goes, so a package the register would refuse never leaves. */
export async function revisionBlocked(submittalId: string, sentOn: Date): Promise<string | null> {
  return revisionProblem(await prisma.submittalRevision.findFirst({ where: { submittalId }, ...newest }), sentOn);
}

export function optionalDay(raw: unknown): Date | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const day = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) ? null : day;
}

/** The guards read the latest revision INSIDE the transaction. Checked outside,
 * two people resubmitting at the same moment both pass and one strands a revision
 * that is never the latest, which no form can record a response against. */
export async function recordRevision(
  submittalId: string,
  sentOn: Date,
  dueBack: Date | null,
  packageContents: PackageContents | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const problem = revisionProblem(await tx.submittalRevision.findFirst({ where: { submittalId }, ...newest }), sentOn);
    if (problem) throw new InputError(problem, "sentOn");
    const bumped = await tx.submittal.update({
      where: { id: submittalId },
      data: { lastRevision: { increment: 1 } },
      select: { lastRevision: true },
    });
    await tx.submittalRevision.create({
      data: {
        submittalId,
        revisionNumber: bumped.lastRevision,
        sentOn,
        dueBack,
        ...(packageContents ? { packageContents } : {}),
      },
    });
  });
}
