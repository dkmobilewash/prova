import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { PROCORE_OAUTH_STATE_COOKIE } from "@/lib/procore/constants";

/**
 * The Procore OAuth callback binds the connection to the SIGNED-IN company,
 * never to anything the browser supplied (the QuickBooks #136 §2 lesson),
 * and refuses — writing nothing and exchanging nothing — on a state that
 * does not match. Both directions are asserted: a callback that refused
 * everyone would pass every attack test and be a total outage.
 */

let context: { id: string; role: string; company: { id: string } } | null = null;
let cookieJar = new Map<string, string>();
let exchanged: { code: string; verifier: string }[] = [];
let written: { create: Record<string, unknown>; where: unknown }[] = [];
let logs: Record<string, unknown>[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

vi.mock("@prova/integrations", () => ({
  readProcoreConfig: () => ({ clientId: "cid", clientSecret: "cs", redirectUri: "https://app.cstream.ai/api/procore/callback", environment: "production", hosts: { login: "https://login.procore.com", api: "https://api.procore.com", web: "https://app.procore.com" } }),
  exchangeProcoreCode: async (_config: unknown, code: string, verifier: string) => {
    exchanged.push({ code, verifier });
    return { accessToken: "procore-access-PLAINTEXT", refreshToken: "procore-refresh-PLAINTEXT", expiresAt: new Date(Date.now() + 5400_000) };
  },
  fetchProcoreMe: async () => ({ id: "4242", name: "Sam Sub" }),
}));

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

const STATE = "a".repeat(48);

function callback(state = STATE, extra = "") {
  return new NextRequest(`https://app.cstream.ai/api/procore/callback?code=procore-code&state=${state}${extra}`);
}

function outcome(response: Response) {
  const location = new URL(response.headers.get("location") ?? "", "https://app.cstream.ai");
  return { path: location.pathname, procore: location.searchParams.get("procore"), detail: location.searchParams.get("procore_detail") };
}

function cookie(fields: Partial<{ state: string; codeVerifier: string; companyId: string; userId: string }> = {}) {
  cookieJar.set(
    PROCORE_OAUTH_STATE_COOKIE,
    JSON.stringify({ state: STATE, codeVerifier: "v".repeat(64), companyId: "co_A", userId: "user_A", ...fields }),
  );
}

beforeEach(() => {
  context = { id: "user_A", role: "OWNER", company: { id: "co_A" } };
  cookieJar = new Map();
  exchanged = [];
  written = [];
  logs = [];
});

describe("Procore OAuth callback", () => {
  it("refuses a state that doesn't match the cookie — nothing exchanged, nothing written", async () => {
    cookie({ state: "b".repeat(48) });
    expect(outcome(await GET(callback()))).toEqual({ path: "/settings/integrations", procore: "error", detail: "state_mismatch" });
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

  it("refuses a non-owner", async () => {
    context = { id: "user_A", role: "MEMBER", company: { id: "co_A" } };
    cookie();
    expect(outcome(await GET(callback())).detail).toBe("not_owner");
    expect(written).toEqual([]);
  });

  it("connects the SESSION's company, with the PKCE verifier, storing only encrypted tokens", async () => {
    cookie();
    expect(outcome(await GET(callback()))).toEqual({ path: "/settings/integrations", procore: "connected", detail: null });
    expect(exchanged).toEqual([{ code: "procore-code", verifier: "v".repeat(64) }]);
    expect(written).toHaveLength(1);
    expect(written[0].where).toEqual({ companyId_provider: { companyId: "co_A", provider: "PROCORE" } });
    const stored = JSON.stringify(written[0]);
    expect(stored).not.toContain("PLAINTEXT");
    expect(written[0].create).toEqual(
      expect.objectContaining({ companyId: "co_A", status: "CONNECTED", externalAccountLabel: "Sam Sub" }),
    );
    expect(String(written[0].create.encryptedAccessToken).startsWith("v1.")).toBe(true);
    expect(logs).toHaveLength(1);
    // The cookie is single-use.
    expect(cookieJar.has(PROCORE_OAUTH_STATE_COOKIE)).toBe(false);
  });

  it("treats a declined consent as a refusal, not a connection", async () => {
    cookie();
    expect(outcome(await GET(callback(STATE, "&error=access_denied"))).detail).toBe("access_denied");
    expect(written).toEqual([]);
  });
});
