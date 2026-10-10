import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { emailSetupProblem, type EmailSendResult } from "@prova/integrations";
import { deliveryBody, deliverySubjectLine, type DeliveredRead } from "@/lib/takeoff-delivery";
import {
  DEDUPE_WINDOW_HOURS,
  HOURLY_LEAD_CEILING,
  requestNote,
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
 *  - IDEMPOTENCE, AND IT IS NOT "NOTHING WAS WRITTEN". `withinDedupeWindow`
 *    returning true is a decision; what was written is a row count. Those are
 *    different claims, and only the second one is the bug a double-submitted
 *    public form actually causes. Every dedupe case here asserts the COUNTS,
 *    and asserts them FIRST — a return value is only what the action says it
 *    did.
 *
 *    The counts changed, and the change is the point: the dedupe branch used
 *    to write NOTHING, so a sub who submitted twice in a day for two
 *    different projects lost the second project, the second GC and the fact
 *    that a second set was coming. It now suppresses the LEAD and the DEAL
 *    and writes the note. "One lead, two notes" is the shape to look for
 *    below, not "one of everything".
 *
 *  - THAT THE RESPONSE CANNOT TELL THE TWO BRANCHES APART. The payload
 *    carried an `alreadyHadIt` flag, which made this endpoint an
 *    email-enumeration oracle: POST an address, read the flag, learn whether
 *    that contractor is a lead of ours — free and unbounded, because a hit
 *    writes nothing and only misses count against the hourly ceiling. The
 *    test for it compares the two SERIALISED payloads, because a field-by-
 *    field comparison passes just as happily with the flag back in.
 *
 *  - THE OPENING `SalesStageChange`. `sales.prisma` says that model is
 *    written only by the actions that create or move an opportunity, in the
 *    same transaction as the row itself. This action did not, and the cost is
 *    a claim about a READ somewhere else: `longestOpen` and
 *    `trackedOpenCount` filter on `daysInStage !== null`, so every deal this
 *    form created was invisible to the one list on /sales whose job is
 *    surfacing a deal that has gone quiet. A row count is the only thing that
 *    can say the history exists.
 *
 *  - THE INPUT BOUNDS. Every field here arrives on an unauthenticated POST.
 *    That a control character never reaches the database, and that an
 *    over-long field is refused rather than truncated, are both claims about
 *    stored rows — and the NUL case cannot even be asserted in a unit test,
 *    because it is Postgres that refuses to store one.
 *
 *  - CASE-INSENSITIVE MATCHING. `mode: "insensitive"` is executed by
 *    Postgres, not by the application. It typechecks whether or not it
 *    works.
 *
 *  - THE CEILING. `overCeiling` compares a number. Whether the number it is
 *    handed counts the right rows — this company's, INBOUND only, inside the
 *    hour — is a question about a `where` clause.
 *
 * ── THIS FILE NOW COVERS TWO ACTIONS WITH OPPOSITE AUTH RULES ──
 *
 * `sendDrawingSetRead` is the second describe, and it IS authenticated: it
 * mails a finished read back to a prospect, pressed by one of our own people
 * from /sales. Read the describe you are in before copying a line out of
 * either, exactly as the module itself warns.
 *
 * ── `@/lib/auth` WAS THE ONE THING DELIBERATELY NOT MOCKED, AND IT IS NOW
 *    MOCKED AS A GUARD. CORRECTED RATHER THAN LEFT STANDING. ──
 *
 * This paragraph read: "`@/lib/auth`. Every other action dbtest in this
 * directory mocks `requireCompanyContext`, because every other action calls
 * it. This file mocking it would hide the property most worth proving: the
 * action runs to completion with no authenticated caller anywhere." Every
 * word of that was true, and the reasoning is still the reasoning — which is
 * why it is restated below rather than deleted.
 *
 * What changed is that a second action in this module DOES call it, so "not
 * mocked at all" stopped being available. The property survives anyway,
 * because the stand-in THROWS unless a test has signed somebody in and the
 * public-intake describe signs nobody in: add `requireCompanyContext()` to
 * `requestDrawingSetRead` and these tests fail with a sentence naming the
 * mistake, which is strictly louder than the redirect they used to fail with.
 *
 * It is corrected here rather than argued in the mock's own comment because
 * two paragraphs in one file disagreeing about whether something is mocked is
 * how CLAUDE.md's struck preview-database entry sat on `main` contradicting a
 * table a hundred lines above it.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * ── THE AUTH MOCK IS A GUARD, NOT A CONVENIENCE. READ THIS BEFORE CHANGING
 *    IT. ──
 *
 * The header above says `@/lib/auth` is deliberately NOT mocked here,
 * because `requestDrawingSetRead` does not call it and a mock would hide the
 * property most worth proving: that the public action runs to completion with
 * no authenticated caller anywhere.
 *
 * `sendDrawingSetRead` DOES call it, so something has to stand in. A plain
 * `async () => context` would quietly repeal that property — add
 * `requireCompanyContext()` to the public action and every test above would
 * keep passing on the mock.
 *
 * So the stand-in THROWS unless a test has explicitly signed somebody in.
 * `authContext` is null for the whole public-intake describe below, which
 * means the original property is not merely preserved, it is enforced by a
 * sentence naming it: if that action ever starts asking who is calling, those
 * tests fail here rather than passing on a fiction.
 */
type AuthContext = { id: string; role: string; company: { id: string; isProvaOperator: boolean } };
let authContext: AuthContext | null = null;

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => {
    if (!authContext) {
      throw new Error(
        "requireCompanyContext() was called with nobody signed in. If this fired from a " +
          "requestDrawingSetRead test, that action has grown an auth call it must not have — " +
          "see this file's header and the module's own.",
      );
    }
    return authContext;
  },
}));

