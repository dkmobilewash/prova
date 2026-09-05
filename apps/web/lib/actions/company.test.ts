import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The company profile: the one record with a row from day one and, until
 * now, no way to edit it.
 *
 * Two things here are worth more than the rest of the file, and both are
 * about the same fact — `Company.name` is what a GC reads on a subcontract:
 *
 * 1. **A rename must not reach back into a signed contract.**
 *    `SignatureRequest.snapshot` is a JSON copy taken at the instant of
 *    signing. Nothing recomputes it and nothing may. The obvious "helpful"
 *    change — keeping the snapshot in step with the company's current name
 *    — is exactly the change that destroys the evidence, and it would look
 *    like a tidy-up in a diff. So this asserts BOTH that the stored
 *    snapshot still says what it said AND that the action issued no write
 *    to signatureRequest at all. The second is the one that survives
 *    somebody rewriting the first.
 *
 * 2. **A blank name is refused, not defaulted.** Any fallback — the old
 *    name, the owner's name, "My Company" — means the string on a contract
 *    can change by a mechanism nobody watched happen. The refusal has to
 *    leave the stored name untouched, which is a separate claim from
 *    returning ok:false, and is asserted separately.
 */

let db = new FakeDb();

/** Mutable so a test can demote the caller to MEMBER. Same object identity
 * throughout, which is what the mock below hands back. */
