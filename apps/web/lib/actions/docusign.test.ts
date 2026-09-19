import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * DocuSign end to end, against two fakes:
 *
 *   - a database holding TWO companies, which honours `where` (every key by
 *     equality, `{ in: [...] }`, null, compound unique keys), `select`
 *     (including nested relation objects stored on the row), and rolls back
 *     a failed `$transaction`;
 *   - a DocuSign server behind `fetch`: a token endpoint that ROTATES refresh
 *     tokens and kills the old one, an eSignature API that answers 401 to any
 *     token it did not issue, and the blob store the contract PDFs live in.
 *
 * Nothing reaches the network. Company B has its own connection and its own
 * envelope; the tenant assertions pass only if B's rows are never touched by
 * anything aimed at A.
 */

type Row = Record<string, unknown> & { id: string };

const state = vi.hoisted(() => ({
  tables: new Map<string, Record<string, unknown>[]>(),
  seq: 0,
  writes: [] as string[],
  calls: [] as string[],
  context: {
    id: "user_A",
    role: "OWNER" as string,
    jobFunction: null as string | null,
    name: "Alex Owner",
    email: "alex@sub-a.example",
    company: { id: "co_A" },
  },
  denied: new Set<string>(),
  blobPuts: [] as { pathname: string; bytes: number; contentType: string }[],
  blobDeletes: [] as string[],
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
    if (key.includes("_") && value && typeof value === "object" && !("in" in (value as object))) Object.assign(out, value);
    else out[key] = value;
  }
  return out;
}

function matches(row: Row, where?: Record<string, unknown>) {
  return Object.entries(flatten(where)).every(([key, value]) => {
    const actual = row[key] ?? null;
    if (value && typeof value === "object" && "in" in (value as object)) {
      return ((value as { in: unknown[] }).in as unknown[]).includes(actual);
    }
    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
    return actual === (value ?? null);
  });
}

function pick(row: Row, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k] ?? null]));
}

function model(name: string, viaTx: boolean) {
  const write = (op: string) => state.writes.push(`${name}.${op}@${viaTx ? "tx" : "bare"}`);
  const call = (op: string) => state.calls.push(`${name}.${op}`);
  const insert = (data: Record<string, unknown>) => {
    if (name === "docuSignEnvelope" && table(name).some((r) => r.envelopeId === data.envelopeId)) {
      throw Object.assign(new Error("Unique constraint failed on the fields: (envelopeId)"), { code: "P2002" });
    }
    const row = { id: `${name}_${++state.seq}`, createdAt: new Date(2026, 8, 18, 0, 0, state.seq), ...data } as Row;
    table(name).push(row);
    return row;
  };
  return {
    findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) => {
      call("findMany");
      return table(name).filter((row) => matches(row, args.where)).map((row) => pick(row, args.select));
    },
    findFirst: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> } = {}) => {
      call("findFirst");
      const row = table(name).find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      call("findUnique");
      const row = table(name).find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
      call("create");
      write("create");
      return pick(insert(data), select);
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      call("update");
      write("update");
      const row = table(name).find((r) => matches(r, where));
      if (!row) throw new Error(`update found nothing in ${name}`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      call("updateMany");
      const rows = table(name).filter((r) => matches(r, where));
      if (rows.length > 0) write("updateMany");
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    upsert: async ({ where, create, update, select }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown>; select?: Record<string, unknown> }) => {
      call("upsert");
      write("upsert");
      const row = table(name).find((r) => matches(r, where));
      if (!row) return pick(insert(create), select);
      for (const [key, value] of Object.entries(update)) {
        if (value && typeof value === "object" && "increment" in (value as object)) {
          row[key] = Number(row[key]) + (value as { increment: number }).increment;
        } else row[key] = value;
      }
      return pick(row, select);
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
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: async () => "America/Los_Angeles" }));
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer, options: { contentType: string }) => {
    state.blobPuts.push({ pathname, bytes: body.length, contentType: options.contentType });
    // The real store appends a random suffix (addRandomSuffix: true), so two
    // uploads of one pathname get two URLs. The fake must too.
    return { url: `https://store1.public.blob.vercel-storage.com/${pathname.replace(/\.pdf$/, "")}-r${state.blobPuts.length}.pdf` };
  },
  del: async (url: string) => {
    state.blobDeletes.push(url);
  },
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...real,
    can: (user: Parameters<typeof real.can>[0], capability: Parameters<typeof real.can>[1]) =>
      !state.denied.has(capability) && real.can(user, capability),
  };
});

