import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

const FIELD_ONLY =
  "Site photos aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * The company's photo tags, so the phone can offer them AT THE SHUTTER
 * rather than leaving tagging as something only the web can do afterwards —
 * which in practice means never.
 *
 * Read-only on purpose: the tag vocabulary is managed on /photos, where a
 * rename or a delete can be seen against everything it is on. A phone
 * inventing tags one at a time is how a vocabulary becomes forty spellings
 * of "punch list".
 */
export async function GET() {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!can(context, "MANAGE_FIELD")) return NextResponse.json({ error: FIELD_ONLY }, { status: 403 });

  const tags = await prisma.jobMediaTag.findMany({
    where: { companyId: context.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json(tags);
}
