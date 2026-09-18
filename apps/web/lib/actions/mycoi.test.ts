import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * importMyCoiExport — the only write behind the myCOI card.
 *
 *   1. Owner only, and MANAGE_COMPLIANCE — both RETURNED, never thrown, and
 *      both before anything is read or written.
 *   2. Tenant scope: another company's certificate with the very same party,
 *      line and date is NOT "already here", and every row written carries the
 *      session's company. The fake honours `where` by equality, so a read
 *      that dropped `companyId` would see company B's row and this fails.
 *   3. Idempotent: the same export twice adds nothing the second time.
 *   4. Nothing written says "expired": the row carries its date and a
 *      RECEIVED status, and standing is derived per read.
 *   5. Two confirms colliding come back as a sentence, not a throw.
 */

let db = new FakeDb();
let conflictOnWrite = false;

const context = {
  company: { id: "co_A" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    const client = db.client() as unknown as Record<string, unknown>;
    if (!conflictOnWrite) return client;
    return new Proxy(client, {
      get(target, property) {
        if (property !== "$transaction") return (target as Record<string, unknown>)[property as string];
        return async () => {
          const error = new Error("could not serialize access");
          (error as Error & { code?: string }).code = "P2034";
          throw error;
        };
      },
    });
  },
}));

const { importMyCoiExport } = await import("./mycoi");

const FILE = [
  "Vendor,Coverage,Carrier,Policy number,Expiration date,Status",
  "Acme Scaffold,GL,Example Mutual,GL-1,2026-10-01,Compliant",
  "Ridge Drywall,Auto,Other Co,AU-9,2026-09-01,Non-Compliant",
].join("\n");

function form(text: string) {
  const data = new FormData();
  data.set("csv", text);
  return data;
}

function certificates() {
  return db.rows("complianceDocument");
}

beforeEach(() => {
  db = new FakeDb();
  conflictOnWrite = false;
  context.role = "OWNER";
  context.jobFunction = null;
  // Company B already has Acme's GL certificate, same line, same date.
  db.seed("complianceDocument", {
    id: "theirs",
    companyId: "co_B",
    type: "CERTIFICATE_OF_INSURANCE",
    partyName: "Acme Scaffold",
    coverageType: "General liability",
    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
  });
  db.seed("vendor", { id: "v_b", companyId: "co_B", name: "Ridge Drywall" });
});

describe("importMyCoiExport", () => {
  it("refuses a non-owner by returning a sentence, and writes nothing", async () => {
    for (const role of ["MEMBER", "ADMIN", "FIELD"]) {
      context.role = role;
      const result = await importMyCoiExport(form(FILE));
      expect(result).toEqual({ ok: false, error: "Only the account owner can import certificates of insurance." });
    }
    expect(certificates().map((row) => row.id)).toEqual(["theirs"]);
  });

  it("refuses an empty paste with a sentence", async () => {
    expect(await importMyCoiExport(form("  "))).toMatchObject({ ok: false });
    expect(certificates()).toHaveLength(1);
  });

  it("writes this company's rows only, and does not count another company's certificate as already here", async () => {
    const result = await importMyCoiExport(form(FILE));
    expect(result).toEqual({
      ok: true,
      value: { created: 2, alreadyThere: 0, skipped: 0, message: "Added 2 certificates." },
    });
    const mine = certificates().filter((row) => row.id !== "theirs");
    expect(mine).toHaveLength(2);
    expect(mine.every((row) => row.companyId === "co_A")).toBe(true);
    // Company B's row is untouched.
    expect(certificates().find((row) => row.id === "theirs")).toMatchObject({ companyId: "co_B" });
  });

  it("writes a plain COI with its date — no stored verdict about expiry", async () => {
    await importMyCoiExport(form(FILE));
    const ridge = certificates().find((row) => row.partyName === "Ridge Drywall")!;
    // Already past on 2026-09-18, and still written the same as a current one.
    expect(ridge).toMatchObject({
      type: "CERTIFICATE_OF_INSURANCE",
      status: "RECEIVED",
      coverageType: "Automobile liability",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      notes:
        "Imported from a myCOI export on 2026-09-18. Carrier: Other Co. Policy: AU-9. myCOI status in the export: Non-Compliant.",
    });
    expect(Object.keys(ridge).filter((key) => /expired|overdue|lapsed|urgency|standing/i.test(key))).toEqual([]);
  });

  it("is idempotent: the same export twice adds nothing the second time", async () => {
    await importMyCoiExport(form(FILE));
    const again = await importMyCoiExport(form(FILE));
    expect(again).toMatchObject({ ok: true, value: { created: 0, alreadyThere: 2 } });
    expect(certificates()).toHaveLength(3);
  });

  it("turns a serialization conflict into a sentence to confirm again", async () => {
    conflictOnWrite = true;
    const result = await importMyCoiExport(form(FILE));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toContain("confirm again");
  });
});