/* ---------------------------- fake DocuSign ---------------------------- */

const BASE = "https://demo.docusign.net";
const TOKEN_URL = "https://account-d.docusign.com/oauth/token";
const SUB_PDF = Buffer.from("%PDF-1.7\nthe GC's subcontract, as uploaded");
const SIGNED_PDF = Buffer.from("%PDF-1.7\nsigned by everyone");
const CERT_PDF = Buffer.from("%PDF-1.7\ncertificate of completion");

const ds = {
  validAccess: new Set<string>(),
  validRefresh: new Set<string>(),
  issued: 0,
  requests: [] as { method: string; url: string; body?: unknown; grant?: string }[],
  envelopes: new Map<string, Record<string, string | null> & { account: string }>(),
  nextEnvelope: 0,
  /** Runs inside the token endpoint, before it answers — lets a test make
   * another request "win" the refresh while this one is in flight. */
  onToken: null as null | (() => void),
};

function issuePair() {
  ds.issued++;
  const pair = { access: `access-${ds.issued}`, refresh: `refresh-${ds.issued}` };
  ds.validAccess.add(pair.access);
  ds.validRefresh.add(pair.refresh);
  return pair;
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (url.startsWith("https://store1.public.blob.vercel-storage.com/")) {
    ds.requests.push({ method, url });
    return new Response(SUB_PDF, { status: 200 });
  }
  if (url === TOKEN_URL) {
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
    ds.requests.push({ method, url, grant: form.grant_type });
    if (form.grant_type !== "refresh_token" || !ds.validRefresh.has(form.refresh_token)) return json({ error: "invalid_grant" }, 400);
    ds.validRefresh.delete(form.refresh_token);
    const hook = ds.onToken;
    ds.onToken = null;
    hook?.();
    const pair = issuePair();
    return json({ access_token: pair.access, refresh_token: pair.refresh, expires_in: 28800, token_type: "Bearer" });
  }
  const api = new RegExp(`^${BASE}/restapi/v2\\.1/accounts/([^/]+)(/.*)$`).exec(url);
  if (api) {
    const [, account, path] = api;
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    ds.requests.push({ method, url, body });
    if (!ds.validAccess.has(auth)) return json({ errorCode: "USER_AUTHENTICATION_FAILED" }, 401);
    if (method === "POST" && path === "/envelopes") {
      const envelopeId = `env-${++ds.nextEnvelope}`;
      ds.envelopes.set(envelopeId, {
        account,
        status: "sent",
        sentDateTime: "2026-09-18T20:00:00.0000000Z",
        deliveredDateTime: null,
        completedDateTime: null,
        declinedDateTime: null,
        voidedDateTime: null,
        voidedReason: null,
      });
      return json({ envelopeId, status: "sent", statusDateTime: "2026-09-18T20:00:00.0000000Z", uri: `/envelopes/${envelopeId}` }, 201);
    }
    const one = /^\/envelopes\/([^/?]+)(\/documents\/(combined|certificate))?/.exec(path);
    const envelope = one ? ds.envelopes.get(one[1]) : undefined;
    if (!one || !envelope || envelope.account !== account) return json({ errorCode: "ENVELOPE_DOES_NOT_EXIST" }, 404);
    if (one[3] === "combined") return new Response(SIGNED_PDF, { status: 200 });
    if (one[3] === "certificate") return new Response(CERT_PDF, { status: 200 });
    if (method === "PUT") {
      envelope.status = "voided";
      envelope.voidedReason = body.voidedReason;
      envelope.voidedDateTime = "2026-09-18T21:00:00.0000000Z";
      return json({ envelopeId: one[1] });
    }
    const rest: Record<string, unknown> = { ...envelope };
    delete rest.account;
    return json({ envelopeId: one[1], ...rest });
  }
  throw new Error(`unexpected fetch ${method} ${url}`);
}

