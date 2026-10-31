import type { Prisma } from "@prova/db";

import { componentRunQuantity, type RunGeometry, type WallComponentBasis } from "@/lib/wall-assemblies";
import { itemQuantity, type ItemMeasurement, type ItemProperties } from "@/lib/takeoff/itemQuantities";
import { studsRequired } from "@/lib/takeoff";
import { isCheckFigureItem } from "@/lib/takeoff/roomItems";

/**
 * ── A TAKEOFF ITEM'S SHARE OF THE ESTIMATE ──
 *
 * The item owns the quantity, its assembly owns the parts, and this writes
 * what that comes to onto the job's estimate lines.
 *
 * ── THE SAME THREE RULES `wall-schedule.ts` FOLLOWS, AND FOR THE SAME REASONS
 *
 *  1. **Update in place.** A generated line is found by its (item, part) pair
 *     and only its QUANTITY and LABOUR HOURS move. The id survives, so cost
 *     entries and change-order history keep pointing at it — and a price the
 *     estimator typed over the catalog's stays, because pricing is theirs and
 *     measuring is this function's.
 *  2. **Create from the catalog.** A new line takes price, cost, craft and
 *     trade from the part's catalog entry, marked `priceBasis:
 *     COMPANY_CATALOG`. A part with no catalog entry makes an unpriced line,
 *     like a takeoff.
 *  3. **Soft-delete what is gone**, so history keeps it and totals drop it —
 *     and RELEASE the links when doing so, which is what makes this
 *     function's own removals distinguishable from a person's. A line a
 *     PERSON deleted keeps its links and is never rebuilt.
 *
 * ── AND ONE RULE OF ITS OWN: IT NEVER TOUCHES A WALL-SCHEDULE LINE ──
 *
 * Both expanders write `wallTypeComponentId`. Without a way to tell them
 * apart, each would retire the other's lines on every save — the wall
 * schedule's sweep deletes any line whose component is not in the schedule,
 * and a takeoff item's component usually is not. `takeoffItemId` is what
 * separates them: this function reads and writes only lines that carry one,
 * and `syncWallScheduleLines` ignores exactly those.
 */

type Tx = Prisma.TransactionClient;

export type ItemForLines = {
  id: string;
  name: string;
  type: ItemProperties["type"];
  heightFt: number | null;
  sides: number | null;
  wastePercent: number | null;
  depthIn: number | null;
  measurements: ItemMeasurement[];
  wallTypeId: string | null;
  /**
   * The assembly's stud spacing, in inches. With it, a traced wall counts its
   * studs the way a wall run does (`studsRequired`); without one, `studs`
   * stays at zero and a STUDS part prices nothing rather than guessing 16".
   *
   * This shipped behind a flag first, because every partition starter and
   * every legend-made type carries a STUDS part and this used to hard-code
   * zero. Diego ran the impact query against production on 2026-10-22: ZERO
   * measured items were linked to an assembly with a STUDS part, so no
   * existing estimate changes, and the flag came out the same day.
   */
  studSpacingIn?: number | null;
};

export type ItemLineSummary = {
  created: number;
  updated: number;
  removed: number;
  /** Items with measurements but no assembly — measured, not priced. */
  unpriced: { id: string; name: string }[];
  /**
   * Items that are a CHECK FIGURE rather than something this trade prices —
   * "Rooms", the floor. Reported as square feet instead of as "not priced",
   * which it said on every Send and was never going to stop saying.
   */
  checkFigures: { id: string; name: string; squareFeet: number }[];
  /** Items whose assembly has no parts, so it can produce no lines. */
  emptyAssembly: { id: string; name: string }[];
};

/**
 * The geometry an item offers a basis.
 *
 * ── A WALL'S BASES ARE FILLED FROM THE ITEM'S PROPERTIES, NOT LEFT EMPTY ──
 *
 * An item traced as LINEAR with a height and sides IS a wall, and a drywall
 * assembly prices it off `BOARDED_SQFT`. Leaving those at zero would mean the
 * starter partition assembly produced nothing from a traced wall, which is the
 * single most common thing this product does.
 *
 * `faceSqFt` and `boardedSqFt` are computed from the item's own waste-free
 * length, because `componentQuantity` applies waste itself — applying the
 * item's waste here as well would square it.
 */
