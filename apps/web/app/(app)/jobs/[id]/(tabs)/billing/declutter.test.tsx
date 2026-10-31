// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Job → Billing, declutter round 2. The tab listed every pay application
 * twice — once as an invoice card, once in PayApplications' own list — each
 * copy with its own status select; printed "QuickBooks isn't connected."
 * under every invoice and every payment; and opened on a Create invoice form.
 * These render the real page against mocked data and count.
 */

const { invoices, ACTIONS } = vi.hoisted(() => ({
  invoices: { rows: [] as unknown[] },
  ACTIONS: [
    "createInvoice",
    "deletePayment",
    "logPayment",
    "submitPayApplication",
    "updateInvoiceStatus",
    "pushInvoiceToQuickBooks",
    "pushPaymentToQuickBooks",
    "createLienWaiver",
    "markLienWaiverSigned",
    "revokeLienWaiver",
    "updateLienWaiver",
  ],
}));

function invoice(n: number, payApp: boolean, payments: { id: string; amount: number }[] = []) {
  return {
    id: `inv-${n}`,
    number: n,
    description: null,
    amount: 1000 * n,
    retainageWithheld: null,
    status: "SUBMITTED",
    issuedAt: new Date("2026-09-01T12:00:00Z"),
    dueAt: new Date("2026-12-01T00:00:00Z"),
    lineItems: payApp ? [{ lineItemId: "li-1", materialsStoredValue: 0, thisPeriodBilled: 1000 * n }] : [],
    payments: payments.map((p) => ({
      ...p,
      receivedAt: new Date("2026-09-10T00:00:00Z"),
      method: null,
      note: null,
      feeAmount: null,
      feeSource: null,
    })),
  };
}

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findUnique: vi.fn(async () => ({
        id: "job-1",
        contactId: "contact-1",
        contact: { id: "contact-1", name: "Acme GC" },
        lineItems: [{ id: "li-1", description: "Framing", quantity: 1, unitPrice: 50000 }],
        invoices: invoices.rows,
      })),
    },
    quickBooksConnection: { findUnique: vi.fn(async () => null) },
    quickBooksEntityLink: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    quickBooksAccountMapping: { findUnique: vi.fn(async () => null) },
    invoiceCounter: { findUnique: vi.fn(async () => ({ lastNumber: 3 })) },
    timeEntry: { groupBy: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/jobs/job-access", () => ({
  requireJob: vi.fn(async () => ({
    company: { id: "c1", filesMonthlyPayApps: true },
    principal: {},
    job: { id: "job-1", status: "IN_PROGRESS" },
  })),
  jobCapabilities: () => ({ showsBilling: true }),
}));
vi.mock("@/lib/viewerToday", () => ({
  viewerAsOf: vi.fn(async () => new Date("2026-10-14T00:00:00Z")),
  viewerTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/lien-waiver-query", () => ({
  loadLienWaiverSection: vi.fn(async () => ({
    waivers: [
      {
        id: "w1",
        condition: "CONDITIONAL",
        stage: "PROGRESS",
        throughDate: new Date("2026-09-30T00:00:00Z"),
        amount: 1000,
        exceptedAmount: 0,
        exceptionsNote: null,
        status: "PENDING",
        signedAt: null,
        signerName: null,
        revokedAt: null,
        invoiceId: null,
        invoiceNumber: null,
      },
    ],
    invoices: [],
    retainageBalance: 0,
    pendingChangeOrderTotal: 0,
  })),
  // The lower-tier check reads nothing here: no vendors, no inbound waivers,
  // so no warning line enters the count below.
  loadLowerTierWaiverInputs: vi.fn(async () => ({ parties: [], inbound: [] })),
}));
vi.mock("@/lib/pay-application-query", () => ({ loadPayApplication: vi.fn(async () => ({})) }));
vi.mock("@/components/job/PayAppSummary", () => ({ PayAppSummary: () => null }));
vi.mock("@/components/job/payAppFigures", async (original) => ({
  ...(await original<typeof import("@/components/job/payAppFigures")>()),
  payAppFigures: () => ({}),
}));
vi.mock("@/lib/actions", () => Object.fromEntries(ACTIONS.map((name) => [name, vi.fn()])));

