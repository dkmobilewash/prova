import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, type Prisma } from "@prova/db";

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
    await prisma.timeEntry.deleteMany({ where: { job: { companyId } } });
    await prisma.payment.deleteMany({ where: { invoice: { job: { companyId } } } });
    await prisma.invoice.deleteMany({ where: { job: { companyId } } });
    await prisma.invoiceCounter.deleteMany({ where: { job: { companyId } } });
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
  /** A DIRECT card for any command, with the server-held payload a
   * resolver would have written. Phase 3's cards are all made this way. */
  async function cardFor(command: string, resolved: Prisma.InputJsonObject) {
    const id = linkToken();
    proposalIds.push(id);
    await prisma.askProposal.create({
      data: {
        id,
        companyId,
        createdByUserId: ownerId,
        command,
        mode: "DIRECT",
        question: command,
        input: {},
        resolved,
        preview: [],
        model: "test",
        toolUseId: "tu_test",
        toolUseIdsInContext: [],
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return id;
  }

  it("an invoice card takes the counter's next number and snapshots retainage; an estimate is refused in the core's words", async () => {
    // Phase 3: the first money command, through the lifted core against a
    // real InvoiceCounter row (#224). Two cards, two numbers, one counter.
    const contracted = await prisma.job.create({
      data: { companyId, contactId, name: `ASK-DBTEST invoice ${Date.now()}`, status: "IN_PROGRESS", retainagePercent: "10" },
    });
    const card = () =>
      cardFor("draft_invoice", {
        jobId: contracted.id,
        jobName: contracted.name,
        amount: "45000.00",
        description: "September progress",
        dueAt: "2026-10-08",
      });
    const firstId = await card();
    const first = await confirmAskProposal(firstId);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.message).toContain("Invoice #1");
    const second = await confirmAskProposal(await card());
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.message).toContain("Invoice #2");

    const invoices = await prisma.invoice.findMany({ where: { jobId: contracted.id }, orderBy: { number: "asc" } });
    expect(invoices.map((i) => i.number)).toEqual([1, 2]);
    expect(Number(invoices[0].amount)).toBe(45000);
    expect(Number(invoices[0].retainageWithheld)).toBe(4500);
    expect(invoices[0].description).toBe("September progress");
    expect(invoices[0].dueAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    const counter = await prisma.invoiceCounter.findUniqueOrThrow({ where: { jobId: contracted.id } });
    expect(counter.lastNumber).toBe(2);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.outcome).toBe("OK");
    expect(row.targetType).toBe("Invoice");
    expect(row.targetId).toBe(invoices[0].id);

    // The core's own refusal, on a job that is still an estimate: no
    // invoice, no counter row, and the sentence stamped on the card.
    const estimate = await prisma.job.create({ data: { companyId, contactId, name: `ASK-DBTEST estimate ${Date.now()}` } });
    const refusedId = await cardFor("draft_invoice", {
      jobId: estimate.id,
      jobName: estimate.name,
      amount: "100.00",
      description: null,
      dueAt: null,
    });
    const refused = await confirmAskProposal(refusedId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/Contract this job before invoicing it/);
    expect(await prisma.invoice.count({ where: { jobId: estimate.id } })).toBe(0);
    expect(await prisma.invoiceCounter.count({ where: { jobId: estimate.id } })).toBe(0);
    const stamped = await prisma.askProposal.findUniqueOrThrow({ where: { id: refusedId } });
    expect(stamped.outcome).toBe("FAILED");
    expect(stamped.outcomeNote).toMatch(/Contract this job before invoicing it/);
  });

  it("a payment card runs logPayment in-process, and the action's own ceiling refuses the second", async () => {
    const job = await prisma.job.create({
      data: { companyId, contactId, name: `ASK-DBTEST payment ${Date.now()}`, status: "IN_PROGRESS" },
    });
    const invoice = await prisma.invoice.create({ data: { jobId: job.id, number: 1, amount: "45000.00" } });
    const card = (amount: string) =>
      cardFor("log_payment", {
        jobId: job.id,
        jobName: job.name,
        invoiceId: invoice.id,
        invoiceNumber: 1,
        amount,
        method: "check",
        note: "4471",
      });
    const firstId = await card("12500.00");
    const first = await confirmAskProposal(firstId);
    expect(first.ok).toBe(true);
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(12500);
    expect(payments[0].method).toBe("check");
    expect(payments[0].note).toBe("4471");
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.targetType).toBe("Payment");
    expect(row.targetId).toBe(payments[0].id);

    // $40,000 more on a $45,000 invoice with $12,500 paid: the action's
    // guard, not the resolver's (the resolver never saw this card).
    const second = await confirmAskProposal(await card("40000.00"));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/more than the .*45,000.* invoice total/);
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("an hours card runs logTimeEntry in-process with the form's own field names", async () => {
    const job = await prisma.job.create({
      data: { companyId, contactId, name: `ASK-DBTEST hours ${Date.now()}`, status: "IN_PROGRESS" },
    });
    const id = await cardFor("log_time_entry", {
      jobId: job.id,
      jobName: job.name,
      employeeUserId: ownerId,
      employeeName: "Owner",
      date: "2026-09-08",
      hours: "8",
      payType: "OVERTIME",
      note: null,
    });
    const result = await confirmAskProposal(id);
    expect(result.ok).toBe(true);
    const entries = await prisma.timeEntry.findMany({ where: { jobId: job.id } });
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].hours)).toBe(8);
    expect(entries[0].payType).toBe("OVERTIME");
    expect(entries[0].employeeUserId).toBe(ownerId);
    expect(entries[0].date.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(entries[0].lineItemId).toBeNull();
    expect(entries[0].craftClassificationId).toBeNull();
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id } });
    expect(row.targetType).toBe("TimeEntry");
    expect(row.targetId).toBe(entries[0].id);
  });

  it("a reschedule card moves the job's dates through the lifted core, refuses a member without MANAGE_JOBS in a sentence, and refuses once the row moved under it", async () => {
    // Phase 4b: the first MODIFY. The payload carries the dates the card
    // was made from, and the core's compare-and-set — one UPDATE whose
    // WHERE names them — is what makes the tap safe against an edit made
    // on the job page between card and tap. Only a real database can
    // prove that statement matches nothing once the row has moved.
    const job = await prisma.job.create({
      data: {
        companyId,
        contactId,
        name: `ASK-DBTEST schedule ${Date.now()}`,
        status: "IN_PROGRESS",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    const card = (over: Partial<Record<"startDate" | "endDate" | "wasStartDate" | "wasEndDate", string | null>> = {}) =>
      cardFor("reschedule_job", {
        jobId: job.id,
        jobName: job.name,
        startDate: "2026-10-06",
        endDate: "2026-11-20",
        wasStartDate: "2026-10-01",
        wasEndDate: null,
        ...over,
      });

    // A MEMBER whose job function holds no MANAGE_JOBS: refused by the
    // confirm action itself, as a returned sentence, before any claim.
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";
    const refusedId = await card();
    const refused = await confirmAskProposal(refusedId);
    context.role = "OWNER";
    context.jobFunction = null;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/job correspondence access \(MANAGE_JOBS\)/);
    const refusedRow = await prisma.askProposal.findUniqueOrThrow({ where: { id: refusedId } });
    expect(refusedRow.outcome).toBe("REFUSED");
    expect(refusedRow.claimedAt).toBeNull();
    const untouched = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(untouched.startDate?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(untouched.endDate).toBeNull();

    // The owner's tap: both dates move, and nothing else on the row.
    const firstId = await card();
    const first = await confirmAskProposal(firstId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.message).toBe(`${job.name} now starts Oct 6, 2026 (Tuesday) and ends Nov 20, 2026 (Friday).`);
      expect(first.value.created).toEqual({ label: job.name, href: `/jobs/${job.id}` });
    }
    const moved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(moved.startDate?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(moved.endDate?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(moved.status).toBe("IN_PROGRESS");
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.outcome).toBe("OK");
    expect(row.targetType).toBe("Job");
    expect(row.targetId).toBe(job.id);

    // A second card made from the OLD dates — somebody edited the job
    // between card and tap. Refused in a sentence naming what the row
    // holds now; nothing written.
    const staleId = await card({ startDate: "2026-10-13" });
    const stale = await confirmAskProposal(staleId);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe(
        `${job.name}'s dates have changed since you last saw them — it now runs Oct 6, 2026 to Nov 20, 2026. Ask again to see the current dates before moving them.`,
      );
    }
    const still = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(still.startDate?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(still.endDate?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    const staleRow = await prisma.askProposal.findUniqueOrThrow({ where: { id: staleId } });
    expect(staleRow.outcome).toBe("FAILED");
    expect(staleRow.outcomeNote).toMatch(/dates have changed since you last saw them/);

    // An end before the start: the action's own words, before any write.
    const backwards = await confirmAskProposal(
      await card({ startDate: "2026-12-01", endDate: "2026-11-20", wasStartDate: "2026-10-06", wasEndDate: "2026-11-20" }),
    );
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error).toBe("End date can't be before the start date");
    const unchanged = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(unchanged.startDate?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(unchanged.endDate?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
});
