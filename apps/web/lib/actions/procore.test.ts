import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The Procore feed's actions end to end, against two fakes:
 *
 *   - a database holding TWO companies, honouring `where` (equality on
 *     every key, compound unique keys, `OR`), `select` on flat columns,
 *     the unique indexes this feature relies on, and `$transaction`;
 *   - a Procore server behind `fetch`: a token endpoint whose refresh
 *     tokens are SINGLE-USE, and a REST API that answers 401 to any token
 *     it did not issue, 400 to any company call missing Procore-Company-Id,
 *     and 403 for a GC company that has not installed the app.
 *
 * Nothing reaches the network. Company B is linked to the SAME Procore
 * project as company A, so every tenant assertion fails if a lookup ever
 * ignores companyId.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  seq: 0,
  writes: [] as string[],
  context: { id: "user_A", role: "OWNER" as string, jobFunction: null as string | null, company: { id: "co_A" } },
}));

function table(name: string): Row[] {
  let rows = state.tables.get(name) as Row[] | undefined;
  if (!rows) {
    rows = [];
    state.tables.set(name, rows);
  }
  return rows;
}

function flatten(where: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes("_") && value && typeof value === "object") Object.assign(out, value);
    else out[key] = value;
  }
  return out;
}

function matches(row: Row, where?: Record<string, unknown>): boolean {
  return Object.entries(flatten(where)).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((w) => matches(row, w));
    return (row[key] ?? null) === (value ?? null);
  });
}

function pick(row: Row, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k] === true).map((k) => [k, row[k] ?? null]));
}

const UNIQUE: Record<string, string[][]> = {
  procoreProjectLink: [["jobId"], ["companyId", "procoreProjectId"]],
  procoreItem: [["linkId", "kind", "procoreId"]],
};

function model(name: string, viaTx: boolean) {
  const write = (op: string) => state.writes.push(`${name}.${op}@${viaTx ? "tx" : "bare"}`);
  const insert = (data: Record<string, unknown>, skipDuplicates = false) => {
    for (const keys of UNIQUE[name] ?? []) {
      if (table(name).some((r) => keys.every((k) => r[k] === data[k]))) {
        if (skipDuplicates) return null;
        throw Object.assign(new Error(`Unique constraint failed on the fields: (${keys.join(", ")})`), { code: "P2002" });
      }
    }
    const row = { id: `${name}_${++state.seq}`, ...data } as Row;
    table(name).push(row);
    return row;
  };
  return {
    findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) =>
      table(name).filter((row) => matches(row, args.where)).map((row) => pick(row, args.select)),
    findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = table(name).find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    findFirst: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = table(name).find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      write("create");
      return pick(insert(data) as Row, select);
    },
    createMany: async ({ data, skipDuplicates }: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
      write("createMany");
      return { count: data.map((d) => insert(d, skipDuplicates)).filter(Boolean).length };
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      write("update");
      const row = table(name).find((r) => matches(r, where));
      if (!row) throw new Error(`update found nothing in ${name}`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      write("updateMany");
      const rows = table(name).filter((r) => matches(r, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      write("deleteMany");
      const before = table(name).length;
      const kept = table(name).filter((r) => !matches(r, where));
      state.tables.set(name, kept);
      // ON DELETE CASCADE, link -> items.
      if (name === "procoreProjectLink") {
        const live = new Set(kept.map((r) => r.id));
        state.tables.set("procoreItem", table("procoreItem").filter((i) => live.has(String(i.linkId))));
      }
      return { count: before - kept.length };
    },
  };
}

const proxy = (viaTx: boolean): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get: (_t, property) => {
        if (property === "then" || typeof property === "symbol") return undefined;
        if (property === "$transaction") {
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            const snapshot = new Map([...state.tables].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
            try {
              return await fn(proxy(true));
            } catch (error) {
              state.tables = snapshot;
              throw error;
            }
          };
        }
        return model(String(property), viaTx);
      },
    },
  );

vi.mock("@prova/db", () => ({ prisma: proxy(false), Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => state.context }));

/* ----------------------------- fake Procore ----------------------------- */

