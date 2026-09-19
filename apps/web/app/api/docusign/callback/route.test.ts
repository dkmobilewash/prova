import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { DOCUSIGN_OAUTH_STATE_COOKIE } from "@/lib/docusign/constants";

/**
 * The DocuSign OAuth callback binds the connection to the SIGNED-IN
 * company, never to anything the browser supplied, and refuses — calling
 * nothing at DocuSign and writing nothing — on a state that does not match.
 * Both directions are asserted: a callback that refused everyone would pass
 * every attack test and be a total outage. The start route's owner and
 * not-set-up refusals are at the bottom.
 */

let context: { id: string; role: string; company: { id: string } } | null = null;
let cookieJar = new Map<string, string>();
let exchanged: { code: string; verifier: string }[] = [];
let userinfoCalls = 0;
let userinfoFails = false;
let written: { create: Record<string, unknown>; where: unknown }[] = [];
let logs: Record<string, unknown>[] = [];
let configured = true;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

vi.mock("@prova/integrations", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/integrations")>();
  return {
    ...real,
    readDocuSignConfig: () =>
      configured
        ? {
            clientId: "ik",
            clientSecret: "cs",
            redirectUri: "https://app.cstream.ai/api/docusign/callback",
            environment: "demo",
            oauthHost: "account-d.docusign.com",
          }
        : null,
    exchangeDocuSignCode: async (_config: unknown, code: string, verifier: string) => {
      exchanged.push({ code, verifier });
      return { accessToken: "ds-access-PLAINTEXT", refreshToken: "ds-refresh-PLAINTEXT", expiresIn: 28800 };
    },
    fetchDocuSignAccount: async () => {
      userinfoCalls++;
      if (userinfoFails) throw new Error("userinfo 500");
      return { accountId: "acct-1", accountName: "Smith Drywall", baseUri: "https://demo.docusign.net" };
    },
  };
});

vi.mock("@prova/db", () => {
  const tx = {
    integrationConnection: {
      upsert: async (args: { where: unknown; create: Record<string, unknown> }) => {
        written.push(args);
        return { id: "conn_1" };
      },
    },
    integrationSyncLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return data;
      },
    },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => {
    if (!context) throw new Error("NEXT_REDIRECT");
    return context;
  },
}));

process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");
const { GET } = await import("./route");
const { GET: START } = await import("../start/route");
const { openAccess } = await import("@/lib/docusign/connection");
const { decryptSecret } = await import("@/lib/crypto");

const STATE = "a".repeat(48);

function callback(state = STATE, extra = "") {
  return new NextRequest(`https://app.cstream.ai/api/docusign/callback?code=ds-code&state=${state}${extra}`);
}

function outcome(response: Response) {
  const location = new URL(response.headers.get("location") ?? "", "https://app.cstream.ai");
  return {
    path: location.pathname,
    docusign: location.searchParams.get("docusign"),
    detail: location.searchParams.get("docusign_detail"),
  };
}

function cookie(fields: Partial<{ state: string; codeVerifier: string; companyId: string; userId: string }> = {}) {
  cookieJar.set(
    DOCUSIGN_OAUTH_STATE_COOKIE,
    JSON.stringify({ state: STATE, codeVerifier: "v".repeat(64), companyId: "co_A", userId: "user_A", ...fields }),
  );
}

beforeEach(() => {
  context = { id: "user_A", role: "OWNER", company: { id: "co_A" } };
  cookieJar = new Map();
  exchanged = [];
  userinfoCalls = 0;
  userinfoFails = false;
  written = [];
  logs = [];
  configured = true;
});

