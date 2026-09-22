import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE COMPLIANCE UPLOAD, THROUGH THE SAME ALLOWANCE THE ASK BOX SPENDS.
 *
 * The deliberate mirror of `lib/ask/allowanceStream.test.ts`, which proves
 * the same property for `streamAnswer`, and it is written the same way for
 * the same reason: what is at stake is ORDER. `uploadComplianceDocument`
 * sends a whole document to the model — the most expensive single call in
 * this app, $2.25-$4.50 by this repo's own audit — and until 2026-09-22 it
 * was neither page-counted nor bound by anything at all. Metering that
 * AFTER the call is the shape of every money bug in this area: the spend
 * happens and then the accounting is attempted.
 *
 * So the assertion that matters most here is not "the cap refused". It is
 * that the claim was made BEFORE `extractComplianceDocument` was called,
 * and that a refused claim means the extractor never ran. Everything
 * interesting is recorded into ONE ordered list rather than asserted per
 * mock, because "both happened" is exactly the weaker claim that would have
 * passed against the old code.
 *
 * The page counter is NOT mocked. The PDFs below are real enough for
 * `pdfPageCount` to walk, so the number claimed is a number this app
 * derived from bytes rather than one a test handed it — which is the whole
 * difference between charging a document and charging a click.
 */

/** Every interesting thing that happened, in the order it happened. */
let order: string[] = [];
/** What the extractor was handed, or null if it was never reached. */
let extracted: { mediaType: string; fileName: string } | null = null;

type Claimed =
  | {
      ok: true;
      claim: { companyId: string; periodStart: Date; questions: number; pages: number };
      left: { questions: number; pages: number };
    }
  | { ok: false; error: string };

const PERIOD = new Date("2026-09-01T00:00:00.000Z");

/** Typed parameters on purpose: the assertions below read
 * `mock.calls[0][1]` — WHAT was claimed — and an untyped `vi.fn` gives that
 * an empty tuple, so the interesting half of this file would not compile. */
const claimAskAllowance = vi.fn(
  async (
    _companyId: string,
    _want: { questions: number; pages: number },
    _now?: Date,
  ): Promise<Claimed> => {
    order.push("claim");
    return {
      ok: true,
      claim: { companyId: "co1", periodStart: PERIOD, questions: 1, pages: 0 },
      left: { questions: 299, pages: 277 },
    };
  },
);
const markAskAllowanceFailure = vi.fn(async () => {
  order.push("mark");
});
const allowanceForCompany = vi.fn(async () => ({ questions: 300, pages: 300 }));

vi.mock("@/lib/ask/allowance", () => ({
  claimAskAllowance: (...args: unknown[]) =>
    claimAskAllowance(...(args as Parameters<typeof claimAskAllowance>)),
  markAskAllowanceFailure: (...args: unknown[]) => markAskAllowanceFailure(...(args as [])),
  allowanceForCompany: (...args: unknown[]) => allowanceForCompany(...(args as [])),
}));

/** What the extractor returns when it is reached at all. Swapped per test. */
let extraction: () => Promise<Record<string, unknown>> = async () => ({
  type: "CERTIFICATE_OF_INSURANCE",
  partyName: "Acme Insurance",
  amount: null,
  periodStart: null,
  periodEnd: null,
  effectiveDate: null,
  expiresAt: null,
  notes: null,
});

vi.mock("@prova/integrations", () => ({
  ASK_DEFAULT_MODEL: "test-model",
  extractComplianceDocument: (options: { mediaType: string; fileName: string }) => {
    order.push("model");
    extracted = { mediaType: options.mediaType, fileName: options.fileName };
    return extraction();
  },
}));

vi.mock("@/lib/ask/usage", () => ({
  recordAskUsage: vi.fn(async () => {}),
  MIGRATE_COMMAND: "pnpm --filter @prova/db run migrate:deploy",
}));

