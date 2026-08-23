import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { QUICKBOOKS_OAUTH_STATE_COOKIE } from "@/lib/quickbooks-constants";

function settingsRedirect(request: NextRequest, status: "connected" | "error", detail?: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("qb", status);
  if (detail) {
    url.searchParams.set("qb_detail", detail);
  }
  return NextResponse.redirect(url);
}

/**
 * Finishes the QuickBooks OAuth flow started by initiateQuickBooksConnect
 * (see apps/web/lib/actions.ts). Intuit redirects the browser here with
 * `code`, `state`, and `realmId` (or `error` if the user declined consent).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    return settingsRedirect(request, "error", oauthError);
  }

  const code = params.get("code");
  const state = params.get("state");
  const realmId = params.get("realmId");
  if (!code || !state || !realmId) {
    return settingsRedirect(request, "error", "missing_params");
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(QUICKBOOKS_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(QUICKBOOKS_OAUTH_STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return settingsRedirect(request, "error", "state_mismatch");
  }

  const { company, id: userId } = await requireCompanyContext();

  try {
    const tokens = await exchangeCodeForTokens(code);

    await prisma.quickBooksConnection.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: userId,
      },
      update: {
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: userId,
      },
    });
  } catch (error) {
    console.error("QuickBooks token exchange failed", error);
    return settingsRedirect(request, "error", "token_exchange_failed");
  }

  return settingsRedirect(request, "connected");
}
