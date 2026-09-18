import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROCORE_MAX_RETRIES,
  ProcoreApiError,
  ProcoreAuthError,
  ProcoreForbiddenError,
  ProcoreUnauthorizedError,
  exchangeProcoreCode,
  fetchProcoreDrawings,
  fetchProcoreRfis,
  fetchProcoreSubmittals,
  listProcoreCompanies,
  listProcoreProjects,
  procoreAllPages,
  procoreAuthorizeUrl,
  procoreGet,
  rateLimitWaitMs,
  readProcoreConfig,
  refreshProcoreTokens,
  type ProcoreConfig,
} from "@prova/integrations";

/**
 * The Procore client with HTTP mocked — no request leaves the process.
 *
 * Every fake here RECORDS every request, and the read-only test at the
 * bottom runs every reader the feed uses and then counts: the number of
 * requests it inspected must equal the number the fake saw, so a reader
 * that made no request at all cannot pass it by having nothing to inspect.
 */

const ENV = {
  PROCORE_CLIENT_ID: "cid",
  PROCORE_CLIENT_SECRET: "csecret",
  PROCORE_REDIRECT_URI: "https://app.cstream.ai/api/procore/callback",
};
const config = readProcoreConfig(ENV) as ProcoreConfig;

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
    expect(readProcoreConfig({})).toBeNull();
    expect(readProcoreConfig({ ...ENV, PROCORE_CLIENT_SECRET: " " })).toBeNull();
  });

  it("defaults to production and switches every host for sandbox", () => {
    expect(config.hosts).toEqual({
      login: "https://login.procore.com",
      api: "https://api.procore.com",
      web: "https://app.procore.com",
    });
    const sandbox = readProcoreConfig({ ...ENV, PROCORE_ENVIRONMENT: "sandbox" }) as ProcoreConfig;
    expect(sandbox.hosts.login).toBe("https://login-sandbox.procore.com");
    expect(sandbox.hosts.api).toBe("https://sandbox.procore.com");
  });

  it("puts state and an S256 challenge on the authorize URL", () => {
    const url = new URL(procoreAuthorizeUrl(config, "st4te", "ch4llenge"));
    expect(url.origin + url.pathname).toBe("https://login.procore.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: ENV.PROCORE_REDIRECT_URI,
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
    });
  });
});

