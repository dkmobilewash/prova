import type { Prisma } from "@prova/db";

import { componentRunQuantity, openingsFromJson, type RunGeometry, type WallComponentBasis } from "@/lib/wall-assemblies";
import { openingThresholdSqFt as thresholdFor } from "@/lib/businessScope";
import { itemQuantity, type ItemMeasurement, type ItemProperties } from "@/lib/takeoff/itemQuantities";
import { studsRequired } from "@/lib/takeoff";
import { isCheckFigureItem } from "@/lib/takeoff/roomItems";
import { nextItemColor } from "@/lib/takeoff/itemColors";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";
import { HELD_ITEM } from "@/lib/takeoff/estimateHold";
import { boardedArea } from "@/lib/takeoff";

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
  /** The company's own "openings smaller than this stay", when it answered. */
  openingThresholdSqFt?: number | null;
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
  // Every opening comes off unless the company says small ones stay: Diego's
  // call, 2026-10-31. A 3 x 7 door is 21 sf, under the rule's usual 32.
  const openings = item.measurements.flatMap((m) => m.openings ?? []);
  const deduct = { openingDeductionThresholdSqFt: item.openingThresholdSqFt ?? 0 };

  return {
    linearFt: quantity.linearFt,
    heightFt,
    faceSqFt: boardedArea({ lengthFt: quantity.linearFt, heightFt, sides: 1, openings }, deduct),
    boardedSqFt: boardedArea({ lengthFt: quantity.linearFt, heightFt, sides: sides as 1 | 2, openings }, deduct),
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

const CEILING_ITEM_PREFIX = "Ceiling — ";
/** Holds the finish lines, so a re-send updates them and a removed one stays removed. */
export const FINISH_ITEM = "Finish schedule";

export type FinishLineStored = { description: string; quantity: number; unit: string };
export function finishTakeoffFrom(value: unknown): { lines: FinishLineStored[]; ceilingRooms: string[] } {
  const v = (value ?? {}) as { lines?: FinishLineStored[]; ceilingRooms?: string[] };
  return { lines: Array.isArray(v.lines) ? v.lines : [], ceilingRooms: Array.isArray(v.ceilingRooms) ? v.ceilingRooms : [] };
}

async function finishItem(tx: Tx, companyId: string, jobId: string): Promise<string> {
  const existing = await tx.takeoffItem.findMany({ where: { jobId }, select: { colorHex: true, sortOrder: true }, orderBy: { sortOrder: "desc" } });
  const made = await tx.takeoffItem.create({ data: { companyId, jobId, name: FINISH_ITEM, type: "COUNT", colorHex: nextItemColor(existing.map((i) => i.colorHex)), sortOrder: (existing[0]?.sortOrder ?? -1) + 1 }, select: { id: true } });
  return made.id;
}

/** The item `saveDemoTakeoff` writes: lengths with no assembly, which still belong on the estimate. */
const DEMO_WALLS = "Demo walls";

/** Everything the expander needs, read through the transaction client. */
export async function loadItemsForLines(tx: Tx, companyId: string, jobId: string) {
  const items = await tx.takeoffItem.findMany({
    where: { jobId, companyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      measurements: {
        select: {
          id: true,
          postedAt: true,
          ceilingFamily: true,
          roomNumber: true,
          label: true,
          openings: true,
          pageId: true,
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

  const fallback = await tx.wallType.findFirst({ where: { companyId, isDefaultPartition: true }, select: { id: true } });
  const assemblyIds = [...new Set([...items.map((item) => item.wallTypeId), fallback?.id ?? null].filter((id): id is string => id !== null))];
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

  const pages = await tx.takeoffPlanPage.findMany({ where: { plan: { jobId, companyId } }, select: { id: true, finishTakeoff: true } });
  return { items, assemblies, pinnedAt: job.assemblyLibraryPinnedAt, defaultPartitionId: fallback?.id ?? null, finishPages: pages.filter((p) => p.finishTakeoff !== null) };
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
  const { items, assemblies, defaultPartitionId, finishPages } = await loadItemsForLines(tx, companyId, jobId);
  const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]));
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { openingDeduction: true, openingDeductionSqFt: true } });
  const openingThresholdSqFt = company.openingDeduction === null ? 0 : thresholdFor(company.openingDeduction, company.openingDeductionSqFt === null ? null : Number(company.openingDeductionSqFt));
  const finish = finishPages.map((p) => ({ pageId: p.id, ...finishTakeoffFrom(p.finishTakeoff) }));
  // A room the finish schedule covers has its ceiling there, so the ceiling plan's copy stays off.
  const onFinishLines = (m: { pageId: string; ceilingFamily: string | null; roomNumber: string | null; label: string | null }) =>
    m.ceilingFamily !== null && finish.some((f) => f.pageId === m.pageId && f.ceilingRooms.includes(m.roomNumber ?? (m.label ?? "").replace(/ ceiling$/, "")));

  const unpriced: { id: string; name: string }[] = [];
  const checkFigures: ItemLineSummary["checkFigures"] = [];
  const emptyAssembly: { id: string; name: string }[] = [];

  /** `${itemId}:${componentId or description}` → the line it should produce. */
  const wanted = new Map<
    string,
    {
      itemId: string;
      /** Null for a plain line, which has no assembly behind it. */
      componentId: string | null;
      description: string;
      unit: string | null;
      quantity: number;
      laborHours: number | null;
      productionRate: number | null;
      component: (typeof assemblies)[number]["components"][number] | null;
    }
  >();
  const plainLine = (itemId: string, description: string, unit: string, quantity: number) =>
    wanted.set(`${itemId}:${description}`, {
      itemId,
      componentId: null,
      description,
      unit,
      quantity,
      laborHours: null,
      productionRate: null,
      component: null,
    });

  for (const raw of items) {
    // Doubted walls stay on the sheet and off the estimate until confirmed.
    if (raw.name === HELD_ITEM) continue;
    const item = { ...raw, measurements: raw.measurements.filter((m) => !onFinishLines(m)) };
    const measured = item.measurements.length > 0;
    const untyped = item.name === UNTYPED_ITEM;
    // ── NO FOOTAGE IS EVER DROPPED ──
    // Untyped walls take the company's default partition, labelled as assumed,
    // or arrive as footage with no price. Diego's call, 2026-10-31.
    const assumed = item.wallTypeId === null && untyped ? defaultPartitionId : null;
    const wallTypeId = item.wallTypeId ?? assumed;
    if (wallTypeId === null) {
      if (measured && isCheckFigureItem(item.name)) {
        const area = itemQuantity(
          item.measurements.map((m) => ({ id: m.id, pageNumber: m.page.pageNumber, kind: m.kind, xs: m.xs, ys: m.ys, cutouts: [], feetPerPageWidth: m.calibration === null ? null : feetAcross(m.calibration) })),
          { type: item.type, heightFt: null, sides: null, wastePercent: 0, depthIn: null },
        ).areaSqFt;
        checkFigures.push({ id: item.id, name: item.name, squareFeet: Math.round(area) });
      } else if (measured && (item.type === "COUNT" || untyped || item.name === DEMO_WALLS || item.name.startsWith(CEILING_ITEM_PREFIX))) {
        // ── A MEASURED THING NEEDS NO ASSEMBLY TO BE A LINE ──
        // It arrives with a quantity and no price, and what a person already
        // posted from the list is not counted again.
        const open = item.measurements.filter((m) => m.postedAt === null);
        const total = itemQuantity(
          open.map((m) => ({ id: m.id, pageNumber: m.page.pageNumber, kind: m.kind, xs: m.xs, ys: m.ys, cutouts: [], feetPerPageWidth: m.calibration === null ? null : feetAcross(m.calibration) })),
          { type: item.type, heightFt: null, sides: null, wastePercent: 0, depthIn: null },
        );
        const area = item.type === "AREA_WITH_PERIMETER";
        const quantity = item.type === "COUNT" ? total.count : area ? total.areaSqFt : total.linearFt;
        if (quantity > 0) {
          plainLine(item.id, untyped ? `${item.name} (no type: check)` : item.name, item.type === "COUNT" ? "ea" : area ? "sq ft" : "lin ft", quantity);
          if (untyped || area) unpriced.push({ id: item.id, name: item.name });
        }
      } else if (measured) unpriced.push({ id: item.id, name: item.name });
      continue;
    }
    const assembly = assemblyById.get(wallTypeId);
    if (!assembly) continue;
    if (assembly.components.length === 0) {
      if (measured) emptyAssembly.push({ id: item.id, name: item.name });
      continue;
    }

    const geometry = itemGeometry({
      id: item.id,
      name: item.name,
      type: item.type,
      heightFt: num(item.heightFt) ?? (assumed ? num(assembly.defaultHeightFt) : null),
      sides: item.sides ?? (assumed ? (assembly.sides === 1 ? 1 : 2) : null),
      wastePercent: num(item.wastePercent),
      depthIn: num(item.depthIn),
      wallTypeId,
      studSpacingIn: num(assembly.studSpacingIn),
      openingThresholdSqFt,
      measurements: item.measurements.map((m) => ({
        id: m.id,
        pageNumber: m.page.pageNumber,
        kind: m.kind,
        xs: m.xs,
        ys: m.ys,
        cutouts: Array.isArray(m.cutouts) ? (m.cutouts as { xs: number[]; ys: number[] }[]) : [],
        openings: openingsFromJson(m.openings),
        feetPerPageWidth: m.calibration === null ? null : feetAcross(m.calibration),
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
        description: `${item.name}${assumed ? " (assumed type: check)" : ""} — ${component.description}`,
        unit: component.unit,
        quantity,
        laborHours: rate != null && rate > 0 ? quantity / rate : null,
        productionRate: rate,
        component,
      });
    }
  }

  // ── THE FINISH LINES, ONE SOURCE WHETHER THE VIEWER OR THE WHOLE-SET RUN READ THEM ──
  const finishLines = finish.flatMap((f) => f.lines);
  if (finishLines.length > 0) {
    const anchor = items.find((i) => i.name === FINISH_ITEM)?.id ?? (await finishItem(tx, companyId, jobId));
    for (const line of finishLines) plainLine(anchor, line.description, line.unit, line.quantity);
  }

  // ── WHAT IS ALREADY THERE ──
  //
  // ONLY lines carrying a `takeoffItemId`. A wall-schedule line is not this
  // function's to read, let alone to retire.
  const existing = await tx.jobLineItem.findMany({
    where: { jobId, takeoffItemId: { not: null } },
    select: { id: true, takeoffItemId: true, wallTypeComponentId: true, description: true, isDeleted: true },
  });
  const key = (line: { takeoffItemId: string | null; wallTypeComponentId: string | null; description: string }) =>
    `${line.takeoffItemId}:${line.wallTypeComponentId ?? line.description}`;
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

    const entry = line.component?.catalogEntry ?? null;
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
        costCategory: line.component?.costCategory ?? entry?.costCategory ?? null,
        craftClassificationId:
          line.component?.craftClassificationId ?? entry?.craftClassificationId ?? null,
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
