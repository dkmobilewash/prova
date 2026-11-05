import { inchLabel, toEighth } from "@/lib/takeoff/wallVectors";
import { plainTag } from "@/lib/takeoff/planTextTags";
import type { WallGroup } from "@/lib/takeoff/wallGroups";

/**
 * ── ONE KEY AND ONE DEFAULT NAME FOR A WALL GROUP, ON BOTH SIDES ──
 *
 * A wall group is not a row: it is recomputed from the stored proposals on
 * every load (and from a fresh find in the browser). So the team's name for it
 * (`TakeoffLayerName`) is keyed on what makes it the same group across those:
 * its thickness to the eighth and the drawing's tag. The workspace, the
 * rename action and the export all build the key here, so a name written from
 * one is found by the others. Rooms and doors are single layers: `rooms`,
 * `doors`.
 */
export type LayerGroup = Pick<WallGroup, "inches" | "source" | "itemId">;

export function layerKeyOf(group: LayerGroup): string {
  return `wall:${toEighth(group.inches)}:${group.source.kind === "TAG" ? group.source.tag : ""}`;
}

/** The fixed layers' keys, beside the wall groups'. */
export const FIXED_LAYER_KEYS = ["rooms", "doors"] as const;

/** A key the rename action will accept: one this module could have built. */
export function isLayerKey(key: string): boolean {
  return (FIXED_LAYER_KEYS as readonly string[]).includes(key) || /^wall:\d+(\.\d+)?:[^\n]{0,80}$/.test(key);
}

/** The name a group has until somebody on the team renames it. */
export function defaultLayerName(group: LayerGroup, itemNames: ReadonlyMap<string, string>): string {
  return [
    group.itemId ? itemNames.get(group.itemId) : null,
    group.source.kind === "TAG" ? plainTag(group.source.tag) : null,
    inchLabel(group.inches),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The longest name a layer takes; the row truncates, the export does not. */
export const LAYER_NAME_MAX = 80;
