import { prisma } from "@prova/db";
import { showsExistingWork } from "@/lib/takeoff/renovationMarks";
import { pairingsForPlan } from "@/lib/takeoff/priorPlanLoad";
import { VARIANT_NOTES } from "./variantMark";
import { aiGate } from "@/lib/ai/settings";
import { asCostCategory } from "@/lib/cost-category";
import { pricingRatesFor } from "@/lib/estimating/pricing-rates";
import { HELD_LABEL } from "@/lib/takeoff/estimateHold";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";
import { AUTO_DOORS_LABEL, AUTO_MARK, HIGH_CONFIDENCE_WALLS } from "@/lib/takeoff/autoPost";
import { nominalThicknessIn } from "@/lib/takeoff/legendBands";
import type { StoredCrop } from "@/lib/takeoff/legendProposal";
import { groupsFromProposals, storedRunsOrNull } from "@/lib/takeoff/wallProposal";
import { storedLegendCodes } from "@/lib/takeoff/planTextRead";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber, effectiveTitle } from "@/lib/plan-ingest/sheetIndex";
import { floorPlansOfTheWork, wallsSheetsFor } from "@/lib/plan-ingest/walls";
import { storedGeneralHeight, storedLevels } from "@/lib/takeoff/levelReads";
import { storedLegendTypesFromJson } from "@/lib/takeoff/legendProposal";
import { levelHeight, runLevels } from "@/lib/takeoff/levelHeights";
import { heightBasis } from "@/lib/takeoff/wallHeights";
import { roomPitched, runPitched } from "@/lib/takeoff/roofParts";
import { storedRoofParts } from "@/lib/takeoff/roofPartsRead";
import { answeredTagTypes, doorsItem, fillOfRuns, GENERAL_HEIGHT_KEY, heightItem, reviewQueue, splitByLevel, splitByRoof, suggestType, typeItems, wallItem, windowsItem, type CodeHeight, type LegendState, type QueueSheet, type ReviewItem } from "@/lib/takeoff/reviewQueue";
import { plainTag } from "@/lib/takeoff/planTextTags";
import { storedWindowsOf, WINDOWS_SUGGESTED } from "@/lib/takeoff/windowTags";
import { DOORS_SUGGESTED, storedDoorsOf } from "@/lib/takeoff/doorSuggestions";
import { refreshSuggestionsAfterResponse } from "@/lib/takeoff/suggestionRefresh";
import { buildingHeights, feetLabel, legendOption, legendOptions, type CeilingRoom } from "@/lib/takeoff/wallHeight";

/**
 * The job's review queue (`reviewQueue.ts`), plus the plan-set counts the
 * stepper reads beside it, from the job's NEWEST plan set — the one the
 * workspace opens. Select-only, but for the stale-suggestion refresh it starts
 * after the response; the job layout runs it on every tab of an estimate.
 */
