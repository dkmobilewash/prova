import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ── EVERY CALLER OF THE LINE SYNC, AT PRODUCTION'S LATENCY (the jobLineItem P2028 cluster) ──
 *
 * `syncLinesLatency.dbtest.ts` measures the sync alone. This measures each action that opens an interactive
 * transaction around it (coordinate list: coordination/sync-p2028-callers.md), with that action's own work sized to
 * the production sheets that set the bar (Milk Prep A2.21: 144 runs, 28 groups, 85 untyped), on a job shaped like a
 * real estimate. Every query is delayed LATENCY_MS while an action runs; `$transaction` is wrapped so each interactive
 * transaction reports its own duration, query count and stated limit.
 *
 * The bar, pre-registered before any reading (log.md, 2026-11-24): the action returns ok and every transaction it
 * opens finishes with no error in at most HALF its own limit (Prisma's 5 s default -> 2,500 ms; 60 s -> 30,000 ms),
 * each round trip charged LATENCY_MS (so at most 41 queries in a 5 s transaction) rather than read off a clock that
 * also carries the machine's load.
 */
const LATENCY_MS = 60;
type TxRecord = { ms: number; queries: number; limit: number; error: string | null };
const rec = { slow: false, queries: 0, txs: [] as TxRecord[] };

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const slow = real.prisma.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        if (rec.slow) {
          rec.queries += 1;
          await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
        }
        return query(args);
      },
    },
  });
  const transaction = async (arg: unknown, options?: { timeout?: number }) => {
    if (typeof arg !== "function") return (slow.$transaction as (a: unknown, o?: unknown) => Promise<unknown>)(arg, options);
    const startQueries = rec.queries;
    const started = Date.now();
    const done = (error: string | null) =>
      rec.slow && rec.txs.push({ ms: Date.now() - started, queries: rec.queries - startQueries, limit: options?.timeout ?? 5_000, error });
    try {
      const out = await (slow.$transaction as (a: unknown, o?: unknown) => Promise<unknown>)(arg, options);
      done(null);
      return out;
    } catch (e) {
      done(e instanceof Error ? (e.message.split("\n").find((l) => /Transaction|timeout/i.test(l)) ?? e.message.slice(0, 160)) : String(e));
      throw e;
    }
  };
  const prisma = new Proxy(slow, { get: (target, key, receiver) => (key === "$transaction" ? transaction : Reflect.get(target, key, receiver)) });
  return { ...real, prisma };
});

const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/blob", async (actual) => ({ ...(await actual<typeof import("@/lib/blob")>()), deleteDocument: async () => {} }));

const { prisma } = await import("@prova/db");
const { syncTakeoffItemLines } = await import("./takeoff-item-lines");
const { sendTakeoffItemsToEstimate, setWallGroupHeight } = await import("@/lib/actions/takeoffItems");
const { addFinishLinesToEstimate, confirmHeldWall, reviewWall, saveTakeoffMeasurements } = await import("@/lib/actions/takeoff");
const { setWallGroupType, clearWallGroupType, confirmSheetSuggestions, undoSheetSuggestions, undoAutoPost } = await import("@/lib/actions/wallGroupType");
const { applyRevisedSheets } = await import("@/lib/actions/revisedSheets");
const { confirmWindows, undoConfirmWindows, confirmDoors, undoConfirmDoors } = await import("@/lib/actions/symbolCount");
const { saveDoorScope } = await import("@/lib/actions/company");
const { postAutoDoors } = await import("@/lib/plan-ingest/autoDoors");
const { assignWallHeights } = await import("@/lib/takeoff/wallHeightsAssign");
const { deleteTakeoffPlan, previewDeleteTakeoffPlan } = await import("@/lib/actions/takeoff");
const { HELD_ITEM, HELD_LABEL } = await import("@/lib/takeoff/estimateHold");
const { UNTYPED_ITEM } = await import("@/lib/takeoff/untypedItem");
const { AUTO_DOORS_ITEM, AUTO_DOORS_LABEL } = await import("@/lib/takeoff/autoPost");
const { WINDOWS_SUGGESTED } = await import("@/lib/takeoff/windowTags");
const { DOORS_SUGGESTED } = await import("@/lib/takeoff/doorSuggestions");

