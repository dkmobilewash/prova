import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { jobberAuthorizeUrl, readJobberConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import {
  JOBBER_OAUTH_STATE_COOKIE,
  JOBBER_OAUTH_STATE_MAX_AGE_SECONDS,
  type JobberOAuthCookiePayload,
} from "@/lib/jobber/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("jobber", "error");
  url.searchParams.set("jobber_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the Jobber OAuth flow. OWNER-only, like the Integrations page. A
 * Route Handler rather than a Server Action for the reason
 * /api/quickbooks/start gives: setting a cookie and redirecting OFF-SITE is
 * what NextResponse.redirect does reliably.
 *
 * Refuses before anything leaves this app when the install is not set up —
 * including the encryption key, because a flow that completes and then
 * cannot store what it got is worse than one that never starts.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readJobberConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  // PKCE (S256, the only method Jobber accepts): 43-128 chars of verifier.
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const payload: JobberOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    codeVerifier,
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(jobberAuthorizeUrl(config, payload.state, codeChallenge));
  response.cookies.set(JOBBER_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: JOBBER_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
