import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { companyCamAuthorizeUrl, readCompanyCamConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import {
  COMPANYCAM_OAUTH_STATE_COOKIE,
  COMPANYCAM_OAUTH_STATE_MAX_AGE_SECONDS,
  type CompanyCamOAuthCookiePayload,
} from "@/lib/companycam/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("companycam", "error");
  url.searchParams.set("companycam_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the CompanyCam OAuth flow. OWNER-only, like the Integrations
 * page. A Route Handler for the reason /api/jobber/start gives: setting a
 * cookie and redirecting OFF-SITE is what NextResponse.redirect does
 * reliably.
 *
 * Refuses before anything leaves this app when the install is not set up,
 * including the encryption key. No PKCE — see companyCamAuthorizeUrl.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readCompanyCamConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  const payload: CompanyCamOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(companyCamAuthorizeUrl(config, payload.state));
  response.cookies.set(COMPANYCAM_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COMPANYCAM_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
