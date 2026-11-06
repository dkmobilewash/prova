import { prisma } from "@prova/db";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { sameRunAs } from "@/lib/takeoff/runMatch";
import { earlierVersionsFor, sheetNumbersOf } from "@/lib/takeoff/sheetRevisions";
import { UNTYPED_ITEM } from "@/lib/plan-ingest/wallItems";
import { OFF_ESTIMATE_ITEMS } from "@/lib/takeoff/estimateHold";

/**
 * ── WHAT AN ADDENDUM'S SHEETS CHANGE, BY WALL TYPE ──
 *
 * Revised sheets are uploaded as a new plan file on the job; each is matched to
 * the sheet it replaces by sheet number (`earlierVersionsFor`). The earlier
 * sheet's walls are the confirmed takeoff; the revised sheet's are the walls the
 * finder stored when its scale was saved. Each revised run takes the type of the
 * earlier run on the same spot (`sameRunAs`), so a wall the addendum did not
 * touch carries its decision across; a run with no earlier twin is new, and an
 * earlier run with no revised twin is gone.
 *
 * ponytail: matched in place, with no alignment. A reissue normally keeps its
 * title block and grid; one shifted on the page matches few runs, and the
 * sheet's "matched in place" count says so. `compareSheets` finds the offset
 * from the line work if that ever proves common.
 *
 * $ moves with the type's own lines: an item's priced lines times the share of
 * its footage that changed. Exact for parts priced per foot or per square foot
 * at one height, which is every wall assembly here. Read-only.
 */

export type ChangeRow = {
  /** The item the walls are on, or null for new walls with no earlier twin. */
  itemId: string | null;
  code: string | null;
  name: string;
  oldFt: number;
  newFt: number;
  deltaFt: number;
  /** Null without a height (no area), or for new walls with no type yet. */
  deltaSqFt: number | null;
  /** Null when the type has no priced lines, or for new walls with no type yet. */
  deltaDollars: number | null;
};

export type ItemFacts = { id: string; code: string | null; name: string; heightFt: number | null; sides: number | null; jobFeet: number; jobDollars: number | null };
type Run = { x1: number; y1: number; x2: number; y2: number };

/** One sheet pair's walls, before and after, by the item they are on. */
export function changesByType(input: {
  olds: readonly { itemId: string; xs: readonly number[]; ys: readonly number[]; feet: number }[];
  news: readonly (Run & { feet: number })[];
  items: ReadonlyMap<string, ItemFacts>;
}): { rows: ChangeRow[]; matched: number; assigned: (string | null)[] } {
  const oldFt = new Map<string, number>();
  const newFt = new Map<string | null, number>();
  const add = <K,>(map: Map<K, number>, key: K, feet: number) => map.set(key, (map.get(key) ?? 0) + feet);
  for (const o of input.olds) add(oldFt, o.itemId, o.feet);
  let matched = 0;
  // Each revised run's item: its earlier twin's, or null (new, no type yet).
  const assigned: (string | null)[] = [];
  for (const run of input.news) {
    const twin = input.olds.find((o) => sameRunAs(run, o.xs, o.ys));
    if (twin !== undefined) matched += 1;
    assigned.push(twin?.itemId ?? null);
    add(newFt, twin?.itemId ?? null, run.feet);
  }
  const keys = new Set<string | null>([...oldFt.keys(), ...newFt.keys()]);
  const rows: ChangeRow[] = [];
  for (const key of keys) {
    const before = key === null ? 0 : (oldFt.get(key) ?? 0);
    const after = newFt.get(key) ?? 0;
    const item = key === null ? undefined : input.items.get(key);
    const deltaFt = after - before;
    const height = item?.heightFt ?? null;
    rows.push({
      itemId: key,
      code: item?.code ?? null,
      name: key === null ? "New walls, no type yet" : (item?.name ?? "Walls"),
      oldFt: before,
      newFt: after,
      deltaFt,
      deltaSqFt: item === undefined || height === null ? null : deltaFt * height * (item.sides === 1 ? 1 : 2),
      deltaDollars: item === undefined || item.jobDollars === null || !(item.jobFeet > 0) ? null : (item.jobDollars * deltaFt) / item.jobFeet,
    });
  }
  return { rows, matched, assigned };
}

