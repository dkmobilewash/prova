import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `setWallTypeThickness` against a real Postgres: it moves ONLY the thickness,
 * only on the caller's own type, refuses a figure that is not a wall, and
 * refuses another company's type by name rather than by silence.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setWallTypeThickness } = await import("./wallTypes");

let companyId = "";
let otherCompanyId = "";
let typeId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Thickness Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const other = await prisma.company.create({ data: { name: "Thickness Other Co" } });
  otherCompanyId = other.id;
  const type = await prisma.wallType.create({
    data: { companyId, code: "C8B", name: "8in concrete, board one side", thicknessIn: "9.25", sortOrder: 1 },
  });
  typeId = type.id;
});

afterAll(async () => {
  await prisma.wallType.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe("setWallTypeThickness", () => {
  it("moves the thickness to what is drawn and touches nothing else", async () => {
    const result = await setWallTypeThickness("job-1", typeId, 11.25);
    expect(result).toEqual({ ok: true });
    const after = await prisma.wallType.findUniqueOrThrow({ where: { id: typeId } });
    expect(Number(after.thicknessIn)).toBe(11.25);
    expect(after.code).toBe("C8B");
    expect(after.name).toBe("8in concrete, board one side");
  });

  it("refuses a figure that is not a wall, and another company's type", async () => {
    expect((await setWallTypeThickness("job-1", typeId, 0)).ok).toBe(false);
    expect((await setWallTypeThickness("job-1", typeId, Number.NaN)).ok).toBe(false);
    context.company.id = otherCompanyId;
    const refused = await setWallTypeThickness("job-1", typeId, 5);
    context.company.id = companyId;
    expect(refused.ok).toBe(false);
    const after = await prisma.wallType.findUniqueOrThrow({ where: { id: typeId } });
    expect(Number(after.thicknessIn)).toBe(11.25);
  });
});
