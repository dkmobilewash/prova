import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadProposalSend } from "./proposal-send-query";
import { proposalFingerprint } from "./proposal-send";

/**
 * `loadProposalSend` against a real Postgres: the one reader the Bid proposal
 * page AND `sendBidProposal` share, so the price on the screen, the price the
 * action checks and the text in the email come from one read.
 *
 * Run against a SCRATCH database only (`vitest.db.config.mts`).
 */

const t = `psend_${Date.now()}`;
const NOW = new Date("2026-10-27T15:00:00.000Z");
const PROD = { VERCEL_ENV: "production" };
let co = "";
let otherCo = "";
let jobId = "";
let otherJobId = "";
let invitationId = "";
let bareInvitationId = "";
let strayInvitationId = "";
let theirInvitationId = "";
const savedEnv = { key: process.env.RESEND_API_KEY, from: process.env.OUTBOUND_EMAIL_FROM };

function load(over: Partial<Parameters<typeof loadProposalSend>[0]> = {}) {
  return loadProposalSend({
    companyId: co,
    companyName: "Cyrus Drywall",
    jobId,
    invitationId,
    mode: "lump",
    timeZone: "UTC",
    now: NOW,
    env: PROD,
    ...over,
  });
}

describe("loadProposalSend", () => {
  beforeAll(async () => {
    co = (await prisma.company.create({ data: { name: `PSend Co ${t}` } })).id;
    otherCo = (await prisma.company.create({ data: { name: `PSend Other ${t}` } })).id;
    const gc = await prisma.contact.create({
      data: {
        companyId: co,
        name: `Turner ${t}`,
        email: "bids@turner.test",
        people: { create: [{ companyId: co, name: "Dana Reyes", email: "dana@turner.test" }] },
      },
    });
    const bare = await prisma.contact.create({ data: { companyId: co, name: `No Email GC ${t}` } });
    const theirGc = await prisma.contact.create({ data: { companyId: otherCo, name: `Theirs ${t}`, email: "x@theirs.test" } });

    const job = await prisma.job.create({
      data: { companyId: co, contactId: gc.id, name: `PSend job ${t}`, status: "ESTIMATE", scope: "Framing and board.", projectLocation: "12 River Rd" },
    });
    jobId = job.id;
    await prisma.jobLineItem.create({ data: { jobId, description: "Board", unit: "SF", quantity: 1000, unitPrice: 2.5 } });
    await prisma.jobLineItem.create({ data: { jobId, description: "Shaftwall", unit: "SF", quantity: 100, unitPrice: 10 } });
    await prisma.jobLineItem.create({ data: { jobId, description: "Deleted", unit: "SF", quantity: 1, unitPrice: 999, isDeleted: true } });
    await prisma.jobProposalClause.create({ data: { companyId: co, jobId, kind: "EXCLUSION", text: "Insulation" } });

    const project = await prisma.bidProject.create({ data: { companyId: co, name: `PSend project ${t}`, estimateJobId: jobId } });
    invitationId = (
      await prisma.bidInvitation.create({
        data: {
          companyId: co,
          contactId: gc.id,
          projectName: `Riverside ${t}`,
          bidProjectId: project.id,
          priceAdjustAmount: 100,
          lines: { create: [{ companyId: co, kind: "ALTERNATE", label: "Alt 1", amount: 500 }] },
        },
      })
    ).id;
    bareInvitationId = (
      await prisma.bidInvitation.create({ data: { companyId: co, contactId: bare.id, projectName: `Bare ${t}`, bidProjectId: project.id } })
    ).id;

    // On ANOTHER estimate's project: not this proposal's GC.
    otherJobId = (await prisma.job.create({ data: { companyId: co, contactId: gc.id, name: `Other job ${t}`, status: "ESTIMATE" } })).id;
    const otherProject = await prisma.bidProject.create({ data: { companyId: co, name: `Other project ${t}`, estimateJobId: otherJobId } });
    strayInvitationId = (
      await prisma.bidInvitation.create({ data: { companyId: co, contactId: gc.id, projectName: `Stray ${t}`, bidProjectId: otherProject.id } })
    ).id;
    theirInvitationId = (
      await prisma.bidInvitation.create({ data: { companyId: otherCo, contactId: theirGc.id, projectName: `Theirs ${t}`, wonJobId: null } })
    ).id;

    process.env.RESEND_API_KEY = "test-key";
    process.env.OUTBOUND_EMAIL_FROM = "office@cyrus.test";
  });

  afterEach(async () => {
    await prisma.outboundMessage.deleteMany({ where: { companyId: co } });
  });

  afterAll(async () => {
    if (savedEnv.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedEnv.key;
    if (savedEnv.from === undefined) delete process.env.OUTBOUND_EMAIL_FROM;
    else process.env.OUTBOUND_EMAIL_FROM = savedEnv.from;
    await prisma.outboundMessage.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.bidInvitation.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.bidProject.deleteMany({ where: { companyId: co } });
    await prisma.jobProposalClause.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: [jobId, otherJobId] } } });
    await prisma.job.deleteMany({ where: { id: { in: [jobId, otherJobId] } } });
    await prisma.contactPerson.deleteMany({ where: { companyId: co } });
    await prisma.contact.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.company.deleteMany({ where: { id: { in: [co, otherCo] } } });
  });

  it("prices the proposal at THIS GC's price, from live lines only", async () => {
    const loaded = await load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // 1000 × 2.50 + 100 × 10 = 3,500, plus this GC's +$100 adjustment; the deleted line is not read.
    expect(loaded.view.totalCents).toBe(360_000);
    expect(loaded.view.lineCount).toBe(2);
    expect(loaded.view.blocker).toBeNull();
    expect(loaded.view.status).toBe("INVITED");
    expect(loaded.view.bidAmountIsBlank).toBe(true);
  });

  it("offers the named person first, then the company address", async () => {
    const loaded = await load();
    if (!loaded.ok) throw new Error(loaded.problem);
    expect(loaded.view.recipients).toEqual([
      { address: "dana@turner.test", name: "Dana Reyes" },
      { address: "bids@turner.test", name: `Turner ${t}` },
    ]);
  });

  it("writes the document from the rows: scope, price, the GC's alternate and every clause", async () => {
    const loaded = await load();
    if (!loaded.ok) throw new Error(loaded.problem);
    const text = loaded.view.documentText;
    expect(text).toContain(`PROPOSAL — Riverside ${t}`);
    expect(text).toContain(`Cyrus Drywall to Turner ${t} · 10/27/2026`);
    expect(text).toContain("12 River Rd");
    expect(text).toContain("Framing and board.");
    expect(text).toContain("Lump sum for the work described in this proposal: $3,600.00");
    expect(text).toContain("Alt 1: Add $500.00");
    expect(text).toContain("EXCLUSIONS\n- Insulation");
    expect(text).not.toContain("$999");
    expect(loaded.view.subject).toBe(`Proposal — Riverside ${t} — Cyrus Drywall`);
    // The fingerprint the composer posts back is of exactly this text.
    expect(loaded.view.documentFingerprint).toBe(proposalFingerprint(text));
    // and a changed alternate moves it while the total stays put
    await prisma.bidLine.updateMany({ where: { bidInvitationId: invitationId }, data: { amount: 900 } });
    try {
      const again = await load();
      if (!again.ok) throw new Error(again.problem);
      expect(again.view.totalCents).toBe(loaded.view.totalCents);
      expect(again.view.documentFingerprint).not.toBe(loaded.view.documentFingerprint);
    } finally {
      await prisma.bidLine.updateMany({ where: { bidInvitationId: invitationId }, data: { amount: 500 } });
    }
  });

  it("follows the chosen presentation", async () => {
    const loaded = await load({ mode: "itemized" });
    if (!loaded.ok) throw new Error(loaded.problem);
    expect(loaded.view.documentText).toContain("Board — 1000 SF @ $2.50 = $2,500.00");
    expect(loaded.view.documentText).toContain("Price adjustment: $100.00");
    expect(loaded.view.totalCents).toBe(360_000);
  });

  it("is disabled with a sentence off production, and with the contact's sentence when there is no address", async () => {
    const preview = await load({ env: { VERCEL_ENV: "preview" } });
    if (!preview.ok) throw new Error(preview.problem);
    expect(preview.view.blocker).toContain("This is a preview");

    const bare = await load({ invitationId: bareInvitationId });
    if (!bare.ok) throw new Error(bare.problem);
    expect(bare.view.recipients).toEqual([]);
    expect(bare.view.blocker).toBe(`There's no email address on file for No Email GC ${t}. Add one to their contact record, then send.`);
  });

  it("refuses an invitation this estimate does not price, and another company's", async () => {
    expect(await load({ invitationId: strayInvitationId })).toMatchObject({ ok: false });
    expect(await load({ invitationId: theirInvitationId })).toMatchObject({ ok: false });
    expect(await load({ companyId: otherCo })).toMatchObject({ ok: false, problem: "That estimate wasn't found." });
  });

  it("lists this invitation's earlier sends, newest first, and says which reached the provider", async () => {
    const make = (createdAt: string, type: "QUEUED" | "FAILED", detail: string | null, relatedId = invitationId) =>
      prisma.outboundMessage.create({
        data: {
          companyId: co,
          channel: "EMAIL",
          toAddress: "dana@turner.test",
          subject: "Proposal",
          body: "text",
          fromAddress: "office@cyrus.test",
          relatedType: "BID_INVITATION",
          relatedId,
          createdAt: new Date(createdAt),
          events: { create: { type, occurredAt: new Date(createdAt), detail } },
        },
      });
    await make("2026-10-25T10:00:00Z", "FAILED", "Domain not verified");
    await make("2026-10-26T10:00:00Z", "QUEUED", null);
    await make("2026-10-26T11:00:00Z", "QUEUED", null, bareInvitationId); // another GC's send

    const loaded = await load();
    if (!loaded.ok) throw new Error(loaded.problem);
    expect(loaded.view.history.map((one) => [one.at.toISOString(), one.reached, one.detail])).toEqual([
      ["2026-10-26T10:00:00.000Z", true, null],
      ["2026-10-25T10:00:00.000Z", false, "Domain not verified"],
    ]);
  });
});
