import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Accepting, dismissing and library-saving a drafted clause, against a real
 * Postgres.
 *
 * `proposal-facts.test.ts` owns the DECIDING — which facts need answering, what
 * `priced` may claim, when coverage applies. This owns the consequence, which is
 * entirely about rows:
 *
 *   - accepting creates ONE `JobProposalClause` and marks the draft, in one
 *     transaction. A clause on the letter whose draft still reads PROPOSED gets
 *     offered again; a draft marked accepted with no clause behind it is a fact
 *     the queue thinks is answered and the letter does not mention. Either both
 *     or neither, and only a database can show that;
 *   - the text comes from the FORM, so a corrected wording is what lands;
 *   - dismissing is recorded rather than deleted, which is what stops the panel
 *     being a nag.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { acceptProposalDraft, dismissProposalDraft, saveClauseToLibrary } = await import("./proposalDrafts");

let companyId = "";
let jobId = "";
let userId = "";

async function draft(input: { kind?: "INCLUSION" | "EXCLUSION"; text: string; factRef: string }) {
  return prisma.proposalClauseDraft.create({
    data: {
      companyId,
      jobId,
      kind: input.kind ?? "EXCLUSION",
      text: input.text,
      factKind: "SPEC_FINDING",
      factRef: input.factRef,
      citation: "“Provide Level 5 finish at all public areas.” — 09 21 16, Page 12",
      model: "test-model",
      promptVersion: "proposal-clause.1",
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Proposal Draft Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const user = await prisma.user.create({
    data: { companyId, clerkId: `proposal-draft-test-${Date.now()}`, email: `pd${Date.now()}@example.test`, role: "OWNER" },
  });
  userId = user.id;
  context.id = userId;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Proposal Draft Job", status: "ESTIMATE" },
  });
  jobId = job.id;
});

