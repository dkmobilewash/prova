import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /cash-flow with money on it — issue #288.
 *
 * `empty-states.test.ts` renders this page with NO invoices, which is the
 * only render coverage it had. That is exactly the wrong half for a money
 * defect: every figure this page gets wrong needs an invoice to get wrong.
 *
 * WHY THIS RENDERS RATHER THAN CALLING THE CALCULATORS. Those are unit
 * tested in lib/cash-flow.test.ts. What no unit test can see is the page
 * FORGETTING TO PASS the retainage column into them — the assembly, not the
 * arithmetic — which is the shape of this whole bug: the column was two
 * lines away from the balance that ignored it, in this file, for months.
 *
 * The fixture is the issue's own example: $100,000 billed, $10,000 retained,
 * the GC paid the $90,000 an AIA G702 certifies as due, four months ago.
 */

/** One job, one invoice, and `paid` is the only thing any test varies. */
function jobsWithPaid(paid: number) {
  return [
    {
      id: "job-1",
      name: "Riverside Medical",
      substantialCompletionDate: new Date("2026-11-15T00:00:00.000Z"),
      contact: { name: "Acme GC", paymentTermsDays: 30 },
      invoices: [
        {
          id: "inv-1",
          amount: 100_000,
          retainageWithheld: 10_000,
          issuedAt: new Date("2026-05-01T00:00:00.000Z"),
          dueAt: new Date("2026-05-31T00:00:00.000Z"),
          payments: [{ amount: paid }],
        },
      ],
      retainageReleases: [],
    },
  ];
}

let jobs = jobsWithPaid(90_000);

const context = {
  company: { id: "company-1", name: "Test Drywall" },
  id: "user-1",
  name: "Tester",
  email: null,
  role: "OWNER",
  jobFunction: null,
};

vi.mock("@prova/db", () => ({
  prisma: { job: { findMany: vi.fn(async () => jobs) } },
  Prisma: {},
}));
vi.mock("@/lib/authz", () => ({ requireCapability: vi.fn(async () => ({ allowed: true, context })) }));

async function render() {
  const { default: Page } = await import("@/app/(app)/cash-flow/page");
  return renderToStaticMarkup(await Page());
}

describe("/cash-flow on an invoice settled to its net amount", () => {
  it("does not put the withheld retainage in the aging table", async () => {
    const html = await render();
    // Anti-vacuity first: this really is the page, with the invoice's job
    // on it, so the absences below are absences from a rendered table.
    expect(html).toContain("Accounts receivable aging");
    expect(html).toContain("Retainage receivable");

    // THE DEFECT: $10,000 in the 90+ bucket and a row reading "108d
    // overdue" against a GC who had paid every dollar they were certified
    // to pay. Both are gone; the aging section is empty instead.
    expect(html).toContain("Nothing outstanding");
    expect(html).not.toContain("overdue");
  });

  it("still shows the retainage as retainage, dated by completion", async () => {
    // The money did not disappear when it stopped ageing — that would be
    // the opposite defect, and on this page it would be invisible.
    const html = await render();
    expect(html).toContain("$10,000.00");
    expect(html).toContain("Nov 15, 2026");
  });

  it("says what it netted out rather than quietly showing a lighter table", async () => {
    // The house rule: never show a figure that looks complete and is not.
    // This one needs an invoice that is still partly owed, so there is an
    // aging table for the caveat to sit under.
    jobs = jobsWithPaid(30_000);
    const html = await render();
    expect(html).toContain("net of $10,000.00 of retainage");
    jobs = jobsWithPaid(90_000);
  });
});

describe("/cash-flow on a part-paid invoice, where the aging table is not empty", () => {
  // $100,000 billed, $10,000 retained, $30,000 paid. Sixty thousand is
  // overdue; ten thousand is retainage due at completion. The old code aged
  // $70,000 — the retainage twice, once here and once in the section below.
  it("ages the amount actually owed now, not that plus the retainage", async () => {
    jobs = jobsWithPaid(30_000);
    const html = await render();
    expect(html).toContain("Total outstanding: $60,000.00");
    // The number the defect produced. It is a real string on this page
    // under the old rule — the aging total, the 90+ bucket, the row
    // balance and the Overdue forecast row all rendered it.
    expect(html).not.toContain("$70,000.00");
    jobs = jobsWithPaid(90_000);
  });
});