const created: unknown[] = [];
vi.mock("@prova/db", () => ({
  prisma: {
    job: { findUnique: async () => null },
    complianceDocument: {
      create: async (args: unknown) => {
        order.push("row");
        created.push(args);
        return {};
      },
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const context = {
  id: "u1",
  companyId: "co1",
  company: { id: "co1" },
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));

const STORE = "abc123";
const ENV_TOKEN = `vercel_blob_rw_${STORE}_secret`;
const OURS = `https://${STORE}.public.blob.vercel-storage.com`;

/** A real PDF with a countable page tree — the same builder the Ask-side
 * test uses, so both surfaces are measured against the same file shape. */
function pdfOf(pages: number): Buffer {
  return Buffer.from(
    ["%PDF-1.4", `2 0 obj << /Type /Pages /Count ${pages} >> endobj`]
      .concat(Array.from({ length: pages }, () => "<< /Type /Page /MediaBox [0 0 612 792] >>"))
      .join("\n"),
    "latin1",
  );
}

/** The store, serving back the document the browser already uploaded. */
function serveFromStore(bytes: Buffer, contentType = "application/pdf") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    order.push("fetch");
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": contentType },
    });
  });
}

function form(name = "COI.pdf") {
  const fd = new FormData();
  fd.set("fileUrl", `${OURS}/compliance/co1/${name.replace(/\.pdf$/, "")}-r4nd0m1.pdf`);
  fd.set("fileName", name);
  return fd;
}

async function upload(fd = form()) {
  const { uploadComplianceDocument } = await import("./compliance");
  return uploadComplianceDocument(fd);
}

beforeEach(() => {
  order = [];
  extracted = null;
  created.length = 0;
  context.role = "OWNER";
  context.jobFunction = null;
  claimAskAllowance.mockClear();
  markAskAllowanceFailure.mockClear();
  allowanceForCompany.mockClear();
  allowanceForCompany.mockImplementation(async () => ({ questions: 300, pages: 300 }));
  extraction = async () => ({
    type: "CERTIFICATE_OF_INSURANCE",
    partyName: "Acme Insurance",
    amount: null,
    periodStart: null,
    periodEnd: null,
    effectiveDate: null,
    expiresAt: null,
    notes: null,
  });
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", ENV_TOKEN);
  vi.restoreAllMocks();
});

