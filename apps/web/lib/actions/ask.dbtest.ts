import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The claim, against a real Postgres.
 *
 * Everything else about a proposal is pinned by unit tests with a fake.
 * What only a database can prove is the property the row exists for: two
 * confirms racing on one card produce one job and one "already done",
 * because `updateMany where claimedAt IS NULL` is atomic in Postgres and
 * not in a fake. Also proven here: somebody else's card is not yours, and
 * an expired card is refused before anything is claimed.
 */
const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { confirmAskProposal, cancelAskProposal } = await import("./ask");
const { linkToken } = await import("@/lib/tokens");

let companyId = "";
let ownerId = "";
let otherUserId = "";
let contactId = "";
const proposalIds: string[] = [];

async function proposal(overrides: { createdByUserId?: string; expiresAt?: Date; jobName?: string } = {}) {
  const id = linkToken();
  proposalIds.push(id);
  const jobName = overrides.jobName ?? `ASK-DBTEST ${id.slice(0, 8)}`;
  await prisma.askProposal.create({
    data: {
      id,
      companyId,
      createdByUserId: overrides.createdByUserId ?? ownerId,
      command: "create_estimate_job",
      mode: "DIRECT",
      question: `create an estimate for ${jobName}`,
      input: { jobName, gcName: "Turner" },
      resolved: {
        jobName,
        scope: null,
        contact: { id: contactId, name: "ASK-DBTEST Turner" },
        draftLines: false,
      },
      preview: [{ label: "Job", value: jobName }],
      model: "test",
      toolUseId: "tu_test",
      toolUseIdsInContext: [],
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000),
    },
  });
  return { id, jobName };
}

describe("confirmAskProposal against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "ASK-DBTEST Co" } });
    companyId = company.id;
    context.company.id = companyId;
    const owner = await prisma.user.create({
      data: {
        companyId,
        clerkId: `ask_o_${Date.now()}`,
        email: `ask_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    ownerId = owner.id;
    context.id = ownerId;
    const other = await prisma.user.create({
      data: {
        companyId,
        clerkId: `ask_m_${Date.now()}`,
        email: `ask_m_${Date.now()}@example.test`,
        role: "MEMBER",
      },
    });
    otherUserId = other.id;
    const contact = await prisma.contact.create({ data: { companyId, name: "ASK-DBTEST Turner" } });
    contactId = contact.id;
  });

  afterAll(async () => {
    await prisma.dailyFieldReport.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.askProposal.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("two concurrent confirms of one card create ONE job and refuse the other", async () => {
    const { id, jobName } = await proposal();

    const [first, second] = await Promise.all([confirmAskProposal(id), confirmAskProposal(id)]);
    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const refused = outcomes.find((r) => !r.ok);
    expect(refused && !refused.ok ? refused.error : "").toMatch(/already done/i);

    const jobs = await prisma.job.findMany({ where: { companyId, name: jobName } });
    expect(jobs).toHaveLength(1);

    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.claimedAt).not.toBeNull();
    expect(row.outcome).toBe("OK");
    expect(row.targetType).toBe("Job");
    expect(row.targetId).toBe(jobs[0].id);
  });

  it("refuses a second, sequential confirm of the same card without a second job", async () => {
    const { id, jobName } = await proposal();
    const first = await confirmAskProposal(id);
    expect(first.ok).toBe(true);
    const again = await confirmAskProposal(id);
    expect(again.ok).toBe(false);
    expect(await prisma.job.count({ where: { companyId, name: jobName } })).toBe(1);
  });

  it("refuses somebody else's card, and leaves it unclaimed", async () => {
    const { id, jobName } = await proposal({ createdByUserId: otherUserId });
    const result = await confirmAskProposal(id);
    expect(result.ok).toBe(false);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.claimedAt).toBeNull();
    expect(row.outcome).toBeNull();
    expect(await prisma.job.count({ where: { companyId, name: jobName } })).toBe(0);
  });

  it("refuses an expired card before claiming it", async () => {
    const { id, jobName } = await proposal({ expiresAt: new Date(Date.now() - 60_000) });
    const result = await confirmAskProposal(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.claimedAt).toBeNull();
    expect(await prisma.job.count({ where: { companyId, name: jobName } })).toBe(0);
  });

  it("a cancelled card cannot be confirmed afterwards", async () => {
    const { id, jobName } = await proposal();
    expect((await cancelAskProposal(id)).ok).toBe(true);
    const result = await confirmAskProposal(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cancelled/i);
    expect(await prisma.job.count({ where: { companyId, name: jobName } })).toBe(0);
  });

  it("a field-report card executes Cyrus's action in-process, and the action's own guard refuses the second", async () => {
    // Phase 2: the command builds the FormData the form would have posted
    // and calls createDailyFieldReport itself. This is the first place that
    // call is executed against a real database rather than reasoned about.
    const job = await prisma.job.create({
      data: { companyId, contactId, name: `ASK-DBTEST field ${Date.now()}` },
    });
    const card = async () => {
      const id = linkToken();
      proposalIds.push(id);
      await prisma.askProposal.create({
        data: {
          id,
          companyId,
          createdByUserId: ownerId,
          command: "log_daily_field_report",
          mode: "DIRECT",
          question: "log today's report",
          input: { jobName: job.name, workPerformed: "hung board" },
          resolved: {
            jobId: job.id,
            jobName: job.name,
            reportDate: "2026-09-08",
            workPerformed: "hung board on level 2",
            crewPresent: "crew of 6",
            weather: null,
            delays: null,
          },
          preview: [],
          model: "test",
          toolUseId: "tu_test",
          toolUseIdsInContext: [],
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      return id;
    };

    const first = await confirmAskProposal(await card());
    expect(first.ok).toBe(true);
    const reports = await prisma.dailyFieldReport.findMany({ where: { jobId: job.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0].workPerformed).toBe("hung board on level 2");
    expect(reports[0].filedByUserId).toBe(ownerId);
    expect(reports[0].reportDate.toISOString()).toBe("2026-09-08T00:00:00.000Z");

    // A second card for the same day: the unique constraint inside the
    // action refuses, and its sentence is what the tap returns.
    const second = await confirmAskProposal(await card());
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already exists for that date/);
    expect(await prisma.dailyFieldReport.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("a card whose natural key already matches a job links to it rather than making a twin", async () => {
    const { id, jobName } = await proposal();
    expect((await confirmAskProposal(id)).ok).toBe(true);
    const twin = await proposal({ jobName: jobName.toUpperCase() });
    const result = await confirmAskProposal(twin.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toMatch(/already exists/i);
    expect(await prisma.job.count({ where: { companyId, name: { equals: jobName, mode: "insensitive" } } })).toBe(1);
  });
});
