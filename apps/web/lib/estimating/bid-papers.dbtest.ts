import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@prova/db";

/**
 * QUOTES, ADDENDA AND SPEC SECTIONS BELONG TO THE PROJECT — against a real
 * Postgres. Named `.dbtest.ts` so the normal suite does not collect it; run it
 * against a SCRATCH database as vitest.db.config.mts documents.
 *
 * The questions here are about ROWS: a quote filed under GC A that GC B's row
 * must also see, an acknowledgement that must stay one GC's own, papers that
 * must survive a merge, a split and the deletion of the invitation they were
 * filed under, and a backfill that must be safe to run twice. None can be
 * checked by reading a return value.
 *
 * Only the auth boundary, revalidatePath, redirect and the post-response agent
 * are faked. The reads, the actions, Prisma, the transactions, the schema and the
 * migration's own backfill SQL are real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: () => {} }));

const core = await import("./bid-project");
const papers = await import("./bid-papers");
const { createBidInvitationRecord } = await import("./bid-invitation");
const estimating = await import("@/lib/actions/estimating");
const { saveBidSpecSection } = await import("@/lib/actions/specRead");
const { loadCrossCheckInputs } = await import("./estimate-crosschecks-query");
const { loadTakeoffCurrency } = await import("@/lib/takeoff-currency-query");

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../../packages/db/prisma/schema/migrations/20261026120000_bid_papers_on_project/migration.sql", import.meta.url)),
  "utf8",
);

const tag = `bpp_${Date.now()}`;
let companyId = "";
let otherCompanyId = "";
const contact: Record<string, string> = {};
let otherContactId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function invite(gc: string, projectName: string, bidProjectId?: string) {
  const result = await createBidInvitationRecord(companyId, {
    contactId: contact[gc],
    projectName: `${projectName} ${tag}`,
    dueDate: null,
    bidProjectId: bidProjectId ?? null,
  });
  if (!result.ok) throw new Error(result.error);
  const row = await prisma.bidInvitation.findUniqueOrThrow({ where: { id: result.value.bidInvitationId } });
  return { id: row.id, projectId: row.bidProjectId! };
}

/** What a row on /bids would show, by the same where the page uses. */
const quotesShownTo = (inv: { id: string; projectId: string | null }) =>
  prisma.bidQuote.findMany({ where: { companyId, ...papers.paperWhere({ id: inv.id, bidProjectId: inv.projectId }) }, orderBy: { createdAt: "asc" } });
const addendaShownTo = (inv: { id: string; projectId: string | null }) =>
  prisma.bidAddendum.findMany({
    where: { companyId, ...papers.paperWhere({ id: inv.id, bidProjectId: inv.projectId }) },
    orderBy: { createdAt: "asc" },
    include: { acknowledgements: true },
  });
const sectionsShownTo = (inv: { id: string; projectId: string | null }) =>
  prisma.bidSpecSection.findMany({
    where: { bidInvitation: { companyId }, ...papers.paperWhere({ id: inv.id, bidProjectId: inv.projectId }) },
    orderBy: { createdAt: "asc" },
  });

const quote = (label: string, vendor: string, extra: Record<string, string> = {}) =>
  form({ packageLabel: label, vendorName: vendor, amount: "", ...extra });

async function fileQuote(invitationId: string, label: string, vendor: string, extra: Record<string, string> = {}) {
  const result = await estimating.saveBidQuote(invitationId, quote(label, vendor, extra));
  expect(result).toEqual({ ok: true });
  return prisma.bidQuote.findFirstOrThrow({ where: { bidInvitationId: invitationId, vendorName: vendor, packageLabel: label } });
}

async function fileAddendum(invitationId: string, reference: string, extra: Record<string, string> = {}) {
  const result = await estimating.saveBidAddendum(invitationId, form({ reference, ...extra }));
  expect(result).toEqual({ ok: true });
  return prisma.bidAddendum.findFirstOrThrow({ where: { bidInvitationId: invitationId, reference } });
}