/**
 * What `deliveredReadFor` answers, scripted per test.
 *
 * Keyed on the exact triple the action is supposed to hand it, so the stub
 * DOES perform the one half of the scoping this action owns: passing the
 * CALLER'S company id through, rather than a company read from an argument.
 * Hand it the wrong company and it answers null exactly as the real query
 * does for a row belonging to somebody else.
 *
 * What this cannot and does not claim: that the real `deliveredReadFor`
 * scopes its two queries correctly. That is a claim about a `where` clause
 * and belongs to that module's own test, the same way this file's header
 * argues the tenant boundary of the public action belongs here. The boundary
 * between the two is drawn on purpose and stated so nobody reads the
 * cross-company test below as more than it is.
 */
const reads = new Map<string, DeliveredRead>();
let deliveredReadCalls: Array<{ leadId: string; planId: string; companyId: string }> = [];

vi.mock("@/lib/drawing-set-read-query", () => ({
  deliveredReadFor: async (leadId: string, planId: string, companyId: string) => {
    deliveredReadCalls.push({ leadId, planId, companyId });
    return reads.get(`${leadId}|${planId}|${companyId}`) ?? null;
  },
}));

/** The mail send, stubbed. No network call is made from this suite — and a
 *  default that THROWS rather than succeeding means a test that forgot to
 *  script an outcome fails instead of silently "sending". */
let sendResult: EmailSendResult | null = null;
let sendCalls: Array<{ to: string; toName?: string | null; subject: string; text: string }> = [];

vi.mock("@prova/integrations", async (importOriginal) => ({
  // `emailSetupProblem` stays REAL, which is the point of spreading the
  // original rather than replacing the module: the unconfigured test below
  // has to exercise the same function the action and the page both read, or
  // it proves nothing about whether the two can disagree.
  ...(await importOriginal<typeof import("@prova/integrations")>()),
  sendEmail: async (request: { to: string; toName?: string | null; subject: string; text: string }) => {
    sendCalls.push(request);
    if (!sendResult) throw new Error("a test called sendEmail without scripting a result");
    return sendResult;
  },
}));

/** The intake address the offer is open on. `offerIntakeAddress()` reads
 *  `process.env.SUPPORT_EMAIL` at CALL time, so setting it here is enough —
 *  no module mock, and the real validation runs. */
const SEND_TO = "takeoffs@prova-dbtest.test";
let previousSupportEmail: string | undefined;

const { requestDrawingSetRead, sendDrawingSetRead } = await import("./takeoffOffer");

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

/**
 * THE TWO COMPANIES ARE CREATED AND DELETED AT FILE LEVEL, not inside either
 * describe, and that is a correction rather than a style choice.
 *
 * They used to be born and buried in the public-intake describe's own
 * `beforeAll`/`afterAll`. Vitest runs a describe's `afterAll` before the next
 * describe's `beforeAll`, so the moment a SECOND describe was added to this
 * file it began running against two companies that had just been deleted —
 * and its fixture would have failed on a foreign key rather than on anything
 * about the code. Hoisting them is what makes both describes see the same
 * fixture; nothing about the first describe's assertions changed.
 */
beforeAll(async () => {
  const operator = await prisma.company.create({
    data: { name: "Prova (operator, takeoff offer dbtest)", isProvaOperator: true },
  });
  operatorCompanyId = operator.id;

  const other = await prisma.company.create({
    data: { name: "Ordinary Tenant (takeoff offer dbtest)", isProvaOperator: false },
  });
  otherCompanyId = other.id;

  // A control on the fixture itself, not on the code. `requestDrawingSetRead`
  // resolves its target with an UNSCOPED `findFirst({ isProvaOperator: true })`,
  // so a stray operator row left behind by another file would make every
  // assertion in the first describe about the wrong company — and it would
  // still pass.
  expect(
    await prisma.company.count({ where: { isProvaOperator: true } }),
    "another operator company exists in the scratch database; the fixture cannot be trusted",
  ).toBe(1);
});

afterAll(async () => {
  await prisma.company.deleteMany({
    where: { id: { in: [operatorCompanyId, otherCompanyId] } },
  });
});

async function clearSalesRows() {
  const companyId = { in: [operatorCompanyId, otherCompanyId] };
  // Activities first, then opportunities, then leads: SalesActivity.leadId
  // and SalesOpportunity.leadId are both RESTRICT.
  //
  // SalesStageChange is deliberately absent and that is not an omission:
  // `sales.prisma` declares its opportunity relation `onDelete: Cascade`, so
  // the opportunity delete takes its history with it. A redundant deleteMany
  // here would pass whether or not that is true, which is the kind of
  // reassurance this suite has no use for — the stage-change COUNT is
  // asserted to be zero at the start of the test that cares.
  await prisma.salesActivity.deleteMany({ where: { companyId } });
  await prisma.salesOpportunity.deleteMany({ where: { companyId } });
  await prisma.salesLead.deleteMany({ where: { companyId } });
}

