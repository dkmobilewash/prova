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
