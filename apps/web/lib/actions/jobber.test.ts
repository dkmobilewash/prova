import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The Jobber import's actions, end to end, against two fakes:
 *
 *   - a database holding TWO companies, which honours `where` (every key,
 *     by equality, compound unique keys included), `select`, `orderBy` on
 *     createdAt, the (companyId, jobberId) unique index, and whether a write
 *     happened inside `$transaction`;
 *   - a Jobber server behind `fetch`: an OAuth token endpoint that ROTATES
 *     refresh tokens and kills the old one, and a GraphQL endpoint that
 *     pages by cursor and answers 401 to any token it did not issue.
 *
 * Nothing reaches the network. Company B is seeded with rows that WOULD
 * match company A's Jobber data by name and by Jobber id — the tenant
 * assertions pass only if B's rows are never read as A's.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  seq: 0,
  writes: [] as string[],
  txOptions: [] as unknown[],
  context: { id: "user_A", role: "OWNER" as string, jobFunction: null as string | null, company: { id: "co_A" } },
  denied: new Set<string>(),
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

function matches(row: Row, where?: Record<string, unknown>) {
  return Object.entries(flatten(where)).every(([key, value]) => (row[key] ?? null) === (value ?? null));
}

function pick(row: Row, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k] ?? null]));
}

const UNIQUE_JOBBER = new Set(["contact", "job"]);

function model(name: string, viaTx: boolean) {
  const write = (op: string) => state.writes.push(`${name}.${op}@${viaTx ? "tx" : "bare"}`);
  const insert = (data: Record<string, unknown>) => {
    if (UNIQUE_JOBBER.has(name) && data.jobberId) {
      if (table(name).some((r) => r.companyId === data.companyId && r.jobberId === data.jobberId)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (companyId, jobberId)"), { code: "P2002" });
      }
    }
    const row = { id: `${name}_${++state.seq}`, createdAt: state.seq, ...data } as Row;
    table(name).push(row);
    return row;
  };
  return {
    findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: unknown } = {}) => {
      const rows = table(name).filter((row) => matches(row, args.where));
      if (args.orderBy) rows.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      return rows.map((row) => pick(row, args.select));
    },
    findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = table(name).find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    createManyAndReturn: async ({ data, select }: { data: Record<string, unknown>[]; select?: Record<string, unknown> }) => {
      write("createManyAndReturn");
      return data.map(insert).map((row) => pick(row, select));
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      write("createMany");
      data.forEach(insert);
      return { count: data.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      write("create");
      return insert(data);
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
  };
}

const proxy = (viaTx: boolean): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get: (_t, property) => {
        if (property === "then" || typeof property === "symbol") return undefined;
        if (property === "$transaction") {
          if (viaTx) throw new Error("nested transactions are not faked");
          return async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => {
            state.txOptions.push(options);
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
vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...real,
    can: (user: Parameters<typeof real.can>[0], capability: Parameters<typeof real.can>[1]) =>
      !state.denied.has(capability) && real.can(user, capability),
  };
});

/* ----------------------------- fake Jobber ----------------------------- */

