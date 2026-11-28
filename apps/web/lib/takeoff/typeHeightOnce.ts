import type { Prisma } from "@prova/db";
import { heightBasis } from "@/lib/takeoff/wallHeights";

/**
 * ── A WALL TYPE'S HEIGHT, ANSWERED ONCE (coordination/type-height-once.md, REVIEWED by the original 2026-11-28) ──
 *
 * A type's walls are one item per level range on a job ("W1 walls · levels 2–4"), and each asked for its own height.
 * Here one answer reaches the type's other items, under two rules that keep it from saying anything untrue:
 *   NULL-ONLY  — only items with no height take it. A set height (a person's, or the schedule's default copied at
 *                creation) is never overwritten: nothing records a person's answer per item, so a non-null height is
 *                assumed to mean something (the reviewed decision, option b).
 *   NOT TO STRUCTURE — a type whose walls run to the deck takes each level's floor-to-floor, which differs by level.
 */
export function runsToStructure(notes: string | null | undefined): boolean {
  return (notes ?? "").split("\n").some((line) => heightBasis(line)?.kind === "to-structure");
}

/** H1: set `heightFt` on the type's OTHER items on this job that have none. Returns the items it filled, with their sides before. */
export async function fillTypeHeight(tx: Prisma.TransactionClient, at: { companyId: string; jobId: string; itemId: string; heightFt: number }): Promise<{ id: string; sides: number | null }[]> {
  const item = await tx.takeoffItem.findUnique({ where: { id: at.itemId }, select: { wallTypeId: true, wallType: { select: { notes: true } } } });
  if (!item?.wallTypeId || runsToStructure(item.wallType?.notes)) return [];
  const others = await tx.takeoffItem.findMany({ where: { companyId: at.companyId, jobId: at.jobId, wallTypeId: item.wallTypeId, id: { not: at.itemId }, heightFt: null }, select: { id: true, sides: true } });
  const ids = others.map((o) => o.id);
  if (ids.length === 0) return [];
  await tx.takeoffItem.updateMany({ where: { id: { in: ids }, heightFt: null }, data: { heightFt: at.heightFt.toFixed(2) } });
  // The same assumption the answered item takes when it has no sides yet (`setWallGroupHeight`).
  await tx.takeoffItem.updateMany({ where: { id: { in: ids }, sides: null }, data: { sides: 2 } });
  return others;
}

/**
 * Undo of one queue height answer (H4): the answered item back to what it was, and every item the answer FILLED back to
 * no height and its own sides — an Undo that left the fill behind would put back half of what one press did.
 */
export function heightUndoItems(itemId: string, was: { heightFt: string | null; sides: number | null; filled: readonly { id: string; sides: number | null }[] }) {
  return [{ id: itemId, heightFt: was.heightFt, sides: was.sides }, ...was.filled.map((f) => ({ id: f.id, heightFt: null, sides: f.sides }))];
}

/**
 * H3: the height a NEW item of this type starts from on this job, when the schedule gives none: the one height the
 * job's existing items of the type agree on. Disagreement, none, or a to-structure type: null.
 */
export function answeredTypeHeight(existing: readonly { heightFt: unknown }[], notes: string | null | undefined): number | null {
  if (runsToStructure(notes)) return null;
  const heights = new Set(existing.map((e) => (e.heightFt === null || e.heightFt === undefined ? null : Number(e.heightFt))).filter((h): h is number => h !== null && Number.isFinite(h)));
  return heights.size === 1 ? [...heights][0]! : null;
}

/** T4: what the queue says after one answer filled other items of the type, so the fill is never silent. */
export function filledWords(filled: number, feet: number): string | null {
  if (filled <= 0) return null;
  return `${feet} ft also set on ${filled} other level item${filled === 1 ? "" : "s"} of this type that had no height.`;
}