const procore = {
  validAccess: new Set<string>(),
  validRefresh: new Set<string>(),
  issued: 0,
  requests: [] as { url: string; method: string; companyHeader: string | null; auth: string | null; body: string | null }[],
  /** Runs just before the token endpoint answers — lets a test play the
   * "other request" in a refresh race at an exact moment. */
  beforeTokenReply: null as null | ((grant: string) => void),
  forbidDrawings: false,
  rfis: [] as Record<string, unknown>[],
};

function issuePair() {
  procore.issued++;
  const access = `access-${procore.issued}`;
  const refresh = `refresh-${procore.issued}`;
  procore.validAccess.add(access);
  procore.validRefresh.add(refresh);
  return { access, refresh };
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(input);
  const method = init?.method ?? "GET";
  const headers = (init?.headers ?? {}) as Record<string, string>;
  procore.requests.push({
    url: href,
    method,
    companyHeader: headers["Procore-Company-Id"] ?? null,
    auth: headers.Authorization ?? null,
    body: init?.body ? String(init.body) : null,
  });

  if (href === "https://login.procore.com/oauth/token") {
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    procore.beforeTokenReply?.(form.grant_type);
    if (form.grant_type !== "refresh_token" || !procore.validRefresh.has(form.refresh_token)) {
      return reply({ error: "invalid_grant" }, 400);
    }
    procore.validRefresh.delete(form.refresh_token); // single-use
    const pair = issuePair();
    return reply({ access_token: pair.access, refresh_token: pair.refresh, expires_in: 5400, created_at: Math.floor(Date.now() / 1000) });
  }

  const url = new URL(href);
  if (url.origin !== "https://api.procore.com") throw new Error(`unexpected fetch ${href}`);
  const token = String(headers.Authorization ?? "").replace("Bearer ", "");
  if (!procore.validAccess.has(token)) return reply({ message: "Unauthorized" }, 401);
  const path = url.pathname;
  const page = Number(url.searchParams.get("page") ?? "1");
  const list = (rows: unknown[]) => reply(page === 1 ? rows : [], 200, { total: String(rows.length) });

  if (path === "/rest/v1.0/companies") return list([{ id: 55, name: "Big GC" }, { id: 77, name: "Other GC" }]);
  if (!headers["Procore-Company-Id"]) return reply({ message: "Procore-Company-Id header missing" }, 400);
  if (path === "/rest/v1.1/projects") {
    if (url.searchParams.get("company_id") === "77") return reply({ message: "App is not connected to this company" }, 403);
    return list([{ id: 9, name: "Tower A", project_number: "T-1", active: true }]);
  }
  if (path === "/rest/v1.0/projects/9/rfis") return list(procore.rfis);
  if (path === "/rest/v1.1/projects/9/submittals") return list([{ id: 31, formatted_number: "09 21 16-1", title: "Board", status: { name: "Open" } }]);
  if (path === "/rest/v1.1/projects/9/drawing_areas") {
    if (procore.forbidDrawings) return reply({}, 403);
    return list([{ id: 7, name: "Level 1" }]);
  }
  if (path === "/rest/v1.1/drawing_areas/7/drawings") {
    return list([{ id: 41, number: "A-101", title: "Plan", current_revision: { revision_number: "2" } }]);
  }
  return reply({}, 404);
}

/* -------------------------------- set-up -------------------------------- */

const { linkProcoreProject, unlinkProcoreProject, disconnectProcore, listProcoreProjectsForLinking } = await import("./procore");
const { refreshProcoreFeed } = await import("./procoreFeed");
const { procoreAccessToken, sealAccess, openAccess } = await import("@/lib/procore/connection");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

function connect(companyId: string, pair = issuePair(), expiresAt = new Date(Date.now() + 3600_000)) {
  table("integrationConnection").push({
    id: `conn_${companyId}`,
    companyId,
    provider: "PROCORE",
    status: "CONNECTED",
    encryptedAccessToken: sealAccess({ accessToken: pair.access, expiresAt }),
    encryptedRefreshToken: encryptSecret(pair.refresh),
  });
  return pair;
}

const conn = (companyId: string) => table("integrationConnection").find((r) => r.companyId === companyId) as Row;

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

