/**
 * ── THE ITEMS THE ROOMS PANEL SAVES INTO, named in one place ──
 *
 * `saveRoomMeasurements` creates them; the expander and the assembly panel
 * recognise them. A `"use server"` file cannot export a constant, which is
 * why these live here rather than beside the action.
 */
export const ROOMS_ITEM = "Rooms";

export const CEILING_ITEM: Record<string, { name: string; starter: string | null }> = {
  ACT: { name: "Ceiling — ACT", starter: "ACT2" },
  GYP: { name: "Ceiling — GYP", starter: "GYPC1" },
  OPEN: { name: "Ceiling — open to structure", starter: null },
  OTHER: { name: "Ceiling — other", starter: null },
};

/**
 * Whether an item is a CHECK FIGURE rather than something this trade prices.
 *
 * "Rooms" holds every room's floor so an estimator can check a count or a
 * footprint; a drywall, ceilings or plaster sub does not bid the floor. So it
 * is left out of "measured but not priced", which would otherwise say so on
 * every Send, and reported as square feet instead.
 */
export function isCheckFigureItem(name: string): boolean {
  return name.trim() === ROOMS_ITEM;
}
