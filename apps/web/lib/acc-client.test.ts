import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACC_MAX_RETRIES,
  AccApiError,
  AccAuthError,
  AccForbiddenError,
  AccUnauthorizedError,
  accAllPages,
  accGet,
  accRateLimitWaitMs,
  accAuthorizeUrl,
  exchangeAccCode,
  fetchAccRfis,
  fetchAccSubmittals,
  listAccHubs,
  listAccProjects,
  readAccConfig,
  refreshAccTokens,
  type AccConfig,
} from "@prova/integrations";

/**
 * The ACC client with HTTP mocked — no request leaves the process. Same
 * shape as lib/procore-client.test.ts.
 *
 * Every fake here RECORDS every request, and the read-only test at the
 * bottom runs every reader the feed uses and then counts: the number of
 * requests it inspected must equal the number the fake saw, so a reader
 * that made no request at all cannot pass it by having nothing to inspect.
 */

const ENV = {
  ACC_CLIENT_ID: "cid",
  ACC_CLIENT_SECRET: "csecret",
  ACC_REDIRECT_URI: "https://app.cstream.ai/api/acc/callback",
};
const config = readAccConfig(ENV) as AccConfig;

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string };

function recorder(answer: (seen: Seen, n: number) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const entry: Seen = {
      url: input,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? String(init.body) : undefined,
    };
    seen.push(entry);
    return answer(entry, seen.length);
  };
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const noSleep = { sleep: async () => {} };

describe("config", () => {
  it("is null when any required variable is missing — never a throw", () => {
    expect(readAccConfig({})).toBeNull();
    expect(readAccConfig({ ...ENV, ACC_CLIENT_SECRET: " " })).toBeNull();
  });

  it("puts state, scope and an S256 challenge on the authorize URL", () => {
    const url = new URL(accAuthorizeUrl(config, "st4te", "ch4llenge"));
    expect(url.origin + url.pathname).toBe("https://developer.api.autodesk.com/authentication/v2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: ENV.ACC_REDIRECT_URI,
      scope: "data:read account:read",
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
    });
  });
});

