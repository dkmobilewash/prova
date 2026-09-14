import { prisma } from "@prova/db";
import { LAST_SEEN_INTERVAL_MS, shouldStampLastSeen } from "@/lib/last-seen";

/**
 * The single write behind usage visibility, kept in its own module because
 * it is the only part that touches the database — lib/last-seen.ts stays
 * pure so its boundaries can be tested without one.
 *
 * TELEMETRY NEVER BREAKS THE PAGE. This is called from
 * `requireCompanyContext`, which every authenticated route in the app
 * awaits before rendering anything, so an unhandled rejection here is a
 * 500 on every page at once — a product that will not open because it
 * could not record a timestamp. Neon suspends idle computes and the pool
 * runs at `connection_limit=5`, so "this write failed" is a real state and
 * not a hypothetical. Hence the catch, and hence the fact that the catch
 * swallows: there is no error worth showing a contractor here.
 *
 * WHAT IT RETURNS AND WHY IT IS NOT `void`. A swallowed failure and a
 * deliberate throttle are indistinguishable from the outside, and
 * CLAUDE.md is explicit that a check which cannot tell "refuted" from
 * "never ran" reports clean and means nothing. The outcome is returned so
 * a test can assert which of the three happened; nothing in the app reads
 * it, and nothing should start deciding anything on it.
 */
export type LastSeenOutcome = "stamped" | "throttled" | "failed";

export async function recordLastSeen(
  user: { id: string; lastSeenAt: Date | null },
  now: Date = new Date(),
): Promise<LastSeenOutcome> {
  if (!shouldStampLastSeen(user.lastSeenAt, now, LAST_SEEN_INTERVAL_MS)) {
    return "throttled";
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: now },
    });
    return "stamped";
  } catch (error) {
    // Logged, not thrown, and logged ONCE per interval per person rather
    // than per request — so a genuinely broken write is visible in the
    // runtime log instead of being invisible forever, without turning a
    // sick database into a log flood. No email, no name: a usage timestamp
    // is not worth putting a person's identity in a log line.
    console.warn(
      "[last-seen] could not record lastSeenAt; continuing without it",
      error instanceof Error ? error.message : error,
    );
    return "failed";
  }
}