const { default: Page } = await import("./page");
const { LienWaivers } = await import("@/components/LienWaivers");

async function render(rows: unknown[], all?: string) {
  invoices.rows = rows;
  return renderToStaticMarkup(
    await Page({ params: Promise.resolve({ id: "job-1" }), searchParams: Promise.resolve({ all }) }),
  );
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("Job → Billing lists each pay application once", () => {
  // Two pay applications (with line items) and one lump-sum invoice; one
  // payment on the first.
  const rows = () => [invoice(1, true, [{ id: "pay-1", amount: 500 }]), invoice(2, true), invoice(3, false)];

  it("one row and ONE status select per invoice — pay applications are not listed a second time", async () => {
    const html = await render(rows());
    expect(count(html, /<select name="status"/g)).toBe(3);
    // The second list's link text, once per pay application, on its row.
    expect(count(html, />Application #\d+</g)).toBe(2);
    expect(count(html, /View pay application →/g)).toBe(2);
    expect(count(html, /<details[^>]*name="pay-app"/g)).toBe(3);
    // The issued date that only the second list used to show.
    expect(html).toContain("issued Sep 1, 2026");
  });

  it("opens the newest row and leaves the older ones as one line", async () => {
    const html = await render(rows());
    const details = html.match(/<details[^>]*name="pay-app"[^>]*>/g) ?? [];
    expect(details.map((tag) => tag.includes(" open"))).toEqual([false, false, true]);
  });

  it("says 'QuickBooks isn't connected.' once, above the list, and keeps every push button", async () => {
    const html = await render(rows());
    expect(count(html, /QuickBooks isn(&#x27;|')t connected\./g)).toBe(1);
    expect(count(html, />Send to QuickBooks</g)).toBe(3);
    expect(count(html, />Send payment to QuickBooks</g)).toBe(1);
  });

  it("keeps Create invoice and the pay-app form behind buttons, and the SOV prose in one closed disclosure", async () => {
    const html = await render(rows());
    expect(html).toContain(">Create invoice</button>");
    expect(html).not.toContain('placeholder="Deposit, final payment, etc."');
    expect(html).toContain(">Submit pay application</button>");
    expect(html).not.toContain('name="thisPeriodBilled"');
    expect(html).toMatch(/<details[^>]*><summary[^>]*>How pay applications work<\/summary>[\s\S]*Once stored material gets installed/);
  });

  it("caps the list at the latest 7 with See all, and ?all=1 shows every row", async () => {
    const many = Array.from({ length: 9 }, (_, i) => invoice(i + 1, true));
    const capped = await render(many);
    expect(count(capped, /<select name="status"/g)).toBe(7);
    expect(capped).toContain("See all 9");
    const all = await render(many, "1");
    expect(count(all, /<select name="status"/g)).toBe(9);
  });

  it("keeps the lien-waivers anchor rendered, with the list collapsed", async () => {
    const html = await render(rows());
    expect(html).toContain('id="lien-waivers"');
    expect(html).toMatch(/<details[^>]*><summary[^>]*>1 waiver on this job<\/summary>/);
    expect(html).toContain(">Issue a waiver</button>");
  });
});

describe("LienWaivers opens its list for a #lien-waivers link", () => {
  it("is open after mount when the URL hash names the section", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const section = (await (await import("@/lib/lien-waiver-query")).loadLienWaiverSection("job-1"));
    const container = document.createElement("div");
    document.body.append(container);
    window.location.hash = "#lien-waivers";
    const root = createRoot(container);
    await act(async () => root.render(<LienWaivers jobId="job-1" section={section} canManage />));
    expect(container.querySelector("#lien-waivers details")?.hasAttribute("open")).toBe(true);
    act(() => root.unmount());
    window.location.hash = "";
  });
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