const context = {
  id: "user_1",
  role: "OWNER" as string,
  company: { id: "co_1" },
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

const {
  addCompanyTradeScope,
  removeCompanyTradeScope,
  updateCompanyProfile,
  updateCompanyTradeScope,
} = await import("./company");

/** The profile form, exactly as the browser submits it. */
function profileForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    name: "Sierra Wall Systems, Inc.",
    dbaName: "Sierra Drywall",
    ein: "86-1234567",
    hqAddressLine1: "4120 Marshall St",
    hqAddressLine2: "",
    hqCity: "Wheat Ridge",
    hqState: "CO",
    hqZip: "80033",
    phone: "(720) 555-0134",
    website: "sierrawall.com",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function scopeForm(values: Record<string, string> = {}) {
  const fd = new FormData();
  const merged: Record<string, string> = { tradeScope: "METAL_FRAMING_DRYWALL", ...values };
  for (const [key, value] of Object.entries(merged)) fd.set(key, value);
  return fd;
}

function company() {
  return db.rows("company")[0];
}

beforeEach(() => {
  db = new FakeDb();
  context.role = "OWNER";
  db.seed("company", {
    id: "co_1",
    // The generated name from lib/auth.ts — the exact string this whole
    // feature exists to let somebody correct.
    name: "Dave's Company",
    dbaName: null,
    ein: null,
    hqAddressLine1: null,
    hqAddressLine2: null,
    hqCity: null,
    hqState: null,
    hqZip: null,
    phone: null,
    website: null,
  });
});

/** A contract already signed under the generated name. */
function seedSignedContract() {
  db.seed("signatureRequest", {
    id: "sig_1",
    jobId: "job_1",
    status: "SIGNED",
    signerName: "Marisol Vega",
    snapshot: {
      companyName: "Dave's Company",
      jobName: "Cherry Creek Tower — Level 3 framing",
      clientName: "Boulder GC",
      scope: null,
      total: 84000,
      lineItems: [],
    },
  });
}

describe("updateCompanyProfile", () => {
  it("writes the new name and every profile column", async () => {
    const result = await updateCompanyProfile(profileForm());

    expect(result).toEqual({ ok: true });
    expect(company().name).toBe("Sierra Wall Systems, Inc.");
    expect(company().dbaName).toBe("Sierra Drywall");
    expect(company().ein).toBe("86-1234567");
    expect(company().hqAddressLine1).toBe("4120 Marshall St");
    expect(company().hqCity).toBe("Wheat Ridge");
    expect(company().hqState).toBe("CO");
    expect(company().hqZip).toBe("80033");
    expect(company().phone).toBe("(720) 555-0134");
    expect(company().website).toBe("sierrawall.com");
  });

  it("stores an omitted optional field as null, not an empty string", async () => {
    await updateCompanyProfile(profileForm({ hqAddressLine2: "", ein: "" }));

    expect(company().hqAddressLine2).toBeNull();
    expect(company().ein).toBeNull();
  });

  it("REFUSES a blank name and leaves the stored one alone", async () => {
    const result = await updateCompanyProfile(profileForm({ name: "" }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Company name is required");
    // The refusal is only worth anything if nothing was written.
    expect(company().name).toBe("Dave's Company");
    expect(db.writes).not.toContain("company.update");
  });

  it("REFUSES a name that is only whitespace", async () => {
    const result = await updateCompanyProfile(profileForm({ name: "   " }));

    expect(result.ok).toBe(false);
    expect(company().name).toBe("Dave's Company");
    expect(db.writes).not.toContain("company.update");
  });

  it("refuses a MEMBER, in a sentence that says who can do it", async () => {
    context.role = "MEMBER";

    const result = await updateCompanyProfile(profileForm());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Only the account owner");
    expect(company().name).toBe("Dave's Company");
    expect(db.writes).not.toContain("company.update");
  });
});

describe("renaming the company does not rewrite a signed contract", () => {
  it("leaves the signature snapshot saying what it said at signing", async () => {
    seedSignedContract();

    const result = await updateCompanyProfile(profileForm());

    expect(result).toEqual({ ok: true });
    expect(company().name).toBe("Sierra Wall Systems, Inc.");

    const snapshot = db.rows("signatureRequest")[0].snapshot as { companyName: string };
    expect(snapshot.companyName).toBe("Dave's Company");
  });

  it("issues no write to signatureRequest at all", async () => {
    seedSignedContract();

    await updateCompanyProfile(profileForm());

    // Stronger than reading the snapshot back: this fails the moment anyone
    // adds a cascade here, however carefully it preserves the value today.
    expect(db.writes.filter((write) => write.startsWith("signatureRequest."))).toEqual([]);
  });
});

describe("company trade scopes", () => {
  it("adds a scope this company self-performs", async () => {
    const result = await addCompanyTradeScope(scopeForm({ tradeScope: "LATH_PLASTER" }));

    expect(result).toEqual({ ok: true });
    const rows = db.rows("companyTradeScope");
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe("co_1");
    expect(rows[0].tradeScope).toBe("LATH_PLASTER");
    expect(rows[0].isPrimary).toBe(false);
    expect(rows[0].activeSince).toBeNull();
  });

  it("stores activeSince at UTC midnight", async () => {
    await addCompanyTradeScope(scopeForm({ activeSince: "2019-04-01" }));

    expect(db.rows("companyTradeScope")[0].activeSince).toEqual(
      new Date("2019-04-01T00:00:00.000Z"),
    );
  });

  it("refuses a MEMBER adding one", async () => {
    context.role = "MEMBER";

    const result = await addCompanyTradeScope(scopeForm());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Only the account owner");
    expect(db.rows("companyTradeScope")).toHaveLength(0);
  });

  it("makes primary mean ONE trade — a new primary clears the old one", async () => {
    await addCompanyTradeScope(scopeForm({ tradeScope: "LATH_PLASTER", isPrimary: "on" }));
    await addCompanyTradeScope(scopeForm({ tradeScope: "EIFS", isPrimary: "on" }));

    const primaries = db
      .rows("companyTradeScope")
      .filter((row) => row.isPrimary)
      .map((row) => row.tradeScope);
    expect(primaries).toEqual(["EIFS"]);
  });

  it("clears the old primary when an existing row is promoted", async () => {
    await addCompanyTradeScope(scopeForm({ tradeScope: "LATH_PLASTER", isPrimary: "on" }));
    await addCompanyTradeScope(scopeForm({ tradeScope: "EIFS" }));
    const eifs = db.rows("companyTradeScope").find((row) => row.tradeScope === "EIFS");

    await updateCompanyTradeScope(
      String(eifs?.id),
      scopeForm({ tradeScope: "EIFS", isPrimary: "on" }),
    );

    const primaries = db
      .rows("companyTradeScope")
      .filter((row) => row.isPrimary)
      .map((row) => row.tradeScope);
    expect(primaries).toEqual(["EIFS"]);
  });

  it("will not touch another company's trade scope", async () => {
    db.seed("companyTradeScope", {
      id: "cts_other",
      companyId: "co_2",
      tradeScope: "EIFS",
      isPrimary: false,
      activeSince: null,
    });

    const removed = await removeCompanyTradeScope("cts_other");
    const updated = await updateCompanyTradeScope("cts_other", scopeForm());

    expect(removed).toEqual({ ok: false, error: "Trade scope not found" });
    expect(updated).toEqual({ ok: false, error: "Trade scope not found" });
    expect(db.rows("companyTradeScope")).toHaveLength(1);
  });

  it("refuses a MEMBER removing one", async () => {
    await addCompanyTradeScope(scopeForm());
    const row = db.rows("companyTradeScope")[0];
    context.role = "MEMBER";

    const result = await removeCompanyTradeScope(String(row.id));

    expect(result.ok).toBe(false);
    expect(db.rows("companyTradeScope")).toHaveLength(1);
  });

  it("removes one this company holds", async () => {
    await addCompanyTradeScope(scopeForm());
    const row = db.rows("companyTradeScope")[0];

    const result = await removeCompanyTradeScope(String(row.id));

    expect(result).toEqual({ ok: true });
    expect(db.rows("companyTradeScope")).toHaveLength(0);
  });
});
