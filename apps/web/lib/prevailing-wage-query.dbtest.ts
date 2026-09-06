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

  /**
   * #104 item 5: `findEffectiveRuleSet` existed, was documented ("reviewing
   * last year's timesheet has to use last year's rules"), carried five unit
   * tests, and had ZERO application call sites. What actually ran was "the
   * NEWEST determination's rule set, whatever dates it carries".
   *
   * That is the shape CLAUDE.md warns about — written, documented, and
   * never called — and no unit test can catch it, because the unit tests
   * were passing the whole time. Only a call through the real query can
   * say whether anything reaches the function.
   *
   * So the fixture is built to make the old behaviour WRONG rather than
   * merely different: the newest determination on this job points at the
   * 2025 rules. Under the old code every week, in any year, was reviewed
   * against them.
   *
   *   2025 rules   in force 2025-01-01 to 2025-12-31   daily OT after 10
   *   2026 rules   in force 2026-01-01, no end date    daily OT after 8
   *
   * Ten straight hours on one day is therefore 10 + 0 under the 2025 rules
   * and 8 + 2 under the 2026 rules. Same hours, same person, two different
   * classifications on a document that gets signed and filed.
   */
  describe("the rules that governed the week, not the newest ones on file", () => {
    let effJobId = "";
    const IN_2026 = "2026-08-17"; // Monday
    const IN_2025 = "2025-08-18"; // Monday, exactly 52 weeks earlier
    const CHANGEOVER = "2025-12-29"; // Monday; the week runs into 2026

    beforeAll(async () => {
      const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
      const job = await prisma.job.create({
        data: { companyId, contactId: contact.id, name: "Old Courthouse" },
      });
      effJobId = job.id;

      const jurisdiction = `PWQ-EFF ${Date.now()}`;
      const rules2025 = await prisma.prevailingWageRuleSet.create({
        data: {
          companyId,
          name: "2025 rules",
          jurisdiction,
          authority: "STATE",
          filingFrequency: "WEEKLY",
          dailyOvertimeAfterHours: "10",
          effectiveFrom: utc("2025-01-01"),
          effectiveTo: utc("2025-12-31"),
        },
      });
      const rules2026 = await prisma.prevailingWageRuleSet.create({
        data: {
          companyId,
          name: "2026 rules",
          jurisdiction,
          authority: "STATE",
          filingFrequency: "WEEKLY",
          dailyOvertimeAfterHours: "8",
          effectiveFrom: utc("2026-01-01"),
        },
      });

      // `createdAt` is set EXPLICITLY, not left to `now()`. Two rows
      // created in the same millisecond leave `orderBy: createdAt desc`
      // free to return either first, and this fixture's whole job is that
      // the NEWEST determination is unambiguously the one carrying the OLD
      // rule set — which is what the code being replaced would have chosen
      // for every week in any year. Without the pin, a green run here would
      // not distinguish the fix from a coin toss.
      await prisma.prevailingWageDetermination.create({
        data: {
          jobId: effJobId,
          jurisdiction: "Testland",
          ruleSetId: rules2026.id,
          createdAt: utc("2026-01-02"),
        },
      });
      await prisma.prevailingWageDetermination.create({
        data: {
          jobId: effJobId,
          jurisdiction: "Testland",
          ruleSetId: rules2025.id,
          createdAt: utc("2026-03-01"), // newest, and deliberately the old rules
        },
      });

      await prisma.timeEntry.createMany({
        data: [
          { jobId: effJobId, employeeUserId: alice, date: utc(IN_2026), hours: "10", payType: "STRAIGHT" },
          { jobId: effJobId, employeeUserId: alice, date: utc(IN_2025), hours: "10", payType: "STRAIGHT" },
          { jobId: effJobId, employeeUserId: alice, date: utc("2025-12-31"), hours: "10", payType: "STRAIGHT" },
        ],
      });
    });

    afterAll(async () => {
      await prisma.timeEntry.deleteMany({ where: { jobId: effJobId } });
      await prisma.prevailingWageDetermination.deleteMany({ where: { jobId: effJobId } });
      await prisma.job.delete({ where: { id: effJobId } });
    });

    it("reviews a 2026 week against the 2026 rules, not the newest determination's", async () => {
      const review = await reviewJobWeek(companyId, effJobId, IN_2026);
      expect(review.ruleSetName).toBe("2026 rules");

      const week = review.employees.find((e) => e.employeeName === "Alice")!;
      const day = week.review.disagreements.find((d) => d.date === IN_2026)!;
      expect(day.entered).toMatchObject({ STRAIGHT: 10, OVERTIME: 0 });
      // 8 + 2. The old code answered 10 + 0 here, off the 2025 rules, and
      // called it agreement.
      expect(day.expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 2, DOUBLE_TIME: 0 });
    });

    it("reviews a 2025 week against the 2025 rules, and finds no disagreement", async () => {
      const review = await reviewJobWeek(companyId, effJobId, IN_2025);
      expect(review.ruleSetName).toBe("2025 rules");

      const week = review.employees.find((e) => e.employeeName === "Alice")!;
      // Ten straight hours was a legal ten-hour day under those rules.
      expect(week.review.checked).toBe(true);
      expect(week.review.disagreements).toEqual([]);
      expect(week.review.totalHours).toBe(10);
    });

    it("refuses to judge the week the rules changed inside, and says which two", async () => {
      // Monday 2025-12-29 to Sunday 2026-01-04 straddles the handover.
      // Applying either set across the whole week would put a confident
      // wrong classification on a signed sheet, so it is reported instead.
      const review = await reviewJobWeek(companyId, effJobId, CHANGEOVER);
      expect(review.ruleSetName).toBeNull();

      const week = review.employees.find((e) => e.employeeName === "Alice")!;
      expect(week.review.checked).toBe(false);
      expect(week.review.reason).toContain("The rules changed");
      expect(week.review.reason).toContain("2025 rules");
      expect(week.review.reason).toContain("2026 rules");
      // And it does NOT read as "no rules attached to this job", which is
      // what a person would be sent to fix on a job that plainly has some.
      expect(week.review.reason).not.toContain("No prevailing wage rule set");
      // The hours are still listed. Unchecked is not empty.
      expect(week.review.totalHours).toBe(10);
    });
  });
});