const TYPES = 20;
const PARTS = 4;
const RUNS = 5;
const SHEET_RUNS = 144; // Milk Prep A2.21
const GROUPS = 28;
const BIG_GROUP = 85; // its untyped runs

let companyId = "";
let jobId = "";
let planId = "";
const calOf = new Map<number, string>();
const pageOf = new Map<number, string>();
const typeIds: string[] = [];
const itemIds: string[] = [];
let untypedId = "";

type Run = { x1: number; y1: number; x2: number; y2: number };
/** `n` runs 5 ft long on a 12-wide grid 8 ft apart: never the same wall as each other. */
const grid = (n: number, y0 = 0.02): Run[] =>
  Array.from({ length: n }, (_, i) => {
    const x = 0.02 + (i % 12) * 0.08;
    const y = y0 + Math.floor(i / 12) * 0.08;
    return { x1: x, y1: y, x2: x + 0.05, y2: y };
  });

async function sheet(pageNumber: number, label: string | null = null, plan = planId) {
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan, pageNumber, label } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  if (plan === planId) {
    pageOf.set(pageNumber, page.id);
    calOf.set(pageNumber, cal.id);
  }
  return { pageId: page.id, calId: cal.id };
}

async function postRuns(pageNumber: number, runs: Run[], itemFor: (i: number) => string, label: (i: number) => string | null) {
  await prisma.takeoffMeasurement.createMany({
    data: runs.map((r, i) => ({ pageId: pageOf.get(pageNumber)!, calibrationId: calOf.get(pageNumber)!, kind: "LINEAR" as const, source: "DETECTED" as const, xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: itemFor(i), label: label(i) })),
  });
}

async function measure<T>(label: string, run: () => Promise<T>): Promise<{ result: T; txs: TxRecord[] }> {
  rec.txs = [];
  rec.queries = 0;
  rec.slow = true;
  const started = Date.now();
  let result: T;
  try {
    result = await run();
  } catch (e) {
    console.info(`[callers-latency] ${label}: THREW after ${Date.now() - started} ms / ${rec.queries} q; tx: ${JSON.stringify(rec.txs)}`);
    throw e;
  } finally {
    rec.slow = false;
  }
  const worst = rec.txs.reduce((w, t) => (t.ms / t.limit > w.ms / w.limit ? t : w), { ms: 0, queries: 0, limit: 1, error: null } as TxRecord);
  console.info(
    `[callers-latency] ${label}: ${rec.txs.length} tx, worst ${worst.ms} ms / ${worst.queries} q of ${worst.limit} ms limit, ` +
      `action ${Date.now() - started} ms / ${rec.queries} q, ${rec.txs.find((t) => t.error)?.error ?? "ok"}`,
  );
  return { result, txs: [...rec.txs] };
}

