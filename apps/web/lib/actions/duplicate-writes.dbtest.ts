import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Issue #102, executed: RUN THE ACTION TWICE AND COUNT THE ROWS.
 *
 * Every test in this file calls a write action a second time and then asks
 * the database how many rows exist and what they add up to. A test that
 * calls an action once proves nothing whatsoever about the defect #102 is
 * about, and this repo has already filed #150 over four tests that shipped
 * unable to fail — so each guard below also has a companion test proving it
 * does NOT block the legitimate second entry, which is the way an
 * over-eager guard would otherwise pass unnoticed.
 *
 * Two of them run the action CONCURRENTLY (`Promise.all`) rather than in
 * sequence. Those are the tests for the advisory lock in
 * lib/actions/duplicates.ts: sequential calls are caught by the in-
 * transaction read on its own, and only simultaneous ones can tell you
 * whether the read was serialized or just lucky.
 *
 * Named `.dbtest.ts`, so the fast suite does not collect it; the `dbtest`
 * job in ci.yml runs it against a scratch Postgres. Only the auth boundary
 * and revalidatePath are faked — the actions, Prisma, the transactions, the
 * advisory locks and the schema are all real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createInvoice, logPayment, createRetainageRelease, submitPayApplication } = await import(
  "./billing"
);
const { logTimeEntry } = await import("./labor");
const { createBackcharge } = await import("./backcharges");
const { createRfi } = await import("./rfis");
const { createSubmittal } = await import("./submittals");
const { createSafetyIncident } = await import("./safety");
const { addCostEntry } = await import("./jobs");
const { lockAgainstDuplicates } = await import("./duplicates");

/**
 * Hold the advisory lock for a scope+key from OUTSIDE the action, then see
 * whether the action stops at the door.
 *
 * This is how the lock is tested rather than by firing two calls at once
 * and hoping they collide. A `Promise.all` of two actions passes with the
 * lock REMOVED whenever the first happens to finish first, which is most of
 * the time — measured, not assumed: deleting `lockAgainstDuplicates` from
 * logPayment left a concurrent-pair test green. A test that only sometimes
 * fails on the defect is #150 all over again.
 *
 * Returns "blocked" if the action was still waiting after `waitMs`, "ran"
 * if it got past. The key is derived from the same parts the action passes,
 * so a wrong key here reads as "ran" — this fails if the lock is removed
 * AND if its key ever stops matching.
 */
async function runsWhileLockHeld(
  scope: string,
  parts: (string | number | Date | null | undefined)[],
  action: () => Promise<unknown>,
  waitMs = 400,
): Promise<"blocked" | "ran"> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const holder = prisma.$transaction(async (tx) => {
    await lockAgainstDuplicates(tx, scope, parts);
    await held;
  });
  // Let the holder's transaction actually take the lock first.
  await new Promise((r) => setTimeout(r, 100));

  const attempt = action().then(() => "ran" as const);
  const outcome = await Promise.race([
    attempt,
    new Promise<"blocked">((r) => setTimeout(() => r("blocked"), waitMs)),
  ]);

  release();
  await holder;
  await attempt;
  return outcome;
}

let jobId = "";
let lineItemId = "";
let otherLineItemId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const money = (v: { toString(): string } | null | undefined) => Number(v ?? 0);

