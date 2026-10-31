import { polylineLength, ringArea, ringPerimeter } from "@/lib/sheet-geometry";

/**
 * ── WHAT AN ITEM ADDS UP TO ──
 *
 * One item is measurements across many sheets, each traced against that
 * sheet's own calibration. This turns them into the numbers an estimator and
 * an assembly both read.
 *
 * ── NOTHING HERE IS STORED, and that is `takeoff.prisma`'s standing rule ──
 *
 * Every figure is computed from coordinates plus a calibration on each read.
 * A stored total is a number that was true against a scale somebody may since
 * have corrected, and this file is cheap enough to re-run that there is no
 * reason to keep one.
 *
 * ── PURE, SO THE ARITHMETIC CAN BE ARGUED WITH ──
 *
 * No React, no Prisma, no Decimal. Every rule below is one somebody will
 * eventually disagree with — whether a cutout can exceed its outline, what a
 * segment counts as, whether waste applies to a count — and a rule you can
 * disagree with is a rule worth testing.
 */

/** One traced shape, as this module needs it. */
export type ItemMeasurement = {
  id: string;
  pageNumber: number;
  kind: "LINEAR" | "AREA" | "COUNT";
  xs: number[];
  ys: number[];
  /** Openings deducted from an AREA. Ignored for the other kinds. */
  cutouts?: { xs: number[]; ys: number[] }[];
  /** Doors and windows in this wall, taken off its board. Ignored for the other kinds. */
  openings?: { widthFt: number; heightFt: number }[];
  /**
   * Feet across the page's full width, from the sheet's calibration. Null
   * when the sheet has no scale — those measurements contribute GEOMETRY but
   * no footage, which is reported rather than silently treated as zero.
   */
  feetPerPageWidth: number | null;
};

/** The properties that turn geometry into the quantity an assembly prices. */
export type ItemProperties = {
  type: "LINEAR" | "AREA" | "COUNT" | "SEGMENT" | "AREA_WITH_PERIMETER";
  heightFt?: number | null;
  sides?: number | null;
  wastePercent?: number | null;
  depthIn?: number | null;
};

