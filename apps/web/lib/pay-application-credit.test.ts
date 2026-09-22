import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A pay application that nets NEGATIVE, driven through the real action.
 *
 * WHAT WAS REPRODUCED, and it is two periods rather than one crafted POST:
 * the app's own on-screen instruction tells a foreman to move installed
 * material out of "stored" by entering the amount twice — a negative under
 * New materials stored and the same amount as a positive under This
 * period. Type half of it and nothing anywhere says so. Period 1 stores
 * $5,000; period 2 enters the −$5,000 release and no positive.
 * `payAppEntryError` returns null for that row — correctly, on its own
 * terms, since the line's stored balance lands at exactly $0 and nothing
 * exceeds its scheduled value — and the DOCUMENT comes out at −$5,000.00
 * with a −$500.00 retainage snapshot beside it and a G702 printing
 * "Current payment due −$4,500.00".
 *
 * `payAppEntryError` is a per-ROW guard and there was no per-DOCUMENT one
 * at all. That is the hole: every individual row can be defensible while
 * the certificate they add up to is not.
 *
 * WHY THE ANSWER IS NOT "REFUSE EVERY NEGATIVE". lib/pay-application.test.ts
 * argues, and this file agrees, that a net-negative application is the only
 * in-app way to correct an over-billed invoice that has already gone to a
 * GC — there is no void, edit or delete invoice action anywhere, on purpose
 * (an invoice is an evidence record). So the two cases are:
 *
 *   the mistake     half of a two-part entry, and the person does not know
 *   the correction  a deliberate credit the sub owes back
 *
 * and NOTHING IN THE DATA TELLS THEM APART. Both are "completed to date
 * went down". So the guard cannot be a refusal, and it is not one: the
 * action refuses a negative total UNLESS the submission says in so many
 * words that a credit is what was meant. The form asks, in the one place
 * where the person who typed the figures is standing.
 *
 * The database is faked, as in lib/job-lifecycle-actions.test.ts, because
 * what is under test is the action's own arithmetic and refusals. The G702
 * figures at the end come from `assemblePayApplication`, the same pure
 * function the report page renders from.
 */

const COMPANY_ID = "cmp_alpha";
const JOB_ID = "job_alpha";
const LINE_ID = "li_framing";

type Row = Record<string, unknown>;

const db = {
  jobs: [] as Row[],
  lineItems: [] as Row[],
  invoices: [] as Row[],
  invoiceLineItems: [] as Row[],
  invoiceCounters: [] as Row[],
};

/** `issuedAt` is what the 10-second duplicate guard reads, and two
 * applications submitted inside one test are milliseconds apart. Each
 * invoice is stamped from here so a period-2 submission is not mistaken
 * for a double-click on period 1. */
let clock = new Date("2026-03-01T12:00:00Z");

const prisma = {
  job: {
    findUnique: async ({ where }: { where: Row }) => db.jobs.find((j) => j.id === where.id) ?? null,
  },
  jobLineItem: {
    findUnique: async ({ where }: { where: Row }) =>
      db.lineItems.find((l) => l.id === where.id) ?? null,
    findMany: async ({ where }: { where: Row }) =>
      db.lineItems.filter((l) => l.jobId === where.jobId),
  },
  invoiceLineItem: {
    findMany: async () =>
      db.invoiceLineItems.filter((r) =>
        db.invoices.some((inv) => inv.id === r.invoiceId && inv.jobId === JOB_ID),
      ),
  },
  invoice: {
    findFirst: async () => {
      const found = [...db.invoices].sort(
        (a, b) => (b.issuedAt as Date).getTime() - (a.issuedAt as Date).getTime(),
      )[0];
      if (!found) return null;
      return {
        ...found,
        lineItems: db.invoiceLineItems.filter((r) => r.invoiceId === found.id),
      };
    },
  },
  invoiceCounter: {
    // Only ever increments, exactly like the real row.
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      const existing = db.invoiceCounters.find((c) => c.jobId === where.jobId);
      if (existing) {
        existing.lastNumber = Number(existing.lastNumber) + 1;
        return existing;
      }
      const row = { jobId: where.jobId, lastNumber: Number(create.lastNumber) };
      db.invoiceCounters.push(row);
      return row;
    },
  },
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(txClient),
};

const txClient = {
  invoiceCounter: prisma.invoiceCounter,
  invoice: {
    create: async ({ data }: { data: Row }) => {
      const id = `inv_${db.invoices.length + 1}`;
      const nested = (data.lineItems as { create: Row[] } | undefined)?.create ?? [];
      const invoice: Row = {
        id,
        jobId: data.jobId,
        number: data.number,
        description: data.description,
        amount: data.amount,
        dueAt: data.dueAt,
        retainageWithheld: data.retainageWithheld,
        issuedAt: clock,
      };
      db.invoices.push(invoice);
      for (const row of nested) {
        db.invoiceLineItems.push({ invoiceId: id, ...row });
      }
      return invoice;
    },
  },
};

