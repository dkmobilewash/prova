import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeAccCode, fetchAccMe, readAccConfig } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { ACC_OAUTH_STATE_COOKIE, readAccCookie } from "@/lib/acc/constants";
import { sealAccess } from "@/lib/acc/connection";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("acc", outcome);
  if (detail) url.searchParams.set("acc_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the ACC OAuth flow started by /api/acc/start. The same shape as
 * /api/procore/callback, on the QuickBooks lesson (#136 §2): WHOSE ACCOUNT
 * THIS IS COMES FROM THE SESSION, NEVER THE COOKIE.
 *
 * Refuses, writing nothing and calling nothing at Autodesk, when:
 *   - the state that came back is not the one this browser was given;
 *   - nobody is signed in, or they are not the owner;
 *   - the person finishing is not the person who started.
 *
 * Tokens are encrypted before they reach Prisma, and no log line here
 * includes a token, a code, the state or an id.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const payload = readAccCookie(cookieStore.get(ACC_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(ACC_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("ACC OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("ACC OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readAccConfig();
  if (!config) return back(request, "error", "not_configured");

  let tokens;
  try {
    tokens = await exchangeAccCode(config, code, payload.codeVerifier);
  } catch (error) {
    console.error("ACC token exchange failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "token_exchange_failed");
  }

  // Whose Autodesk login, for the card. Best effort.
  let account = { id: null as string | null, name: "Autodesk login" };
  try {
    const me = await fetchAccMe(config, tokens.accessToken);
    account = { id: me.id, name: me.name };
  } catch (error) {
    console.warn("ACC profile lookup failed", { message: (error as Error)?.message });
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: account.id,
    externalAccountLabel: account.name,
    scopes: ["data:read", "account:read"],
    encryptedAccessToken: sealAccess(tokens),
    encryptedRefreshToken: encryptSecret(tokens.refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "ACC" } },
      create: { companyId, provider: "ACC", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PULL",
        status: "SUCCESS",
        message: `Connected as ${account.name}. Nothing is read until an ACC project is linked to a job.`,
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
