import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import {
  DEDUPE_WINDOW_HOURS,
  HOURLY_LEAD_CEILING,
  requestProblem,
  type OfferRequest,
} from "@/lib/takeoff-offer";

/**
 * `requestDrawingSetRead` against a real Postgres.
 *
 * `.dbtest.ts` — run against a SCRATCH database, never a real one; this
 * file creates and deletes companies. `vitest.db.setup.mts` refuses to
 * start the suite against anything that is not localhost or a unix socket,
 * and there is no escape hatch. See the recipe in `vitest.db.config.mts`.
 *
 * ── WHY THIS ACTION NEEDS A DATABASE TEST MORE THAN MOST ──
 *
 * `takeoff-offer.test.ts` proves the deciding half — `requestProblem`,
 * `withinDedupeWindow`, `overCeiling`, `requestNote` — with hand-built
 * inputs, and it proves all of it. Four things it cannot touch, and every
 * one of them is the kind that only fails once a stranger has posted to the
 * endpoint:
 *
 *  - THE TENANT BOUNDARY. This is the only unauthenticated action in the
 *    app. There is no `requireCompanyContext()` to scope the write, so the
 *    only thing standing between a public POST and an ordinary tenant's CRM
 *    is that the target company is resolved from `isProvaOperator` and never
 *    from input. That is a claim about a query, and a unit test with a
 *    mocked client cannot make it — which is why the fixture below creates a
 *    SECOND, non-operator company and asserts its lead count never moves.
 *
 *  - IDEMPOTENCE. `withinDedupeWindow` returning true is a decision; "and
 *    therefore nothing was written" is a row count. Those are different
 *    claims, and only the second one is the bug a double-submitted public
 *    form actually causes. Every dedupe case here asserts the COUNT, not
 *    just the returned flag — a return value is what the action says it did.
 *
 *  - CASE-INSENSITIVE MATCHING. `mode: "insensitive"` is executed by
 *    Postgres, not by the application. It typechecks whether or not it
 *    works.
 *
 *  - THE CEILING. `overCeiling` compares a number. Whether the number it is
 *    handed counts the right rows — this company's, INBOUND only, inside the
 *    hour — is a question about a `where` clause.
 *
 * ── THE ONE THING THAT IS DELIBERATELY NOT MOCKED ──
 *
 * `@/lib/auth`. Every other action dbtest in this directory mocks
 * `requireCompanyContext`, because every other action calls it. This file
 * mocking it would hide the property most worth proving: the action runs to
 * completion with no authenticated caller anywhere. If somebody ever adds
 * that call back, these tests fail with a redirect rather than passing on a
 * mock that papers over it.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** The intake address the offer is open on. `offerIntakeAddress()` reads
 *  `process.env.SUPPORT_EMAIL` at CALL time, so setting it here is enough —
 *  no module mock, and the real validation runs. */
const SEND_TO = "takeoffs@prova-dbtest.test";
let previousSupportEmail: string | undefined;

const { requestDrawingSetRead } = await import("./takeoffOffer");

function form(values: OfferRequest) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** A complete, valid request. Spread and override one field per test, so a
 *  test about one rule cannot be passing because a different field is
 *  wrong. */
const VALID: OfferRequest = {
  companyName: "Ridgeline Drywall",
  contactName: "Marisol Vega",
  email: "marisol@ridgeline-drywall.test",
  phone: "(702) 555-0144",
  trade: "FRAMING_DRYWALL",
  projectName: "Sunset Medical Office Building",
  gcName: "Harker Construction",
};

/** Prova's own operating company — the only one this action may write to. */
let operatorCompanyId = "";
/** An ordinary tenant. Its lead count is the tenant-boundary assertion. */
let otherCompanyId = "";

async function clearSalesRows() {
  const companyId = { in: [operatorCompanyId, otherCompanyId] };
  // Activities first, then opportunities, then leads: SalesActivity.leadId
  // and SalesOpportunity.leadId are both RESTRICT.
  await prisma.salesActivity.deleteMany({ where: { companyId } });
  await prisma.salesOpportunity.deleteMany({ where: { companyId } });
  await prisma.salesLead.deleteMany({ where: { companyId } });
}

