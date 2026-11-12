// Throwaway Clerk users: the ones a local walk or e2e spec signs up for one run.
//
// The striking-jaybird DEVELOPMENT instance caps at 100 users, and every walk left one behind: the
// cap broke sign-up for walks and CI's persona seeding more than once (79 deleted by hand on
// 2026-11-11). So each run deletes its own user when it ends, pass or fail (`deleteThrowaway`, in the
// spec's afterAll), and a daily job removes any left by a run that was killed (`sweepThrowaways`).
//
// A throwaway is EXACTLY `<word>-<13+ digit timestamp>+clerk_test@example.com`. The CI personas
// (`e2e-main+clerk_test@example.com`, …) have no timestamp and never match, and `e2e-` is refused on
// top of that. A user with any address that is not a throwaway is never touched.
import { createClerkClient } from "@clerk/backend";

const THROWAWAY = /^([a-z]+)-(\d{13,})\+clerk_test@example\.com$/;

/** `walk-1731400000000+clerk_test@example.com`. */
export function throwawayEmail(prefix) {
  if (!/^[a-z]+$/.test(prefix) || prefix === "e2e") throw new Error(`"${prefix}" cannot prefix a throwaway user`);
  return `${prefix}-${Date.now()}+clerk_test@example.com`;
}

export function isThrowaway(email) {
  const m = THROWAWAY.exec(email ?? "");
  return m !== null && m[1] !== "e2e";
}

/** Only a development instance's key: these helpers delete users. */
export function testClerk(secretKey = process.env.CLERK_SECRET_KEY ?? "") {
  if (!secretKey.startsWith("sk_test_")) throw new Error("throwaway-user cleanup needs a development (sk_test_) Clerk key; refusing anything else");
  return createClerkClient({ secretKey });
}

const emailsOf = (user) => (user.emailAddresses ?? []).map((e) => e.emailAddress);
/** Every address on the user is a throwaway, and there is at least one. */
const allThrowaway = (user) => emailsOf(user).length > 0 && emailsOf(user).every(isThrowaway);

/**
 * Deletes the run's own user. Never throws: a cleanup failure must not turn a passing run red or
 * hide a failing run's own error. The daily sweep is the backstop. Returns how many it deleted.
 */
export async function deleteThrowaway(email, clerk) {
  try {
    if (!isThrowaway(email)) throw new Error(`${email} is not a throwaway address`);
    const c = clerk ?? testClerk();
    const { data } = await c.users.getUserList({ emailAddress: [email] });
    let n = 0;
    for (const user of data) {
      if (!allThrowaway(user)) continue;
      await c.users.deleteUser(user.id);
      n += 1;
    }
    return n;
  } catch (error) {
    console.warn(`[throwaway] could not delete ${email}: ${error instanceof Error ? error.message : error}`);
    return 0;
  }
}

/** The users the sweep deletes: all-throwaway addresses, created more than `maxAgeMs` before `now`. */
export function staleThrowaways(users, now, maxAgeMs = 24 * 60 * 60 * 1000) {
  return users.filter((u) => allThrowaway(u) && now - u.createdAt > maxAgeMs);
}

/** Deletes every stale throwaway on the instance. 24 h keeps clear of any run still going (25-min limit). */
export async function sweepThrowaways(clerk, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const users = [];
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerk.users.getUserList({ limit: 100, offset, orderBy: "+created_at" });
    users.push(...data);
    if (data.length < 100) break;
  }
  const stale = staleThrowaways(users, now, maxAgeMs);
  for (const user of stale) await clerk.users.deleteUser(user.id);
  return { total: users.length, deleted: stale.length };
}
