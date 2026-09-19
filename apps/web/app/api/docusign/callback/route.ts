import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeDocuSignCode, fetchDocuSignAccount, readDocuSignConfig, DOCUSIGN_SCOPES } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { DOCUSIGN_OAUTH_STATE_COOKIE, readDocuSignCookie } from "@/lib/docusign/constants";
import { sealAccess } from "@/lib/docusign/connection";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("docusign", outcome);
  if (detail) url.searchParams.set("docusign_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the DocuSign OAuth flow started by /api/docusign/start.
 *
 * WHOSE ACCOUNT THIS IS COMES FROM THE SESSION, NEVER THE COOKIE (the
 * QuickBooks #136 §2 lesson, and the Jobber callback's arrangement). The
 * cookie carries the CSRF `state` and the PKCE verifier, and who started
 * the flow purely as a cross-check.
 *
 * Refuses, writing nothing and calling nothing at DocuSign, when the state
 * that came back is not the one this browser was given, when nobody is
 * signed in or they are not the owner, or when the person finishing is not
 * the person who started.
 *
 * Then: code -> tokens (Basic-auth client credentials + the PKCE verifier),
 * tokens -> the default account's id and base_uri (userinfo). Both tokens
 * and the base_uri are stored encrypted (lib/docusign/connection.ts). No log
 * line here includes a token, a code, the state or an id.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const payload = readDocuSignCookie(cookieStore.get(DOCUSIGN_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(DOCUSIGN_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("DocuSign OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("DocuSign OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readDocuSignConfig();
  if (!config) return back(request, "error", "not_configured");

  let tokens;
  try {
    tokens = await exchangeDocuSignCode(config, code, payload.codeVerifier);
  } catch (error) {
    console.error("DocuSign token exchange failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "token_exchange_failed");
  }

  let account;
  try {
    account = await fetchDocuSignAccount(config, tokens.accessToken);
  } catch (error) {
    // Unlike Jobber's account name, this is not cosmetic: without the
    // account id and base_uri there is nowhere to send an envelope.
    console.error("DocuSign userinfo failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "no_account");
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: account.accountId,
    externalAccountLabel: account.accountName,
    scopes: [...DOCUSIGN_SCOPES],
    encryptedAccessToken: sealAccess({
      accessToken: tokens.accessToken,
      expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000).toISOString(),
      baseUri: account.baseUri,
    }),
    encryptedRefreshToken: encryptSecret(tokens.refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "DOCUSIGN" } },
      create: { companyId, provider: "DOCUSIGN", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PUSH",
        status: "SUCCESS",
        message: `Connected to DocuSign account ${account.accountName} (${config.environment}).`,
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
