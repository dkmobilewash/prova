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
 * TWO THINGS ARE PINNED HERE, and after #414 landed under this branch they
 * are no longer the same kind of thing. Saying so is the point.
 *
 * 1. THE LIVE DEFECT: NO BOUNDARY AT ALL (`/settings` licences).
 *    `createCompanyLicense` and `updateCompanyLicense` declare
 *    `Promise<ActionResult>` — a promise that their refusals are legible —
 *    and call `enumFromForm` with no `runAction` anywhere. The throw has
 *    nothing to catch it, so the action REJECTS and production redacts the
 *    rejection to a digest. Reproduced against `origin/main` before being
 *    fixed: all three cases below reject out of `enumFromForm` with
 *    `"jurisdictionType" must be one of: STATE, COUNTY, CITY` and
 *    `"status" must be one of: …`.
 *
 *    NO LOCAL `InputError` CLASS IS INVOLVED, which is exactly why a
 *    `grep -rl "class InputError"` over the action modules never sees this
 *    shape. Counting files found sixteen; counting BOUNDARIES found these.
 *    As of #414 these two are the ONLY pair of their shape left in
 *    `lib/actions` — #414 closed `billing.ts::logPayment` and
 *    `jobs.ts::addCostEntry` by having each return its refusal instead.
 *
 * 2. THE COMPOSITION PROOF, NOT A DEFECT (`/jobs/[id]` change orders).
 *    This section used to assert that `2,800` in a quantity came back as a
 *    refusal. **#414 made `2,800` a valid number** — it parses to `2800`,
 *    along with `$12,500.00` and a non-breaking space from a spreadsheet
 *    paste — so that assertion is obsolete and its replacement is better
 *    news: the comma now SAVES. That is asserted below, through the
 *    converged module, because two changes landing in the same file in the
 *    same day is exactly when a silent regression gets in.
 *
 *    What still has to refuse is a comma in the WRONG place — `12,50`,
 *    which #414 deliberately rejects rather than silently reading as 1250.
 *    That refusal now travels a path this branch changed: the parser
 *    raises the SHARED `InputError`, and `changeOrders.ts`'s boundary is
 *    the shared one. The module's own `decimal()` / `nullableDecimal()`
 *    wrappers — which existed only to catch a bare `Error` and rethrow it
 *    as a private class — are deleted, and this test is what says the
 *    sentence still arrives. The deletion and the shared class have to be
 *    read together or the screen goes silent.
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

describe("numbers a contractor types into a change order", () => {
  it("saves a thousands comma, and stores the figure without it", async () => {
    // #414's tolerance, asserted THROUGH the converged module. `2,800` used
    // to be the bug; it is now the happy path, and the stored value is the
    // bare digits bound for a Postgres numeric column.
    const result = await proposeAddedScope("co-1", scopeForm({ quantity: "2,800" }));

    expect(result).toEqual({ ok: true });
    expect(db.changeOrderProposal.create).toHaveBeenCalledTimes(1);
    const written = db.changeOrderProposal.create.mock.calls[0][0] as {
      data: { quantity: string };
    };
    expect(written.data.quantity).toBe("2800");
  });

  it("saves a currency symbol on the optional money field too", async () => {
    const result = await proposeAddedScope("co-1", scopeForm({ unitPrice: "$12,500.00" }));

    expect(result).toEqual({ ok: true });
    const written = db.changeOrderProposal.create.mock.calls[0][0] as {
      data: { unitPrice: string | null };
    };
    expect(written.data.unitPrice).toBe("12500");
  });

  it("refuses a comma in the wrong place with a sentence, not a rejection", async () => {
    // `12,50` is the one that MUST still refuse: read as 1250 it would be a
    // hundredfold error on a change order a GC signs. #414 wrote that
    // refusal; this branch is what carries it out of the module, now that
    // the local class and the local wrapper are gone.
    const result = await proposeAddedScope("co-1", scopeForm({ quantity: "12,50" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/three digits/i);
    // Nothing was written on the way to refusing.
    expect(db.changeOrderProposal.create).not.toHaveBeenCalled();
  });

  it("refuses an unreadable optional money field the same way", async () => {
    const result = await proposeAddedScope("co-1", scopeForm({ unitPrice: "abc" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/isn't a number/i);
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
