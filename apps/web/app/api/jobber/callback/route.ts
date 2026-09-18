import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeJobberCode, fetchJobberAccount, readJobberConfig } from "@prova/integrations";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { JOBBER_OAUTH_STATE_COOKIE, readJobberCookie } from "@/lib/jobber/constants";

function back(request: NextRequest, outcome: "connected" | "error", detail?: string) {
  const url = new URL("/settings/integrations", request.url);
  url.searchParams.set("jobber", outcome);
  if (detail) url.searchParams.set("jobber_detail", detail);
  return NextResponse.redirect(url);
}

/**
 * Finishes the Jobber OAuth flow started by /api/jobber/start.
 *
 * Built on the QuickBooks callback's lesson (#136 §2, see the long comment
 * in app/api/quickbooks/callback/route.ts): WHOSE ACCOUNT THIS IS COMES FROM
 * THE SESSION, NEVER THE COOKIE. The cookie is the browser's own and can be
 * edited; it carries the CSRF `state` and the PKCE verifier, and a copy of
 * who started the flow purely as a cross-check.
 *
 * Refuses, writing nothing and calling nothing at Jobber, when:
 *   - the state that came back is not the one this browser was given
 *     (CSRF, or a code from somebody else's flow);
 *   - nobody is signed in, or they are not the owner;
 *   - the person finishing is not the person who started.
 *
 * Like /api/quickbooks/callback it is outside middleware's protected list,
 * so an expired session is not bounced to sign-in halfway through the
 * exchange — but clerkMiddleware still runs on /api and the session is read
 * here all the same.
 *
 * Tokens are encrypted before they reach Prisma, and no log line here
 * includes a token, a code, the state or an id.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const payload = readJobberCookie(cookieStore.get(JOBBER_OAUTH_STATE_COOKIE)?.value);
  cookieStore.delete(JOBBER_OAUTH_STATE_COOKIE);

  if (params.get("error")) return back(request, "error", "access_denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "error", "missing_params");

  if (!payload || payload.state !== state) {
    console.warn("Jobber OAuth state mismatch", { hadCookie: payload !== null });
    return back(request, "error", "state_mismatch");
  }

  const context = await requireCompanyContext();
  if (context.role !== "OWNER") return back(request, "error", "not_owner");
  if (payload.companyId !== context.company.id || payload.userId !== context.id) {
    console.warn("Jobber OAuth identity mismatch", {
      cookieMatchedSessionCompany: payload.companyId === context.company.id,
      cookieMatchedSessionUser: payload.userId === context.id,
    });
    return back(request, "error", "identity_mismatch");
  }

  const config = readJobberConfig();
  if (!config) return back(request, "error", "not_configured");

  let accessToken: string;
  let refreshToken: string;
  try {
    ({ accessToken, refreshToken } = await exchangeJobberCode(config, code, payload.codeVerifier));
  } catch (error) {
    console.error("Jobber token exchange failed", { name: (error as Error)?.name, message: (error as Error)?.message });
    return back(request, "error", "token_exchange_failed");
  }

  // Which Jobber account, for the card. Best effort: a connection that
  // works but cannot say its own name is still a connection.
  let account = { id: null as string | null, name: "Jobber account" };
  try {
    const found = await fetchJobberAccount(accessToken);
    account = { id: found.id, name: found.name };
  } catch (error) {
    console.warn("Jobber account lookup failed", { message: (error as Error)?.message });
  }

  const companyId = context.company.id;
  const now = new Date();
  const fields = {
    status: "CONNECTED" as const,
    externalAccountId: account.id,
    externalAccountLabel: account.name,
    // Jobber grants the scopes ticked on the app in its Developer Center;
    // the token response does not list them, so none are claimed here.
    scopes: [] as string[],
    encryptedAccessToken: encryptSecret(accessToken),
    encryptedRefreshToken: encryptSecret(refreshToken),
    connectedByUserId: context.id,
    connectedAt: now,
    disconnectedAt: null,
  };

  await prisma.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider: "JOBBER" } },
      create: { companyId, provider: "JOBBER", ...fields },
      update: fields,
      select: { id: true },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId: connection.id,
        direction: "PULL",
        status: "SUCCESS",
        message: `Connected to ${account.name}. Nothing is imported until you press Confirm.`,
        occurredAt: now,
      },
    });
  });

  return back(request, "connected");
}
