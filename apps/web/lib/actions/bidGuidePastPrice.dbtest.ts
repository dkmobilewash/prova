import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "You priced W2 on Civic Center Annex in September — use that?" against a
 * real Postgres. Runs against a SCRATCH database only (vitest.db.setup.mts).
 *
 * The cast: ONE wall type, W2, with two components (board in SF, studs in LF).
 *   - "Civic Center Annex" priced both in September.
 *   - "Newer Bid" is an ESTIMATE whose two W2 lines are unpriced.
 *   - "Recap Bid" is the same shape with its bid recap APPLIED.
 *   - Another company has its own job and wall type of the same code.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));

const { usePastPrice } = await import("@/lib/actions/bidGuidePastPrice");
const { loadPastPriceSuggestions } = await import("@/lib/bid/guide/pastPrice");

let companyId = "";
let otherCompanyId = "";
let wallTypeId = "";
let boardComp = "";
let studComp = "";
let oldJob = "";
let newJob = "";
let recapJob = "";
let contractedJob = "";
let otherJob = "";
const line: Record<string, string> = {};
const num = (v: unknown) => (v == null ? null : Number(v));

async function mkLine(jobId: string, data: Record<string, unknown>) {
  return prisma.jobLineItem.create({ data: { jobId, quantity: "100", ...data } as never });
}

async function wallLines(jobId: string, prefix: string) {
  line[`${prefix}Board`] = (
    await mkLine(jobId, { description: "W2 — board", unit: "SF", wallTypeComponentId: boardComp })
  ).id;
  line[`${prefix}Stud`] = (
    await mkLine(jobId, { description: "W2 — studs", unit: "LF", wallTypeComponentId: studComp })
  ).id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Past Price Co" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: "Past Price Other Co" } })).id;
  context.company.id = companyId;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Other GC" } });

  const wt = await prisma.wallType.create({ data: { companyId, code: "W2", name: '6" 1-HR' } });
  wallTypeId = wt.id;
  boardComp = (
    await prisma.wallTypeComponent.create({
      data: { wallTypeId, description: "board", unit: "SF", basis: "BOARDED_SQFT", sortOrder: 0 },
    })
  ).id;
  studComp = (
    await prisma.wallTypeComponent.create({
      data: { wallTypeId, description: "studs", unit: "LF", basis: "LINEAR_FT", sortOrder: 1 },
    })
  ).id;

  oldJob = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Civic Center Annex", status: "COMPLETE" } })).id;
  newJob = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Newer Bid", status: "ESTIMATE" } })).id;
  recapJob = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Recap Bid", status: "ESTIMATE" } })).id;
  contractedJob = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Signed", status: "CONTRACTED" } })).id;
  otherJob = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Their Job", status: "ESTIMATE" } })).id;

  await wallLines(oldJob, "old");
  await prisma.jobLineItem.update({
    where: { id: line.oldBoard },
    data: { budgetedUnitCost: "1.75", currentEstimatedUnitCost: "1.75", unitPrice: "2.50" } as never,
  });
  await prisma.jobLineItem.update({
    where: { id: line.oldStud },
    data: { budgetedUnitCost: "0.60", currentEstimatedUnitCost: "0.60", unitPrice: "1.00" },
  });

  await wallLines(newJob, "new");
  await wallLines(recapJob, "recap");
  await wallLines(contractedJob, "signed");
  await prisma.jobBidRecap.create({ data: { jobId: recapJob, companyId, appliedAt: new Date(), appliedTotal: "300" } });
});

afterAll(async () => {
  const jobs = [oldJob, newJob, recapJob, contractedJob, otherJob];
  await prisma.jobBidRecap.deleteMany({ where: { jobId: { in: jobs } } });
  await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobs } } });
  await prisma.job.deleteMany({ where: { id: { in: jobs } } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallTypeId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
});

const get = (id: string) => prisma.jobLineItem.findUniqueOrThrow({ where: { id } });

describe("the suggestion", () => {
  it("appears for the newer job, naming the older one and both parts", async () => {
    const [s, ...rest] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ wallTypeCode: "W2", wallTypeId, fromJobId: oldJob, fromJobName: "Civic Center Annex" });
    expect(s.parts.map((p) => [p.lineId, p.unit, p.unitCost, p.unitPrice])).toEqual([
      [line.newBoard, "SF", 1.75, 2.5],
      [line.newStud, "LF", 0.6, 1],
    ]);
  });

  it("is empty for another company's eyes, and for a job nothing was priced for", async () => {
    expect(await loadPastPriceSuggestions(prisma, otherCompanyId, newJob)).toEqual([]);
    expect(await loadPastPriceSuggestions(prisma, companyId, oldJob)).toEqual([]);
  });

  it("ignores a soft-deleted past line, and a unit that differs", async () => {
    await prisma.jobLineItem.update({ where: { id: line.oldStud }, data: { isDeleted: true } });
    expect(await loadPastPriceSuggestions(prisma, companyId, newJob)).toEqual([]);
    await prisma.jobLineItem.update({ where: { id: line.oldStud }, data: { isDeleted: false, unit: "EA" } });
    expect(await loadPastPriceSuggestions(prisma, companyId, newJob)).toEqual([]);
    await prisma.jobLineItem.update({ where: { id: line.oldStud }, data: { unit: "LF" } });
    expect(await loadPastPriceSuggestions(prisma, companyId, newJob)).toHaveLength(1);
  });
});