describe("requestDrawingSetRead — the public /wall-takeoff intake", () => {
  beforeAll(() => {
    previousSupportEmail = process.env.SUPPORT_EMAIL;
    process.env.SUPPORT_EMAIL = SEND_TO;
  });

  afterAll(async () => {
    await clearSalesRows();
    if (previousSupportEmail === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = previousSupportEmail;
  });

  beforeEach(async () => {
    // Every test starts from zero leads, so a row count is an exact claim
    // rather than a delta — and so the hourly ceiling cannot be tripped by
    // an earlier test's rows.
    process.env.SUPPORT_EMAIL = SEND_TO;
    // Nobody is signed in for any test in this describe, and the mock above
    // turns that into an assertion rather than an absence.
    authContext = null;
    await prisma.company.update({
      where: { id: operatorCompanyId },
      data: { isProvaOperator: true },
    });
    await clearSalesRows();
  });

  it("creates a lead, an opportunity, its opening stage record and a NOTE activity on the operator company", async () => {
    // The write set is FOUR rows and the test name says so. It said three
    // until the stage record was found missing, and a test named after a
    // wrong write set is how a missing row stays missing.
    const result = await requestDrawingSetRead(form(VALID));

    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO } });

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

    // THE OPENING STAGE RECORD. `sales.prisma` says this model is written
    // only by the actions that create or move an opportunity, in the same
    // transaction as the row itself — so an opportunity without one is a
    // broken invariant rather than a missing nicety. The cost is specific and
    // is why this is asserted here rather than left to /sales: `longestOpen`
    // and `trackedOpenCount` in `lib/sales-pipeline.ts` both filter on
    // `daysInStage !== null`, which is derived from this history, so a deal
    // with none is invisible to the one read that surfaces a neglected deal.
    const changes = await prisma.salesStageChange.findMany({
      where: { opportunityId: opportunities[0].id },
    });
    expect(changes).toHaveLength(1);
    // Null because the deal did not come from anywhere — it started here.
    // This is the field `SalesOpportunityRow` reads as "stage not recorded"
    // when the row is absent entirely.
    expect(changes[0].fromStage).toBeNull();
    expect(changes[0].toStage).toBe("NEW");
    expect(changes[0].companyId).toBe(operatorCompanyId);
    // No user recorded this; a public form did. The column is nullable for
    // exactly that case, the same as the activity's `loggedByUserId` below.
    expect(changes[0].recordedByUserId).toBeNull();
    expect(changes[0].effectiveOn.toISOString()).toMatch(/T00:00:00\.000Z$/);

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
    // ONE date for the whole request: the day it arrived is the day the deal
    // reached NEW and the day of the note. Two different days on rows written
    // in one transaction would be two different answers to one question.
    expect(changes[0].effectiveOn.toISOString()).toBe(activities[0].occurredOn.toISOString());
  });

  it("answers a repeat with a byte-identical response, so the endpoint is not an address oracle", async () => {
    const first = await requestDrawingSetRead(form(VALID));
    const second = await requestDrawingSetRead(form(VALID));

    // THE POINT OF THIS TEST, and the reason it compares SERIALISED payloads
    // rather than fields: the defect was a flag in the response saying which
    // branch ran, so anyone could POST an address and learn whether that
    // contractor is a lead of ours. A field-by-field `toEqual` of the two
    // results would pass just as happily with the flag back in, as long as
    // both carried one. `JSON.stringify` compares the whole shape, so an
    // added key or a differing value both fail here.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).toEqual({ ok: true, value: { sendTo: SEND_TO } });

    // NOT VACUOUS, which this comparison is in real danger of being: two
    // identical REFUSALS would satisfy the line above. So both halves are
    // pinned — the first submit really did write, and the second really was
    // deduped — and only then is "and they look the same" worth anything.
    expect(first.ok).toBe(true);
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(await prisma.salesActivity.count({ where: { companyId: operatorCompanyId } })).toBe(2);
  });

  it("writes a second submit as a NOTE on the existing lead, and creates no second lead or deal", async () => {
    expect((await requestDrawingSetRead(form(VALID))).ok).toBe(true);
    const leads = await prisma.salesLead.findMany({ where: { companyId: operatorCompanyId } });
    expect(leads).toHaveLength(1);
    const opportunities = await prisma.salesOpportunity.findMany({ where: { leadId: leads[0].id } });
    expect(opportunities).toHaveLength(1);

    // A DIFFERENT PROJECT AND A DIFFERENT GC, which is the whole case. A sub
    // bidding four jobs this week submits Monday morning for one and Monday
    // afternoon for another; the address is the same and nothing else is.
    // `SalesLead` has no project, GC or trade column, so this second request
    // exists only in the note — and the note was never written.
    const SECOND: OfferRequest = {
      ...VALID,
      projectName: "Civic Center Annex",
      gcName: "Swinerton",
      trade: "CEILINGS",
    };
    const second = await requestDrawingSetRead(form(SECOND));

    // THE ROW COUNTS FIRST, deliberately. "It said it deduped" and "what it
    // wrote" are different claims and only the second one is the bug — so the
    // counts are the assertions that must be the ones to fire. Asserting the
    // return value first put a mutation's failure there and left the counts
    // unexecuted, which is a count assertion nothing has proved.
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(await prisma.salesOpportunity.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    // No second opening record either: the deal did not reopen, it was never
    // created again.
    expect(await prisma.salesStageChange.count({ where: { companyId: operatorCompanyId } })).toBe(1);

    const activities = await prisma.salesActivity.findMany({
      where: { companyId: operatorCompanyId },
    });
    expect(activities).toHaveLength(2);
    // Found by content rather than by `createdAt` order: both rows are
    // written within a millisecond of each other, so an ordered read is a
    // coin toss and a test that flakes gets deleted rather than read.
    const repeat = activities.filter((a) => a.summary.includes(SECOND.projectName));
    expect(repeat).toHaveLength(1);
    expect(repeat[0].type).toBe("NOTE");
    expect(repeat[0].leadId).toBe(leads[0].id);
    // Attached to the deal that already exists, because /sales reads
    // activities per opportunity and an unattached one is invisible there.
    expect(repeat[0].opportunityId).toBe(opportunities[0].id);
    expect(repeat[0].loggedByUserId).toBeNull();
    expect(repeat[0].followUpOn).toBeNull();
    expect(repeat[0].occurredOn.toISOString()).toMatch(/T00:00:00\.000Z$/);
    // THE WHOLE NOTE, derived from the band rather than retyped: the claim is
    // that nothing the contractor typed was dropped, and `requestNote` is
    // what decides what that is.
    expect(repeat[0].summary).toContain(requestNote(SECOND));
    expect(repeat[0].summary).toContain("Swinerton");
    expect(repeat[0].summary).toContain("Acoustical ceilings");
    // And says which branch wrote it, with the window's own length, so two
    // notes a few hours apart do not read as a double write. Derived from the
    // constant that decides the rule.
    expect(repeat[0].summary).toContain(`within ${DEDUPE_WINDOW_HOURS} hours`);
    // The first note is still the first note — nothing was overwritten.
    const original = activities.filter((a) => a.id !== repeat[0].id);
    expect(original).toHaveLength(1);
    expect(original[0].summary).toContain(VALID.projectName);
    expect(original[0].summary).not.toContain(SECOND.projectName);

    expect(second).toEqual({ ok: true, value: { sendTo: SEND_TO } });
  });

  it("does not read a first request as a repeat because of a lead we typed in ourselves", async () => {
    // A cold call the operator logged by hand, same address, OUTBOUND. The
    // dedupe lookup was not scoped by source, so this row made a contractor's
    // genuine FIRST request look like a duplicate: no lead, no deal, and
    // nobody on our side ever learning they had asked.
    await prisma.salesLead.create({
      data: {
        companyId: operatorCompanyId,
        companyName: VALID.companyName,
        email: VALID.email,
        source: "OUTBOUND",
      },
    });

    const result = await requestDrawingSetRead(form(VALID));

    // Counts first, and both of them: two leads in total, exactly one of
    // which is this form's.
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(2);
    const inbound = await prisma.salesLead.findMany({
      where: { companyId: operatorCompanyId, source: "INBOUND" },
    });
    expect(inbound).toHaveLength(1);
    expect(await prisma.salesOpportunity.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    expect(await prisma.salesStageChange.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    // The note hangs off the lead this form created, not the hand-entered one.
    const activities = await prisma.salesActivity.findMany({
      where: { companyId: operatorCompanyId },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].leadId).toBe(inbound[0].id);
    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO } });
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

    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(2);
    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO } });
  });

  it("matches the address regardless of case", async () => {
    expect(
      (await requestDrawingSetRead(form({ ...VALID, email: "Marisol.Vega@Ridgeline-Drywall.TEST" }))).ok,
    ).toBe(true);

    const second = await requestDrawingSetRead(
      form({ ...VALID, email: "marisol.vega@ridgeline-drywall.test" }),
    );

    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(1);
    // One lead and TWO notes: the case-insensitive match deduped the lead and
    // kept what the second submit said.
    expect(await prisma.salesActivity.count({ where: { companyId: operatorCompanyId } })).toBe(2);
    expect(second).toEqual({ ok: true, value: { sendTo: SEND_TO } });
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
    expect(await prisma.salesStageChange.count({ where: { companyId: operatorCompanyId } })).toBe(0);
    expect(await prisma.salesActivity.count({ where: { companyId: operatorCompanyId } })).toBe(0);
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
    expect(await prisma.salesStageChange.count({ where: { companyId: otherCompanyId } })).toBe(0);
    expect(await prisma.salesActivity.count({ where: { companyId: otherCompanyId } })).toBe(0);

    const leads = await prisma.salesLead.findMany();
    expect(leads).toHaveLength(1);
    expect(leads[0].companyId).toBe(operatorCompanyId);
  });

  /**
   * ── THE INPUT BOUNDS, AND WHY THE NUMBERS ARE TYPED OUT HERE ──
   *
   * `FIELD_LIMITS` is not exported and cannot be: `takeoffOffer.ts` is a
   * `"use server"` module, where every export must be an async function, so a
   * shared constant would fail the build rather than merely be untidy. So
   * these two tests pin the BOUNDARY from both sides — the longest accepted
   * value and the shortest refused one — which is a stronger claim than one
   * comparison against a number imported from the thing under test, and the
   * action's own sentence names the limit so a drift fails here readably
   * instead of silently.
   */
  it("accepts a company name at the cap and refuses the next character, by name, writing nothing", async () => {
    const atCap = { ...VALID, companyName: "R".repeat(160) };
    expect((await requestDrawingSetRead(form(atCap))).ok).toBe(true);
    const leads = await prisma.salesLead.findMany({ where: { companyId: operatorCompanyId } });
    expect(leads).toHaveLength(1);
    expect(leads[0].companyName).toHaveLength(160);

    await clearSalesRows();
    const overCap = { ...VALID, companyName: "R".repeat(161) };

    const result = await requestDrawingSetRead(form(overCap));

    // COUNT FIRST. The refusal sentence is the smaller half: the claim that
    // matters is that an unauthenticated POST cannot write a row of any size
    // it likes.
    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(0);
    expect(await prisma.salesActivity.count({ where: { companyId: operatorCompanyId } })).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // REFUSED, NOT TRUNCATED, and the sentence has to say which field and how
    // short: the form clears nothing on a failure, so this arrives over what
    // they typed and shortening it is one edit. A truncated company name
    // would be a lead quietly about somebody slightly else.
    expect(result.error).toMatch(/company name is too long/i);
    expect(result.error).toContain("160");
  });

  it("refuses every other over-long field by its own name", async () => {
    // One field per case, each one character over, so a pass cannot come from
    // a different field being wrong. The labels are the contractor's words
    // for the fields, not the column names.
    const cases: { field: keyof OfferRequest; length: number; names: RegExp }[] = [
      { field: "contactName", length: 121, names: /name is too long/i },
      { field: "phone", length: 41, names: /phone number is too long/i },
      { field: "projectName", length: 201, names: /project name is too long/i },
      { field: "gcName", length: 161, names: /general contractor is too long/i },
    ];
    for (const { field, length, names } of cases) {
      await clearSalesRows();
      const result = await requestDrawingSetRead(form({ ...VALID, [field]: "x".repeat(length) }));

      expect(
        await prisma.salesLead.count({ where: { companyId: operatorCompanyId } }),
        `an over-long ${field} was written rather than refused`,
      ).toBe(0);
      expect(result.ok, `an over-long ${field} was accepted`).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error).toMatch(names);
    }
  });

  it("strips control characters rather than storing them, so a field cannot forge a line in the mail", async () => {
    // The company name is the attack: `lib/takeoff-delivery.ts` renders a
    // plain-text body one fact per line, so a newline here plants a line that
    // reads as ours. The NUL in the project name is the other half — Postgres
    // cannot store one at all, so an unstripped value fails the write rather
    // than the assertion, which is exactly the kind of guard worth having.
    const dirty: OfferRequest = {
      ...VALID,
      companyName: "Ridgeline Drywall\r\nFrom: Prova <office@prova.test>",
      contactName: "Marisol\tVega",
      projectName: "Sunset\u0000MOB",
      gcName: "Harker\u2028Construction",
    };

    const result = await requestDrawingSetRead(form(dirty));

    expect(result).toEqual({ ok: true, value: { sendTo: SEND_TO } });
    const leads = await prisma.salesLead.findMany({ where: { companyId: operatorCompanyId } });
    expect(leads).toHaveLength(1);
    // Replaced with a SPACE and collapsed, not deleted: "Acme\nDrywall" must
    // not become "AcmeDrywall".
    expect(leads[0].companyName).toBe("Ridgeline Drywall From: Prova <office@prova.test>");
    expect(leads[0].companyName).not.toMatch(/[\r\n]/);
    expect(leads[0].contactName).toBe("Marisol Vega");

    const activities = await prisma.salesActivity.findMany({
      where: { companyId: operatorCompanyId },
    });
    expect(activities).toHaveLength(1);
    // The note is multi-line by construction — `requestNote` joins its lines
    // with newlines — so the claim is about the FIELDS inside it, each of
    // which must occupy exactly one line of it.
    expect(activities[0].summary).toContain("Project: Sunset MOB");
    expect(activities[0].summary).toContain("GC: Harker Construction");
    expect(activities[0].summary).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("refuses an address with a line break in it, and writes nothing", async () => {
    // Stripping turns the break into a space, and a space in an address is
    // what `looksLikeEmailAddress` already refuses — so this needs no new
    // rule, and the test is here to prove the two compose rather than to
    // introduce a third.
    const result = await requestDrawingSetRead(form({ ...VALID, email: "mar\nisol@ridgeline.test" }));

    expect(await prisma.salesLead.count({ where: { companyId: operatorCompanyId } })).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toMatch(/email/i);
  });
});