const context = { id: "usr_1", role: "OWNER", jobFunction: null as string | null, company: { id: COMPANY_ID } };

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));

// Imported after the mocks, not at the top: both modules reach `@prova/db`,
// and a static import runs the mock factory before the fake above exists.
const { submitPayApplication } = await import("./actions/billing");
const { assemblePayApplication } = await import("./pay-application-query");

/** One period's submission, in the shape the form posts: one hidden
 * lineItemId per SOV row, and the two number fields beside it. */
function periodForm(fields: {
  thisPeriodBilled?: string;
  materialsStoredValue?: string;
  confirmCredit?: boolean;
  description?: string;
}) {
  const fd = new FormData();
  fd.set("description", fields.description ?? "Application for payment");
  fd.append("lineItemId", LINE_ID);
  fd.append("thisPeriodBilled", fields.thisPeriodBilled ?? "");
  fd.append("materialsStoredValue", fields.materialsStoredValue ?? "");
  if (fields.confirmCredit) fd.set("confirmCredit", "on");
  return fd;
}

/** The G702 summary for an invoice, from the same pure assembly the report
 * page uses — not a re-derivation written for this test. */
function certificateFor(invoiceId: string) {
  const assembly = assemblePayApplication({
    invoiceId,
    lineItems: db.lineItems as never,
    invoices: db.invoices.map((inv) => ({
      id: inv.id as string,
      number: inv.number as number,
      retainageWithheld: inv.retainageWithheld as string,
      lineItems: db.invoiceLineItems
        .filter((r) => r.invoiceId === inv.id)
        .map((r) => ({
          lineItemId: r.lineItemId as string,
          thisPeriodBilled: r.thisPeriodBilled as string,
          materialsStoredValue: r.materialsStoredValue as string,
        })),
    })),
  });
  if (!assembly) throw new Error("no assembly");
  return assembly.summary;
}

beforeEach(() => {
  db.jobs = [
    { id: JOB_ID, companyId: COMPANY_ID, status: "CONTRACTED", name: "Building C", retainagePercent: "10" },
  ];
  db.lineItems = [
    {
      id: LINE_ID,
      jobId: JOB_ID,
      description: "Metal stud framing",
      quantity: "1",
      unitPrice: "100000",
      isDeleted: false,
    },
  ];
  db.invoices = [];
  db.invoiceLineItems = [];
  db.invoiceCounters = [];
  clock = new Date("2026-03-01T12:00:00Z");
  context.role = "OWNER";
});

/** Period 1 of the reproduction: $5,000 of material stored, nothing
 * installed. Ordinary, accepted, and the setup for what follows. */
async function storeFiveThousand() {
  const first = await submitPayApplication(JOB_ID, periodForm({ materialsStoredValue: "5000" }));
  expect(first).toEqual({ ok: true });
  expect(db.invoices).toHaveLength(1);
  expect(db.invoices[0].amount).toBe("5000.00");
  expect(db.invoices[0].retainageWithheld).toBe("500.00");
  // A month passes before period 2, so the duplicate guard is not what is
  // being measured below.
  clock = new Date("2026-04-01T12:00:00Z");
}

describe("the release-without-the-positive that produced a negative certificate", () => {
  it("refuses the second period, and says what is wrong with it", async () => {
    await storeFiveThousand();

    const second = await submitPayApplication(
      JOB_ID,
      periodForm({ materialsStoredValue: "-5000" }),
    );

    expect(second.ok).toBe(false);
    const error = second.ok ? "" : second.error;
    // The figure the document would have carried, so the refusal is
    // checkable against the screen rather than a category of complaint.
    expect(error).toContain("$5,000.00");
    // The mistake this almost always is, named: the other half of the
    // two-part entry the form's own instruction describes.
    expect(error).toMatch(/this period/i);
    // And the door out, for the person who did mean a credit.
    expect(error).toMatch(/credit/i);

    // Nothing was written. A refusal that half-creates the document is
    // worse than the document.
    expect(db.invoices).toHaveLength(1);
    expect(db.invoiceLineItems).toHaveLength(1);
  });

  it("produced a −$5,000.00 invoice and a −$4,500.00 G702 before the guard existed", async () => {
    // THE REPRODUCTION, pinned as the thing that must not come back. Run
    // the same second period with the credit acknowledged and the figures
    // are exactly the ones the auditor recorded — which is the proof that
    // the refusal above is refusing the real defect and not a near miss.
    await storeFiveThousand();

    const second = await submitPayApplication(
      JOB_ID,
      periodForm({ materialsStoredValue: "-5000", confirmCredit: true }),
    );
    expect(second).toEqual({ ok: true });

    expect(db.invoices[1].amount).toBe("-5000.00");
    expect(db.invoices[1].retainageWithheld).toBe("-500.00");

    const summary = certificateFor(db.invoices[1].id as string);
    expect(summary.currentPaymentDue).toBe(-4500);
    expect(summary.totalCompletedAndStoredToDate).toBe(0);
    expect(summary.retainageToDate).toBe(0);
  });

  it("accepts the release when the matching positive is entered, which is the documented flow", async () => {
    await storeFiveThousand();

    const second = await submitPayApplication(
      JOB_ID,
      periodForm({ thisPeriodBilled: "5000", materialsStoredValue: "-5000" }),
    );

    expect(second).toEqual({ ok: true });
    // Nets zero: value moved from stored to completed, nothing newly
    // billed. No acknowledgement needed, because nothing went negative.
    expect(db.invoices[1].amount).toBe("0.00");
    expect(certificateFor(db.invoices[1].id as string).currentPaymentDue).toBe(0);
  });
});