describe("usePastPrice", () => {
  it("refuses a malformed arg, a stale token, and a person without estimating", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    expect(await usePastPrice(newJob, "nonsense")).toMatchObject({ ok: false });
    // right wall type, wrong fingerprint
    const tampered = s.actionArg.slice(0, -1) + (s.actionArg.endsWith("0") ? "1" : "0");
    const stale = await usePastPrice(newJob, tampered);
    expect(stale).toMatchObject({ ok: false });
    expect((stale as { error: string }).error).toMatch(/changed since you saw it/);
    // an OWNER holds everything whatever the function says, so a MEMBER here
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await usePastPrice(newJob, s.actionArg)).toMatchObject({ ok: false, error: expect.stringMatching(/Estimating/) });
    context.role = "OWNER";
    context.jobFunction = null;
    // none of that wrote anything
    expect(num((await get(line.newBoard)).budgetedUnitCost)).toBeNull();
  });

  it("refuses another company's job, and a contracted one", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    const theirs = await usePastPrice(otherJob, s.actionArg);
    expect(theirs).toMatchObject({ ok: false, error: expect.stringMatching(/isn't on your account/) });
    const signed = await usePastPrice(contractedJob, s.actionArg);
    expect(signed).toMatchObject({ ok: false, error: expect.stringMatching(/contracted/) });
    // and a stranger calling with OUR job id
    context.company.id = otherCompanyId;
    expect(await usePastPrice(newJob, s.actionArg)).toMatchObject({ ok: false });
    context.company.id = companyId;
    expect(num((await get(line.newBoard)).unitPrice)).toBeNull();
  });

  it("refuses when the past price moved after the card was shown", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    await prisma.jobLineItem.update({ where: { id: line.oldBoard }, data: { budgetedUnitCost: "1.80" } });
    const result = await usePastPrice(newJob, s.actionArg);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/changed since you saw it/) });
    expect(num((await get(line.newBoard)).budgetedUnitCost)).toBeNull();
    await prisma.jobLineItem.update({ where: { id: line.oldBoard }, data: { budgetedUnitCost: "1.75" } });
  });

  it("refuses when a line was priced by hand after the card was shown, and writes none of it", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    await prisma.jobLineItem.update({ where: { id: line.newStud }, data: { unitPrice: "9.99" } });
    const result = await usePastPrice(newJob, s.actionArg);
    expect(result).toMatchObject({ ok: false });
    expect(num((await get(line.newBoard)).budgetedUnitCost)).toBeNull();
    expect(num((await get(line.newStud)).unitPrice)).toBe(9.99);
    await prisma.jobLineItem.update({ where: { id: line.newStud }, data: { unitPrice: null } });
  });

  it("prices both lines: cost, forecast and price, and nothing else", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, newJob);
    const result = await usePastPrice(newJob, s.actionArg);
    expect(result).toEqual({ ok: true, value: { updated: 2, fromJobName: "Civic Center Annex", priceHeldForRecap: false } });
    const board = await get(line.newBoard);
    expect([num(board.budgetedUnitCost), num(board.currentEstimatedUnitCost), num(board.unitPrice), num(board.quantity)]).toEqual([1.75, 1.75, 2.5, 100]);
    const stud = await get(line.newStud);
    expect([num(stud.budgetedUnitCost), num(stud.unitPrice)]).toEqual([0.6, 1]);
    expect(revalidated).toContain(`/jobs/${newJob}/estimate`);
    // the past job was not touched, and the suggestion is gone now
    expect(num((await get(line.oldBoard)).unitPrice)).toBe(2.5);
    expect(await loadPastPriceSuggestions(prisma, companyId, newJob)).toEqual([]);
    // pressing it again is stale, not a second write
    expect(await usePastPrice(newJob, s.actionArg)).toMatchObject({ ok: false });
  });

  it("on a recap-applied job moves cost only", async () => {
    const [s] = await loadPastPriceSuggestions(prisma, companyId, recapJob);
    expect(s.priceHeldForRecap).toBe(true);
    const result = await usePastPrice(recapJob, s.actionArg);
    // "Newer Bid" was priced a moment ago from the older job, so it is now the
    // latest priced W2 — the newest source wins, and the figures are the same.
    expect(result).toEqual({ ok: true, value: { updated: 2, fromJobName: "Newer Bid", priceHeldForRecap: true } });
    const board = await get(line.recapBoard);
    expect([num(board.budgetedUnitCost), num(board.currentEstimatedUnitCost), num(board.unitPrice)]).toEqual([1.75, 1.75, null]);
  });
});
