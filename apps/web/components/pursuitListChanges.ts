import {
  comparePursuits,
  isOpenPursuit,
  optionalValueFromString,
  stageFromString,
  type BidPursuitStage,
} from "@/lib/bid-pursuits";
import type { PursuitRow } from "@/lib/bid-pursuits-query";

/**
 * What /pipeline's chase list shows between a save and the refreshed page.
 *
 * WHY THIS EXISTS. A Server Action here answers `{ ok: true }` about 1.5s
 * after the click and the refreshed page — the only thing that carries the
 * new row — finishes arriving seconds later (CLAUDE.md, issue #61: the
 * response STARTS at ~1.5s and finishes streaming at 3.7-4.4s; on a laptop
 * dev server it was 3-10s). The form closed at the first moment and the
 * list still said "Nothing on the chase list yet" at the second, which is
 * exactly the window in which a person clicks Save again.
 *
 * So the list shows the change itself, and lets go of it the moment the
 * server's own list arrives. Nothing here is stored or derived for good:
 * a row drawn from what was typed is a placeholder, marked `saving`, and
 * it is replaced by the server's row — with its real flags and totals —
 * as soon as that exists.
 */

export type ShownPursuit = PursuitRow & {
  /** Drawn from what was typed, not from the server. Rendered as "saving…"
   * and without row actions: it has no id the server knows yet. */
  saving?: boolean;
};

export type PursuitChange =
  | { kind: "create"; row: ShownPursuit }
  | { kind: "edit"; row: ShownPursuit }
  | { kind: "remove"; id: string };

/** A confirmed change, held only until the page's list moves on. */
export type HeldChange = PursuitChange & {
  /** The `pursuits` prop that was on screen when this was saved. While the
   * prop is still that same array the server has not re-rendered the list,
   * so the change is shown on top of it. The first new array is the
   * server's answer — it already has the change, or it knows better — and
   * the held copy is dropped. Identity, not contents: a Server Component's
   * props only change when a new payload arrives. */
  basis: readonly PursuitRow[];
};

/** The list with changes applied, in the order the server would sort it. */
export function applyPursuitChanges(
  pursuits: readonly ShownPursuit[],
  changes: readonly PursuitChange[],
): ShownPursuit[] {
  if (changes.length === 0) return pursuits as ShownPursuit[];
  let rows = [...pursuits];
  for (const change of changes) {
    // A create can arrive twice — held after the save succeeded AND still
    // applied by useOptimistic until the transition ends. Twice in the list
    // is two rows with one React key, which left a "saving…" ghost beside
    // the real row after the refresh (#316, seen in the browser). So a
    // create whose row is already shown replaces it instead.
    if (change.kind === "create") {
      const at = rows.findIndex((row) => row.id === change.row.id);
      if (at === -1) rows.push(change.row);
      else rows[at] = change.row;
    }
    else if (change.kind === "edit") rows = rows.map((row) => (row.id === change.row.id ? change.row : row));
    else rows = rows.filter((row) => row.id !== change.id);
  }
  // Array.prototype.sort is stable, so rows the comparator ties keep the
  // server's order and a new row goes after its equals, not before them.
  return rows.sort(comparePursuits);
}

/** The held changes still worth showing over this `pursuits` prop. */
export function heldOver(held: readonly HeldChange[], pursuits: readonly PursuitRow[]): HeldChange[] {
  return held.filter((change) => change.basis === pursuits);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function orNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * A row as it will look once saved, from the same FormData the action gets.
 *
 * Deliberately a DRAFT: anything the server decides is left in its
 * neutral state (no "bid date passed", no "untouched" badge), because a
 * placeholder must not make a claim the server has not made. A value the
 * server would refuse shows as absent; the refusal itself arrives with the
 * action's answer and the placeholder is withdrawn.
 */
export function draftPursuit(
  formData: FormData,
  today: string,
  base: { id: string; invitation: PursuitRow["invitation"] },
): ShownPursuit {
  const stage: BidPursuitStage = orNull(() => stageFromString(formData.get("stage") || "WATCHING")) ?? "WATCHING";
  const bidDate = text(formData, "expectedBidDate");
  const value = orNull(() => optionalValueFromString(formData.get("estimatedValue")));
  return {
    id: base.id,
    projectName: text(formData, "projectName"),
    owner: text(formData, "owner") || null,
    architect: text(formData, "architect") || null,
    expectedGcs: text(formData, "expectedGcs") || null,
    note: text(formData, "note") || null,
    stage,
    expectedBidDate: /^\d{4}-\d{2}-\d{2}$/.test(bidDate) ? bidDate : null,
    estimatedValue: value === null ? null : Number(value),
    lastUpdated: today,
    open: isOpenPursuit(stage),
    goneQuiet: false,
    bidDateComingUp: false,
    bidDatePassed: false,
    daysSinceUpdate: 0,
    invitation: base.invitation,
    saving: true,
  };
}