describe("the deliberate credit stays possible", () => {
  it("lets an acknowledged credit through, because there is no other way to correct a sent invoice", async () => {
    // Period 1 over-bills the line: $60,000 claimed where $50,000 was
    // done. There is no deleteInvoice and no editInvoice in this app by
    // design, so April's application is the only place March can be
    // corrected.
    const first = await submitPayApplication(JOB_ID, periodForm({ thisPeriodBilled: "60000" }));
    expect(first).toEqual({ ok: true });
    clock = new Date("2026-04-01T12:00:00Z");

    const correction = await submitPayApplication(
      JOB_ID,
      periodForm({ thisPeriodBilled: "-10000", confirmCredit: true, description: "Correcting March" }),
    );

    expect(correction).toEqual({ ok: true });
    expect(db.invoices[1].amount).toBe("-10000.00");
    expect(db.invoices[1].retainageWithheld).toBe("-1000.00");

    // The certificate now states $50,000 completed to date, which is what
    // was actually built.
    const summary = certificateFor(db.invoices[1].id as string);
    expect(summary.totalCompletedAndStoredToDate).toBe(50000);
    expect(summary.currentPaymentDue).toBe(-9000);
  });

  it("absorbs the same correction into a period that also bills new work, with no acknowledgement", async () => {
    // The ordinary case, and the reason the guard is on the DOCUMENT and
    // not on the line: April bills $20,000 of real work and takes March's
    // $10,000 over-bill back on the same application. The total is
    // positive, so nothing is acknowledged and nothing is refused.
    const first = await submitPayApplication(JOB_ID, periodForm({ thisPeriodBilled: "60000" }));
    expect(first).toEqual({ ok: true });
    clock = new Date("2026-04-01T12:00:00Z");

    const fd = new FormData();
    fd.set("description", "April");
    fd.append("lineItemId", LINE_ID);
    fd.append("thisPeriodBilled", "10000");
    fd.append("materialsStoredValue", "");

    const april = await submitPayApplication(JOB_ID, fd);
    expect(april).toEqual({ ok: true });
    expect(db.invoices[1].amount).toBe("10000.00");
    expect(certificateFor(db.invoices[1].id as string).totalCompletedAndStoredToDate).toBe(70000);
  });

  it("refuses a correction larger than the line has ever been billed", async () => {
    // The bound on the new negative: you cannot un-bill work you never
    // billed. $60,000 billed, $70,000 taken back would leave the line at
    // −$10,000 completed to date, which is not a figure a G703 can carry.
    const first = await submitPayApplication(JOB_ID, periodForm({ thisPeriodBilled: "60000" }));
    expect(first).toEqual({ ok: true });
    clock = new Date("2026-04-01T12:00:00Z");

    const tooMuch = await submitPayApplication(
      JOB_ID,
      periodForm({ thisPeriodBilled: "-70000", confirmCredit: true }),
    );

    expect(tooMuch.ok).toBe(false);
    const error = tooMuch.ok ? "" : tooMuch.error;
    expect(error).toContain("Metal stud framing");
    expect(error).toContain("$70,000.00");
    expect(error).toContain("$60,000.00");
    expect(db.invoices).toHaveLength(1);
  });

  it("still refuses a zero-total application, which asks the GC for nothing", async () => {
    // Not new — `rows.length === 0` already covered an empty form. This
    // pins that the negative-total guard did not accidentally start
    // admitting a $0 document through a `< 0` comparison on an
    // application where every row cancels to nothing at all.
    const nothing = await submitPayApplication(JOB_ID, periodForm({ thisPeriodBilled: "0" }));
    expect(nothing.ok).toBe(false);
    expect(db.invoices).toHaveLength(0);
  });
});