export type ItemQuantity = {
  /** Running feet, for LINEAR and SEGMENT items and an area's perimeter. */
  linearFt: number;
  /** Square feet of the traced outlines, cutouts already deducted. */
  areaSqFt: number;
  /** How many things, for COUNT items. */
  count: number;
  /**
   * The quantity an assembly is priced against, and the unit it is in.
   * This is the one number that goes on screen beside the item's name.
   */
  primary: number;
  unit: "ft" | "sq ft" | "ea" | "cu yd";
  /**
   * Wall face area: `linearFt × height × sides`, waste applied. Zero unless
   * the item has a height.
   */
  faceSqFt: number;
  /** How many measurements could not be priced because their sheet has no scale. */
  unscaled: number;
  /** Which sheets this item appears on, ascending. */
  pages: number[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * An area's net square feet: the outline less anything cut out of it.
 *
 * ── A CUTOUT CANNOT MAKE AN AREA NEGATIVE ──
 *
 * Clamped at zero. A door drawn larger than the wall it is in, or the same
 * cutout traced twice, would otherwise produce a negative square footage that
 * SUBTRACTS from the item's total — quietly reducing a bid using a number
 * nobody could see on the drawing. Clamping is wrong in a way somebody will
 * notice (a zero), where the alternative is wrong in a way nobody will.
 */
export function netArea(
  xs: number[],
  ys: number[],
  cutouts: readonly { xs: number[]; ys: number[] }[] = [],
): number {
  const outline = ringArea(xs, ys);
  if (outline === null) return 0;
  let net = outline;
  for (const hole of cutouts) {
    const area = ringArea(hole.xs, hole.ys);
    if (area !== null) net -= area;
  }
  return Math.max(0, net);
}

/**
 * The item's totals.
 *
 * ── THE TYPE DECIDES WHAT THE GEOMETRY MEANS, NOT THE OTHER WAY ROUND ──
 *
 * A `SEGMENT` item stores LINEAR geometry and an `AREA_WITH_PERIMETER` stores
 * AREA geometry; the type says how to READ them. So this reads every
 * measurement's own kind for the geometry and the item's type for the answer,
 * and the two never have to agree.
 */
export function itemQuantity(
  measurements: readonly ItemMeasurement[],
  properties: ItemProperties,
): ItemQuantity {
  let linearFt = 0;
  let areaSqFt = 0;
  let perimeterFt = 0;
  let count = 0;
  let unscaled = 0;
  const pages = new Set<number>();

  for (const m of measurements) {
    pages.add(m.pageNumber);

    if (m.kind === "COUNT") {
      // A count is the number of POINTS placed, and it needs no scale — which
      // is why it is tallied before the scale check below rather than after.
      count += m.xs.length;
      continue;
    }

    const scale = m.feetPerPageWidth;
    if (scale === null || !Number.isFinite(scale) || scale <= 0) {
      unscaled += 1;
      continue;
    }

    if (m.kind === "LINEAR") {
      linearFt += polylineLength(m.xs, m.ys) * scale;
    } else {
      areaSqFt += netArea(m.xs, m.ys, m.cutouts ?? []) * scale * scale;
      // The perimeter is of the OUTLINE, never of the cutouts: base and wall
      // angle follow the room, not the doors punched out of it.
      perimeterFt += (ringPerimeter(m.xs, m.ys) ?? 0) * scale;
    }
  }

  const waste = 1 + Math.max(0, properties.wastePercent ?? 0) / 100;
  const height = properties.heightFt ?? 0;
  const sides = properties.sides ?? 0;
  const faceSqFt = linearFt * height * sides * waste;

  // ── WHAT GOES ON SCREEN BESIDE THE NAME ──
  //
  // Waste is applied to every MATERIAL quantity and NEVER to a count. You do
  // not buy 1.1 doors, and a count with waste on it reads as a miscount
  // rather than as an allowance.
  let primary: number;
  let unit: ItemQuantity["unit"];
  switch (properties.type) {
    case "COUNT":
      primary = count;
      unit = "ea";
      break;
    case "AREA":
      primary = areaSqFt * waste;
      unit = "sq ft";
      break;
    case "AREA_WITH_PERIMETER":
      // The AREA is the headline; the perimeter is carried in `linearFt` for
      // the parts that price base, angle and edge trim off it.
      primary = areaSqFt * waste;
      unit = "sq ft";
      break;
    default:
      // LINEAR and SEGMENT. A segment is measured the same way and differs
      // only in what an assembly does with it, which is not this file's
      // business.
      primary = linearFt * waste;
      unit = "ft";
      break;
  }

  return {
    linearFt: round2(properties.type === "AREA_WITH_PERIMETER" ? perimeterFt : linearFt),
    areaSqFt: round2(areaSqFt),
    count,
    primary: round2(primary),
    unit,
    faceSqFt: round2(faceSqFt),
    unscaled,
    pages: [...pages].sort((a, b) => a - b),
  };
}

/** The same figures for ONE sheet, which is what the on-canvas summary shows. */
export function itemQuantityOnPage(
  measurements: readonly ItemMeasurement[],
  properties: ItemProperties,
  pageNumber: number,
): ItemQuantity {
  return itemQuantity(
    measurements.filter((m) => m.pageNumber === pageNumber),
    properties,
  );
}

/**
 * Cutouts as stored: a `Json` column that may hold anything.
 *
 * VALIDATED ON THE WAY OUT, not trusted. The column is `Json` for the reason
 * `TakeoffWallProposal.runs` is — nothing joins to a single cutout — and the
 * price of that is a shape the database cannot enforce. A malformed entry is
 * DROPPED rather than thrown on: a bad hole should cost the deduction it
 * represents, not the whole sheet's area.
 */
export function cutoutsFromJson(raw: unknown): { xs: number[]; ys: number[] }[] {
  if (!Array.isArray(raw)) return [];
  const out: { xs: number[]; ys: number[] }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { xs, ys } = entry as { xs?: unknown; ys?: unknown };
    if (!Array.isArray(xs) || !Array.isArray(ys)) continue;
    if (xs.length !== ys.length || xs.length < 3) continue;
    if (!xs.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    if (!ys.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({ xs: xs as number[], ys: ys as number[] });
  }
  return out;
}

/** The row shape the workspace loads an item as. */
export type TakeoffItemRow = {
  id: string;
  name: string;
  type: ItemProperties["type"];
  colorHex: string;
  lineStyle: "SOLID" | "DASHED" | "DOTTED";
  heightFt: number | null;
  sides: number | null;
  thicknessIn: number | null;
  wastePercent: number | null;
  spacingIn: number | null;
  depthIn: number | null;
  wallTypeId: string | null;
  sortOrder: number;
  measurements: ItemMeasurement[];
};

/** How a quantity reads beside a name: `1,240.5 ft`. */
export function formatQuantity(quantity: ItemQuantity): string {
  const n = quantity.primary;
  const shown = n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(round2(n));
  return `${shown} ${quantity.unit}`;
}
