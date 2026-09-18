import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The QuickBooks import's actions, end to end, against two fakes:
 *
 *   - a database holding TWO companies, which honours `where` (every key, by
 *     equality, compound unique keys included), `select`, `orderBy` on
 *     createdAt, BOTH unique indexes on QuickBooksEntityLink, and whether a
 *     write happened inside `$transaction` (rolled back if it throws);
 *   - a QuickBooks server behind `fetch`: Intuit's token endpoint, which
 *     ROTATES refresh tokens, and the Accounting API's query endpoint, which
 *     honours STARTPOSITION / MAXRESULTS / ORDERBY, refuses MAXRESULTS over
 *     1000, answers 401 to a token it did not issue, and scopes every token
 *     to ONE realm.
 *
 * Nothing reaches the network. Company B is seeded with rows and links that
 * WOULD match company A's QuickBooks data by name and by QuickBooks id — the
 * tenant assertions pass only if B's rows are never read as A's.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  seq: 0,
  writes: [] as string[],
  txOptions: [] as unknown[],
  context: { id: "user_A", role: "OWNER" as string, jobFunction: null as string | null, company: { id: "co_A" } },
  denied: new Set<string>(),
  collideOnLink: false,
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
    if (key.includes("_") && value && typeof value === "object" && !(value instanceof Date)) Object.assign(out, value);
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

const unique = (code: string) => Object.assign(new Error(`Unique constraint failed on the fields: ${code}`), { code: "P2002" });

