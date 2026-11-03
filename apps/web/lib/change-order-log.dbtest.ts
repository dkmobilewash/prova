import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@prova/db";

/** The real route over change orders whose values are set here, so the figures
 * are known before the code runs. */
const context = { company: { id: "" } as Record<string, unknown>, companyId: "", id: "u", role: "OWNER", jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireApiContext: async () => context }));
vi.mock("@/lib/viewerToday", async (original) => ({ ...(await original<typeof import("@/lib/viewerToday")>()), viewerToday: async () => "2026-11-03" }));
const { GET } = await import("@/app/api/jobs/[id]/change-order-log/route");

let companyId = "", jobId = "", otherCompanyId = "";
const open = (format: string, id = jobId) => GET(new Request(`http://x.test/?format=${format}`) as never, { params: Promise.resolve({ id }) });
const day = (value: string) => new Date(`${value}T00:00:00Z`);

describe("downloading the change order log", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "CO Log Co" } });
    companyId = company.id;
    context.company = company;
    context.companyId = companyId;
    otherCompanyId = (await prisma.company.create({ data: { name: "Someone else" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Tower", status: "CONTRACTED" } })).id;
    const add = (quantity: string, unitPrice: string) => ({ changeType: "ADD" as const, description: "Extra", quantity, unitPrice });
    await prisma.changeOrder.create({ data: { jobId, number: 1, title: "Soffit", status: "APPROVED", submittedOn: day("2026-09-01"), decidedOn: day("2026-09-10"), proposals: { create: [add("1", "5000")] } } });
    await prisma.changeOrder.create({ data: { jobId, number: 2, title: "=1+1", status: "SUBMITTED", submittedOn: day("2026-08-01"), proposals: { create: [add("2", "350")] } } });
    await prisma.changeOrder.create({ data: { jobId, number: 3, title: "Draft", status: "DRAFT", proposals: { create: [add("1", "9999")] } } });
  });

  afterAll(async () => {
    await prisma.changeOrderProposal.deleteMany({ where: { changeOrder: { jobId } } });
    await prisma.changeOrder.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await prisma.$disconnect();
  });

  it("lists the sent ones with their values, ages and totals, and no draft", async () => {
    const response = await open("csv");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("1,Soffit,Executed,2026-09-01,2026-09-10,,5000,");
    expect(text).toContain("2,'=1+1,Pending GC,2026-08-01,,94,700,");
    expect(text).not.toContain("9999");
    expect(text).toContain("Over 60 days,1,700");
  });

  it("gives the same figures in Excel", async () => {
    const response = await open("xlsx");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" }).Sheets["Change orders"], { header: 1 });
    expect(rows.find((row) => row[0] === "Executed")).toEqual(["Executed", 1, 5000]);
  });

  it("reads as missing for another company, and for no job cost access", async () => {
    expect((await open("csv", "nope")).status).toBe(404);
    const saved = context.company;
    context.company = { ...saved, id: otherCompanyId };
    expect((await open("csv")).status).toBe(404);
    context.company = saved;
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect((await open("csv")).status).toBe(404);
    context.role = "OWNER";
    context.jobFunction = null;
  });
});
