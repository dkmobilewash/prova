import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * ── EVERYTHING THE TAKEOFF PAGE HANDS A CLIENT COMPONENT MUST BE PLAIN ──
 *
 * `app/takeoff/[id]/page.tsx` is a server component and `<TakeoffWorkspace>` is
 * a client one, so the whole payload crosses the RSC boundary and React
 * serialises it. A Prisma `Decimal` is a class instance, not a plain object,
 * and React refuses it at RUNTIME with *"Only plain objects can be passed to
 * Client Components from Server Components. Decimal objects are not
 * supported."* — the page 500s and nothing before that says why.
 *
 * ── WHY A TEST RATHER THAN CARE ──
 *
 * `workspaceLoad.ts` already calls `.toNumber()` on `declaredDistanceFeet` in
 * five places. It was still wrong, because the sixth path handed the row
 * through untouched, and `TakeoffItem` carries five more Decimals that nothing
 * converted. Typecheck is green either way — `Decimal` is a perfectly good
 * type to return — so the only thing that can see this is a check that walks
 * the actual payload and asks what each leaf IS.
 *
 * It walks rather than naming fields on purpose: a Decimal added to any model
 * this loader touches is caught without anyone remembering to update a list.
 * The same walk rejects `Date`, which React does serialise but which arrives
 * on the client as a string while the types still claim `Date` — a quieter
 * bug than the crash and a worse one.
 *
 * Runs against a SCRATCH database only; `vitest.db.setup.mts` refuses anything
 * that is not localhost.
 */
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadTakeoffWorkspace, workspaceForClient } = await import("./workspaceLoad");

let companyId = "";
let jobId = "";

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `payload-plain-${Date.now()}` },
  });
  companyId = company.id;
  const contact = await prisma.contact.create({
    data: { companyId, name: "Payload plain GC" },
  });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Payload plain" },
  });
  jobId = job.id;

  const plan = await prisma.takeoffPlan.create({
    data: {
      companyId,
      jobId,
      fileUrl: "local:payload-plain.pdf",
      fileName: "payload-plain.pdf",
      // Set, because a null date exercises neither branch of the conversion —
      // the Date mutation survived until this line existed.
      sheetIssuedOn: new Date("2026-03-28T00:00:00.000Z"),
    },
  });
  const page = await prisma.takeoffPlanPage.create({
    data: { planId: plan.id, pageNumber: 1, label: "A-101", pageWidthPt: 200 },
  });
  // A calibration, because that is the row that crashed the page, with a
  // declared distance that is NOT a whole number so a lost `.toNumber()`
  // cannot hide behind an integer.
  await prisma.takeoffScaleCalibration.create({
    data: {
      pageId: page.id,
      x1: 0.2,
      y1: 0.5,
      x2: 0.7,
      y2: 0.5,
      declaredDistanceFeet: "16.3750",
    },
  });
  // And an item, because `TakeoffItem` carries five Decimals of its own and
  // they reach the same payload by a different route.
  await prisma.takeoffItem.create({
    data: {
      companyId,
      jobId,
      name: "Payload plain partition",
      type: "LINEAR",
      colorHex: "#facc15",
      heightFt: "9.25",
      thicknessIn: "4.88",
      wastePercent: "7.50",
      spacingIn: "16.00",
      depthIn: "3.63",
    },
  });
});

afterAll(async () => {
  if (companyId === "") return;
  await prisma.takeoffScaleCalibration.deleteMany({
    where: { page: { plan: { companyId } } },
  });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { companyId } } });
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.takeoffItem.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

/** Every leaf React would refuse or quietly change, with the path to it. */
function notPlain(value: unknown, path = "data", seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (value instanceof Date) return [`${path}: Date`];
  // ── toNumber(), NOT THE CLASS NAME ──
  //
  // The constructor name is `Decimal` in development and `i` in a minified
  // build, so a check on the name passes in one and not the other — which is
  // the worst possible behaviour for a guard. Every Decimal has `toNumber`
  // and nothing else in this payload does.
  if (typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return [`${path}: Decimal`];
  }

  if (Array.isArray(value)) {
    // The first few of a long array: a payload with 3,000 walls would
    // otherwise print 3,000 identical lines and hide the other offenders.
    return value.slice(0, 50).flatMap((one, at) => notPlain(one, `${path}[${at}]`, seen));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, one]) =>
    notPlain(one, `${path}.${key}`, seen),
  );
}

describe("the takeoff workspace payload", () => {
  it("CARRIES NO DECIMAL AND NO DATE ACROSS THE RSC BOUNDARY", async () => {
    const loaded = await loadTakeoffWorkspace({ id: companyId } as never, { id: jobId } as never);
    expect(loaded, "the loader returned nothing, so this proves nothing").not.toBeNull();
    // What the PAGE passes, not what the loader returns: the tab is a server
    // component and legitimately keeps the raw rows.
    const data = workspaceForClient(loaded!);

    const offenders = notPlain(data);
    expect(
      offenders,
      `these reach <TakeoffWorkspace> and React refuses or rewrites them:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("proves the walk can SEE a Decimal, so the pass above means something", async () => {
    // Without this, a walk that silently returned [] would pass for ever.
    const raw = await prisma.takeoffScaleCalibration.findFirst({
      where: { page: { plan: { companyId } } },
    });
    expect(raw, "no calibration was seeded").not.toBeNull();
    expect(notPlain(raw)).toContain("data.declaredDistanceFeet: Decimal");
    expect(notPlain(raw)).toContain("data.createdAt: Date");
  });

  it("keeps the declared distance as a usable number", async () => {
    // The point of the conversion is that the value still means what it said.
    const loaded = await loadTakeoffWorkspace({ id: companyId } as never, { id: jobId } as never);
    const json = JSON.stringify(workspaceForClient(loaded!));
    expect(json).toContain("16.375");
    // And the date is a string the client can hand to `new Date(...)`.
    expect(json).toContain("2026-03-28T00:00:00.000Z");
  });
});
