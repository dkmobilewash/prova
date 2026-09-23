import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeBluebeamCode, readBluebeamConfig } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { BLUEBEAM_OAUTH_STATE_COOKIE, readBluebeamCookie } from "@/lib/bluebeam/constants";
import { sealAccess } from "@/lib/bluebeam/connection";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("bluebeam", outcome);
  if (detail) url.searchParams.set("bluebeam_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the Bluebeam OAuth flow started by /api/bluebeam/start. The
 * same shape as /api/companycam/callback, on the QuickBooks lesson
 * (#136 §2): WHOSE ACCOUNT THIS IS COMES FROM THE SESSION, NEVER THE
 * COOKIE.
 *
 * Refuses, writing nothing and calling nothing at Bluebeam, when:
 *   - the state that came back is not the one this browser was given;
 *   - nobody is signed in, or they are not the owner;
 *   - the person finishing is not the person who started.
 *
 * Tokens are encrypted before they reach Prisma, and no log line here
 * includes a token, a code or the state.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const payload = readBluebeamCookie(cookieStore.get(BLUEBEAM_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(BLUEBEAM_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("Bluebeam OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("Bluebeam OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readBluebeamConfig();
  if (!config) return back(request, "error", "not_configured");

  let tokens;
  try {
    tokens = await exchangeBluebeamCode(config, code);
  } catch (error) {
    console.error("Bluebeam token exchange failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "token_exchange_failed");
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: null,
    externalAccountLabel: `Bluebeam (${config.region})`,
    scopes: ["full_prime", "offline_access"],
    encryptedAccessToken: sealAccess({ accessToken: tokens.accessToken, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000).toISOString() }),
    encryptedRefreshToken: encryptSecret(tokens.refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "BLUEBEAM" } },
      create: { companyId, provider: "BLUEBEAM", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PUSH",
        status: "SUCCESS",
        message: "Connected to Bluebeam. Nothing is created until a job is linked to a Studio Session.",
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
