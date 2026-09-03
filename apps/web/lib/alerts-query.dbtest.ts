import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The alert engine against a real Postgres, end to end.
 *
 * `.dbtest.ts` — CI has no database. Run against a SCRATCH one:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * lib/alerts.test.ts already proves the DECIDING half with hand-built
 * inputs. What that cannot prove is that the assembling half asks the
 * right questions of the real schema — that the certified-payroll gate
 * actually reads PrevailingWageDetermination, that retainage comes out of
 * the same sum /cash-flow uses, that an acknowledgement written by one
 * user does not silence another's list. Every one of those is a wiring
 * question, and this project's bugs have all been wiring.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadAlerts } = await import("./alerts-query");
const { dismissAlert, restoreAlert, snoozeAlert } = await import("./actions/alerts");

const TODAY = "2026-09-01";
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let jobId = "";
let secondUserId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const keysOf = (alerts: { key: string }[]) => alerts.map((a) => a.key);

describe("alerts assembled from real rows", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Alerts Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `al_${Date.now()}`,
        email: `al_owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `al2_${Date.now()}`,
        email: `al_member_${Date.now()}@example.test`,
        role: "MEMBER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        name: "Mercy Tower",
        status: "IN_PROGRESS",
        retainagePercent: "10",
      },
    });

    context.company.id = company.id;
    context.id = user.id;
    secondUserId = other.id;
    jobId = job.id;
  });

  afterAll(async () => {
    const where = { companyId: context.company.id };
    await prisma.alertAcknowledgement.deleteMany({ where });
    await prisma.contactInteraction.deleteMany({ where });
    await prisma.backcharge.deleteMany({ where });
    await prisma.backchargeCounter.deleteMany({ where: { jobId } });
    await prisma.closeoutSubmission.deleteMany({ where });
    await prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId } });
    await prisma.retainageRelease.deleteMany({ where: { jobId } });
    await prisma.payment.deleteMany({ where: { invoice: { jobId } } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.prevailingWageDetermination.deleteMany({ where: { jobId } });
    await prisma.complianceDocument.deleteMany({ where });
    await prisma.job.deleteMany({ where });
    await prisma.contact.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("raises nothing for a company with nothing recorded", async () => {
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    // Deliberately not "everything is fine". A company with no dates
    // entered has nothing to derive from, and inventing warnings out of
    // absent data is the failure this whole module refuses.
    expect(visible).toEqual([]);
  });

  it("raises an unanswered backcharge past its deadline, with the money on it", async () => {
    await prisma.backcharge.create({
      data: {
        companyId: context.company.id,
        jobId,
        number: 1,
        description: "Corridor cleanup",
        claimedAmount: "4200",
        issuedOn: utc("2026-08-10"),
        respondByDate: utc("2026-08-25"),
      },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    const alert = visible.find((a) => a.kind === "BACKCHARGE_RESPONSE");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("OVERDUE");
    expect(alert?.amount).toBe(4200);
  });

  it("drops it the moment the backcharge is answered", async () => {
    await prisma.backcharge.updateMany({
      where: { jobId },
      data: { status: "DISPUTED", disputedOn: utc("2026-08-30"), disputeReason: "Not ours" },
    });
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(visible.filter((a) => a.kind === "BACKCHARGE_RESPONSE")).toEqual([]);
  });

  it("says nothing about retainage until there is a balance", async () => {
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(visible.filter((a) => a.kind === "RETAINAGE_RELEASE")).toEqual([]);
  });

  it("raises retainage as collectable once the GC accepts the closeout package", async () => {
    await prisma.invoice.create({
      data: {
        jobId,
        number: 1,
        amount: "100000",
        retainageWithheld: "10000",
        issuedAt: utc("2026-07-01"),
      },
    });
    await prisma.closeoutSubmission.create({
      data: {
        companyId: context.company.id,
        jobId,
        attempt: 1,
        submittedOn: utc("2026-08-05"),
        status: "ACCEPTED",
        respondedOn: utc("2026-08-15"),
      },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    const alert = visible.find((a) => a.kind === "RETAINAGE_RELEASE");
    expect(alert?.severity).toBe("OVERDUE");
    // Withheld minus released, through calculateRetainageSummary — the
    // same sum /cash-flow and the metric bar use.
    expect(alert?.amount).toBe(10000);
    expect(alert?.detail).toContain("accepted the closeout package");
  });

  it("drops the balance as retainage is released", async () => {
    await prisma.retainageRelease.create({
      data: { jobId, amount: "10000", releasedAt: utc("2026-08-28") },
    });
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(visible.filter((a) => a.kind === "RETAINAGE_RELEASE")).toEqual([]);
  });

  it("chases a closeout package the GC has sat on, and hands over to the rejection chase when they bounce it", async () => {
    await prisma.closeoutSubmission.updateMany({
      where: { jobId },
      data: { status: "SUBMITTED", respondedOn: null },
    });
    let { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(visible.some((a) => a.kind === "CLOSEOUT_WITH_GC")).toBe(true);
    expect(visible.filter((a) => a.kind === "CLOSEOUT_REJECTED")).toEqual([]);

    await prisma.closeoutSubmission.updateMany({
      where: { jobId },
      data: { status: "REJECTED", respondedOn: utc("2026-08-29"), gcResponse: "Short a waiver" },
    });
    ({ visible } = await loadAlerts(context.company.id, context.id, TODAY));
    // Issue #111 item 3. This assertion used to stop here, and the "stops
    // once they answer" it claimed was the bug: alerts-query fed only
    // SUBMITTED through, so a REJECTED package raised nothing anywhere.
    // The GC-side chase is genuinely over — but ours has started.
    expect(visible.filter((a) => a.kind === "CLOSEOUT_WITH_GC")).toEqual([]);
    const rejected = visible.find((a) => a.kind === "CLOSEOUT_REJECTED");
    expect(rejected).toBeDefined();
    expect(rejected?.dueOn).toBe("2026-08-29");
  });

  it("says nothing about a closeout package the GC accepted", async () => {
    await prisma.closeoutSubmission.updateMany({
      where: { jobId },
      data: { status: "ACCEPTED", respondedOn: utc("2026-08-29") },
    });
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    // Neither chase applies. What an accepted package leaves behind is
    // retainage, and retainageAlerts is what raises that.
    expect(visible.filter((a) => a.kind === "CLOSEOUT_WITH_GC")).toEqual([]);
    expect(visible.filter((a) => a.kind === "CLOSEOUT_REJECTED")).toEqual([]);
  });

  it("stays silent about certified payroll on a job with no wage determination", async () => {
    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: context.id,
        date: utc("2026-08-19"),
        hours: "8",
      },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    // Certified payroll is not required on private work. Nagging about
    // every job would train people to ignore the one that matters.
    expect(visible.filter((a) => a.kind === "CERTIFIED_PAYROLL")).toEqual([]);
  });

  it("raises it once the job is known to be prevailing-wage", async () => {
    await prisma.prevailingWageDetermination.create({
      data: { jobId, jurisdiction: "California" },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    const alert = visible.find((a) => a.kind === "CERTIFIED_PAYROLL");
    expect(alert).toBeDefined();
    // 19 Aug 2026 is a Wednesday; the week starts Monday the 17th.
    expect(alert?.key).toBe(`CERTIFIED_PAYROLL:${jobId}:2026-08-17`);
    expect(alert?.severity).toBe("OVERDUE");
  });

  it("is cleared by a filed report whose period covers the whole week", async () => {
    const partial = await prisma.complianceDocument.create({
      data: {
        companyId: context.company.id,
        jobId,
        type: "CERTIFIED_PAYROLL",
        partyName: "Us",
        periodStart: utc("2026-08-19"),
        periodEnd: utc("2026-08-23"),
      },
    });
    let { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    // A report clipping the week is not evidence the week was filed.
    expect(visible.some((a) => a.kind === "CERTIFIED_PAYROLL")).toBe(true);

    await prisma.complianceDocument.update({
      where: { id: partial.id },
      data: { periodStart: utc("2026-08-17"), periodEnd: utc("2026-08-23") },
    });
    ({ visible } = await loadAlerts(context.company.id, context.id, TODAY));
    expect(visible.filter((a) => a.kind === "CERTIFIED_PAYROLL")).toEqual([]);
  });

  it("silences an alert for the person who dismissed it and nobody else", async () => {
    await prisma.backcharge.updateMany({
      where: { jobId },
      data: { status: "RECEIVED", disputedOn: null, disputeReason: null },
    });
    const before = await loadAlerts(context.company.id, context.id, TODAY);
    const target = before.visible.find((a) => a.kind === "BACKCHARGE_RESPONSE");
    expect(target).toBeDefined();

    expect(await dismissAlert(target!.key)).toEqual({ ok: true });

    const mine = await loadAlerts(context.company.id, context.id, TODAY);
    expect(keysOf(mine.visible)).not.toContain(target!.key);
    // Kept, not vanished: a silenced alert that disappears entirely is
    // indistinguishable from one that got fixed.
    expect(keysOf(mine.silenced)).toContain(target!.key);

    const theirs = await loadAlerts(context.company.id, secondUserId, TODAY);
    // Per-user on purpose. Dismissing on a colleague's behalf is the worse
    // of the two failures — see notifications.prisma.
    expect(keysOf(theirs.visible)).toContain(target!.key);
  });

  it("does not let that dismissal silence the next deadline on the same backcharge", async () => {
    // The GC reissues with a new deadline. The key carries the date, so
    // the old acknowledgement stops matching — no expiry logic needed.
    await prisma.backcharge.updateMany({
      where: { jobId },
      data: { respondByDate: utc("2026-08-28") },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(visible.some((a) => a.kind === "BACKCHARGE_RESPONSE")).toBe(true);
  });

  it("refuses a snooze into the past and honours one into the future", async () => {
    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    const target = visible.find((a) => a.kind === "BACKCHARGE_RESPONSE")!;

    const past = await snoozeAlert(target.key, form({ snoozeUntil: "2026-08-01" }));
    expect(past.ok).toBe(false);

    expect(await snoozeAlert(target.key, form({ snoozeUntil: "2026-12-01" }))).toEqual({ ok: true });
    const after = await loadAlerts(context.company.id, context.id, TODAY);
    expect(keysOf(after.silenced)).toContain(target.key);

    expect(await restoreAlert(target.key)).toEqual({ ok: true });
    const restored = await loadAlerts(context.company.id, context.id, TODAY);
    expect(keysOf(restored.visible)).toContain(target.key);
  });

  it("raises an overdue contact follow-up, naming the assignee, and drops it once cleared", async () => {
    const interaction = await prisma.contactInteraction.create({
      data: {
        companyId: context.company.id,
        contactId: (await prisma.contact.findFirstOrThrow({ where: { companyId: context.company.id } })).id,
        type: "CALL",
        occurredOn: utc("2026-08-20"),
        summary: "Left a message about the change order",
        followUpOn: utc("2026-08-25"),
        followUpAssignedToUserId: secondUserId,
        loggedByUserId: context.id,
      },
    });

    const { visible } = await loadAlerts(context.company.id, context.id, TODAY);
    const alert = visible.find((a) => a.kind === "CONTACT_FOLLOW_UP");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("OVERDUE");
    expect(alert?.href).toBe(`/contacts/${interaction.contactId}`);
    // Named by email since the second user was created with no `name`.
    expect(alert?.detail).toContain("Assigned to");

    // Visible to anyone holding the capability, not just the assignee --
    // the deliberate design choice, not an oversight.
    const theirs = await loadAlerts(context.company.id, secondUserId, TODAY);
    expect(theirs.visible.some((a) => a.kind === "CONTACT_FOLLOW_UP")).toBe(true);

    await prisma.contactInteraction.update({
      where: { id: interaction.id },
      data: { followUpOn: null },
    });
    const { visible: afterClear } = await loadAlerts(context.company.id, context.id, TODAY);
    expect(afterClear.filter((a) => a.kind === "CONTACT_FOLLOW_UP")).toEqual([]);
  });

  it("refuses a key that is not one this app builds", async () => {
    expect((await dismissAlert("whatever")).ok).toBe(false);
    expect((await dismissAlert("")).ok).toBe(false);
    expect((await dismissAlert("A::c")).ok).toBe(false);
    expect(await prisma.alertAcknowledgement.count({ where: { alertKey: "whatever" } })).toBe(0);
  });
});
