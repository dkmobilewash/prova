import { prisma } from "@prova/db";
import type { PersonaKey } from "./personas";
import { E2E_TAG } from "./tag";
import {
  PIPELINE_LEAD_NAME,
  PIPELINE_OPPORTUNITIES,
  RESEARCHED_LEAD_NAME,
  RESEARCHED_LEAD_SIGNALS,
  SALES_COMPANY_NAME,
  SALES_OWNER_NAME,
} from "./salesFixture";

/** The marker every row this suite writes carries in its name. It LIVES in
 * `./tag.ts` now and is re-exported here so the four specs that import it from
 * this module keep working — see that file for why it had to move (this one
 * imports `@prova/db`, and `salesFixture.ts` must be readable without a
 * database). */
export { E2E_TAG };

type ClerkIds = Record<PersonaKey, { id: string; email: string }>;

/**
 * MAIN is an ESTABLISHED account, so it has already been asked the
 * onboarding questions. Without this, `/dashboard` sends MAIN's OWNER to
 * `/welcome` (lib/onboarding-gate.ts: OWNER + `businessScopeAskedAt` null),
 * which is outside the app shell: no Topbar, no Help button, no Ask
 * launcher, no nav rail. Every spec that opened `/dashboard` as MAIN and
 * then looked for one of those (ask-panel, ask-panel.mobile, tour and
 * money-rail-gate's OWNER control) was failing on the wrong screen rather
 * than on anything about the feature it names. money-rail-gate is the
 * worst of them: its OWNER test is the POSITIVE control, so with it dead
 * only the negative test ran, and "FIELD sees no dollar figure" passed
 * without anything showing that a figure can render at all.
 *
 * Deliberately NOT set on EMPTY, JOB_CREATE, JOURNEY or BAD_INPUTS. Those
 * companies are created by the app's own first-sign-in path, and they are
 * meant to be brand new, so they get the gate a real new customer gets.
 * journey.ts's `landOnDashboard` walks through it for that reason. FIELD
 * needs nothing: it is a MEMBER, and a MEMBER is never gated.
 *
 * A fixed instant, not `new Date()`: the value says "asked once, long ago",
 * and a date that moves on every run is a date nobody can reason about.
 */
export const ESTABLISHED_ACCOUNT_ASKED_AT = new Date("2026-01-01T00:00:00.000Z");

/**
 * Pre-seeds the three personas that need to exist BEFORE any spec's first
 * navigation: MAIN (an established company, already past the onboarding
 * questions, with one contact and one job, so job-detail,
 * schedule, ask-panel, the tour and settings/import all have something to
 * show without racing another spec that creates it) and FIELD (a second
 * User inside MAIN's company, so the money-rail invariant has a
 * field-function viewer to sign in as).
 *
 * And SALES, which is a different kind of fixture from either: its company
 * carries `Company.isProvaOperator`, the flag `/sales` and `/sales/[id]` are
 * gated on. That flag cannot be obtained through any screen in this product —
 * there is no UI that sets it — so a browser can only reach Prova's own
 * outbound channel if the seed puts it there. See `seedSalesOperator` below and
 * `lib/salesFixture.ts`.
 *
 * EMPTY and JOB_CREATE are deliberately NOT seeded here. Their whole point
 * is the company `adoptCompanyContext` (apps/web/lib/auth.ts) creates on
 * first sign-in — pre-creating them here would just be reimplementing that
 * path badly. The first spec to sign in as either one gets a brand-new,
 * genuinely empty company from the app's own code, the same way a real
 * new customer does.
 *
 * Idempotent across repeated LOCAL runs against a scratch database that
 * was not recreated between them: `user.upsert` on `clerkId` and a
 * find-or-create on the tagged job mean a second run reuses what the
 * first one made rather than duplicating it. A CI run always gets a fresh
 * Postgres container, so there this is just belt-and-braces.
 */
export async function seedDatabase(clerkIds: ClerkIds): Promise<void> {
  const main = await prisma.user.upsert({
    where: { clerkId: clerkIds.main.id },
    update: {},
    create: {
      clerkId: clerkIds.main.id,
      email: clerkIds.main.email,
      name: "E2E MAIN",
      role: "OWNER",
      company: { create: { name: `${E2E_TAG} Main Co`, businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT } },
    },
    select: { id: true, companyId: true },
  });

  // The same fact for a scratch database seeded BEFORE this line existed:
  // `upsert`'s `update: {}` above never touches the company, so a local
  // re-run would otherwise keep a MAIN that is still gated. Only a null is
  // filled in; a value already there is left alone.
  await prisma.company.updateMany({
    where: { id: main.companyId, businessScopeAskedAt: null },
    data: { businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT },
  });

  const existingJob = await prisma.job.findFirst({
    where: { companyId: main.companyId, name: { startsWith: E2E_TAG } },
    select: { id: true },
  });
  if (!existingJob) {
    const contact = await prisma.contact.create({
      data: {
        companyId: main.companyId,
        name: `${E2E_TAG} General Contractor`,
        email: "gc@example.com",
        status: "ACTIVE",
      },
    });
    await prisma.job.create({
      data: {
        companyId: main.companyId,
        contactId: contact.id,
        name: `${E2E_TAG} Seeded Job`,
        status: "IN_PROGRESS",
        scope: "Level 3 drywall and finish, seeded for the E2E suite.",
      },
    });
  }

  // MEMBER + jobFunction FIELD, created directly rather than through the
  // Invite flow — this fixture only needs the capability shape
  // FIELD produces (MANAGE_FIELD/MANAGE_JOBS, never
  // VIEW_COMPANY_FINANCIALS; see apps/web/lib/permissions.ts), not a
  // real-looking onboarding history.
  await prisma.user.upsert({
    where: { clerkId: clerkIds.field.id },
    update: {},
    create: {
      clerkId: clerkIds.field.id,
      email: clerkIds.field.email,
      name: "E2E FIELD",
      role: "MEMBER",
      jobFunction: "FIELD",
      companyId: main.companyId,
    },
  });

  await seedCertifiedPayrollWeek(main.companyId);
  await seedSalesOperator(clerkIds);
}

