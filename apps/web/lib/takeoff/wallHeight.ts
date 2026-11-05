import { boardedArea } from "@/lib/takeoff";
import { formatFeetInches } from "@/lib/feet-inches";
import { pointInRing } from "@/lib/takeoff/drawTools";

/**
 * ── A WALL GROUP'S HEIGHT, SQUARE FEET, AND WHERE THE HEIGHT CAME FROM ──
 *
 * Read off what is stored today, nothing new: the group's takeoff item holds
 * the height and sides the estimate prices at (`takeoff-item-lines.ts` reads
 * the same two columns), the item's wall type holds the height the legend
 * read gave it (with the chain in its notes — `wallLegend.ts`), and a saved
 * room holds the ceiling the room finder read off the ceiling plan.
 *
 * WHERE A HEIGHT CAME FROM IS DERIVED, NOT STORED: the item's height is set
 * against the two figures the screen can offer, and whichever it equals is
 * named. One a person typed that matches neither says "typed". A stored
 * source would be a second fact that could disagree with the height.
 */

export type HeightOption = { kind: "ceiling" | "legend"; feet: number; from: string };

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** `10'-0"`. */
export const feetLabel = formatFeetInches;

/**
 * The legend's height for a type: its stored default, with the sentence the
 * legend read wrote into the notes — `Height 15 ft (MEDIUM): "TO DECK"; A301
 * prints T.O. ROOF FRAMING 15' 0"`. A default somebody typed on the library
 * page has no such line and says so.
 */
export function legendOption(type: { code: string; defaultHeightFt: number | null; notes?: string | null } | null | undefined): HeightOption | null {
  if (!type || type.defaultHeightFt === null || !(type.defaultHeightFt > 0)) return null;
  const why = (type.notes ?? "").split("\n").map((l) => l.match(/^Height [\d.]+ ft \([^)]*\): (.+)$/)?.[1]).find(Boolean);
  const feet = type.defaultHeightFt;
  return { kind: "legend", feet, from: why ? `legend ${type.code}: ${why} → ${feetLabel(feet)}` : `${type.code} in your library: ${feetLabel(feet)}` };
}

/**
 * The legend's height and, where the drawing gives one per part of the
 * building, each of those — Joplin's 12'-0" lower roofs, 12'-4" admin, 16'-8"
 * central tower — as options with what printed them, read back from the
 * notes the legend add wrote (`heightOptionLines`). Nothing is picked.
 */
export function legendOptions(type: { code: string; defaultHeightFt: number | null; notes?: string | null } | null | undefined): HeightOption[] {
  if (!type) return [];
  const one = legendOption(type);
  const more = (type.notes ?? "")
    .split("\n")
    .map((l) => l.match(/^Height option ([\d.]+) ft: (.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null && Number(m[1]) > 0)
    .map((m): HeightOption => ({ kind: "legend", feet: Number(m[1]), from: `legend ${type.code}: ${m[2]} → ${feetLabel(Number(m[1]))}` }));
  return [...(one === null ? [] : [one]), ...more.filter((o) => one === null || !same(o.feet, one.feet))];
}

export type CeilingRoom = { xs: number[]; ys: number[]; heightFeet: number | null; name: string; from: string | null };

/**
 * The ceiling over the rooms a group's walls bound. Each run is looked at a
 * hair to either side of its middle; the room there gives its ceiling,
 * weighted by the run's length. The height covering the most wall wins.
 * Null when no room beside the walls has a ceiling height.
 */
export function ceilingOption(runs: readonly { x1: number; y1: number; x2: number; y2: number }[], rooms: readonly CeilingRoom[]): HeightOption | null {
  const withHeight = rooms.filter((r) => r.heightFeet !== null && r.heightFeet > 0);
  if (withHeight.length === 0) return null;
  const weight = new Map<number, { length: number; rooms: Set<string>; from: Set<string> }>();
  for (const run of runs) {
    const length = Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
    if (length === 0) continue;
    // ponytail: a fixed offset in page-width units (~1/3 in on a 36 in sheet); thick walls drawn wider than that miss.
    const off = 0.004;
    const nx = (-(run.y2 - run.y1) / length) * off;
    const ny = ((run.x2 - run.x1) / length) * off;
    const mx = (run.x1 + run.x2) / 2;
    const my = (run.y1 + run.y2) / 2;
    for (const [px, py] of [[mx + nx, my + ny], [mx - nx, my - ny]] as const) {
      const room = withHeight.find((r) => pointInRing(px, py, r.xs, r.ys));
      if (!room) continue;
      const h = Math.round(room.heightFeet! * 12) / 12;
      const at = weight.get(h) ?? { length: 0, rooms: new Set(), from: new Set() };
      at.length += length;
      at.rooms.add(room.name);
      if (room.from) at.from.add(room.from);
      weight.set(h, at);
    }
  }
  const best = [...weight.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return null;
  const [feet, at] = best;
  const where = at.from.has("schedule") && at.from.size === 1 ? "finish schedule" : at.from.has("estimator") && at.from.size === 1 ? "ceiling typed" : "ceiling plan";
  const names = [...at.rooms];
  const which = names.length === 1 ? `room ${names[0]}` : `${names.length} rooms`;
  return { kind: "ceiling", feet, from: `${where}, ${which}: ${feetLabel(feet)}` };
}

/** Where a height came from, in words, against the figures on offer. Null when there is no height. */
export function heightFrom(heightFt: number | null, options: readonly HeightOption[]): string | null {
  if (heightFt === null) return null;
  const match = options.find((o) => same(o.feet, heightFt));
  return match ? match.from : `typed: ${feetLabel(heightFt)}`;
}

/**
 * Square feet of wall: length × height × sides, less the openings the
 * company deducts (`boardedArea`, the estimate's own rule). Null without a
 * height — a wall with no height has no area, and zero would read as one.
 */
export function wallSquareFeet(input: { linearFt: number; heightFt: number | null; sides: number | null; openings?: readonly { widthFt: number; heightFt: number }[]; thresholdSqFt?: number }): number | null {
  if (input.heightFt === null || !(input.heightFt > 0)) return null;
  const sides = input.sides === 1 ? 1 : 2;
  return Math.round(boardedArea({ lengthFt: input.linearFt, heightFt: input.heightFt, sides, openings: [...(input.openings ?? [])] }, { openingDeductionThresholdSqFt: input.thresholdSqFt ?? 0 }));
}

/** `120 ft × 10'-0" × 2 sides = 2,400 sf`, or `120 ft · no height` — the line a row reads. */
export function areaLine(input: { linearFt: number; heightFt: number | null; sides: number | null; sqFt: number | null }): string {
  const lf = `${Math.round(input.linearFt).toLocaleString()} ft`;
  if (input.heightFt === null || input.sqFt === null) return `${lf} · no height`;
  const sides = input.sides === 1 ? 1 : 2;
  return `${lf} × ${feetLabel(input.heightFt)} × ${sides} side${sides === 1 ? "" : "s"} = ${input.sqFt.toLocaleString()} sf`;
}
