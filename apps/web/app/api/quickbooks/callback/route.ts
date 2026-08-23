import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@prova/integrations";
import { prisma } from "@prova/db";
import { QUICKBOOKS_OAUTH_STATE_COOKIE, type QuickBooksOAuthCookiePayload } from "@/lib/quickbooks-constants";

function settingsRedirect(request: NextRequest, status: "connected" | "error", detail?: string) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("qb", status);
  if (detail) {
    url.searchParams.set("qb_detail", detail);
  }
  return NextResponse.redirect(url);
}

function readCookiePayload(raw: string | undefined): QuickBooksOAuthCookiePayload | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.state === "string" &&
      typeof parsed.companyId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return parsed as QuickBooksOAuthCookiePayload;
    }
  } catch {
    // Malformed cookie — treated as missing below.
  }
  return null;
}

/**
 * Finishes the QuickBooks OAuth flow started by initiateQuickBooksConnect
 * (see apps/web/lib/actions.ts). Intuit redirects the browser here with
 * `code`, `state`, and `realmId` (or `error` if the user declined consent).
 *
 * Deliberately does NOT require an active Clerk session here (this route
 * is excluded from middleware's protected-route matcher) — see
 * QuickBooksOAuthCookiePayload for why. The httpOnly cookie set by
 * initiateQuickBooksConnect is the sole authorization: it can only have
 * been set by that OWNER-gated action, so possession of it (matched
 * against Intuit's `state`) is sufficient proof of who's connecting.
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
    console.warn("QuickBooks callback missing params", {
      hasCode: !!code,
      hasState: !!state,
      hasRealmId: !!realmId,
    });
    return settingsRedirect(request, "error", "missing_params");
  }

  const cookieStore = await cookies();
  const payload = readCookiePayload(cookieStore.get(QUICKBOOKS_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(QUICKBOOKS_OAUTH_STATE_COOKIE);
  if (!payload || payload.state !== state) {
    // Diagnostic only — never log the raw state/company/user values, just
    // whether the cookie made it back at all. A missing cookie almost
    // always means the browser lost it between initiateQuickBooksConnect's
    // redirect to Intuit and Intuit's redirect back here (e.g. the
    // cookie's maxAge was exceeded, or a different browser tab/profile).
    console.warn("QuickBooks OAuth state mismatch", {
      hadCookie: payload !== null,
      cookieMatchedParam: payload?.state === state,
    });
    return settingsRedirect(request, "error", "state_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    await prisma.quickBooksConnection.upsert({
      where: { companyId: payload.companyId },
      create: {
        companyId: payload.companyId,
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: payload.userId,
      },
      update: {
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: payload.userId,
      },
    });
  } catch (error) {
    console.error("QuickBooks token exchange failed", error);
    return settingsRedirect(request, "error", "token_exchange_failed");
  }

  return settingsRedirect(request, "connected");
}