describe("requestDrawingSetRead — the public /wall-takeoff intake", () => {
  beforeAll(async () => {
    previousSupportEmail = process.env.SUPPORT_EMAIL;
    process.env.SUPPORT_EMAIL = SEND_TO;

    const operator = await prisma.company.create({
      data: { name: "Prova (operator, takeoff offer dbtest)", isProvaOperator: true },
    });
    operatorCompanyId = operator.id;

    const other = await prisma.company.create({
      data: { name: "Ordinary Tenant (takeoff offer dbtest)", isProvaOperator: false },
    });
    otherCompanyId = other.id;

    // A control on the fixture itself, not on the code. This action resolves
    // its target with an UNSCOPED `findFirst({ isProvaOperator: true })`, so
    // a stray operator row left behind by another file would make every
    // assertion below about the wrong company — and it would still pass.
    expect(
      await prisma.company.count({ where: { isProvaOperator: true } }),
      "another operator company exists in the scratch database; the fixture cannot be trusted",
    ).toBe(1);
  });

  afterAll(async () => {
    await clearSalesRows();
    await prisma.company.deleteMany({
      where: { id: { in: [operatorCompanyId, otherCompanyId] } },
    });
    if (previousSupportEmail === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = previousSupportEmail;
  });

  beforeEach(async () => {
    // Every test starts from zero leads, so a row count is an exact claim
    // rather than a delta — and so the hourly ceiling cannot be tripped by
    // an earlier test's rows.
    process.env.SUPPORT_EMAIL = SEND_TO;
    await prisma.company.update({
      where: { id: operatorCompanyId },
      data: { isProvaOperator: true },
    });
    await clearSalesRows();
  });

  it("creates a lead, an opportunity and a NOTE activity on the operator company", async () => {
    const result = await requestDrawingSetRead(form(VALID));

    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO, alreadyHadIt: false } });

    const leads = await prisma.salesLead.findMany({ where: { companyId: operatorCompanyId } });
    expect(leads).toHaveLength(1);
    expect(leads[0].companyName).toBe(VALID.companyName);
    expect(leads[0].contactName).toBe(VALID.contactName);
    expect(leads[0].email).toBe(VALID.email);
    expect(leads[0].phone).toBe(VALID.phone);
    expect(leads[0].source).toBe("INBOUND");

    const opportunities = await prisma.salesOpportunity.findMany({
      where: { leadId: leads[0].id },
    });
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].stage).toBe("NEW");
    // Null rather than 0: the field's own comment says 0 would read as
    // "worth nothing" instead of "not yet estimated".
    expect(opportunities[0].estimatedMrr).toBeNull();

    const activities = await prisma.salesActivity.findMany({ where: { leadId: leads[0].id } });
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("NOTE");
    expect(activities[0].opportunityId).toBe(opportunities[0].id);
    expect(activities[0].followUpOn).toBeNull();
    expect(activities[0].loggedByUserId).toBeNull();
    // Everything the form collected that SalesLead has no column for has to
    // be in this note or it is lost.
    expect(activities[0].summary).toContain("/wall-takeoff");
    expect(activities[0].summary).toContain("Metal framing & drywall");
    expect(activities[0].summary).toContain(VALID.projectName);
    expect(activities[0].summary).toContain(VALID.gcName);
    expect(activities[0].summary).toContain(VALID.phone);
    // Stored at UTC midnight, same rule as every other date in this app.
    expect(activities[0].occurredOn.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });

  it("writes nothing on a second identical submit inside the dedupe window", async () => {
    expect((await requestDrawingSetRead(form(VALID))).ok).toBe(true);

    const second = await requestDrawingSetRead(form(VALID));

    // The ROW COUNT FIRST, deliberately. "It said it deduped" and "it wrote
    // nothing" are different claims and only the second one is the bug — so
    // the count is the assertion that must be the one to fire. Asserting the
    // returned flag first put a mutation's failure on the flag and left the
    // counts unexecuted, which is a count assertion nothing has proved.
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(await prisma.salesOpportunity.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(await prisma.salesActivity.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(second).toEqual({ ok: true, value: { sendTo: SEND_TO, alreadyHadIt: true } });
  });

  it("creates a second lead for the same address once the window has passed", async () => {
    // Older than the window by an hour, so this is not a boundary test
    // pretending to be a behaviour test.
    const stale = new Date(Date.now() - (DEDUPE_WINDOW_HOURS + 1) * 3_600_000);
    await prisma.salesLead.create({
      data: {
        companyId: operatorCompanyId,
        companyName: VALID.companyName,
        email: VALID.email,
        source: "INBOUND",
        createdAt: stale,
      },
    });

    const result = await requestDrawingSetRead(form(VALID));

    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO, alreadyHadIt: false } });
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(2);
  });

  it("matches the address regardless of case", async () => {
    expect(
      (await requestDrawingSetRead(form({ ...VALID, email: "Marisol.Vega@Ridgeline-Drywall.TEST" }))).ok,
    ).toBe(true);

    const second = await requestDrawingSetRead(
      form({ ...VALID, email: "marisol.vega@ridgeline-drywall.test" }),
    );

    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(second).toEqual({ ok: true, value: { sendTo: SEND_TO, alreadyHadIt: true } });
  });

  it("refuses once the hourly ceiling is reached, and names the address to use instead", async () => {
    await prisma.salesLead.createMany({
      data: Array.from({ length: HOURLY_LEAD_CEILING }, (_unused, index) => ({
        companyId: operatorCompanyId,
        companyName: `Ceiling filler ${index}`,
        email: `ceiling-${index}@example.test`,
        source: "INBOUND" as const,
      })),
    });

    const result = await requestDrawingSetRead(form(VALID));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain(SEND_TO);
    // Nothing new, so the ceiling is a stop rather than a warning.
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(
      HOURLY_LEAD_CEILING,
    );
    expect(await prisma.salesOpportunity.count({ where: { companyId: operatorCompanyId } })).toBe(0);
  });

  it("returns a refusal rather than throwing when there is no operator company", async () => {
    await prisma.company.update({
      where: { id: operatorCompanyId },
      data: { isProvaOperator: false },
    });
    // The control: if some other operator row exists, this test would prove
    // nothing while passing.
    expect(await prisma.company.count({ where: { isProvaOperator: true } })).toBe(0);

    const call = requestDrawingSetRead(form(VALID));

    // A thrown message is REDACTED to a digest in production, so the thing
    // being asserted is that this does not reject at all.
    await expect(call).resolves.toBeDefined();
    const result = await call;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // Still gives them somewhere to send it — this is the one branch where
    // the form cannot take the set at all.
    expect(result.error).toContain(SEND_TO);
    expect(await prisma.salesLead.count()).toBe(0);
  });

  it("refuses when the offer has no intake address, and writes nothing", async () => {
    delete process.env.SUPPORT_EMAIL;

    const result = await requestDrawingSetRead(form(VALID));

    expect(result).toEqual({ ok: false, error: "The free drawing-set read is not open right now." });
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(0);
  });

  it("hands back the band's own sentence for a bad address, and writes nothing", async () => {
    const bad = { ...VALID, email: "marisol at ridgeline" };

    const result = await requestDrawingSetRead(form(bad));

    // Derived from the band rather than retyped: this test's claim is that
    // the band's sentence REACHES the caller, not what the sentence says —
    // `takeoff-offer.test.ts` owns the wording.
    const expected = requestProblem(bad);
    expect(expected, "requestProblem accepted an address it should refuse").toBeTruthy();
    expect(expected).toMatch(/email/i);
    expect(result).toEqual({ ok: false, error: expected });
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(0);
  });

  it("never writes to a company that is not the operator", async () => {
    const result = await requestDrawingSetRead(form(VALID));
    expect(result.ok).toBe(true);

    // The only guard that an unauthenticated endpoint cannot be aimed at a
    // tenant. The FormData carries no companyId, and there is no caller
    // whose company could be adopted, so the operator flag is the whole of
    // the scoping — and this is the assertion that it held.
    expect(await prisma.salesLead.count({ where: { companyId: otherCompanyId } })).toBe(0);
    expect(await prisma.salesOpportunity.count({ where: { companyId: otherCompanyId } })).toBe(0);
    expect(await prisma.salesActivity.count({ where: { companyId: otherCompanyId } })).toBe(0);

    const leads = await prisma.salesLead.findMany();
    expect(leads).toHaveLength(1);
    expect(leads[0].companyId).toBe(operatorCompanyId);
  });
});