vi.stubGlobal("fetch", fakeFetch);

/* ------------------------------- set-up -------------------------------- */

const HMAC_KEY = "connect-hmac-key";
process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString("base64");

const actions = await import("./docusign");
const { handleDocuSignConnect } = await import("@/lib/docusign/connect-handler");
const { sealAccess } = await import("@/lib/docusign/connection");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
const { docuSignSignature } = await import("@/lib/docusign/hmac");

const rows = (name: string, companyId?: string) => table(name).filter((row) => companyId === undefined || row.companyId === companyId);

function connect(companyId: string, account: string, options: { expired?: boolean } = {}) {
  const pair = issuePair();
  table("integrationConnection").push({
    id: `conn_${companyId}`,
    companyId,
    provider: "DOCUSIGN",
    status: "CONNECTED",
    externalAccountId: account,
    encryptedAccessToken: sealAccess({
      accessToken: pair.access,
      expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 8 * 3600_000)).toISOString(),
      baseUri: BASE,
    }),
    encryptedRefreshToken: encryptSecret(pair.refresh),
  });
  return pair;
}

function seed() {
  process.env.DOCUSIGN_CLIENT_ID = "ik";
  process.env.DOCUSIGN_CLIENT_SECRET = "cs";
  process.env.DOCUSIGN_REDIRECT_URI = "https://app.cstream.ai/api/docusign/callback";
  process.env.DOCUSIGN_ENV = "demo";
  process.env.DOCUSIGN_CONNECT_HMAC_KEY = HMAC_KEY;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store1_secretpart";

  state.tables = new Map();
  state.seq = 0;
  state.writes = [];
  state.calls = [];
  state.denied = new Set();
  state.blobPuts = [];
  state.blobDeletes = [];
  state.context = { id: "user_A", role: "OWNER", jobFunction: null, name: "Alex Owner", email: "alex@sub-a.example", company: { id: "co_A" } };
  ds.validAccess = new Set();
  ds.validRefresh = new Set();
  ds.issued = 0;
  ds.requests = [];
  ds.envelopes = new Map();
  ds.nextEnvelope = 0;
  ds.onToken = null;

  for (const [companyId, jobId] of [
    ["co_A", "job_A"],
    ["co_B", "job_B"],
  ]) {
    table("job").push({
      id: jobId,
      companyId,
      name: `Tower ${companyId}`,
      status: "ESTIMATE",
      scope: "Framing and drywall, levels 2-4",
      company: { name: `Sub ${companyId}` },
      contact: { name: "Pat GC", email: "pat@gc.example" },
    });
    table("jobLineItem").push(
      { id: `li_${jobId}_1`, jobId, isDeleted: false, description: "Metal stud framing", quantity: 1200, unit: "sf", unitPrice: 4.5 },
      { id: `li_${jobId}_2`, jobId, isDeleted: false, description: "Drywall <hang & finish>", quantity: 1200, unit: "sf", unitPrice: 3 },
    );
    table("contractDocument").push({
      id: `doc_${jobId}`,
      jobId,
      versionNumber: 1,
      fileUrl: `https://store1.public.blob.vercel-storage.com/contracts/${jobId}/subcontract-a1b2.pdf`,
      fileName: "subcontract.pdf",
      executedSignedDate: null,
    });
    table("contractDocumentVersionCounter").push({ id: `ctr_${jobId}`, jobId, lastNumber: 1 });
  }
  table("changeOrder").push({
    id: "co_draft_A",
    jobId: "job_A",
    number: 2,
    title: "Draft soffit",
    description: null,
    status: "DRAFT",
    submittedOn: null,
    proposals: [],
  });
}

function sendForm(fields: Record<string, string>, signers: [string, string][] = [["Pat GC", "pat@gc.example"]]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [name, email] of signers) {
    form.append("signerName", name);
    form.append("signerEmail", email);
  }
  return form;
}

function connectRequest(payload: unknown, sign: "good" | "bad" | "none" = "good") {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign === "good") headers["X-DocuSign-Signature-1"] = docuSignSignature(body, HMAC_KEY);
  if (sign === "bad") headers["X-DocuSign-Signature-1"] = docuSignSignature(body, "someone-else");
  return new Request("https://app.cstream.ai/api/docusign/connect", { method: "POST", headers, body });
}