describe("quotes, addenda and spec sections belong to the project, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Bid Papers Co ${tag}` } });
    companyId = company.id;
    context.company.id = company.id;
    const other = await prisma.company.create({ data: { name: `Bid Papers Other ${tag}` } });
    otherCompanyId = other.id;
    for (const name of ["acme", "buildco", "turner", "ratecorp"]) {
      contact[name] = (await prisma.contact.create({ data: { companyId, name: `${name} ${tag}` } })).id;
    }
    otherContactId = (await prisma.contact.create({ data: { companyId: otherCompanyId, name: `their GC ${tag}` } })).id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
      await prisma.bidProject.deleteMany({ where: { companyId: id } });
      await prisma.jobLineItem.deleteMany({ where: { job: { companyId: id } } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  // ── the migration's backfill, executed, twice ────────────────────────────

  it("the migration's backfill gives every paper its invitation's project, never overwrites one, and a second run changes nothing", async () => {
    // Pre-migration shape: papers filed under invitations, with NO project of
    // their own. Two GCs on two projects, and one paper that already has a
    // (different) project, which the backfill must leave alone.
    const a = await invite("acme", "Backfill Hospital");
    const b = await invite("buildco", "Backfill Annex");
    const rowFor = (inv: string, extra: Record<string, unknown> = {}) => ({ companyId, bidInvitationId: inv, ...extra });

    const q1 = await prisma.bidQuote.create({ data: { ...rowFor(a.id), packageLabel: "Framing", vendorName: "Alpha" } });
    const q2 = await prisma.bidQuote.create({ data: { ...rowFor(b.id), packageLabel: "Framing", vendorName: "Beta" } });
    const keep = await prisma.bidQuote.create({ data: { ...rowFor(b.id, { bidProjectId: a.projectId }), packageLabel: "EIFS", vendorName: "Keep" } });
    const ad = await prisma.bidAddendum.create({ data: { ...rowFor(a.id), reference: "Addendum 1", acknowledgedOn: new Date("2026-10-01T00:00:00Z") } });
    const sp = await prisma.bidSpecSection.create({ data: { bidInvitationId: b.id, sectionNumber: "09 21 16" } });
    const ids = { q: [q1.id, q2.id, keep.id], ad: ad.id, sp: sp.id };
    // `quote.create` above set bidProjectId on `keep` only; null the rest explicitly.
    expect(await prisma.bidQuote.count({ where: { id: { in: [q1.id, q2.id] }, bidProjectId: null } })).toBe(2);

    const marker = "-- Backfill: every existing paper takes the project of the invitation it was";
    expect(migrationSql).toContain(marker);
    const backfill = migrationSql.slice(migrationSql.indexOf(marker));
    const statements = backfill.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    expect(statements).toHaveLength(3);

    const run = async () => {
      const counts: number[] = [];
      await prisma.$transaction(async (tx) => {
        for (const sql of statements) counts.push(await tx.$executeRawUnsafe(sql));
      });
      return counts;
    };
    const first = await run();
    // Our rows are among the ones touched; other tests' leftovers can only add.
    expect(first[0]).toBeGreaterThanOrEqual(2);
    expect(first[1]).toBeGreaterThanOrEqual(1);
    expect(first[2]).toBeGreaterThanOrEqual(1);

    const q = await prisma.bidQuote.findMany({ where: { id: { in: ids.q } }, orderBy: { vendorName: "asc" } });
    expect(Object.fromEntries(q.map((row) => [row.vendorName, row.bidProjectId]))).toEqual({
      Alpha: a.projectId,
      Beta: b.projectId,
      Keep: a.projectId, // already set: NOT overwritten with its filing invitation's project
    });
    expect((await prisma.bidAddendum.findUniqueOrThrow({ where: { id: ids.ad } })).bidProjectId).toBe(a.projectId);
    expect((await prisma.bidSpecSection.findUniqueOrThrow({ where: { id: ids.sp } })).bidProjectId).toBe(b.projectId);
    // The legacy acknowledgement is untouched and no acknowledgement row was invented.
    expect((await prisma.bidAddendum.findUniqueOrThrow({ where: { id: ids.ad } })).acknowledgedOn?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(await prisma.bidAddendumAcknowledgement.count({ where: { bidAddendumId: ids.ad } })).toBe(0);

    // IDEMPOTENT: nothing is left to touch, so the second run updates zero rows.
    expect(await run()).toEqual([0, 0, 0]);
    const again = await prisma.bidQuote.findMany({ where: { id: { in: ids.q } }, orderBy: { vendorName: "asc" } });
    expect(again.map((row) => row.bidProjectId)).toEqual(q.map((row) => row.bidProjectId));
  });

  // ── the point of it: another GC's row shows the paper ────────────────────

  it("a quote filed under GC A shows on GC B's row for the same project, and B can edit and carry it", async () => {
    const a = await invite("acme", "Shared Hospital");
    const b = await invite("buildco", "Shared Hospital (BuildCo)", a.projectId);
    const lone = await invite("turner", "Somewhere Else");

    const filed = await fileQuote(a.id, "Metal stud framing", "Alpha Supply", { amount: "82000", quotedOn: "2026-10-20" });
    // Written with the project of the invitation it was filed under.
    expect(filed.bidProjectId).toBe(a.projectId);
    expect(filed.bidInvitationId).toBe(a.id);

    expect((await quotesShownTo({ id: a.id, projectId: a.projectId })).map((row) => row.id)).toEqual([filed.id]);
    expect((await quotesShownTo({ id: b.id, projectId: b.projectId })).map((row) => row.id)).toEqual([filed.id]);
    // A different project sees nothing: the scope is the project, not the company.
    expect(await quotesShownTo({ id: lone.id, projectId: lone.projectId })).toEqual([]);

    // GC B's row edits the quote filed under A's invitation (it used to refuse
    // with "no longer on this bid").
    expect(
      await estimating.saveBidQuote(b.id, quote("Metal stud framing", "Alpha Supply", { bidQuoteId: filed.id, amount: "81000", quotedOn: "2026-10-21" })),
    ).toEqual({ ok: true });
    const edited = await prisma.bidQuote.findUniqueOrThrow({ where: { id: filed.id } });
    expect(edited.amount?.toString()).toBe("81000");
    // Editing does not re-file it: it still says it came in with A's invitation.
    expect(edited.bidInvitationId).toBe(a.id);

    // A quote filed from B's row is A's too.
    const fromB = await fileQuote(b.id, "Metal stud framing", "Beta Supply", { amount: "84000", quotedOn: "2026-10-22" });
    expect(fromB.bidProjectId).toBe(a.projectId);
    expect((await quotesShownTo({ id: a.id, projectId: a.projectId })).map((row) => row.id).sort()).toEqual([filed.id, fromB.id].sort());

    // ONE CARRIED PER PACKAGE PER PROJECT: carrying B-filed Beta clears A-filed Alpha.
    expect(await estimating.setBidQuoteCarried(filed.id, form({ carried: "true" }))).toEqual({ ok: true });
    expect(await estimating.setBidQuoteCarried(fromB.id, form({ carried: "true" }))).toEqual({ ok: true });
    const carried = await prisma.bidQuote.findMany({ where: { id: { in: [filed.id, fromB.id] } } });
    expect(carried.filter((row) => row.carriedAt !== null).map((row) => row.vendorName)).toEqual(["Beta Supply"]);
  });

  it("a carried quote filed under GC B reaches the job linked through GC A, and so does an addendum that changed priced work", async () => {
    const a = await invite("acme", "Job Side Hospital");
    const b = await invite("buildco", "Job Side Hospital (BuildCo)", a.projectId);
    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);
    const jobId = started.value.jobId;
    // The job is linked through A's invitation only (wonJobId), as it always was.
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: b.id } })).wonJobId).toBeNull();

    const qb = await fileQuote(b.id, "Hang and finish", "Gamma Drywall", { amount: "50000", quotedOn: "2026-10-20" });
    expect(await estimating.setBidQuoteCarried(qb.id, form({ carried: "true" }))).toEqual({ ok: true });
    const inputs = await loadCrossCheckInputs(jobId, companyId);
    expect(inputs.carried.map((c) => c.vendorName)).toEqual(["Gamma Drywall"]);

    await fileAddendum(b.id, "Addendum 7", { affectsPricedScope: "on" });
    const currency = await loadTakeoffCurrency(companyId, jobId);
    expect(currency.undated).toContain("Addendum 7");

    // And "Add to estimate" from B's quote lands on the PROJECT's estimate.
    expect(await estimating.addCarriedQuoteToEstimate(qb.id)).toEqual({ ok: true });
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false, costCategory: "SUBCONTRACTOR" } })).toBe(1);

    // Company scoping holds: another company asking for this job's papers gets none.
    expect((await loadCrossCheckInputs(jobId, otherCompanyId)).carried).toEqual([]);
    expect((await loadTakeoffCurrency(otherCompanyId, jobId)).undated).toEqual([]);
  });

  // ── what stays per GC: the acknowledgement ───────────────────────────────

  it("an addendum is the project's but each GC acknowledges it on its own bid form", async () => {
    const a = await invite("acme", "Ack Hospital");
    const b = await invite("buildco", "Ack Hospital (BuildCo)", a.projectId);
    const addendum = await fileAddendum(a.id, "Addendum 3");
    expect(addendum.bidProjectId).toBe(a.projectId);

    const ackOn = (rows: Awaited<ReturnType<typeof addendaShownTo>>, inv: string) => {
      const row = rows.find((r) => r.id === addendum.id)!;
      return papers.acknowledgedOnFor(row, inv)?.toISOString().slice(0, 10) ?? null;
    };
    const reads = async () => ({ a: await addendaShownTo({ id: a.id, projectId: a.projectId }), b: await addendaShownTo({ id: b.id, projectId: b.projectId }) });

    // Both rows show it; neither has acknowledged.
    let rows = await reads();
    expect([ackOn(rows.a, a.id), ackOn(rows.b, b.id)]).toEqual([null, null]);

    // B acknowledges from B's row: a row for B, A's column untouched.
    expect(await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-23", bidInvitationId: b.id }))).toEqual({ ok: true });
    rows = await reads();
    expect([ackOn(rows.a, a.id), ackOn(rows.b, b.id)]).toEqual([null, "2026-10-23"]);
    expect((await prisma.bidAddendum.findUniqueOrThrow({ where: { id: addendum.id } })).acknowledgedOn).toBeNull();

    // A acknowledges: the filing invitation's lives in the column, as it always did.
    expect(await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-24", bidInvitationId: a.id }))).toEqual({ ok: true });
    // And a request from a page that predates this (no invitation named) means the filing one.
    expect(await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-25" }))).toEqual({ ok: true });
    rows = await reads();
    expect([ackOn(rows.a, a.id), ackOn(rows.b, b.id)]).toEqual(["2026-10-25", "2026-10-23"]);

    // Un-acknowledging on B clears B's row only.
    expect(await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "", bidInvitationId: b.id }))).toEqual({ ok: true });
    rows = await reads();
    expect([ackOn(rows.a, a.id), ackOn(rows.b, b.id)]).toEqual(["2026-10-25", null]);
    expect(await prisma.bidAddendumAcknowledgement.count({ where: { bidAddendumId: addendum.id } })).toBe(0);

    // Saving the addendum's form from B's row writes B's acknowledgement, not A's.
    expect(
      await estimating.saveBidAddendum(b.id, form({ addendumId: addendum.id, reference: "Addendum 3", acknowledgedOn: "2026-10-26" })),
    ).toEqual({ ok: true });
    rows = await reads();
    expect([ackOn(rows.a, a.id), ackOn(rows.b, b.id)]).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("refuses an acknowledgement for an invitation that is not on the addendum's project, or not this company's", async () => {
    const a = await invite("acme", "Ack Scope Hospital");
    const elsewhere = await invite("turner", "Ack Scope Elsewhere");
    const addendum = await fileAddendum(a.id, "Addendum 1");
    const foreign = await prisma.bidInvitation.create({ data: { companyId: otherCompanyId, contactId: otherContactId, projectName: `Theirs ${tag}` } });

    const wrongProject = await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-23", bidInvitationId: elsewhere.id }));
    expect(wrongProject.ok).toBe(false);
    const wrongCompany = await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-23", bidInvitationId: foreign.id }));
    expect(wrongCompany.ok).toBe(false);
    expect(await prisma.bidAddendumAcknowledgement.count({ where: { bidAddendumId: addendum.id } })).toBe(0);
    expect((await prisma.bidAddendum.findUniqueOrThrow({ where: { id: addendum.id } })).acknowledgedOn).toBeNull();

    // Another company's addendum and quote ids are "gone", not editable.
    const theirs = await prisma.bidAddendum.create({ data: { companyId: otherCompanyId, bidInvitationId: foreign.id, reference: "Theirs 1" } });
    expect((await estimating.acknowledgeBidAddendum(theirs.id, form({ acknowledgedOn: "2026-10-23" }))).ok).toBe(false);
    const theirQuote = await prisma.bidQuote.create({ data: { companyId: otherCompanyId, bidInvitationId: foreign.id, packageLabel: "X", vendorName: "Y" } });
    const edit = await estimating.saveBidQuote(a.id, quote("X", "Y", { bidQuoteId: theirQuote.id }));
    expect(edit.ok).toBe(false);
    expect(await quotesShownTo({ id: a.id, projectId: a.projectId })).toEqual([]);
  });

  it("spec sections are filed with the project and read by every GC on it", async () => {
    const a = await invite("acme", "Spec Hospital");
    const b = await invite("buildco", "Spec Hospital (BuildCo)", a.projectId);
    expect(await saveBidSpecSection(b.id, form({ sectionNumber: "09 21 16" }))).toEqual({ ok: true });
    const section = await prisma.bidSpecSection.findFirstOrThrow({ where: { bidInvitationId: b.id } });
    expect(section.bidProjectId).toBe(a.projectId);
    expect((await sectionsShownTo({ id: a.id, projectId: a.projectId })).map((row) => row.id)).toEqual([section.id]);
  });

  // ── merge: the papers follow into the surviving project ──────────────────

  it("merging two projects carries every paper into the survivor, and heals a paper written without a project", async () => {
    const a = await invite("acme", "Merge Hospital");
    const b = await invite("buildco", "Merge Annex");
    const qa = await fileQuote(a.id, "Framing", "Alpha", { amount: "1000", quotedOn: "2026-10-20" });
    const qb = await fileQuote(b.id, "Framing", "Beta", { amount: "1100", quotedOn: "2026-10-20" });
    const adb = await fileAddendum(b.id, "Addendum 1", { acknowledgedOn: "2026-10-22" });
    expect(await saveBidSpecSection(b.id, form({ sectionNumber: "09 22 16" }))).toEqual({ ok: true });
    // A paper a build that predates the column wrote: no project.
    const old = await prisma.bidQuote.create({ data: { companyId, bidInvitationId: b.id, packageLabel: "EIFS", vendorName: "Old" } });

    // Before the merge each GC sees only its own project's papers.
    expect((await quotesShownTo({ id: a.id, projectId: a.projectId })).map((r) => r.id)).toEqual([qa.id]);

    const merged = await core.mergeBidProjects(companyId, b.projectId, a.projectId);
    expect(merged.ok).toBe(true);

    for (const inv of [a, b]) {
      const shown = await quotesShownTo({ id: inv.id, projectId: a.projectId });
      expect(shown.map((r) => r.id).sort()).toEqual([qa.id, qb.id, old.id].sort());
      expect((await addendaShownTo({ id: inv.id, projectId: a.projectId })).map((r) => r.id)).toEqual([adb.id]);
      expect(await sectionsShownTo({ id: inv.id, projectId: a.projectId })).toHaveLength(1);
    }
    // Everything now names the survivor, including the paper that had no project.
    expect((await prisma.bidQuote.findMany({ where: { id: { in: [qa.id, qb.id, old.id] } } })).every((r) => r.bidProjectId === a.projectId)).toBe(true);
    expect(await prisma.bidProject.findUnique({ where: { id: b.projectId } })).toBeNull();

    // The addendum was acknowledged on B's form (filed under B); on A's it is not.
    const rows = await addendaShownTo({ id: a.id, projectId: a.projectId });
    expect(papers.acknowledgedOnFor(rows[0]!, b.id)?.toISOString().slice(0, 10)).toBe("2026-10-22");
    expect(papers.acknowledgedOnFor(rows[0]!, a.id)).toBeNull();
  });

  // ── split: papers stay with the project ──────────────────────────────────

  it("splitting a GC out leaves the papers with the project, re-files what was filed under it, and keeps its acknowledgement", async () => {
    const a = await invite("acme", "Split Hospital");
    const b = await invite("buildco", "Split Hospital (BuildCo)", a.projectId);
    const c = await invite("turner", "Split Hospital (Turner)", a.projectId);

    const underA = await fileQuote(a.id, "Framing", "Under A", { amount: "1000", quotedOn: "2026-10-20" });
    const underC = await fileQuote(c.id, "Framing", "Under C", { amount: "1200", quotedOn: "2026-10-20" });
    const addendumC = await fileAddendum(c.id, "Addendum 9", { acknowledgedOn: "2026-10-21" });
    expect(await estimating.acknowledgeBidAddendum(addendumC.id, form({ acknowledgedOn: "2026-10-27", bidInvitationId: a.id }))).toEqual({ ok: true });
    expect(await saveBidSpecSection(c.id, form({ sectionNumber: "09 29 00" }))).toEqual({ ok: true });
    // A reading of that addendum is filed with its parent.
    const reading = await prisma.bidAddendumReading.create({
      data: { bidAddendumId: addendumC.id, bidInvitationId: c.id, items: [], readingReason: "t", pagesCharged: 1, model: "m", promptVersion: "p" },
    });

    const split = await core.splitBidInvitation(companyId, c.id);
    if (!split.ok) throw new Error(split.error);
    const cProject = split.value.bidProjectId;
    expect(cProject).not.toBe(a.projectId);

    // The papers stayed with the project A and B are on…
    for (const inv of [a, b]) {
      expect((await quotesShownTo({ id: inv.id, projectId: a.projectId })).map((r) => r.id).sort()).toEqual([underA.id, underC.id].sort());
      expect((await addendaShownTo({ id: inv.id, projectId: a.projectId })).map((r) => r.id)).toEqual([addendumC.id]);
      expect(await sectionsShownTo({ id: inv.id, projectId: a.projectId })).toHaveLength(1);
    }
    // …and the split-off GC keeps only what is its own: none of them.
    expect(await quotesShownTo({ id: c.id, projectId: cProject })).toEqual([]);
    expect(await addendaShownTo({ id: c.id, projectId: cProject })).toEqual([]);
    expect(await sectionsShownTo({ id: c.id, projectId: cProject })).toEqual([]);

    // What was filed under C moved to a sibling that stayed (the oldest: A), so
    // the INVARIANT holds: a paper's project is its filing invitation's project.
    const moved = await prisma.bidQuote.findUniqueOrThrow({ where: { id: underC.id } });
    expect([moved.bidInvitationId, moved.bidProjectId]).toEqual([a.id, a.projectId]);
    const readingAfter = await prisma.bidAddendumReading.findUniqueOrThrow({ where: { id: reading.id } });
    expect(readingAfter.bidInvitationId).toBe(a.id);

    // Acknowledgements: A had acknowledged on its own form (a row) and that is
    // promoted to the column now that A is the filing invitation; C's own is kept
    // as a row so it is not lost.
    const stored = await prisma.bidAddendum.findUniqueOrThrow({ where: { id: addendumC.id }, include: { acknowledgements: true } });
    expect(stored.bidInvitationId).toBe(a.id);
    expect(stored.acknowledgedOn?.toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(stored.acknowledgements.map((r) => [r.bidInvitationId, r.acknowledgedOn.toISOString().slice(0, 10)])).toEqual([[c.id, "2026-10-21"]]);

    // Merge C back in: everything is shared again and C's acknowledgement returns.
    expect((await core.mergeBidProjects(companyId, cProject, a.projectId)).ok).toBe(true);
    const rows = await addendaShownTo({ id: c.id, projectId: a.projectId });
    expect(papers.acknowledgedOnFor(rows[0]!, c.id)?.toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(papers.acknowledgedOnFor(rows[0]!, a.id)?.toISOString().slice(0, 10)).toBe("2026-10-27");
  });

  // ── delete: a sibling's paper is not lost with an invitation ─────────────

  it("deleting the invitation a quote was filed under keeps it for the project's other GCs; a sole invitation takes its papers with it", async () => {
    const a = await invite("acme", "Delete Hospital");
    const b = await invite("buildco", "Delete Hospital (BuildCo)", a.projectId);
    const filed = await fileQuote(a.id, "Framing", "Alpha", { amount: "1000", quotedOn: "2026-10-20" });
    const addendum = await fileAddendum(a.id, "Addendum 2", { acknowledgedOn: "2026-10-20" });
    // B had acknowledged it on its own form; that must become B's column value.
    expect(await estimating.acknowledgeBidAddendum(addendum.id, form({ acknowledgedOn: "2026-10-28", bidInvitationId: b.id }))).toEqual({ ok: true });

    await estimating.deleteBidInvitation(a.id);

    expect(await prisma.bidInvitation.findUnique({ where: { id: a.id } })).toBeNull();
    const q = await prisma.bidQuote.findUnique({ where: { id: filed.id } });
    expect(q).not.toBeNull();
    expect([q!.bidInvitationId, q!.bidProjectId]).toEqual([b.id, a.projectId]);
    expect((await quotesShownTo({ id: b.id, projectId: a.projectId })).map((r) => r.id)).toEqual([filed.id]);
    const ad = await prisma.bidAddendum.findUniqueOrThrow({ where: { id: addendum.id }, include: { acknowledgements: true } });
    expect(ad.bidInvitationId).toBe(b.id);
    expect(ad.acknowledgedOn?.toISOString().slice(0, 10)).toBe("2026-10-28");
    expect(ad.acknowledgements).toEqual([]);

    // The project's ONLY invitation: nothing has anywhere to go, so they go with it.
    await estimating.deleteBidInvitation(b.id);
    expect(await prisma.bidQuote.findUnique({ where: { id: filed.id } })).toBeNull();
    expect(await prisma.bidAddendum.findUnique({ where: { id: addendum.id } })).toBeNull();
  });
});
