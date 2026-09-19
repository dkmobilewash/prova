import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCompanyCamCode, readCompanyCamConfig } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { COMPANYCAM_OAUTH_STATE_COOKIE, readCompanyCamCookie } from "@/lib/companycam/constants";
import { sealAccess } from "@/lib/companycam/connection";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("companycam", outcome);
  if (detail) url.searchParams.set("companycam_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the CompanyCam OAuth flow started by /api/companycam/start.
 * The same shape as /api/procore/callback, on the QuickBooks lesson
 * (#136 §2): WHOSE ACCOUNT THIS IS COMES FROM THE SESSION, NEVER THE
 * COOKIE.
 *
 * Refuses, writing nothing and calling nothing at CompanyCam, when:
 *   - the state that came back is not the one this browser was given;
 *   - nobody is signed in, or they are not the owner;
 *   - the person finishing is not the person who started.
 *
 * Tokens are encrypted before they reach Prisma, and no log line here
 * includes a token, a code or the state.
 *
 * No /me lookup: CompanyCam's docs describe no current-user endpoint
 * (see the API notes in packages/integrations/src/companycam.ts), so the
 * card's account label is a fixed sentence rather than a name this code
 * cannot verifiably get.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const payload = readCompanyCamCookie(cookieStore.get(COMPANYCAM_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(COMPANYCAM_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("CompanyCam OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("CompanyCam OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readCompanyCamConfig();
  if (!config) return back(request, "error", "not_configured");

  let tokens;
  try {
    tokens = await exchangeCompanyCamCode(config, code);
  } catch (error) {
    console.error("CompanyCam token exchange failed", {
      name: (error as Error)?.name,
      message: (error as Error)?.message,
    });
    return back(request, "error", "token_exchange_failed");
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: null,
    externalAccountLabel: "CompanyCam account",
    scopes: ["read"],
    encryptedAccessToken: sealAccess(tokens),
    encryptedRefreshToken: encryptSecret(tokens.refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "COMPANYCAM" } },
      create: { companyId, provider: "COMPANYCAM", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PULL",
        status: "SUCCESS",
        message: "Connected to CompanyCam (read-only). Nothing is imported until a project is linked to a job.",
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
