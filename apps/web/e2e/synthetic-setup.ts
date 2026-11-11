import { clerkSetup } from "@clerk/testing/playwright";

/**
 * The synthetic check's global setup: a Clerk Testing Token and nothing else.
 *
 * It mints NO users. The striking-jaybird development instance caps at 100
 * users and walks fill it, so the check signs in as one existing e2e persona
 * (PERSONAS.takeoff) every day — the same long-lived user CI's global setup
 * creates when it is missing. If it is missing here, sign-in fails naming the
 * email; re-run seedClerkUsers rather than adding a user from this file.
 */
export default async function syntheticSetup(): Promise<void> {
  for (const [name, live] of [["CLERK_SECRET_KEY", "sk_live_"], ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_"]] as const) {
    const value = process.env[name] ?? "";
    if (!value) throw new Error(`${name} is not set: the synthetic check signs a Clerk test persona in.`);
    if (value.startsWith(live)) throw new Error(`${name} is a PRODUCTION key. The synthetic check runs against the development instance only.`);
  }
  await clerkSetup();
}
