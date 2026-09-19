import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPANYCAM_ENV,
  COMPANYCAM_HOSTS,
  COMPANYCAM_MAX_RETRIES,
  CompanyCamApiError,
  CompanyCamAuthError,
  CompanyCamUnauthorizedError,
  companyCamAllPages,
  companyCamAuthorizeUrl,
  companyCamDownloadUri,
  companyCamGet,
  companyCamRateLimitWaitMs,
  exchangeCompanyCamCode,
  fetchCompanyCamPhotoPage,
  listCompanyCamProjects,
  normaliseCompanyCamPhoto,
  readCompanyCamConfig,
  refreshCompanyCamTokens,
  type CompanyCamConfig,
} from "@prova/integrations";

/**
 * The CompanyCam client with HTTP mocked — no request leaves the process,
 * same style `procore-client.test.ts` uses for the other read-only feed.
 */

const ENV = {
  COMPANYCAM_CLIENT_ID: "cid",
  COMPANYCAM_CLIENT_SECRET: "csecret",
  COMPANYCAM_REDIRECT_URI: "https://app.cstream.ai/api/companycam/callback",
};
const config = readCompanyCamConfig(ENV) as CompanyCamConfig;

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
    expect(readCompanyCamConfig({})).toBeNull();
    expect(readCompanyCamConfig({ ...ENV, COMPANYCAM_CLIENT_SECRET: " " })).toBeNull();
  });

  it("puts response_type, scope=read only, and state on the authorize URL — never write or destroy", () => {
    const url = new URL(companyCamAuthorizeUrl(config, "st4te"));
    expect(url.origin + url.pathname).toBe(`${COMPANYCAM_HOSTS.app}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: ENV.COMPANYCAM_REDIRECT_URI,
      scope: "read",
      state: "st4te",
    });
  });

  it("names the same three env vars the card and the setup check both read", () => {
    expect(COMPANYCAM_ENV).toEqual({
      clientId: "COMPANYCAM_CLIENT_ID",
      clientSecret: "COMPANYCAM_CLIENT_SECRET",
      redirectUri: "COMPANYCAM_REDIRECT_URI",
    });
  });
});

describe("tokens", () => {
  it("exchanges a code and computes expiry from created_at + expires_in", async () => {
    const { seen, fetchImpl } = recorder(() =>
      json({ access_token: "A1", refresh_token: "R1", expires_in: 7200, created_at: 1_800_000_000 }),
    );
    const tokens = await exchangeCompanyCamCode(config, "code-1", fetchImpl);
    expect(tokens.accessToken).toBe("A1");
    expect(tokens.refreshToken).toBe("R1");
    expect(tokens.expiresAt?.toISOString()).toBe(new Date((1_800_000_000 + 7200) * 1000).toISOString());
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe(`${COMPANYCAM_HOSTS.app}/oauth/token`);
    const form = Object.fromEntries(new URLSearchParams(seen[0].body));
    expect(form).toEqual(
      expect.objectContaining({ grant_type: "authorization_code", code: "code-1", client_secret: "csecret" }),
    );
  });

  it("flags invalid_grant on a refresh, and never puts the body in the message", async () => {
    const { fetchImpl } = recorder(() => json({ error: "invalid_grant", access_token: "LEAK" }, 400));
    const error = await refreshCompanyCamTokens(config, "R-dead", fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(CompanyCamAuthError);
    expect(error.invalidGrant).toBe(true);
    expect(error.message).not.toContain("LEAK");
    expect(error.message).not.toContain("R-dead");
  });

  it("a refresh sends grant_type=refresh_token with the given token", async () => {
    const { seen, fetchImpl } = recorder(() => json({ access_token: "A2", refresh_token: "R2" }));
    await refreshCompanyCamTokens(config, "R1", fetchImpl);
    const form = Object.fromEntries(new URLSearchParams(seen[0].body));
    expect(form.grant_type).toBe("refresh_token");
    expect(form.refresh_token).toBe("R1");
  });

  it("throws when the token response is missing a token, rather than returning undefined", async () => {
    const { fetchImpl } = recorder(() => json({ access_token: "only-one" }));
    await expect(exchangeCompanyCamCode(config, "code-1", fetchImpl)).rejects.toBeInstanceOf(CompanyCamAuthError);
  });
});

describe("companyCamGet", () => {
  it("sends a Bearer token and refuses a path outside /v2/ before any request", async () => {
    const { seen, fetchImpl } = recorder(() => json([]));
    await companyCamGet("tok", "/v2/projects", {}, { fetchImpl });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.Authorization).toBe("Bearer tok");
    await expect(companyCamGet("tok", "/v1/legacy", {}, { fetchImpl })).rejects.toThrow(/outside/);
    // The refused call never left the process — still exactly one request.
    expect(seen).toHaveLength(1);
  });

  it("waits for Retry-After on a 429 and retries", async () => {
    const waits: number[] = [];
    const { seen, fetchImpl } = recorder((_s, n) => (n === 1 ? json({}, 429, { "retry-after": "3" }) : json([{ id: 1 }])));
    const { body } = await companyCamGet("tok", "/v2/projects", {}, {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(body).toEqual([{ id: 1 }]);
    expect(seen).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  it("gives up after COMPANYCAM_MAX_RETRIES 429s with a sentence, not a hang", async () => {
    const { seen, fetchImpl } = recorder(() => json({}, 429));
    const error = await companyCamGet("tok", "/v2/projects", {}, { fetchImpl, ...noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(CompanyCamApiError);
    expect(error.message).toMatch(/limiting/);
    expect(seen).toHaveLength(COMPANYCAM_MAX_RETRIES + 1);
  });

  it("backs off with a flat wait plus jitter when no Retry-After is present (CompanyCam publishes no rate-limit header)", () => {
    const ms = companyCamRateLimitWaitMs(new Headers());
    expect(ms).toBeGreaterThanOrEqual(5000);
    expect(ms).toBeLessThan(5250);
  });

  it("maps 401 to CompanyCamUnauthorizedError and 403/404/other to CompanyCamApiError with a sentence naming what failed", async () => {
    await expect(companyCamGet("tok", "/v2/projects", {}, { fetchImpl: recorder(() => json({}, 401)).fetchImpl })).rejects.toBeInstanceOf(
      CompanyCamUnauthorizedError,
    );
    const forbidden = await companyCamGet("tok", "/v2/photos", {}, { fetchImpl: recorder(() => json({}, 403)).fetchImpl }).catch((e) => e);
    expect(forbidden).toBeInstanceOf(CompanyCamApiError);
    expect(forbidden.message).toMatch(/photos/);
    const missing = await companyCamGet("tok", "/v2/projects", {}, { fetchImpl: recorder(() => json({}, 404)).fetchImpl }).catch((e) => e);
    expect(missing.message).toMatch(/project list/);
  });

  it("throws a readable error rather than crashing when the body is not JSON", async () => {
    const badJson = { fetchImpl: async () => new Response("<html>not json</html>", { status: 200 }) };
    const error = await companyCamGet("tok", "/v2/projects", {}, badJson).catch((e) => e);
    expect(error).toBeInstanceOf(CompanyCamApiError);
  });
});

describe("pagination", () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i + 1 }));

  it("walks every page by page/per_page and stops on a short page", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      const page = Number(new URL(s.url).searchParams.get("page"));
      return json(page === 1 ? rows(3) : page === 2 ? rows(3, 3) : rows(1, 6));
    });
    const result = await companyCamAllPages<{ id: number }>("tok", "/v2/photos", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(7);
    expect(result.truncated).toBe(false);
    expect(seen.map((s) => new URL(s.url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("stops on X-Has-Next: false even on a full page", async () => {
    const { seen, fetchImpl } = recorder(() => json(rows(3), 200, { "x-has-next": "false" }));
    const result = await companyCamAllPages<{ id: number }>("tok", "/v2/photos", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(3);
    expect(seen).toHaveLength(1);
  });

  it("says truncated at the limit instead of reading on", async () => {
    const { fetchImpl } = recorder(() => json(rows(3)));
    const result = await companyCamAllPages<{ id: number }>("tok", "/v2/photos", { perPage: 3, limit: 5 }, { fetchImpl });
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("terminates on a server that ignores `page` and answers every call with a full page", async () => {
    const { seen, fetchImpl } = recorder(() => json(rows(3)));
    const result = await companyCamAllPages<{ id: number }>("tok", "/v2/photos", { perPage: 3, limit: 9 }, { fetchImpl });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(9);
    expect(seen).toHaveLength(3);
  });

  it("listCompanyCamProjects asks only for status=active", async () => {
    const { seen, fetchImpl } = recorder(() => json([{ id: "p1", name: "Job One", address: { street_address_1: "1 Main", city: "Reno", state: "NV" } }]));
    const { projects } = await listCompanyCamProjects("tok", { fetchImpl });
    expect(projects).toEqual([{ id: "p1", name: "Job One", address: "1 Main, Reno, NV" }]);
    expect(new URL(seen[0].url).searchParams.get("status")).toBe("active");
  });

  it("fetchCompanyCamPhotoPage filters out deleted photos and reads hasNext from the header or a short page", async () => {
    const { fetchImpl } = recorder(() =>
      json([
        { id: "1", status: "active", processing_status: "processed", uris: [] },
        { id: "2", status: "deleted", processing_status: "processed", uris: [] },
      ]),
    );
    const { photos, hasNext } = await fetchCompanyCamPhotoPage("tok", "proj_1", 1, 100, { fetchImpl });
    expect(photos.map((p) => p.id)).toEqual(["1"]);
    expect(hasNext).toBe(false); // 2 raw rows < perPage 100
  });
});

describe("reading a photo", () => {
  it("normalises captured_at from unix seconds, and drops uris missing a type or uri", () => {
    const photo = normaliseCompanyCamPhoto({
      id: "42",
      project_id: "p1",
      captured_at: 1_758_000_000,
      creator_name: "Ana",
      description: "Front elevation",
      processing_status: "processed",
      uris: [{ type: "web", uri: "https://cdn.companycam.com/web.jpg" }, { type: "thumbnail" }],
    });
    expect(photo).not.toBeNull();
    expect(photo!.capturedAt?.toISOString()).toBe(new Date(1_758_000_000 * 1000).toISOString());
    expect(photo!.uris).toEqual([{ type: "web", uri: "https://cdn.companycam.com/web.jpg" }]);
  });

  it("prefers the web variant over original, and original over whatever else is listed", () => {
    const withWeb = normaliseCompanyCamPhoto({
      id: "1",
      uris: [{ type: "original", uri: "O" }, { type: "web", uri: "W" }],
    })!;
    expect(companyCamDownloadUri(withWeb)).toBe("W");
    const originalOnly = normaliseCompanyCamPhoto({ id: "2", uris: [{ type: "original", uri: "O" }] })!;
    expect(companyCamDownloadUri(originalOnly)).toBe("O");
    const thumbOnly = normaliseCompanyCamPhoto({ id: "3", uris: [{ type: "thumbnail", uri: "T" }] })!;
    expect(companyCamDownloadUri(thumbOnly)).toBe("T");
    const none = normaliseCompanyCamPhoto({ id: "4", uris: [] })!;
    expect(companyCamDownloadUri(none)).toBeNull();
  });

  it("returns null for a raw object with no id, rather than a photo with an empty one", () => {
    expect(normaliseCompanyCamPhoto({})).toBeNull();
  });
});

describe("READ-ONLY: nothing but GET ever reaches CompanyCam's API", () => {
  it("every reader the import uses issues only GETs to api.companycam.com", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      if (s.url.includes("/v2/projects")) return json([{ id: "1", name: "X" }]);
      return json([{ id: "1", status: "active", processing_status: "processed", uris: [] }]);
    });
    await listCompanyCamProjects("tok", { fetchImpl });
    await fetchCompanyCamPhotoPage("tok", "p1", 1, 100, { fetchImpl });

    // Requested vs inspected: projects, photos = 2. If a reader silently
    // stopped calling, this count is what goes red — not the method check
    // below, which would pass on an empty list.
    expect(seen).toHaveLength(2);
    const inspected = seen.filter((s) => s.url.startsWith(`${COMPANYCAM_HOSTS.api}/v2/`));
    expect(inspected).toHaveLength(seen.length);
    expect(inspected.filter((s) => s.method !== "GET")).toEqual([]);
  });

  it("the only method literals in the client are the token POST and the API GET", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const client = readFileSync(resolve(here, "../../../packages/integrations/src/companycam.ts"), "utf8");
    const methods = [...client.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["GET", "POST"]);
    const postAt = client.indexOf('method: "POST"');
    expect(client.slice(Math.max(0, postAt - 200), postAt)).toContain("/oauth/token");
  });

  it("no CompanyCam code in the web app calls fetch itself, except the import's own CDN download — everything else goes through the client", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const files = [
      ...walk(join(here, "companycam")),
      join(here, "actions/companycam.ts"),
      join(here, "../app/api/companycam/start/route.ts"),
      join(here, "../app/api/companycam/callback/route.ts"),
      join(here, "../components/CompanyCamControls.tsx"),
      join(here, "../components/CompanyCamLinks.tsx"),
    ].filter((file) => !file.endsWith(".test.ts"));
    // The size of the set, asserted against a number that cannot drift with
    // the walk: lib/companycam holds constants, connection, import, setup
    // (4) + the action module (1) + the two route handlers (2) + the two
    // components (2) = 9.
    expect(files).toHaveLength(9);
    // `import.ts`'s CDN download is a deliberate, documented exception — a
    // GET with no Authorization header, since the bearer token is for
    // api.companycam.com only. Every OTHER file must go through the client.
    const offenders = files
      .filter((file) => !file.endsWith("companycam/import.ts"))
      .filter((file) => /\bfetch\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