/**
 * THE ONE COMPANY IN THIS SUITE WITH `Company.isProvaOperator`, AND THE ROWS
 * THE TWO SALES SCREENS READ.
 *
 * Seeded here rather than driven through the UI for the same reason MAIN's job
 * is: `specs/sales-crm.spec.ts` is about whether those screens RENDER and
 * whether a proposed signal can be confirmed, and there is no screen in this
 * product that can create a PROPOSED signal by hand — `createSalesLeadSignal`
 * lands a hand-typed one CONFIRMED on purpose ("typed in BY A PERSON, so it
 * lands CONFIRMED and reviewed by them — they are the review"). Only the
 * research seam proposes, and the one UI path to that is the listing import,
 * whose parser is under active change in another lane. So the research state the
 * review screen exists for is seeded directly, and the REVIEW is what the
 * browser does.
 *
 * `lib/salesFixture.ts` owns the data and the sentences it makes the pages say;
 * `salesFixture.test.ts` (unit suite, every push) proves those sentences are
 * what the app's own derivations produce from it.
 *
 * WHY THE SIGNALS ARE REPLACED EVERY RUN AND THE REST IS FIND-OR-CREATE. The
 * spec CONFIRMS the proposed signal, and nothing in this product can move a
 * signal back to PROPOSED — a wrong one is dismissed, never un-reviewed. So on
 * a second run against a scratch database that survived the first (the
 * `E2E_DATABASE_URL` path), a find-or-create would hand the spec a signal that
 * is already CONFIRMED, and it would fail looking for a "Confirm" button that
 * is not there. The opportunities and the leads themselves are never mutated by
 * any spec, so those stay find-or-create.
 */
export async function seedSalesOperator(clerkIds: ClerkIds): Promise<void> {
  const sales = await prisma.user.upsert({
    where: { clerkId: clerkIds.sales.id },
    update: {},
    create: {
      clerkId: clerkIds.sales.id,
      email: clerkIds.sales.email,
      // Pinned in salesFixture.ts, because confirming a signal renders
      // "· checked by <this name>" and that sentence is the spec's proof the
      // review landed.
      name: SALES_OWNER_NAME,
      // OWNER, and both halves of the gate need it: `isProvaOperator` alone
      // gets "Owner only" rather than the page.
      role: "OWNER",
      company: {
        create: {
          name: SALES_COMPANY_NAME,
          isProvaOperator: true,
          // An established account, like MAIN's — `/sales` is not reached
          // through `/dashboard`, so the onboarding gate never fires on this
          // path, but a spec that ever does open the dashboard as SALES should
          // not land on `/welcome` and fail about the wrong screen.
          businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT,
        },
      },
    },
    select: { id: true, companyId: true },
  });

  /**
   * `upsert`'s `update: {}` above never touches the company, so a scratch
   * database seeded by a checkout that predates this function keeps a SALES
   * company without the flag — and the failure that produces is the nastiest
   * one available here: `/sales` renders its "Not part of your access" refusal,
   * which is a perfectly healthy page, so the spec fails on a missing heading
   * and says nothing about why. Exactly the shape MAIN's `businessScopeAskedAt`
   * repair just above exists for.
   */
  await prisma.company.updateMany({
    where: { id: sales.companyId, isProvaOperator: false },
    data: { isProvaOperator: true },
  });

  const researched = await findOrCreateSalesLead(sales.companyId, RESEARCHED_LEAD_NAME);

  // Replaced, not reused — see this function's header. `deleteMany` on signals
  // is allowed: the RESTRICT in the schema is on deleting a LEAD that has been
  // researched, which is a different guard and is left intact.
  await prisma.salesLeadSignal.deleteMany({ where: { leadId: researched.id } });
  await prisma.salesLeadSignal.createMany({
    data: RESEARCHED_LEAD_SIGNALS.map((signal) => ({
      companyId: sales.companyId,
      leadId: researched.id,
      kind: signal.kind,
      state: signal.state,
      claim: signal.claim,
      sourceUrl: signal.sourceUrl,
      sourceTitle: signal.sourceTitle,
      disqualifies: signal.disqualifies,
      // NO reviewer on the confirmed ones, deliberately: "checked by E2E SALES"
      // is the one thing on that page that cannot be true before the review, so
      // seeding it would make the spec's proof unfalsifiable.
      reviewedAt: null,
      reviewedByUserId: null,
    })),
  });

  const pipelineLead = await findOrCreateSalesLead(sales.companyId, PIPELINE_LEAD_NAME);
  const alreadyPriced = await prisma.salesOpportunity.count({ where: { leadId: pipelineLead.id } });
  if (alreadyPriced === 0) {
    for (const opportunity of PIPELINE_OPPORTUNITIES) {
      const row = await prisma.salesOpportunity.create({
        data: {
          companyId: sales.companyId,
          leadId: pipelineLead.id,
          stage: opportunity.stage,
          estimatedMrr: opportunity.estimatedMrr,
          // Null on every one of them, so no figure on the band moves with the
          // calendar — see salesFixture.ts.
          expectedCloseDate: null,
        },
        select: { id: true },
      });

      for (const [fromStage, toStage, effectiveOn] of opportunity.stageChanges) {
        await prisma.salesStageChange.create({
          data: {
            companyId: sales.companyId,
            opportunityId: row.id,
            fromStage,
            toStage,
            // UTC midnight, like every other date in this schema.
            effectiveOn: new Date(`${effectiveOn}T00:00:00.000Z`),
          },
        });
      }
    }
  }
}

