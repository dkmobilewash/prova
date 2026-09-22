import { prisma } from "@prova/db";
import { assertScratchDatabase } from "./lib/assertScratchDatabase";
import { ESIGN_TOKEN, PORTAL_TOKEN } from "./lib/publicRoutes";

/**
 * Global setup for the PUBLIC suite — the same first step as
 * `global-setup.ts` and then nothing else.
 *
 *   1. Refuse anything but a local scratch Postgres, through the identical
 *      `assertScratchDatabase()` the Clerk-backed suite uses. It runs first
 *      here for the same reason it runs first there: a refusal after the
 *      first write is a refusal that came too late.
 *   2. Seed the two rows the token-addressed public pages need.
 *
 * NO `clerkSetup()` AND NO `seedClerkUsers()`, which is the whole point.
 * Those two are why the existing suite cannot run at all without a Clerk
 * development instance's secret key — including `pilot.mobile.spec.ts`,
 * which signs nobody in. Nothing in this file or its spec touches Clerk's
 * backend API, and no user is minted anywhere.
 */
export default async function publicGlobalSetup(): Promise<void> {
  assertScratchDatabase();

  // Idempotent the same way seedDatabase.ts is: a local scratch database
  // gets reused across runs, and a second run must reuse what the first
  // made rather than fail on the unique token.
  const existing = await prisma.contact.findUnique({
    where: { portalToken: PORTAL_TOKEN },
    select: { id: true, jobs: { select: { id: true }, take: 1 } },
  });
  if (existing?.jobs.length) return;

  const company = await prisma.company.create({ data: { name: "ZZ-E2E Public Co" } });
  const contact =
    existing ??
    (await prisma.contact.create({
      data: {
        companyId: company.id,
        name: "ZZ-E2E General Contractor",
        status: "ACTIVE",
        portalToken: PORTAL_TOKEN,
      },
      select: { id: true, jobs: { select: { id: true }, take: 1 } },
    }));

  /* A LONG DESCRIPTION AND SIX-FIGURE MONEY ON PURPOSE. Both pages below
     render a five-column estimate table, and a table only misbehaves at
     375px when its cells have something in them: seeded with "Item 1" and
     "$1.00" this suite would report a clean phone layout for a table that
     is unreadable with a real job's line items in it. These are the
     shapes a wall-and-ceiling sub actually bills — a scope sentence that
     runs past a phone's width, and totals with a comma and a cent. */
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: "ZZ-E2E Riverside Medical Center — Levels 3 through 7 drywall and finish",
      status: "IN_PROGRESS",
      scope: "Metal stud framing, gypsum board, level 5 finish, acoustical ceilings.",
      lineItems: {
        create: [
          { description: 'Metal stud framing — 3-5/8" 20ga at 16" o.c., levels 3-7', quantity: "12500", unit: "SF", unitPrice: "4.75" },
          { description: 'Gypsum board, 5/8" type X, two layers each side', quantity: "25000", unit: "SF", unitPrice: "2.10" },
          { description: "Level 5 finish including primer-sealer", quantity: "25000", unit: "SF", unitPrice: "1.35" },
        ],
      },
    },
  });

  await prisma.signatureRequest.upsert({
    where: { token: ESIGN_TOKEN },
    update: {},
    create: { jobId: job.id, token: ESIGN_TOKEN, status: "PENDING", signerName: "Pat Foreman", signerEmail: "pat@example.com" },
  });
}
