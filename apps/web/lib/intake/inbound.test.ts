import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Forward-an-email intake — the receiving endpoint's guards and the core
 * processor's routing, with every HTTP dependency injected.
 *
 * THE SHAPE OF EVERY TEST: build a real Request with a real svix-style
 * signature (lib/resend-webhook.ts signs and verifies with the same maths),
 * hand the adapter fake attachment transport and a fake db, and assert on
 * what was WRITTEN, not on what the handler claims. The response bodies for
 * "recorded" and "unknown token" are compared byte-for-byte because their
 * identity IS the no-oracle property.
 */

vi.mock("@prova/db", () => ({ prisma: {}, Prisma: {} }));

import { signResendPayload } from "@/lib/resend-webhook";
import {
  ensureIntakeEmailToken,
  intakeEmailAddress,
  intakeTokenFromAddress,
  intakeTokenFromRecipients,
  newIntakeEmailToken,
  processInboundEmail,
  type InboundAttachmentSource,
} from "@/lib/intake/inbound";
import { handleResendInbound, type ResendInboundDeps } from "@/lib/intake/resend-inbound";

const SECRET = `whsec_${Buffer.from("test-signing-key-32-bytes-long!!").toString("base64")}`;
const DOMAIN = "in.cstream.ai";
const TOKEN = "a".repeat(32);
const COMPANY = "company-1";

/* ------------------------------- fakes -------------------------------- */

/** A db whose writes are inspectable and whose company lookup honours ONLY
 * the token — the same contract the schema's unique column gives Prisma. */
function fakeDb(tokens: Record<string, string> = { [TOKEN]: COMPANY }) {
  const created: Record<string, unknown>[] = [];
  const store = { tokens: { ...tokens } };
  return {
    created,
    store,
    company: {
      findUnique: vi.fn(async (args: { where: { intakeEmailToken?: string; id?: string } }) => {
        const token = args.where.intakeEmailToken;
        if (token !== undefined) {
          const companyId = store.tokens[token];
          return companyId ? { id: companyId } : null;
        }
        return null;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    documentIntake: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: `row-${created.length}` };
      }),
    },
    job: {
      findMany: vi.fn(async () => []),
    },
  };
}

function fakeBlob() {
  const puts: { pathname: string; bytes: Uint8Array; contentType: string }[] = [];
  return {
    puts,
    putBlob: vi.fn(async (pathname: string, bytes: Uint8Array, contentType: string) => {
      puts.push({ pathname, bytes, contentType });
      return { url: `https://teststore.public.blob.vercel-storage.com/${pathname}-suffix123` };
    }),
  };
}

function pdfAttachment(id: string, filename: string): Record<string, unknown> {
  return { id, filename, content_type: "application/pdf", content_disposition: "attachment", content_id: "" };
}

function payloadFor(overrides: Record<string, unknown> = {}, attachments?: Record<string, unknown>[]) {
  return JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: "email-1",
      from: "pm@acmegc.example",
      to: [intakeEmailAddress(TOKEN, DOMAIN)],
      cc: [],
      received_for: [intakeEmailAddress(TOKEN, DOMAIN)],
      subject: "FW: Riverside COI",
      attachments: attachments ?? [pdfAttachment("att-1", "Riverside COI.pdf"), pdfAttachment("att-2", "Executed contract.pdf")],
      ...overrides,
    },
  });
}

function signedRequest(body: string, opts: { secret?: string; sign?: boolean; timestamp?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const id = "msg_test_1";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sign !== false) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = timestamp;
    headers["svix-signature"] = signResendPayload(opts.secret ?? SECRET, id, timestamp, body);
  }
  return new Request("https://app.example/api/intake/inbound/resend", { method: "POST", headers, body });
}

