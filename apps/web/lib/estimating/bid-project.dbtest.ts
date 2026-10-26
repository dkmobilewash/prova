import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@prova/db";

/**
 * One project, many GC invitations, one estimate — against a real Postgres.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it (CI has no
 * database). Run it against a SCRATCH database, exactly as
 * vitest.db.config.mts documents. The guards that matter here are guards about
 * ROWS — an estimate that must stay singular under a race, a merge that must
 * not drop one of two estimates, a unique link that must move rather than
 * collide — and none can be checked by reading a return value.
 *
 * Only the auth boundary, revalidatePath, redirect and the post-response agent
 * are faked. The core, the actions, Prisma, the transactions and the schema
 * (including the migration's own backfill SQL) are real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: () => {} }));

const core = await import("./bid-project");
const { createBidInvitationRecord } = await import("./bid-invitation");
const actions = await import("@/lib/actions/bidProjects");
const { updateBidInvitationStatus, linkBidToJob } = await import("@/lib/actions/estimating");
const { loadBidPipeline } = await import("@/lib/bid-pipeline-query");
const { gcHistory } = await import("@/lib/agents/bidHistory");
const { JOB_FUNCTIONS } = await import("@/lib/permissions");

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../../packages/db/prisma/schema/migrations/20261025120000_add_bid_project/migration.sql", import.meta.url)),
  "utf8",
);

const tag = `bp_${Date.now()}`;
let companyId = "";
let otherCompanyId = "";
const contact: Record<string, string> = {};
let otherContactId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** A fresh invitation on a fresh project, via the real shared create path. */
async function invite(gc: string, projectName: string, extra: { dueDate?: Date; bidProjectId?: string } = {}) {
  const result = await createBidInvitationRecord(companyId, {
    contactId: contact[gc],
    projectName: `${projectName} ${tag}`,
    dueDate: extra.dueDate ?? null,
    bidProjectId: extra.bidProjectId ?? null,
  });
  if (!result.ok) throw new Error(result.error);
  const row = await prisma.bidInvitation.findUniqueOrThrow({ where: { id: result.value.bidInvitationId } });
  return { id: row.id, projectId: row.bidProjectId! };
}

const projectOf = (id: string) => prisma.bidProject.findUniqueOrThrow({ where: { id } });
const invitationsOn = (projectId: string) => prisma.bidInvitation.findMany({ where: { bidProjectId: projectId }, orderBy: { createdAt: "asc" } });

