import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveSymbolCountSwitch } = await import("./symbolCount");

let companyId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Symbols Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `sym_${Date.now()}`, email: `sym_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("saveSymbolCountSwitch", () => {
  it("is ON by default (the off column false), refuses a member, and an owner turns it off and back on", async () => {
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.symbolCountOff).toBe(false);
    context.role = "MEMBER";
    const off = new FormData();
    expect((await saveSymbolCountSwitch(off)).ok).toBe(false);
    context.role = "OWNER";
    expect((await saveSymbolCountSwitch(off)).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.symbolCountOff).toBe(true);
    const on = new FormData();
    on.set("symbolCountOn", "on");
    expect((await saveSymbolCountSwitch(on)).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId } }))?.symbolCountOff).toBe(false);
  });
});
