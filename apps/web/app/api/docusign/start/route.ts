import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { docuSignAuthorizeUrl, readDocuSignConfig } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { integrationEncryptionConfigured } from "@/lib/crypto";
import {
  DOCUSIGN_OAUTH_STATE_COOKIE,
  DOCUSIGN_OAUTH_STATE_MAX_AGE_SECONDS,
  type DocuSignOAuthCookiePayload,
} from "@/lib/docusign/constants";

function back(request: NextRequest, detail: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("docusign", "error");
  url.searchParams.set("docusign_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Starts the DocuSign OAuth flow (Confidential Authorization Code Grant with
 * PKCE). OWNER-only, like the Integrations page and /api/jobber/start. A
 * Route Handler rather than a Server Action because it sets a cookie and
 * redirects off-site.
 *
 * Refuses before anything leaves this app when the install is not set up —
 * including the encryption key: a flow that completes and then cannot store
 * what it got is worse than one that never starts.
 */
export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "not_owner");

  const config = readDocuSignConfig();
  if (!config || !integrationEncryptionConfigured()) return back(request, "not_configured");

  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const payload: DocuSignOAuthCookiePayload = {
    state: randomBytes(24).toString("hex"),
    codeVerifier,
    companyId: context.company.id,
    userId: context.id,
  };

  const response = NextResponse.redirect(docuSignAuthorizeUrl(config, payload.state, codeChallenge));
  response.cookies.set(DOCUSIGN_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: DOCUSIGN_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
