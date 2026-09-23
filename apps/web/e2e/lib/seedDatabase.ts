import { prisma } from "@prova/db";
import type { PersonaKey } from "./personas";

/** Every row this suite writes carries this in its name, the same
 * `clean-scratch-data.mjs`/`seed-demo.mjs` convention ("[demo]") for the
 * same reason: a marker future cleanup can find, without touching a row a
 * person entered by hand while poking at their own scratch database. */
export const E2E_TAG = "ZZ-E2E";

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
 * Pre-seeds the two personas that need to exist BEFORE any spec's first
 * navigation: MAIN (an established company, already past the onboarding
 * questions, with one contact and one job, so job-detail,
 * schedule, ask-panel, the tour and settings/import all have something to
 * show without racing another spec that creates it) and FIELD (a second
 * User inside MAIN's company, so the money-rail invariant has a
 * field-function viewer to sign in as).
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
}