function depsFor(db = fakeDb(), blob = fakeBlob(), sizes: Record<string, number> = {}): ResendInboundDeps & {
  db: ReturnType<typeof fakeDb>;
  blob: ReturnType<typeof fakeBlob>;
} {
  return {
    db: db as never,
    blob,
    putBlob: blob.putBlob,
    env: {
      RESEND_INBOUND_WEBHOOK_SECRET: SECRET,
      INTAKE_INBOUND_DOMAIN: DOMAIN,
    } as unknown as NodeJS.ProcessEnv,
    fetchAttachmentMeta: vi.fn(async (_emailId: string, attachmentId: string) => ({
      downloadUrl: `https://cdn.example/${attachmentId}`,
      size: sizes[attachmentId] ?? 1024,
    })),
    downloadAttachment: vi.fn(async (url: string) => {
      const id = url.split("/").pop() ?? "";
      const declared = sizes[id] ?? 1024;
      // Bytes matching the declared size unless the declared size is the
      // oversize sentinel (then the meta check should have refused first).
      return new Uint8Array(Math.min(declared, 4096)).fill(65);
    }),
  } as never;
}

/* --------------------------- address parsing --------------------------- */

describe("intake address parsing", () => {
  it("extracts the token from a bare address and from a display-name form", () => {
    expect(intakeTokenFromAddress(`docs-${TOKEN}@${DOMAIN}`, DOMAIN)).toBe(TOKEN);
    expect(intakeTokenFromAddress(`Intake <docs-${TOKEN}@${DOMAIN}>`, DOMAIN)).toBe(TOKEN);
    expect(intakeTokenFromAddress(`DOCS-${TOKEN}@${DOMAIN.toUpperCase()}`, DOMAIN)).toBe(TOKEN);
  });

  it("refuses the wrong domain, the wrong prefix, and a malformed token", () => {
    expect(intakeTokenFromAddress(`docs-${TOKEN}@evil.example`, DOMAIN)).toBeNull();
    expect(intakeTokenFromAddress(`files-${TOKEN}@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(intakeTokenFromAddress(`docs-nope@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(intakeTokenFromAddress(`docs-${TOKEN}@${DOMAIN}.evil.example`, DOMAIN)).toBeNull();
  });

  it("takes the first matching recipient in the order given (envelope first)", () => {
    const other = "b".repeat(32);
    expect(
      intakeTokenFromRecipients(
        [`docs-${other}@${DOMAIN}`, `docs-${TOKEN}@${DOMAIN}`],
        DOMAIN,
      ),
    ).toBe(other);
  });

  it("issues 32-hex tokens", () => {
    const token = newIntakeEmailToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(newIntakeEmailToken()).not.toBe(token);
  });
});

/* ----------------------------- the adapter ----------------------------- */

describe("handleResendInbound — refusals before anything is read", () => {
  it("503 when no webhook secret is configured", async () => {
    const deps = depsFor();
    (deps.env as Record<string, string>).RESEND_INBOUND_WEBHOOK_SECRET = "";
    const response = await handleResendInbound(signedRequest(payloadFor()), deps);
    expect(response.status).toBe(503);
    expect(deps.db.documentIntake.create).not.toHaveBeenCalled();
  });

  it("401 when the svix headers are absent", async () => {
    const deps = depsFor();
    const response = await handleResendInbound(signedRequest(payloadFor(), { sign: false }), deps);
    expect(response.status).toBe(401);
    expect(deps.db.documentIntake.create).not.toHaveBeenCalled();
  });

  it("401 on a bad signature", async () => {
    const deps = depsFor();
    const wrongSecret = `whsec_${Buffer.from("a-completely-different-key-here!").toString("base64")}`;
    const response = await handleResendInbound(signedRequest(payloadFor(), { secret: wrongSecret }), deps);
    expect(response.status).toBe(401);
    expect(deps.db.documentIntake.create).not.toHaveBeenCalled();
  });

  it("401 on a stale timestamp even with a valid signature", async () => {
    const deps = depsFor();
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const response = await handleResendInbound(signedRequest(payloadFor(), { timestamp: stale }), deps);
    expect(response.status).toBe(401);
    expect(deps.db.documentIntake.create).not.toHaveBeenCalled();
  });
});

describe("handleResendInbound — a valid email", () => {
  it("records one row per attachment, in the token's company, with provenance", async () => {
    const deps = depsFor();
    const response = await handleResendInbound(signedRequest(payloadFor()), deps);
    expect(response.status).toBe(200);

    expect(deps.db.created).toHaveLength(2);
    for (const row of deps.db.created) {
      expect(row.companyId).toBe(COMPANY);
      expect(row.emailFrom).toBe("pm@acmegc.example");
      expect(row.emailSubject).toBe("FW: Riverside COI");
      expect(row.emailMessageId).toBe("email-1");
      expect(row.uploadedByUserId).toBeNull();
      expect(String(row.blobUrl)).toContain(`document-intake/${COMPANY}/`);
    }
    expect(deps.db.created.map((row) => row.fileName)).toEqual(["Riverside COI.pdf", "Executed contract.pdf"]);

    // The bytes landed under THIS company's prefix — the same boundary the
    // drag-and-drop path enforces.
    expect(deps.blob.puts).toHaveLength(2);
    for (const put of deps.blob.puts) {
      expect(put.pathname.startsWith(`document-intake/${COMPANY}/`)).toBe(true);
    }
  });

  it("resolves the company from the recipient token ONLY — payload ids do not steer the write", async () => {
    const deps = depsFor();
    // A hostile payload claiming to be about some other company everywhere
    // a payload can claim it. None of these fields is read for routing.
    const body = payloadFor({
      from: "owner@other-company.example",
      companyId: "company-2",
      accountId: "company-2",
      subject: "please file to company-2",
    });
    const response = await handleResendInbound(signedRequest(body), deps);
    expect(response.status).toBe(200);

    expect(deps.db.company.findUnique).toHaveBeenCalledWith({
      where: { intakeEmailToken: TOKEN },
      select: { id: true },
    });
    expect(deps.db.created).toHaveLength(2);
    for (const row of deps.db.created) expect(row.companyId).toBe(COMPANY);
  });

  it("drops an unknown token with a 200 whose body is byte-identical to success", async () => {
    const known = depsFor();
    const success = await handleResendInbound(signedRequest(payloadFor()), known);

    const unknown = depsFor(fakeDb({}));
    const body = payloadFor({
      to: [`docs-${"c".repeat(32)}@${DOMAIN}`],
      received_for: [`docs-${"c".repeat(32)}@${DOMAIN}`],
    });
    const dropped = await handleResendInbound(signedRequest(body), unknown);

    expect(dropped.status).toBe(200);
    expect(await dropped.text()).toBe(await success.text());
    expect(unknown.db.documentIntake.create).not.toHaveBeenCalled();
    expect(unknown.putBlob).not.toHaveBeenCalled();
  });

  it("writes nothing on a replay of an email already recorded", async () => {
    const db = fakeDb();
    db.documentIntake.findFirst.mockResolvedValue({ id: "row-existing" } as never);
    const deps = depsFor(db);
    const response = await handleResendInbound(signedRequest(payloadFor()), deps);
    expect(response.status).toBe(200);
    expect(db.documentIntake.create).not.toHaveBeenCalled();
  });

  it("ignores an event that is not email.received", async () => {
    const deps = depsFor();
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email-1" } });
    const response = await handleResendInbound(signedRequest(body), deps);
    expect(response.status).toBe(200);
    expect(deps.db.documentIntake.create).not.toHaveBeenCalled();
  });
});

describe("handleResendInbound — attachment refusals", () => {
  it("refuses an oversized attachment on its declared size and still records the rest", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = depsFor(fakeDb(), fakeBlob(), { "att-1": 26 * 1024 * 1024 });
      const response = await handleResendInbound(signedRequest(payloadFor()), deps);
      expect(response.status).toBe(200);
      expect(deps.db.created).toHaveLength(1);
      expect(deps.db.created[0].fileName).toBe("Executed contract.pdf");
      // The refusal reached the operator's log, named.
      expect(errors.mock.calls.flat().join(" ")).toContain("Riverside COI.pdf");
    } finally {
      errors.mockRestore();
    }
  });

  it("refuses a type intake does not accept", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = depsFor();
      const body = payloadFor({}, [
        { id: "att-1", filename: "malware.zip", content_type: "application/zip", content_disposition: "attachment", content_id: "" },
        pdfAttachment("att-2", "Executed contract.pdf"),
      ]);
      const response = await handleResendInbound(signedRequest(body), deps);
      expect(response.status).toBe(200);
      expect(deps.db.created).toHaveLength(1);
      expect(deps.db.created[0].fileName).toBe("Executed contract.pdf");
      expect(errors.mock.calls.flat().join(" ")).toContain("malware.zip");
    } finally {
      errors.mockRestore();
    }
  });

  it("skips cid-inline images without treating them as refusals", async () => {
    const deps = depsFor();
    const body = payloadFor({}, [
      { id: "att-1", filename: "logo.png", content_type: "image/png", content_disposition: "inline", content_id: "cid:logo" },
      pdfAttachment("att-2", "Executed contract.pdf"),
    ]);
    const response = await handleResendInbound(signedRequest(body), deps);
    expect(response.status).toBe(200);
    expect(deps.db.created).toHaveLength(1);
    expect(deps.db.created[0].fileName).toBe("Executed contract.pdf");
  });
});

