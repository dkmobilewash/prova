import { createClerkClient } from "@clerk/backend";
import { PERSONAS, type PersonaKey } from "./personas";

/**
 * Creates (or reuses) the four Clerk test users this suite signs in as,
 * against the DEVELOPMENT Clerk instance named by the local `.env` —
 * never a production key. `clerkSetup()` (called separately, in
 * global-setup.ts) already refuses a secret key from a production
 * instance, so this file does not re-check that; it only has to be
 * idempotent, since a local scratch Postgres gets dropped and recreated
 * far more often than the Clerk side of these identities should.
 *
 * `+clerk_test` in every address is not decoration — it is the exact
 * suffix Clerk's own docs specify for suppressing email delivery, so
 * creating these users sends no mail to anyone. And because the Backend
 * API creates an email address already VERIFIED (Clerk's documented
 * default — "email addresses ... created using this method are verified
 * automatically"), `apps/web/lib/auth.ts`'s `adoptCompanyContext` takes
 * the OWNER-creates-a-company branch on first sign-in with no further
 * setup needed on our side.
 */
export async function seedClerkUsers(): Promise<Record<PersonaKey, { id: string; email: string }>> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    throw new Error(
      "e2e: CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be set " +
        "(copy them from apps/web/.env, the DEVELOPMENT Clerk instance's keys).",
    );
  }
  if (secretKey.startsWith("sk_live_")) {
    // clerkSetup() also refuses this, but seeding runs first in
    // global-setup.ts and a live key must never mint a user even for the
    // few milliseconds before that second check would have caught it.
    throw new Error("e2e: refusing to seed users — CLERK_SECRET_KEY is a PRODUCTION (sk_live_) key.");
  }

  const clerk = createClerkClient({ secretKey, publishableKey });

  const result = {} as Record<PersonaKey, { id: string; email: string }>;
  for (const [key, persona] of Object.entries(PERSONAS) as [PersonaKey, (typeof PERSONAS)[PersonaKey]][]) {
    const existing = await clerk.users.getUserList({ emailAddress: [persona.email] });
    const user =
      existing.data[0] ??
      (await clerk.users.createUser({
        emailAddress: [persona.email],
        firstName: "E2E",
        lastName: persona.label,
        skipPasswordRequirement: true,
        skipPasswordChecks: true,
      }));
    result[key] = { id: user.id, email: persona.email };
  }
  return result;
}
