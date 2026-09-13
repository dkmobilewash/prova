import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Click-list test 5, executed against a real Postgres.
 *
 * `reviewJobWeek` had NO test at all — not a unit test, not a database
 * one. It is the function behind the click-list's key assertion ("entered
 * 10 straight, rules imply 8 straight, 2 OT"), and it is where the parts
 * that could silently disagree meet: the rule set reached through the
 * job's wage determination, the time entries grouped per employee, and
 * the week window.
 *
 * The per-employee grouping is the one worth executing rather than
 * reasoning about. Two people each working eight hours is not a
 * sixteen-hour day, and pooling them would manufacture overtime nobody
 * worked — the single most damaging thing this feature could get wrong.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { reviewJobWeek, loadReviewableWeeks } = await import("./prevailing-wage-query");

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const MONDAY = "2026-08-17";

let companyId = "";
let jobId = "";
let ruleSetId = "";
let alice = "";
let bob = "";

const hours = (employeeUserId: string, date: string, h: string, payType: "STRAIGHT" | "OVERTIME") =>
  prisma.timeEntry.create({
    data: { jobId, employeeUserId, date: utc(date), hours: h, payType },
  });

describe("reviewJobWeek against real rows", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "PW Query Test Co" } });
    const a = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `pwq_a_${Date.now()}`,
        email: `pwq_a_${Date.now()}@example.test`,
        name: "Alice",
        role: "OWNER",
      },
    });
    const b = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `pwq_b_${Date.now()}`,
        email: `pwq_b_${Date.now()}@example.test`,
        name: "Bob",
        role: "MEMBER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Courthouse" },
    });
    const ruleSet = await prisma.prevailingWageRuleSet.create({
      data: {
        companyId: company.id,
        name: "Test rules",
        jurisdiction: `PWQ ${Date.now()}`,
        authority: "STATE",
        filingFrequency: "WEEKLY",
        dailyOvertimeAfterHours: "8",
        dailyDoubleTimeAfterHours: "12",
        effectiveFrom: utc("2026-01-01"),
      },
    });
    await prisma.prevailingWageDetermination.create({
      data: { jobId: job.id, jurisdiction: "Testland", ruleSetId: ruleSet.id },
    });

    companyId = company.id;
    jobId = job.id;
    ruleSetId = ruleSet.id;
    alice = a.id;
    bob = b.id;
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.prevailingWageDetermination.deleteMany({ where: { jobId } });
    await prisma.prevailingWageRuleSet.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("flags ten straight hours where the rule says eight", async () => {
    await hours(alice, MONDAY, "10", "STRAIGHT");

    const review = await reviewJobWeek(companyId, jobId, MONDAY);
    expect(review.ruleSetName).toBe("Test rules");

    const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
    expect(alicesWeek.review.checked).toBe(true);
    const monday = alicesWeek.review.disagreements.find((d) => d.date === MONDAY)!;
    expect(monday.entered).toMatchObject({ STRAIGHT: 10, OVERTIME: 0 });
    expect(monday.expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 2, DOUBLE_TIME: 0 });
  });

  it("agrees once the entry is split the way the rules imply", async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await hours(alice, MONDAY, "8", "STRAIGHT");
    await hours(alice, MONDAY, "2", "OVERTIME");

    const review = await reviewJobWeek(companyId, jobId, MONDAY);
    const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
    expect(alicesWeek.review.disagreements).toEqual([]);
  });

  it("never pools two people into one long day", async () => {
    // Alice 8 + Bob 8 on the same day is not a 16-hour day. Pooling would
    // report 8 hours of overtime nobody worked.
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await hours(alice, MONDAY, "8", "STRAIGHT");
    await hours(bob, MONDAY, "8", "STRAIGHT");

    const review = await reviewJobWeek(companyId, jobId, MONDAY);
    expect(review.employees).toHaveLength(2);
    for (const employee of review.employees) {
      expect(employee.review.totalHours).toBe(8);
      expect(employee.review.disagreements).toEqual([]);
    }
  });

  it("only counts days inside the week it was asked about", async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await hours(alice, "2026-08-23", "10", "STRAIGHT"); // Sunday, in week
    await hours(alice, "2026-08-24", "10", "STRAIGHT"); // Monday, next week

    const review = await reviewJobWeek(companyId, jobId, MONDAY);
    const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
    expect(alicesWeek.review.days.map((d) => d.date)).toEqual(["2026-08-23"]);
  });

  it("reports a week as unchecked when no rule set is attached, and still lists the hours", async () => {
    // Detached, not deleted: the determination is the wage document either
    // way. The week must read "not checked", never "everything matches".
    await prisma.prevailingWageDetermination.updateMany({
      where: { jobId },
      data: { ruleSetId: null },
    });

    const review = await reviewJobWeek(companyId, jobId, MONDAY);
    expect(review.ruleSetName).toBeNull();
    const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
    expect(alicesWeek.review.checked).toBe(false);
    expect(alicesWeek.review.reason).toContain("No prevailing wage rule set");
    expect(alicesWeek.review.disagreements).toEqual([]);
    // The hours are still shown — unchecked is not the same as empty.
    expect(alicesWeek.review.totalHours).toBe(10);

    await prisma.prevailingWageDetermination.updateMany({ where: { jobId }, data: { ruleSetId } });
  });

  it("offers only weeks on jobs that carry a wage determination", async () => {
    const weeks = await loadReviewableWeeks(companyId);
    expect(weeks.every((w) => w.jobId === jobId)).toBe(true);

    // A job with hours but no determination is private work: certified
    // payroll is not required and offering it would bury the ones that are.
    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const privateJob = await prisma.job.create({
      data: { companyId, contactId: contact.id, name: "Private work" },
    });
    await prisma.timeEntry.create({
      data: { jobId: privateJob.id, employeeUserId: alice, date: utc(MONDAY), hours: "10" },
    });

    const after = await loadReviewableWeeks(companyId);
    expect(after.some((w) => w.jobId === privateJob.id)).toBe(false);

    await prisma.timeEntry.deleteMany({ where: { jobId: privateJob.id } });
    await prisma.job.delete({ where: { id: privateJob.id } });
  });

  it("refuses another company's job", async () => {
    const other = await prisma.company.create({ data: { name: "Not ours" } });
    const review = await reviewJobWeek(other.id, jobId, MONDAY);
    expect(review.jobName).toBeNull();
    expect(review.employees).toEqual([]);
    await prisma.company.delete({ where: { id: other.id } });
  });

  describe("issue #104 finding 5: findEffectiveRuleSet was documented and never called", () => {
    // The determination's ruleSetId is a single FK a person points at
    // whatever rule set is CURRENT (setDeterminationRuleSet). When a
    // jurisdiction's overtime threshold changes, the company records a
    // NEW PrevailingWageRuleSet row (its own effective dates) and repoints
    // the determination at it. Before this fix, reviewJobWeek trusted that
    // FK blindly — so reviewing a week from BEFORE the change silently
    // checked it against the NEW threshold, because nothing ever asked
    // whether the linked rule set was actually in force that week.
    const jurisdiction = `PWQ-historic-${Date.now()}`;
    let historicJobId = "";
    let oldRuleSetId = "";
    let newRuleSetId = "";

    beforeAll(async () => {
      const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
      const job = await prisma.job.create({
        data: { companyId, contactId: contact.id, name: "Historic rate job" },
      });
      historicJobId = job.id;

      const old = await prisma.prevailingWageRuleSet.create({
        data: {
          companyId,
          name: "2026 H1 rules",
          jurisdiction,
          authority: "STATE",
          filingFrequency: "WEEKLY",
          dailyOvertimeAfterHours: "8",
          effectiveFrom: utc("2026-01-01"),
          effectiveTo: utc("2026-06-30"),
        },
      });
      const next = await prisma.prevailingWageRuleSet.create({
        data: {
          companyId,
          name: "2026 H2 rules",
          jurisdiction,
          authority: "STATE",
          filingFrequency: "WEEKLY",
          dailyOvertimeAfterHours: "10", // the threshold actually changed
          effectiveFrom: utc("2026-07-01"),
        },
      });
      oldRuleSetId = old.id;
      newRuleSetId = next.id;

      // The determination's FK points at the NEWEST rule set — exactly
      // what a person does by re-running setDeterminationRuleSet once the
      // new rules take effect. It is deliberately NOT pointed at the rule
      // set that was actually in force for the historic week this test
      // reviews, which is the point: that answer has to come from
      // findEffectiveRuleSet, not from this FK.
      await prisma.prevailingWageDetermination.create({
        data: { jobId: historicJobId, jurisdiction, ruleSetId: newRuleSetId },
      });

      await prisma.timeEntry.create({
        data: { jobId: historicJobId, employeeUserId: alice, date: utc("2026-03-02"), hours: "9", payType: "STRAIGHT" },
      });
    });

    afterAll(async () => {
      await prisma.timeEntry.deleteMany({ where: { jobId: historicJobId } });
      await prisma.prevailingWageDetermination.deleteMany({ where: { jobId: historicJobId } });
      await prisma.job.delete({ where: { id: historicJobId } });
      await prisma.prevailingWageRuleSet.deleteMany({ where: { id: { in: [oldRuleSetId, newRuleSetId] } } });
    });

    it("reviews a historic week against the rule set that was in force THEN, not the one the FK now points at", async () => {
      // Monday 2026-03-02 falls under the OLD rule set's window (Jan-Jun),
      // even though the determination's ruleSetId points at the NEW one.
      const review = await reviewJobWeek(companyId, historicJobId, "2026-03-02");
      expect(review.ruleSetName).toBe("2026 H1 rules");

      const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
      // 9 hours against the OLD 8-hour threshold: one hour of overtime.
      const day = alicesWeek.review.disagreements.find((d) => d.date === "2026-03-02")!;
      expect(day.expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 1 });
    });

    it("reviews a current week against the new rule set", async () => {
      await prisma.timeEntry.deleteMany({ where: { jobId: historicJobId } });
      await prisma.timeEntry.create({
        data: { jobId: historicJobId, employeeUserId: alice, date: utc("2026-07-06"), hours: "9", payType: "STRAIGHT" },
      });

      const review = await reviewJobWeek(companyId, historicJobId, "2026-07-06");
      expect(review.ruleSetName).toBe("2026 H2 rules");
      const alicesWeek = review.employees.find((e) => e.employeeName === "Alice")!;
      // 9 hours against the NEW 10-hour threshold: no overtime at all.
      expect(alicesWeek.review.disagreements).toEqual([]);
    });
  });
});
