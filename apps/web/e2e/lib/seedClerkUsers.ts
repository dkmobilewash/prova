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
    if (existing.data[0]) {
      result[key] = { id: existing.data[0].id, email: persona.email };
      continue;
    }
    try {
      const user = await clerk.users.createUser({
        emailAddress: [persona.email],
        firstName: "E2E",
        lastName: persona.label,
        // `skipPasswordChecks` is deliberately NOT sent. It means "accept this
        // password without validating it", and there is no password here —
        // `skipPasswordRequirement` is the whole point. Clerk's own docs scope
        // it to migrating plaintext passwords in. It was passed alongside for
        // a long time and nothing noticed, because this branch had not run for
        // weeks: the six original personas already exist on the instance and
        // are found by the read above, so `createUser` is only reached the day
        // somebody adds a new one.
        skipPasswordRequirement: true,
      });
      result[key] = { id: user.id, email: persona.email };
    } catch (error) {
      throw new Error(clerkCreateFailure(key, persona.label, persona.email, error), { cause: error });
    }
  }
  return result;
}

/**
 * WHAT CLERK ACTUALLY SAID, AND WHICH PERSONA IT SAID IT ABOUT.
 *
 * `ClerkAPIResponseError`'s `message` is the bare HTTP reason — "Unprocessable
 * Entity" — and the detail that would let anybody act on it is in `errors[]`,
 * which never reaches the console. On 2026-09-25 that cost a whole CI run: the
 * `e2e` job died in global setup, before a single spec, with nine words that
 * named neither the persona nor the problem, and there is nothing in the log to
 * read because the log is those nine words.
 *
 * This is the same shape as the rest of this suite: a failure has to say which
 * thing failed and why, or the run has told you only that it is red. Every
 * field Clerk returns is repeated — `code` is the machine-readable one worth
 * searching their docs for, `longMessage` is usually the sentence a person
 * needs, and `meta` carries the parameter name when it is a validation error.
 */
function clerkCreateFailure(key: string, label: string, email: string, error: unknown): string {
  const lines = [
    `e2e: Clerk refused to create the ${label} persona (PERSONAS.${key}, ${email}).`,
  ];
  const detail = error as { status?: number; clerkTraceId?: string; errors?: unknown };
  if (detail?.status) lines.push(`  HTTP ${detail.status}`);
  if (detail?.clerkTraceId) lines.push(`  Clerk trace id: ${detail.clerkTraceId}`);
  if (Array.isArray(detail?.errors) && detail.errors.length > 0) {
    for (const item of detail.errors as { code?: string; message?: string; longMessage?: string; meta?: unknown }[]) {
      lines.push(`  - [${item.code ?? "no code"}] ${item.longMessage ?? item.message ?? "(no message)"}`);
      if (item.meta && Object.keys(item.meta).length > 0) lines.push(`    meta: ${JSON.stringify(item.meta)}`);
    }
  } else {
    // Said out loud rather than left blank: "Clerk returned no detail" is a
    // different fact from "nobody printed the detail", and only one of them
    // means there is nothing more to find.
    lines.push(`  Clerk returned no errors[] to report. Raw message: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  lines.push(
    "  This is the DEVELOPMENT instance named by CLERK_SECRET_KEY. A development " +
      "instance caps how many users it will hold, so a quota is one thing this can be; " +
      "a rejected email or name is another. The code above says which.",
  );
  return lines.join("\n");
}