/** Find-or-create by the tagged company name. The name is what the spec
 *  locates the row by, so it is the only thing that has to be unique. */
async function findOrCreateSalesLead(
  companyId: string,
  companyName: string,
): Promise<{ id: string }> {
  const existing = await prisma.salesLead.findFirst({
    where: { companyId, companyName },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.salesLead.create({
    data: { companyId, companyName, source: "OUTBOUND" },
    select: { id: true },
  });
}

/**
 * A WEEK OF HOURS, SO A TEST CAN CHECK THE NUMBERS AND NOT ONLY THE SHAPE.
 *
 * Until this existed the seed created a company, a contact and a job and
 * nothing else — no crew, no classifications, no time entries. That is why
 * `payroll-export.spec.ts` could prove the route, the content type, the
 * filename, the header order and the 403, and could NOT prove a single
 * figure in the file. Verifying those needed a real job on production and a
 * human to download the CSV, which cost an evening on 2026-10-03.
 *
 * **The week is deliberately one employee in TWO classifications**, because
 * that single shape exercises both of the refusals #596 was built around:
 *
 *   - the SECOND row has no craft, so no fringe schedule is in force and its
 *     wage cost must come out EMPTY. Never 0 — a 0 in a pay run reads as
 *     free labour, and the export writes `rateKnown: "no"` beside it so the
 *     blank cannot be mistaken for a missing column;
 *   - per diem and travel pay are EMPLOYEE totals, so they belong on the
 *     first row only. Repeating them on the second pays them twice.
 *
 * Fixed dates, not relative ones: a spec has to be able to ask for this week
 * by name, and a week computed from `now` would drift out from under it.
 */
const PAYROLL_WEEK_START = "2026-08-23"; // a Sunday; weeks run Sun–Sat

async function seedCertifiedPayrollWeek(companyId: string) {
  const job = await prisma.job.findFirst({
    where: { companyId, name: { startsWith: E2E_TAG } },
    select: { id: true },
  });
  if (!job) return;

  const already = await prisma.timeEntry.findFirst({
    where: { jobId: job.id },
    select: { id: true },
  });
  if (already) return;

  const employee = await prisma.user.findFirst({
    where: { companyId, jobFunction: "FIELD" },
    select: { id: true },
  });
  if (!employee) return;

  const local = await prisma.unionLocal.create({
    data: {
      companyId,
      parentInternational: "United Brotherhood of Carpenters",
      localNumber: "1234",
      jurisdictionName: `${E2E_TAG} Jurisdiction`,
    },
  });
  const craft = await prisma.craftClassification.create({
    data: { companyId, unionLocalId: local.id, name: "Drywall Finisher" },
  });
  // In force well before the seeded week, so the first row prices and the
  // second one's blank is about the MISSING CRAFT rather than a date edge.
  await prisma.fringeRateSchedule.create({
    data: {
      companyId,
      craftClassificationId: craft.id,
      baseWage: "50.00",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  await prisma.timeEntry.createMany({
    data: [
      {
        jobId: job.id,
        employeeUserId: employee.id,
        craftClassificationId: craft.id,
        date: new Date("2026-08-24T00:00:00.000Z"),
        hours: "8",
        payType: "STRAIGHT",
        perDiemAmount: "75.00",
        travelPayAmount: "50.00",
      },
      {
        jobId: job.id,
        employeeUserId: employee.id,
        // No craft on purpose. This is the row whose wage must be blank.
        date: new Date("2026-08-25T00:00:00.000Z"),
        hours: "6",
        payType: "STRAIGHT",
      },
    ],
  });
}

export { PAYROLL_WEEK_START };