/* -------------------- regeneration invalidates a token ------------------ */

describe("token regeneration", () => {
  it("an email to the OLD address stops routing the moment the store holds a new token", async () => {
    const db = fakeDb();
    const blob = fakeBlob();
    const attachment: InboundAttachmentSource = {
      filename: "COI.pdf",
      contentType: "application/pdf",
      inline: false,
      size: async () => 1024,
      content: async () => new Uint8Array(1024).fill(65),
    };
    const email = (token: string) => ({
      messageId: "email-2",
      from: "pm@acmegc.example",
      subject: "FW: COI",
      recipients: [intakeEmailAddress(token, DOMAIN)],
      attachments: [attachment],
    });

    const before = await processInboundEmail(email(TOKEN), DOMAIN, { db: db as never, putBlob: blob.putBlob });
    expect(before.outcome).toBe("recorded");
    expect(before.companyId).toBe(COMPANY);

    // The regenerate action's write: the single column is replaced.
    const fresh = newIntakeEmailToken();
    delete db.store.tokens[TOKEN];
    db.store.tokens[fresh] = COMPANY;

    const stale = await processInboundEmail({ ...email(TOKEN), messageId: "email-3" }, DOMAIN, {
      db: db as never,
      putBlob: blob.putBlob,
    });
    expect(stale.outcome).toBe("no_company");

    const renewed = await processInboundEmail({ ...email(fresh), messageId: "email-4" }, DOMAIN, {
      db: db as never,
      putBlob: blob.putBlob,
    });
    expect(renewed.outcome).toBe("recorded");
  });
});

/* ------------------------------ lazy token ------------------------------ */

describe("ensureIntakeEmailToken", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the existing token without writing", async () => {
    const db = {
      company: {
        findUnique: vi.fn(async () => ({ intakeEmailToken: TOKEN })),
        updateMany: vi.fn(),
      },
    };
    expect(await ensureIntakeEmailToken(COMPANY, db as never)).toBe(TOKEN);
    expect(db.company.updateMany).not.toHaveBeenCalled();
  });

  it("mints one, guarded on null, when the company has none", async () => {
    let stored: string | null = null;
    const db = {
      company: {
        findUnique: vi.fn(async () => ({ intakeEmailToken: stored })),
        updateMany: vi.fn(async (args: { where: unknown; data: { intakeEmailToken: string } }) => {
          expect(args.where).toEqual({ id: COMPANY, intakeEmailToken: null });
          stored = args.data.intakeEmailToken;
          return { count: 1 };
        }),
      },
    };
    const token = await ensureIntakeEmailToken(COMPANY, db as never);
    expect(token).toBe(stored);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});