function jwt(expSeconds: number, tag: string) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc({ exp: expSeconds, tag })}.sig`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const jobber = {
  validAccess: new Set<string>(),
  validRefresh: new Set<string>(),
  issued: 0,
  requests: [] as { kind: "token" | "graphql"; root?: string; auth?: string; grant?: string }[],
  /** Answer 401 to the next N GraphQL calls regardless of token. */
  unauthorizedNext: 0,
  throttleNext: 0,
  data: {
    clients: [] as Record<string, unknown>[],
    jobs: [] as Record<string, unknown>[],
    quotes: [] as Record<string, unknown>[],
    properties: [] as Record<string, unknown>[],
  },
  pageSize: 2,
};

function issuePair() {
  jobber.issued++;
  const access = jwt(nowSeconds() + 3600, `a${jobber.issued}`);
  const refresh = `refresh-${jobber.issued}`;
  jobber.validAccess.add(access);
  jobber.validRefresh.add(refresh);
  return { access, refresh };
}

async function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(url);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (href === "https://api.getjobber.com/api/oauth/token") {
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    jobber.requests.push({ kind: "token", grant: form.grant_type });
    if (form.grant_type !== "refresh_token" || !jobber.validRefresh.has(form.refresh_token)) {
      return reply({ error: "invalid_grant" }, 400);
    }
    // Rotation: the old refresh token dies the moment it is used.
    jobber.validRefresh.delete(form.refresh_token);
    const pair = issuePair();
    return reply({ access_token: pair.access, refresh_token: pair.refresh, expires_in: 3600 });
  }
  if (href === "https://api.getjobber.com/api/graphql") {
    const auth = String((init?.headers as Record<string, string>).Authorization ?? "").replace("Bearer ", "");
    const body = JSON.parse(String(init?.body)) as { query: string; variables: { first: number; after: string | null } };
    const root = /\{\s*(\w+)\(/.exec(body.query)?.[1] ?? "?";
    jobber.requests.push({ kind: "graphql", root, auth });
    if (jobber.unauthorizedNext > 0) {
      jobber.unauthorizedNext--;
      return reply({ message: "Unauthorized" }, 401);
    }
    if (!jobber.validAccess.has(auth)) return reply({ message: "Unauthorized" }, 401);
    if (jobber.throttleNext > 0) {
      jobber.throttleNext--;
      return reply({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 5, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 0, restoreRate: 500 } } },
      });
    }
    const all = jobber.data[root as keyof typeof jobber.data];
    if (!all) return reply({ errors: [{ message: `unknown root ${root}` }] });
    const start = body.variables.after ? Number(body.variables.after) : 0;
    const size = Math.min(body.variables.first, jobber.pageSize);
    const nodes = all.slice(start, start + size);
    const end = start + nodes.length;
    return reply({
      data: { [root]: { nodes, pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null }, totalCount: all.length } },
    });
  }
  throw new Error(`unexpected fetch ${href}`);
}

/* ------------------------------- set-up -------------------------------- */

const { previewJobberImport, confirmJobberImport, disconnectJobber } = await import("./jobber");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

const rows = (name: string, companyId?: string) =>
  table(name).filter((row) => companyId === undefined || row.companyId === companyId);
const snapshotOf = (companyId: string) =>
  JSON.stringify(["contact", "job", "integrationConnection"].map((t) => rows(t, companyId)));

const addr = (street1: string, city = "Reno") => ({ street1, city, province: "NV", postalCode: "89501" });

function connect(companyId: string, pair = issuePair(), extra: Record<string, unknown> = {}) {
  table("integrationConnection").push({
    id: `conn_${companyId}`,
    companyId,
    provider: "JOBBER",
    status: "CONNECTED",
    encryptedAccessToken: encryptSecret(pair.access),
    encryptedRefreshToken: encryptSecret(pair.refresh),
    ...extra,
  });
  return pair;
}

function seed() {
  process.env.JOBBER_CLIENT_ID = "cid";
  process.env.JOBBER_CLIENT_SECRET = "csecret";
  process.env.JOBBER_REDIRECT_URI = "https://app.cstream.ai/api/jobber/callback";
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");

  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.txOptions = [];
  state.denied = new Set();
  state.context.role = "OWNER";
  state.context.jobFunction = null;

  jobber.validAccess = new Set();
  jobber.validRefresh = new Set();
  jobber.issued = 0;
  jobber.requests = [];
  jobber.unauthorizedNext = 0;
  jobber.throttleNext = 0;
  jobber.pageSize = 2;
  jobber.data = {
    clients: [
      { id: "JC1", name: "Maria Lopez", emails: [{ address: "maria@example.com", primary: true }], phones: [{ number: "775-555-0101", primary: true }], billingAddress: addr("12 Oak Ave") },
      { id: "JC2", name: "Acme Builders", emails: [], phones: [], billingAddress: null },
      { id: "JC3", name: "Dan Shah", emails: [{ address: "not-an-email", primary: true }], phones: [], billingAddress: null },
    ],
    jobs: [
      { id: "JJ1", jobNumber: 101, title: "Kitchen remodel", jobStatus: "active", startAt: "2026-10-01T08:00:00-07:00", endAt: "2026-10-20T17:00:00-07:00", instructions: "Demo and rebuild", client: { id: "JC1" }, property: { id: "JP1", address: addr("12 Oak Ave") } },
      { id: "JJ2", jobNumber: 102, title: "Deck", jobStatus: "archived", client: { id: "JC1" }, property: null },
      { id: "JJ3", jobNumber: 103, title: "Bathroom", jobStatus: "requires_invoicing", client: { id: "JC3" }, property: { id: "JP3", address: addr("9 Pine St") } },
    ],
    quotes: [
      { id: "JQ1", quoteNumber: "7", title: "Garage addition", quoteStatus: "awaiting_response", client: { id: "JC2" }, property: { id: "JP2", address: addr("400 Main St") } },
      { id: "JQ2", quoteNumber: "8", title: "Kitchen remodel", quoteStatus: "converted", client: { id: "JC1" }, property: null },
    ],
    properties: [
      { id: "JP1", address: addr("12 Oak Ave"), client: { id: "JC1" } },
      { id: "JP2", address: addr("400 Main St"), client: { id: "JC2" } },
      { id: "JP3", address: addr("9 Pine St"), client: { id: "JC3" } },
    ],
  };

  // Ours: one client typed in by hand before Jobber was connected.
  table("contact").push({ id: "c_A_acme", companyId: "co_A", name: "acme builders", jobberId: null, createdAt: 0 });
  // Theirs: B imported the SAME Jobber client ids under the same names. If
  // any lookup ignores companyId, A's import would see these as its own.
  table("contact").push({ id: "c_B_maria", companyId: "co_B", name: "Maria Lopez", jobberId: "JC1", createdAt: 0 });
  table("job").push({ id: "j_B_kitchen", companyId: "co_B", contactId: "c_B_maria", name: "Kitchen remodel", jobberId: "JJ1" });
  connect("co_B", { access: "b-access", refresh: "b-refresh" });
}

beforeEach(() => {
  seed();
  vi.stubGlobal("fetch", fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

/* -------------------------------- tests -------------------------------- */

describe("preview", () => {
  it("reads every page of Jobber and writes NOTHING — no row, no log, no token", async () => {
    connect("co_A");
    const before = JSON.stringify([...state.tables]);
    const result = await previewJobberImport();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.writes).toEqual([]);
    expect(JSON.stringify([...state.tables])).toBe(before);

    // Page size 2: clients 3 -> 2 pages, jobs 3 -> 2, quotes 2 -> 1, properties 3 -> 2.
    const roots = jobber.requests.filter((r) => r.kind === "graphql").map((r) => r.root);
    expect(roots).toEqual(["clients", "clients", "jobs", "jobs", "quotes", "properties", "properties"]);

    const plan = result.value;
    expect(plan.clients.create.map((c) => c.name)).toEqual(["Maria Lopez", "Dan Shah"]);
    // "Acme Builders" matched the hand-typed "acme builders" by name.
    expect(plan.clients.existing.map((e) => e.label)).toEqual(["Acme Builders"]);
    expect(plan.jobs.create.map((j) => j.name)).toEqual(["Kitchen remodel", "Bathroom", "Garage addition"]);
    expect(plan.jobs.leftOut.map((l) => l.label)).toEqual(["Job #102 Deck", "Quote #8 Kitchen remodel"]);
  });

  it("refuses a non-owner before any request leaves for Jobber", async () => {
    connect("co_A");
    state.context.role = "MEMBER";
    const result = await previewJobberImport();
    expect(result).toEqual({ ok: false, error: "Only the account owner can import from Jobber." });
    expect(jobber.requests).toEqual([]);
  });

  it("refuses without MANAGE_JOBS", async () => {
    connect("co_A");
    state.denied.add("MANAGE_JOBS");
    const result = await previewJobberImport();
    expect(result.ok).toBe(false);
    expect(jobber.requests).toEqual([]);
  });

  it("does not borrow ANOTHER company's connection — B is connected, A is not", async () => {
    const result = await previewJobberImport();
    expect(result).toEqual({ ok: false, error: expect.stringContaining("isn't connected") });
    expect(jobber.requests).toEqual([]);
  });

  it("says Jobber isn't set up when the install has no keys, and calls nothing", async () => {
    connect("co_A");
    delete process.env.JOBBER_CLIENT_SECRET;
    const result = await previewJobberImport();
    expect(result).toEqual({ ok: false, error: "Jobber isn't set up on this install yet." });
    expect(jobber.requests).toEqual([]);
  });
});

describe("confirm", () => {
  it("writes the previewed creates for THIS company only, every job an ESTIMATE, each carrying its Jobber id", async () => {
    connect("co_A");
    const theirs = snapshotOf("co_B");
    const preview = await previewJobberImport();
    const result = await confirmJobberImport();
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ clientsAdded: 2, jobsAdded: 3, alreadyThere: 1 }) });

    const contacts = rows("contact", "co_A").map((c) => [c.name, c.email ?? null, c.address ?? null, c.jobberId]);
    expect(contacts).toEqual([
      ["acme builders", null, null, null],
      ["Maria Lopez", "maria@example.com", "12 Oak Ave, Reno, NV 89501", "JC1"],
      // Billing address missing: the property's address fills it in. The
      // unreadable email is left out rather than stored.
      ["Dan Shah", null, "9 Pine St, Reno, NV 89501", "JC3"],
    ]);

    const jobs = rows("job", "co_A").map((j) => [j.name, j.status, j.jobberId, j.projectLocation, j.contactId]);
    const idOf = (name: string) => rows("contact", "co_A").find((c) => c.name === name)!.id;
    expect(jobs).toEqual([
      ["Kitchen remodel", "ESTIMATE", "JJ1", "12 Oak Ave, Reno, NV 89501", idOf("Maria Lopez")],
      // Jobber said requires_invoicing; it still lands as an estimate.
      ["Bathroom", "ESTIMATE", "JJ3", "9 Pine St, Reno, NV 89501", idOf("Dan Shah")],
      // A quote for the hand-typed client attaches to it, not a new one.
      ["Garage addition", "ESTIMATE", "JQ1", "400 Main St, Reno, NV 89501", "c_A_acme"],
    ]);
    const kitchen = rows("job", "co_A")[0];
    expect((kitchen.startDate as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect((kitchen.endDate as Date).toISOString()).toBe("2026-10-20T00:00:00.000Z");

    // Exactly what the preview promised.
    if (preview.ok) {
      expect(rows("job", "co_A").map((j) => j.name)).toEqual(preview.value.jobs.create.map((j) => j.name));
    }

    // Company B: not matched, not attached to, not changed.
    expect(snapshotOf("co_B")).toBe(theirs);

    // One Serializable transaction, and every row write went through it.
    expect(state.txOptions).toEqual([{ isolationLevel: "Serializable", timeout: 20_000 }]);
    expect(state.writes.filter((w) => w.startsWith("contact.") || w.startsWith("job.")).every((w) => w.endsWith("@tx"))).toBe(true);
    const log = rows("integrationSyncLog").at(-1);
    expect(log).toEqual(expect.objectContaining({ connectionId: "conn_co_A", status: "SUCCESS", direction: "PULL" }));
  });

  it("a second import creates nothing — even after a client and a job are renamed in Jobber", async () => {
    connect("co_A");
    await confirmJobberImport();
    const counts = [rows("contact", "co_A").length, rows("job", "co_A").length];

    jobber.data.clients[0].name = "Maria Lopez-Garcia";
    jobber.data.jobs[0].title = "Kitchen remodel (phase 1)";
    const again = await confirmJobberImport();
    expect(again).toEqual({ ok: true, value: expect.objectContaining({ clientsAdded: 0, jobsAdded: 0 }) });
    expect([rows("contact", "co_A").length, rows("job", "co_A").length]).toEqual(counts);
  });

  it("writes nothing when the pull fails part-way", async () => {
    connect("co_A");
    jobber.data.quotes = [{ id: "JQx" }];
    // A GraphQL error on the quotes query.
    const original = jobber.data.quotes;
    (jobber.data as Record<string, unknown>).quotes = undefined;
    const result = await confirmJobberImport();
    (jobber.data as Record<string, unknown>).quotes = original;
    expect(result.ok).toBe(false);
    expect(rows("contact", "co_A")).toHaveLength(1);
    expect(rows("job", "co_A")).toHaveLength(0);
  });

  it("rides out a throttled response mid-pull", async () => {
    connect("co_A");
    jobber.throttleNext = 1;
    const result = await confirmJobberImport();
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ jobsAdded: 3 }) });
  });
});

describe("tokens", () => {
  it("refreshes an expired access token first, and stores the ROTATED pair encrypted", async () => {
    const stale = { access: jwt(nowSeconds() - 60, "stale"), refresh: "refresh-live" };
    jobber.validRefresh.add("refresh-live");
    connect("co_A", stale);

    const result = await previewJobberImport();
    expect(result.ok).toBe(true);
    expect(jobber.requests[0]).toEqual({ kind: "token", grant: "refresh_token" });

    const row = rows("integrationConnection", "co_A")[0];
    const storedAccess = decryptSecret(String(row.encryptedAccessToken));
    const storedRefresh = decryptSecret(String(row.encryptedRefreshToken));
    expect(storedRefresh).not.toBe("refresh-live");
    expect(jobber.validRefresh.has(storedRefresh)).toBe(true);
    // Stored as envelopes, never as the tokens themselves.
    expect(String(row.encryptedRefreshToken)).not.toContain(storedRefresh);
    expect(String(row.encryptedAccessToken).startsWith("v1.")).toBe(true);
    // Every GraphQL call used the fresh token.
    const auths = new Set(jobber.requests.filter((r) => r.kind === "graphql").map((r) => r.auth));
    expect([...auths]).toEqual([storedAccess]);
  });

  it("two requests refreshing at once: the loser uses the winner's token instead of breaking the connection", async () => {
    jobber.validRefresh.add("refresh-live");
    connect("co_A", { access: jwt(nowSeconds() - 60, "stale"), refresh: "refresh-live" });
    const [one, two] = await Promise.all([previewJobberImport(), previewJobberImport()]);
    expect([one.ok, two.ok]).toEqual([true, true]);
    // Rotation spent the shared refresh token once; the second attempt got
    // invalid_grant and must NOT have marked the connection for reconnect.
    expect(jobber.requests.filter((r) => r.kind === "token")).toHaveLength(2);
    const row = rows("integrationConnection", "co_A")[0];
    expect(row.status).toBe("CONNECTED");
    expect(jobber.validRefresh.has(decryptSecret(String(row.encryptedRefreshToken)))).toBe(true);
  });

  it("refreshes once and retries after a 401, then carries on", async () => {
    connect("co_A");
    jobber.unauthorizedNext = 1;
    const result = await previewJobberImport();
    expect(result.ok).toBe(true);
    expect(jobber.requests.filter((r) => r.kind === "token")).toHaveLength(1);
  });

  it("a dead refresh token marks the connection NEEDS_REAUTH, logs it, and asks for a reconnect", async () => {
    connect("co_A", { access: jwt(nowSeconds() - 60, "stale"), refresh: "refresh-dead" });
    const result = await previewJobberImport();
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Reconnect") });
    const row = rows("integrationConnection", "co_A")[0];
    expect(row.status).toBe("NEEDS_REAUTH");
    expect(rows("integrationSyncLog").at(-1)).toEqual(expect.objectContaining({ connectionId: "conn_co_A", status: "FAILURE" }));
    // B's connection is untouched.
    expect(rows("integrationConnection", "co_B")[0].status).toBe("CONNECTED");
  });
});

describe("disconnect", () => {
  it("drops the credential, keeps everything imported, and is owner-only", async () => {
    connect("co_A");
    await confirmJobberImport();
    const imported = rows("job", "co_A").length;

    state.context.role = "MEMBER";
    expect((await disconnectJobber()).ok).toBe(false);
    expect(rows("integrationConnection", "co_A")[0].encryptedAccessToken).not.toBeNull();

    state.context.role = "OWNER";
    expect(await disconnectJobber()).toEqual({ ok: true });
    const row = rows("integrationConnection", "co_A")[0];
    expect([row.status, row.encryptedAccessToken, row.encryptedRefreshToken]).toEqual(["NOT_CONNECTED", null, null]);
    expect(rows("job", "co_A")).toHaveLength(imported);
    expect(rows("integrationConnection", "co_B")[0].status).toBe("CONNECTED");
  });
});
