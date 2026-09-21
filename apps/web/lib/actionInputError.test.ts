import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A malformed number or a malformed `<select>` value reaches the person as
 * a SENTENCE, on two screens where it previously reached them as nothing.
 *
 * This is the behaviour half of the InputError convergence; the structural
 * half — one class, one boundary, no way for two of them to disagree — is
 * `lib/actionErrorBoundaryCensus.test.ts`. Neither is sufficient alone: the
 * census can be satisfied by a file that has no boundary at all, and these
 * two cases cannot prove anything about the other sixteen modules.
 *
 * TWO DIFFERENT DEFECTS ARE PINNED HERE, and they are worth telling apart
 * because #407 fixed one of them and the other is the one a contractor
 * actually hit.
 *
 * 1. THE PARSER THREW THE WRONG CLASS (`/jobs/[id]` change orders).
 *    `decimalFromForm` in lib/actions/shared.ts threw a BARE `Error` until
 *    2026-09-21. #407 converted `enumFromForm` and `optionalEnumFromForm`
 *    and left the two decimal parsers behind, so a thousands comma — the
 *    single most likely thing a contractor types into a quantity — was
 *    still a class no boundary in this repo catches.
 *
 *    `changeOrders.ts` had SURVIVED that by hand: local `decimal()` and
 *    `nullableDecimal()` wrappers caught the bare `Error` and rethrew it as
 *    the module's own `InputError`, passing `err.message` through
 *    unchanged. That workaround is deleted now that the parser throws the
 *    right class, and this test is what says the message still arrives —
 *    the deletion and the parser change have to be read together or the
 *    screen goes silent.
 *
 * 2. THE ACTION HAD NO BOUNDARY AT ALL (`/settings` licences).
 *    `createCompanyLicense` and `updateCompanyLicense` declare
 *    `Promise<ActionResult>` — a promise that their refusals are legible —
 *    and called `enumFromForm` with no `runAction` anywhere. After #407
 *    made that parser throw `InputError`, the throw had nothing to catch
 *    it, so the action REJECTED and production redacted the rejection to a
 *    digest. No local `InputError` class is involved, which is exactly why
 *    a `grep -rl "class InputError"` over the action modules never sees
 *    this shape. Counting files found sixteen; counting BOUNDARIES found
 *    these.
 *
 * Both were reproduced against unfixed code before being fixed. Run at
 * `9b53afc` (the `origin/main` this branch left from), case 1 rejects with
 * `"quantity" must be a number` and case 2 rejects with
 * `"jurisdictionType" must be one of: STATE, COUNTY, CITY` — a REJECTION in
 * both, which is the digest.
 *
 * `resolves` versus `rejects` is the entire assertion. A rejected Server
 * Action promise is the "Application error … Digest:" screen; a resolved
 * `{ ok: false, error }` is a sentence under the form. Every `expect` below
 * that awaits an action rather than wrapping it in `rejects` is load-bearing
 * for that reason.
 */

