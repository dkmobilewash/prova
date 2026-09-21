import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { capabilitiesFor, isRestricted } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Who is holding this phone, and what they are allowed to do.
 *
 * THE CAPABILITIES ARE DERIVED HERE AND SENT, rather than the rules being
 * shipped to the phone and evaluated there. `capabilitiesFor` is the one
 * place "can a foreman see margin" has an answer (lib/permissions.ts), and
 * a second copy of that mapping inside an app-store binary is a copy that
 * goes stale the day somebody changes a job function — with no way to fix
 * it except a release.
 *
 * What the phone does with the list is hide what this person cannot reach
 * and SAY SO. Before this, every screen was shown to everyone and the app
 * discovered what you were not allowed to do by getting a 403 after you
 * tapped. The server still refuses either way; this is so nobody is sent
 * to a door that will not open.
 */
export async function GET() {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  return NextResponse.json({
    id: context.id,
    name: context.name ?? context.email,
    email: context.email,
    role: context.role,
    jobFunction: context.jobFunction,
    capabilities: [...capabilitiesFor(context)],
    /** True when this person's access is narrower than a plain member's —
     * the signal the phone uses to explain WHY a screen is missing rather
     * than silently drawing a smaller app. */
    restricted: isRestricted(context),
    company: { id: context.company.id, name: context.company.name },
  });
}
