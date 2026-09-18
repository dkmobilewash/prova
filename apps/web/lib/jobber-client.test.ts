import { describe, expect, it } from "vitest";
// The client lives in the integrations package (a package cannot import from
// an app); tested from here because this is where vitest lives — the same
// arrangement as quickbooks-retry.test.ts.
import {
  JOBBER_GRAPHQL_URL,
  JOBBER_GRAPHQL_VERSION,
  JOBBER_MAX_RETRIES,
  JOBBER_TOKEN_URL,
  JobberApiError,
  JobberAuthError,
  JobberUnauthorizedError,
  exchangeJobberCode,
  jobberAllPages,
  jobberAuthorizeUrl,
  jobberGraphql,
  jobberTokenExpiresAt,
  readJobberConfig,
  refreshJobberTokens,
  throttleWaitMs,
} from "../../../packages/integrations/src/jobber";

/**
 * Jobber's HTTP, mocked. No test here reaches the network: every request
 * goes to a `fetchImpl` that records it and answers from a script, and
 * every wait goes to a `sleep` that records the delay instead of waiting.
 */

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function scripted(answers: (Response | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request ${calls.length} to ${url}`);
    return typeof next === "function" ? next(call) : next;
  };
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { calls, fetchImpl, sleep, waits, remaining: () => answers.length };
}

const CONFIG = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://app.cstream.ai/api/jobber/callback" };

describe("config", () => {
  it("is null when any of the three is missing or blank, never a throw", () => {
    expect(readJobberConfig({})).toBeNull();
    expect(readJobberConfig({ JOBBER_CLIENT_ID: "a", JOBBER_CLIENT_SECRET: "b" })).toBeNull();
    expect(readJobberConfig({ JOBBER_CLIENT_ID: "a", JOBBER_CLIENT_SECRET: " ", JOBBER_REDIRECT_URI: "c" })).toBeNull();
    expect(readJobberConfig({ JOBBER_CLIENT_ID: "a", JOBBER_CLIENT_SECRET: "b", JOBBER_REDIRECT_URI: "c" })).toEqual({
      clientId: "a",
      clientSecret: "b",
      redirectUri: "c",
    });
  });
});

describe("authorize URL", () => {
  it("carries state and an S256 PKCE challenge, and no scope parameter (scopes live in the Developer Center)", () => {
    const url = new URL(jobberAuthorizeUrl(CONFIG, "st4te", "ch4llenge"));
    expect(url.origin + url.pathname).toBe("https://api.getjobber.com/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: CONFIG.redirectUri,
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
    });
  });
});

describe("token endpoint", () => {
  it("exchanges a code form-encoded, with the PKCE verifier", async () => {
    const http = scripted([json({ access_token: "A1", refresh_token: "R1", expires_in: 3600 })]);
    await expect(exchangeJobberCode(CONFIG, "code-1", "verifier-1", http.fetchImpl)).resolves.toEqual({
      accessToken: "A1",
      refreshToken: "R1",
    });
    expect(http.calls[0].url).toBe(JOBBER_TOKEN_URL);
    expect((http.calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(http.calls[0].init.body)))).toEqual({
      client_id: "cid",
      client_secret: "csecret",
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: CONFIG.redirectUri,
      code_verifier: "verifier-1",
    });
  });

  it("refreshes with grant_type=refresh_token and returns the ROTATED refresh token", async () => {
    const http = scripted([json({ access_token: "A2", refresh_token: "R2-rotated" })]);
    await expect(refreshJobberTokens(CONFIG, "R1", http.fetchImpl)).resolves.toEqual({
      accessToken: "A2",
      refreshToken: "R2-rotated",
    });
    expect(Object.fromEntries(new URLSearchParams(String(http.calls[0].init.body)))).toEqual({
      client_id: "cid",
      client_secret: "csecret",
      grant_type: "refresh_token",
      refresh_token: "R1",
    });
  });

  it("names invalid_grant, and never puts the response body in the message", async () => {
    const http = scripted([json({ error: "invalid_grant", error_description: "secret-ish R1 is dead" }, 400)]);
    const error = await refreshJobberTokens(CONFIG, "R1", http.fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(JobberAuthError);
    expect(error.invalidGrant).toBe(true);
    expect(error.message).not.toContain("R1");
  });
});

describe("JWT expiry", () => {
  it("reads exp without verifying, and is null for anything unreadable", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
    expect(jobberTokenExpiresAt(`h.${payload}.s`)?.toISOString()).toBe(new Date(1_800_000_000_000).toISOString());
    expect(jobberTokenExpiresAt("opaque-token")).toBeNull();
    expect(jobberTokenExpiresAt("h.!!!.s")).toBeNull();
  });
});

describe("one GraphQL request", () => {
  it("sends the bearer token and the required version header", async () => {
    const http = scripted([json({ data: { ok: true } })]);
    await jobberGraphql("tok", "query { ok }", {}, http);
    expect(http.calls[0].url).toBe(JOBBER_GRAPHQL_URL);
    const headers = http.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-JOBBER-GRAPHQL-VERSION"]).toBe(JOBBER_GRAPHQL_VERSION);
  });

  it("waits and retries a THROTTLED answer (HTTP 200), for as long as the bucket needs to refill", async () => {
    const throttled = json({
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: { cost: { requestedQueryCost: 3000, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 500, restoreRate: 500 } } },
    });
    const http = scripted([throttled, json({ data: { ok: 1 } })]);
    await expect(jobberGraphql("tok", "q", {}, http)).resolves.toEqual({ ok: 1 });
    expect(http.calls).toHaveLength(2);
    // (3000 - 500) / 500 per second = 5s, plus a margin.
    expect(http.waits).toEqual([5250]);
  });

  it("gives up with a sentence after JOBBER_MAX_RETRIES throttles instead of looping", async () => {
    const throttled = () => json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    const http = scripted(Array.from({ length: JOBBER_MAX_RETRIES + 1 }, throttled));
    await expect(jobberGraphql("tok", "q", {}, http)).rejects.toThrow(JobberApiError);
    expect(http.calls).toHaveLength(JOBBER_MAX_RETRIES + 1);
    expect(http.remaining()).toBe(0);
  });

  it("retries an HTTP 429 after Retry-After", async () => {
    const http = scripted([json({}, 429, { "retry-after": "3" }), json({ data: { ok: 1 } })]);
    await expect(jobberGraphql("tok", "q", {}, http)).resolves.toEqual({ ok: 1 });
    expect(http.waits).toEqual([3000]);
  });

  it("throws JobberUnauthorizedError on 401 so the caller can refresh", async () => {
    const http = scripted([json({ message: "expired" }, 401)]);
    await expect(jobberGraphql("tok", "q", {}, http)).rejects.toBeInstanceOf(JobberUnauthorizedError);
  });

  it("surfaces any other GraphQL error by its message — how a renamed field would announce itself", async () => {
    const http = scripted([json({ errors: [{ message: "Field 'quoteStatus' doesn't exist on type 'Quote'" }] })]);
    await expect(jobberGraphql("tok", "q", {}, http)).rejects.toThrow(/quoteStatus/);
  });

  it("throttleWaitMs falls back to two seconds without numbers, and is capped", () => {
    expect(throttleWaitMs(undefined)).toBe(2000);
    expect(throttleWaitMs({ requestedQueryCost: 1e9, throttleStatus: { currentlyAvailable: 0, restoreRate: 1 } })).toBe(15_000);
  });
});

describe("pagination", () => {
  const page = (ids: string[], next: string | null) =>
    json({ data: { clients: { nodes: ids.map((id) => ({ id })), pageInfo: { hasNextPage: next !== null, endCursor: next }, totalCount: 5 } } });

  it("walks every page in order, passing each endCursor as `after`, and stops at the last", async () => {
    const http = scripted([page(["a", "b"], "c1"), page(["c", "d"], "c2"), page(["e"], null)]);
    const result = await jobberAllPages<{ id: string }>("tok", "q", "clients", { pageSize: 2, limit: 100 }, http);
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.truncated).toBe(false);
    expect(result.totalCount).toBe(5);
    const afters = http.calls.map((call) => JSON.parse(String(call.init.body)).variables.after);
    expect(afters).toEqual([null, "c1", "c2"]);
    // Requested three pages, got three answers, and asked for no fourth.
    expect(http.calls).toHaveLength(3);
    expect(http.remaining()).toBe(0);
  });

  it("stops at the limit and says the read was partial", async () => {
    const http = scripted([page(["a", "b"], "c1"), page(["c", "d"], "c2")]);
    const result = await jobberAllPages<{ id: string }>("tok", "q", "clients", { pageSize: 2, limit: 3 }, http);
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(true);
    expect(http.calls).toHaveLength(2);
  });

  it("refuses to loop when Jobber says there is a next page but hands back the same cursor", async () => {
    const http = scripted([page(["a"], "same"), page(["b"], "same")]);
    await expect(
      jobberAllPages<{ id: string }>("tok", "q", "clients", { pageSize: 1, limit: 100 }, http),
    ).rejects.toThrow(/did not move/);
    expect(http.calls).toHaveLength(2);
  });

  it("keeps walking through a throttle in the middle of the pages", async () => {
    const throttled = json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    const http = scripted([page(["a"], "c1"), throttled, page(["b"], null)]);
    const result = await jobberAllPages<{ id: string }>("tok", "q", "clients", { pageSize: 1, limit: 100 }, http);
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(http.waits).toHaveLength(1);
  });
});
