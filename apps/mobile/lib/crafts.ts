import type { Craft } from "./types";

/** Who the hours are for: the signed-in user, or a crew member by id. */
export type CraftWorker = { kind: "me" } | { kind: "crew"; id: string };

/**
 * The crafts to offer for a worker — only the ones ticked for them on the
 * web (WorkerCraft). A worker with none ticked is offered every craft, and
 * `fallback` says so, so a company that has not set this up is never
 * blocked from logging hours.
 */
export function craftsForWorker(crafts: Craft[], worker: CraftWorker): { options: Craft[]; fallback: boolean } {
  const theirs = crafts.filter((c) => (worker.kind === "me" ? c.mine : c.crewMemberIds.includes(worker.id)));
  return theirs.length > 0 ? { options: theirs, fallback: false } : { options: crafts, fallback: true };
}

/**
 * The craft to have selected when a sheet opens or the worker changes:
 * the current one if it is still offered, the only one if there is exactly
 * one, otherwise none — so the person has to choose rather than inherit a
 * guess onto a certified payroll row.
 */
export function pickCraft(options: Craft[], current: string | null): string | null {
  if (current && options.some((c) => c.id === current)) return current;
  return options.length === 1 ? options[0].id : null;
}
