import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ── A 144-RUN SHEET POSTS AT PRODUCTION'S LATENCY (2026-11-24, the P2028 outage) ──
 *
 * Production's whole-set walls run posted NOTHING on Milk Prep A2.21 (144 runs, 59 held) while the panel said "done":
 * `wallItemsForSheet` awaited one item lookup PER HELD RUN and per group inside one interactive transaction, so its round
 * trips grew with the sheet. At Neon's latency that outlived Prisma's 5 s interactive-transaction default, which threw
 * P2028 "Transaction not found", and the whole post rolled back. A laptop's Postgres answers in about a millisecond, so
 * every other test here stayed green.
 *
 * This runs the real function on the real scratch Postgres, with every query delayed LATENCY_MS (a Neon round trip, plus
 * margin) by wrapping the shared client. Same sheet shape: 144 runs in 28 groups, 59 held.
 */
const LATENCY_MS = 60;
const counter = { queries: 0 };

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const slow = real.prisma.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        counter.queries += 1;
        await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
        return query(args);
      },
    },
  });
  return { ...real, prisma: slow };
});

const { prisma } = await import("@prova/db");
const { wallItemsForSheet } = await import("./wallItems");
const { HELD_ITEM } = await import("@/lib/takeoff/estimateHold");

const GROUPS = 28;
const RUNS = 144;
const HELD = 59;

let companyId = "";
let jobId = "";
let planId = "";
let pageId = "";
let held: { x1: number; y1: number; x2: number; y2: number }[] = [];

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Latency Walls Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Latency Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:latency.pdf", fileName: "latency.pdf" } });
  planId = plan.id;
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  pageId = page.id;
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "336" } });
  // 144 distinct runs over 28 groups of distinct thicknesses, one write as the stage does it (one shared timestamp).
  const runs = Array.from({ length: RUNS }, (_, i) => ({ x1: 0.1, y1: 0.1 + i * 0.005, x2: 0.3, y2: 0.1 + i * 0.005, thicknessFeet: 0.4 }));
  held = runs.filter((_, i) => i % 2 === 0).slice(0, HELD).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
  const data = Array.from({ length: GROUPS }, (_, g) => {
    const mine = runs.filter((_, i) => i % GROUPS === g);
    const thicknessInches = 3 + g * 0.25;
    return { pageId, calibrationId: cal.id, thicknessInches, source: "REMAINDER" as const, runs: mine.map((r) => ({ ...r, thicknessFeet: thicknessInches / 12 })) };
  });
  await prisma.takeoffWallProposal.createMany({ data });
}, 120_000);

describe("the whole-set run's walls onto the job, at production latency", () => {
  it("posts every run of a 144-run sheet, held runs on their own item, in a bounded number of queries", async () => {
    expect(held).toHaveLength(HELD); // the control: the fixture really holds 59 runs
    counter.queries = 0;
    const started = Date.now();
    const outcome = await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null, held });
    const ms = Date.now() - started;
    const queries = counter.queries;
    console.info(`[latency] ${RUNS} runs, ${HELD} held, ${LATENCY_MS} ms per query: ${queries} queries, ${ms} ms`);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("written");
    // Every run is a row; the held ones sit on "Walls — to confirm".
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, source: "DETECTED" } })).toBe(RUNS);
    const heldItem = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: HELD_ITEM } });
    expect(await prisma.takeoffMeasurement.count({ where: { pageId, itemId: heldItem.id } })).toBe(HELD);
    // The round trips must not grow with the runs: 144 runs and 28 groups share 2 items here.
    expect(queries).toBeLessThanOrEqual(20);
  }, 120_000);
});
