import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * `updateCompanyProfile` — the only writer of the company's own record.
 *
 * WHAT THESE ARE FOR. Until this action existed nothing in `apps/web`
 * called `prisma.company.update`, so `Company.name` was whatever sign-up
 * invented (`${your name}'s Company`) forever — on the WH-347 certified
 * payroll form, on a union trust-fund remittance report, and above the
 * signature block a GC signs. Three things therefore have to hold, and all
 * three are asserted on the ROW rather than on the return value where it
 * matters: the write lands, a refusal never writes, and every refusal
 * arrives as a sentence rather than as a throw.
 *
 * THE REFUSALS ARE RETURNED, NOT THROWN, and that is the point of testing
 * them at this level: production redacts a thrown Server Action message to
 * an opaque digest, so an action that throws its validation messages has no
 * validation messages as far as a real user is concerned. Every `expect`
 * below reads `result.error`, which is the only version a person sees.
 */

let db = new FakeDb();
const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return db.client();
  },
}));

const { updateCompanyProfile } = await import("./company");

/** The record as sign-up leaves it: a generated name and nothing else. */
const SIGN_UP_ROW = {
  id: "co_1",
  name: "Cyrus's Company",
  dbaName: null,
  ein: null,
  hqAddressLine1: null,
  hqAddressLine2: null,
  hqCity: null,
  hqState: null,
  hqZip: null,
  phone: null,
  website: null,
};

/** A complete submission, exactly as the form posts it. */
function submission(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    name: "Sierra Interior Systems, Inc.",
    dbaName: "Sierra Interiors",
    ein: "84-1234567",
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

function row() {
  return db.rows("company")[0];
}

beforeEach(() => {
  db = new FakeDb();
  db.seed("company", { ...SIGN_UP_ROW });
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("updateCompanyProfile — a successful save", () => {
  it("persists every field, normalised, over the generated name", async () => {
    const result = await updateCompanyProfile(submission());

    expect(result).toEqual({ ok: true });
    expect(db.writes).toEqual(["company.update"]);
    expect(row()).toMatchObject({
      name: "Sierra Interior Systems, Inc.",
      dbaName: "Sierra Interiors",
      // Hyphenated on the way in, so every print of it matches.
      ein: "84-1234567",
      hqAddressLine1: "1400 Industrial Way",
      hqAddressLine2: "Suite 210",
      hqCity: "Longmont",
      // A state code prints on a federal form; "co" is not how it prints.
      hqState: "CO",
      hqZip: "80501",
      // Free text, deliberately: an extension is part of a real number.
      phone: "(303) 555-0142 x12",
      website: "https://sierrainteriors.com",
    });
    expect(row().name).not.toBe(SIGN_UP_ROW.name);
  });

  it("stores nine bare digits as the same EIN as the hyphenated form", async () => {
    await updateCompanyProfile(submission({ ein: "841234567" }));
    expect(row().ein).toBe("84-1234567");
  });

  it("clears an optional field back to null rather than storing an empty string", async () => {
    // A record holding "" reads as recorded and prints as nothing, which is
    // the exact failure the red "Not recorded" sentences exist to prevent.
    await updateCompanyProfile(submission());
    await updateCompanyProfile(submission({ dbaName: "", ein: "", website: "", phone: "" }));
    expect(row()).toMatchObject({ dbaName: null, ein: null, website: null, phone: null });
  });

  it("writes to THIS company's row, not by name or position", async () => {
    db.seed("company", { ...SIGN_UP_ROW, id: "co_2", name: "Someone Else Drywall" });
    await updateCompanyProfile(submission());
    expect(db.rows("company").find((r) => r.id === "co_2")?.name).toBe("Someone Else Drywall");
  });
});

describe("updateCompanyProfile — refusals", () => {
  it("refuses a blank legal name, and writes nothing", async () => {
    const result = await updateCompanyProfile(submission({ name: "   " }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toBe("Legal company name is required");
    expect(db.writes).toEqual([]);
    expect(row().name).toBe(SIGN_UP_ROW.name);
  });

  it("refuses a malformed EIN with a sentence, and writes nothing", async () => {
    const result = await updateCompanyProfile(submission({ ein: "84-12345" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("nine digits");
    // The rest of a valid submission is discarded with it — a half-applied
    // company record is worse than a refused one.
    expect(db.writes).toEqual([]);
    expect(row().hqCity).toBeNull();
  });

  it("refuses a website that is not a web address, and writes nothing", async () => {
    const result = await updateCompanyProfile(submission({ website: "our website" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("not a web address");
    expect(db.writes).toEqual([]);
  });
});

describe("updateCompanyProfile — owner only", () => {
  it("refuses a MEMBER and writes nothing", async () => {
    context.role = "MEMBER";

    const result = await updateCompanyProfile(submission());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(db.writes).toEqual([]);
    expect(row().name).toBe(SIGN_UP_ROW.name);
  });

  it("tells the member WHY, naming the documents rather than the rule", async () => {
    context.role = "MEMBER";

    const result = await updateCompanyProfile(submission());

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("owner");
    expect(result.error).toContain("WH-347");
    // Not the "Only the account owner can do that" default, which told
    // nobody anything (lib/actions/shared.ts).
    expect(result.error).not.toBe("Only the account owner can do that");
  });

  // `/settings` demands MANAGE_COMPLIANCE and a page guard stops a page
  // rendering, not the endpoint behind it. Derived and executed for real in
  // lib/action-capability-guards.test.ts across every job function; this
  // case pins the ORDER of the two guards, which that suite cannot see.
  it("gives a FIELD member the job-function sentence, not the owner one", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";

    const result = await updateCompanyProfile(submission());

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("part of your job function");
    expect(db.writes).toEqual([]);
  });

  it("gives a PAYROLL_COMPLIANCE member the owner sentence — they hold the capability", async () => {
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";

    const result = await updateCompanyProfile(submission());

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).not.toContain("part of your job function");
    expect(result.error).toContain("owner");
    expect(db.writes).toEqual([]);
  });

  it("refuses the member BEFORE validating anything, so the refusal is the owner one", async () => {
    // Otherwise a member submitting a bad EIN learns about the EIN and not
    // about the permission, and fixes the wrong thing twice.
    context.role = "MEMBER";

    const result = await updateCompanyProfile(submission({ name: "", ein: "nope" }));

    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("owner");
  });
});