export function itemGeometry(item: ItemForLines): RunGeometry {
  const quantity = itemQuantity(item.measurements, {
    type: item.type,
    heightFt: item.heightFt,
    sides: item.sides,
    // DELIBERATELY ZERO. Waste belongs to the PART — `componentRunQuantity`
    // multiplies by `(1 + component.wastePercent)` — and an item-level waste
    // applied here would be applied twice to every part that carries its own.
    wastePercent: 0,
    depthIn: item.depthIn,
  });

  const heightFt = item.heightFt ?? 0;
  const sides = item.sides ?? 0;
  const depthFt = (item.depthIn ?? 0) / 12;

  return {
    linearFt: quantity.linearFt,
    heightFt,
    faceSqFt: quantity.linearFt * heightFt,
    boardedSqFt: quantity.linearFt * heightFt * sides,
    // An item has no stud spacing of its own; the assembly's `studSpacingIn`
    // is handed in (see `ItemForLines`). Without one: zero rather than a
    // guess, because a guessed stud count is a number that looks right and
    // gets bid.
    studs:
      item.studSpacingIn !== undefined && item.studSpacingIn !== null && item.studSpacingIn > 0 && quantity.linearFt > 0
        ? studsRequired(quantity.linearFt, { spacingFt: item.studSpacingIn / 12 })
        : 0,
    areaSqFt: quantity.areaSqFt,
    // ── PERIMETER ONLY FROM AN `AREA_WITH_PERIMETER` ITEM ──
    //
    // `itemQuantity` puts an area's perimeter in `linearFt` for that type and
    // leaves it at zero for a plain AREA. So a part asking for PERIMETER_FT
    // on a plain area gets nothing — which is the honest zero this file's
    // header describes, and the fix is to type the item as the thing that has
    // a perimeter rather than to guess one from a bounding box.
    perimeterFt: item.type === "AREA_WITH_PERIMETER" ? quantity.linearFt : 0,
    count: quantity.count,
    volumeCy: depthFt > 0 ? (quantity.areaSqFt * depthFt) / 27 : 0,
  };
}

/** Everything the expander needs, read through the transaction client. */
export async function loadItemsForLines(tx: Tx, companyId: string, jobId: string, onlyItemIds?: readonly string[]) {
  const items = await tx.takeoffItem.findMany({
    where: { jobId, companyId, ...(onlyItemIds ? { id: { in: [...onlyItemIds] } } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      measurements: {
        select: {
          id: true,
          kind: true,
          xs: true,
          ys: true,
          cutouts: true,
          page: { select: { pageNumber: true } },
          calibration: {
            select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true },
          },
        },
      },
    },
  });

  const assemblyIds = [...new Set(items.map((item) => item.wallTypeId).filter((id): id is string => id !== null))];
  const job = await tx.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { assemblyLibraryPinnedAt: true },
  });

  const assemblies = assemblyIds.length
    ? await tx.wallType.findMany({
        where: { id: { in: assemblyIds }, companyId },
        include: {
          components: {
            // ── THE PIN, which is the whole of "don't rewrite a sent bid" ──
            //
            // A part added to a company assembly AFTER this job pinned its
            // library is not this job's. Without the pin every job follows
            // the library, which is the right default — most of the time a
            // corrected assembly should correct the open bids too.
            where:
              job.assemblyLibraryPinnedAt === null
                ? undefined
                : { createdAt: { lte: job.assemblyLibraryPinnedAt } },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: { catalogEntry: true },
          },
        },
      })
    : [];

  return { items, assemblies, pinnedAt: job.assemblyLibraryPinnedAt };
}

const num = (value: { toString(): string } | number | null | undefined): number | null =>
  value == null ? null : Number(value);

/**
 * Write every takeoff item's parts onto the job's estimate lines.
 *
 * Called inside the caller's transaction, like `syncWallScheduleLines`, so the
 * items and the lines can never be observed disagreeing.
 *
 * ── `onlyItemIds`: RE-DERIVE THESE ITEMS' LINES AND TOUCH NOTHING ELSE ──
 *
 * Omitted, this is "Send takeoff to estimate": every item, job-wide, which
 * CREATES lines for any item with an assembly. Given, only those items are
 * read and only their existing lines are compared — the (item, part) key
 * means no other item's lines can be created, updated or retired. The Bid
 * guide's tap answers pass the items of the answered type that are ALREADY on
 * the estimate (`lib/actions/bidGuide.ts`): a tap about W1's board must move
 * W1's traced walls, and must not put another type's unsent tracing on a bid.
 * Found by the db test, where the job-wide form did exactly that.
 */