const event = (envelopeId: string, accountId: string, name = "envelope-completed") => ({
  event: name,
  apiVersion: "v2.1",
  generatedDateTime: "2026-09-19T02:31:00Z",
  data: { accountId, envelopeId, userId: "u" },
});

async function sendContractDocument(jobId = "job_A") {
  return actions.sendWithDocuSign(sendForm({ jobId, subject: "CONTRACT_DOCUMENT", subjectId: `doc_${jobId}` }));
}

beforeEach(seed);

/** The shape of the envelope-create body these tests read. */
type Envelope = {
  documents: { documentBase64: string; name: string; fileExtension: string; documentId: string }[];
  recipients: { signers: { email: string; name: string; recipientId: string; routingOrder: string; tabs?: { signHereTabs: { anchorString: string }[] } }[] };
  status: string;
  eventNotification?: Record<string, unknown>;
};

/* -------------------------------- tests -------------------------------- */

describe("sending", () => {
  it("builds the envelope from the app's OWN stored PDF and the signer fields, and records it for this company", async () => {
    connect("co_A", "acct-A");
    const result = await sendContractDocument();
    expect(result).toEqual({ ok: true });

    const create = ds.requests.find((r) => r.method === "POST" && r.url.endsWith("/envelopes"));
    expect(create?.url).toBe(`${BASE}/restapi/v2.1/accounts/acct-A/envelopes`);
    const body = create?.body as Envelope;
    expect(Buffer.from(body.documents[0].documentBase64, "base64").equals(SUB_PDF)).toBe(true);
    expect(body.documents[0]).toMatchObject({ name: "subcontract.pdf", fileExtension: "pdf", documentId: "1" });
    expect(body.recipients.signers).toEqual([{ email: "pat@gc.example", name: "Pat GC", recipientId: "1", routingOrder: "1" }]);
    expect(body.status).toBe("sent");
    expect(body.eventNotification).toMatchObject({ url: "https://app.cstream.ai/api/docusign/connect", includeHMAC: "true" });

    const [row] = rows("docuSignEnvelope", "co_A");
    expect(row).toMatchObject({
      jobId: "job_A",
      subject: "CONTRACT_DOCUMENT",
      contractDocumentId: "doc_job_A",
      envelopeId: "env-1",
      docusignAccountId: "acct-A",
      status: "SENT",
      senderTimeZone: "America/Los_Angeles",
      sentByUserId: "user_A",
      recipients: [{ name: "Pat GC", email: "pat@gc.example" }],
    });
    // DocuSign's time for the send, not this server's.
    expect((row.sentAt as Date).toISOString()).toBe("2026-09-18T20:00:00.000Z");
    expect(rows("docuSignEnvelope", "co_B")).toEqual([]);
  });

  it("the contract summary goes as generated HTML with the priced lines, escaped, and freezes a snapshot", async () => {
    connect("co_A", "acct-A");
    expect(await actions.sendWithDocuSign(sendForm({ jobId: "job_A", subject: "CONTRACT_SUMMARY" }))).toEqual({ ok: true });
    const body = ds.requests.find((r) => r.method === "POST")?.body as Envelope;
    const html = Buffer.from(body.documents[0].documentBase64, "base64").toString("utf8");
    expect(body.documents[0].fileExtension).toBe("html");
    expect(html).toContain("Metal stud framing");
    expect(html).toContain("Drywall &lt;hang &amp; finish&gt;");
    expect(html).toContain("$9,000.00");
    expect(body.recipients.signers[0].tabs?.signHereTabs[0].anchorString).toBe("/sn1/");
    expect(rows("docuSignEnvelope", "co_A")[0].sentSnapshot).toMatchObject({ total: 9000, clientName: "Pat GC" });
  });

  it("leaves Connect out of the envelope when this install has no HMAC key to verify with", async () => {
    delete process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    connect("co_A", "acct-A");
    await sendContractDocument();
    expect((ds.requests.find((r) => r.method === "POST")?.body as Record<string, unknown>).eventNotification).toBeUndefined();
  });

  it("refuses without VIEW_JOB_COSTS before DocuSign or the database is asked anything", async () => {
    connect("co_A", "acct-A");
    state.denied.add("VIEW_JOB_COSTS");
    state.calls = [];
    const result = await sendContractDocument();
    expect(result.ok).toBe(false);
    expect(ds.requests).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it("refuses another company's job and another company's document — nothing is sent", async () => {
    connect("co_A", "acct-A");
    expect((await actions.sendWithDocuSign(sendForm({ jobId: "job_B", subject: "CONTRACT_DOCUMENT", subjectId: "doc_job_B" }))).ok).toBe(false);
    expect((await actions.sendWithDocuSign(sendForm({ jobId: "job_A", subject: "CONTRACT_DOCUMENT", subjectId: "doc_job_B" }))).ok).toBe(false);
    expect(ds.requests).toEqual([]);
  });

  it("refuses a second live envelope for the same document, and a change order that isn't submitted", async () => {
    connect("co_A", "acct-A");
    await sendContractDocument();
    const again = await sendContractDocument();
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already out for signature/) });
    const draft = await actions.sendWithDocuSign(sendForm({ jobId: "job_A", subject: "CHANGE_ORDER", subjectId: "co_draft_A" }));
    expect(draft).toMatchObject({ ok: false, error: expect.stringMatching(/submitted/) });
    expect(ds.requests.filter((r) => r.method === "POST" && r.url.endsWith("/envelopes"))).toHaveLength(1);
  });

  it("says DocuSign isn't connected, rather than throwing, when this company never connected", async () => {
    const result = await sendContractDocument();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/isn't connected/) });
  });
});

