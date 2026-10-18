import type { WallGroup } from "@/lib/takeoff/wallGroups";
import { matchGroups } from "@/lib/takeoff/proposalMatch";
import { namedCodeOf } from "@/lib/takeoff/wallProposal";

/**
 * SORTING DETECTED GROUPS UNDER THE CONDITION THEY PROPOSE INTO.
 *
 * Detection matches each group to a takeoff item (`proposalMatch.ts`) and the
 * match is stored on the proposal row. This is the reading half: the panel
 * shows "3⅝" metal stud — interior" with its groups beneath, instead of a flat
 * list of thicknesses an estimator has to map back to their own conditions by
 * eye.
 *
 * ── THE INDEX IS CARRIED, NEVER RECOMPUTED ──
 *
 * Every group's position in the ORIGINAL array is what addresses it elsewhere:
 * the overlay colour and dash (`ClusterMark index=`), the chosen wall type
 * (`chosen[index]`), and the hover that lights its runs on the drawing. Group
 * them into a new order and renumber, and the panel's third row highlights the
 * drawing's first — so each entry keeps the index it arrived with, and the
 * sections are purely a reading order.
 */
export type ProposalSection = {
  /** The item these propose into, or null for the unassigned pile. */
  itemId: string | null;
  /** The item's name, or null when these belong to nobody. */
  name: string | null;
  entries: { group: WallGroup; index: number }[];
};

/**
 * A condition, as matching and the headings both need it.
 *
 * `thicknessIn` and `assemblyCode` are what a LIVE match runs on; `name` is
 * what the heading shows. One shape for both, so a panel cannot draw a heading
 * for an item the matcher could not see.
 */
export type SectionItem = {
  id: string;
  name: string;
  thicknessIn?: number | null;
  /** The code of the wall type this condition points at, joined by the loader. */
  assemblyCode?: string | null;
};

export function proposalSections(
  groups: readonly WallGroup[],
  items: readonly SectionItem[],
): ProposalSection[] {
  const placed = withLiveMatches(groups, items);
  const byItem = new Map<string | null, { group: WallGroup; index: number }[]>();
  const known = new Set(items.map((item) => item.id));
  placed.forEach((group, index) => {
    // AN UNKNOWN ID IS UNASSIGNED, not a section with no name. `itemId` is SET
    // NULL on delete, so a dangling match should not survive — but a row read
    // before a delete commits would otherwise render a heading for a condition
    // that no longer exists, which is worse than the pile.
    const id = group.itemId != null && known.has(group.itemId) ? group.itemId : null;
    const list = byItem.get(id);
    if (list) list.push({ group, index });
    else byItem.set(id, [{ group, index }]);
  });

  // THE ITEMS' OWN ORDER, so the panel reads down in the same order as the
  // items list beside it. Sorting by footage or count here would mean the two
  // panels disagree about which condition comes first.
  const sections: ProposalSection[] = [];
  for (const item of items) {
    const entries = byItem.get(item.id);
    if (entries) sections.push({ itemId: item.id, name: item.name, entries });
  }
  // UNASSIGNED LAST. It is the pile somebody has to work through, and a pile
  // at the top buries the conditions that are already sorted.
  const loose = byItem.get(null);
  if (loose) sections.push({ itemId: null, name: null, entries: loose });
  return sections;
}

/**
 * Whether to draw headings at all.
 *
 * One unassigned section is the ordinary state of a job nobody has named
 * conditions on, and "Unassigned walls" over the whole list tells that
 * estimator nothing they do not already know. Headings appear once there is a
 * distinction to draw.
 */
export function showsHeadings(sections: readonly ProposalSection[]): boolean {
  return sections.length > 1 || (sections.length === 1 && sections[0].itemId !== null);
}

/**
 * ── A GROUP WITH NO STORED MATCH IS MATCHED AGAIN, HERE ──
 *
 * Detection records the item it matched each group to. A group detected before
 * any condition existed stored a NULL, and that is the ordinary case rather
 * than the edge: detection fires the instant a scale is accepted, and a person
 * scales a sheet to look at the drawing before deciding what they are
 * counting. Left alone, the panel would show one undifferentiated pile for
 * ever and nothing on screen would say that naming a condition — or re-running
 * detection — is what fixes it.
 *
 * A stored value WINS where it exists, because that is a decision some run
 * made. A null is an absence, and an absence is the thing that is safe to
 * recompute.
 *
 * ── AND IT HAPPENS HERE SO THAT BOTH PATHS AGREE ──
 *
 * Groups reach this panel two ways: seeded from stored proposals when the page
 * loads, and straight out of the browser's own run when somebody presses Find
 * the walls. Matching in the loader covered only the first, so the headings
 * appeared after a reload and not after the button — the same screen telling
 * an estimator two different things about the same walls. One match point,
 * where the two paths meet, is what stops that.
 *
 * Same function detection itself uses, refusals included: `matchGroups`
 * declines a tie rather than picking one of two 3⅝" walls, and a re-match
 * declines the same tie for the same reason.
 *
 * ponytail: recomputed on every render of the panel, which is cheap at this
 * size — a sheet carries tens of groups, not thousands. If a manual
 * re-assignment ever ships, this becomes the fallback for groups nobody has
 * touched rather than for nulls.
 */
function withLiveMatches(
  groups: readonly WallGroup[],
  items: readonly SectionItem[],
): readonly WallGroup[] {
  if (items.length === 0) return groups;
  if (groups.every((group) => group.itemId != null)) return groups;
  const { matched } = matchGroups(
    groups.map((group) => ({
      namedCode: namedCodeOf(group),
      thicknessInches: group.inches,
    })),
    items.map((item) => ({
      id: item.id,
      name: item.name,
      thicknessIn: item.thicknessIn ?? null,
      assemblyCode: item.assemblyCode ?? null,
    })),
  );
  return groups.map((group, index) =>
    group.itemId != null ? group : { ...group, itemId: matched.get(index) ?? null },
  );
}
