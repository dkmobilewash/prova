import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE TOKEN IS THE ENFORCEMENT NOW, so this is what this file tests.
 *
 * It used to drive the four `File`-carrying upload actions with
 * `@vercel/blob`'s `put` faked and assert on the options each handed to
 * it — specifically `addRandomSuffix: true`, because the SDK defaults it
 * to FALSE (`dist/index.d.ts:459`) and every document therefore sat at a
 * URL derivable from an id plus a filename. Certified payroll, lien
 * waivers, COIs and W-9s were readable by anyone who guessed one.
 *
 * Those actions no longer touch a file (#27): a Server Action body is
 * capped at 1MB by Next, multipart file parts included, so the upload they
 * performed could never have carried a real contract PDF in the first
 * place. The browser uploads directly and `/api/documents/upload` decides
 * the terms — which means every claim the old file made is now a claim
 * about the TOKEN that route mints, and so is every claim that could not
 * be made before: which pathname, which content type, which ceiling.
 *
 * NOTHING IS FAKED EXCEPT THE SESSION AND THE DATABASE. `handleUpload`
 * here is the real one; it signs locally from `BLOB_READ_WRITE_TOKEN` and
 * makes no network call for this event type (dist/client.js:240-285). So
 * these cases decode the token the route actually returns and read the
 * terms out of it, rather than reading back an object a fake collected —
 * what is asserted is what the store will be shown.
 */

const OUR_STORE = "teststore1";
process.env.BLOB_READ_WRITE_TOKEN = `vercel_blob_rw_${OUR_STORE}_s3cr3t`;

const COMPANY_ID = "cmp_alpha";
const OTHER_COMPANY_ID = "cmp_beta";
const JOB_ID = "job_alpha";
const OTHER_JOB_ID = "job_beta";

const principal = {
  id: "usr_1",
  companyId: COMPANY_ID,
  company: { id: COMPANY_ID },
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => principal }));

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === JOB_ID) return { id: JOB_ID, companyId: COMPANY_ID };
        if (where.id === OTHER_JOB_ID) return { id: OTHER_JOB_ID, companyId: OTHER_COMPANY_ID };
        return null;
      },
    },
  },
}));

const { POST } = await import("../app/api/documents/upload/route");

type TokenRequest = {
  purpose?: string;
  ownerId?: string;
  contentType?: string;
  pathname: string;
  clientPayload?: string;
};

function post({ pathname, clientPayload, purpose, ownerId, contentType }: TokenRequest) {
  const payload =
    clientPayload ?? JSON.stringify({ purpose, ownerId, contentType: contentType ?? "application/pdf" });
  return POST(
    new Request("https://app.test/api/documents/upload", {
      method: "POST",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname, callbackUrl: "https://app.test/api/documents/upload", clientPayload: payload, multipart: false },
      }),
    }),
  );
}

/** The terms the STORE will enforce, read out of the token the route
 * returned — `vercel_blob_client_<storeId>_<base64("<sig>.<base64 json>")>`
 * (dist/client.js:491-493). Decoding it is the only way to assert on what
 * was actually signed rather than on what we hoped was. */
function signedTerms(clientToken: string) {
  const encoded = clientToken.slice(`vercel_blob_client_${OUR_STORE}_`.length);
  const [, payload] = Buffer.from(encoded, "base64").toString("utf8").split(".");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
    pathname: string;
    allowedContentTypes?: string[];
    maximumSizeInBytes?: number;
    addRandomSuffix?: boolean;
  };
}

beforeEach(() => {
  principal.role = "OWNER";
  principal.jobFunction = null;
});

describe("the terms a document upload token carries", () => {
  it("signs the requested pathname, one content type, the 15MB ceiling and a random suffix", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/subcontract.pdf`,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { clientToken: string };
    const terms = signedTerms(body.clientToken);

    expect(terms.pathname).toBe(`contracts/${JOB_ID}/subcontract.pdf`);
    // The property the deleted `putDocument` wrapper existed to guarantee,
    // now guaranteed here instead: without it the URL of a lien waiver is
    // derivable from a job id and a filename, permanently and publicly.
    expect(terms.addRandomSuffix, "an unguessable URL is the only privacy these blobs have").toBe(
      true,
    );
    // 15MB. The number five actions declared and none could enforce.
    expect(terms.maximumSizeInBytes).toBe(15 * 1024 * 1024);
    // ONE type, not the allowlist: a token minted for the whole list lets
    // a caller send anything on it under the terms of anything else.
    expect(terms.allowedContentTypes).toEqual(["application/pdf"]);
  });

  it("signs the type the client declared, not a fixed one", async () => {
    const response = await post({
      purpose: "dispatch-slip",
      ownerId: JOB_ID,
      contentType: "image/jpeg",
      pathname: `dispatch-slips/${JOB_ID}/slip.jpg`,
    });

    const body = (await response.json()) as { clientToken: string };
    expect(signedTerms(body.clientToken).allowedContentTypes).toEqual(["image/jpeg"]);
  });
});

describe("the pathname check, which is the whole of the tenancy", () => {
  // One store serves every tenant, so the folder is the only thing that
  // says whose file a blob is. These are the cases that would hand a
  // caller a signed token for somebody else's folder.
  it("refuses a pathname under a DIFFERENT job than the one claimed", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      pathname: `contracts/${OTHER_JOB_ID}/subcontract.pdf`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "That upload path does not belong to this record",
    });
  });

  it("refuses a pathname under the right job but the WRONG FOLDER", async () => {
    // A dispatch-slip token must not be usable to write into the job's
    // contracts folder, where a later contract-document record could pick
    // the file up.
    const response = await post({
      purpose: "dispatch-slip",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/slip.pdf`,
    });

    expect(response.status).toBe(400);
  });

  it("refuses a second path segment, so nothing can climb out of the folder", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/nested/subcontract.pdf`,
    });

    expect(response.status).toBe(400);
  });

  it("refuses a percent-encoded separator, which URL parsing does not normalise", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/%2e%2e%2fescape.pdf`,
    });

    expect(response.status).toBe(400);
  });

  it("refuses a job that belongs to another company", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: OTHER_JOB_ID,
      pathname: `contracts/${OTHER_JOB_ID}/subcontract.pdf`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Job not found" });
  });

  it("refuses a job that does not exist", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: "job_nowhere",
      pathname: "contracts/job_nowhere/subcontract.pdf",
    });

    expect(response.status).toBe(400);
  });
});