describe("tokens", () => {
  it("exchanges a code with the verifier over HTTP Basic auth, and computes expiry from expires_in", async () => {
    const { seen, fetchImpl } = recorder(() => json({ access_token: "A1", refresh_token: "R1", expires_in: 3600 }));
    const now = () => new Date("2026-09-19T12:00:00Z");
    const tokens = await exchangeAccCode(config, "code-1", "verifier-1", fetchImpl, now);
    expect(tokens.accessToken).toBe("A1");
    expect(tokens.expiresAt?.toISOString()).toBe(new Date("2026-09-19T13:00:00Z").toISOString());
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://developer.api.autodesk.com/authentication/v2/token");
    // The secret rides the Authorization header, never the form body.
    expect(seen[0].headers.Authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(seen[0].body).not.toContain("csecret");
    const form = Object.fromEntries(new URLSearchParams(seen[0].body));
    expect(form).toEqual(
      expect.objectContaining({ grant_type: "authorization_code", code: "code-1", code_verifier: "verifier-1" }),
    );
    expect(form.client_secret).toBeUndefined();
  });

  it("flags invalid_grant on a refresh, and never puts the body in the message", async () => {
    const { fetchImpl } = recorder(() => json({ error: "invalid_grant", access_token: "LEAK" }, 400));
    const error = await refreshAccTokens(config, "R-dead", fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(AccAuthError);
    expect(error.invalidGrant).toBe(true);
    expect(error.message).not.toContain("LEAK");
    expect(error.message).not.toContain("R-dead");
  });
});

describe("accGet", () => {
  it("sends Bearer auth and refuses a path outside the allowed read paths before any request", async () => {
    const { seen, fetchImpl } = recorder(() => json([]));
    await accGet(config, "tok", "/construction/rfis/v2/projects/9/rfis", {}, { fetchImpl });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.Authorization).toBe("Bearer tok");

    await expect(accGet(config, "tok", "https://evil.example/x", {}, { fetchImpl })).rejects.toThrow(/outside the allowed/);
    await expect(accGet(config, "tok", "/oss/v2/buckets", {}, { fetchImpl })).rejects.toThrow(/outside the allowed/);
    expect(seen).toHaveLength(1); // neither refusal made a request
  });

  it("waits for Retry-After on a 429 and retries", async () => {
    const { seen, fetchImpl } = recorder((_s, n) => (n === 1 ? json({}, 429, { "retry-after": "3" }) : json([{ id: "1" }])));
    const waits: number[] = [];
    const { body } = await accGet(config, "tok", "/construction/rfis/v2/projects/9/rfis", {}, {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(body).toEqual([{ id: "1" }]);
    expect(seen).toHaveLength(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(3000);
    expect(waits[0]).toBeLessThan(3000 + 250);
  });

  it("gives up after ACC_MAX_RETRIES 429s with a sentence, not a hang", async () => {
    const { seen, fetchImpl } = recorder(() => json({}, 429));
    const error = await accGet(config, "tok", "/construction/rfis/v2/projects/9/rfis", {}, { fetchImpl, ...noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(AccApiError);
    expect(error.message).toMatch(/limiting/);
    expect(seen).toHaveLength(ACC_MAX_RETRIES + 1);
  });

  it("defaults to a 5s wait when Retry-After is absent", () => {
    expect(accRateLimitWaitMs(new Headers())).toBe(5000);
  });

  it("maps 401 and 403 to their own errors", async () => {
    const unauthorized = recorder(() => json({}, 401));
    await expect(
      accGet(config, "tok", "/construction/rfis/v2/projects/9/rfis", {}, { fetchImpl: unauthorized.fetchImpl }),
    ).rejects.toBeInstanceOf(AccUnauthorizedError);
    const forbidden = recorder(() => json({}, 403));
    await expect(
      accGet(config, "tok", "/construction/rfis/v2/projects/9/rfis", {}, { fetchImpl: forbidden.fetchImpl }),
    ).rejects.toBeInstanceOf(AccForbiddenError);
  });
});

describe("pagination", () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(from + i + 1) }));

  it("walks every page by limit/offset and stops on a short page, reading the {results,pagination} envelope", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      const offset = Number(new URL(s.url).searchParams.get("offset"));
      const page = offset === 0 ? rows(3) : offset === 3 ? rows(3, 3) : rows(1, 6);
      return json({ results: page, pagination: { limit: 3, offset, totalResults: 7 } });
    });
    const result = await accAllPages(config, "tok", "/construction/rfis/v2/projects/9/rfis", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(7);
    expect(result.truncated).toBe(false);
    expect(seen.map((s) => new URL(s.url).searchParams.get("offset"))).toEqual(["0", "3", "6"]);
    expect(seen.every((s) => new URL(s.url).searchParams.get("limit") === "3")).toBe(true);
  });

  it("accepts a bare array response too, defensively", async () => {
    const { fetchImpl } = recorder(() => json(rows(2)));
    const result = await accAllPages(config, "tok", "/construction/submittals/v2/projects/9/items", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(2);
  });

  it("says truncated at the limit instead of reading on", async () => {
    const { fetchImpl } = recorder(() => json({ results: rows(3) }));
    const result = await accAllPages(config, "tok", "/construction/rfis/v2/projects/9/rfis", { perPage: 3, limit: 5 }, { fetchImpl });
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("terminates on a server that ignores offset and answers every call with a full page", async () => {
    const { seen, fetchImpl } = recorder(() => json({ results: rows(3) }));
    const result = await accAllPages(config, "tok", "/construction/rfis/v2/projects/9/rfis", { perPage: 3, limit: 9 }, { fetchImpl });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(9);
    expect(seen).toHaveLength(3);
  });

  it("throws a nameable error rather than silently returning nothing when the envelope shape is unrecognised", async () => {
    const { fetchImpl } = recorder(() => json({ somethingElse: true }));
    const error = await accAllPages(config, "tok", "/construction/rfis/v2/projects/9/rfis", { perPage: 3, limit: 9 }, { fetchImpl }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(AccApiError);
    expect(error.message).toMatch(/not a list/);
  });
});

describe("hubs and projects", () => {
  it("keeps only ACC/BIM 360 hubs (the 'b.' prefix) and strips it for the stored id", async () => {
    const { fetchImpl } = recorder(() =>
      json({
        data: [
          { id: "b.hub-1", attributes: { name: "Big GC" } },
          { id: "a.fusion-1", attributes: { name: "Not construction" } },
        ],
      }),
    );
    const hubs = await listAccHubs(config, "tok", { fetchImpl });
    expect(hubs).toEqual([{ id: "hub-1", name: "Big GC" }]);
  });

  it("re-adds the 'b.' prefix to call Data Management, and strips it again on the returned project id", async () => {
    const { seen, fetchImpl } = recorder(() => json({ data: [{ id: "b.proj-1", attributes: { name: "Tower A" } }] }));
    const projects = await listAccProjects(config, "tok", { id: "hub-1", name: "Big GC" }, { fetchImpl });
    expect(seen[0].url).toBe("https://developer.api.autodesk.com/project/v1/hubs/b.hub-1/projects");
    expect(projects).toEqual([{ id: "proj-1", name: "Tower A", hubId: "hub-1", hubName: "Big GC" }]);
  });
});

describe("readers", () => {
  it("normalises an RFI defensively — a field it cannot find degrades to null, never a crash", async () => {
    const { fetchImpl } = recorder(() => json({ results: [{ id: "1", identifier: "RFI-004", subject: "Head of wall", status: "open" }] }));
    const result = await fetchAccRfis(config, "tok", { accAccountId: "hub-1", accProjectId: "9" }, { fetchImpl });
    expect(result.items).toEqual([
      expect.objectContaining({ kind: "RFI", accId: "1", number: "RFI-004", title: "Head of wall", status: "open" }),
    ]);
    expect(result.items[0].webUrl).toBe("https://acc.autodesk.com/build/rfis/projects/9/rfis/1");
  });

  it("normalises a submittal, reading the spec section title into discipline", async () => {
    const { fetchImpl } = recorder(() =>
      json({ results: [{ id: "2", customIdentifier: "SUB-002", title: "Metal studs", stateId: "in_review", specSection: { title: "09 21 16" } }] }),
    );
    const result = await fetchAccSubmittals(config, "tok", { accAccountId: "hub-1", accProjectId: "9" }, { fetchImpl });
    expect(result.items).toEqual([
      expect.objectContaining({ kind: "SUBMITTAL", accId: "2", number: "SUB-002", status: "in_review", discipline: "09 21 16" }),
    ]);
    expect(result.items[0].webUrl).toBe("https://acc.autodesk.com/build/submittals/projects/9/items/2");
  });

  it("drops a row with no id rather than inventing one", async () => {
    const { fetchImpl } = recorder(() => json({ results: [{ subject: "no id" }] }));
    const result = await fetchAccRfis(config, "tok", { accAccountId: "hub-1", accProjectId: "9" }, { fetchImpl });
    expect(result.items).toEqual([]);
  });
});

describe("READ-ONLY: nothing but GET ever reaches Autodesk's API", () => {
  it("every reader the feed uses issues only GETs, each Bearer-authenticated", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      // Order matters: the project-listing call's URL also contains
      // "/project/v1/hubs", so the more specific pattern is checked first.
      if (s.url.includes("/project/v1/hubs/b.")) return json({ data: [{ id: "b.proj-1", attributes: { name: "Tower A" } }] });
      if (s.url.includes("/project/v1/hubs")) return json({ data: [{ id: "b.hub-1", attributes: { name: "Big GC" } }] });
      return json({ results: [{ id: "1", title: "x" }] });
    });
    const ref = { accAccountId: "hub-1", accProjectId: "9" };
    const deps = { fetchImpl };
    const hubs = await listAccHubs(config, "tok", deps);
    await listAccProjects(config, "tok", hubs[0], deps);
    await fetchAccRfis(config, "tok", ref, deps);
    await fetchAccSubmittals(config, "tok", ref, deps);

    // Requested vs inspected: hubs, projects, RFIs, submittals = 4. If a
    // reader silently stopped calling, this count is what goes red — not
    // the method check below, which would pass on an empty list.
    expect(seen).toHaveLength(4);
    const inspected = seen.filter((s) => s.url.startsWith("https://developer.api.autodesk.com/"));
    expect(inspected).toHaveLength(seen.length);
    expect(inspected.filter((s) => s.method !== "GET")).toEqual([]);
    expect(inspected.every((s) => s.headers.Authorization === "Bearer tok")).toBe(true);
  });

  it("the only method literals in the client are the token POST and the API GET", () => {
    // Structural half. The behaviour test above runs the readers that
    // exist today; this one catches a NEW function that writes, before
    // anybody wires it up.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const client = readFileSync(resolve(here, "../../../packages/integrations/src/acc.ts"), "utf8");
    const methods = [...client.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["GET", "POST"]);
    // The one POST is the token endpoint's.
    const postAt = client.indexOf('method: "POST"');
    expect(client.slice(Math.max(0, postAt - 200), postAt)).toContain("${ACC_HOSTS.auth}/token");
  });

  it("never requests a write scope", async () => {
    const { ACC_SCOPE } = await import("@prova/integrations");
    expect(ACC_SCOPE.split(" ")).toEqual(["data:read", "account:read"]);
    expect(ACC_SCOPE).not.toMatch(/write/);
  });

  it("no ACC code in the web app calls fetch itself — everything goes through the client", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const files = [
      ...walk(join(here, "acc")),
      join(here, "actions/acc.ts"),
      join(here, "actions/accFeed.ts"),
      join(here, "../app/api/acc/start/route.ts"),
      join(here, "../app/api/acc/callback/route.ts"),
      join(here, "../components/ACCFeedSection.tsx"),
      join(here, "../components/ACCLinks.tsx"),
      join(here, "../components/ACCRefresh.tsx"),
    ].filter((file) => !file.endsWith(".test.ts"));
    // The size of the set, asserted against a number that cannot drift with
    // the walk: lib/acc holds constants, connection, feed, setup.
    expect(files).toHaveLength(11);
    const offenders = files.filter((file) => /\bfetch\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
