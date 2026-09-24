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
/**
 * Clerk's own error detail, which the thrown `ClerkAPIResponseError`
 * carries and whose `toString()` throws away — it renders as the bare
 * HTTP reason phrase, "Unprocessable Entity", and nothing else.
 *
 * That cost a CI round trip on 2026-09-24: the `e2e` job's first real
 * run after the two Clerk secrets were added died here, and the log said
 * only `ClerkAPIResponseError: Unprocessable Entity` at line 46. A 422
 * from this endpoint is ALWAYS a rule on the instance refusing an
 * address — an allowlist, a blocklist, blocked subaddresses — and Clerk
 * names which in `errors[].code` and writes `longMessage` for a person
 * to read. All of it was in the thrown object the whole time.
 *
 * Deliberately NOT a lookup table keyed by Clerk's error codes. Writing
 * one means guessing code strings that are not verifiable from here, and
 * a hint keyed to a code that does not exist is the "written, documented,
 * and never called" shape this repo keeps finding — it would read as
 * coverage while matching nothing. Clerk's own `code` and `longMessage`
 * are printed instead, plus one pointer that is true whatever the code.
 */
type ClerkErrorItem = { code: string; message?: string; longMessage?: string; meta?: unknown };

/**
 * Shape-checked rather than `instanceof`. The class is re-exported by
 * `@clerk/backend` from `@clerk/shared`, which is not a direct dependency
 * here, so an `instanceof` can be tested against a DIFFERENT copy of the
 * class and silently return false — putting us straight back to a bare
 * "Unprocessable Entity". A duck-typed check cannot fail that way.
 */
/** Never let the diagnostic itself throw — a circular structure here
 * would replace the error being reported with a different one. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "(unserialisable)";
  }
}

function clerkErrorItems(error: unknown): ClerkErrorItem[] {
  const errors = (error as { errors?: unknown } | null | undefined)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter((e): e is ClerkErrorItem => typeof (e as ClerkErrorItem)?.code === "string");
}

export function describeClerkSeedFailure(
  error: unknown,
  persona: { email: string; label: string },
): string {
  const items = clerkErrorItems(error);
  const status = (error as { status?: unknown })?.status;
  const traceId = (error as { clerkTraceId?: unknown })?.clerkTraceId;

  const said = items.length
    ? items
        .map((e) => {
          const meta = e.meta && Object.keys(e.meta as object).length ? `\n    meta: ${safeJson(e.meta)}` : "";
          return `  - [${e.code}] ${e.message ?? ""}${e.longMessage ? `\n    ${e.longMessage}` : ""}${meta}`;
        })
        .join("\n")
    : `  (no structured detail — raw: ${error instanceof Error ? error.message : String(error)})`;

  return [
    `e2e: Clerk refused to create the test user ${persona.email} (${persona.label}).`,
    "",
    `Clerk said${typeof status === "number" ? ` (HTTP ${status})` : ""}:`,
    said,
    typeof traceId === "string" && traceId ? `  clerkTraceId: ${traceId}` : null,
    "",
    "Nothing was seeded, so no spec ran — the whole signed-in suite is",
    "blocked on this one call. This is a SETTING on the development Clerk",
    "instance whose keys E2E_CLERK_SECRET_KEY holds, not a bug in the suite",
    "or in the app: this suite MINTS its six users, and every address carries",
    "Clerk's `+clerk_test` suffix (see personas.ts).",
    "",
    "TWO FAMILIES produce a 422 here and the `code` above is what tells them",
    "apart — do not reason from the status alone:",
    "  · a required field this call does not send (legal consent, username,",
    "    phone) — the instance wants it, `meta` usually names it;",
    "  · a rule refusing the address (allowlist, blocklist, blocked email",
    "    subaddresses) under Configure → Restrictions.",
    "Name the instance before changing anything; there is more than one.",
    "",
    // Written after `[form_data_missing] missing data` arrived with no
    // longMessage and no printed meta, because the first version of this
    // function chose which fields to show — and the field it did not
    // choose was the one that would have named the cause. Everything
    // Clerk sent is dumped verbatim so that cannot happen twice.
    `Raw, so nothing Clerk sent is lost to this formatter: ${safeJson(items)}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

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
    let user;
    try {
      const existing = await clerk.users.getUserList({ emailAddress: [persona.email] });
      user =
        existing.data[0] ??
        (await clerk.users.createUser({
          emailAddress: [persona.email],
          // Required by the striking-jaybird instance; a fictional test
          // number that sends no SMS. See the note in personas.ts.
          username: persona.username,
          phoneNumber: [persona.phone],
          firstName: "E2E",
          lastName: persona.label,
          skipPasswordRequirement: true,
          skipPasswordChecks: true,
        }));
    } catch (error) {
      // `cause` keeps the original for a stack; the message is what a
      // person reads out of a CI log, and it has to stand alone there.
      throw new Error(describeClerkSeedFailure(error, persona), { cause: error });
    }
    result[key] = { id: user.id, email: persona.email };
  }
  return result;
}