describe("a compliance document is owned by the COMPANY, and the id is never the client's", () => {
  it("mints a token under the caller's own company folder", async () => {
    const response = await post({
      purpose: "compliance-document",
      ownerId: COMPANY_ID,
      pathname: `compliance/${COMPANY_ID}/COI.pdf`,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { clientToken: string };
    expect(signedTerms(body.clientToken).pathname).toBe(`compliance/${COMPANY_ID}/COI.pdf`);
  });

  it("REFUSES a path under another company's folder, however the payload is dressed", async () => {
    // Both halves of the lie, together: the payload names the other
    // company AND the pathname matches that claim. It still fails,
    // because the prefix is built from the session and never from the
    // request — there is no id here to be talked into being wrong.
    const response = await post({
      purpose: "compliance-document",
      ownerId: OTHER_COMPANY_ID,
      pathname: `compliance/${OTHER_COMPANY_ID}/COI.pdf`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "That upload path does not belong to this record",
    });
  });
});

describe("who may ask for a token", () => {
  /**
   * MEMBER + a specific jobFunction, never `role: "MEMBER"` alone and
   * never OWNER: an OWNER holds every capability by construction, so a
   * refusal written against a role proves nothing (CLAUDE.md). ACCOUNTING
   * holds MANAGE_BILLING, VIEW_COMPANY_FINANCIALS and VIEW_JOB_COSTS — no
   * MANAGE_JOBS.
   */
  it("refuses an executed subcontract to someone whose job function does not manage jobs", async () => {
    principal.role = "MEMBER";
    principal.jobFunction = "ACCOUNTING";

    const response = await post({
      purpose: "executed-subcontract",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/executed.pdf`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Managing jobs isn't part of your job function.",
    });
  });

  it("allows it to a FIELD member, who does hold MANAGE_JOBS", async () => {
    // The control. Without it the case above passes just as well against
    // a route that refuses everybody.
    principal.role = "MEMBER";
    principal.jobFunction = "FIELD";

    const response = await post({
      purpose: "executed-subcontract",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/executed.pdf`,
    });

    expect(response.status).toBe(200);
  });

  it("allows the SAME refused person an ordinary contract document", async () => {
    // The second control, and the reason the table is keyed on purpose
    // rather than on folder: these two purposes share `contracts/<jobId>/`
    // and do not share a guard, because the actions behind them do not.
    // `uploadContractDocument` asserts nothing beyond company membership,
    // so a token stricter than that would refuse somebody the recording
    // step admits.
    principal.role = "MEMBER";
    principal.jobFunction = "ACCOUNTING";

    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      pathname: `contracts/${JOB_ID}/amendment.pdf`,
    });

    expect(response.status).toBe(200);
  });
});

describe("what the route will not entertain at all", () => {
  it("refuses an unknown purpose rather than guessing a folder", async () => {
    const response = await post({
      purpose: "invoice-attachment",
      ownerId: JOB_ID,
      pathname: `invoices/${JOB_ID}/x.pdf`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "That is not a kind of document this app files",
    });
  });

  it("refuses a content type that is not one of the four", async () => {
    const response = await post({
      purpose: "contract-document",
      ownerId: JOB_ID,
      contentType: "application/x-msdownload",
      pathname: `contracts/${JOB_ID}/contract.exe`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Upload a PDF, PNG, JPEG, or WEBP file" });
  });

  it("refuses a clientPayload that is not JSON, with a 400 rather than a framework 500", async () => {
    const response = await post({
      pathname: `contracts/${JOB_ID}/subcontract.pdf`,
      clientPayload: "{not json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed upload request" });
  });

  it("refuses a request body that is not JSON at all", async () => {
    const response = await POST(
      new Request("https://app.test/api/documents/upload", { method: "POST", body: "not json" }),
    );

    expect(response.status).toBe(400);
  });
});
