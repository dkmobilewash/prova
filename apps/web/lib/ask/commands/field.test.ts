import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The field commands against a fake Prisma and faked actions. What is
 * pinned: the FormData each action receives, field by field, since that is
 * the whole contract between a command and a form-shaped action; that
 * "today" on the card is ctx.today and nothing the model supplied; and
 * that the action's own sentence reaches the card on refusal.
 */
const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      job: { findMany: fn(), findFirst: fn() },
      dailyFieldReport: { findFirst: fn() },
      materialOrder: { findMany: fn(), findFirst: fn() },
      materialOrderDelivery: { findFirst: fn() },
    },
    createDailyFieldReport: vi.fn(),
    recordMaterialDelivery: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/fieldReports", () => ({ createDailyFieldReport: fake.createDailyFieldReport }));
vi.mock("@/lib/actions/materialOrders", () => ({ recordMaterialDelivery: fake.recordMaterialDelivery }));

const { logDailyFieldReportCommand, recordMaterialDeliveryCommand } = await import("./field");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-08" };
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.createDailyFieldReport.mockReset();
  fake.recordMaterialDelivery.mockReset();
});

describe("log_daily_field_report", () => {
  it("asks before it reads when the job or the work is missing", async () => {
    expect((await logDailyFieldReportCommand.resolve(ctx, {})).kind).toBe("need");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses with a link when today's report already exists, in the action's terms", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.dailyFieldReport.findFirst.mockResolvedValue({ id: "r-1" });
    const result = await logDailyFieldReportCommand.resolve(ctx, { jobName: "Riverside", workPerformed: "hung board" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.href).toBe("/field-reports");
    // The natural key is job + the person's calendar day, at UTC midnight.
    expect(fake.prisma.dailyFieldReport.findFirst).toHaveBeenCalledWith({
      where: { jobId: "job-1", reportDate: new Date("2026-09-08T00:00:00.000Z") },
      select: { id: true },
    });
  });

  it("puts today, on the person's calendar, on the card and in the payload", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.dailyFieldReport.findFirst.mockResolvedValue(null);
    const result = await logDailyFieldReportCommand.resolve(ctx, {
      jobName: "Riverside",
      workPerformed: "hung board on level 2",
      crewPresent: "crew of 6",
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.preview.find((l) => l.label === "Date")?.value).toContain("2026-09-08");
    expect(result.preview.find((l) => l.label === "Weather")).toBeUndefined();
    expect(result.resolved).toMatchObject({ jobId: "job-1", reportDate: "2026-09-08", crewPresent: "crew of 6", weather: null });
  });

  it("calls the action with exactly the fields the form would have posted", async () => {
    fake.createDailyFieldReport.mockResolvedValue({ ok: true });
    fake.prisma.dailyFieldReport.findFirst.mockResolvedValue({ id: "r-9" });
    const result = await logDailyFieldReportCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      reportDate: "2026-09-08",
      workPerformed: "hung board",
      crewPresent: "crew of 6",
      weather: null,
      delays: null,
    });
    expect(fake.createDailyFieldReport).toHaveBeenCalledTimes(1);
    const [jobId, fd] = fake.createDailyFieldReport.mock.calls[0] as [string, FormData];
    expect(jobId).toBe("job-1");
    expect(fd.get("reportDate")).toBe("2026-09-08");
    expect(fd.get("workPerformed")).toBe("hung board");
    expect(fd.get("crewPresent")).toBe("crew of 6");
    expect(fd.has("weather")).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.created).toMatchObject({ href: "/field-reports", targetType: "DailyFieldReport", targetId: "r-9" });
  });

  it("puts the action's own refusal on the card", async () => {
    fake.createDailyFieldReport.mockResolvedValue({
      ok: false,
      error: "A report already exists for that date — edit it instead of adding a second one",
    });
    const result = await logDailyFieldReportCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      reportDate: "2026-09-08",
      workPerformed: "hung board",
    });
    expect(result).toEqual({
      ok: false,
      error: "A report already exists for that date — edit it instead of adding a second one",
    });
  });
});

describe("record_material_delivery", () => {
  const order = (id: string, number: number, description: string, vendor: string) => ({
    id,
    number,
    description,
    promisedFor: null,
    vendor: { name: vendor },
  });

  it("refuses with a link when the job has no open order", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.materialOrder.findMany.mockResolvedValue([]);
    const result = await recordMaterialDeliveryCommand.resolve(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.href).toBe("/material-orders");
    // Only orders with no closing delivery are candidates.
    expect(fake.prisma.materialOrder.findMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1", jobId: "job-1", deliveries: { none: { completesOrder: true } } },
    });
  });

  it("offers chips when two open orders could be the one that arrived", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.materialOrder.findMany.mockResolvedValue([
      order("o-2", 2, "5/8 Type X, 200 sheets", "ABC Supply"),
      order("o-1", 1, "Track and stud", "ABC Supply"),
    ]);
    const result = await recordMaterialDeliveryCommand.resolve(ctx, { jobName: "Riverside" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("orderId");
    expect(result.options.map((o) => o.label)).toEqual(["#2 5/8 Type X, 200 sheets", "#1 Track and stud"]);
  });

  it("narrows by what the person called the material, and records completion only when they said so", async () => {
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    fake.prisma.materialOrder.findMany.mockResolvedValue([
      order("o-2", 2, "5/8 Type X, 200 sheets", "ABC Supply"),
      order("o-1", 1, "Track and stud", "ABC Supply"),
    ]);
    const result = await recordMaterialDeliveryCommand.resolve(ctx, { jobName: "Riverside", item: "type x", completesOrder: "yes" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toMatchObject({ orderId: "o-2", completesOrder: true, deliveredOn: "2026-09-08" });
    expect(result.preview.find((l) => l.label === "Completes the order")?.value).toMatch(/^Yes/);

    fake.recordMaterialDelivery.mockResolvedValue({ ok: true });
    fake.prisma.materialOrderDelivery.findFirst.mockResolvedValue({ id: "d-1" });
    const done = await recordMaterialDeliveryCommand.execute(ctx, result.resolved);
    const [orderId, fd] = fake.recordMaterialDelivery.mock.calls[0] as [string, FormData];
    expect(orderId).toBe("o-2");
    expect(fd.get("deliveredOn")).toBe("2026-09-08");
    expect(fd.get("completesOrder")).toBe("on");
    expect(done.ok).toBe(true);
    if (!done.ok) throw new Error("unreachable");
    expect(done.message).toContain("closed the order out");
  });

  it("sends no completesOrder field at all when the person did not say the order is complete", async () => {
    fake.recordMaterialDelivery.mockResolvedValue({ ok: true });
    fake.prisma.materialOrderDelivery.findFirst.mockResolvedValue(null);
    await recordMaterialDeliveryCommand.execute(ctx, {
      jobId: "job-1",
      jobName: "Riverside Plaza",
      orderId: "o-1",
      orderLabel: "#1 Track and stud",
      deliveredOn: "2026-09-08",
      completesOrder: false,
      notes: "two sheets damaged",
    });
    const [, fd] = fake.recordMaterialDelivery.mock.calls[0] as [string, FormData];
    expect(fd.has("completesOrder")).toBe(false);
    expect(fd.get("notes")).toBe("two sheets damaged");
  });
});
