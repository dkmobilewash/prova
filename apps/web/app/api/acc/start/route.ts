import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { accAuthorizeUrl, readAccConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import { ACC_OAUTH_STATE_COOKIE, ACC_OAUTH_STATE_MAX_AGE_SECONDS, type AccOAuthCookiePayload } from "@/lib/acc/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("acc", "error");
  url.searchParams.set("acc_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the ACC OAuth flow. OWNER-only, like the Integrations page. A Route
 * Handler for the reason /api/procore/start gives: setting a cookie and
 * redirecting OFF-SITE is what NextResponse.redirect does reliably.
 *
 * Refuses before anything leaves this app when the install is not set up,
 * including the encryption key.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readAccConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  // PKCE S256 — REQUIRED by APS's authorize endpoint for this grant (see
  // packages/integrations/src/acc.ts's notes), unlike Procore where it is
  // sent speculatively.
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const payload: AccOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    codeVerifier,
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(accAuthorizeUrl(config, payload.state, codeChallenge));
  response.cookies.set(ACC_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ACC_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