describe("bid projects against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Bid Project Co ${tag}` } });
    companyId = company.id;
    context.company.id = company.id;
    const other = await prisma.company.create({ data: { name: `Bid Project Other ${tag}` } });
    otherCompanyId = other.id;
    for (const name of ["acme", "buildco", "turner", "ratecorp"]) {
      contact[name] = (await prisma.contact.create({ data: { companyId, name: `${name} ${tag}` } })).id;
    }
    otherContactId = (await prisma.contact.create({ data: { companyId: otherCompanyId, name: `their GC ${tag}` } })).id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      await prisma.bidPursuit.deleteMany({ where: { companyId: id } });
      await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
      await prisma.bidProject.deleteMany({ where: { companyId: id } });
      await prisma.jobLineItem.deleteMany({ where: { job: { companyId: id } } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  // ── the migration's backfill, executed ───────────────────────────────────

  it("the migration's backfill makes one project per invitation, never merging, and carries the estimate link", async () => {
    // Pre-migration shape: invitations with no project. Two GCs naming the same
    // building DIFFERENTLY — the migration must not guess they are one job.
    const job = await prisma.job.create({ data: { companyId, contactId: contact.acme, name: `Backfill job ${tag}` } });
    const a = await prisma.bidInvitation.create({
      data: { companyId, contactId: contact.acme, projectName: `Westside Medical Office ${tag}`, dueDate: new Date("2026-11-01T00:00:00Z"), tradeScope: "EIFS", wonJobId: job.id },
    });
    const b = await prisma.bidInvitation.create({
      data: { companyId, contactId: contact.buildco, projectName: `Westside MOB ${tag}`, dueDate: new Date("2026-11-03T00:00:00Z") },
    });
    const c = await prisma.bidInvitation.create({ data: { companyId, contactId: contact.turner, projectName: `Harbor Lofts ${tag}` } });
    await prisma.bidPursuit.create({
      data: { companyId, projectName: `Harbor Lofts ${tag}`, owner: "Harbor LLC", architect: "Studio Q", estimatedValue: "1250000.00", bidInvitationId: c.id },
    });
    const ids = [a.id, b.id, c.id];
    const before = {
      invitations: await prisma.bidInvitation.count({ where: { id: { in: ids } } }),
      projects: await prisma.bidProject.count({ where: { companyId } }),
      withoutProject: await prisma.bidInvitation.count({ where: { id: { in: ids }, bidProjectId: null } }),
    };
    expect(before.withoutProject).toBe(3);

    // The backfill is the part of the migration after its marker comment; run
    // exactly that text, in one transaction like Prisma does.
    const marker = "-- Backfill: ONE PROJECT PER EXISTING INVITATION.";
    expect(migrationSql).toContain(marker);
    const backfill = migrationSql.slice(migrationSql.indexOf(marker));
    const statements = backfill.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    await prisma.$transaction(statements.map((sql) => prisma.$executeRawUnsafe(sql)));

    const after = {
      invitations: await prisma.bidInvitation.count({ where: { id: { in: ids } } }),
      projectsForThese: await prisma.bidProject.count({ where: { companyId, invitations: { some: { id: { in: ids } } } } }),
      withoutProject: await prisma.bidInvitation.count({ where: { id: { in: ids }, bidProjectId: null } }),
    };
    expect(after).toEqual({ invitations: 3, projectsForThese: 3, withoutProject: 0 });
    const rows = await prisma.bidInvitation.findMany({ where: { id: { in: ids } }, include: { bidProject: true } });
    expect(new Set(rows.map((r) => r.bidProjectId)).size).toBe(3); // never merged
    const ra = rows.find((r) => r.id === a.id)!;
    expect(ra.bidProject).toMatchObject({ name: `Westside Medical Office ${tag}`, estimateJobId: job.id, tradeScope: "EIFS" });
    expect(ra.bidProject!.bidDueDate!.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(ra.projectName).toBe(`Westside Medical Office ${tag}`); // the GC's own name is untouched
    expect(ra.wonJobId).toBe(job.id); // and the old link still works
    expect(rows.find((r) => r.id === b.id)!.bidProject!.estimateJobId).toBeNull();
    expect(rows.find((r) => r.id === c.id)!.bidProject).toMatchObject({ owner: "Harbor LLC", architect: "Studio Q" });
    expect(rows.every((r) => r.origin === "INVITED")).toBe(true);

    // Running it again is a no-op: nothing is left without a project to give one to.
    const projectsBefore = await prisma.bidProject.count();
    await prisma.$transaction(statements.map((sql) => prisma.$executeRawUnsafe(sql)));
    expect(await prisma.bidProject.count()).toBe(projectsBefore);
  });

  // ── creating ─────────────────────────────────────────────────────────────

  it("a new invitation always gets a project, or joins the one it is told to", async () => {
    const first = await invite("acme", "Hospital Wing");
    const project = await projectOf(first.projectId);
    expect(project).toMatchObject({ companyId, name: `Hospital Wing ${tag}`, estimateJobId: null });

    const second = await invite("buildco", "Hospital Wing (BuildCo's name)", { bidProjectId: first.projectId });
    expect(second.projectId).toBe(first.projectId);
    // Each invitation keeps what ITS GC called the job.
    expect((await invitationsOn(first.projectId)).map((i) => i.projectName)).toEqual([
      `Hospital Wing ${tag}`,
      `Hospital Wing (BuildCo's name) ${tag}`,
    ]);

    const foreign = await prisma.bidProject.create({ data: { companyId: otherCompanyId, name: "Not ours" } });
    const refused = await createBidInvitationRecord(companyId, { contactId: contact.acme, projectName: `x ${tag}`, bidProjectId: foreign.id });
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("no longer on this company") });
    expect(await prisma.bidInvitation.count({ where: { companyId, projectName: `x ${tag}` } })).toBe(0);
  });

  // ── merge ────────────────────────────────────────────────────────────────

  it("merge folds two projects into one: invitations move, blanks fill from the source, the source is gone", async () => {
    const a = await invite("acme", "Merge Tower");
    const b = await invite("buildco", "Merge Tower B");
    await prisma.bidProject.update({ where: { id: b.projectId }, data: { siteAddress: "1 Main St", owner: "Owner LLC" } });
    await prisma.bidProject.update({ where: { id: a.projectId }, data: { owner: "Kept Owner" } });

    const result = await core.mergeBidProjects(companyId, b.projectId, a.projectId);
    expect(result).toEqual({ ok: true, value: { bidProjectId: a.projectId, moved: 1 } });

    expect((await invitationsOn(a.projectId)).map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(await prisma.bidProject.findUnique({ where: { id: b.projectId } })).toBeNull();
    const merged = await projectOf(a.projectId);
    expect(merged.siteAddress).toBe("1 Main St"); // filled from the source
    expect(merged.owner).toBe("Kept Owner"); // never overwritten
    expect(merged.name).toBe(`Merge Tower ${tag}`);
  });

  it("merge carries the estimate across when only one side has one, and refuses when both do", async () => {
    const a = await invite("acme", "Est Merge A");
    const b = await invite("buildco", "Est Merge B");
    const c = await invite("turner", "Est Merge C");
    const started = await core.startEstimateFromProject(companyId, b.projectId);
    if (!started.ok) throw new Error(started.error);

    expect((await core.mergeBidProjects(companyId, b.projectId, a.projectId)).ok).toBe(true);
    expect((await projectOf(a.projectId)).estimateJobId).toBe(started.value.jobId);

    const started2 = await core.startEstimateFromProject(companyId, c.projectId);
    if (!started2.ok) throw new Error(started2.error);
    const refused = await core.mergeBidProjects(companyId, c.projectId, a.projectId);
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("Both have an estimate") });
    // Nothing was dropped or moved.
    expect((await projectOf(c.projectId)).estimateJobId).toBe(started2.value.jobId);
    expect((await projectOf(a.projectId)).estimateJobId).toBe(started.value.jobId);
    expect(await invitationsOn(c.projectId)).toHaveLength(1);
  });

  it("merge refuses a project from another company, and the action refuses without the capability", async () => {
    const a = await invite("acme", "Cross Co");
    const foreign = await prisma.bidProject.create({ data: { companyId: otherCompanyId, name: "Elsewhere" } });
    expect((await core.mergeBidProjects(companyId, a.projectId, foreign.id)).ok).toBe(false);
    expect((await core.mergeBidProjects(companyId, foreign.id, a.projectId)).ok).toBe(false);
    expect(await prisma.bidProject.findUnique({ where: { id: foreign.id } })).not.toBeNull();

    const b = await invite("buildco", "Cross Co B");
    const { can } = await import("@/lib/permissions");
    const restricted = JOB_FUNCTIONS.find((f) => !can({ role: "MEMBER", jobFunction: f }, "MANAGE_ESTIMATING"));
    expect(restricted, "some job function lacks MANAGE_ESTIMATING").toBeDefined();
    context.role = "MEMBER";
    context.jobFunction = restricted!;
    try {
      const denied = await actions.mergeIntoProject(b.projectId, form({ intoProjectId: a.projectId }));
      expect(denied).toEqual({ ok: false, error: expect.stringContaining("Estimating isn't part of your job function") });
      expect(await invitationsOn(b.projectId)).toHaveLength(1);
    } finally {
      context.role = "OWNER";
      context.jobFunction = null;
    }
    const merged = await actions.mergeIntoProject(b.projectId, form({ intoProjectId: a.projectId }));
    expect(merged).toEqual({ ok: true });
    expect(await invitationsOn(a.projectId)).toHaveLength(2);
  });

  // ── split ────────────────────────────────────────────────────────────────

  it("split gives one invitation a fresh project of its own and leaves its name alone", async () => {
    const a = await invite("acme", "Split Plaza", { dueDate: new Date("2026-12-01T00:00:00Z") });
    const b = await invite("buildco", "Split Plaza B", { bidProjectId: a.projectId });
    await prisma.bidProject.update({ where: { id: a.projectId }, data: { siteAddress: "9 Elm" } });

    const result = await core.splitBidInvitation(companyId, b.id);
    expect(result.ok).toBe(true);
    const row = await prisma.bidInvitation.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.bidProjectId).not.toBe(a.projectId);
    expect(row.projectName).toBe(`Split Plaza B ${tag}`);
    const fresh = await projectOf(row.bidProjectId!);
    expect(fresh).toMatchObject({ name: `Split Plaza B ${tag}`, siteAddress: null, estimateJobId: null });
    expect(await invitationsOn(a.projectId)).toHaveLength(1);

    // Already alone: nothing to split from.
    expect(await core.splitBidInvitation(companyId, b.id)).toEqual({ ok: false, error: expect.stringContaining("already on a project of its own") });
  });

  it("split keeps a won bid with its estimate, and clears a non-won bid's link to it", async () => {
    const a = await invite("acme", "Split Won");
    const b = await invite("buildco", "Split Won B", { bidProjectId: a.projectId });
    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);
    // The estimate started as acme's (the first GC) and linked to acme's invitation.
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: a.id } })).wonJobId).toBe(started.value.jobId);

    // acme's bid is linked to the estimate and not won: it can leave, and the link goes with it.
    expect((await core.splitBidInvitation(companyId, a.id)).ok).toBe(true);
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: a.id } })).wonJobId).toBeNull();
    expect((await projectOf(b.projectId)).estimateJobId).toBe(started.value.jobId);

    // A GC recorded as the prime's winner cannot be split off the project it won.
    const c = await invite("turner", "Split Won C", { bidProjectId: b.projectId });
    await core.recordPrimeAward(companyId, b.projectId, { contactId: contact.turner });
    expect(await core.splitBidInvitation(companyId, c.id)).toEqual({ ok: false, error: expect.stringContaining("winning the prime") });
  });

  // ── start the estimate ───────────────────────────────────────────────────

  it("starting the estimate pre-fills name, location, date and the first GC, and links their bid", async () => {
    const a = await invite("buildco", "Prefill Center", { dueDate: new Date("2026-12-09T00:00:00Z") });
    const b = await invite("acme", "Prefill Center (Acme)", { bidProjectId: a.projectId, dueDate: new Date("2026-12-05T00:00:00Z") });
    await core.saveBidProjectDetails(companyId, a.projectId, { name: `Prefill Center ${tag}`, siteAddress: "100 Oak Ave", siteCity: "Portland" });

    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: started.value.jobId } });
    expect(job).toMatchObject({ name: `Prefill Center ${tag}`, contactId: contact.buildco, projectLocation: "100 Oak Ave, Portland", status: "ESTIMATE" });
    // The project's own date was blank, so the earliest invitation date is used.
    expect(job.bidDueDate!.toISOString().slice(0, 10)).toBe("2026-12-05");
    expect((await projectOf(a.projectId)).estimateJobId).toBe(job.id);
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: a.id } })).wonJobId).toBe(job.id);
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: b.id } })).wonJobId).toBeNull();

    expect(await core.startEstimateFromProject(companyId, a.projectId)).toEqual({ ok: false, error: expect.stringContaining("already has an estimate") });
  });

  it("two people pressing Start the estimate at once leave exactly one job", async () => {
    const a = await invite("acme", "Race Hall");
    const results = await Promise.all([core.startEstimateFromProject(companyId, a.projectId), core.startEstimateFromProject(companyId, a.projectId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("already has an estimate") });
    expect(await prisma.job.count({ where: { companyId, name: `Race Hall ${tag}` } })).toBe(1);
  });

  it("the action opens the new estimate's pricing step", async () => {
    const a = await invite("acme", "Redirect Row");
    await expect(actions.startEstimateFromProject(a.projectId)).rejects.toMatchObject({ to: expect.stringMatching(/^\/jobs\/new\/.+\/items$/) });
    expect((await projectOf(a.projectId)).estimateJobId).not.toBeNull();
  });

  // ── the award ────────────────────────────────────────────────────────────

  it("recording the prime award hands the estimate to the winner while it is still an estimate", async () => {
    const a = await invite("acme", "Award Court");
    const b = await invite("buildco", "Award Court B", { bidProjectId: a.projectId });
    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);

    const result = await core.recordPrimeAward(companyId, a.projectId, { contactId: contact.buildco, awardedOn: new Date("2026-12-20T00:00:00Z") });
    expect(result).toEqual({ ok: true, value: { estimateGcSwitched: true } });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: started.value.jobId } });
    expect(job.contactId).toBe(contact.buildco);
    // The job-side link moved with it, and is unique, so acme released it.
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: b.id } })).wonJobId).toBe(job.id);
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: a.id } })).wonJobId).toBeNull();
    expect(await projectOf(a.projectId)).toMatchObject({ primeAwardedContactId: contact.buildco });
  });

  it("does NOT switch the GC of a job that is already contracted", async () => {
    const a = await invite("acme", "Locked Lofts");
    await invite("buildco", "Locked Lofts B", { bidProjectId: a.projectId });
    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);
    await prisma.job.update({ where: { id: started.value.jobId }, data: { status: "CONTRACTED" } });

    const result = await core.recordPrimeAward(companyId, a.projectId, { contactId: contact.buildco });
    expect(result).toEqual({ ok: true, value: { estimateGcSwitched: false } });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: started.value.jobId } })).contactId).toBe(contact.acme);
  });

  it("marking an invitation WON makes that GC the prime and takes the estimate", async () => {
    const a = await invite("acme", "Won Works");
    const b = await invite("buildco", "Won Works B", { bidProjectId: a.projectId });
    const started = await core.startEstimateFromProject(companyId, a.projectId);
    if (!started.ok) throw new Error(started.error);

    expect(await updateBidInvitationStatus(b.id, form({ status: "WON", bidAmount: "100000" }))).toEqual({ ok: true });
    expect(await projectOf(a.projectId)).toMatchObject({ primeAwardedContactId: contact.buildco, primeAwardedOn: null });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: started.value.jobId } })).contactId).toBe(contact.buildco);
    expect((await prisma.bidInvitation.findUniqueOrThrow({ where: { id: b.id } })).wonJobId).toBe(started.value.jobId);
  });

  it("an award can be recorded by name for a GC not on file, refused for a foreign contact, and cleared", async () => {
    const a = await invite("acme", "Named Winner");
    expect(await core.recordPrimeAward(companyId, a.projectId, { name: "  Hensel Phelps " })).toMatchObject({ ok: true });
    expect(await projectOf(a.projectId)).toMatchObject({ primeAwardedName: "Hensel Phelps", primeAwardedContactId: null });

    expect(await core.recordPrimeAward(companyId, a.projectId, { contactId: otherContactId })).toEqual({
      ok: false,
      error: expect.stringContaining("isn't on your account"),
    });
    expect(await projectOf(a.projectId)).toMatchObject({ primeAwardedName: "Hensel Phelps" }); // untouched by the refusal

    expect(await actions.recordPrimeAward(a.projectId, form({ contactId: "", name: "", awardedOn: "" }))).toEqual({ ok: true });
    expect(await projectOf(a.projectId)).toMatchObject({ primeAwardedName: null, primeAwardedContactId: null, primeAwardedOn: null });
    expect(await actions.recordPrimeAward(a.projectId, form({ name: "X", awardedOn: "not-a-date" }))).toMatchObject({ ok: false });
  });

  it("linking a bid to a job also gives its project that estimate, unless it already has one", async () => {
    const a = await invite("acme", "Link Lane");
    const job = await prisma.job.create({ data: { companyId, contactId: contact.acme, name: `Link job ${tag}` } });
    expect(await linkBidToJob(a.id, form({ jobId: job.id }))).toEqual({ ok: true });
    expect((await projectOf(a.projectId)).estimateJobId).toBe(job.id);
    // A job that is already another project's estimate does not break the link.
    const b = await invite("buildco", "Link Lane B");
    expect(await linkBidToJob(b.id, form({ jobId: job.id }))).toMatchObject({ ok: false }); // claimed by the first bid: existing refusal
  });

  // ── win rate, against the real rows ──────────────────────────────────────

  it("a GC whose project the prime went elsewhere on is out of its win-rate denominator", async () => {
    const won = await invite("ratecorp", "Rate Won A");
    await updateBidInvitationStatus(won.id, form({ status: "WON" }));
    const lost = await invite("ratecorp", "Rate Lost B");
    await updateBidInvitationStatus(lost.id, form({ status: "LOST" }));
    const wentElsewhere = await invite("ratecorp", "Rate Other C");
    await updateBidInvitationStatus(wentElsewhere.id, form({ status: "LOST" }));

    const row = async () => (await loadBidPipeline(companyId, "2026-10-25")).rows.find((r) => r.contactId === contact.ratecorp)!.record;
    const history = async () => (await gcHistory(companyId, contact.ratecorp)).bids;

    // Before anyone says who won project C, it is two losses and one win.
    expect((await row()).winRate).toBeCloseTo(1 / 3);
    expect((await history()).winRate).toBeCloseTo(1 / 3);

    // Buildco won C's prime. The GC did not turn our price down on it.
    await core.recordPrimeAward(companyId, wentElsewhere.projectId, { contactId: contact.buildco });
    const after = await row();
    expect(after.winRate).toBeCloseTo(1 / 2);
    expect(after.lost).toBe(1);
    expect(after.primeElsewhere).toBe(1);
    expect((await history()).winRate).toBeCloseTo(1 / 2);
    expect((await history()).lost).toHaveLength(1);

    // Clearing the award puts it back: the exclusion is derived, not stored.
    await core.recordPrimeAward(companyId, wentElsewhere.projectId, {});
    expect((await row()).winRate).toBeCloseTo(1 / 3);

    // A live bid on a job that went elsewhere is not "outstanding": nobody
    // owes us an answer, so it must not be able to turn up as MISSED or COLD.
    const live = await invite("ratecorp", "Rate Live D");
    await updateBidInvitationStatus(live.id, form({ status: "SUBMITTED" }));
    const liveIds = async () => (await loadBidPipeline(companyId, "2026-10-25")).live.map((l) => l.id);
    expect(await liveIds()).toContain(live.id);
    await core.recordPrimeAward(companyId, live.projectId, { contactId: contact.buildco });
    expect(await liveIds()).not.toContain(live.id);
    expect((await row()).outstanding).toBe(0);
  });
});
