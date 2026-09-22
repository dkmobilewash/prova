import { prisma } from "@prova/db";

/**
 * What a drawing set looks like to somebody standing on the job.
 *
 * The question a foreman has in front of a wall is never "list the
 * revisions" — it is **am I building from paper that has already been
 * superseded**. That is what this module derives, and it derives it
 * rather than storing it, per CLAUDE.md: a "current" flag somebody
 * forgot to move is precisely the failure it would be claiming to
 * prevent.
 *
 * TWO DATES, AND THE GAP BETWEEN THEM IS THE EXPOSURE.
 * `issuedOn` is the date on the drawing; `receivedOn` is when it reached
 * us, and null means it has NOT. So a set can have a current revision
 * that nobody on site has — which is the state worth putting on a phone,
 * because the crew is then building from the one before it.
 *
 * There are no SHEETS in this schema, and the phone screen is honest
 * about that: a set has revisions, and a revision may carry one file.
 */

export type RevisionRow = {
  id: string;
  label: string;
  issuedOn: string;
  receivedOn: string | null;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
};

export type DrawingSetRow = {
  id: string;
  name: string;
  description: string | null;
  /** Every revision, newest issue first. */
  revisions: RevisionRow[];
  /** The one that governs: latest `issuedOn`. Null for a set with no
   * revisions recorded yet, which is a real state — somebody named the
   * set before the first issue arrived. */
  currentRevisionId: string | null;
  /** The current revision has not reached us. The crew is building from
   * the previous one, or from nothing. */
  currentNotReceived: boolean;
  /** The newest revision we DO have, which is what site is actually
   * working to when the current one has not arrived. */
  latestReceivedRevisionId: string | null;
};

/** Newest issue first, and a stable order when two revisions share a
 * date — which happens on a re-issue, and a list that reorders itself
 * between loads is a list nobody trusts. */
export function byIssueDate(revisions: RevisionRow[]): RevisionRow[] {
  return [...revisions].sort((a, b) => {
    const byDate = b.issuedOn.localeCompare(a.issuedOn);
    return byDate !== 0 ? byDate : b.label.localeCompare(a.label);
  });
}

/** The revision that governs: the latest one issued, whether or not it
 * has reached us. Deliberately NOT "the latest one we received" — the
 * whole point is to show when those two differ. */
export function currentRevision(revisions: RevisionRow[]): RevisionRow | null {
  return byIssueDate(revisions)[0] ?? null;
}

/** The newest revision actually in the trailer. */
export function latestReceived(revisions: RevisionRow[]): RevisionRow | null {
  return byIssueDate(revisions).find((revision) => revision.receivedOn !== null) ?? null;
}

export function toDrawingSetRow(set: {
  id: string;
  name: string;
  description: string | null;
  revisions: {
    id: string;
    label: string;
    issuedOn: Date;
    receivedOn: Date | null;
    description: string | null;
    fileUrl: string | null;
    fileName: string | null;
  }[];
}): DrawingSetRow {
  const revisions = byIssueDate(
    set.revisions.map((revision) => ({
      id: revision.id,
      label: revision.label,
      issuedOn: revision.issuedOn.toISOString(),
      receivedOn: revision.receivedOn ? revision.receivedOn.toISOString() : null,
      description: revision.description,
      fileUrl: revision.fileUrl,
      fileName: revision.fileName,
    })),
  );

  const current = currentRevision(revisions);
  const received = latestReceived(revisions);

  return {
    id: set.id,
    name: set.name,
    description: set.description,
    revisions,
    currentRevisionId: current?.id ?? null,
    currentNotReceived: current !== null && current.receivedOn === null,
    latestReceivedRevisionId: received?.id ?? null,
  };
}

export async function listDrawingsForJob(jobId: string): Promise<DrawingSetRow[]> {
  const sets = await prisma.drawingSet.findMany({
    where: { jobId },
    orderBy: { name: "asc" },
    include: {
      revisions: {
        select: {
          id: true,
          label: true,
          issuedOn: true,
          receivedOn: true,
          description: true,
          fileUrl: true,
          fileName: true,
        },
      },
    },
  });
  return sets.map(toDrawingSetRow);
}
