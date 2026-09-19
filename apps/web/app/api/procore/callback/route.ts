import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeProcoreCode, fetchProcoreMe, readProcoreConfig } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { PROCORE_OAUTH_STATE_COOKIE, readProcoreCookie } from "@/lib/procore/constants";
import { sealAccess } from "@/lib/procore/connection";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("procore", outcome);
  if (detail) url.searchParams.set("procore_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the Procore OAuth flow started by /api/procore/start. The same
 * shape as /api/jobber/callback, on the QuickBooks lesson (#136 §2): WHOSE
 * ACCOUNT THIS IS COMES FROM THE SESSION, NEVER THE COOKIE.
 *
 * Refuses, writing nothing and calling nothing at Procore, when:
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
  const payload = readProcoreCookie(cookieStore.get(PROCORE_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(PROCORE_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("Procore OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("Procore OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readProcoreConfig();
  if (!config) return back(request, "error", "not_configured");

  let tokens;
  try {
    tokens = await exchangeProcoreCode(config, code, payload.codeVerifier);
  } catch (error) {
    console.error("Procore token exchange failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "token_exchange_failed");
  }

  // Whose Procore login, for the card. Best effort.
  let account = { id: null as string | null, name: "Procore login" };
  try {
    const me = await fetchProcoreMe(config, tokens.accessToken);
    account = { id: me.id, name: me.name };
  } catch (error) {
    console.warn("Procore /me lookup failed", { message: (error as Error)?.message });
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: account.id,
    externalAccountLabel: config.environment === "sandbox" ? `${account.name} (Procore sandbox)` : account.name,
    // Procore has no OAuth scopes; a token reads what the user can read.
    scopes: [] as string[],
    encryptedAccessToken: sealAccess(tokens),
    encryptedRefreshToken: encryptSecret(tokens.refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "PROCORE" } },
      create: { companyId, provider: "PROCORE", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PULL",
        status: "SUCCESS",
        message: `Connected as ${account.name}. Nothing is read until a Procore project is linked to a job.`,
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
