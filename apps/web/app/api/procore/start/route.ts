import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { procoreAuthorizeUrl, readProcoreConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import {
  PROCORE_OAUTH_STATE_COOKIE,
  PROCORE_OAUTH_STATE_MAX_AGE_SECONDS,
  type ProcoreOAuthCookiePayload,
} from "@/lib/procore/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("procore", "error");
  url.searchParams.set("procore_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the Procore OAuth flow. OWNER-only, like the Integrations page. A
 * Route Handler for the reason /api/jobber/start gives: setting a cookie and
 * redirecting OFF-SITE is what NextResponse.redirect does reliably.
 *
 * Refuses before anything leaves this app when the install is not set up,
 * including the encryption key.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readProcoreConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  // PKCE S256. Procore's docs do not mention PKCE (see the notes at the
  // bottom of packages/integrations/src/procore.ts); it is sent because it
  // costs nothing where unsupported and protects the code where supported.
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const payload: ProcoreOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    codeVerifier,
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(procoreAuthorizeUrl(config, payload.state, codeChallenge));
  response.cookies.set(PROCORE_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: PROCORE_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