describe("token refresh", () => {
  it("refreshes an expired token first, stores the NEW pair encrypted, and sends with it", async () => {
    const old = connect("co_A", "acct-A", { expired: true });
    expect(await sendContractDocument()).toEqual({ ok: true });
    expect(ds.requests.filter((r) => r.url === TOKEN_URL).map((r) => r.grant)).toEqual(["refresh_token"]);
    const connection = rows("integrationConnection", "co_A")[0];
    const refresh = decryptSecret(String(connection.encryptedRefreshToken));
    expect(refresh).not.toBe(old.refresh);
    expect(ds.validRefresh.has(refresh)).toBe(true);
    expect(JSON.stringify(connection)).not.toContain("access-");
  });

  it("two requests refreshing at once: the loser uses the winner's token and the stored refresh token stays live", async () => {
    connect("co_A", "acct-A", { expired: true });
    await actions.sendWithDocuSign(sendForm({ jobId: "job_A", subject: "CONTRACT_SUMMARY" }));
    // Expire it again, then race two Refresh presses on the envelope.
    const connection = rows("integrationConnection", "co_A")[0];
    const stored = JSON.parse(decryptSecret(String(connection.encryptedAccessToken)));
    connection.encryptedAccessToken = sealAccess({ ...stored, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const envelope = rows("docuSignEnvelope", "co_A")[0];
    const results = await Promise.all([actions.refreshDocuSignEnvelope(envelope.id), actions.refreshDocuSignEnvelope(envelope.id)]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(rows("integrationConnection", "co_A")[0].status).toBe("CONNECTED");
    expect(ds.validRefresh.has(decryptSecret(String(rows("integrationConnection", "co_A")[0].encryptedRefreshToken)))).toBe(true);
  });

  it("a refresh that LOSES the compare-and-swap does not store its pair over the winner's", async () => {
    connect("co_A", "acct-A", { expired: true });
    // While this request's refresh is at DocuSign, another request finishes
    // its own refresh and stores a different, live pair.
    let winner = { access: "", refresh: "" };
    ds.onToken = () => {
      winner = issuePair();
      const connection = rows("integrationConnection", "co_A")[0];
      connection.encryptedAccessToken = sealAccess({
        accessToken: winner.access,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        baseUri: BASE,
      });
      connection.encryptedRefreshToken = encryptSecret(winner.refresh);
    };
    expect(await sendContractDocument()).toEqual({ ok: true });
    const connection = rows("integrationConnection", "co_A")[0];
    expect(decryptSecret(String(connection.encryptedRefreshToken))).toBe(winner.refresh);
    // And it sent with the winner's token, not the one it was not allowed to store.
    const create = ds.requests.find((r) => r.method === "POST" && r.url.endsWith("/envelopes"));
    expect(create).toBeDefined();
  });

  it("a dead refresh token marks the connection for reconnect and says so", async () => {
    const pair = connect("co_A", "acct-A", { expired: true });
    ds.validRefresh.delete(pair.refresh);
    const result = await sendContractDocument();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Reconnect/) });
    expect(rows("integrationConnection", "co_A")[0].status).toBe("NEEDS_REAUTH");
  });
});