function holdsTheBar(out: { result: unknown; txs: TxRecord[] }, rollsBack?: string) {
  expect(out.txs.length, "the action opened no transaction: nothing was measured").toBeGreaterThan(0);
  for (const tx of out.txs) {
    // A preview rolls its own transaction back on purpose: that exact error, and no other, is its success.
    expect(tx.error).toBe(rollsBack ?? null);
    // The round trips are what Neon charges, so each is charged LATENCY_MS: the wall clock also carries this machine's
    // CPU load (a loaded laptop read 2,672 ms for 34 queries), which no production request pays for in round trips.
    expect(tx.queries * LATENCY_MS, `${tx.queries} queries, ${tx.ms} ms on the clock`).toBeLessThanOrEqual(tx.limit / 2);
  }
  const result = out.result as { ok?: boolean; error?: string } | number;
  if (typeof result === "object" && result !== null && "ok" in result) expect(result.ok, result.error).toBe(true);
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Sync Callers Co", autoPostOn: true } })).id;
  context.company.id = companyId;
  context.companyId = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `callers_${Date.now()}`, email: `callers_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Sync Callers Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:callers.pdf", fileName: "callers.pdf" } })).id;
  await sheet(1);
  for (let t = 0; t < TYPES; t++) {
    const type = await prisma.wallType.create({
      data: {
        companyId, code: `T${t}`, name: `Type ${t}`, thicknessIn: 4 + t * 0.25, defaultHeightFt: 10, sides: 2,
        components: { create: Array.from({ length: PARTS }, (_, p) => ({ description: `part ${p} of T${t}`, basis: "LINEAR_FT" as const, factor: 1 + p })) },
      },
    });
    typeIds.push(type.id);
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: `T${t} walls`, type: "LINEAR", colorHex: "#336699", sortOrder: t, wallTypeId: type.id, heightFt: 10, sides: 2 } });
    itemIds.push(item.id);
  }
  await postRuns(1, grid(TYPES * RUNS), (i) => itemIds[Math.floor(i / RUNS)]!, (i) => `T${Math.floor(i / RUNS)} wall`);
  untypedId = (await prisma.takeoffItem.create({ data: { companyId, jobId, name: UNTYPED_ITEM, type: "LINEAR", colorHex: "#999999" } })).id;
  const held = await prisma.takeoffItem.create({ data: { companyId, jobId, name: HELD_ITEM, type: "LINEAR", colorHex: "#999999" } });
  await postRuns(1, grid(2, 0.9), () => held.id, () => HELD_LABEL);
}, 300_000);

describe("every caller of the takeoff→estimate line sync, at production latency, on a real-sized estimate", () => {
  it("Send to estimate: the whole job's first sync", async () => {
    const out = await measure("sendTakeoffItemsToEstimate (first sync, 80 lines)", () => sendTakeoffItemsToEstimate(jobId));
    holdsTheBar(out);
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } })).toBeGreaterThanOrEqual(TYPES * PARTS);
  }, 120_000);

  it("Set height on one group", async () => {
    holdsTheBar(await measure("setWallGroupHeight (1 item)", () => setWallGroupHeight(jobId, itemIds[0]!, 12)));
  }, 120_000);

  it("Add finish lines to the estimate: 40 lines", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ label: `Finish ${i}`, quantity: 100 + i, unit: i % 2 === 0 ? "sq ft" : "lin ft" }));
    holdsTheBar(await measure("addFinishLinesToEstimate (40 lines)", () => addFinishLinesToEstimate(jobId, pageOf.get(1)!, "A101", lines)));
  }, 120_000);

  it("It is a wall, and Review walls drop and restore, on one held run", async () => {
    const held = await prisma.takeoffMeasurement.findMany({ where: { label: HELD_LABEL, page: { planId } }, select: { id: true } });
    holdsTheBar(await measure("confirmHeldWall", () => confirmHeldWall(jobId, held[0]!.id)));
    const dropped = await measure("reviewWall drop", () => reviewWall(jobId, held[1]!.id, "drop"));
    holdsTheBar(dropped);
    const was = dropped.result.ok ? dropped.result.value : { itemId: null, label: null };
    holdsTheBar(await measure("reviewWall restore", () => reviewWall(jobId, held[1]!.id, "restore", was)));
  }, 120_000);

  it("Plain walls added by hand: 10 shapes", async () => {
    const body = new FormData();
    body.set("pageId", pageOf.get(1)!);
    body.set("label", "wall");
    for (const r of grid(10, 0.66)) body.append("shape", JSON.stringify({ xs: [r.x1, r.x2], ys: [r.y1, r.y2] }));
    holdsTheBar(await measure("saveTakeoffMeasurements (plain walls, 10)", () => saveTakeoffMeasurements(jobId, body)));
  }, 120_000);

  it(`Set type on one group of ${BIG_GROUP} untyped runs, then Clear type`, async () => {
    await sheet(4);
    const runs = grid(BIG_GROUP);
    await postRuns(4, runs, () => untypedId, () => "wall, untyped");
    holdsTheBar(await measure(`setWallGroupType (${BIG_GROUP} runs)`, () => setWallGroupType(jobId, { planId, pageNumber: 4, code: "T0", inches: 4, runs })));
    holdsTheBar(await measure(`clearWallGroupType (${BIG_GROUP} runs)`, () => clearWallGroupType(jobId, { planId, pageNumber: 4, runs })));
  }, 300_000);

  it(`Accept all on a sheet of ${SHEET_RUNS} untyped runs in ${GROUPS} groups, then Undo`, async () => {
    await sheet(3);
    const runs = grid(SHEET_RUNS);
    await postRuns(3, runs, () => untypedId, () => "wall, untyped");
    const groups = Array.from({ length: GROUPS }, (_, g) => ({
      planId, pageNumber: 3, code: `T${g % TYPES}`, inches: 4 + (g % TYPES) * 0.25, heightFt: 10, level: null,
      runs: runs.filter((_, i) => i % GROUPS === g),
    }));
    const accepted = await measure(`confirmSheetSuggestions accept_all (${SHEET_RUNS} runs, ${GROUPS} groups)`, () => confirmSheetSuggestions(jobId, groups, "accept_all"));
    holdsTheBar(accepted);
    if (!accepted.result.ok) throw new Error(accepted.result.error);
    expect(accepted.result.value.accepted).toBe(GROUPS); // the control: every group really was typed
    holdsTheBar(await measure(`undoSheetSuggestions of that accept (${accepted.result.value.undo.moved.length} moved)`, () => undoSheetSuggestions(jobId, accepted.result.ok ? accepted.result.value.undo : (undefined as never))));
  }, 300_000);

  it(`Apply an addendum sheet of ${SHEET_RUNS} runs replacing ${SHEET_RUNS}, then Undo`, async () => {
    const old = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:bid.pdf", fileName: "bid.pdf", createdAt: new Date(Date.now() - 86_400_000) } });
    const oldSheet = await sheet(3, "A201", old.id);
    const runs = grid(SHEET_RUNS);
    await prisma.takeoffMeasurement.createMany({
      data: runs.map((r, i) => ({ pageId: oldSheet.pageId, calibrationId: oldSheet.calId, kind: "LINEAR" as const, source: "DETECTED" as const, xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: itemIds[i % TYPES]! })),
    });
    const addendum = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:add1.pdf", fileName: "add1.pdf", revisionLabel: "Addendum 1" } });
    const newSheet = await sheet(1, "A-201", addendum.id);
    await prisma.takeoffWallProposal.create({ data: { pageId: newSheet.pageId, calibrationId: newSheet.calId, thicknessInches: 6, source: "REMAINDER", runs: runs.map((r) => ({ ...r, thicknessFeet: 0.5 })) } });
    const applied = await measure(`applyRevisedSheets (${SHEET_RUNS} written, ${SHEET_RUNS} replaced)`, () => applyRevisedSheets(jobId));
    holdsTheBar(applied);
    if (!applied.result.ok) throw new Error(applied.result.error);
    expect(applied.result.value.written + applied.result.value.moved).toBe(SHEET_RUNS); // the control
    holdsTheBar(await measure(`undoSheetSuggestions of that addendum (${applied.result.value.undo.moved.length} moved)`, () => undoSheetSuggestions(jobId, applied.result.ok ? applied.result.value.undo : (undefined as never))));
  }, 300_000);

  it(`Undo an auto-post: ${SHEET_RUNS} auto-posted runs and a door count`, async () => {
    await sheet(5);
    await postRuns(5, grid(SHEET_RUNS), (i) => itemIds[i % TYPES]!, (i) => `T${i % TYPES} wall (auto, from printed tag)`);
    const doors = await prisma.takeoffItem.create({ data: { companyId, jobId, name: AUTO_DOORS_ITEM, type: "COUNT", colorHex: "#111111" } });
    const xs = Array.from({ length: 20 }, (_, i) => 0.05 + i * 0.04);
    await prisma.takeoffMeasurement.create({ data: { itemId: doors.id, pageId: pageOf.get(5)!, calibrationId: calOf.get(5)!, kind: "COUNT", xs, ys: xs.map(() => 0.95), label: AUTO_DOORS_LABEL } });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    holdsTheBar(await measure(`undoAutoPost (${SHEET_RUNS} runs + doors)`, () => undoAutoPost(jobId, planId, 5)));
  }, 300_000);

  it("Confirm 40 counted windows in 5 tags, then Undo", async () => {
    const windows = Array.from({ length: 40 }, (_, i) => ({ tag: `W${i % 5}`, x1: 0.02 + i * 0.024, y1: 0.2, x2: 0.03 + i * 0.024, y2: 0.2 }));
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 6, kind: WINDOWS_SUGGESTED, value: { windows } } });
    const done = await measure("confirmWindows (40)", () => confirmWindows(jobId, planId, 6, windows.map((_, i) => i)));
    holdsTheBar(done);
    if (!done.result.ok) throw new Error(done.result.error);
    holdsTheBar(await measure("undoConfirmWindows (40)", () => undoConfirmWindows(jobId, planId, 6, done.result.ok ? done.result.value.undo : (undefined as never))));
  }, 120_000);

  it("Confirm 40 found doors, then Undo", async () => {
    const doors = Array.from({ length: 40 }, (_, i) => ({ x1: 0.02 + i * 0.024, y1: 0.3, x2: 0.03 + i * 0.024, y2: 0.3 }));
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 7, kind: DOORS_SUGGESTED, value: { doors } } });
    const done = await measure("confirmDoors (40)", () => confirmDoors(jobId, planId, 7, doors.map((_, i) => i)));
    holdsTheBar(done);
    if (!done.result.ok) throw new Error(done.result.error);
    holdsTheBar(await measure("undoConfirmDoors (40)", () => undoConfirmDoors(jobId, planId, 7, done.result.ok ? done.result.value.undo : (undefined as never))));
  }, 120_000);

  it("Who installs the doors: the company's open estimates re-synced", async () => {
    const form = new FormData();
    form.set("doorScope", "DOORS_AND_FRAMES");
    holdsTheBar(await measure("saveDoorScope", () => saveDoorScope(form)));
  }, 120_000);

  it("Auto-posted doors: 40 on a sheet", async () => {
    await sheet(8);
    const points = Array.from({ length: 40 }, (_, i) => ({ x: 0.02 + i * 0.024, y: 0.5 }));
    const out = await measure("postAutoDoors (40)", () => postAutoDoors({ planId, pageNumber: 8, pageId: pageOf.get(8)!, calibrationId: calOf.get(8)!, companyId, jobId, userId: null, points }));
    holdsTheBar(out);
    expect(out.result).toBe(40); // the control: the doors really posted
  }, 120_000);

  it(`Every wall a height: the ${TYPES * RUNS}-run sheet`, async () => {
    holdsTheBar(await measure(`assignWallHeights (${TYPES * RUNS} runs)`, () => assignWallHeights({ planId, pageId: pageOf.get(1)!, pageNumber: 1, companyId, jobId, doc: null })));
  }, 300_000);

  it(`Delete a plan of ${SHEET_RUNS} runs on the typed items: the preview, then the delete (plan-delete-sync.md R9)`, async () => {
    const doomed = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:doomed.pdf", fileName: "doomed.pdf" } });
    const at = await sheet(9, "A-209", doomed.id);
    await prisma.takeoffMeasurement.createMany({
      data: grid(SHEET_RUNS).map((r, i) => ({ pageId: at.pageId, calibrationId: at.calId, kind: "LINEAR" as const, source: "DETECTED" as const, xs: [r.x1, r.x2], ys: [r.y1, r.y2], itemId: itemIds[i % TYPES]! })),
    });
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
    const shown = await measure(`previewDeleteTakeoffPlan (${SHEET_RUNS} runs, every typed item moves)`, () => previewDeleteTakeoffPlan(jobId, doomed.id));
    holdsTheBar(shown, "preview: rolled back");
    const done = await measure(`deleteTakeoffPlan (${SHEET_RUNS} runs)`, () => deleteTakeoffPlan(jobId, doomed.id));
    holdsTheBar(done);
    // The control: the delete really moved the estimate (every typed item had runs on that plan).
    expect(done.result.ok && done.result.value.linesChanged.length).toBeGreaterThanOrEqual(TYPES);
  }, 300_000);
});