function model(name: string, viaTx: boolean) {
  const write = (op: string) => state.writes.push(`${name}.${op}@${viaTx ? "tx" : "bare"}`);
  const insert = (data: Record<string, unknown>) => {
    if (name === "quickBooksEntityLink") {
      if (state.collideOnLink) {
        state.collideOnLink = false;
        throw unique("(companyId, entityType, qboId)");
      }
      const same = (r: Row) => r.companyId === data.companyId && r.entityType === data.entityType;
      if (table(name).some((r) => same(r) && r.entityId === data.entityId)) throw unique("(companyId, entityType, entityId)");
      if (table(name).some((r) => same(r) && r.qboId === data.qboId)) throw unique("(companyId, entityType, qboId)");
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
      // Returned in REVERSE, on purpose: nothing promises RETURNING order,
      // so the action must map rows back by what they are, not by position.
      return data.map(insert).reverse().map((row) => pick(row, select));
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

/* ---------------------------- fake QuickBooks ---------------------------- */

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API = "https://sandbox-quickbooks.api.intuit.com/v3/company/";

const qbo = {
  /** access token -> the realm it was issued for */
  access: new Map<string, string>(),
  refresh: new Map<string, string>(),
  issued: 0,
  requests: [] as { method: string; url: string; realm?: string; entity?: string; start?: number; max?: number }[],
  refuseRefresh: false,
  realms: new Map<string, { Customer: Record<string, unknown>[]; Vendor: Record<string, unknown>[]; Item: Record<string, unknown>[] }>(),
};

function issue(realm: string) {
  qbo.issued++;
  const pair = { access: `qa${qbo.issued}`, refresh: `qr${qbo.issued}` };
  qbo.access.set(pair.access, realm);
  qbo.refresh.set(pair.refresh, realm);
  return pair;
}

const SORT: Record<string, string> = { Customer: "DisplayName", Vendor: "DisplayName", Item: "Name" };

async function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(url);
  const method = (init?.method ?? "GET").toUpperCase();
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (href === TOKEN_URL) {
    qbo.requests.push({ method, url: href });
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    const realm = qbo.refresh.get(form.refresh_token);
    if (qbo.refuseRefresh || form.grant_type !== "refresh_token" || !realm) {
      return reply({ error: "invalid_grant" }, 400);
    }
    qbo.refresh.delete(form.refresh_token); // rotation
    const pair = issue(realm);
    return reply({
      access_token: pair.access,
      refresh_token: pair.refresh,
      expires_in: 3600,
      x_refresh_token_expires_in: 8_726_400,
      token_type: "bearer",
    });
  }

  if (href.startsWith(API)) {
    const [realm, rest] = href.slice(API.length).split(/\/(.*)/s);
    const entry: (typeof qbo.requests)[number] = { method, url: href, realm };
    qbo.requests.push(entry);
    const auth = String((init?.headers as Record<string, string>).Authorization ?? "").replace("Bearer ", "");
    if (qbo.access.get(auth) !== realm) return reply({ Fault: { Error: [{ Message: "AuthenticationFailed" }] } }, 401);
    if (method !== "GET" || !rest.startsWith("query?query=")) return reply({ Fault: { Error: [{ Message: "not faked" }] } }, 400);
    const query = decodeURIComponent(rest.slice("query?query=".length));
    const parsed = /^select \* from (Customer|Vendor|Item) ORDERBY (\w+) STARTPOSITION (\d+) MAXRESULTS (\d+)$/.exec(query);
    if (!parsed) return reply({ Fault: { Error: [{ Message: `bad query ${query}` }] } }, 400);
    const [, entity, sortBy, startText, maxText] = parsed;
    const start = Number(startText);
    const max = Number(maxText);
    Object.assign(entry, { entity, start, max });
    if (max > 1000) return reply({ Fault: { Error: [{ Message: "MAXRESULTS over 1000" }] } }, 400);
    if (sortBy !== SORT[entity]) return reply({ Fault: { Error: [{ Message: `${sortBy} is not sortable` }] } }, 400);
    const all = [...(qbo.realms.get(realm)?.[entity as "Customer"] ?? [])].sort((a, b) =>
      String(a[sortBy]).localeCompare(String(b[sortBy])),
    );
    const page = all.slice(start - 1, start - 1 + max);
    return reply({ QueryResponse: page.length ? { [entity]: page, startPosition: start, maxResults: page.length } : {} });
  }
  throw new Error(`unexpected fetch ${method} ${href}`);
}

/* -------------------------------- set-up -------------------------------- */

const { previewQuickBooksImport, confirmQuickBooksImport } = await import("./quickbooksImport");
const { pullFromQuickBooks } = await import("@/lib/quickbooks-import-pull");

const rows = (name: string, companyId?: string) =>
  table(name).filter((row) => companyId === undefined || row.companyId === companyId);
const TENANT_TABLES = ["contact", "vendor", "lineItemCatalogEntry", "quickBooksEntityLink", "quickBooksSyncAttempt", "quickBooksConnection"];
const snapshotOf = (companyId: string) => JSON.stringify(TENANT_TABLES.map((t) => rows(t, companyId)));
const accountingRequests = () => qbo.requests.filter((r) => r.url.startsWith(API));

function connect(companyId: string, realm: string, { expired = false } = {}) {
  const pair = issue(realm);
  table("quickBooksConnection").push({
    id: `qbc_${companyId}`,
    companyId,
    realmId: realm,
    accessToken: pair.access,
    refreshToken: pair.refresh,
    accessTokenExpiresAt: new Date(Date.now() + (expired ? -1000 : 3_600_000)),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    status: "CONNECTED",
  });
  return pair;
}

const customer = (Id: string, DisplayName: string, more: Record<string, unknown> = {}) => ({ Id, DisplayName, ...more });

function seed() {
  process.env.QUICKBOOKS_CLIENT_ID = "cid";
  process.env.QUICKBOOKS_CLIENT_SECRET = "csecret";
  process.env.QUICKBOOKS_REDIRECT_URI = "https://app.cstream.ai/api/quickbooks/callback";
  delete process.env.QUICKBOOKS_ENVIRONMENT;

  state.tables = new Map();
  for (const name of TENANT_TABLES) table(name);
  state.seq = 0;
  state.writes = [];
  state.txOptions = [];
  state.denied = new Set();
  state.collideOnLink = false;
  state.context.role = "OWNER";
  state.context.jobFunction = null;

  qbo.access = new Map();
  qbo.refresh = new Map();
  qbo.issued = 0;
  qbo.requests = [];
  qbo.refuseRefresh = false;
  qbo.realms = new Map([
    [
      "realm_A",
      {
        Customer: [
          customer("1", "Turner Construction", {
            PrimaryEmailAddr: { Address: "ap@turner.example" },
            PrimaryPhone: { FreeFormNumber: "303-555-0100" },
            BillAddr: { Line1: "1 Main St", City: "Denver", CountrySubDivisionCode: "CO", PostalCode: "80202" },
          }),
          customer("2", "Hensel Phelps"),
          customer("3", "Tower B", { Job: true, ParentRef: { value: "1", name: "Turner Construction" } }),
          customer("4", "Sole Prop 123-45-6789"),
        ],
        Vendor: [
          { Id: "10", DisplayName: "ABC Supply", GivenName: "Pat", FamilyName: "Doe", TaxIdentifier: "XXXXXX4321", Vendor1099: true },
          { Id: "11", DisplayName: "Home Depot" },
        ],
        Item: [
          { Id: "20", Name: "Hang", FullyQualifiedName: "Drywall:Hang", Type: "Service", UnitPrice: 1.25, PurchaseCost: 0.8 },
          { Id: "21", Name: "Drywall", FullyQualifiedName: "Drywall", Type: "Category" },
          { Id: "22", Name: "Prova — Construction services", FullyQualifiedName: "Prova — Construction services", Type: "Service" },
        ],
      },
    ],
    ["realm_B", { Customer: [customer("1", "Should never be read by A")], Vendor: [], Item: [] }],
  ]);

  // Ours: a client typed in by hand before QuickBooks was connected, and the
  // invoice push's own income item link.
  table("contact").push({ id: "c_A_hensel", companyId: "co_A", name: "hensel phelps", createdAt: 0 });
  table("quickBooksEntityLink").push({ id: "l_A_item", companyId: "co_A", entityType: "Item", entityId: "Prova — Construction services", qboId: "22" });
  // Theirs: B imported the SAME QuickBooks ids under the same names. If any
  // lookup ignores companyId, A's import would see these as its own.
  table("contact").push({ id: "c_B_turner", companyId: "co_B", name: "Turner Construction", createdAt: 0 });
  table("vendor").push({ id: "v_B_abc", companyId: "co_B", name: "ABC Supply", createdAt: 0 });
  table("quickBooksEntityLink").push({ id: "l_B_1", companyId: "co_B", entityType: "Contact", entityId: "c_B_turner", qboId: "1" });
  table("quickBooksEntityLink").push({ id: "l_B_10", companyId: "co_B", entityType: "Vendor", entityId: "v_B_abc", qboId: "10" });
  connect("co_B", "realm_B");
}

beforeEach(() => {
  seed();
  vi.stubGlobal("fetch", fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

/* --------------------------------- tests --------------------------------- */

describe("preview", () => {
  it("reads QuickBooks and writes NOTHING — no row, no link, no log", async () => {
    connect("co_A", "realm_A");
    const before = JSON.stringify([...state.tables]);
    const result = await previewQuickBooksImport();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.writes).toEqual([]);
    expect(JSON.stringify([...state.tables])).toBe(before);

    const plan = result.value;
    expect(plan.clients.create.map((row) => row.name)).toEqual(["Turner Construction"]);
    expect(plan.clients.existing.map((row) => row.label)).toEqual(["Hensel Phelps"]);
    expect(plan.clients.leftOut.map((row) => row.label)).toEqual(["Tower B"]);
    expect(plan.clients.problems).toHaveLength(1);
    expect(plan.vendors.create.map((row) => row.name)).toEqual(["ABC Supply", "Home Depot"]);
    expect(plan.catalog.create.map((row) => row.description)).toEqual(["Drywall:Hang"]);
    expect(plan.catalog.leftOut.map((row) => row.label)).toEqual(["Drywall", "Prova — Construction services"]);
  });

  it("never lets a vendor's tax id past the integration boundary", async () => {
    connect("co_A", "realm_A");
    const result = await previewQuickBooksImport();
    expect(JSON.stringify(result)).not.toContain("4321");
    expect(JSON.stringify(result)).not.toMatch(/TaxIdentifier|1099/);
  });
});

describe("paging", () => {
  it("reads past the first page with STARTPOSITION/MAXRESULTS, and every record arrives", async () => {
    connect("co_A", "realm_A");
    qbo.realms.get("realm_A")!.Customer = Array.from({ length: 2345 }, (_, i) =>
      customer(String(1000 + i), `Client ${String(i).padStart(4, "0")}`),
    );
    const pull = await pullFromQuickBooks("co_A");
    expect(pull.customers).toHaveLength(2345);
    expect(new Set(pull.customers.map((c) => c.id)).size).toBe(2345);
    expect(pull.truncated.customers).toBe(false);
    const pages = accountingRequests().filter((r) => r.entity === "Customer");
    expect(pages.map((r) => [r.start, r.max])).toEqual([
      [1, 1000],
      [1001, 1000],
      [2001, 1000],
    ]);
  });

  it("stops at the limit and says the account was cut short — but not when it holds exactly the limit", async () => {
    connect("co_A", "realm_A");
    qbo.realms.get("realm_A")!.Customer = Array.from({ length: 7 }, (_, i) => customer(String(i + 1), `C${i}`));
    const over = await pullFromQuickBooks("co_A", { pageSize: 2, limit: 6 });
    expect(over.customers).toHaveLength(6);
    expect(over.truncated.customers).toBe(true);

    qbo.realms.get("realm_A")!.Customer = Array.from({ length: 6 }, (_, i) => customer(String(i + 1), `C${i}`));
    const exact = await pullFromQuickBooks("co_A", { pageSize: 2, limit: 6 });
    expect(exact.customers).toHaveLength(6);
    expect(exact.truncated.customers).toBe(false);
  });

  it("the preview shows the cap on what is created, and a second confirm picks up the rest", async () => {
    connect("co_A", "realm_A");
    qbo.realms.get("realm_A")!.Customer = Array.from({ length: 1203 }, (_, i) =>
      customer(String(5000 + i), `Client ${String(i).padStart(4, "0")}`),
    );
    const first = await confirmQuickBooksImport();
    expect(first.ok && first.value.clientsAdded).toBe(500);
    const second = await confirmQuickBooksImport();
    expect(second.ok && second.value.clientsAdded).toBe(500);
    const third = await confirmQuickBooksImport();
    expect(third.ok && third.value.clientsAdded).toBe(203);
    expect(rows("contact", "co_A")).toHaveLength(1 + 1203);
  });
});

describe("token", () => {
  it("refreshes an expired access token through the invoice push's own code, stores the rotated pair, and reads with the new one", async () => {
    const old = connect("co_A", "realm_A", { expired: true });
    const result = await previewQuickBooksImport();
    expect(result.ok).toBe(true);
    const tokenCalls = qbo.requests.filter((r) => r.url === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    const stored = rows("quickBooksConnection", "co_A")[0];
    expect(stored.accessToken).not.toBe(old.access);
    expect(stored.refreshToken).not.toBe(old.refresh);
    // The only write a preview can cause: the credential, never the import's rows.
    expect(state.writes).toEqual(["quickBooksConnection.update@bare"]);
    expect(accountingRequests().length).toBeGreaterThan(0);
  });

  it("a refused refresh becomes a sentence to reconnect, not a thrown error", async () => {
    connect("co_A", "realm_A", { expired: true });
    qbo.refuseRefresh = true;
    const result = await previewQuickBooksImport();
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Disconnect and connect QuickBooks again/) });
    expect(accountingRequests()).toEqual([]);
  });

  it("not connected is a sentence too", async () => {
    const result = await previewQuickBooksImport();
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/isn't connected/) });
  });
});

describe("confirm", () => {
  it("writes clients, vendors and catalog entries in one Serializable transaction, each linked to its QuickBooks record", async () => {
    connect("co_A", "realm_A");
    const result = await confirmQuickBooksImport();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ clientsAdded: 1, vendorsAdded: 2, catalogAdded: 1 });
    expect(state.txOptions).toEqual([{ isolationLevel: "Serializable", timeout: 20_000 }]);
    expect(state.writes.every((w) => w.endsWith("@tx"))).toBe(true);

    const turner = rows("contact", "co_A").find((c) => c.name === "Turner Construction")!;
    expect(turner).toMatchObject({ email: "ap@turner.example", phone: "303-555-0100", address: "1 Main St, Denver, CO 80202" });
    const abc = rows("vendor", "co_A").find((v) => v.name === "ABC Supply")!;
    expect(abc.contactName).toBe("Pat Doe");
    const hang = rows("lineItemCatalogEntry", "co_A")[0];
    expect(hang).toMatchObject({ description: "Drywall:Hang", defaultUnitPrice: "1.25", defaultBudgetedUnitCost: "0.80" });

    // Mapped back by name even though the fake returns rows in reverse.
    const links = rows("quickBooksEntityLink", "co_A").filter((l) => l.entityType !== "Item");
    const pairs = links.map((l) => `${l.entityType}:${l.qboId}`).sort();
    expect(pairs).toEqual(["Contact:1", "LineItemCatalogEntry:20", "Vendor:10", "Vendor:11"]);
    expect(links.find((l) => l.qboId === "1")!.entityId).toBe(turner.id);
    expect(links.find((l) => l.qboId === "10")!.entityId).toBe(abc.id);

    // Logged where the invoice push logs, so Settings shows it happened.
    expect(rows("quickBooksSyncAttempt", "co_A")).toEqual([
      expect.objectContaining({ entityType: "Import", outcome: "SUCCEEDED", attemptedByUserId: "user_A" }),
    ]);
  });

  it("the SSN refusal still applies — that customer is not written anywhere", async () => {
    connect("co_A", "realm_A");
    await confirmQuickBooksImport();
    expect(JSON.stringify([...state.tables])).not.toContain("123-45-6789");
  });

  it("re-importing creates no duplicates, even after a rename in QuickBooks", async () => {
    connect("co_A", "realm_A");
    await confirmQuickBooksImport();
    const counts = () => ["contact", "vendor", "lineItemCatalogEntry", "quickBooksEntityLink"].map((t) => rows(t, "co_A").length);
    const after = counts();

    const realm = qbo.realms.get("realm_A")!;
    realm.Customer[0] = { ...realm.Customer[0], DisplayName: "Turner Construction Co." };
    realm.Vendor[0] = { ...realm.Vendor[0], DisplayName: "ABC Supply Inc" };
    realm.Item[0] = { ...realm.Item[0], FullyQualifiedName: "Drywall:Hang board" };

    const again = await confirmQuickBooksImport();
    expect(again.ok && again.value).toMatchObject({ clientsAdded: 0, vendorsAdded: 0, catalogAdded: 0 });
    expect(counts()).toEqual(after);
    const preview = await previewQuickBooksImport();
    expect(preview.ok && preview.value.clients.existing.map((e) => e.label)).toContain(
      "Turner Construction Co. (here as Turner Construction)",
    );
  });

  it("a collision on the link's unique index rolls everything back and returns a sentence", async () => {
    connect("co_A", "realm_A");
    // Another import committed the same link between this one's read and
    // its write — the index is the last line.
    state.collideOnLink = true;
    const result = await confirmQuickBooksImport();
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Another import for your company/) });
    expect(rows("contact", "co_A")).toHaveLength(1);
    expect(rows("vendor", "co_A")).toHaveLength(0);
    expect(rows("lineItemCatalogEntry", "co_A")).toHaveLength(0);
    expect(rows("quickBooksSyncAttempt", "co_A")).toHaveLength(0);
  });
});

