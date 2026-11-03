import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@prova/db";
import { removeBillingClickFixture, seedBillingClickFixture } from "@/scripts/billingClickFixture";

/** The real route over the click fixture, whose figures are worked out on the
 * click list: the file agrees with the certificate, and access holds. */
const context = { company: {} as Record<string, unknown>, companyId: "", id: "u", role: "OWNER", jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireApiContext: async () => context }));
vi.mock("@/lib/viewerToday", async (original) => ({
  ...(await original<typeof import("@/lib/viewerToday")>()),
  viewerTimeZone: async () => "UTC",
}));
const { GET } = await import("@/app/api/pay-applications/[jobId]/[invoiceId]/g703/route");

let companyId = "", jobId = "", invoiceId = "";
const open = (format: string, job = jobId, invoice = invoiceId) =>
  GET(new Request(`http://x.test/?format=${format}`) as never, { params: Promise.resolve({ jobId: job, invoiceId: invoice }) });

describe("downloading the G703", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "G703 Co" } });
    companyId = company.id;
    context.company = company;
    context.companyId = company.id;
    await prisma.contact.create({ data: { companyId, name: "A real GC" } });
    const seeded = await seedBillingClickFixture(prisma, companyId);
    jobId = seeded.jobId;
    invoiceId = seeded.invoiceIds[1];
  });

  afterAll(async () => {
    await removeBillingClickFixture(prisma, companyId);
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("gives a CSV matching the certificate's own figures", async () => {
    const response = await open("csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).toContain("Grand totals,105000,23000,23000,1000,47000,44.8,58000,");
    expect(text).toContain("Period to,\"Oct 31, 2026\"");
  });

  it("gives an Excel file with the same grand totals", async () => {
    const response = await open("xlsx");
    expect(response.headers.get("content-disposition")).toContain(".xlsx");
    const sheet = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type: "array" }).Sheets.G703;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    const totals = rows.find((row) => row[1] === "Grand totals");
    expect(totals?.slice(2, 7)).toEqual([105000, 23000, 23000, 1000, 47000]);
  });

  it("reads as missing for another company, and for no billing access", async () => {
    expect((await open("csv", "nope")).status).toBe(404);
    const saved = context.company;
    context.company = { ...saved, id: "another-company" };
    expect((await open("csv")).status).toBe(404);
    context.company = saved;
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect((await open("csv")).status).toBe(404);
    context.role = "OWNER";
    context.jobFunction = null;
  });
});