const db = {
  job: { findUnique: vi.fn<(args: unknown) => Promise<unknown>>() },
  changeOrder: { findUnique: vi.fn<(args: unknown) => Promise<unknown>>() },
  changeOrderProposal: { create: vi.fn<(args: unknown) => Promise<unknown>>() },
  companyLicense: {
    findFirst: vi.fn<(args: unknown) => Promise<unknown>>(),
    findUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
    create: vi.fn<(args: unknown) => Promise<unknown>>(),
    update: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
};

/** The account owner — OWNER holds every capability, so nothing below is
 * refused for a permission reason and the only thing under test is what
 * happens to a malformed field. */
const owner = {
  id: "user-1",
  role: "OWNER",
  jobFunction: null,
  company: { id: "company-1", name: "Reyes Drywall", isProvaOperator: false },
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => owner }));
// `Prisma.Decimal` is constructed at module scope by lib/change-order.ts,
// which changeOrders.ts imports. Only arithmetic-free paths run here, so a
// Number-backed stand-in is enough to let the module load.
class FakeDecimal {
  constructor(readonly value: unknown) {}
  toString() {
    return String(this.value);
  }
}
vi.mock("@prova/db", () => ({ prisma: db, Prisma: { Decimal: FakeDecimal } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// compliance.ts pulls the Anthropic SDK in at module scope for the
// document extractor. Nothing under test here reaches it.
vi.mock("@prova/integrations", () => ({
  extractComplianceDocument: vi.fn(),
  ASK_DEFAULT_MODEL: "claude-test",
}));
vi.mock("@/lib/ask/usage", () => ({ recordAskUsage: vi.fn() }));

const { proposeAddedScope } = await import("@/lib/actions/changeOrders");
const { createCompanyLicense, updateCompanyLicense } = await import("@/lib/actions/compliance");

/** A DRAFT change order on this company's contracted job — the only state
 * in which a proposal can be added, so the action reaches its parsers. */
const draftChangeOrder = {
  id: "co-1",
  jobId: "job-1",
  status: "DRAFT",
  job: { id: "job-1", companyId: "company-1", status: "CONTRACTED" },
  proposals: [],
};

const licence = {
  id: "lic-1",
  companyId: "company-1",
  licenseNumber: "0123456",
  jurisdictionName: "Nevada",
};

beforeEach(() => {
  for (const model of Object.values(db)) {
    for (const fn of Object.values(model)) fn.mockReset();
  }
  db.changeOrder.findUnique.mockResolvedValue(draftChangeOrder);
  db.changeOrderProposal.create.mockResolvedValue({});
  db.companyLicense.findFirst.mockResolvedValue(null);
  db.companyLicense.findUnique.mockResolvedValue(licence);
  db.companyLicense.create.mockResolvedValue({});
  db.companyLicense.update.mockResolvedValue({});
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** Everything `proposeAddedScope` needs except the field under test. */
function scopeForm(overrides: Record<string, string>): FormData {
  return form({
    itemDescription: "Add soffit framing at grid C",
    unit: "SF",
    quantity: "100",
    unitPrice: "4.25",
    ...overrides,
  });
}

/** Everything a licence needs except the field under test. */
function licenceForm(overrides: Record<string, string>): FormData {
  return form({
    jurisdictionType: "STATE",
    jurisdictionName: "Nevada",
    licenseNumber: "0123456",
    status: "ACTIVE",
    ...overrides,
  });
}

describe("a thousands comma in a change order quantity", () => {
  it("comes back as a sentence, not a rejected promise", async () => {
    // "2,800" is what a contractor types. Number("2,800") is NaN.
    const result = await proposeAddedScope("co-1", scopeForm({ quantity: "2,800" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("quantity");
    expect(result.error).toMatch(/must be a number/);
    // Nothing was written on the way to refusing.
    expect(db.changeOrderProposal.create).not.toHaveBeenCalled();
  });

  it("says the same thing for an optional money field", async () => {
    const result = await proposeAddedScope("co-1", scopeForm({ unitPrice: "12,500" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unitPrice");
    expect(result.error).toMatch(/must be a number/);
    expect(db.changeOrderProposal.create).not.toHaveBeenCalled();
  });

  it("still writes the proposal when the numbers are numbers", async () => {
    // The other direction, so an action that started refusing EVERYTHING
    // could not pass the two tests above.
    const result = await proposeAddedScope("co-1", scopeForm({ quantity: "2800" }));

    expect(result).toEqual({ ok: true });
    expect(db.changeOrderProposal.create).toHaveBeenCalledTimes(1);
  });
});

describe("a licence saved with a value the picker did not offer", () => {
  it("createCompanyLicense returns the refusal instead of rejecting", async () => {
    const result = await createCompanyLicense(licenceForm({ jurisdictionType: "PROVINCE" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("jurisdictionType");
    expect(db.companyLicense.create).not.toHaveBeenCalled();
  });

  it("covers the status field on the same form", async () => {
    // EXPIRED is deliberately not settable — see SETTABLE_LICENSE_STATUSES.
    // A stale tab offering it must not produce a digest.
    const result = await createCompanyLicense(licenceForm({ status: "EXPIRED" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("status");
    expect(db.companyLicense.create).not.toHaveBeenCalled();
  });

  it("updateCompanyLicense refuses the same way", async () => {
    const result = await updateCompanyLicense("lic-1", licenceForm({ jurisdictionType: "PROVINCE" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("jurisdictionType");
    expect(db.companyLicense.update).not.toHaveBeenCalled();
  });

  it("still saves a licence whose fields are all offered values", async () => {
    const result = await createCompanyLicense(licenceForm({}));

    expect(result).toEqual({ ok: true });
    expect(db.companyLicense.create).toHaveBeenCalledTimes(1);
  });
});
