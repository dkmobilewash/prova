import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAuthorizeUrl } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { QUICKBOOKS_OAUTH_STATE_COOKIE, type QuickBooksOAuthCookiePayload } from "@/lib/quickbooks-constants";

const QUICKBOOKS_OAUTH_STATE_MAX_AGE_SECONDS = 600;

/**
 * Starts the QuickBooks OAuth flow. OWNER-only, matching the /settings
 * page's access gate. A plain Route Handler rather than a Server Action —
 * Server Actions have known quirks setting cookies on a redirect() to an
 * EXTERNAL origin (Intuit's authorize screen); NextResponse.redirect()
 * with .cookies.set() is the standard, reliable way to do "set cookie,
 * then redirect off-site." See QuickBooksOAuthCookiePayload for what the
 * cookie carries and why.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") {
    return NextResponse.redirect(new URL("/settings", request.url));
  }

  const payload: QuickBooksOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(getAuthorizeUrl(payload.state));
  response.cookies.set(QUICKBOOKS_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: QUICKBOOKS_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