describe("DocuSign OAuth callback", () => {
  it("refuses a state that doesn't match the cookie — nothing exchanged, nothing written", async () => {
    cookie({ state: "b".repeat(48) });
    expect(outcome(await GET(callback()))).toEqual({ path: "/settings/integrations", docusign: "error", detail: "state_mismatch" });
    expect(exchanged).toEqual([]);
    expect(written).toEqual([]);
  });

  it("refuses when the state cookie is missing altogether", async () => {
    expect(outcome(await GET(callback())).detail).toBe("state_mismatch");
    expect(exchanged).toEqual([]);
  });

  it("refuses a cookie whose companyId was rewritten to another company", async () => {
    cookie({ companyId: "co_victim" });
    expect(outcome(await GET(callback())).detail).toBe("identity_mismatch");
    expect(exchanged).toEqual([]);
    expect(written).toEqual([]);
  });

  it("refuses a non-owner, even with a matching state", async () => {
    context = { id: "user_A", role: "MEMBER", company: { id: "co_A" } };
    cookie();
    expect(outcome(await GET(callback())).detail).toBe("not_owner");
    expect(exchanged).toEqual([]);
    expect(written).toEqual([]);
  });

  it("connects the SESSION's company with the PKCE verifier, storing only encrypted tokens and the account", async () => {
    cookie();
    expect(outcome(await GET(callback()))).toEqual({ path: "/settings/integrations", docusign: "connected", detail: null });
    expect(exchanged).toEqual([{ code: "ds-code", verifier: "v".repeat(64) }]);
    expect(written).toHaveLength(1);
    expect(written[0].where).toEqual({ companyId_provider: { companyId: "co_A", provider: "DOCUSIGN" } });
    expect(JSON.stringify(written[0])).not.toContain("PLAINTEXT");
    expect(written[0].create).toEqual(
      expect.objectContaining({
        companyId: "co_A",
        provider: "DOCUSIGN",
        status: "CONNECTED",
        externalAccountId: "acct-1",
        externalAccountLabel: "Smith Drywall",
        scopes: ["signature", "extended"],
      }),
    );
    const access = openAccess(String(written[0].create.encryptedAccessToken));
    expect(access.accessToken).toBe("ds-access-PLAINTEXT");
    expect(access.baseUri).toBe("https://demo.docusign.net");
    expect(decryptSecret(String(written[0].create.encryptedRefreshToken))).toBe("ds-refresh-PLAINTEXT");
    expect(logs).toHaveLength(1);
    expect(cookieJar.has(DOCUSIGN_OAUTH_STATE_COOKIE)).toBe(false);
  });

  it("writes nothing when DocuSign will not say which account to send from", async () => {
    cookie();
    userinfoFails = true;
    expect(outcome(await GET(callback())).detail).toBe("no_account");
    expect(userinfoCalls).toBe(1);
    expect(written).toEqual([]);
  });

  it("treats a declined consent as a refusal, not a connection", async () => {
    cookie();
    expect(outcome(await GET(callback(STATE, "&error=access_denied"))).detail).toBe("access_denied");
    expect(written).toEqual([]);
  });
});

describe("DocuSign OAuth start", () => {
  const start = () => START(new NextRequest("https://app.cstream.ai/api/docusign/start"));

  it("is owner-only: a member is sent back, no cookie is set, nothing leaves for DocuSign", async () => {
    context = { id: "user_B", role: "MEMBER", company: { id: "co_A" } };
    const response = await start();
    expect(outcome(response).detail).toBe("not_owner");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses before redirecting when the install is not set up", async () => {
    configured = false;
    const response = await start();
    expect(outcome(response).detail).toBe("not_configured");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends the owner to DocuSign's demo consent screen with state and S256 PKCE, and sets the state cookie", async () => {
    const response = await start();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://account-d.docusign.com/oauth/auth");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(DOCUSIGN_OAUTH_STATE_COOKIE);
    expect(setCookie.toLowerCase()).toContain("httponly");
    const payload = JSON.parse(decodeURIComponent(/docusign_oauth_state=([^;]+)/.exec(setCookie)?.[1] ?? "{}"));
    expect(payload.state).toBe(location.searchParams.get("state"));
    expect(payload.companyId).toBe("co_A");
  });
});
