import { NextRequest, NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { prisma } from "@prova/db";

export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** The phone registers (or refreshes) its Expo push token, tied to the
 * signed-in user. A token is a device, so it's upserted on the token; a
 * re-open with the same token refreshes `lastSeenAt` and re-binds the user. */
export async function POST(request: NextRequest) {
  const context = await requireApiContext();
  if (!context) return jsonError("Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const expoToken = String(input.expoToken ?? "").trim();
  if (!expoToken) return jsonError("A push token is required", 400);

  const platform = String(input.platform ?? "").trim();
  if (platform !== "ios" && platform !== "android") {
    return jsonError("Platform must be ios or android", 400);
  }

  await prisma.deviceToken.upsert({
    where: { expoToken },
    create: { companyId: context.companyId, userId: context.id, expoToken, platform },
    update: { companyId: context.companyId, userId: context.id, platform, lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
