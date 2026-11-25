import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ── THE TAKEOFF→ESTIMATE LINE SYNC AT PRODUCTION'S LATENCY (the jobLineItem P2028 cluster, prod since 2026-08-31) ──
 *
 * Production has thrown P2028 "Transaction not found" in `jobLineItem.findMany` inside an interactive transaction on
 * /jobs/[id]/takeoff and /takeoff/[id] since 2026-08-31. Every caller (coordination/sync-p2028-callers.md: 22 call
 * sites, 14 actions on Prisma's 5 s default) ends in `syncTakeoffItemLines`. This runs it on the real scratch
 * Postgres with every query delayed LATENCY_MS, the `wallItemsLatency.dbtest.ts` way, on a job shaped like a real
 * estimate, and reports how its round trips grow with the job: first sync (lines made), second (lines kept).
 */
const LATENCY_MS = 60;
const counter = { queries: 0, by: new Map<string, number>() };

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const slow = real.prisma.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        counter.queries += 1;
        const key = `${model ?? "raw"}.${operation}`;
        counter.by.set(key, (counter.by.get(key) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
        return query(args);
      },
    },
  });
  return { ...real, prisma: slow };
});

const { prisma } = await import("@prova/db");
const { syncTakeoffItemLines } = await import("./takeoff-item-lines");

const TYPES = 20;
const PARTS = 4;
const RUNS = 5;

let companyId = "";
let jobId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Sync Latency Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Sync Latency Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:sync.pdf", fileName: "sync.pdf" } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  for (let t = 0; t < TYPES; t++) {
    const type = await prisma.wallType.create({
      data: {
        companyId, code: `T${t}`, name: `Type ${t}`, thicknessIn: 4 + t * 0.25, defaultHeightFt: 10, sides: 2,
        components: { create: Array.from({ length: PARTS }, (_, p) => ({ description: `part ${p} of T${t}`, basis: "LINEAR_FT" as const, factor: 1 + p })) },
      },
    });
    const item = await prisma.takeoffItem.create({ data: { companyId, jobId, name: `T${t} walls`, type: "LINEAR", colorHex: "#336699", sortOrder: t, wallTypeId: type.id, heightFt: 10, sides: 2 } });
    await prisma.takeoffMeasurement.createMany({
      data: Array.from({ length: RUNS }, (_, r) => ({ pageId: page.id, calibrationId: cal.id, kind: "LINEAR" as const, xs: [0.1, 0.3], ys: [0.1 + t * 0.03 + r * 0.004, 0.1 + t * 0.03 + r * 0.004], label: `T${t} wall`, source: "DETECTED" as const, itemId: item.id })),
    });
  }
}, 300_000);

async function timedSync(label: string) {
  counter.queries = 0;
  counter.by.clear();
  const started = Date.now();
  let error: string | null = null;
  try {
    await prisma.$transaction((tx) => syncTakeoffItemLines(tx, companyId, jobId));
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n").find((l) => /Transaction|timeout/i.test(l)) ?? e.message.slice(0, 160) : String(e);
  }
  const ms = Date.now() - started;
  const lines = await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } });
  console.info(`[sync-latency] ${label} by op: ${[...counter.by.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.info(`[sync-latency] ${label}: ${TYPES} types x ${PARTS} parts, ${lines} lines, ${counter.queries} queries, ${ms} ms, ${error ?? "ok"}`);
  return { ms, queries: counter.queries, lines, error };
}

describe("the takeoff→estimate line sync, at production latency, on a real-sized estimate", () => {
  it("makes every line inside the 5 s interactive default, in a number of queries that does not grow with the lines", async () => {
    const first = await timedSync("first sync (lines made)");
    expect(first.error).toBeNull();
    expect(first.lines).toBeGreaterThanOrEqual(TYPES * PARTS); // the control: the fixture really produces the lines
    const second = await timedSync("second sync (lines kept)");
    expect(second.error).toBeNull();
    // ponytail: the bound is set from the measurement on main, recorded in the log, never moved after a reading.
    expect(first.queries).toBeLessThanOrEqual(40);
    expect(second.queries).toBeLessThanOrEqual(40);
  }, 300_000);
});