function seed() {
  process.env.PROCORE_CLIENT_ID = "cid";
  process.env.PROCORE_CLIENT_SECRET = "csecret";
  process.env.PROCORE_REDIRECT_URI = "https://app.cstream.ai/api/procore/callback";
  delete process.env.PROCORE_ENVIRONMENT;
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");

  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.context.role = "OWNER";
  state.context.jobFunction = null;
  state.context.company = { id: "co_A" };

  procore.validAccess = new Set();
  procore.validRefresh = new Set();
  procore.issued = 0;
  procore.requests = [];
  procore.beforeTokenReply = null;
  procore.forbidDrawings = false;
  procore.rfis = [
    { id: 11, number: 1, subject: "Head of wall", status: "open", due_date: "2026-09-30" },
    { id: 12, number: 2, subject: "Soffit framing", status: "closed" },
  ];

  table("job").push({ id: "job_A1", companyId: "co_A", name: "Tower A drywall" });
  table("job").push({ id: "job_A2", companyId: "co_A", name: "Clinic" });
  table("job").push({ id: "job_B1", companyId: "co_B", name: "B's tower job" });
  // B already linked the SAME Procore project, and has a cached GC RFI.
  table("procoreProjectLink").push({
    id: "link_B",
    companyId: "co_B",
    jobId: "job_B1",
    procoreCompanyId: "55",
    procoreCompanyName: "Big GC",
    procoreProjectId: "9",
    procoreProjectName: "Tower A",
    lastRefreshedAt: null,
  });
  table("procoreItem").push({ id: "item_B", companyId: "co_B", linkId: "link_B", kind: "RFI", procoreId: "11", title: "B's copy", webUrl: "x" });
  connect("co_B", { access: "b-access", refresh: "b-refresh" });
}

beforeEach(() => {
  seed();
  vi.stubGlobal("fetch", fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

const snapshotB = () =>
  JSON.stringify(["procoreProjectLink", "procoreItem", "integrationConnection", "job"].map((t) => table(t).filter((r) => r.companyId === "co_B")));

/* --------------------------------- tests -------------------------------- */

describe("linking", () => {
  it("links a project this login can see, reads it, and names it from Procore — not from the form", async () => {
    connect("co_A");
    const result = await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9", procoreProjectName: "FORGED" }));
    expect(result).toEqual({ ok: true });
    const link = table("procoreProjectLink").find((r) => r.companyId === "co_A") as Row;
    expect(link).toEqual(expect.objectContaining({ jobId: "job_A1", procoreProjectName: "Tower A", procoreCompanyName: "Big GC", lastRefreshStatus: "SUCCESS" }));
    const items = table("procoreItem").filter((i) => i.linkId === link.id);
    expect(items.map((i) => `${i.kind}:${i.number}`).sort()).toEqual(["DRAWING:A-101", "RFI:1", "RFI:2", "SUBMITTAL:09 21 16-1"]);
    expect(items.every((i) => i.companyId === "co_A")).toBe(true);
    // The RFI is the GC's, cached — never a row in this company's own log.
    expect(table("rfi")).toEqual([]);
    expect(table("submittal")).toEqual([]);
  });

  it("refuses another company's job, writing nothing", async () => {
    connect("co_A");
    const before = JSON.stringify([...state.tables]);
    const result = await linkProcoreProject(form({ jobId: "job_B1", procoreCompanyId: "55", procoreProjectId: "9" }));
    expect(result).toEqual({ ok: false, error: "That job isn't in this company." });
    expect(JSON.stringify([...state.tables])).toBe(before);
  });

  it("refuses a project Procore does not list for this login, and one in a company that hasn't installed the app", async () => {
    connect("co_A");
    const invented = await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "999" }));
    expect(invented.ok).toBe(false);
    const uninstalled = await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "77", procoreProjectId: "9" }));
    expect(uninstalled.ok).toBe(false);
    expect(table("procoreProjectLink").filter((r) => r.companyId === "co_A")).toEqual([]);
  });

  it("lists an uninstalled GC company with the reason, instead of silently leaving it out", async () => {
    connect("co_A");
    const result = await listProcoreProjectsForLinking();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => [c.name, c.projects.length, Boolean(c.problem)])).toEqual([
      ["Big GC", 1, false],
      ["Other GC", 0, true],
    ]);
    expect(result.value[1].problem).toMatch(/App Management/);
  });

  it("one job, one project: a second link on the same job is refused", async () => {
    connect("co_A");
    expect((await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }))).ok).toBe(true);
    const again = await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    expect(again).toEqual({ ok: false, error: "Tower A drywall already has a Procore project. Unlink it first." });
  });
});

