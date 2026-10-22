import type { Prisma } from "@prova/db";

import { componentRunQuantity, type RunGeometry, type WallComponentBasis } from "@/lib/wall-assemblies";
import { itemQuantity, type ItemMeasurement, type ItemProperties } from "@/lib/takeoff/itemQuantities";

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
};

export type ItemLineSummary = {
  created: number;
  updated: number;
  removed: number;
  /** Items with measurements but no assembly — measured, not priced. */
  unpriced: { id: string; name: string }[];
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
    // An item has no stud spacing of its own in the geometry; the assembly's
    // own `studSpacingIn` is what `runGeometry` uses for a wall run, and a
    // part that wants studs off an item should price them per foot instead.
    // Zero rather than a guess: a guessed stud count is a number that looks
    // right and gets bid.
    studs: 0,
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
export async function loadItemsForLines(tx: Tx, companyId: string, jobId: string) {
  const items = await tx.takeoffItem.findMany({
    where: { jobId, companyId },
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
 */
export async function syncTakeoffItemLines(
  tx: Tx,
  companyId: string,
  jobId: string,
): Promise<ItemLineSummary> {
  const { items, assemblies } = await loadItemsForLines(tx, companyId, jobId);
  const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]));

  const unpriced: { id: string; name: string }[] = [];
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
      if (measured) unpriced.push({ id: item.id, name: item.name });
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
      measurements: item.measurements.map((m) => ({
        id: m.id,
        pageNumber: m.page.pageNumber,
        kind: m.kind,
        xs: m.xs,
        ys: m.ys,
        cutouts: Array.isArray(m.cutouts) ? (m.cutouts as { xs: number[]; ys: number[] }[]) : [],
        feetPerPageWidth: feetAcross(m.calibration),
      })),
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
          productionRate: num(component.productionRate),
        },
        geometry,
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
    where: { jobId, takeoffItemId: { not: null } },
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

  return { created, updated, removed, unpriced, emptyAssembly };
}

/**
 * Feet across the whole page width, from a calibration.
 *
 * The same derivation `takeoff-plan.ts` does for the browser, repeated here
 * because this runs on the server against Decimal columns and that one takes
 * numbers. Both are `declaredDistanceFeet / the calibration line's length in
 * page-width units`, which is the definition rather than a convention.
 */
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