/** Rows from several sheets, summed by item. */
export function sumRows(all: readonly ChangeRow[]): ChangeRow[] {
  const out = new Map<string | null, ChangeRow>();
  const plus = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  for (const r of all) {
    const was = out.get(r.itemId);
    out.set(r.itemId, was === undefined ? { ...r } : { ...was, oldFt: was.oldFt + r.oldFt, newFt: was.newFt + r.newFt, deltaFt: was.deltaFt + r.deltaFt, deltaSqFt: plus(was.deltaSqFt, r.deltaSqFt), deltaDollars: plus(was.deltaDollars, r.deltaDollars) });
  }
  return [...out.values()].sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : a.code.localeCompare(b.code, undefined, { numeric: true })));
}

export type AddendumSheet = {
  pageNumber: number;
  sheetNumber: string;
  /** The sheet it replaces: its plan file's label and page. */
  replaces: { label: string; pageNumber: number } | null;
  status: "compared" | "applied" | "no scale" | "walls not found yet" | "nothing measured on the earlier sheet" | "new sheet";
  runs: number;
  matched: number;
  /** What applying it does, for `applyRevisedSheets`; server-only, never rendered. */
  work?: { pageId: string; calibrationId: string; news: (Run & { itemId: string | null })[]; oldIds: string[] };
};

export type AddendumChanges = { planLabel: string; sheets: AddendumSheet[]; rows: ChangeRow[] } | null;

const feetOf = (calibration: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: unknown } | null) =>
  calibration === null ? null : feetPerPageWidth({ x1: calibration.x1, y1: calibration.y1, x2: calibration.x2, y2: calibration.y2, declaredDistanceFeet: Number(calibration.declaredDistanceFeet) });
const length = (xs: readonly number[], ys: readonly number[]) => Math.hypot(xs[1]! - xs[0]!, ys[1]! - ys[0]!);

/** The newest plan file on the job against the sheets it replaces. Null when it replaces none. */
export async function loadAddendumChanges(companyId: string, jobId: string): Promise<AddendumChanges> {
  const plan = await prisma.takeoffPlan.findFirst({ where: { jobId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true, revisionLabel: true, fileName: true } });
  if (plan === null) return null;
  const earlier = await earlierVersionsFor(jobId, companyId, plan.id);
  if (Object.keys(earlier).length === 0) return null;

  // The job's wall items, with their whole-job footage and priced lines, for $.
  const items = await prisma.takeoffItem.findMany({
    where: { jobId, companyId, type: "LINEAR" },
    select: {
      id: true,
      name: true,
      heightFt: true,
      sides: true,
      wallType: { select: { code: true } },
      measurements: { where: { kind: "LINEAR" }, select: { xs: true, ys: true, calibration: { select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } } } },
      lineItems: { where: { isDeleted: false }, select: { quantity: true, unitPrice: true } },
    },
  });
  const facts = new Map<string, ItemFacts>(
    items
      .filter((i) => !OFF_ESTIMATE_ITEMS.includes(i.name))
      .map((i) => {
        const jobFeet = i.measurements.reduce((n, m) => n + (m.xs.length === 2 ? length(m.xs, m.ys) * (feetOf(m.calibration) ?? 0) : 0), 0);
        const priced = i.lineItems.filter((l) => l.unitPrice !== null);
        const jobDollars = priced.length === 0 ? null : priced.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice), 0);
        return [i.id, { id: i.id, code: i.name === UNTYPED_ITEM ? null : (i.wallType?.code ?? null), name: i.name, heightFt: i.heightFt === null ? null : Number(i.heightFt), sides: i.sides, jobFeet, jobDollars }];
      }),
  );

  const numbers = await sheetNumbersOf(plan.id, companyId);
  const sheets: AddendumSheet[] = [];
  const rows: ChangeRow[] = [];
  for (const [pageNumber, sheetNumber] of [...numbers].sort((a, b) => a[0] - b[0])) {
    const was = earlier[pageNumber];
    if (was === undefined) {
      sheets.push({ pageNumber, sheetNumber, replaces: null, status: "new sheet", runs: 0, matched: 0 });
      continue;
    }
    const replaces = { label: was.label, pageNumber: was.pageNumber };
    const [oldPage, newPage] = await Promise.all([
      prisma.takeoffPlanPage.findUnique({
        where: { planId_pageNumber: { planId: was.planId, pageNumber: was.pageNumber } },
        select: {
          measurements: { where: { kind: "LINEAR", itemId: { in: [...facts.keys()] } }, select: { id: true, itemId: true, xs: true, ys: true, calibration: { select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } } } },
          // Walls `applyRevisedSheets` took off: the sheet was applied.
          _count: { select: { measurements: { where: { kind: "LINEAR", label: { startsWith: "replaced by " } } } } },
        },
      }),
      prisma.takeoffPlanPage.findUnique({
        where: { planId_pageNumber: { planId: plan.id, pageNumber } },
        select: { id: true, calibrations: { orderBy: { createdAt: "desc" }, take: 1 }, wallProposals: { orderBy: { createdAt: "desc" }, select: { calibrationId: true, createdAt: true, runs: true } } },
      }),
    ]);
    const olds = (oldPage?.measurements ?? []).filter((m) => m.xs.length === 2 && m.itemId !== null).map((m) => ({ id: m.id, itemId: m.itemId!, xs: m.xs, ys: m.ys, feet: length(m.xs, m.ys) * (feetOf(m.calibration) ?? 0) }));
    const calibration = newPage?.calibrations[0] ?? null;
    const perUnit = feetOf(calibration);
    if (calibration === null || perUnit === null) {
      sheets.push({ pageNumber, sheetNumber, replaces, status: "no scale", runs: 0, matched: 0 });
      continue;
    }
    const mine = (newPage?.wallProposals ?? []).filter((p) => p.calibrationId === calibration.id);
    if (mine.length === 0) {
      sheets.push({ pageNumber, sheetNumber, replaces, status: "walls not found yet", runs: 0, matched: 0 });
      continue;
    }
    if (olds.length === 0) {
      sheets.push({ pageNumber, sheetNumber, replaces, status: (oldPage?._count.measurements ?? 0) > 0 ? "applied" : "nothing measured on the earlier sheet", runs: 0, matched: 0 });
      continue;
    }
    const newest = mine[0]!.createdAt.getTime();
    const news = mine.filter((p) => p.createdAt.getTime() === newest).flatMap((p) => p.runs as Run[]).map((r) => ({ ...r, feet: Math.hypot(r.x2 - r.x1, r.y2 - r.y1) * perUnit }));
    const result = changesByType({ olds, news, items: facts });
    rows.push(...result.rows);
    sheets.push({
      pageNumber,
      sheetNumber,
      replaces,
      status: "compared",
      runs: news.length,
      matched: result.matched,
      work: { pageId: newPage!.id, calibrationId: calibration.id, news: news.map((r, i) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, itemId: result.assigned[i] ?? null })), oldIds: olds.map((o) => o.id) },
    });
  }
  return { planLabel: plan.revisionLabel ?? plan.fileName ?? "The newest drawings", sheets, rows: sumRows(rows).filter((r) => Math.abs(r.deltaFt) >= 0.5) };
}