describe("owner only", () => {
  it("a MEMBER holding every capability is refused by every card action before any read or Procore call", async () => {
    connect("co_A");
    state.context.role = "MEMBER";
    state.context.jobFunction = null;
    const writes = state.writes.length;
    const calls = procore.requests.length;
    const results = [
      await listProcoreProjectsForLinking(),
      await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" })),
      await unlinkProcoreProject("link_B"),
      await disconnectProcore(),
    ];
    // Requested four verdicts; count the four that came back before reading them.
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Only the account owner/);
    }
    expect(state.writes.length).toBe(writes);
    expect(procore.requests.length).toBe(calls);
  });
});

describe("tenant scope", () => {
  it("unlinking another company's link finds nothing and leaves it exactly as it was", async () => {
    connect("co_A");
    const before = snapshotB();
    expect(await unlinkProcoreProject("link_B")).toEqual({ ok: false, error: "That link is already gone." });
    expect(snapshotB()).toBe(before);
  });

  it("a refresh reads and writes only this company's links and cache, with this company's token", async () => {
    const pairA = connect("co_A");
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    const before = snapshotB();
    procore.requests = [];
    const result = await refreshProcoreFeed(null, false);
    expect(result).toEqual({ ok: true, value: { refreshed: 1, failed: 0, skipped: 0 } });
    expect(snapshotB()).toBe(before);
    // Requests happened, every one carried A's token, and B's credential
    // appears in none of them — header or body.
    expect(procore.requests.length).toBeGreaterThan(0);
    expect(procore.requests.filter((r) => r.auth !== `Bearer ${pairA.access}`)).toEqual([]);
    expect(procore.requests.filter((r) => `${r.auth} ${r.body}`.includes("b-access") || `${r.body}`.includes("b-refresh"))).toEqual([]);
  });
});

