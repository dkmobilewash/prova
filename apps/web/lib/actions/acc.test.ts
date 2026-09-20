import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The ACC feed's actions end to end, against two fakes. Same shape and same
 * reasoning as lib/actions/procore.test.ts — read that file's header first.
 *
 *   - a database holding TWO companies, honouring `where` (equality on
 *     every key, compound unique keys, `OR`), `select` on flat columns, the
 *     unique indexes this feature relies on, and `$transaction`;
 *   - an Autodesk server behind `fetch`: a token endpoint authenticated by
 *     HTTP Basic auth whose refresh tokens are modelled SINGLE-USE (the
 *     harder, safer-to-test case — see packages/integrations/src/acc.ts's
 *     notes on why real APS behaviour here is not verified), and a REST API
 *     that answers 401 to any token it did not issue and 403 for a hub that
 *     has not added the app as a Custom Integration.
 *
 * Nothing reaches the network. Company B is linked to the SAME ACC project
 * as company A, so every tenant assertion fails if a lookup ever ignores
 * companyId.
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
  accProjectLink: [["jobId"], ["companyId", "accProjectId"]],
  accItem: [["linkId", "kind", "accId"]],
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
      if (name === "accProjectLink") {
        const live = new Set(kept.map((r) => r.id));
        state.tables.set("accItem", table("accItem").filter((i) => live.has(String(i.linkId))));
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

/* ------------------------------ fake Autodesk ---------------------------- */

const acc = {
  validAccess: new Set<string>(),
  validRefresh: new Set<string>(),
  issued: 0,
  requests: [] as { url: string; method: string; auth: string | null; body: string | null }[],
  /** Runs just before the token endpoint answers — lets a test play the
   * "other request" in a refresh race at an exact moment. */
  beforeTokenReply: null as null | ((grant: string) => void),
  forbidSubmittals: false,
  rfis: [] as Record<string, unknown>[],
};

function issuePair() {
  acc.issued++;
  const access = `access-${acc.issued}`;
  const refresh = `refresh-${acc.issued}`;
  acc.validAccess.add(access);
  acc.validRefresh.add(refresh);
  return { access, refresh };
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(input);
  const method = init?.method ?? "GET";
  const headers = (init?.headers ?? {}) as Record<string, string>;
  acc.requests.push({ url: href, method, auth: headers.Authorization ?? null, body: init?.body ? String(init.body) : null });

  if (href === "https://developer.api.autodesk.com/authentication/v2/token") {
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    acc.beforeTokenReply?.(form.grant_type);
    if (form.grant_type !== "refresh_token" || !acc.validRefresh.has(form.refresh_token)) {
      return reply({ error: "invalid_grant" }, 400);
    }
    acc.validRefresh.delete(form.refresh_token); // single-use, modelled as the harder case
    const pair = issuePair();
    return reply({ access_token: pair.access, refresh_token: pair.refresh, expires_in: 3600 });
  }

  const url = new URL(href);
  if (url.origin !== "https://developer.api.autodesk.com") throw new Error(`unexpected fetch ${href}`);
  const token = String(headers.Authorization ?? "").replace("Bearer ", "");
  if (!acc.validAccess.has(token)) return reply({ message: "Unauthorized" }, 401);
  const path = url.pathname;

  if (path === "/project/v1/hubs") {
    return reply({ data: [{ id: "b.55", attributes: { name: "Big GC" } }, { id: "b.77", attributes: { name: "Other GC" } }] });
  }
  if (path === "/project/v1/hubs/b.77/projects") return reply({ message: "App is not connected to this account" }, 403);
  if (path === "/project/v1/hubs/b.55/projects") return reply({ data: [{ id: "b.9", attributes: { name: "Tower A" } }] });
  if (path === "/construction/rfis/v2/projects/9/rfis") return reply({ results: acc.rfis });
  if (path === "/construction/submittals/v2/projects/9/items") {
    if (acc.forbidSubmittals) return reply({}, 403);
    return reply({ results: [{ id: "31", customIdentifier: "09 21 16-1", title: "Board", stateId: "in_review" }] });
  }
  return reply({}, 404);
}

/* -------------------------------- set-up -------------------------------- */

const { linkAccProject, unlinkAccProject, disconnectAcc, listAccProjectsForLinking } = await import("./acc");
const { refreshAccFeed } = await import("./accFeed");
const { accAccessToken, sealAccess, openAccess } = await import("@/lib/acc/connection");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

function connect(companyId: string, pair = issuePair(), expiresAt = new Date(Date.now() + 3600_000)) {
  table("integrationConnection").push({
    id: `conn_${companyId}`,
    companyId,
    provider: "ACC",
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
  process.env.ACC_CLIENT_ID = "cid";
  process.env.ACC_CLIENT_SECRET = "csecret";
  process.env.ACC_REDIRECT_URI = "https://app.cstream.ai/api/acc/callback";
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");

  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.context.role = "OWNER";
  state.context.jobFunction = null;
  state.context.company = { id: "co_A" };

  acc.validAccess = new Set();
  acc.validRefresh = new Set();
  acc.issued = 0;
  acc.requests = [];
  acc.beforeTokenReply = null;
  acc.forbidSubmittals = false;
  acc.rfis = [
    { id: "11", identifier: "RFI-001", subject: "Head of wall", status: "open", dueDate: "2026-09-30" },
    { id: "12", identifier: "RFI-002", subject: "Soffit framing", status: "closed" },
  ];

  table("job").push({ id: "job_A1", companyId: "co_A", name: "Tower A drywall" });
  table("job").push({ id: "job_A2", companyId: "co_A", name: "Clinic" });
  table("job").push({ id: "job_B1", companyId: "co_B", name: "B's tower job" });
  // B already linked the SAME ACC project, and has a cached GC RFI.
  table("accProjectLink").push({
    id: "link_B",
    companyId: "co_B",
    jobId: "job_B1",
    accAccountId: "55",
    accAccountName: "Big GC",
    accProjectId: "9",
    accProjectName: "Tower A",
    lastRefreshedAt: null,
  });
  table("accItem").push({ id: "item_B", companyId: "co_B", linkId: "link_B", kind: "RFI", accId: "11", title: "B's copy", webUrl: "x" });
  connect("co_B", { access: "b-access", refresh: "b-refresh" });
}

beforeEach(() => {
  seed();
  vi.stubGlobal("fetch", fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

const snapshotB = () =>
  JSON.stringify(["accProjectLink", "accItem", "integrationConnection", "job"].map((t) => table(t).filter((r) => r.companyId === "co_B")));

/* --------------------------------- tests -------------------------------- */

describe("linking", () => {
  it("links a project this login can see, reads it, and names it from Autodesk — not from the form", async () => {
    connect("co_A");
    const result = await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9", accProjectName: "FORGED" }));
    expect(result).toEqual({ ok: true });
    const link = table("accProjectLink").find((r) => r.companyId === "co_A") as Row;
    expect(link).toEqual(expect.objectContaining({ jobId: "job_A1", accProjectName: "Tower A", accAccountName: "Big GC", lastRefreshStatus: "SUCCESS" }));
    const items = table("accItem").filter((i) => i.linkId === link.id);
    expect(items.map((i) => `${i.kind}:${i.number}`).sort()).toEqual(["RFI:RFI-001", "RFI:RFI-002", "SUBMITTAL:09 21 16-1"]);
    expect(items.every((i) => i.companyId === "co_A")).toBe(true);
    // The RFI is the GC's, cached — never a row in this company's own log.
    expect(table("rfi")).toEqual([]);
    expect(table("submittal")).toEqual([]);
  });

  it("refuses another company's job, writing nothing", async () => {
    connect("co_A");
    const before = JSON.stringify([...state.tables]);
    const result = await linkAccProject(form({ jobId: "job_B1", accAccountId: "55", accProjectId: "9" }));
    expect(result).toEqual({ ok: false, error: "That job isn't in this company." });
    expect(JSON.stringify([...state.tables])).toBe(before);
  });

  it("refuses a project Autodesk does not list for this login, and one in an account that hasn't added the app", async () => {
    connect("co_A");
    const invented = await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "999" }));
    expect(invented.ok).toBe(false);
    const uninstalled = await linkAccProject(form({ jobId: "job_A1", accAccountId: "77", accProjectId: "9" }));
    expect(uninstalled.ok).toBe(false);
    expect(table("accProjectLink").filter((r) => r.companyId === "co_A")).toEqual([]);
  });

  it("lists an account without the app with the reason, instead of silently leaving it out", async () => {
    connect("co_A");
    const result = await listAccProjectsForLinking();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => [a.name, a.projects.length, Boolean(a.problem)])).toEqual([
      ["Big GC", 1, false],
      ["Other GC", 0, true],
    ]);
    expect(result.value[1].problem).toMatch(/Custom Integrations/);
  });

  it("one job, one project: a second link on the same job is refused", async () => {
    connect("co_A");
    expect((await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }))).ok).toBe(true);
    const again = await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    expect(again).toEqual({ ok: false, error: "Tower A drywall already has an ACC project. Unlink it first." });
  });
});

