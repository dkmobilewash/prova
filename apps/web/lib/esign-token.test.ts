import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The e-signature link's token is the ONLY access control on /esign/[token]:
 * that page is unauthenticated, renders a company's full contract — client
 * name, scope, every line item with quantities and unit prices — and its
 * `signRequest` action marks the contract legally SIGNED with a signer name
 * the caller supplies. So the token is a bearer credential.
 *
 * It was `@default(cuid())`. cuid is a collision-resistant IDENTIFIER
 * generator, not a CSPRNG — it is built from a timestamp, a per-process
 * counter, a machine fingerprint and a short random block, and it has never
 * claimed unguessability. The neighbouring `Contact.portalToken` already did
 * this correctly with `randomBytes(24)`, and the schema comment claimed the
 * two were "the same access-control pattern". They were not.
 *
 * These tests pin the fix at BOTH ends: the value the action actually writes,
 * and the schema that would silently reinstate a default if the explicit
 * write were ever dropped.
 */

const HEX_48 = /^[0-9a-f]{48}$/;

const COMPANY_ID = "cmp_alpha";
const JOB_ID = "job_alpha";

const signatureRequests: Record<string, unknown>[] = [];
const contactUpdates: Record<string, unknown>[] = [];

const prisma = {
  job: { findUnique: async () => ({ id: JOB_ID, companyId: COMPANY_ID, status: "ESTIMATE" }) },
  signatureRequest: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      signatureRequests.push(data);
      return { id: `sig_${signatureRequests.length}`, ...data };
    },
  },
  contact: {
    findUnique: async () => ({ id: "con_1", companyId: COMPANY_ID, portalToken: null }),
    update: async ({ data }: { data: Record<string, unknown> }) => {
      contactUpdates.push(data);
      return { id: "con_1", ...data };
    },
  },
};

vi.mock("@prova/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vercel/blob", () => ({ put: async () => ({ url: "https://example.test/x", pathname: "x" }) }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ id: "usr_1", role: "OWNER", company: { id: COMPANY_ID } }),
}));
vi.mock("@prova/integrations", () => ({
  revokeToken: async () => {},
  refreshTokens: async () => {},
  getCompanyInfo: async () => ({}),
  generateWipNarrative: async () => "",
}));

const { createSignatureRequest, enablePortalAccess } = await import("./actions/billing");

beforeEach(() => {
  signatureRequests.length = 0;
  contactUpdates.length = 0;
});

describe("the e-signature token is a secret, not a database id", () => {
  it("createSignatureRequest writes an explicit CSPRNG token", async () => {
    await createSignatureRequest(JOB_ID);

    expect(signatureRequests).toHaveLength(1);
    const token = signatureRequests[0].token;

    // The point of the fix: the action supplies the token, so no schema
    // default can quietly decide it.
    expect(typeof token, "createSignatureRequest must set `token` itself").toBe("string");
    // 24 bytes of randomBytes, hex encoded — 192 bits, same as portalToken.
    expect(token as string).toMatch(HEX_48);
    // NOT `expect(token).not.toMatch(/^c[a-z0-9]{20,}$/)`. That assertion was
    // here and was FLAKY BY CONSTRUCTION: hex is a subset of [a-z0-9], so any
    // token that happens to begin with `c` matches the cuid shape — roughly
    // one run in sixteen, on every branch, unrelated to the code under test.
    // CI caught it on an unrelated PR. HEX_48 already proves what matters:
    // exactly 48 hex characters is a shape no cuid can take (a cuid is ~25
    // characters over the full base36 alphabet), so the positive assertion
    // subsumes the negative one without the false failures.
  });

  it("issues the same shape of token as the portal link it claims to match", async () => {
    await createSignatureRequest(JOB_ID);
    await enablePortalAccess("con_1");

    const esign = signatureRequests[0].token as string;
    const portal = contactUpdates[0].portalToken as string;

    expect(esign).toHaveLength(portal.length);
    expect(esign).toMatch(HEX_48);
    expect(portal).toMatch(HEX_48);
  });

  it("never repeats a token across many requests", async () => {
    for (let i = 0; i < 200; i += 1) {
      await createSignatureRequest(JOB_ID);
    }
    const tokens = signatureRequests.map((r) => r.token as string);
    expect(new Set(tokens).size).toBe(200);
    // A timestamp-ordered generator produces tokens that share a long
    // prefix within one run. A CSPRNG does not.
    expect(tokens[0].slice(0, 8)).not.toBe(tokens[199].slice(0, 8));
  });
});

describe("the schema cannot reinstate a guessable default", () => {
  const schemaDir = fileURLToPath(new URL("../../../packages/db/prisma/schema/", import.meta.url));

  it("SignatureRequest.token has no @default", () => {
    const billing = readFileSync(`${schemaDir}billing.prisma`, "utf8");
    const line = billing
      .split("\n")
      .find((l) => /^\s*token\s+String\s+@unique/.test(l));

    expect(line, "SignatureRequest.token line not found — did the field move?").toBeDefined();
    expect(line as string).not.toContain("@default");
  });

  it("the schema comment no longer claims portalToken and the e-sign token share a generator", () => {
    const company = readFileSync(`${schemaDir}company.prisma`, "utf8");
    // The old comment said "Same access-control pattern as
    // SignatureRequest.token" while the two used different generators; the
    // comment is what a reviewer trusts, so it has to stop saying that
    // until it is true of the generator too.
    expect(company).toContain("randomBytes");
  });
});
