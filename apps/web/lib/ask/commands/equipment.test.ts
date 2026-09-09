import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      equipment: { findMany: fn(), findFirst: fn() },
      job: { findMany: fn(), findFirst: fn() },
      equipmentAssignment: { findFirst: fn() },
    },
    assignEquipment: vi.fn(),
    returnEquipment: vi.fn(),
  };
});

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/equipmentAssignments", () => ({
  assignEquipment: fake.assignEquipment,
  returnEquipment: fake.returnEquipment,
}));

const { sendEquipmentToJobCommand, bringEquipmentBackCommand } = await import("./equipment");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-09-08" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const inYard = { id: "eq-1", name: "Scissor lift", assetTag: "SL-1", type: "lift", assignments: [] };
const outOnMaple = {
  id: "eq-2",
  name: "Scissor lift",
  assetTag: "SL-2",
  type: "lift",
  assignments: [{ id: "stay-7", jobId: "job-maple", sentOutOn: day("2026-08-20"), job: { name: "Maple Street" } }],
};
const riverside = { id: "job-1", name: "Riverside Plaza", status: "IN_PROGRESS", contact: { name: "Turner" } };

beforeEach(() => {
  for (const model of Object.values(fake.prisma)) for (const m of Object.values(model)) m.mockReset();
  fake.assignEquipment.mockReset();
  fake.returnEquipment.mockReset();
});

describe("send_equipment_to_job", () => {
  it("offers chips with the asset tag and where each one is when two lifts match", async () => {
    fake.prisma.equipment.findMany.mockResolvedValue([inYard, outOnMaple]);
    const result = await sendEquipmentToJobCommand.resolve(ctx, { equipment: "scissor lift", jobName: "Riverside" });
    expect(result.kind).toBe("clarify");
    if (result.kind !== "clarify") throw new Error("unreachable");
    expect(result.field).toBe("equipmentId");
    expect(result.options.map((o) => o.detail)).toEqual(["SL-1 · in the yard", "SL-2 · out on Maple Street since 2026-08-20"]);
  });

  it("refuses a piece that is already out, with the return-first sentence", async () => {
    fake.prisma.equipment.findMany.mockResolvedValue([outOnMaple]);
    const result = await sendEquipmentToJobCommand.resolve(ctx, { equipment: "SL-2", jobName: "Riverside" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toContain("already out on Maple Street from 2026-08-20");
    expect(result.reason).toContain("Record its return first");
    expect(fake.prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("is ready with today as the send-out date, and posts exactly the form's fields", async () => {
    fake.prisma.equipment.findMany.mockResolvedValue([inYard]);
    fake.prisma.job.findMany.mockResolvedValue([riverside]);
    const result = await sendEquipmentToJobCommand.resolve(ctx, { equipment: "SL-1", jobName: "Riverside" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.preview.map((l) => l.value)).toEqual(["Scissor lift (SL-1)", "Riverside Plaza", "2026-09-08 (today, on your calendar)"]);

    fake.assignEquipment.mockResolvedValue({ ok: true });
    fake.prisma.equipmentAssignment.findFirst.mockResolvedValue({ id: "stay-new" });
    const done = await sendEquipmentToJobCommand.execute(ctx, result.resolved);
    const [fd] = fake.assignEquipment.mock.calls[0] as [FormData];
    expect(fd.get("equipmentId")).toBe("eq-1");
    expect(fd.get("jobId")).toBe("job-1");
    expect(fd.get("sentOutOn")).toBe("2026-09-08");
    expect(fd.has("returnedOn")).toBe(false);
    expect(done.ok).toBe(true);
    if (!done.ok) throw new Error("unreachable");
    expect(done.created).toMatchObject({ href: "/equipment", targetType: "EquipmentAssignment", targetId: "stay-new" });
  });

  it("puts the action's overlap sentence on the card when the transaction refuses", async () => {
    fake.assignEquipment.mockResolvedValue({
      ok: false,
      error: "Scissor lift is already out on Maple Street from 2026-08-20 and hasn't been brought back. Record its return first.",
    });
    const done = await sendEquipmentToJobCommand.execute(ctx, {
      equipmentId: "eq-1",
      equipmentLabel: "Scissor lift (SL-1)",
      jobId: "job-1",
      jobName: "Riverside Plaza",
      sentOutOn: "2026-09-08",
      notes: null,
    });
    expect(done.ok).toBe(false);
    if (done.ok) throw new Error("unreachable");
    expect(done.error).toContain("Record its return first");
  });
});

describe("bring_equipment_back", () => {
  it("refuses a piece that is not out", async () => {
    fake.prisma.equipment.findMany.mockResolvedValue([inYard]);
    const result = await bringEquipmentBackCommand.resolve(ctx, { equipment: "SL-1" });
    expect(result.kind).toBe("refuse");
    if (result.kind !== "refuse") throw new Error("unreachable");
    expect(result.reason).toContain("isn't out on any job");
  });

  it("closes the open stay with today's date", async () => {
    fake.prisma.equipment.findMany.mockResolvedValue([outOnMaple]);
    const result = await bringEquipmentBackCommand.resolve(ctx, { equipment: "SL-2" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved).toEqual({
      assignmentId: "stay-7",
      equipmentLabel: "Scissor lift (SL-2)",
      jobName: "Maple Street",
      returnedOn: "2026-09-08",
    });

    fake.returnEquipment.mockResolvedValue({ ok: true });
    const done = await bringEquipmentBackCommand.execute(ctx, result.resolved);
    const [assignmentId, fd] = fake.returnEquipment.mock.calls[0] as [string, FormData];
    expect(assignmentId).toBe("stay-7");
    expect(fd.get("returnedOn")).toBe("2026-09-08");
    expect(done.ok).toBe(true);
  });
});
