/**
 * /bids, grouped under the piece of work each invitation is for.
 *
 * Four GCs inviting you to price the same hospital are four invitations on one
 * project (`BidProject`). The list used to show them as four unrelated rows;
 * now a project with TWO OR MORE invitations gets one heading and its GCs'
 * rows beneath it, and a project with one invitation stays the single row it
 * always was.
 *
 * "Two or more" is read off the PROJECT'S invitations, not off the rows on the
 * page: a status filter or the 20-row cap can leave one GC's row showing, and
 * that GC is still one of several on the job. The heading says so.
 *
 * Order is preserved: a group sits where its first row did, and its rows keep
 * the order they came in. Nothing is sorted, filtered or dropped here.
 *
 * Pure. No database, no React.
 */

export type GroupableBid = {
  id: string;
  bidProject: { id: string; invitations: { id: string }[] } | null;
};

export type BidGroup<B extends GroupableBid> = {
  /** Stable React key. */
  key: string;
  /** The project to draw a heading for; null = a single row, no heading. */
  project: NonNullable<B["bidProject"]> | null;
  items: B[];
};

export function groupBidsByProject<B extends GroupableBid>(bids: readonly B[]): BidGroup<B>[] {
  const groups: BidGroup<B>[] = [];
  const byProject = new Map<string, BidGroup<B>>();

  for (const bid of bids) {
    const project = bid.bidProject;
    if (!project || project.invitations.length < 2) {
      groups.push({ key: bid.id, project: null, items: [bid] });
      continue;
    }
    const existing = byProject.get(project.id);
    if (existing) {
      existing.items.push(bid);
      continue;
    }
    const group: BidGroup<B> = { key: `project:${project.id}`, project: project as NonNullable<B["bidProject"]>, items: [bid] };
    byProject.set(project.id, group);
    groups.push(group);
  }
  return groups;
}
