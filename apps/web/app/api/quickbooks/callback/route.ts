import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
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
 * Finishes the QuickBooks OAuth flow started by /api/quickbooks/start.
 * Intuit redirects the browser here with `code`, `state`, and `realmId`
 * (or `error` if the user declined consent).
 *
 * WHO THE CONNECTION IS BOUND TO COMES FROM THE SESSION, NOT THE COOKIE.
 *
 * It used to come from the cookie, and the comment here said possession of
 * that cookie was "the sole authorization" (#136 §2). The cookie is
 * plaintext JSON. `httpOnly` stops page JavaScript reading it; it does not
 * stop the browser's own user opening devtools and editing it. Every check
 * the route made — three `typeof`s and `payload.state !== state` — passed
 * unchanged when you altered the ONE field none of them looked at. Start
 * the flow, retype `companyId` as someone else's, finish Intuit's consent
 * with your own QuickBooks account, and the upsert wrote your realm and
 * your tokens under their company: their invoice and payment pushes post
 * into your books, and their real connection is overwritten and gone.
 *
 * So the cookie is now used for exactly one thing — carrying the CSRF
 * `state` to compare against Intuit's — and identity is read from the
 * authenticated session instead. A value the browser can rewrite cannot
 * decide whose books get connected; a session cookie it cannot forge can.
 *
 * The route is still outside middleware's protected-route matcher, and
 * that is still deliberate: `auth.protect()` there would bounce an expired
 * token into a sign-in detour mid-flow. But being outside the matcher does
 * NOT mean there is no session to read. clerkMiddleware still RUNS on this
 * path (the matcher in middleware.ts covers `/(api|trpc)(.*)`) and
 * decorates every request it handles with the auth headers `auth()` reads,
 * whether or not the handler called protect. Verified against the
 * installed @clerk/nextjs 6.39.6: clerkMiddleware.js calls decorateRequest
 * unconditionally, after the user handler, on every matched request.
 *
 * The identity in the cookie is kept, but only as a cross-check: if the
 * person who finishes the flow is not the one who started it — they
 * switched accounts in another tab — that is a mismatch and the connection
 * is refused rather than pointed at whichever company happens to win.
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

  // The session, not the cookie, decides whose books these are. Anonymous
  // gets redirected to sign-in by requireCompanyContext, which is the right
  // answer: nothing may be written for a caller we cannot identify.
  const context = await requireCompanyContext();

  // OWNER-only, matching the gate on /api/quickbooks/start and on the
  // /settings page. Re-checked here because a role can change during the
  // minute someone spends on Intuit's consent and 2FA screens, and because
  // a check that exists only at the start of a flow is not a check on the
  // step that actually writes.
  if (context.role !== "OWNER") {
    return settingsRedirect(request, "error", "not_owner");
  }

  // Defence in depth, and the check the rewritten-cookie attack dies on:
  // whoever finishes this flow must be whoever started it. A mismatch is a
  // tampered cookie or a mid-flow account switch, and neither is something
  // to resolve by picking one of the two answers.
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("QuickBooks OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return settingsRedirect(request, "error", "identity_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    await prisma.quickBooksConnection.upsert({
      where: { companyId: context.company.id },
      create: {
        companyId: context.company.id,
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: context.id,
      },
      update: {
        realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        connectedByUserId: context.id,
      },
    });
  } catch (error) {
    console.error("QuickBooks token exchange failed", error);
    return settingsRedirect(request, "error", "token_exchange_failed");
  }

  return settingsRedirect(request, "connected");
}
