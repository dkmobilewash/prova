import { money } from "@/lib/money";
import type { PlanDeleteImpact } from "@/lib/takeoff/planDelete";

/**
 * What the plan-delete confirmation and its toast say, from the delete's own figures (`planDelete.ts`, R8).
 * Plain words, no jargon. `keep` is the dialog's checkbox: lines priced by hand stay as typed lines while it is on.
 */
export function planDeleteWords(impact: PlanDeleteImpact, keep: boolean) {
  const handTotal = impact.handPriced.reduce((n, l) => n + l.total, 0);
  const handLines = keep ? 0 : impact.handPriced.length;
  const after = Math.round((impact.totalAfter - (keep ? 0 : handTotal)) * 100) / 100;
  const drop = Math.round((impact.totalBefore - after) * 100) / 100;
  const retired = impact.linesRetired + handLines;

  const what = [
    impact.wallFeet > 0 ? `${impact.wallFeet.toLocaleString("en-US")} ft of walls` : null,
    impact.counts > 0 ? `${impact.counts} counted ${impact.counts === 1 ? "door or window" : "doors and windows"}` : null,
  ].filter((p): p is string => p !== null);
  const lines = retired > 0 ? `${retired} estimate ${retired === 1 ? "line" : "lines"}${drop !== 0 ? ` (${money(drop)})` : ""}` : null;

  const body: string[] = [];
  if (!impact.estimateUpdates) {
    body.push(`This removes the drawing${what.length > 0 ? ` and the ${join(what)} traced on it` : ""}.`);
    body.push("This job is past the estimate, so its estimate is the contract and does not change here. Change it with a change order.");
  } else {
    const removed = [...what, ...(lines === null ? [] : [lines])];
    body.push(removed.length > 0 ? `This removes ${join(removed)} from this job.` : "Nothing on the estimate came from this plan, so the estimate does not change.");
    const shown = impact.linesChanged.slice(0, 3).map((l) => `${l.description} goes from ${l.from} to ${l.to}.`);
    body.push(...shown);
    if (impact.linesChanged.length > 3) body.push(`${impact.linesChanged.length - 3} more lines change the same way.`);
  }

  let warning: string | null = null;
  if (impact.estimateUpdates && impact.signingLink?.status === "PENDING" && drop !== 0) {
    warning = `A signing link sent to the GC on ${impact.signingLink.sentOn} shows this estimate as it is now. After this it shows ${money(after)} instead of ${money(impact.totalBefore)}.`;
  } else if (impact.estimateUpdates && impact.signingLink?.status === "SIGNED" && drop !== 0) {
    warning = "The signed proposal keeps what was signed. After this the estimate no longer matches it.";
  }

  const keepLabel =
    impact.handPriced.length === 0
      ? null
      : impact.handPriced.length === 1
        ? `Keep the line you priced by hand (${money(handTotal)}) as a typed line`
        : `Keep the ${impact.handPriced.length} lines you priced by hand (${money(handTotal)}) as typed lines`;

  return {
    title: `Delete ${impact.label}?`,
    body,
    warning,
    keepLabel,
    primary: impact.estimateUpdates ? "Delete plan and update estimate" : "Delete plan",
  };
}

/** The toast after the delete, from what the delete actually did (never the preview's figures). */
export function planDeletedToast(done: PlanDeleteImpact): string {
  if (!done.estimateUpdates) return `${done.label} deleted.`;
  const drop = Math.round((done.totalBefore - done.totalAfter) * 100) / 100;
  return drop === 0 ? `${done.label} deleted. The estimate did not change.` : `${done.label} deleted. Estimate updated: ${drop > 0 ? "−" : "+"}${money(Math.abs(drop))}.`;
}

function join(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