describe("tokens", () => {
  it("exchanges a code with the verifier and computes expiry from created_at + expires_in", async () => {
    const { seen, fetchImpl } = recorder(() =>
      json({ access_token: "A1", refresh_token: "R1", expires_in: 5400, created_at: 1_800_000_000 }),
    );
    const tokens = await exchangeProcoreCode(config, "code-1", "verifier-1", fetchImpl);
    expect(tokens.accessToken).toBe("A1");
    expect(tokens.expiresAt?.toISOString()).toBe(new Date((1_800_000_000 + 5400) * 1000).toISOString());
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://login.procore.com/oauth/token");
    const form = Object.fromEntries(new URLSearchParams(seen[0].body));
    expect(form).toEqual(
      expect.objectContaining({ grant_type: "authorization_code", code: "code-1", code_verifier: "verifier-1", client_secret: "csecret" }),
    );
  });

  it("flags invalid_grant on a refresh, and never puts the body in the message", async () => {
    const { fetchImpl } = recorder(() => json({ error: "invalid_grant", access_token: "LEAK" }, 400));
    const error = await refreshProcoreTokens(config, "R-dead", fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(ProcoreAuthError);
    expect(error.invalidGrant).toBe(true);
    expect(error.message).not.toContain("LEAK");
    expect(error.message).not.toContain("R-dead");
  });
});

describe("procoreGet", () => {
  it("sends Procore-Company-Id on a company call and omits it only when told there is no company yet", async () => {
    const { seen, fetchImpl } = recorder(() => json([]));
    await procoreGet(config, "tok", "/rest/v1.0/projects/9/rfis", "55", {}, { fetchImpl });
    await procoreGet(config, "tok", "/rest/v1.0/companies", null, {}, { fetchImpl });
    expect(seen).toHaveLength(2);
    expect(seen[0].headers["Procore-Company-Id"]).toBe("55");
    expect(seen[0].headers.Authorization).toBe("Bearer tok");
    expect(seen[1].headers["Procore-Company-Id"]).toBeUndefined();
  });

  it("waits for X-Rate-Limit-Reset on a 429 and retries", async () => {
    const waits: number[] = [];
    const now = new Date("2026-09-18T12:00:00Z");
    const { seen, fetchImpl } = recorder((_s, n) =>
      n === 1 ? json({}, 429, { "x-rate-limit-reset": String(now.getTime() / 1000 + 3) }) : json([{ id: 1 }]),
    );
    const { body } = await procoreGet(config, "tok", "/rest/v1.0/companies", null, {}, {
      fetchImpl,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(body).toEqual([{ id: 1 }]);
    expect(seen).toHaveLength(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(3000);
    expect(waits[0]).toBeLessThan(3000 + 250);
  });

  it("gives up after PROCORE_MAX_RETRIES 429s with a sentence, not a hang", async () => {
    const { seen, fetchImpl } = recorder(() => json({}, 429));
    const error = await procoreGet(config, "tok", "/rest/v1.0/companies", null, {}, { fetchImpl, ...noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(ProcoreApiError);
    expect(error.message).toMatch(/limiting/);
    expect(seen).toHaveLength(PROCORE_MAX_RETRIES + 1);
  });

  it("honours Retry-After on a 503", () => {
    expect(rateLimitWaitMs(new Headers({ "retry-after": "2" }), new Date())).toBe(2000);
  });

  it("maps 401 and 403 to their own errors", async () => {
    const unauthorized = recorder(() => json({}, 401));
    await expect(procoreGet(config, "tok", "/rest/v1.0/companies", null, {}, { fetchImpl: unauthorized.fetchImpl })).rejects.toBeInstanceOf(
      ProcoreUnauthorizedError,
    );
    const forbidden = recorder(() => json({}, 403));
    await expect(
      procoreGet(config, "tok", "/rest/v1.0/projects/9/rfis", "55", {}, { fetchImpl: forbidden.fetchImpl }),
    ).rejects.toBeInstanceOf(ProcoreForbiddenError);
  });

  it("refuses a path outside /rest/ before any request", async () => {
    const { seen, fetchImpl } = recorder(() => json([]));
    await expect(procoreGet(config, "tok", "https://evil.example/x", "1", {}, { fetchImpl })).rejects.toThrow(/outside/);
    expect(seen).toHaveLength(0);
  });
});

describe("pagination", () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i + 1 }));

  it("walks every page by page/per_page and stops on a short page", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      const page = Number(new URL(s.url).searchParams.get("page"));
      return json(page === 1 ? rows(3) : page === 2 ? rows(3, 3) : rows(1, 6));
    });
    const result = await procoreAllPages(config, "tok", "/rest/v1.0/projects/9/rfis", "55", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(7);
    expect(result.truncated).toBe(false);
    expect(seen.map((s) => new URL(s.url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(seen.every((s) => new URL(s.url).searchParams.get("per_page") === "3")).toBe(true);
  });

  it("stops when the Total header is reached, even on a full page", async () => {
    const { seen, fetchImpl } = recorder(() => json(rows(3), 200, { total: "3" }));
    const result = await procoreAllPages(config, "tok", "/rest/v1.0/projects/9/rfis", "55", { perPage: 3, limit: 100 }, { fetchImpl });
    expect(result.items).toHaveLength(3);
    expect(seen).toHaveLength(1);
  });

  it("says truncated at the limit instead of reading on", async () => {
    const { fetchImpl } = recorder(() => json(rows(3)));
    const result = await procoreAllPages(config, "tok", "/rest/v1.0/projects/9/rfis", "55", { perPage: 3, limit: 5 }, { fetchImpl });
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("terminates on a server that ignores `page` and answers every call with a full page", async () => {
    // What a server ignoring `page` looks like: the same full page forever,
    // no Total. The walk must still stop — at the limit, saying truncated.
    const { seen, fetchImpl } = recorder(() => json(rows(3)));
    const result = await procoreAllPages(config, "tok", "/rest/v1.0/projects/9/rfis", "55", { perPage: 3, limit: 9 }, { fetchImpl });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(9);
    expect(seen).toHaveLength(3);
  });
});

describe("readers", () => {
  it("drops obsolete drawings and keeps the current revision's label", async () => {
    const { fetchImpl } = recorder((s) => {
      if (s.url.includes("/drawing_areas?") || s.url.endsWith("/drawing_areas")) return json([{ id: 7, name: "Level 1" }]);
      return json([
        { id: 1, number: "A-101", title: "Plan", discipline: "Architectural", current_revision: { revision_number: "3", updated_at: "2026-09-01T00:00:00Z" } },
        { id: 2, number: "A-102", title: "Old", obsolete: true, current_revision: { revision_number: "1" } },
      ]);
    });
    const result = await fetchProcoreDrawings(config, "tok", { procoreCompanyId: "55", procoreProjectId: "9" }, { fetchImpl });
    expect(result.items).toEqual([
      expect.objectContaining({ kind: "DRAWING", number: "A-101", revision: "3", discipline: "Architectural" }),
    ]);
    expect(result.items[0].webUrl.startsWith("https://app.procore.com/9/project/")).toBe(true);
  });

  it("uses an RFI's own link only when it points at Procore", async () => {
    const { fetchImpl } = recorder(() =>
      json([
        { id: 1, number: 4, subject: "Head of wall", status: "open", link: "https://app.procore.com/9/project/rfi/show/1", ball_in_court: [{ name: "Architect" }] },
        { id: 2, number: 5, subject: "Phishy", status: "open", link: "https://evil.example/rfi/2" },
      ]),
    );
    const result = await fetchProcoreRfis(config, "tok", { procoreCompanyId: "55", procoreProjectId: "9" }, { fetchImpl });
    expect(result.items.map((i) => i.webUrl)).toEqual([
      "https://app.procore.com/9/project/rfi/show/1",
      "https://app.procore.com/9/project/rfi/show/2",
    ]);
    expect(result.items[0].ballInCourt).toBe("Architect");
  });
});

describe("READ-ONLY: nothing but GET ever reaches Procore's API", () => {
  it("every reader the feed uses issues only GETs, each with the company header", async () => {
    const { seen, fetchImpl } = recorder((s) => {
      if (s.url.endsWith("/rest/v1.0/companies?page=1&per_page=100")) return json([{ id: 55, name: "Big GC" }]);
      if (s.url.includes("/drawing_areas?")) return json([{ id: 7 }]);
      return json([{ id: 1, title: "x", subject: "x", name: "x" }]);
    });
    const ref = { procoreCompanyId: "55", procoreProjectId: "9" };
    const deps = { fetchImpl };
    const companies = await listProcoreCompanies(config, "tok", deps);
    await listProcoreProjects(config, "tok", companies[0], deps);
    await fetchProcoreDrawings(config, "tok", ref, deps);
    await fetchProcoreRfis(config, "tok", ref, deps);
    await fetchProcoreSubmittals(config, "tok", ref, deps);

    // Requested vs inspected: companies, projects, drawing areas, one
    // area's drawings, RFIs, submittals = 6. If a reader silently stopped
    // calling, this count is what goes red — not the method check below,
    // which would pass on an empty list.
    expect(seen).toHaveLength(6);
    const inspected = seen.filter((s) => s.url.startsWith("https://api.procore.com/rest/"));
    expect(inspected).toHaveLength(seen.length);
    expect(inspected.filter((s) => s.method !== "GET")).toEqual([]);
    expect(inspected.filter((s) => !s.url.includes("/companies?") && !s.headers["Procore-Company-Id"])).toEqual([]);
  });

  it("the only method literals in the client are the token POST and the API GET", () => {
    // Structural half. The behaviour test above runs the readers that
    // exist today; this one catches a NEW function that writes, before
    // anybody wires it up.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const client = readFileSync(resolve(here, "../../../packages/integrations/src/procore.ts"), "utf8");
    const methods = [...client.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["GET", "POST"]);
    // The one POST is the token endpoint's.
    const postAt = client.indexOf('method: "POST"');
    expect(client.slice(Math.max(0, postAt - 200), postAt)).toContain("/oauth/token");
  });

  it("no Procore code in the web app calls fetch itself — everything goes through the client", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const files = [
      ...walk(join(here, "procore")),
      join(here, "actions/procore.ts"),
      join(here, "actions/procoreFeed.ts"),
      join(here, "../app/api/procore/start/route.ts"),
      join(here, "../app/api/procore/callback/route.ts"),
      join(here, "../components/ProcoreFeedSection.tsx"),
      join(here, "../components/ProcoreLinks.tsx"),
      join(here, "../components/ProcoreRefresh.tsx"),
    ].filter((file) => !file.endsWith(".test.ts"));
    // The size of the set, asserted against a number that cannot drift
    // with the walk: lib/procore holds constants, connection, feed, setup.
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
