import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveDoorsWindowsSwitch } = await import("./doorsWindows");

let companyId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Doors Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `doors_${Date.now()}`, email: `doors_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("saveDoorsWindowsSwitch", () => {
  it("is off by default, refuses a member, and an owner turns it on and off", async () => {
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.doorsWindowsOn).toBe(false);
    context.role = "MEMBER";
    const on = new FormData();
    on.set("doorsWindowsOn", "on");
    const refused = await saveDoorsWindowsSwitch(on);
    expect(refused.ok).toBe(false);
    context.role = "OWNER";
    expect((await saveDoorsWindowsSwitch(on)).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.doorsWindowsOn).toBe(true);
    expect((await saveDoorsWindowsSwitch(new FormData())).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.doorsWindowsOn).toBe(false);
  });
});
