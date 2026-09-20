import { clerkSetup } from "@clerk/testing/playwright";
import { assertScratchDatabase } from "./lib/assertScratchDatabase";
import { seedClerkUsers } from "./lib/seedClerkUsers";
import { seedDatabase } from "./lib/seedDatabase";

/**
 * Playwright global setup: runs once, before any spec, before any browser
 * opens. Three steps, in this order and for this reason —
 *
 *   1. Refuse anything but a local scratch Postgres. Before any Clerk user
 *      is minted and before any Prisma write, because a refusal after
 *      either of those has already happened is a refusal that's too late.
 *   2. `clerkSetup()` (@clerk/testing/playwright) — fetches a Testing
 *      Token from the Clerk Backend API for the DEVELOPMENT instance named
 *      by CLERK_SECRET_KEY. It independently refuses a production
 *      (sk_live_) key, which is the same rule seedClerkUsers.ts applies a
 *      little earlier for belt-and-braces reasons.
 *   3. Seed the Clerk users and the two personas' database rows this
 *      suite's specs sign in as. See lib/personas.ts for why there are
 *      four identities and lib/seedDatabase.ts for which two are
 *      pre-seeded.
 *
 * NO APPLICATION-CODE AUTH BYPASS ANYWHERE IN THIS FILE OR ITS SIBLINGS.
 * Every signed-in spec goes through Clerk's own sign-in machinery
 * (`clerk.signIn` in the specs) against real Clerk test users, and the app
 * never gets told "skip auth" or "this request is a test" — middleware.ts
 * and lib/auth.ts are untouched by this suite. See the PR description for
 * what was tried and confirmed instead of a bypass.
 */
export default async function globalSetup(): Promise<void> {
  assertScratchDatabase();
  await clerkSetup();
  const clerkIds = await seedClerkUsers();
  await seedDatabase(clerkIds);
}