describe("owner only", () => {
  it("a MEMBER holding every capability is refused by every card action before any read or Autodesk call", async () => {
    connect("co_A");
    state.context.role = "MEMBER";
    state.context.jobFunction = null;
    const writes = state.writes.length;
    const calls = acc.requests.length;
    const results = [
      await listAccProjectsForLinking(),
      await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" })),
      await unlinkAccProject("link_B"),
      await disconnectAcc(),
    ];
    // Requested four verdicts; count the four that came back before reading them.
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/Only the account owner/);
    }
    expect(state.writes.length).toBe(writes);
    expect(acc.requests.length).toBe(calls);
  });
});

describe("capability", () => {
  it("a MEMBER whose job function lacks MANAGE_COMPLIANCE is refused by every card action, ahead of the owner check", async () => {
    connect("co_A");
    // OWNER and a null job function both hold every capability
    // (lib/permissions.ts capabilitiesFor) — this is the one shape that
    // actually exercises the capability guard rather than always falling
    // through to the owner one. FIELD is a real job function that does not
    // include MANAGE_COMPLIANCE.
    state.context.role = "MEMBER";
    state.context.jobFunction = "FIELD";
    const writes = state.writes.length;
    const calls = acc.requests.length;
    const results = [
      await listAccProjectsForLinking(),
      await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" })),
      await unlinkAccProject("link_B"),
      await disconnectAcc(),
    ];
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Integrations aren't part of your job function. Ask the account owner.");
    }
    expect(state.writes.length).toBe(writes);
    expect(acc.requests.length).toBe(calls);
  });

  it("refreshAccFeed is refused for a job function lacking MANAGE_JOBS, before any Autodesk call", async () => {
    connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    // Swap to a function with neither capability — ACCOUNTING holds
    // MANAGE_BILLING/VIEW_COMPANY_FINANCIALS/VIEW_JOB_COSTS, not
    // MANAGE_JOBS. Not owner-only, so the owner check plays no part here.
    state.context.role = "MEMBER";
    state.context.jobFunction = "ACCOUNTING";
    acc.requests = [];
    const result = await refreshAccFeed(null, false);
    expect(result).toEqual({ ok: false, error: "Jobs aren't part of your job function. Ask the account owner." });
    expect(acc.requests).toEqual([]);
  });
});

