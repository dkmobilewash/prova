import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { bluebeamAuthorizeUrl, readBluebeamConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import { BLUEBEAM_OAUTH_STATE_COOKIE, BLUEBEAM_OAUTH_STATE_MAX_AGE_SECONDS, type BluebeamOAuthCookiePayload } from "@/lib/bluebeam/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("bluebeam", "error");
  url.searchParams.set("bluebeam_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the Bluebeam OAuth flow. OWNER-only, like the Integrations page.
 * A Route Handler for the reason /api/companycam/start gives: setting a
 * cookie and redirecting OFF-SITE is what NextResponse.redirect does
 * reliably.
 *
 * Refuses before anything leaves this app when the install is not set up,
 * including the encryption key. No PKCE — see bluebeamAuthorizeUrl.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readBluebeamConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  const payload: BluebeamOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(bluebeamAuthorizeUrl(config, payload.state));
  response.cookies.set(BLUEBEAM_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: BLUEBEAM_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
