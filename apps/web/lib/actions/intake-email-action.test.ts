import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * regenerateIntakeEmailAddress — the owner gate and the write.
 *
 * The action's whole job is one guarded UPDATE, so the tests pin exactly
 * that: a non-owner (and a caller without MANAGE_JOBS) gets a sentence and
 * NO write; the owner gets a fresh 32-hex token that is not the old one.
 * That the new token invalidates the old ADDRESS is the single-column
 * replacement, exercised end-to-end in lib/intake/inbound.test.ts.
 */

const update = vi.fn(async (_args: unknown) => ({}));
let role = "OWNER";
let capable = true;

vi.mock("@prova/db", () => ({
  prisma: { company: { update: (args: unknown) => update(args as never) } },
  Prisma: {},
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => ({
    id: "user-1",
    companyId: "company-1",
    role,
    company: { id: "company-1", name: "Test Drywall" },
  })),
}));
vi.mock("@/lib/permissions", () => ({ can: () => capable }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function run() {
  const { regenerateIntakeEmailAddress } = await import("@/lib/actions/intake");
  return regenerateIntakeEmailAddress();
}

describe("regenerateIntakeEmailAddress", () => {
  beforeEach(() => {
    update.mockClear();
    role = "OWNER";
    capable = true;
  });

  it("refuses a non-owner with a sentence and writes nothing", async () => {
    role = "MEMBER";
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("account owner");
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a caller without MANAGE_JOBS and writes nothing", async () => {
    capable = false;
    const result = await run();
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("replaces the token with a fresh 32-hex one for the owner", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0][0] as unknown as {
      where: { id: string };
      data: { intakeEmailToken: string };
    };
    expect(args.where).toEqual({ id: "company-1" });
    expect(args.data.intakeEmailToken).toMatch(/^[0-9a-f]{32}$/);
  });
});