describe("tenant scope", () => {
  it("reads A's QuickBooks with A's token and realm, matches only A's rows, and leaves B untouched", async () => {
    connect("co_A", "realm_A");
    const beforeB = snapshotOf("co_B");
    const result = await confirmQuickBooksImport();
    expect(result.ok).toBe(true);
    expect(snapshotOf("co_B")).toBe(beforeB);
    expect(accountingRequests().every((r) => r.realm === "realm_A")).toBe(true);
    // B's "Turner Construction" (linked to QuickBooks id 1) did not make A's
    // Turner "already here".
    expect(rows("contact", "co_A").map((c) => c.name)).toContain("Turner Construction");
    for (const link of rows("quickBooksEntityLink", "co_A")) expect(link.companyId).toBe("co_A");
  });
});

describe("read-only toward QuickBooks", () => {
  it("every Accounting API request from preview and confirm is a GET — and there were some", async () => {
    connect("co_A", "realm_A", { expired: true });
    await previewQuickBooksImport();
    await confirmQuickBooksImport();
    const calls = accountingRequests();
    expect(calls.length).toBeGreaterThanOrEqual(6); // three kinds, twice
    expect(calls.filter((r) => r.method !== "GET")).toEqual([]);
    // The one POST allowed anywhere is the OAuth refresh, which is not the
    // Accounting API and changes nothing in anybody's books.
    expect(qbo.requests.filter((r) => r.method !== "GET").every((r) => r.url === TOKEN_URL)).toBe(true);
  });
});

describe("guards", () => {
  it("refuses a non-owner before reading anything — no database, no QuickBooks", async () => {
    connect("co_A", "realm_A");
    state.context.role = "MEMBER";
    const before = qbo.requests.length;
    for (const action of [previewQuickBooksImport, confirmQuickBooksImport]) {
      const result = await action();
      expect(result).toEqual({ ok: false, error: "Only the account owner can import from QuickBooks." });
    }
    expect(qbo.requests.length).toBe(before);
    expect(state.writes).toEqual([]);
  });

  it("answers to the capabilities of what it creates", async () => {
    connect("co_A", "realm_A");
    for (const capability of ["MANAGE_COMPLIANCE", "MANAGE_JOBS", "MANAGE_ESTIMATING"]) {
      state.denied = new Set([capability]);
      const result = await confirmQuickBooksImport();
      expect(result.ok, capability).toBe(false);
    }
    expect(accountingRequests()).toEqual([]);
    expect(rows("contact", "co_A")).toHaveLength(1);
  });
});
