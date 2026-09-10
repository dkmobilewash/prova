import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { CLIENT_VISIBLE_CHANGE_ORDER_STATUS } from "@/lib/access-tokens";

/**
 * Issue #106, against a real Postgres:
 *
 *   - finding 1: the portal's change-order read filters to APPROVED only;
 *   - finding 2 (folds in #217): a revoked or expired token stops working,
 *     for both the portal (`Contact.portalToken`) and the esign
 *     (`SignatureRequest.token`) link, and a revoked one can be re-enabled
 *     without minting a new link;
 *   - finding 8's server-side half: `signRequest`'s double-submit race is
 *     closed by an atomic `updateMany` rather than a separate check.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one, same invocation as
 * billing.dbtest.ts documents.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const { createSignatureRequest, revokeSignatureRequest, signRequest, enablePortalAccess, revokeClientPortalAccess } =
  await import("./billing");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("signRequest respects revocation and expiry", () => {
  const ctx = { companyId: "", contactId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Token Test Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Token GC" } });
    ctx.contactId = contact.id;
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Token Job", status: "ESTIMATE" },
    });
    ctx.jobId = job.id;
  });

  afterAll(async () => {
    await prisma.signatureRequest.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
    await prisma.$disconnect();
  });

  it("refuses to sign a revoked request with the same message as a nonexistent token", async () => {
    await createSignatureRequest(ctx.jobId);
    const request = await prisma.signatureRequest.findFirstOrThrow({ where: { jobId: ctx.jobId } });
    expect(request.expiresAt).not.toBeNull(); // set at creation, per issue #106 finding 2

    await revokeSignatureRequest(request.id);
    const revoked = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.status).toBe("PENDING"); // revoked, not signed — the row is not touched otherwise

    await expect(
      signRequest(request.token, form({ signerName: "Someone", agree: "on" })),
    ).rejects.toThrow("Signing link not found");

    // Nothing on the row moved to SIGNED — a revoked link cannot be signed
    // by resubmitting, only the error message is thrown.
    const stillPending = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stillPending.status).toBe("PENDING");
  });

  it("lets a new signing link be created once the old one is revoked", async () => {
    // createSignatureRequest's own "reuse the existing PENDING one" check
    // must exclude a REVOKED request (still status PENDING) or the dead
    // link from the previous test could never be replaced.
    await createSignatureRequest(ctx.jobId);
    const pending = await prisma.signatureRequest.findMany({
      where: { jobId: ctx.jobId, status: "PENDING", revokedAt: null },
    });
    expect(pending).toHaveLength(1);
  });

  it("refuses to sign an expired request the same way", async () => {
    const request = await prisma.signatureRequest.create({
      data: { jobId: ctx.jobId, token: "expired-token-test", expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      signRequest(request.token, form({ signerName: "Someone", agree: "on" })),
    ).rejects.toThrow("Signing link not found");
  });

  it("signs successfully when neither revoked nor expired", async () => {
    const request = await prisma.signatureRequest.create({
      data: { jobId: ctx.jobId, token: "live-token-test", expiresAt: new Date(Date.now() + 1000 * 60 * 60) },
    });

    await signRequest(request.token, form({ signerName: "Jane GC", agree: "on" }));

    const signed = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(signed.status).toBe("SIGNED");
    expect(signed.signerName).toBe("Jane GC");
  });

  it("a duplicate submission after signing is a no-op, not an error — the double-click case", async () => {
    // Reproduces issue #106 finding 8's server-side shape directly: two
    // submissions for the same request, the second arriving after the
    // first has already committed. Before the fix this threw "This
    // contract has already been signed" — a redacted digest in
    // production — even though the FIRST click's signature had already
    // committed successfully.
    const request = await prisma.signatureRequest.create({
      data: { jobId: ctx.jobId, token: "double-click-token-test", expiresAt: null },
    });

    await signRequest(request.token, form({ signerName: "First Click", agree: "on" }));
    // Must not throw, and must not overwrite the first signer's captured
    // name — the updateMany's `status: "PENDING"` guard means a second
    // call matches zero rows once the first has already signed.
    await expect(
      signRequest(request.token, form({ signerName: "Second Click", agree: "on" })),
    ).resolves.toBeUndefined();

    const signed = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(signed.signerName).toBe("First Click");
  });

  it("two concurrent submissions for the same request neither throw nor corrupt the row", async () => {
    // HONEST LIMIT of this test, stated rather than glossed over: two
    // `signRequest` calls fired via `Promise.all` race at the Node event
    // loop's mercy, not at a guaranteed instant of true simultaneity —
    // there is no hook in this codebase to freeze one call between its
    // read and its write, which is what would be needed to force both
    // requests through `updateMany`'s WHERE at once and directly observe
    // one of them matching zero rows. What THIS proves: no exception
    // (issue #106 finding 8's actual user-facing symptom — a redacted
    // digest after a signature that in fact committed) and a coherent
    // final row belonging to a single, real submitter, under the same
    // concurrency this event loop can produce. The sequential test above
    // is what pins the atomic-update behavior deterministically: a
    // request already SIGNED is never re-written by a later call.
    const request = await prisma.signatureRequest.create({
      data: { jobId: ctx.jobId, token: "race-token-test", expiresAt: null },
    });

    await Promise.all([
      signRequest(request.token, form({ signerName: "Racer A", agree: "on" })),
      signRequest(request.token, form({ signerName: "Racer B", agree: "on" })),
    ]);

    const signed = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(signed.status).toBe("SIGNED");
    expect(["Racer A", "Racer B"]).toContain(signed.signerName);
  });
});

describe("portal token revocation and reactivation", () => {
  const ctx = { companyId: "", contactId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Portal Token Test Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Portal GC" } });
    ctx.contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
    await prisma.$disconnect();
  });

  it("enable, then revoke, then re-enable reuses the same token", async () => {
    await enablePortalAccess(ctx.contactId);
    const enabled = await prisma.contact.findUniqueOrThrow({ where: { id: ctx.contactId } });
    expect(enabled.portalToken).not.toBeNull();
    expect(enabled.portalRevokedAt).toBeNull();

    await revokeClientPortalAccess(ctx.contactId);
    const revoked = await prisma.contact.findUniqueOrThrow({ where: { id: ctx.contactId } });
    expect(revoked.portalRevokedAt).not.toBeNull();
    expect(revoked.portalToken).toBe(enabled.portalToken); // revoke never deletes or rotates the link

    await enablePortalAccess(ctx.contactId);
    const reenabled = await prisma.contact.findUniqueOrThrow({ where: { id: ctx.contactId } });
    expect(reenabled.portalRevokedAt).toBeNull();
    expect(reenabled.portalToken).toBe(enabled.portalToken); // same link, not a new one
  });
});

describe("the portal's change-order read is APPROVED only — issue #106 finding 1", () => {
  const ctx = { companyId: "", contactId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "CO Filter Test Co" } });
    ctx.companyId = company.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "CO Filter GC" } });
    ctx.contactId = contact.id;
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "CO Filter Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;

    for (const [status, number] of [
      ["DRAFT", 1],
      ["SUBMITTED", 2],
      ["APPROVED", 3],
      ["REJECTED", 4],
      ["VOID", 5],
    ] as const) {
      await prisma.changeOrder.create({
        data: { jobId: job.id, number, title: `CO ${status}`, status },
      });
    }
  });

  afterAll(async () => {
    await prisma.changeOrder.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("the exact query the portal job page runs returns only the APPROVED one", async () => {
    // Mirrors `apps/web/app/portal/[token]/jobs/[jobId]/page.tsx`'s
    // `changeOrders` include, using the SAME exported constant the page
    // itself filters on (`CLIENT_VISIBLE_CHANGE_ORDER_STATUS`) rather than
    // a second copy of the literal "APPROVED" — this repo's query-level
    // dbtests (retainage-query.dbtest.ts and siblings) test the query
    // shape rather than rendering the page, and sharing the constant is
    // what keeps this test and the page from independently drifting on
    // WHICH status is client-visible, even though it still can't catch
    // the page forgetting to apply the `where` clause at all.
    const changeOrders = await prisma.changeOrder.findMany({
      where: { jobId: ctx.jobId, status: CLIENT_VISIBLE_CHANGE_ORDER_STATUS },
      orderBy: { number: "asc" },
    });

    expect(changeOrders.map((co) => co.title)).toEqual(["CO APPROVED"]);
  });
});
