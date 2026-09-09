import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * A HANDOFF card, end to end against a real Postgres: the page loads it
 * once per person, the tap cannot execute it, the form settles it, and
 * after that neither the page nor the dashboard sees it again. Every rule
 * in lib/ask/drafts.ts's comment is a case here, because a loader that
 * answers null for six reasons is exactly the kind of thing that passes
 * by never being asked the seventh.
 */
const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadRfiDraft, loadPunchDraft } = await import("./drafts");
const { confirmAskProposal, loadAskProposal, settleAskDraft } = await import("@/lib/actions/ask");
const { linkToken } = await import("@/lib/tokens");

let companyId = "";
let ownerId = "";
let otherUserId = "";
let jobId = "";

async function card(
  command: "raise_rfi" | "add_punch_item",
  overrides: { createdByUserId?: string; expiresAt?: Date; mode?: string } = {},
) {
  const id = linkToken();
  const resolved =
    command === "raise_rfi"
      ? { jobId, jobName: "ASK-DRAFT job", subject: "Head-of-wall", question: "Which governs?", drawingReference: "A-501 / 3", specSection: null }
      : { jobId, jobName: "ASK-DRAFT job", description: "grid out of level" };
  await prisma.askProposal.create({
    data: {
      id,
      companyId,
      createdByUserId: overrides.createdByUserId ?? ownerId,
      command,
      mode: overrides.mode ?? "HANDOFF",
      question: "raise an RFI",
      input: {},
      resolved,
      preview: [{ label: "Job", value: "ASK-DRAFT job" }],
      model: "test",
      toolUseId: "tu_test",
      toolUseIdsInContext: [],
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000),
    },
  });
  return id;
}

describe("a HANDOFF card against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "ASK-DRAFT Co" } });
    companyId = company.id;
    context.company.id = companyId;
    const owner = await prisma.user.create({
      data: { companyId, clerkId: `draft_o_${Date.now()}`, email: `draft_o_${Date.now()}@example.test`, role: "OWNER" },
    });
    ownerId = owner.id;
    context.id = ownerId;
    const other = await prisma.user.create({
      data: { companyId, clerkId: `draft_m_${Date.now()}`, email: `draft_m_${Date.now()}@example.test`, role: "MEMBER" },
    });
    otherUserId = other.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "ASK-DRAFT Turner" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "ASK-DRAFT job" } });
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.askProposal.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  const viewer = () => ({ company: { id: companyId }, id: ownerId });

  it("loads for the person who asked, stamps openedAt once, and loads again until settled", async () => {
    const id = await card("raise_rfi");
    const first = await loadRfiDraft(viewer(), id);
    expect(first).toEqual({
      proposalId: id,
      jobId,
      subject: "Head-of-wall",
      question: "Which governs?",
      drawingReference: "A-501 / 3",
      specSection: null,
    });
    const opened = (await prisma.askProposal.findUniqueOrThrow({ where: { id } })).openedAt;
    expect(opened).not.toBeNull();

    // A reload of the page before saving still has the draft, and the
    // first opening is the one on record.
    const second = await loadRfiDraft(viewer(), id);
    expect(second?.subject).toBe("Head-of-wall");
    expect((await prisma.askProposal.findUniqueOrThrow({ where: { id } })).openedAt).toEqual(opened);
  });

  it("does not load for somebody else in the same company, for the wrong page, in DIRECT mode, or after expiry", async () => {
    const theirs = await card("raise_rfi", { createdByUserId: otherUserId });
    expect(await loadRfiDraft(viewer(), theirs)).toBeNull();
    expect((await prisma.askProposal.findUniqueOrThrow({ where: { id: theirs } })).openedAt).toBeNull();

    const punch = await card("add_punch_item");
    expect(await loadRfiDraft(viewer(), punch)).toBeNull();
    expect(await loadPunchDraft(viewer(), punch)).toEqual({ proposalId: punch, jobId, description: "grid out of level" });

    const direct = await card("raise_rfi", { mode: "DIRECT" });
    expect(await loadRfiDraft(viewer(), direct)).toBeNull();

    const expired = await card("raise_rfi", { expiresAt: new Date(Date.now() - 60_000) });
    expect(await loadRfiDraft(viewer(), expired)).toBeNull();

    expect(await loadRfiDraft(viewer(), undefined)).toBeNull();
    expect(await loadRfiDraft(viewer(), "not-a-card")).toBeNull();
  });

  it("cannot be executed by the tap, and the tap leaves it for the page", async () => {
    const id = await card("add_punch_item");
    const result = await confirmAskProposal(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/opens a form/);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.claimedAt).toBeNull();
    expect(row.outcome).toBeNull();
    expect(await loadPunchDraft(viewer(), id)).not.toBeNull();
  });

  it("is settled by the form once, and then neither the page nor the dashboard offers it", async () => {
    const id = await card("raise_rfi");
    expect(await loadRfiDraft(viewer(), id)).not.toBeNull();

    expect((await settleAskDraft(id)).ok).toBe(true);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.outcome).toBe("OK");
    expect(row.claimedAt).not.toBeNull();

    expect(await loadRfiDraft(viewer(), id)).toBeNull();
    const reattach = await loadAskProposal(id);
    expect(reattach.ok).toBe(false);

    // Idempotent: a second settle changes nothing and complains about nothing.
    expect((await settleAskDraft(id)).ok).toBe(true);
    expect((await prisma.askProposal.findUniqueOrThrow({ where: { id } })).claimedAt).toEqual(row.claimedAt);
  });

  it("settles only the asking person's own HANDOFF card", async () => {
    const theirs = await card("add_punch_item", { createdByUserId: otherUserId });
    expect((await settleAskDraft(theirs)).ok).toBe(true);
    expect((await prisma.askProposal.findUniqueOrThrow({ where: { id: theirs } })).outcome).toBeNull();

    const direct = await card("raise_rfi", { mode: "DIRECT" });
    await settleAskDraft(direct);
    expect((await prisma.askProposal.findUniqueOrThrow({ where: { id: direct } })).outcome).toBeNull();
  });

  it("reattaches on the dashboard until the page has opened it, with the link the card needs", async () => {
    const id = await card("raise_rfi");
    const before = await loadAskProposal(id);
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.value.proposal.mode).toBe("HANDOFF");
      expect(before.value.proposal.handoffHref).toBe(`/rfis?draft=${id}`);
    }
    await loadRfiDraft(viewer(), id);
    const after = await loadAskProposal(id);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toMatch(/opened on its page/);
  });
});
