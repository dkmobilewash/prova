import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { QUICKBOOKS_OAUTH_STATE_COOKIE } from "@/lib/quickbooks-constants";

/**
 * /api/quickbooks/start must refuse BEFORE calling out to
 * `getAuthorizeUrl` when this install has no QuickBooks client id/secret/
 * redirect URI. Without this guard, `getAuthorizeUrl`
 * (packages/integrations/src/quickbooks.ts) throws and the request 500s —
 * a dead button with extra steps, on the one route the "Connect
 * QuickBooks" link on /settings ultimately sends the browser to.
 *
 * The guard is asserted two ways: the redirect target says the right
 * thing, AND `getAuthorizeUrl` is proven never to have been called at all
 * (not merely that its result was discarded) — the mock throws if invoked,
 * so a regression that removes the early return fails loudly here instead
 * of silently returning to the old throw-and-500 behaviour.
 */

const ENV_KEYS = ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};

/** The session the route sees. Set per test. */
let context: { id: string; role: string; company: { id: string } } | null = null;

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => {
    if (!context) throw new Error("NEXT_REDIRECT");
    return context;
  },
}));

let getAuthorizeUrlCalls = 0;
vi.mock("@prova/integrations", () => ({
  getAuthorizeUrl: (state: string) => {
    getAuthorizeUrlCalls += 1;
    return `https://appcenter.intuit.com/connect/oauth2?state=${state}&client_id=configured-test-client-id`;
  },
}));

const { GET } = await import("./route");

function startRequest() {
  return new NextRequest("https://app.cstream.ai/api/quickbooks/start");
}

function outcome(response: Response) {
  const location = new URL(response.headers.get("location") ?? "", "https://app.cstream.ai");
  return {
    path: location.pathname,
    qb: location.searchParams.get("qb"),
    detail: location.searchParams.get("qb_detail"),
    fullLocation: location.toString(),
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  context = { id: "user_owner", role: "OWNER", company: { id: "co_owner" } };
  getAuthorizeUrlCalls = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("unconfigured install", () => {
  it("refuses before calling getAuthorizeUrl, and says why on /settings", async () => {
    const result = outcome(await GET(startRequest()));

    expect(getAuthorizeUrlCalls).toBe(0);
    expect(result).toMatchObject({ path: "/settings", qb: "error", detail: "not_configured" });
  });

  it("sets no OAuth state cookie when refusing early", async () => {
    const response = await GET(startRequest());
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses the same way with only one of the three variables missing", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    // QUICKBOOKS_REDIRECT_URI intentionally left unset.

    const result = outcome(await GET(startRequest()));

    expect(getAuthorizeUrlCalls).toBe(0);
    expect(result.detail).toBe("not_configured");
  });

  it("leaks no configured value into the redirect it sends when unconfigured", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id-should-not-appear";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret-should-not-appear";
    // QUICKBOOKS_REDIRECT_URI still unset, so this is still the refusal path.

    const result = outcome(await GET(startRequest()));

    expect(result.fullLocation).not.toContain("id-should-not-appear");
    expect(result.fullLocation).not.toContain("secret-should-not-appear");
  });
});

describe("configured install", () => {
  beforeEach(() => {
    process.env.QUICKBOOKS_CLIENT_ID = "configured-test-client-id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "configured-test-secret";
    process.env.QUICKBOOKS_REDIRECT_URI = "https://app.cstream.ai/api/quickbooks/callback";
  });

  it("calls getAuthorizeUrl exactly once and redirects to it", async () => {
    const response = await GET(startRequest());

    expect(getAuthorizeUrlCalls).toBe(1);
    expect(response.headers.get("location")).toContain("appcenter.intuit.com");
  });

  it("sets the OAuth state cookie", async () => {
    const response = await GET(startRequest());
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(QUICKBOOKS_OAUTH_STATE_COOKIE);
    expect(cookie).toContain("HttpOnly");
  });

  it("never reaches the configured branch for a non-owner, unchanged from before this fix", async () => {
    context = { id: "user_member", role: "MEMBER", company: { id: "co_owner" } };

    const result = outcome(await GET(startRequest()));

    expect(getAuthorizeUrlCalls).toBe(0);
    expect(result.path).toBe("/settings");
    expect(result.qb).toBeNull();
  });
});