/**
 * `sendDrawingSetRead` against a real Postgres.
 *
 * ── WHAT ONLY A DATABASE CAN ANSWER HERE, AND IT IS ONE QUESTION ──
 *
 * Whether an EMAIL activity row EXISTS. Five of the eight tests below are
 * about a send that did not happen, and in every one of them the claim worth
 * making is not what the action returned — it is that nothing was written. An
 * EMAIL activity is an evidence record of correspondence we sent a prospect;
 * one written on a send that failed is a lie the next person reading the lead
 * has no way to detect, and they would ring somebody believing they had
 * already been written to.
 *
 * `sent: false` and "no row" are DIFFERENT CLAIMS, and only the second one is
 * that defect. So every negative test below asserts the ROW COUNT, and
 * asserts it BEFORE the return value — the same ordering this file's dedupe
 * test already argues for, and for the same reason: put the count second and
 * a mutation fails on the return value first, leaving the count assertion
 * unexecuted and therefore unproved.
 *
 * ── WHAT IS STUBBED AND WHY EACH ONE HAD TO BE ──
 *
 * The mail send, because this suite makes no network call and because the
 * provider's three failure shapes (refused, unreachable, accepted-with-no-id)
 * cannot be provoked from a real one on demand. `emailSetupProblem` is NOT
 * stubbed — see the module mock above.
 *
 * `deliveredReadFor`, because it belongs to another module and another agent;
 * its own scoping is its own test's claim. The stub is keyed on the full
 * triple so the one half of the boundary THIS action owns — handing the
 * CALLER'S company id through rather than anything reachable from an argument
 * — is still a real assertion here.
 *
 * ── WHAT IS NOT STUBBED, DELIBERATELY ──
 *
 * The composition. `deliverySubjectLine` and `deliveryBody` run for real on a
 * real `DeliveredRead`, because the thing being proved is that this action is
 * the CALL SITE of a module that had 44 passing tests and nothing calling it.
 * A stubbed composer would leave that exactly as dead as it was. The expected
 * strings below are therefore DERIVED from those functions rather than typed
 * out: a literal here would be the second copy of the email text the delivery
 * module's own header forbids.
 */