describe("the pages are claimed before the document is sent", () => {
  it("counts the document, claims, and only then calls the model", async () => {
    serveFromStore(pdfOf(23));

    const result = await upload();

    // The whole change, in one assertion. `["fetch", "model", "claim"]` is
    // what unbounded spending looks like; anything that meters after the
    // answer cannot bound a paid cap.
    expect(order).toEqual(["fetch", "claim", "model", "row"]);
    // 23, not 1. A flat one-per-document is the defect the page unit exists
    // for: a 23-page certified payroll run is tens of times the cost of a
    // question and would otherwise be charged the same as "what time is
    // it".
    expect(claimAskAllowance.mock.calls[0][1]).toEqual({ questions: 1, pages: 23 });
    expect(claimAskAllowance.mock.calls[0][0]).toBe("co1");
    // And the document still reached the model — the charge is not instead
    // of the extraction.
    expect(extracted).toEqual({ mediaType: "application/pdf", fileName: "COI.pdf" });
    expect(result).toEqual({ ok: true, value: { note: "23 pages", pagesLeft: 277 } });
  });

  it("charges a photograph of a piece of paper one page", async () => {
    serveFromStore(Buffer.alloc(900_000), "image/jpeg");
    await upload();
    expect(claimAskAllowance.mock.calls[0][1]).toEqual({ questions: 1, pages: 1 });
  });

  it("charges an unreadable PDF the flat rate and SAYS SO on screen", async () => {
    // A PDF with no page objects anywhere a plain scan or an inflate can
    // find them — encrypted, damaged, or a filter this cannot read.
    serveFromStore(Buffer.from("%PDF-1.7\n1 0 obj << /Nothing /Useful >> endobj", "latin1"));

    const result = await upload();

    expect(claimAskAllowance.mock.calls[0][1]).toEqual({ questions: 1, pages: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the upload to succeed");
    // pageCount.ts's header promises the person is TOLD it was charged ten
    // and why. Nothing told them until this path rendered it.
    expect(result.value.note).toContain("couldn't be read");
    expect(result.value.note).toContain("10 pages");
  });
});

describe("a refusal takes nothing", () => {
  it("never calls the model when the claim is refused, and writes no row", async () => {
    serveFromStore(pdfOf(5));
    claimAskAllowance.mockImplementationOnce(async () => {
      order.push("claim");
      return {
        ok: false,
        error:
          "That wasn't sent — this file needs 5 document pages and only 2 of this month's 300 are left. " +
          "Nothing extra has been charged and nothing will be: the allowance starts again on 1 October.",
      };
    });

    const result = await upload();

    expect(order).toEqual(["fetch", "claim"]);
    expect(extracted, "nothing may reach the model after a refused claim").toBeNull();
    expect(created).toEqual([]);
    // A RETURNED sentence, never a throw: production redacts a thrown
    // Server Action message to a digest, and a paying customer hitting the
    // stop would get a dead button instead of what to do about it.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("Nothing extra has been charged");
  });

  it("refuses a document over the single-upload ceiling and claims nothing at all", async () => {
    serveFromStore(pdfOf(101));

    const result = await upload();

    // Not even a claim attempt: one absurd file must not be able to spend a
    // third of the month before something notices its size.
    expect(order).toEqual(["fetch"]);
    expect(claimAskAllowance).not.toHaveBeenCalled();
    expect(extracted).toBeNull();
    expect(created).toEqual([]);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("101 pages");
    expect(result.error).toContain("at most 100");
    expect(result.error).toContain("Nothing has been charged");
  });

  it("lets a document at exactly the ceiling through", async () => {
    // The control. Without it the case above is satisfied by a ceiling that
    // refuses everything.
    serveFromStore(pdfOf(100));
    await upload();
    expect(claimAskAllowance.mock.calls[0][1]).toEqual({ questions: 1, pages: 100 });
  });
});

describe("the cap fails CLOSED when it cannot check itself", () => {
  it("refuses the upload when the allowance cannot be read at all", async () => {
    serveFromStore(pdfOf(3));
    allowanceForCompany.mockImplementationOnce(async () => {
      throw new Error("the ledger is one migration behind");
    });

    const result = await upload();

    // The opposite of `askAllowance` in lib/ask/usage.ts, deliberately.
    // That is a courtesy limit and lets a question through when it cannot
    // read itself, because the worst case is our own bill. This spends a
    // ceiling somebody has PAID for, so an unreadable check refuses.
    expect(extracted, "an unreadable cap must not spend").toBeNull();
    expect(created).toEqual([]);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("Nothing has been charged");
  });
});

describe("who may spend the company's allowance here", () => {
  it("refuses a member without MANAGE_COMPLIANCE before anything is read", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    serveFromStore(pdfOf(3));

    const result = await upload();

    // Not one thing happened: no fetch of the blob, no count, no claim, no
    // model call. A foreman's phone left on a bench cannot spend $4.50 a
    // tap.
    expect(order).toEqual([]);
    expect(claimAskAllowance).not.toHaveBeenCalled();
    expect(extracted).toBeNull();
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("part of your job function");
  });

  it("still admits the people whose job this is", async () => {
    // The control, and it is the half that matters for not breaking the
    // product: PAYROLL_COMPLIANCE is who /compliance was always for.
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";
    serveFromStore(pdfOf(4));

    const result = await upload();

    expect(result.ok).toBe(true);
    expect(claimAskAllowance.mock.calls[0][1]).toEqual({ questions: 1, pages: 4 });
  });
});

describe("a call that fails after its pages were claimed", () => {
  it("MARKS the claim — it is not handed back", async () => {
    serveFromStore(pdfOf(7));
    extraction = async () => {
      throw new Error("the model call died halfway");
    };

    const result = await upload();

    expect(order).toEqual(["fetch", "claim", "model", "mark"]);
    expect(markAskAllowanceFailure).toHaveBeenCalledWith({
      companyId: "co1",
      periodStart: PERIOD,
      questions: 1,
      pages: 0,
    });
    // Nothing is stored for a document that was never read, and the person
    // is told where the pages went rather than handed a digest.
    expect(created).toEqual([]);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("failed read");
  });

  it("does NOT mark an upload that worked", async () => {
    serveFromStore(pdfOf(2));
    await upload();
    expect(markAskAllowanceFailure).not.toHaveBeenCalled();
  });
});
