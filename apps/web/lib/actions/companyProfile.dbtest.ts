import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { companyProfileGaps } from "@/lib/company-profile";
import { employerAddressLines } from "@/lib/fringe-remittance-filing";

/**
 * `updateCompanyProfile` against a real database.
 *
 * The unit suite proves the rules and proves the write is ISSUED (a fake
 * client records `company.update`). It cannot prove the write LANDS: that
 * these ten columns exist, that Prisma accepts the object this action hands
 * it, and that the row reads back with the normalised values in it. Every
 * one of those columns had been on `Company` for weeks with nothing writing
 * any of them, so "the column is there and writable" is exactly the claim
 * worth checking with Postgres rather than with a mock.
 *
 * The second half is the one that matters more: the documents' own gap
 * function, run over the row as it comes BACK out of the database, goes
 * from three gaps to none. That is the defect closed end to end — a
 * remittance sheet printing red "Not recorded on the company record" for a
 * field the product had no way to capture.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateCompanyProfile } = await import("./company");

let companyId = "";

/** The record as sign-up leaves it: a generated name and nothing else. */
const GENERATED_NAME = "Company Profile Test's Company";

function submission(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    name: "Sierra Interior Systems, Inc.",
    dbaName: "Sierra Interiors",
    ein: "841234567",
    hqAddressLine1: "1400 Industrial Way",
    hqAddressLine2: "Suite 210",
    hqCity: "Longmont",
    hqState: "co",
    hqZip: "80501",
    phone: "(303) 555-0142 x12",
    website: "sierrainteriors.com",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("updateCompanyProfile, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: GENERATED_NAME } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `prof_o_${Date.now()}`,
        email: `prof_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    companyId = company.id;
    context.company.id = company.id;
    context.id = owner.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("starts from a record every document prints a hole for", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(companyProfileGaps(before).map((g) => g.field)).toEqual(["name", "ein", "address"]);
    expect(employerAddressLines(before)).toBeNull();
  });

  it("writes all ten columns, normalised, and reads them back", async () => {
    const result = await updateCompanyProfile(submission());
    expect(result).toEqual({ ok: true });

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after).toMatchObject({
      name: "Sierra Interior Systems, Inc.",
      dbaName: "Sierra Interiors",
      ein: "84-1234567",
      hqAddressLine1: "1400 Industrial Way",
      hqAddressLine2: "Suite 210",
      hqCity: "Longmont",
      hqState: "CO",
      hqZip: "80501",
      phone: "(303) 555-0142 x12",
      website: "https://sierrainteriors.com",
    });
    expect(after.name).not.toBe(GENERATED_NAME);
  });

  it("leaves the documents with nothing left to refuse", async () => {
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(companyProfileGaps(after)).toEqual([]);
    expect(employerAddressLines(after)).toEqual([
      "1400 Industrial Way",
      "Suite 210",
      "Longmont, CO 80501",
    ]);
  });

  it("clears an optional field to SQL NULL rather than to an empty string", async () => {
    // A column holding "" reads as recorded and prints as nothing, which is
    // the failure the red sentences exist to prevent.
    await updateCompanyProfile(submission({ ein: "", website: "", hqAddressLine2: "" }));
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.ein).toBeNull();
    expect(after.website).toBeNull();
    expect(after.hqAddressLine2).toBeNull();
    // Line 2 is genuinely optional, so clearing it does NOT reopen the
    // address gap — only the EIN one comes back.
    expect(companyProfileGaps(after).map((g) => g.field)).toEqual(["ein"]);
  });

  it("refuses a bad EIN without touching the stored row", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const result = await updateCompanyProfile(submission({ name: "Renamed By A Refusal" }));
    expect(result).toEqual({ ok: true });

    const bad = await updateCompanyProfile(submission({ name: "Should Not Land", ein: "12345" }));
    expect(bad.ok).toBe(false);

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.name).toBe("Renamed By A Refusal");
    expect(after.name).not.toBe("Should Not Land");
    expect(before.id).toBe(after.id);
  });

  it("refuses a MEMBER without writing", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    try {
      const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const result = await updateCompanyProfile(submission({ name: "Member Rename" }));
      expect(result.ok).toBe(false);
      const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      expect(after.name).toBe(before.name);
    } finally {
      context.role = "OWNER";
      context.jobFunction = null;
    }
  });
});