/**
 * ── WHAT TO SEND THE GC ──
 *
 * The changes in words a GC reads: the sheets, each wall type's change in feet,
 * square feet and dollars, the net, and what is not priced yet. Plain text, so
 * it pastes into an email or an RFI response as it is.
 */
export function gcSummary(changes: NonNullable<AddendumChanges>, scope = "framing and drywall"): string {
  const n = (v: number) => Math.abs(Math.round(v)).toLocaleString("en-US");
  const sign = (v: number) => (Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "");
  const usd = (v: number) => `${sign(v)}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
  const compared = changes.sheets.filter((s) => s.status === "compared").map((s) => s.sheetNumber);
  const pending = changes.sheets.filter((s) => s.status !== "compared" && s.replaces !== null).map((s) => s.sheetNumber);
  const added = changes.sheets.filter((s) => s.replaces === null).map((s) => s.sheetNumber);
  const lines = [`${changes.planLabel}: changes to our ${scope} scope`, ""];
  lines.push(`Sheets compared: ${compared.length > 0 ? compared.join(", ") : "none yet"}.`);
  if (pending.length > 0) lines.push(`Revised, still to compare: ${pending.join(", ")}.`);
  if (added.length > 0) lines.push(`New sheets: ${added.join(", ")}.`);
  lines.push("");
  const moved = changes.rows.filter((r) => Math.round(r.deltaFt) !== 0);
  if (moved.length === 0) lines.push("No change to our walls on the sheets compared.");
  for (const r of moved) {
    const what = r.code ?? "New walls (type to confirm)";
    const area = r.deltaSqFt === null ? "" : ` (${sign(r.deltaSqFt)}${n(r.deltaSqFt)} SF)`;
    const price = r.deltaDollars === null ? ", to be priced" : `, ${usd(r.deltaDollars)}`;
    lines.push(`• ${what}: ${sign(r.deltaFt)}${n(r.deltaFt)} LF${area}${price}`);
  }
  const net = moved.reduce((v, r) => v + (r.deltaDollars ?? 0), 0);
  const open = moved.some((r) => r.deltaDollars === null);
  if (moved.length > 0) lines.push("", `Net change to our price: ${usd(net)}${open ? ", plus the walls still to be priced" : ""}.`);
  return lines.join("\n");
}