describe("refresh", () => {
  it("replaces each kind it read, keeps the kind it could not, and says which", async () => {
    connect("co_A");
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    const link = table("procoreProjectLink").find((r) => r.companyId === "co_A") as Row;

    procore.forbidDrawings = true;
    procore.rfis = [{ id: 13, number: 3, subject: "New question", status: "open" }];
    const result = await refreshProcoreFeed("job_A1", false);
    expect(result).toEqual({ ok: true, value: { refreshed: 0, failed: 1, skipped: 0 } });

    const kinds = table("procoreItem").filter((i) => i.linkId === link.id).map((i) => `${i.kind}:${i.number}`).sort();
    // RFIs replaced (1 and 2 gone, 3 in); the drawing kept from last time.
    expect(kinds).toEqual(["DRAWING:A-101", "RFI:3", "SUBMITTAL:09 21 16-1"]);
    const after = table("procoreProjectLink").find((r) => r.id === link.id) as Row;
    expect(after.lastRefreshStatus).toBe("FAILURE");
    expect(String(after.lastRefreshMessage)).toMatch(/Couldn't read drawings/);
  });

  it("only-stale skips a link read moments ago, so opening a page twice is one read", async () => {
    connect("co_A");
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    procore.requests = [];
    const result = await refreshProcoreFeed(null, true);
    expect(result).toEqual({ ok: true, value: { refreshed: 0, failed: 0, skipped: 0 } });
    expect(procore.requests).toEqual([]);
  });

  it("with the install's keys gone, answers with a sentence and calls nothing", async () => {
    connect("co_A");
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    delete process.env.PROCORE_CLIENT_ID;
    procore.requests = [];
    expect(await refreshProcoreFeed(null, false)).toEqual({ ok: false, error: "Procore isn't set up on this install yet." });
    expect(procore.requests).toEqual([]);
  });
});

describe("token refresh and the rotation race", () => {
  const expired = () => new Date(Date.now() - 1000);

  it("refreshes an expired token and stores the NEW single-use refresh token", async () => {
    const pair = connect("co_A", issuePair(), expired());
    const token = await procoreAccessToken("co_A");
    expect(token).not.toBe(pair.access);
    expect(procore.validRefresh.has(pair.refresh)).toBe(false);
    const storedRefresh = decryptSecret(String(conn("co_A").encryptedRefreshToken));
    expect(procore.validRefresh.has(storedRefresh)).toBe(true);
    expect(openAccess(String(conn("co_A").encryptedAccessToken)).expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("LOST the compare-and-swap: another request stored its pair first — ours is not written, theirs is used", async () => {
    connect("co_A", issuePair(), expired());
    let winner: { access: string; refresh: string } | null = null;
    procore.beforeTokenReply = (grant) => {
      if (grant !== "refresh_token" || winner) return;
      // The other request finishes its own refresh and write right now.
      winner = issuePair();
      conn("co_A").encryptedAccessToken = sealAccess({ accessToken: winner.access, expiresAt: new Date(Date.now() + 3600_000) });
      conn("co_A").encryptedRefreshToken = encryptSecret(winner.refresh);
    };
    const token = await procoreAccessToken("co_A");
    expect(token).toBe(winner!.access);
    expect(decryptSecret(String(conn("co_A").encryptedRefreshToken))).toBe(winner!.refresh);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("LOST the refresh itself (invalid_grant) because the other request spent the token — uses theirs, no reconnect", async () => {
    const pair = connect("co_A", issuePair(), expired());
    let winner: { access: string; refresh: string } | null = null;
    procore.beforeTokenReply = (grant) => {
      if (grant !== "refresh_token" || winner) return;
      procore.validRefresh.delete(pair.refresh);
      winner = issuePair();
      conn("co_A").encryptedAccessToken = sealAccess({ accessToken: winner.access, expiresAt: new Date(Date.now() + 3600_000) });
      conn("co_A").encryptedRefreshToken = encryptSecret(winner.refresh);
    };
    expect(await procoreAccessToken("co_A")).toBe(winner!.access);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("two concurrent refreshes end with a LIVE refresh token stored, never a spent one", async () => {
    connect("co_A", issuePair(), expired());
    const tokens = await Promise.all([procoreAccessToken("co_A"), procoreAccessToken("co_A")]);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) expect(procore.validAccess.has(token)).toBe(true);
    const stored = decryptSecret(String(conn("co_A").encryptedRefreshToken));
    expect(procore.validRefresh.has(stored)).toBe(true);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("a genuinely dead refresh token marks the connection for reconnect and says so", async () => {
    const pair = connect("co_A", issuePair(), expired());
    procore.validRefresh.delete(pair.refresh);
    await expect(procoreAccessToken("co_A")).rejects.toThrow(/Reconnect/);
    expect(conn("co_A").status).toBe("NEEDS_REAUTH");
    expect(table("integrationSyncLog").filter((l) => l.connectionId === "conn_co_A")).toHaveLength(1);
  });

  it("a 401 mid-read refreshes once and carries on", async () => {
    const pair = connect("co_A");
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    procore.validAccess.delete(pair.access); // revoked server-side; still "unexpired" locally
    const result = await refreshProcoreFeed(null, false);
    expect(result).toEqual({ ok: true, value: { refreshed: 1, failed: 0, skipped: 0 } });
    expect(procore.requests.some((r) => r.url.endsWith("/oauth/token"))).toBe(true);
  });
});

describe("READ-ONLY across every action", () => {
  it("every request any action made was a GET to the API or a POST to the token endpoint", async () => {
    connect("co_A", issuePair(), new Date(Date.now() - 1000));
    await listProcoreProjectsForLinking();
    await linkProcoreProject(form({ jobId: "job_A1", procoreCompanyId: "55", procoreProjectId: "9" }));
    await refreshProcoreFeed(null, false);
    const link = table("procoreProjectLink").find((r) => r.companyId === "co_A") as Row;
    await unlinkProcoreProject(link.id);
    await disconnectProcore();

    const api = procore.requests.filter((r) => r.url.startsWith("https://api.procore.com/"));
    const token = procore.requests.filter((r) => r.url === "https://login.procore.com/oauth/token");
    // Every request accounted for by one of the two buckets — and there
    // were requests to account for.
    expect(api.length).toBeGreaterThan(10);
    expect(api.length + token.length).toBe(procore.requests.length);
    expect(api.filter((r) => r.method !== "GET")).toEqual([]);
    expect(token.every((r) => r.method === "POST")).toBe(true);
    // And the company header on every API call but the company list.
    expect(api.filter((r) => !r.url.includes("/rest/v1.0/companies?") && r.companyHeader === null)).toEqual([]);
    expect(api.filter((r) => r.companyHeader !== null && r.companyHeader !== "55" && r.companyHeader !== "77")).toEqual([]);
  });
});