export async function syncTakeoffItemLines(
  tx: Tx,
  companyId: string,
  jobId: string,
  onlyItemIds?: readonly string[],
): Promise<ItemLineSummary> {
  const { items, assemblies } = await loadItemsForLines(tx, companyId, jobId, onlyItemIds);
  const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]));

  const unpriced: { id: string; name: string }[] = [];
  const checkFigures: ItemLineSummary["checkFigures"] = [];
  const emptyAssembly: { id: string; name: string }[] = [];

  /** `${itemId}:${componentId}` → the line it should produce. */
  const wanted = new Map<
    string,
    {
      itemId: string;
      componentId: string;
      description: string;
      unit: string | null;
      quantity: number;
      laborHours: number | null;
      productionRate: number | null;
      component: (typeof assemblies)[number]["components"][number];
    }
  >();

  for (const item of items) {
    const measured = item.measurements.length > 0;
    if (item.wallTypeId === null) {
      if (measured && isCheckFigureItem(item.name)) {
        const area = itemQuantity(
          item.measurements.map((m) => ({ id: m.id, pageNumber: m.page.pageNumber, kind: m.kind, xs: m.xs, ys: m.ys, cutouts: [], feetPerPageWidth: m.calibration === null ? null : feetAcross(m.calibration) })),
          { type: item.type, heightFt: null, sides: null, wastePercent: 0, depthIn: null },
        ).areaSqFt;
        checkFigures.push({ id: item.id, name: item.name, squareFeet: Math.round(area) });
      } else if (measured) unpriced.push({ id: item.id, name: item.name });
      continue;
    }
    const assembly = assemblyById.get(item.wallTypeId);
    if (!assembly) continue;
    if (assembly.components.length === 0) {
      if (measured) emptyAssembly.push({ id: item.id, name: item.name });
      continue;
    }

    const geometry = itemGeometry({
      id: item.id,
      name: item.name,
      type: item.type,
      heightFt: num(item.heightFt),
      sides: item.sides,
      wastePercent: num(item.wastePercent),
      depthIn: num(item.depthIn),
      wallTypeId: item.wallTypeId,
      studSpacingIn: num(assembly.studSpacingIn),
      measurements: item.measurements.map(itemMeasurementOf),
    });

    for (const component of assembly.components) {
      const raw = componentRunQuantity(
        {
          id: component.id,
          description: component.description,
          unit: component.unit,
          basis: component.basis as WallComponentBasis,
          factor: Number(component.factor),
          wastePercent: Number(component.wastePercent),
          roundUp: component.roundUp,
          perLayer: component.perLayer,
          productionRate: num(component.productionRate),
        },
        geometry,
        // The assembly's own board-layer answer, so a traced wall and a wall
        // run of the same type count the same board (`layerMultiplier`).
        { boardLayers: assembly.boardLayers },
      );
      // `roundUp` is the part's own answer to "can you buy a fraction of
      // this" — a sheet of board cannot be half-bought, a foot of track can.
      const quantity = component.roundUp ? Math.ceil(raw) : Math.round(raw * 100) / 100;
      // A PART THAT COMES TO NOTHING WRITES NO LINE. A zero-quantity line on a
      // bid is a row somebody has to read and dismiss, and on an item measured
      // in the wrong units there would be one per part.
      if (!(quantity > 0)) continue;

      const rate = num(component.productionRate);
      wanted.set(`${item.id}:${component.id}`, {
        itemId: item.id,
        componentId: component.id,
        description: `${item.name} — ${component.description}`,
        unit: component.unit,
        quantity,
        laborHours: rate != null && rate > 0 ? quantity / rate : null,
        productionRate: rate,
        component,
      });
    }
  }

  // ── WHAT IS ALREADY THERE ──
  //
  // ONLY lines carrying a `takeoffItemId`. A wall-schedule line is not this
  // function's to read, let alone to retire.
  const existing = await tx.jobLineItem.findMany({
    where: { jobId, takeoffItemId: onlyItemIds ? { in: [...onlyItemIds] } : { not: null } },
    select: { id: true, takeoffItemId: true, wallTypeComponentId: true, isDeleted: true },
  });
  const key = (line: { takeoffItemId: string | null; wallTypeComponentId: string | null }) =>
    `${line.takeoffItemId}:${line.wallTypeComponentId}`;
  const live = new Map(existing.filter((line) => !line.isDeleted).map((line) => [key(line), line.id]));
  const removedByHand = new Set(existing.filter((line) => line.isDeleted).map(key));

  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const [id, line] of wanted) {
    const lineId = live.get(id);
    if (lineId) {
      // Quantity and labour only. The price is the estimator's once it exists.
      await tx.jobLineItem.update({
        where: { id: lineId },
        data: {
          quantity: line.quantity.toString(),
          laborHours: line.laborHours != null ? line.laborHours.toString() : null,
          productionRate: line.productionRate != null ? line.productionRate.toString() : null,
        },
      });
      updated += 1;
      continue;
    }
    // Somebody removed this one. Their decision outlives a re-sync.
    if (removedByHand.has(id)) continue;

    const entry = line.component.catalogEntry;
    await tx.jobLineItem.create({
      data: {
        jobId,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity.toString(),
        laborHours: line.laborHours != null ? line.laborHours.toString() : null,
        productionRate: line.productionRate != null ? line.productionRate.toString() : null,
        unitPrice: entry?.defaultUnitPrice ?? null,
        budgetedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        currentEstimatedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        tradeScope: entry?.tradeScope ?? null,
        costCategory: line.component.costCategory ?? entry?.costCategory ?? null,
        craftClassificationId:
          line.component.craftClassificationId ?? entry?.craftClassificationId ?? null,
        sourceCatalogEntryId: entry?.id ?? null,
        priceBasis: entry ? "COMPANY_CATALOG" : null,
        wallTypeComponentId: line.componentId,
        takeoffItemId: line.itemId,
      },
    });
    created += 1;
  }

  for (const line of existing) {
    if (line.isDeleted) continue;
    if (wanted.has(key(line))) continue;
    // Retired, and the links released — which is what makes this function's
    // own removals distinguishable from a person's next time round.
    await tx.jobLineItem.update({
      where: { id: line.id },
      data: { isDeleted: true, takeoffItemId: null, wallTypeComponentId: null },
    });
    removed += 1;
  }

  return { created, updated, removed, unpriced, checkFigures, emptyAssembly };
}