describe("tenant scope", () => {
  it("unlinking another company's link finds nothing and leaves it exactly as it was", async () => {
    connect("co_A");
    const before = snapshotB();
    expect(await unlinkAccProject("link_B")).toEqual({ ok: false, error: "That link is already gone." });
    expect(snapshotB()).toBe(before);
  });

  it("a refresh reads and writes only this company's links and cache, with this company's token", async () => {
    const pairA = connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    const before = snapshotB();
    acc.requests = [];
    const result = await refreshAccFeed(null, false);
    expect(result).toEqual({ ok: true, value: { refreshed: 1, failed: 0, skipped: 0 } });
    expect(snapshotB()).toBe(before);
    // Requests happened, every one carried A's token, and B's credential
    // appears in none of them — header or body.
    expect(acc.requests.length).toBeGreaterThan(0);
    expect(acc.requests.filter((r) => r.auth !== `Bearer ${pairA.access}`)).toEqual([]);
    expect(acc.requests.filter((r) => `${r.auth} ${r.body}`.includes("b-access") || `${r.body}`.includes("b-refresh"))).toEqual([]);
  });
});

describe("refresh", () => {
  it("replaces each kind it read, keeps the kind it could not, and says which", async () => {
    connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    const link = table("accProjectLink").find((r) => r.companyId === "co_A") as Row;

    acc.forbidSubmittals = true;
    acc.rfis = [{ id: "13", identifier: "RFI-003", subject: "New question", status: "open" }];
    const result = await refreshAccFeed("job_A1", false);
    expect(result).toEqual({ ok: true, value: { refreshed: 0, failed: 1, skipped: 0 } });

    const kinds = table("accItem").filter((i) => i.linkId === link.id).map((i) => `${i.kind}:${i.number}`).sort();
    // RFIs replaced (001 and 002 gone, 003 in); the submittal kept from last time.
    expect(kinds).toEqual(["RFI:RFI-003", "SUBMITTAL:09 21 16-1"]);
    const after = table("accProjectLink").find((r) => r.id === link.id) as Row;
    expect(after.lastRefreshStatus).toBe("FAILURE");
    expect(String(after.lastRefreshMessage)).toMatch(/Couldn't read submittals/);
  });

  it("only-stale skips a link read moments ago, so opening a page twice is one read", async () => {
    connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    acc.requests = [];
    const result = await refreshAccFeed(null, true);
    expect(result).toEqual({ ok: true, value: { refreshed: 0, failed: 0, skipped: 0 } });
    expect(acc.requests).toEqual([]);
  });

  it("with the install's keys gone, answers with a sentence and calls nothing", async () => {
    connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    delete process.env.ACC_CLIENT_ID;
    acc.requests = [];
    expect(await refreshAccFeed(null, false)).toEqual({ ok: false, error: "Autodesk Construction Cloud isn't set up on this install yet." });
    expect(acc.requests).toEqual([]);
  });
});

describe("token refresh and the rotation race", () => {
  const expired = () => new Date(Date.now() - 1000);

  it("refreshes an expired token and stores the NEW single-use refresh token", async () => {
    const pair = connect("co_A", issuePair(), expired());
    const token = await accAccessToken("co_A");
    expect(token).not.toBe(pair.access);
    expect(acc.validRefresh.has(pair.refresh)).toBe(false);
    const storedRefresh = decryptSecret(String(conn("co_A").encryptedRefreshToken));
    expect(acc.validRefresh.has(storedRefresh)).toBe(true);
    expect(openAccess(String(conn("co_A").encryptedAccessToken)).expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("LOST the compare-and-swap: another request stored its pair first — ours is not written, theirs is used", async () => {
    connect("co_A", issuePair(), expired());
    let winner: { access: string; refresh: string } | null = null;
    acc.beforeTokenReply = (grant) => {
      if (grant !== "refresh_token" || winner) return;
      // The other request finishes its own refresh and write right now.
      winner = issuePair();
      conn("co_A").encryptedAccessToken = sealAccess({ accessToken: winner.access, expiresAt: new Date(Date.now() + 3600_000) });
      conn("co_A").encryptedRefreshToken = encryptSecret(winner.refresh);
    };
    const token = await accAccessToken("co_A");
    expect(token).toBe(winner!.access);
    expect(decryptSecret(String(conn("co_A").encryptedRefreshToken))).toBe(winner!.refresh);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("LOST the refresh itself (invalid_grant) because the other request spent the token — uses theirs, no reconnect", async () => {
    const pair = connect("co_A", issuePair(), expired());
    let winner: { access: string; refresh: string } | null = null;
    acc.beforeTokenReply = (grant) => {
      if (grant !== "refresh_token" || winner) return;
      acc.validRefresh.delete(pair.refresh);
      winner = issuePair();
      conn("co_A").encryptedAccessToken = sealAccess({ accessToken: winner.access, expiresAt: new Date(Date.now() + 3600_000) });
      conn("co_A").encryptedRefreshToken = encryptSecret(winner.refresh);
    };
    expect(await accAccessToken("co_A")).toBe(winner!.access);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("two concurrent refreshes end with a LIVE refresh token stored, never a spent one", async () => {
    connect("co_A", issuePair(), expired());
    const tokens = await Promise.all([accAccessToken("co_A"), accAccessToken("co_A")]);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) expect(acc.validAccess.has(token)).toBe(true);
    const stored = decryptSecret(String(conn("co_A").encryptedRefreshToken));
    expect(acc.validRefresh.has(stored)).toBe(true);
    expect(conn("co_A").status).toBe("CONNECTED");
  });

  it("a genuinely dead refresh token marks the connection for reconnect and says so", async () => {
    const pair = connect("co_A", issuePair(), expired());
    acc.validRefresh.delete(pair.refresh);
    await expect(accAccessToken("co_A")).rejects.toThrow(/Reconnect/);
    expect(conn("co_A").status).toBe("NEEDS_REAUTH");
    expect(table("integrationSyncLog").filter((l) => l.connectionId === "conn_co_A")).toHaveLength(1);
  });

  it("a 401 mid-read refreshes once and carries on", async () => {
    const pair = connect("co_A");
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    acc.validAccess.delete(pair.access); // revoked server-side; still "unexpired" locally
    const result = await refreshAccFeed(null, false);
    expect(result).toEqual({ ok: true, value: { refreshed: 1, failed: 0, skipped: 0 } });
    expect(acc.requests.some((r) => r.url.endsWith("/authentication/v2/token"))).toBe(true);
  });
});

describe("READ-ONLY across every action", () => {
  it("every request any action made was a GET to the API or a POST to the token endpoint", async () => {
    connect("co_A", issuePair(), new Date(Date.now() - 1000));
    await listAccProjectsForLinking();
    await linkAccProject(form({ jobId: "job_A1", accAccountId: "55", accProjectId: "9" }));
    await refreshAccFeed(null, false);
    const link = table("accProjectLink").find((r) => r.companyId === "co_A") as Row;
    await unlinkAccProject(link.id);
    await disconnectAcc();

    const api = acc.requests.filter((r) => r.url.startsWith("https://developer.api.autodesk.com/") && !r.url.includes("/authentication/v2/"));
    const token = acc.requests.filter((r) => r.url === "https://developer.api.autodesk.com/authentication/v2/token");
    // Every request accounted for by one of the two buckets — and there
    // were requests to account for.
    expect(api.length).toBeGreaterThan(5);
    expect(api.length + token.length).toBe(acc.requests.length);
    expect(api.filter((r) => r.method !== "GET")).toEqual([]);
    expect(token.every((r) => r.method === "POST")).toBe(true);
    // Every API call carried a bearer token; none carried a client secret.
    expect(api.filter((r) => !r.auth?.startsWith("Bearer "))).toEqual([]);
    expect(api.filter((r) => (r.auth ?? "").includes("csecret"))).toEqual([]);
  });
});