export async function loadReviewQueue(
  companyId: string,
  jobId: string,
): Promise<{ planId: string | null; items: ReviewItem[]; heights: Record<string, CodeHeight>; heightChoices: Record<string, CodeHeight[]>; codes: string[]; legend: LegendState; scaledSheets: number; floorPlans: number; floorPlansScaled: number; autoPosted?: { pageNumber: number; sheet: string; feet: number; doors: number }[]; codeInfo?: Record<string, { thicknessIn: number | null; crop: StoredCrop | null; legendPage: number | null }> }> {
  const plan = await prisma.takeoffPlan.findFirst({ where: { jobId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const unpriced = await prisma.jobLineItem.findMany({
    // Never "Walls — untyped": those runs are this queue's type items, and the
    // line goes when the last of them is typed. Asked a price, every confirm
    // that wrote it put an item back for the one it took off — the count stood
    // still (fast-confirm, once confirming wrote lines; walk v3's finding 3).
    where: { jobId, job: { companyId }, isDeleted: false, unitPrice: null, budgetedUnitCost: null, OR: [{ takeoffItemId: null }, { takeoffItem: { name: { not: UNTYPED_ITEM } } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, quantity: true, unit: true, costCategory: true },
  });
  // With the company's own markup set, a price item asks for the line's cost.
  const askCost = unpriced.length > 0 && (await pricingRatesFor(companyId, jobId)) !== null;
  const prices: ReviewItem[] = unpriced.map((line) => ({
    kind: "price",
    key: `price:${line.id}`,
    lineItemId: line.id,
    description: line.description,
    quantity: line.quantity.toString(),
    unit: line.unit,
    askCost,
    costCategory: asCostCategory(line.costCategory),
  }));
  if (plan === null) return { planId: null, items: prices, heights: {}, heightChoices: {}, codes: [], legend: "read", scaledSheets: 0, floorPlans: 0, floorPlansScaled: 0 };
  // Suggestions stored before the set's legend or the current rules are worked out again, after the response (`suggestionRefresh.ts`).
  refreshSuggestionsAfterResponse({ planId: plan.id, companyId });

  const [pages, sheetRows] = await Promise.all([
    prisma.takeoffPlanPage.findMany({
      where: { planId: plan.id },
      select: {
        id: true,
        pageNumber: true,
        calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } },
        measurements: {
          where: { kind: "LINEAR", source: "DETECTED", OR: [{ label: HELD_LABEL }, { item: { name: UNTYPED_ITEM } }] },
          select: { id: true, xs: true, ys: true, label: true },
        },
      },
    }),
    sheetIndexFor(plan.id, companyId),
  ]);
  const rowByPage = new Map(sheetRows.map((row) => [row.pageNumber, row]));
  const sheetOf = (pageNumber: number, calibration?: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: { toNumber(): number } }): QueueSheet => {
    const row = rowByPage.get(pageNumber);
    return {
      pageNumber,
      sheet: (row && effectiveSheetNumber(row)) ?? `p${pageNumber}`,
      feetPerUnit: calibration === undefined ? null : feetPerPageWidth({ ...calibration, declaredDistanceFeet: calibration.declaredDistanceFeet.toNumber() }),
    };
  };

  const items: ReviewItem[] = [...prices];
  const untypedPages = pages.filter((page) => page.measurements.some((m) => m.label !== HELD_LABEL));
  // Only the sheets with untyped walls need their stored groups, which are big.
  const proposals = untypedPages.length === 0
    ? []
    : await prisma.takeoffWallProposal.findMany({
        where: { pageId: { in: untypedPages.map((page) => page.id) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, pageId: true, thicknessInches: true, runs: true, createdAt: true, source: true, sourceLabel: true, namedCode: true, itemId: true },
      });
  // ── WHAT EACH GROUP IS SUGGESTED AS, AND AT WHAT HEIGHT ──
  // The company's types (with the height the legend read gave them), the job's
  // typed items (with the height set on this job), the set's legend codes, and
  // the rooms whose ceilings were read.
  const [libraryTypes, typedItems, legendCodes, rooms] = await Promise.all([
    prisma.wallType.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, thicknessIn: true, defaultHeightFt: true, notes: true, _count: { select: { components: true } } } }),
    prisma.takeoffItem.findMany({ where: { jobId, companyId, wallTypeId: { not: null }, heightFt: { not: null } }, orderBy: { createdAt: "asc" }, select: { wallTypeId: true, heightFt: true } }),
    storedLegendCodes(plan.id),
    prisma.takeoffMeasurement.findMany({
      where: { kind: "AREA", ceilingHeightFeet: { not: null }, page: { planId: plan.id } },
      select: { xs: true, ys: true, roomNumber: true, roomName: true, label: true, ceilingHeightFeet: true, ceilingFrom: true, page: { select: { pageNumber: true } } },
    }),
  ]);
  // ── THE TYPES A GROUP CAN BE GIVEN: the legend's, else the company's own ──
  // A set whose legend read named no types (Baker on a new company, the walk at
  // 66eeca59) left every untyped group with nothing to pick, and the queue
  // could not empty. The company's library — the starter types its trade gave
  // it and any it made — is the next answer, numbered the same way.
  const codes = legendCodes.length > 0 ? legendCodes : libraryTypes.map((type) => type.code);
  const wallTypes: MatchableWallType[] = libraryTypes.map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn) }));
  const heights: Record<string, CodeHeight> = {};
  // The set's sheet-wide rule, under a key no legend prints: a group whose type has no height takes it before the ceiling.
  const general = await storedGeneralHeight(plan.id);
  if (general !== null) heights[GENERAL_HEIGHT_KEY] = general;
  // Where the sections print one height per part of the building, each is a choice.
  const heightChoices: Record<string, CodeHeight[]> = {};
  for (const type of libraryTypes) {
    const options = legendOptions({ code: type.code, defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt), notes: type.notes });
    if (options.length > 1) heightChoices[type.code.toUpperCase()] = options.map((o) => ({ feet: o.feet, from: o.from }));
  }
  for (const type of libraryTypes) {
    const legend = legendOption({ code: type.code, defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt), notes: type.notes });
    const onJob = typedItems.find((item) => item.wallTypeId === type.id);
    const feet = onJob ? Number(onJob.heightFt) : null;
    if (feet !== null) heights[type.code.toUpperCase()] = { feet, from: legend !== null && Math.abs(legend.feet - feet) < 0.005 ? legend.from : `set on this job: ${feetLabel(feet)}` };
    else if (legend !== null) heights[type.code.toUpperCase()] = { feet: legend.feet, from: legend.from };
  }
  // ── EACH WALL'S LEVEL: its plan's caption, and the level markers the set prints ──
  const levelsRead = await storedLevels(plan.id);
  const roofRead = await storedRoofParts(plan.id);
  // The types whose height is the storey: those whose own words run them to the structure.
  const toStructure = (lines: readonly string[]) => lines.some((line) => heightBasis(line)?.kind === "to-structure");
  const legendReads = await prisma.planLegendProposal.findMany({ where: { planId: plan.id }, orderBy: { createdAt: "asc" }, select: { merged: true, crops: true, pageNumber: true } });
  const legendTypes = legendReads.flatMap((p) => storedLegendTypesFromJson(p.merged));
  // ── EACH CODE'S THICKNESS AND LEGEND PICTURE, for an untagged group's picker (`byThickness`) ──
  // The library's thickness where the type has one, else the legend's stud and boards; the crop
  // from the newest legend read that placed one. Later reads overwrite earlier ones.
  const codeInfo: Record<string, { thicknessIn: number | null; crop: StoredCrop | null; legendPage: number | null }> = {};
  for (const read of legendReads) {
    const crops = (Array.isArray(read.crops) ? read.crops : []) as StoredCrop[];
    for (const t of storedLegendTypesFromJson(read.merged)) {
      const crop = crops.find((c) => typeof c?.code === "string" && c.code.toUpperCase() === t.code.toUpperCase()) ?? null;
      codeInfo[t.code.toUpperCase()] = { thicknessIn: nominalThicknessIn(t.assembly.read), crop, legendPage: crop === null ? null : read.pageNumber };
    }
  }
  for (const t of libraryTypes) {
    if (t.thicknessIn === null) continue;
    const key = t.code.toUpperCase();
    codeInfo[key] = { crop: codeInfo[key]?.crop ?? null, legendPage: codeInfo[key]?.legendPage ?? null, thicknessIn: Number(t.thicknessIn) };
  }
  const structureCodes = [
    ...new Set([
      ...libraryTypes.filter((t) => toStructure((t.notes ?? "").split("\n"))).map((t) => t.code.toUpperCase()),
      ...legendTypes.filter((t) => toStructure(t.lines)).map((t) => t.code.toUpperCase()),
    ]),
  ];
  const roomsOn = (pageNumber: number): CeilingRoom[] =>
    rooms
      .filter((r) => r.page.pageNumber === pageNumber)
      .map((r) => ({ xs: r.xs, ys: r.ys, heightFeet: r.ceilingHeightFeet, name: [r.roomNumber, r.roomName].filter(Boolean).join(" ") || (r.label ?? "room"), from: r.ceilingFrom }));
  // The words each sheet prints beside its marked tags ("C6*  TYP AT TUB/SHOWER LOCATIONS"), saved by the walls stage.
  const notesByPage = new Map<number, Record<string, string>>();
  for (const read of await prisma.takeoffPlanTextRead.findMany({ where: { planId: plan.id, kind: VARIANT_NOTES }, select: { pageNumber: true, value: true } })) {
    if (read.value !== null && typeof read.value === "object" && !Array.isArray(read.value)) notesByPage.set(read.pageNumber, Object.fromEntries(Object.entries(read.value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")));
  }
  // ── EACH PRINTED TAG'S TYPE AS THIS JOB ANSWERED IT (`answeredTagTypes`), read back from what was typed ──
  const [taggedRows, typedRuns] = await Promise.all([
    prisma.takeoffWallProposal.findMany({ where: { source: "TAG", namedCode: { not: null }, page: { planId: plan.id } }, select: { namedCode: true, runs: true } }),
    prisma.takeoffMeasurement.findMany({ where: { kind: "LINEAR", page: { planId: plan.id }, item: { wallTypeId: { not: null } } }, select: { xs: true, ys: true, item: { select: { wallType: { select: { code: true } } } } } }),
  ]);
  const tagAnswers = answeredTagTypes(
    taggedRows.map((row) => ({ tag: plainTag(row.namedCode!), runs: storedRunsOrNull(row.runs) ?? [] })),
    typedRuns.flatMap((m) => (m.item?.wallType ? [{ xs: m.xs, ys: m.ys, code: m.item.wallType.code }] : [])),
  );
  for (const page of pages) {
    const sheet = sheetOf(page.pageNumber, page.calibrations[0]);
    for (const m of page.measurements) {
      if (m.label !== HELD_LABEL) continue;
      const item = wallItem(sheet, m);
      if (item !== null) items.push(item);
    }
    const mine = proposals.filter((row) => row.pageId === page.id);
    // One detection run writes every row at one timestamp: the newest run.
    const newest = mine[0]?.createdAt.getTime();
    const rows = mine.filter((row) => row.createdAt.getTime() === newest);
    const named = groupsFromProposals(rows, wallTypes, sheet.feetPerUnit ?? 1);
    const groups = rows.map((row, at) => {
      const tag = row.source === "TAG" && row.namedCode ? plainTag(row.namedCode) : null;
      const drawn = named === null ? null : suggestType(named[at]!, sheet.sheet, legendCodes, notesByPage.get(page.pageNumber));
      const answered = drawn === null && tag !== null ? (tagAnswers.get(tag.toUpperCase()) ?? null) : null;
      return {
      id: row.id,
      inches: row.thicknessInches,
      runs: storedRunsOrNull(row.runs) ?? [],
      tag,
      suggested: answered === null ? drawn : { code: answered, from: `your answer for tag ${tag} on this job`, drawn: true as const, match: `tag:${tag!.toUpperCase()}`, source: "tag" as const },
      rooms: roomsOn(page.pageNumber),
      ...(row.source === "REMAINDER" ? { fill: fillOfRuns(storedRunsOrNull(row.runs) ?? []) } : {}),
      };
    });
    const typed = typeItems(sheet, page.measurements.filter((m) => m.label !== HELD_LABEL), groups);
    // ── ITS PLAN'S BUILDING PART: each type's height drawn for it, pre-filled ──
    const pageBuildings = levelsRead.buildings.get(page.pageNumber) ?? [];
    if (pageBuildings.length === 1) {
      const name = pageBuildings[0]!.toUpperCase();
      const byCode: Record<string, CodeHeight> = {};
      for (const type of libraryTypes) {
        const one = buildingHeights(type)[name];
        if (one !== undefined) byCode[type.code.toUpperCase()] = one;
      }
      if (Object.keys(byCode).length > 0) for (const item of typed) if (item.kind === "type") item.building = { name, heights: byCode };
    }
    const captions = levelsRead.captions.get(page.pageNumber);
    const fpu = sheet.feetPerUnit;
    const byLevel =
      captions === undefined || fpu === null
        ? typed
        : typed.flatMap((item) =>
            item.kind === "type"
              ? splitByLevel(item, (runs) => runLevels(runs, captions, fpu), (levels) => levelHeight(levelsRead.marks, levels), structureCodes, fpu)
              : [item],
          );
    // ── THE ROOF OVER EACH WALL: the roof plan's reading over this floor plan, by the saved rooms ──
    const roof = roofRead.get(page.pageNumber);
    // A room nobody named does not vote on the roof over its walls (`roomPitched`).
    const pageRooms = rooms.filter((r) => r.page.pageNumber === page.pageNumber).map((r) => ({ xs: r.xs, ys: r.ys, named: Boolean(r.roomNumber || r.roomName) }));
    if (roof === undefined || fpu === null || pageRooms.length === 0) items.push(...byLevel);
    else {
      const pitchedSet = new Set(roof.mask.pitched);
      const read = pageRooms.map((r) => ({ xs: r.xs, ys: r.ys, pitched: roomPitched(roof.mask, r, pitchedSet) }));
      const said = (kind: "pitched" | "flat"): CodeHeight => {
        const h = roof.heights[kind];
        return { feet: h.feet, from: `roof plan ${roof.mask.roofSheet}: ${kind === "pitched" ? "standing seams, a pitched roof" : "no seams, a flat roof"} → ${h.from} = ${feetLabel(h.feet)}` };
      };
      items.push(...byLevel.flatMap((item) => (item.kind === "type" ? splitByRoof(item, (runs) => runs.map((run) => runPitched(run, read, fpu)), { pitched: said("pitched"), flat: said("flat") }, structureCodes, fpu) : [item])));
    }
  }

  // ── WALL GROUPS WITH NO HEIGHT ──
  // A typed wall item, or "Walls — untyped", on this plan with no height of
  // its own: the figure the estimate prices square feet at. A run a type item
  // above already holds is asked once, there, with its type.
  // Only where the queue can type it: with no legend codes and no suggestion, the
  // group's row cannot be confirmed there, so its height is still asked on its own.
  const typing = new Set(items.flatMap((item) => (item.kind === "type" && (codes.length > 0 || item.suggested !== null) ? item.runs.map((r) => `${item.pageNumber}:${r.x1},${r.y1},${r.x2},${r.y2}`) : [])));
  const [heightless] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: { jobId, companyId, heightFt: null, OR: [{ wallTypeId: { not: null } }, { name: UNTYPED_ITEM }], measurements: { some: { kind: "LINEAR", page: { planId: plan.id } } } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        wallType: { select: { code: true, defaultHeightFt: true, notes: true } },
        measurements: { where: { kind: "LINEAR", page: { planId: plan.id } }, select: { xs: true, ys: true, label: true, page: { select: { pageNumber: true } } } },
      },
    }),
  ]);
  for (const item of heightless) {
    const sheets = pages.map((page) => ({
      sheet: sheetOf(page.pageNumber, page.calibrations[0]),
      runs: item.measurements
        .filter((m) => m.page.pageNumber === page.pageNumber && m.xs.length === 2 && m.label !== HELD_LABEL)
        .map((m) => ({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! }))
        .filter((r) => !typing.has(`${page.pageNumber}:${r.x1},${r.y1},${r.x2},${r.y2}`)),
      rooms: roomsOn(page.pageNumber),
    }));
    const type = item.wallType;
    const own = legendOptions(type === null ? null : { code: type.code, defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt), notes: type.notes });
    // The type's own, then the sheet-wide note, then the ceiling (`heightOptionsInOrder`).
    const queued = heightItem(item, sheets, own, general);
    if (queued !== null) items.push(queued);
  }

  // ── WINDOWS COUNTED BY OPENING, TO CONFIRM ──
  for (const read of await prisma.takeoffPlanTextRead.findMany({ where: { planId: plan.id, kind: WINDOWS_SUGGESTED }, select: { pageNumber: true, value: true } })) {
    const stored = storedWindowsOf(read.value);
    const queued = stored === null ? null : windowsItem(sheetOf(read.pageNumber), stored);
    if (queued !== null) items.push(queued);
  }

  // ── FOUND DOORS WITH NO PRINTED MARK, TO CONFIRM ──
  for (const read of await prisma.takeoffPlanTextRead.findMany({ where: { planId: plan.id, kind: DOORS_SUGGESTED }, select: { pageNumber: true, value: true } })) {
    const stored = storedDoorsOf(read.value);
    const queued = stored === null ? null : doorsItem(sheetOf(read.pageNumber), stored);
    if (queued !== null) items.push(queued);
  }

  const scaled = new Set(pages.filter((page) => page.calibrations.length > 0).map((page) => page.pageNumber));
  // ── ONLY THE FLOOR PLANS THE TAKEOFF NEEDS, AND ONE QUESTION FOR ALL OF THEM ──
  // Every sheet a title called a plan was a scale item of its own: Green Bay's keyless
  // titles made 380 (the accept-job walks, 2026-11-10), and with nothing named none was, so
  // Topeka's stepper called Scale done with ten floor plans unscaled. The count is the
  // whole-set rule's own (`floorPlansOfTheWork`: one plan per floor, the inventory's read
  // where nothing names a sheet), for the stepper too, and the question is asked once.
  const floors = floorPlansOfTheWork(await wallsSheetsFor(plan.id, companyId));
  const unscaled = floors.filter((pageNumber) => !scaled.has(pageNumber));
  if (unscaled.length > 0) {
    items.push({ kind: "scale", key: "scale:set", pageNumber: unscaled[0]!, sheet: sheetOf(unscaled[0]!).sheet, pages: unscaled.map((pageNumber) => ({ pageNumber, sheet: sheetOf(pageNumber).sheet })) });
  }

  // ── A RENOVATION SHEET: SET ASIDE THE EXISTING WALLS IN ONE STEP (`setAsideLike.ts`) ──
  // Its walls are in the queue and nothing is set aside on it yet; a sheet a demolition plan
  // handles (plan comparison on, paired) is left to the comparison.
  const withWalls = pages.filter((page) => page.measurements.length > 0);
  if (withWalls.length > 0) {
    const [marks, aside, company] = await Promise.all([
      prisma.planSheetText.findMany({ where: { planId: plan.id, pageNumber: { in: withWalls.map((p) => p.pageNumber) } }, select: { pageNumber: true, renovationMarks: true } }),
      prisma.takeoffSheetExclusion.findMany({ where: { pageId: { in: withWalls.map((p) => p.id) }, kind: { in: ["EXCLUDE_LIKE", "WORK_AREA"] } }, select: { pageId: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { planCompareOn: true } }),
    ]);
    const renovation = new Set(marks.filter((m) => showsExistingWork(m.renovationMarks)).map((m) => m.pageNumber));
    const hasAside = new Set(aside.map((a) => a.pageId));
    const paired = renovation.size > 0 && company?.planCompareOn === true ? (await pairingsForPlan(plan.id)).byPage : new Map<number, unknown>();
    for (const page of withWalls) {
      if (!renovation.has(page.pageNumber) || hasAside.has(page.id) || paired.has(page.pageNumber)) continue;
      const sheet = sheetOf(page.pageNumber, page.calibrations[0]);
      const units = page.measurements.reduce((n, m) => n + (m.xs.length === 2 ? Math.hypot(m.xs[1]! - m.xs[0]!, m.ys[1]! - m.ys[0]!) : 0), 0);
      items.push({ kind: "existing", key: `existing:${page.pageNumber}`, pageNumber: page.pageNumber, sheet: sheet.sheet, walls: page.measurements.length, feet: sheet.feetPerUnit === null ? null : units * sheet.feetPerUnit });
    }
  }

  // ── WHAT POSTED ITSELF: the proven sources' runs (`autoPost.ts`), per sheet, for the queue's header and Undo ──
  // Typed auto-posts and the walls the run model posted itself (`HIGH_CONFIDENCE_WALLS`) — the two Undo per sheet takes back.
  const autoRuns = await prisma.takeoffMeasurement.findMany({ where: { kind: "LINEAR", source: "DETECTED", OR: [{ label: { contains: AUTO_MARK } }, { label: HIGH_CONFIDENCE_WALLS }], page: { planId: plan.id } }, select: { xs: true, ys: true, page: { select: { pageNumber: true } } } });
  // The marked doors that posted themselves (`autoDoors.ts`): one count per sheet, its points the doors.
  const autoDoorCounts = await prisma.takeoffMeasurement.findMany({ where: { kind: "COUNT", label: AUTO_DOORS_LABEL, page: { planId: plan.id } }, select: { xs: true, page: { select: { pageNumber: true } } } });
  const doorsByPage = new Map<number, number>();
  for (const c of autoDoorCounts) doorsByPage.set(c.page.pageNumber, (doorsByPage.get(c.page.pageNumber) ?? 0) + c.xs.length);
  const autoByPage = new Map<number, number>();
  for (const run of autoRuns) {
    const page = pages.find((p) => p.pageNumber === run.page.pageNumber);
    const fpu = sheetOf(run.page.pageNumber, page?.calibrations[0]).feetPerUnit;
    if (fpu === null || run.xs.length !== 2) continue;
    autoByPage.set(run.page.pageNumber, (autoByPage.get(run.page.pageNumber) ?? 0) + Math.hypot(run.xs[1]! - run.xs[0]!, run.ys[1]! - run.ys[0]!) * fpu);
  }
  return {
    planId: plan.id,
    autoPosted: [...new Set([...autoByPage.keys(), ...doorsByPage.keys()])].map((pageNumber) => ({ pageNumber, sheet: sheetOf(pageNumber).sheet, feet: autoByPage.get(pageNumber) ?? 0, doors: doorsByPage.get(pageNumber) ?? 0 })),
    codeInfo,
    items: reviewQueue(items),
    heights,
    heightChoices,
    codes,
    // Whether the set's legend was read: with none, every type's height from the drawings is missing.
    legend: (await prisma.planLegendProposal.count({ where: { planId: plan.id } })) > 0 ? "read" : (await aiGate(companyId, "PLAN_TEXT_READ")).ok ? "unread" : "off",
    scaledSheets: scaled.size,
    floorPlans: floors.length,
    floorPlansScaled: floors.filter((page) => scaled.has(page)).length,
  };
}
