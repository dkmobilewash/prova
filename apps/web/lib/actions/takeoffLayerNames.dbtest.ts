import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { renameTakeoffLayer } = await import("./takeoffLayerNames");

const KEY = "wall:4.875:A1";
let companyId = "", otherCompanyId = "", jobId = "", otherJobId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Layer Names Co" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: "Someone Else Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `ln_${Date.now()}`, email: `ln_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Layer Names", status: "ESTIMATE" } })).id;
  const theirs = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "GC" } });
  otherJobId = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: theirs.id, name: "Not yours", status: "ESTIMATE" } })).id;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
});

const saved = () => prisma.takeoffLayerName.findMany({ where: { jobId }, select: { groupKey: true, name: true, updatedByUserId: true } });

describe("a takeoff layer named for the team", () => {
  it("is saved with the job, trimmed, and says who named it", async () => {
    expect(await renameTakeoffLayer(jobId, KEY, "  Corridor walls  ")).toEqual({ ok: true });
    expect(await saved()).toEqual([{ groupKey: KEY, name: "Corridor walls", updatedByUserId: context.id }]);
  });

  it("renaming again replaces the name rather than adding a second", async () => {
    await renameTakeoffLayer(jobId, KEY, "Demising");
    expect((await saved()).map((row) => row.name)).toEqual(["Demising"]);
  });

  it("an empty name clears it, so the layer goes back to its default", async () => {
    await renameTakeoffLayer(jobId, KEY, "   ");
    expect(await saved()).toEqual([]);
  });

  it("refuses a key the workspace could not have made, and a name too long, saying why", async () => {
    const badKey = await renameTakeoffLayer(jobId, "drop table", "x");
    expect(badKey.ok).toBe(false);
    const long = await renameTakeoffLayer(jobId, KEY, "x".repeat(81));
    expect(long.ok === false && long.error).toMatch(/under 80/);
    expect(await saved()).toEqual([]);
  });

  it("cannot name a layer on another company's job", async () => {
    const result = await renameTakeoffLayer(otherJobId, KEY, "Mine now");
    expect(result.ok).toBe(false);
    expect(await prisma.takeoffLayerName.count({ where: { jobId: otherJobId } })).toBe(0);
  });

  it("goes with the job: deleting the job deletes its names (CASCADE, no cleanup-list entry)", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const doomed = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Doomed", status: "ESTIMATE" } })).id;
    await renameTakeoffLayer(doomed, "rooms", "Units");
    expect(await prisma.takeoffLayerName.count({ where: { jobId: doomed } })).toBe(1);
    await prisma.job.delete({ where: { id: doomed } });
    expect(await prisma.takeoffLayerName.count({ where: { jobId: doomed } })).toBe(0);
  });
});