/**
 * Feet across the whole page width, from a calibration.
 *
 * The same derivation `takeoff-plan.ts` does for the browser, repeated here
 * because this runs on the server against Decimal columns and that one takes
 * numbers. Both are `declaredDistanceFeet / the calibration line's length in
 * page-width units`, which is the definition rather than a convention.
 */
/** A measurement row as Prisma returns it, the columns `itemMeasurementOf` reads. */
export type ItemMeasurementRow = {
  id: string;
  kind: ItemMeasurement["kind"];
  xs: number[];
  ys: number[];
  cutouts: unknown;
  page: { pageNumber: number };
  /** Null for a measurement with no scale: a count needs none (#883). */
  calibration: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: { toString(): string } } | null;
};

/** One stored measurement → what `itemGeometry` reads. The sync's own mapping. */
function itemMeasurementOf(m: ItemMeasurementRow): ItemMeasurement {
  return {
    id: m.id,
    pageNumber: m.page.pageNumber,
    kind: m.kind,
    xs: m.xs,
    ys: m.ys,
    cutouts: Array.isArray(m.cutouts) ? (m.cutouts as { xs: number[]; ys: number[] }[]) : [],
    feetPerPageWidth: m.calibration === null ? null : feetAcross(m.calibration),
  };
}

/**
 * The traced length of a LINEAR takeoff item, in feet — the footage the Bid
 * guide quotes when it asks about the item's wall type. Through the SAME
 * `itemGeometry` and measurement mapping `syncTakeoffItemLines` prices from,
 * so the number in the question is the length the estimate lines come from.
 * Anything that is not a line (an area, a count) has no wall footage: zero.
 */
export function itemTracedFeet(item: { id: string; name: string; type: ItemProperties["type"]; measurements: ItemMeasurementRow[] }): number {
  if (item.type !== "LINEAR") return 0;
  return itemGeometry({
    id: item.id,
    name: item.name,
    type: item.type,
    heightFt: null,
    sides: null,
    wastePercent: null,
    depthIn: null,
    wallTypeId: null,
    measurements: item.measurements.map(itemMeasurementOf),
  }).linearFt;
}

function feetAcross(calibration: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  declaredDistanceFeet: { toString(): string };
}): number | null {
  const span = Math.hypot(calibration.x2 - calibration.x1, calibration.y2 - calibration.y1);
  if (!(span > 0)) return null;
  const feet = Number(calibration.declaredDistanceFeet);
  if (!Number.isFinite(feet) || feet <= 0) return null;
  return feet / span;
}