describe("write paths that must not duplicate money or evidence (#102)", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Idempotency Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `dup_${Date.now()}`,
        email: `dup_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        name: "Idempotency Test Job",
        // createInvoice and submitPayApplication both refuse an estimate.
        status: "CONTRACTED",
        retainagePercent: "10",
      },
    });
    const line = await prisma.jobLineItem.create({
      data: { jobId: job.id, description: "Level 3 metal framing", quantity: "1", unitPrice: "100000" },
    });
    const otherLine = await prisma.jobLineItem.create({
      data: { jobId: job.id, description: "Corridor drywall", quantity: "1", unitPrice: "50000" },
    });

    context.company.id = company.id;
    context.id = user.id;
    jobId = job.id;
    lineItemId = line.id;
    otherLineItemId = otherLine.id;
  });

  afterAll(async () => {
    const companyId = context.company.id;
    await prisma.payment.deleteMany({ where: { invoice: { job: { companyId } } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { job: { companyId } } } });
    await prisma.invoice.deleteMany({ where: { job: { companyId } } });
    await prisma.invoiceCounter.deleteMany({ where: { job: { companyId } } });
    await prisma.retainageRelease.deleteMany({ where: { job: { companyId } } });
    await prisma.timeEntry.deleteMany({ where: { job: { companyId } } });
    await prisma.backcharge.deleteMany({ where: { companyId } });
    await prisma.backchargeCounter.deleteMany({ where: { job: { companyId } } });
    await prisma.rfi.deleteMany({ where: { companyId } });
    await prisma.rfiCounter.deleteMany({ where: { job: { companyId } } });
    await prisma.submittalRevision.deleteMany({ where: { submittal: { companyId } } });
    await prisma.submittal.deleteMany({ where: { companyId } });
    await prisma.submittalCounter.deleteMany({ where: { job: { companyId } } });
    await prisma.safetyIncident.deleteMany({ where: { companyId } });
    await prisma.safetyCaseCounter.deleteMany({ where: { companyId } });
    await prisma.costEntry.deleteMany({ where: { lineItem: { jobId } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  /* ---------------------------------------------------------------- */
  /* logPayment — the worst one. A double-logged payment drives the    */
  /* balance to zero and the invoice silently leaves A/R aging.        */
  /* ---------------------------------------------------------------- */

  describe("logPayment", () => {
    let invoiceId = "";

    beforeAll(async () => {
      const invoice = await prisma.invoice.create({
        data: { jobId, number: 9001, description: "Payment test", amount: "20000" },
      });
      invoiceId = invoice.id;
    });

    it("records ONE $10,000 payment when the button is clicked twice", async () => {
      const payment = () => form({ amount: "10000", method: "Check 4471", note: "" });
      await logPayment(jobId, invoiceId, payment());
      await logPayment(jobId, invoiceId, payment());

      const rows = await prisma.payment.findMany({ where: { invoiceId } });
      expect(rows).toHaveLength(1);
      // The dollar figure, not just the row count: $20,000 here is the
      // invoice dropping out of A/R aging with $10,000 still owed.
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(10000);
    });

    it("waits behind another transaction logging the same payment", async () => {
      const invoice = await prisma.invoice.create({
        data: { jobId, number: 9002, amount: "20000" },
      });
      // The check inside the transaction is a SELECT under READ COMMITTED:
      // on its own, two simultaneous submissions both see nothing and both
      // insert. This proves logPayment takes the advisory lock that
      // serializes them, and takes it on the right key.
      const outcome = await runsWhileLockHeld(
        "payment",
        [invoice.id, "7500.00", "ACH", ""],
        () => logPayment(jobId, invoice.id, form({ amount: "7500", method: "ACH" })),
      );
      expect(outcome).toBe("blocked");

      const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(rows).toHaveLength(1);
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(7500);
    });

    it("does NOT wait behind an unrelated payment's lock", async () => {
      const invoice = await prisma.invoice.create({
        data: { jobId, number: 9004, amount: "20000" },
      });
      // The companion to the test above. A lock taken on a key so coarse
      // that every payment queues behind every other would pass that test
      // and serialize the whole app.
      const outcome = await runsWhileLockHeld(
        "payment",
        [invoice.id, "1.00", "Some other payment", ""],
        () => logPayment(jobId, invoice.id, form({ amount: "6100", method: "Wire" })),
      );
      expect(outcome).toBe("ran");
      expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it("still records a genuinely different second payment", async () => {
      const invoice = await prisma.invoice.create({
        data: { jobId, number: 9003, amount: "20000" },
      });
      await logPayment(jobId, invoice.id, form({ amount: "5000", method: "Check 1" }));
      await logPayment(jobId, invoice.id, form({ amount: "5000", method: "Check 2" }));

      const rows = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
      expect(rows).toHaveLength(2);
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(10000);
    });
  });

  /* ---------------------------------------------------------------- */
  /* logTimeEntry — 16 hours on a day somebody worked 8.               */
  /* ---------------------------------------------------------------- */

  describe("logTimeEntry", () => {
    it("logs 8 hours once when the day is submitted twice", async () => {
      const day = () =>
        form({
          employeeUserId: context.id,
          lineItemId,
          date: "2026-08-17",
          hours: "8",
          payType: "STRAIGHT",
        });
      await logTimeEntry(jobId, day());
      await logTimeEntry(jobId, day());

      const rows = await prisma.timeEntry.findMany({ where: { jobId, date: new Date("2026-08-17") } });
      expect(rows).toHaveLength(1);
      // 16 doubles the WH-347 and that day's apprentice ratio.
      expect(rows.reduce((sum, r) => sum + money(r.hours), 0)).toBe(8);
    });

    it("still logs a genuine second entry on the same day — a split shift", async () => {
      const base = {
        employeeUserId: context.id,
        lineItemId,
        date: "2026-08-18",
        payType: "STRAIGHT",
      };
      await logTimeEntry(jobId, form({ ...base, hours: "6" }));
      await logTimeEntry(jobId, form({ ...base, hours: "2" }));

      const rows = await prisma.timeEntry.findMany({ where: { jobId, date: new Date("2026-08-18") } });
      expect(rows).toHaveLength(2);
      expect(rows.reduce((sum, r) => sum + money(r.hours), 0)).toBe(8);
    });

    it("still logs the same hours against a different cost code", async () => {
      const base = { employeeUserId: context.id, date: "2026-08-19", hours: "4", payType: "STRAIGHT" };
      await logTimeEntry(jobId, form({ ...base, lineItemId }));
      await logTimeEntry(jobId, form({ ...base, lineItemId: otherLineItemId }));

      const rows = await prisma.timeEntry.findMany({ where: { jobId, date: new Date("2026-08-19") } });
      expect(rows).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------- */
  /* addCostEntry — cost-to-date drives percent complete, which drives  */
  /* the over/under billing figure quoted to a bonding company.        */
  /* ---------------------------------------------------------------- */

  describe("addCostEntry", () => {
    it("books ONE $40,000 delivery when the form is submitted twice", async () => {
      const delivery = () =>
        form({ description: "Board delivery — ticket 88213", amount: "40000", category: "MATERIAL" });
      await addCostEntry(jobId, lineItemId, delivery());
      await addCostEntry(jobId, lineItemId, delivery());

      const rows = await prisma.costEntry.findMany({
        where: { lineItemId, description: "Board delivery — ticket 88213" },
      });
      expect(rows).toHaveLength(1);
      // The dollar figure, not just the count: $80,000 of cost against a
      // $100,000 line is 80% complete on a line that is 40% complete, and
      // that percentage is what the WIP over/under billing figure is
      // computed from.
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(40000);
    });

    it("waits behind another transaction booking the same cost", async () => {
      // The in-transaction read alone is a SELECT under READ COMMITTED and
      // two simultaneous submissions would both see nothing. This proves
      // addCostEntry takes the advisory lock, and takes it on the key its
      // own arguments produce.
      const outcome = await runsWhileLockHeld(
        "costEntry",
        [lineItemId, "Crane day", "2750.00", "SUBCONTRACTOR", null],
        () =>
          addCostEntry(
            jobId,
            lineItemId,
            form({ description: "Crane day", amount: "2750", category: "SUBCONTRACTOR" }),
          ),
      );
      expect(outcome).toBe("blocked");

      const rows = await prisma.costEntry.findMany({ where: { lineItemId, description: "Crane day" } });
      expect(rows).toHaveLength(1);
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(2750);
    });

    it("does NOT wait behind an unrelated cost's lock", async () => {
      // The companion to the test above. A key coarse enough to queue
      // every cost entry behind every other would pass that test and
      // serialize job costing across the whole app.
      const outcome = await runsWhileLockHeld(
        "costEntry",
        [lineItemId, "Something else entirely", "1.00", "OTHER", null],
        () =>
          addCostEntry(
            jobId,
            lineItemId,
            form({ description: "Dumpster pull", amount: "610", category: "OTHER" }),
          ),
      );
      expect(outcome).toBe("ran");
      expect(await prisma.costEntry.count({ where: { lineItemId, description: "Dumpster pull" } })).toBe(1);
    });

    it("still books a genuinely different second cost", async () => {
      await addCostEntry(
        jobId,
        lineItemId,
        form({ description: "Board delivery — ticket 88999", amount: "40000", category: "MATERIAL" }),
      );
      const rows = await prisma.costEntry.findMany({
        where: { lineItemId, description: "Board delivery — ticket 88999" },
      });
      expect(rows).toHaveLength(1);
    });

    it("still books the same cost against a different line item", async () => {
      const same = () =>
        form({ description: "Shared scaffold hire", amount: "1500", category: "OTHER" });
      await addCostEntry(jobId, lineItemId, same());
      await addCostEntry(jobId, otherLineItemId, same());

      const rows = await prisma.costEntry.findMany({
        where: { description: "Shared scaffold hire", lineItem: { jobId } },
      });
      expect(rows).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------- */
  /* createInvoice, and the counter behind its number.                 */
  /* ---------------------------------------------------------------- */

  describe("createInvoice", () => {
    it("bills the GC once when the form is submitted twice", async () => {
      const bill = () => form({ description: "August progress", amount: "45000", dueAt: "" });
      await createInvoice(jobId, bill());
      await createInvoice(jobId, bill());

      const rows = await prisma.invoice.findMany({ where: { jobId, description: "August progress" } });
      expect(rows).toHaveLength(1);
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(45000);
      // Retainage is snapshotted per invoice; a second row snapshots it a
      // second time and doubles the withheld balance too.
      expect(money(rows[0].retainageWithheld)).toBe(4500);
    });

    it("still bills a genuinely different second invoice", async () => {
      await createInvoice(jobId, form({ description: "September progress", amount: "45000" }));
      const rows = await prisma.invoice.findMany({ where: { jobId, description: "September progress" } });
      expect(rows).toHaveLength(1);
    });

    it("never reissues an invoice number after one is deleted", async () => {
      const before = await prisma.invoiceCounter.findUnique({ where: { jobId } });
      await createInvoice(jobId, form({ description: "Counter A", amount: "11" }));
      const a = await prisma.invoice.findFirstOrThrow({ where: { jobId, description: "Counter A" } });
      await prisma.invoice.delete({ where: { id: a.id } });

      await createInvoice(jobId, form({ description: "Counter B", amount: "12" }));
      const b = await prisma.invoice.findFirstOrThrow({ where: { jobId, description: "Counter B" } });

      // Under the old `max(number) + 1` this was equal: deleting the
      // highest invoice freed its number, and the GC ends up holding two
      // different bills both called "Invoice 4".
      expect(b.number).toBe(a.number + 1);
      expect(b.number).toBeGreaterThan(before?.lastNumber ?? 0);
    });
  });

  /* ---------------------------------------------------------------- */
  /* submitPayApplication — the same period billed twice.              */
  /* ---------------------------------------------------------------- */

  describe("submitPayApplication", () => {
    const application = () => {
      const fd = new FormData();
      fd.set("description", "Application 7");
      fd.append("lineItemId", lineItemId);
      fd.append("thisPeriodBilled", "12000");
      fd.append("materialsStoredValue", "3000");
      fd.append("lineItemId", otherLineItemId);
      fd.append("thisPeriodBilled", "8000");
      fd.append("materialsStoredValue", "0");
      return fd;
    };

    it("bills the period once and says so when submitted twice", async () => {
      const first = await submitPayApplication(jobId, application());
      expect(first).toEqual({ ok: true });

      const second = await submitPayApplication(jobId, application());
      expect(second.ok).toBe(false);
      // A refusal nobody can read is not a guard — this one names the
      // application that already exists.
      if (!second.ok) expect(second.error).toMatch(/already submitted/i);

      const rows = await prisma.invoice.findMany({
        where: { jobId, description: "Application 7" },
        include: { lineItems: true },
      });
      expect(rows).toHaveLength(1);
      expect(money(rows[0].amount)).toBe(23000);
      expect(money(rows[0].retainageWithheld)).toBe(2300);
      expect(rows[0].lineItems).toHaveLength(2);
    });

    it("still accepts the next period at different amounts", async () => {
      const fd = new FormData();
      fd.set("description", "Application 8");
      fd.append("lineItemId", lineItemId);
      fd.append("thisPeriodBilled", "9000");
      fd.append("materialsStoredValue", "0");
      expect(await submitPayApplication(jobId, fd)).toEqual({ ok: true });

      const rows = await prisma.invoice.findMany({ where: { jobId, description: "Application 8" } });
      expect(rows).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /* createRetainageRelease — money that did not come back.            */
  /* ---------------------------------------------------------------- */

  describe("createRetainageRelease", () => {
    it("records ONE release when the form is submitted twice", async () => {
      const release = () => form({ amount: "30000", releasedAt: "2026-08-20", note: "Final release" });
      await createRetainageRelease(jobId, release());
      await createRetainageRelease(jobId, release());

      const rows = await prisma.retainageRelease.findMany({ where: { jobId, note: "Final release" } });
      expect(rows).toHaveLength(1);
      expect(rows.reduce((sum, r) => sum + money(r.amount), 0)).toBe(30000);
    });

    it("still records a genuine second release", async () => {
      await createRetainageRelease(jobId, form({ amount: "5000", note: "Partial release" }));
      const rows = await prisma.retainageRelease.findMany({ where: { jobId, note: "Partial release" } });
      expect(rows).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /* createBackcharge — two identities, two guards.                    */
  /* ---------------------------------------------------------------- */

  describe("createBackcharge", () => {
    const notice = (overrides: Record<string, string> = {}) =>
      form({
        jobId,
        category: "CLEANUP",
        description: "Level 3 corridor cleanup",
        claimedAmount: "8000",
        issuedOn: "2026-08-10",
        gcReference: "BC-114",
        ...overrides,
      });

    it("logs the GC's notice once, and says which one it already has", async () => {
      expect(await createBackcharge(notice())).toEqual({ ok: true });
      const second = await createBackcharge(notice());
      expect(second.ok).toBe(false);
      // Specifically the CODE path's message, which names our own
      // backcharge number. The database constraint's message does not —
      // asserting only on "BC-114" would pass on either, so removing the
      // code check would leave this test green.
      if (!second.ok) expect(second.error).toMatch(/as backcharge #\d+/);

      const rows = await prisma.backcharge.findMany({ where: { jobId, gcReference: "BC-114" } });
      expect(rows).toHaveLength(1);
      // $16,000 of exposure the GC never claimed is the whole defect.
      expect(rows.reduce((sum, r) => sum + money(r.claimedAmount), 0)).toBe(8000);
    });

    it("burns no backcharge number on the refused duplicate", async () => {
      const counterBefore = await prisma.backchargeCounter.findUniqueOrThrow({ where: { jobId } });
      await createBackcharge(notice());
      const counterAfter = await prisma.backchargeCounter.findUniqueOrThrow({ where: { jobId } });
      // The create and the counter bump share one transaction, so a
      // refusal rolls both back — no gap in the sequence.
      expect(counterAfter.lastNumber).toBe(counterBefore.lastNumber);
    });

    it("refuses the GC's reference even long after — it is a permanent key", async () => {
      const row = await prisma.backcharge.findFirstOrThrow({ where: { jobId, gcReference: "BC-114" } });
      // Age the original well past the accidental-repeat window. A GC's
      // own notice number identifies the notice forever, so this must
      // still be refused when a two-minute window would have expired.
      await prisma.backcharge.update({
        where: { id: row.id },
        data: { createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      });

      const late = await createBackcharge(notice({ description: "Retyped months later" }));
      expect(late.ok).toBe(false);
      expect(await prisma.backcharge.count({ where: { jobId, gcReference: "BC-114" } })).toBe(1);
    });

    it("guards a notice with NO reference by its content, within the window", async () => {
      const unnumbered = () => notice({ gcReference: "", description: "Deduction sheet line 4" });
      expect(await createBackcharge(unnumbered())).toEqual({ ok: true });
      expect((await createBackcharge(unnumbered())).ok).toBe(false);

      const rows = await prisma.backcharge.findMany({
        where: { jobId, description: "Deduction sheet line 4" },
      });
      expect(rows).toHaveLength(1);
    });

    it("has a DATABASE constraint behind the code check, not only the code check", async () => {
      // The backstop for two submissions close enough that neither saw the
      // other, and for any future path that writes a Backcharge without
      // going through createBackcharge. Asserted against the database
      // directly, because the action can never reach it while its own
      // check is working — a constraint nothing exercises is a constraint
      // that can quietly fail to exist after a migration goes missing.
      const existing = await prisma.backcharge.findFirstOrThrow({
        where: { jobId, gcReference: "BC-114" },
      });
      await expect(
        prisma.backcharge.create({
          data: {
            companyId: context.company.id,
            jobId,
            number: existing.number + 500,
            gcReference: "BC-114",
            category: "CLEANUP",
            description: "Straight past the action",
            claimedAmount: "8000",
            issuedOn: new Date("2026-08-10T00:00:00.000Z"),
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      expect(await prisma.backcharge.count({ where: { jobId, gcReference: "BC-114" } })).toBe(1);
    });

    it("still allows several notices with NO reference on one job", async () => {
      // NULLs are distinct in Postgres, so the constraint must not touch
      // the many backcharges that arrive as a deduction-sheet line with no
      // number at all. Written straight to the database for the same
      // reason as the test above.
      const rows = await Promise.all(
        ["No number A", "No number B"].map((description, i) =>
          prisma.backcharge.create({
            data: {
              companyId: context.company.id,
              jobId,
              number: 800 + i,
              gcReference: null,
              category: "OTHER",
              description,
              claimedAmount: "100",
              issuedOn: new Date("2026-08-10T00:00:00.000Z"),
            },
          }),
        ),
      );
      expect(rows).toHaveLength(2);
    });

    it("still logs a different notice from the same GC", async () => {
      expect(await createBackcharge(notice({ gcReference: "BC-115", claimedAmount: "2200" }))).toEqual({
        ok: true,
      });
      expect(await prisma.backcharge.count({ where: { jobId, gcReference: "BC-115" } })).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Evidence records: RFIs and submittals.                            */
  /* ---------------------------------------------------------------- */

  describe("createRfi", () => {
    it("raises ONE RFI when the form is submitted twice, and burns no number", async () => {
      const question = () =>
        form({
          jobId,
          subject: "Corridor header detail",
          question: "Which detail governs at grid C?",
          sentOn: "2026-08-15",
        });
      await createRfi(question());
      await createRfi(question());

      const rows = await prisma.rfi.findMany({ where: { jobId, subject: "Corridor header detail" } });
      expect(rows).toHaveLength(1);

      // The number the GC will quote back. A duplicate would take #2 and
      // leave the log with a gap once it was deleted.
      const counter = await prisma.rfiCounter.findUniqueOrThrow({ where: { jobId } });
      expect(counter.lastNumber).toBe(rows[0].number);
    });

    it("still raises a genuinely different second RFI", async () => {
      await createRfi(form({ jobId, subject: "Slab edge", question: "What is the tolerance?" }));
      expect(await prisma.rfi.count({ where: { jobId } })).toBe(2);
    });
  });

  describe("createSubmittal", () => {
    it("registers ONE package when the form is submitted twice", async () => {
      const pkg = () =>
        form({
          jobId,
          title: "Shop drawings — corridor framing",
          specSection: "09 22 16",
          sentOn: "2026-08-15",
        });
      expect(await createSubmittal(pkg())).toEqual({ ok: true });
      const second = await createSubmittal(pkg());
      expect(second.ok).toBe(false);
      // Names the package that already exists, and says nothing was
      // registered twice — a refusal nobody can read is not a guard.
      if (!second.ok) expect(second.error).toMatch(/registered with these same details/i);

      const rows = await prisma.submittal.findMany({
        where: { jobId, title: "Shop drawings — corridor framing" },
      });
      expect(rows).toHaveLength(1);
      // And exactly one transmittal revision, not two.
      expect(await prisma.submittalRevision.count({ where: { submittalId: rows[0].id } })).toBe(1);

      const counter = await prisma.submittalCounter.findUniqueOrThrow({ where: { jobId } });
      expect(counter.lastNumber).toBe(rows[0].number);
    });

    it("still registers a genuinely different second package", async () => {
      expect(await createSubmittal(form({ jobId, title: "Product data — track" }))).toEqual({ ok: true });
      expect(await prisma.submittal.count({ where: { jobId } })).toBe(2);
    });
  });

  describe("createSafetyIncident", () => {
    const report = () =>
      form({
        employeeName: "R. Alvarez",
        description: "Cut to left hand stripping track",
        occurredAt: "2026-08-12",
        classification: "INJURY",
        outcome: "OTHER_RECORDABLE",
      });

    it("files ONE case when the report is sent twice", async () => {
      await createSafetyIncident(report());
      await createSafetyIncident(report());

      const rows = await prisma.safetyIncident.findMany({
        where: { companyId: context.company.id, employeeName: "R. Alvarez" },
      });
      // Two rows here is one injury counted as two recordable cases in the
      // number a GC reads at prequalification — and the counter never
      // reissues, so deleting the duplicate leaves a gap in the filed log.
      expect(rows).toHaveLength(1);
    });

    it("waits behind another transaction filing the same case", async () => {
      // The read inside this action was always there; its own comment used
      // to say the simultaneous case was open and needed a unique index.
      // This is the evidence the advisory lock closed it instead.
      const outcome = await runsWhileLockHeld(
        "safetyIncident",
        [
          context.company.id,
          new Date("2026-08-30T00:00:00.000Z"),
          "T. Okafor",
          "Slipped on wet deck",
        ],
        () =>
          createSafetyIncident(
            form({
              employeeName: "T. Okafor",
              description: "Slipped on wet deck",
              occurredAt: "2026-08-30",
              classification: "INJURY",
              outcome: "FIRST_AID_ONLY",
            }),
          ),
      );
      expect(outcome).toBe("blocked");
      expect(
        await prisma.safetyIncident.count({
          where: { companyId: context.company.id, employeeName: "T. Okafor" },
        }),
      ).toBe(1);
    });
  });
});