/** One readable sheet and one scan, which is the smallest set that makes
 *  `deliveryBody` exercise both its gap section and its index — so "a
 *  non-empty body" is a real body rather than a one-line stub. */
const READ: DeliveredRead = {
  subject: {
    companyName: "Ridgeline Drywall",
    contactName: "Marisol Vega",
    projectName: "Sunset Medical Office Building",
    fileName: "Sunset MOB — Bid Set.pdf",
  },
  sheets: [
    {
      pageNumber: 1,
      hasTextLayer: true,
      proposal: {
        id: "prop-1",
        sheetNumber: "A-101",
        title: "First Floor Plan",
        discipline: "Architectural",
        pageType: "PLAN",
        scale: '1/8" = 1\'-0"',
        revision: null,
        issueDate: null,
        reason: "title block read",
        confidence: "HIGH",
        status: "PROPOSED",
        acceptedSheetNumber: null,
        acceptedTitle: null,
      },
    },
    { pageNumber: 2, hasTextLayer: false, proposal: null },
  ],
  schedules: [],
};

const PLAN_ID = "takeoff-plan-dbtest-1";

/** The operator's owner, who is the only person this action answers. */
let ownerUserId = "";
/** A member at the same operator company — the non-owner refusal. */
let memberUserId = "";
/** Somebody at an ordinary tenant — the non-operator refusal. */
let outsiderUserId = "";