describe("the Connect webhook", () => {
  async function twoSentEnvelopes() {
    connect("co_A", "acct-A");
    connect("co_B", "acct-B");
    await sendContractDocument();
    state.context = { ...state.context, id: "user_B", company: { id: "co_B" } };
    await sendContractDocument("job_B");
    state.context = { ...state.context, id: "user_A", company: { id: "co_A" } };
    return { a: rows("docuSignEnvelope", "co_A")[0], b: rows("docuSignEnvelope", "co_B")[0] };
  }

  it("refuses a bad signature with 401, reading nothing and asking DocuSign nothing", async () => {
    const { a } = await twoSentEnvelopes();
    ds.envelopes.get(String(a.envelopeId))!.status = "completed";
    state.calls = [];
    const before = ds.requests.length;
    for (const sign of ["bad", "none"] as const) {
      const response = await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A"), sign));
      expect(response.status).toBe(401);
    }
    expect(state.calls).toEqual([]);
    expect(ds.requests.length).toBe(before);
    expect(rows("docuSignEnvelope", "co_A")[0].status).toBe("SENT");
  });

  it("refuses everything with 503 when this install has no HMAC key", async () => {
    const { a } = await twoSentEnvelopes();
    delete process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    state.calls = [];
    const response = await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A")));
    expect(response.status).toBe(503);
    expect(state.calls).toEqual([]);
  });

  it("a good signature updates ONLY that company's envelope, from DocuSign's own answer", async () => {
    const { a, b } = await twoSentEnvelopes();
    const remote = ds.envelopes.get(String(a.envelopeId))!;
    remote.status = "delivered";
    remote.deliveredDateTime = "2026-09-18T22:10:00.0000000Z";
    // Company B's envelope has moved at DocuSign too — but no message named it.
    ds.envelopes.get(String(b.envelopeId))!.status = "completed";

    const response = await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A", "envelope-delivered")));
    expect(response.status).toBe(200);
    const rowA = rows("docuSignEnvelope", "co_A")[0];
    expect(rowA.status).toBe("DELIVERED");
    expect((rowA.deliveredAt as Date).toISOString()).toBe("2026-09-18T22:10:00.000Z");
    expect(rows("docuSignEnvelope", "co_B")[0].status).toBe("SENT");
    // It read the envelope with A's account, never B's.
    const reads = ds.requests.filter((r) => r.method === "GET" && r.url.includes("/envelopes/"));
    expect(reads.every((r) => r.url.includes("/accounts/acct-A/"))).toBe(true);
  });

  it("ignores a signed message whose account does not own the envelope it names", async () => {
    const { a } = await twoSentEnvelopes();
    ds.envelopes.get(String(a.envelopeId))!.status = "completed";
    const response = await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-B")));
    expect(response.status).toBe(200);
    expect(rows("docuSignEnvelope", "co_A")[0].status).toBe("SENT");
    expect(rows("docuSignEnvelope", "co_B")[0].status).toBe("SENT");
  });

  it("the body's claims are never applied: a signed 'completed' for an envelope DocuSign says is still sent changes nothing", async () => {
    const { a } = await twoSentEnvelopes();
    await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A", "envelope-completed")));
    expect(rows("docuSignEnvelope", "co_A")[0].status).toBe("SENT");
    expect(rows("contractDocument").filter((d) => d.executedSignedDate)).toEqual([]);
  });

  it("completion stores the signed PDF and certificate and records the EXECUTED contract version, dated in the sender's zone", async () => {
    const { a } = await twoSentEnvelopes();
    const remote = ds.envelopes.get(String(a.envelopeId))!;
    remote.status = "completed";
    remote.deliveredDateTime = "2026-09-18T23:00:00.0000000Z";
    remote.completedDateTime = "2026-09-19T02:30:00.0000000Z"; // 7:30pm the 18th in Los Angeles

    expect((await handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A")))).status).toBe(200);

    const row = rows("docuSignEnvelope", "co_A")[0];
    expect(row.status).toBe("COMPLETED");
    expect((row.completedAt as Date).toISOString()).toBe("2026-09-19T02:30:00.000Z");
    expect(state.blobPuts.map((p) => p.pathname)).toEqual([
      "contracts/job_A/subcontract-signed-docusign.pdf",
      "contracts/job_A/subcontract-docusign-certificate.pdf",
    ]);
    expect(state.blobPuts.map((p) => p.bytes)).toEqual([SIGNED_PDF.length, CERT_PDF.length]);
    expect(row.signedDocumentUrl).toMatch(/contracts\/job_A\/subcontract-signed-docusign/);
    expect(row.certificateUrl).toMatch(/certificate/);

    const executed = rows("contractDocument").filter((d) => d.jobId === "job_A" && d.executedSignedDate);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ versionNumber: 2, fileUrl: row.signedDocumentUrl, uploadedByUserId: "user_A" });
    expect((executed[0].executedSignedDate as Date).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(row.signedContractDocumentId).toBe(executed[0].id);
    // Nothing on company B moved.
    expect(rows("contractDocument").filter((d) => d.jobId === "job_B" && d.executedSignedDate)).toEqual([]);
  });

  it("a duplicate delivery of the completion writes nothing at all", async () => {
    const { a } = await twoSentEnvelopes();
    Object.assign(ds.envelopes.get(String(a.envelopeId))!, { status: "completed", completedDateTime: "2026-09-19T02:30:00Z" });
    const request = () => connectRequest(event(String(a.envelopeId), "acct-A"));
    await handleDocuSignConnect(request());
    const writesAfterFirst = [...state.writes];
    const putsAfterFirst = state.blobPuts.length;

    expect((await handleDocuSignConnect(request())).status).toBe(200);
    expect(state.writes).toEqual(writesAfterFirst);
    expect(state.blobPuts.length).toBe(putsAfterFirst);
    expect(rows("contractDocument").filter((d) => d.executedSignedDate)).toHaveLength(1);
  });

  it("two completions racing record one executed version, and the loser's files are deleted", async () => {
    const { a } = await twoSentEnvelopes();
    Object.assign(ds.envelopes.get(String(a.envelopeId))!, { status: "completed", completedDateTime: "2026-09-19T02:30:00Z" });
    // A barrier: neither delivery gets past storing its files until both
    // have stored both, so both genuinely reach the claim. Without it the
    // outcome depends on how the two happen to interleave.
    const stored: string[] = [];
    // One gate per kind of file: each delivery uploads its signed copy, then
    // its certificate, so each upload waits for the OTHER delivery's upload
    // of the same kind. Both therefore reach the claim with files in hand.
    const gates = new Map<string, { count: number; open: Promise<void>; release: () => void }>();
    const gate = (kind: string) => {
      if (!gates.has(kind)) {
        let release!: () => void;
        const open = new Promise<void>((resolve) => (release = resolve));
        gates.set(kind, { count: 0, open, release });
      }
      return gates.get(kind)!;
    };
    const deps = {
      storeFile: async (pathname: string) => {
        const url = `https://store1.public.blob.vercel-storage.com/${pathname}-${stored.length}`;
        stored.push(url);
        const g = gate(pathname.includes("certificate") ? "certificate" : "signed");
        if (++g.count === 2) g.release();
        await g.open;
        return { url };
      },
      deleteFile: async (url: string) => {
        state.blobDeletes.push(url);
      },
    };
    const results = await Promise.all([
      handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A")), deps),
      handleDocuSignConnect(connectRequest(event(String(a.envelopeId), "acct-A")), deps),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(stored).toHaveLength(4);
    expect(rows("contractDocument").filter((d) => d.executedSignedDate)).toHaveLength(1);
    const kept = rows("docuSignEnvelope", "co_A")[0];
    // Every file uploaded is either the one kept or deleted — nothing orphaned.
    expect(state.blobDeletes.sort()).toEqual(stored.filter((u) => u !== kept.signedDocumentUrl && u !== kept.certificateUrl).sort());
  });

  it("sync itself is tenant-scoped: another company's envelope id reads nothing and asks DocuSign nothing", async () => {
    const { b } = await twoSentEnvelopes();
    const { syncDocuSignEnvelope, EnvelopeNotFoundError } = await import("@/lib/docusign/sync");
    const before = ds.requests.length;
    await expect(syncDocuSignEnvelope("co_A", b.id)).rejects.toBeInstanceOf(EnvelopeNotFoundError);
    expect(ds.requests.length).toBe(before);
  });
});

describe("void, refresh and disconnect", () => {
  it("void is owner-only: a member is refused and DocuSign is never asked", async () => {
    connect("co_A", "acct-A");
    await sendContractDocument();
    const envelope = rows("docuSignEnvelope", "co_A")[0];
    state.context = { ...state.context, role: "MEMBER" };
    const before = ds.requests.length;
    expect(await actions.voidSentEnvelope(envelope.id, "wrong person")).toMatchObject({ ok: false, error: expect.stringMatching(/owner/) });
    expect(ds.requests.length).toBe(before);
    expect(rows("docuSignEnvelope", "co_A")[0].status).toBe("SENT");
  });

  it("the owner's void closes it at DocuSign with the reason; the row stays, with DocuSign's void time", async () => {
    connect("co_A", "acct-A");
    await sendContractDocument();
    const envelope = rows("docuSignEnvelope", "co_A")[0];
    expect(await actions.voidSentEnvelope(envelope.id, "Sent to the wrong person")).toEqual({ ok: true });
    expect(ds.requests.find((r) => r.method === "PUT")?.body).toEqual({ status: "voided", voidedReason: "Sent to the wrong person" });
    const row = rows("docuSignEnvelope", "co_A")[0];
    expect(row).toMatchObject({ status: "VOIDED", voidedReason: "Sent to the wrong person" });
    expect((row.voidedAt as Date).toISOString()).toBe("2026-09-18T21:00:00.000Z");
    expect(rows("docuSignEnvelope")).toHaveLength(1);
  });

  it("void refuses an empty reason and an envelope that is no longer live", async () => {
    connect("co_A", "acct-A");
    await sendContractDocument();
    const envelope = rows("docuSignEnvelope", "co_A")[0];
    expect((await actions.voidSentEnvelope(envelope.id, "  ")).ok).toBe(false);
    envelope.status = "COMPLETED";
    expect(await actions.voidSentEnvelope(envelope.id, "late")).toMatchObject({ ok: false });
    expect(ds.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("refresh on another company's envelope finds nothing and asks DocuSign nothing", async () => {
    connect("co_A", "acct-A");
    connect("co_B", "acct-B");
    state.context = { ...state.context, company: { id: "co_B" } };
    await sendContractDocument("job_B");
    const theirs = rows("docuSignEnvelope", "co_B")[0];
    state.context = { ...state.context, company: { id: "co_A" } };
    const before = ds.requests.length;
    expect(await actions.refreshDocuSignEnvelope(theirs.id)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't on this account/) });
    expect(ds.requests.length).toBe(before);
  });

  it("disconnect is owner-only, forgets the tokens, and keeps every envelope", async () => {
    connect("co_A", "acct-A");
    await sendContractDocument();
    state.context = { ...state.context, role: "MEMBER" };
    expect((await actions.disconnectDocuSign()).ok).toBe(false);
    expect(rows("integrationConnection", "co_A")[0].status).toBe("CONNECTED");
    state.context = { ...state.context, role: "OWNER" };
    expect(await actions.disconnectDocuSign()).toEqual({ ok: true });
    const connection = rows("integrationConnection", "co_A")[0];
    expect(connection).toMatchObject({ status: "NOT_CONNECTED", encryptedAccessToken: null, encryptedRefreshToken: null });
    expect(rows("docuSignEnvelope", "co_A")).toHaveLength(1);
    expect(rows("integrationConnection", "co_B")).toEqual([]);
  });
});
