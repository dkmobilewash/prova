import { requireCompanyContext } from "@/lib/auth";
import { can, type Capability } from "@/lib/permissions";

/**
 * The enforcement side of lib/permissions.ts.
 *
 * Kept separate from that file because permissions.ts is pure and testable
 * without a session, and this one needs Clerk. The split is the same one
 * compliance-expiry.ts/renewals.ts already uses: decide in a pure module,
 * fetch in a thin one.
 *
 * THIS is the security boundary, not the nav. A hidden link hides nothing
 * — the URL still exists and can be typed, pasted from a colleague, or
 * left in a browser's history. Every guarded page calls this; the rail
 * filtering in Sidebar/MobileNav is cosmetic and says so.
 */
export async function requireCapability(capability: Capability) {
  const context = await requireCompanyContext();
  return { context, allowed: can(context, capability) };
}

/**
 * The same boundary for a Server Action.
 *
 * A page guard stops a page rendering. It does nothing whatsoever about
 * the action behind it: a Server Action is an HTTP endpoint with a stable
 * id, and it answers whoever posts to it. Guarding the page and leaving
 * the action open is the "looks enforced, isn't" shape this codebase has
 * paid for repeatedly — and it is worse than an open page, because a page
 * only reads and an action writes.
 *
 * Drop-in for `requireCompanyContext()`: it returns the same context, so
 * every destructuring at the call sites is unchanged and the diff is one
 * token per action. THROWS, deliberately matching `assertOwner` in
 * lib/actions/shared.ts, so a module written in that style stays in it.
 * Modules that return `ActionResult` must NOT use this — production
 * redacts a thrown message and the sentence would never arrive; those
 * check `can()` and `return fail(...)`, the way
 * `deleteCloseoutSubmission` already does for the owner check.
 *
 * `message` is required rather than defaulted: "Only the account owner
 * can do that" told nobody anything, and the person reading this one has
 * done nothing wrong.
 */
export async function requireCapabilityForAction(capability: Capability, message: string) {
  const context = await requireCompanyContext();
  if (!can(context, capability)) throw new Error(message);
  return context;
}