let previousResendKey: string | undefined;
let previousOutboundFrom: string | undefined;

describe("sendDrawingSetRead — mailing the finished read back", () => {
  let leadId = "";

  beforeAll(async () => {
    previousResendKey = process.env.RESEND_API_KEY;
    previousOutboundFrom = process.env.OUTBOUND_EMAIL_FROM;

    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        companyId: operatorCompanyId,
        clerkId: `tko_owner_${stamp}`,
        email: `tko_owner_${stamp}@example.test`,
        role: "OWNER",
      },
    });
    ownerUserId = owner.id;
    const member = await prisma.user.create({
      data: {
        companyId: operatorCompanyId,
        clerkId: `tko_member_${stamp}`,
        email: `tko_member_${stamp}@example.test`,
        role: "MEMBER",
      },
    });
    memberUserId = member.id;
    const outsider = await prisma.user.create({
      data: {
        companyId: otherCompanyId,
        clerkId: `tko_outsider_${stamp}`,
        email: `tko_outsider_${stamp}@example.test`,
        role: "OWNER",
      },
    });
    outsiderUserId = outsider.id;
  });

  afterAll(async () => {
    await prisma.salesActivity.deleteMany({
      where: { companyId: { in: [operatorCompanyId, otherCompanyId] } },
    });
    await prisma.salesLead.deleteMany({
      where: { companyId: { in: [operatorCompanyId, otherCompanyId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUserId, memberUserId, outsiderUserId] } },
    });
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
    if (previousOutboundFrom === undefined) delete process.env.OUTBOUND_EMAIL_FROM;
    else process.env.OUTBOUND_EMAIL_FROM = previousOutboundFrom;
  });

  beforeEach(async () => {
    await clearSalesRows();

    const lead = await prisma.salesLead.create({
      data: {
        companyId: operatorCompanyId,
        companyName: READ.subject.companyName,
        contactName: READ.subject.contactName,
        email: "marisol@ridgeline-drywall.test",
        source: "INBOUND",
      },
    });
    leadId = lead.id;

    // The signed-in caller, the scripted read, and a configured mail
    // provider — the happy path. Every test below changes exactly ONE of
    // these, so a test about one rule cannot be passing because a different
    // one is wrong. Same discipline as VALID above.
    authContext = {
      id: ownerUserId,
      role: "OWNER",
      company: { id: operatorCompanyId, isProvaOperator: true },
    };
    reads.clear();
    reads.set(`${leadId}|${PLAN_ID}|${operatorCompanyId}`, READ);
    deliveredReadCalls = [];
    sendCalls = [];
    sendResult = { ok: true, providerMessageId: "msg_dbtest_1", from: "office@prova.test" };
    process.env.RESEND_API_KEY = "re_dbtest_key";
    process.env.OUTBOUND_EMAIL_FROM = "office@prova.test";
  });

  /** Every negative test asks this, and it is the assertion that matters
   *  most in the file. */
  async function emailActivityCount() {
    return prisma.salesActivity.count({
      where: { companyId: operatorCompanyId, leadId, type: "EMAIL" },
    });
  }

  it("returns the refusal rather than throwing it when the caller is not the operator company", async () => {
    authContext = {
      id: outsiderUserId,
      role: "OWNER",
      company: { id: otherCompanyId, isProvaOperator: false },
    };

    const call = sendDrawingSetRead(leadId, PLAN_ID);

    // A thrown message is REDACTED to a digest in production, so the thing
    // being asserted first is that this does not reject at all. `.resolves`
    // rather than a try/catch: a try/catch that never catches passes whether
    // or not the promise rejected.
    await expect(call).resolves.toBeDefined();
    const result = await call;
    // "Not found", not an authorization message — the feature does not exist
    // for them, and `sales.ts`'s own gate says why saying more would be a
    // stranger lie than silence.
    expect(result).toEqual({ ok: false, error: "Not found" });
    expect(await prisma.salesActivity.count()).toBe(0);
    // Refused BEFORE either row was looked at, so a non-operator cannot use
    // this action to learn whether a lead id exists.
    expect(deliveredReadCalls).toEqual([]);
    expect(sendCalls).toEqual([]);
  });

  it("returns the refusal rather than throwing it when the caller is not the owner", async () => {
    authContext = {
      id: memberUserId,
      role: "MEMBER",
      company: { id: operatorCompanyId, isProvaOperator: true },
    };

    const call = sendDrawingSetRead(leadId, PLAN_ID);

    await expect(call).resolves.toBeDefined();
    const result = await call;
    expect(result).toEqual({
      ok: false,
      error: "Only the account owner can use the sales CRM",
    });
    expect(await prisma.salesActivity.count()).toBe(0);
    expect(deliveredReadCalls).toEqual([]);
    expect(sendCalls).toEqual([]);
  });

  it("hands back the composed read with a problem, and writes nothing, when the lead has no address", async () => {
    await prisma.salesLead.update({ where: { id: leadId }, data: { email: null } });

    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    // COUNT FIRST. "It said it did not send" and "it wrote no activity" are
    // different claims and only the second is the false-evidence bug.
    expect(await emailActivityCount()).toBe(0);
    expect(sendCalls).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read back");
    expect(result.value.sent).toBe(false);
    expect(result.value.problem).toBeTruthy();
    expect(result.value.problem).toMatch(/no email address/i);
    // The valuable half survived the failure — this is the whole reason the
    // branch returns ok at all.
    expect(result.value.body.length).toBeGreaterThan(0);
    expect(result.value.body).toBe(deliveryBody(READ));
    expect(result.value.subject).toBe(deliverySubjectLine(READ));
  });

  it("hands back the composed read with the setup sentence, and writes nothing, when sending is not set up", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.OUTBOUND_EMAIL_FROM;

    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    expect(await emailActivityCount()).toBe(0);
    // Refused BEFORE the provider was reached, not after it failed: an
    // install with no provider is a state the screen can state, and the
    // action and the page agree about it only because both read
    // `emailSetupProblem()`.
    expect(sendCalls).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read back");
    expect(result.value.sent).toBe(false);
    // DERIVED from the same function the action reads rather than retyped.
    // The claim here is that the sentence REACHES the caller; `email.ts` owns
    // the wording, and a literal copy would go stale the day it changes.
    const expected = emailSetupProblem();
    expect(expected, "emailSetupProblem() returned null with no key and no from address").toBeTruthy();
    expect(result.value.problem).toBe(expected);
    expect(result.value.body).toBe(deliveryBody(READ));
  });

  it("hands back the provider's own sentence, and writes nothing, when the provider refuses it", async () => {
    sendResult = { ok: false, error: "The domain prova.test is not verified", configured: true };

    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    expect(await emailActivityCount()).toBe(0);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read back");
    expect(result.value.sent).toBe(false);
    // Verbatim, with nothing appended: this is the branch where we know it
    // did not go.
    expect(result.value.problem).toBe("The domain prova.test is not verified");
    expect(result.value.body).toBe(deliveryBody(READ));
  });

  it("records exactly one annotated activity when the provider accepted it without a message id", async () => {
    sendResult = {
      ok: false,
      error: "The provider accepted this but returned no message id",
      configured: true,
      mayHaveSent: true,
    };

    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    // ONE ROW, AND THIS TEST ASSERTED ZERO. Its comment read "we cannot
    // record a send we cannot confirm", which is the right instinct pointed
    // the wrong way: `email.ts` sets `mayHaveSent` only when the provider
    // ANSWERED 2XX, and says in as many words that "the mail has almost
    // certainly gone". Writing nothing left real correspondence with a
    // prospect unrecorded and re-enabled the button — and the operator's
    // obvious next move sends a second cold email to a stranger.
    // `lib/actions/messages.ts` and `lib/notification-dispatch.ts` had both
    // already decided this: "recording that as failed invites a second copy".
    expect(await emailActivityCount()).toBe(1);
    const activities = await prisma.salesActivity.findMany({
      where: { companyId: operatorCompanyId, leadId, type: "EMAIL" },
    });
    expect(activities).toHaveLength(1);
    // The same first sentence as a confirmed send — what was sent, which file,
    // to whom — because the record of the correspondence does not change with
    // the provider's bookkeeping.
    expect(activities[0].summary).toContain("drawing-set read");
    expect(activities[0].summary).toContain(READ.subject.fileName ?? "");
    expect(activities[0].summary).toContain("marisol@ridgeline-drywall.test");
    // AND THE WARNING, which is the half a return value cannot deliver: the
    // operator reading this lead next week gets what the screen said.
    expect(activities[0].summary).toMatch(/no message id/i);
    expect(activities[0].summary).toMatch(/do not send it again/i);
    expect(activities[0].loggedByUserId).toBe(ownerUserId);
    expect(activities[0].occurredOn.toISOString()).toMatch(/T00:00:00\.000Z$/);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the read back");
    // NOT REPORTED AS A CLEAN SEND. The row exists and `sent` is still false:
    // there is no id to track this by, so the screen must not render it as
    // confirmed.
    expect(result.value.sent).toBe(false);
    // The provider's reason is still there, AND the sentence distinguishes
    // this from the branch above. "It did not go" and "it may already have
    // gone" are different things to tell somebody about to press send again
    // at a prospect who has never heard of us.
    expect(result.value.problem).toContain("returned no message id");
    expect(result.value.problem).toMatch(/may already have reached them/i);
  });

  it("sends the composed read and records exactly one EMAIL activity", async () => {
    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a send");
    expect(result.value).toEqual({
      sent: true,
      subject: deliverySubjectLine(READ),
      body: deliveryBody(READ),
      problem: null,
    });

    // The lead's own address and name, and the delivery module's own text —
    // not a second copy composed here.
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].to).toBe("marisol@ridgeline-drywall.test");
    expect(sendCalls[0].toName).toBe(READ.subject.contactName);
    expect(sendCalls[0].subject).toBe(deliverySubjectLine(READ));
    expect(sendCalls[0].text).toBe(deliveryBody(READ));

    // EXACTLY ONE, and scoped to this lead. A second row is as wrong as none:
    // the activity list is read as a record of how often we contacted them.
    const activities = await prisma.salesActivity.findMany({
      where: { companyId: operatorCompanyId, leadId },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("EMAIL");
    // Derived from the send rather than entered, and stored at UTC midnight
    // like every other date in this app.
    //
    // The action takes that day from `viewerAsOf()` — the OPERATOR'S calendar
    // day, not the server's, which `viewerDayCensus.test.ts` fails the build
    // over and which caught the first version of this line. The two agree
    // here for a reason worth stating rather than relying on: a dbtest runs
    // with no request around it, `viewerTimeZone()` catches the throw from
    // `cookies()`, and its documented floor is UTC. So this comparison
    // against today's UTC date is still an INDEPENDENT check of the value —
    // deliberately not re-derived from `viewerAsOf()`, which would agree with
    // a wrong answer as readily as a right one.
    expect(activities[0].occurredOn.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(activities[0].occurredOn.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
    // Says what was sent and which file it was about — a lead can be sent
    // more than one read.
    expect(activities[0].summary).toContain("drawing-set read");
    expect(activities[0].summary).toContain(READ.subject.fileName ?? "");
    expect(activities[0].summary).toContain("marisol@ridgeline-drywall.test");
    // Who pressed send is audit, not content. Unlike the public intake above,
    // there IS a user here.
    expect(activities[0].loggedByUserId).toBe(ownerUserId);
    expect(activities[0].followUpOn).toBeNull();
  });

  it("refuses, and writes nothing, when the plan belongs to another company", async () => {
    // The real `deliveredReadFor` answers null when either row belongs to
    // somebody else. Scripted here by giving the stub a read registered
    // against the OTHER company's id — so the action asks for the operator's
    // and gets nothing, which is precisely what it would get from the real
    // query for another tenant's plan.
    reads.clear();
    reads.set(`${leadId}|${PLAN_ID}|${otherCompanyId}`, READ);

    const result = await sendDrawingSetRead(leadId, PLAN_ID);

    expect(await prisma.salesActivity.count()).toBe(0);
    expect(sendCalls).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // One sentence for both halves on purpose: naming which of the two was
    // not found would turn a guessed id into a membership oracle over
    // another tenant's leads and files.
    expect(result.error).toBe("We could not find that lead and drawing set together.");
    expect(result.error).not.toContain(PLAN_ID);
    expect(result.error).not.toContain(leadId);

    // THE HALF OF THE BOUNDARY THIS ACTION OWNS: the company it asked about
    // is the CALLER'S, taken from the session and never from an argument.
    // Get this wrong and the query module's own scoping is handed the wrong
    // company and answers correctly about the wrong tenant.
    expect(deliveredReadCalls).toEqual([
      { leadId, planId: PLAN_ID, companyId: operatorCompanyId },
    ]);
  });
});