afterAll(async () => {
  await prisma.proposalClauseDraft.deleteMany({ where: { companyId } });
  await prisma.jobProposalClause.deleteMany({ where: { companyId } });
  await prisma.proposalClause.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("accepting a draft", () => {
  it("creates ONE clause and marks the draft, together", async () => {
    const row = await draft({ text: "Level 5 finish per 09 21 16 is not included.", factRef: "read1:1" });
    const form = new FormData();
    form.set("text", "Level 5 finish per 09 21 16 is not included.");

    const result = await acceptProposalDraft(row.id, form);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const clauses = await prisma.jobProposalClause.findMany({ where: { jobId }, select: { kind: true, text: true } });
    expect(clauses).toHaveLength(1);
    expect(clauses[0].text).toContain("Level 5 finish per 09 21 16");
    expect(clauses[0].kind).toBe("EXCLUSION");

    const after = await prisma.proposalClauseDraft.findUnique({
      where: { id: row.id },
      select: { status: true, acceptedClauseId: true, acceptedByUserId: true, acceptedAt: true },
    });
    expect(after?.status).toBe("ACCEPTED");
    // The clause it became, so the letter and the queue cannot disagree about
    // whether this fact was answered.
    expect(after?.acceptedClauseId).toBeTruthy();
    expect(after?.acceptedByUserId).toBe(userId);
    expect(after?.acceptedAt).toBeTruthy();
  });

  it("takes the EDITED wording from the form, which is the point of a review step", async () => {
    const row = await draft({ text: "Dumpsters are not included.", factRef: "indirect:DUMPSTERS" });
    const form = new FormData();
    form.set("text", "Dumpsters and debris removal are not included in our price.");

    await acceptProposalDraft(row.id, form);
    const clause = await prisma.jobProposalClause.findFirst({
      where: { jobId, kind: "EXCLUSION", text: { contains: "debris removal" } },
      select: { text: true },
    });
    expect(clause?.text).toBe("Dumpsters and debris removal are not included in our price.");
    // The draft records what was actually accepted, not what was drafted.
    const after = await prisma.proposalClauseDraft.findUnique({ where: { id: row.id }, select: { text: true } });
    expect(after?.text).toContain("debris removal");
  });

  it("falls back to the drafted text when the form sends nothing", async () => {
    const row = await draft({ text: "Fireproofing patch is not included.", factRef: "read1:2" });
    await acceptProposalDraft(row.id, new FormData());
    const clause = await prisma.jobProposalClause.findFirst({
      where: { jobId, text: { contains: "Fireproofing patch" } },
      select: { id: true },
    });
    expect(clause).not.toBeNull();
  });

  it("REFUSES a second accept rather than adding the clause twice", async () => {
    const row = await draft({ text: "Hoisting is not included.", factRef: "indirect:HOISTING" });
    const form = new FormData();
    form.set("text", "Hoisting is not included.");
    await acceptProposalDraft(row.id, form);
    const again = await acceptProposalDraft(row.id, form);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already been dealt with");
    const clauses = await prisma.jobProposalClause.findMany({ where: { jobId, text: { contains: "Hoisting" } } });
    expect(clauses).toHaveLength(1);
  });
});

describe("dismissing a draft", () => {
  it("is RECORDED, not deleted, so the fact is never proposed again", async () => {
    const row = await draft({ text: "Temporary protection is not included.", factRef: "indirect:TEMPORARY_PROTECTION" });
    const result = await dismissProposalDraft(row.id);
    expect(result.ok).toBe(true);
    const after = await prisma.proposalClauseDraft.findUnique({ where: { id: row.id }, select: { status: true } });
    // The row survives. A deleted one would make this a nag — the fact would
    // come back next time somebody pressed draft.
    expect(after?.status).toBe("DISMISSED");
  });

  it("writes no clause onto the proposal", async () => {
    const row = await draft({ text: "Scaffolding is not included.", factRef: "indirect:SCAFFOLD" });
    await dismissProposalDraft(row.id);
    const clause = await prisma.jobProposalClause.findFirst({ where: { jobId, text: { contains: "Scaffolding" } } });
    expect(clause).toBeNull();
  });

  it("refuses to dismiss something already on the proposal", async () => {
    const row = await draft({ text: "Cleanup is not included.", factRef: "indirect:CLEANUP" });
    const form = new FormData();
    form.set("text", "Cleanup is not included.");
    await acceptProposalDraft(row.id, form);
    const result = await dismissProposalDraft(row.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already on the proposal");
  });
});

describe("the company library", () => {
  it("copies an accepted clause in, once", async () => {
    const row = await draft({ text: "Permits are not included.", factRef: "indirect:PERMITS" });
    const form = new FormData();
    form.set("text", "Permits are not included.");
    await acceptProposalDraft(row.id, form);

    expect((await saveClauseToLibrary(row.id)).ok).toBe(true);
    const library = await prisma.proposalClause.findMany({ where: { companyId, text: { contains: "Permits" } } });
    expect(library).toHaveLength(1);

    // Said plainly rather than silently succeeding: somebody pressing twice
    // should learn it is already there.
    const again = await saveClauseToLibrary(row.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already in your standard set");
    expect(await prisma.proposalClause.count({ where: { companyId, text: { contains: "Permits" } } })).toBe(1);
  });

  it("refuses a draft nobody has accepted", async () => {
    const row = await draft({ text: "Winter protection is not included.", factRef: "indirect:WINTER" });
    const result = await saveClauseToLibrary(row.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not been accepted");
  });

  it("refuses a non-owner, in words rather than by throwing", async () => {
    // `ownerRefusal` returns `{ ok: false }`; `assertOwner` throws, and a thrown
    // Server Action message is REDACTED in production — which would make this a
    // dead button rather than a refusal.
    const row = await draft({ text: "Snow removal is not included.", factRef: "indirect:SNOW" });
    const form = new FormData();
    form.set("text", "Snow removal is not included.");
    await acceptProposalDraft(row.id, form);

    context.role = "MEMBER";
    const result = await saveClauseToLibrary(row.id);
    context.role = "OWNER";

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("owner");
  });
});

describe("another company cannot reach any of it", () => {
  it("refuses an accept for a draft belonging to someone else", async () => {
    const row = await draft({ text: "Mock-up panel is not included.", factRef: "read1:9" });
    const other = await prisma.company.create({ data: { name: "Other Proposal Co" } });
    context.company.id = other.id;
    const result = await acceptProposalDraft(row.id, new FormData());
    context.company.id = companyId;
    await prisma.company.delete({ where: { id: other.id } });

    expect(result.ok).toBe(false);
    // And nothing was written for them.
    const clause = await prisma.jobProposalClause.findFirst({ where: { text: { contains: "Mock-up panel" } } });
    expect(clause).toBeNull();
  });
});
