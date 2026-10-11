import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/job-1/retainage", useSearchParams: () => new URLSearchParams() }));

const { JobStageNav } = await import("@/components/job/JobStageNav");
const { PayAppSummary } = await import("@/components/job/PayAppSummary");
const { jobStages } = await import("@/components/job/jobStages");
const { payAppMonth } = await import("@/components/job/payAppFigures");

const stages = jobStages({
  jobId: "job-1",
  status: "IN_PROGRESS",
  lifecycleStage: "in_progress",
  showsJobMoney: true,
  showsBilling: true,
  showsField: true,
  canReachPunchList: true,
  canReachCloseout: true,
  crewSize: 3,
  contractSigned: false,
  approvedChangeOrders: 0,
  invoiceCount: 1,
  latestPayApp: null,
  asOf: new Date("2026-10-10T00:00:00.000Z"),
});

describe("JobStageNav", () => {
  const html = renderToStaticMarkup(<JobStageNav stages={stages} />);

  it("opens the stage holding the current page and lists its pages underneath", () => {
    expect(html).toContain('aria-label="Billing pages"');
    const anchor = (href: string) => html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0] ?? "";
    expect(anchor("/jobs/job-1/retainage")).toContain('aria-current="page"');
    // The Billing STEP is the open stage; the Billing sub-link is not the open page.
    expect(anchor("/jobs/job-1/billing")).toContain('aria-current="true"');
  });

  it("links every stage that has a page to its first one", () => {
    for (const href of ["/jobs/job-1/takeoff", "/jobs/job-1", "/jobs/job-1/crew", "/punch-lists?job=job-1"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("numbers the current stage, ticks the finished ones and flags the unsigned contract", () => {
    expect(html).toContain("(current stage)");
    // Estimate and Crew are done; Contract was passed WITHOUT a signature,
    // so it is amber "!" rather than a tick beside its own "Not signed".
    expect((html.match(/✓/g) ?? []).length).toBe(2);
    expect(html).toContain("(needs attention)");
    expect(html).toMatch(/text-tag-amber-ink">Not signed</);
  });
});

describe("PayAppSummary", () => {
  it("is honest when there is no pay application", () => {
    const html = renderToStaticMarkup(<PayAppSummary jobId="job-1" gcName="Turner" nextNumber={2} payApp={null} asOf={new Date("2026-10-10T00:00:00.000Z")} />);
    expect(html).toContain("No pay application yet");
    expect(html).toContain('href="#new-pay-application"');
    expect(html).toContain("Start pay app #2");
    expect(html).not.toContain("$");
  });

  it("prints the certificate's figures and links to its Review page", () => {
    const html = renderToStaticMarkup(
      <PayAppSummary
        jobId="job-1"
        gcName="Turner"
        nextNumber={5}
        payApp={{
          id: "inv-4",
          number: 4,
          month: "October",
          dueAt: new Date("2026-10-17T00:00:00.000Z"),
          status: "SUBMITTED",
          figures: { contractSum: 1000, billedBefore: 400, thisPeriod: 150, left: 450, retainageHeld: 55, youllBePaid: 135 },
        }}
        asOf={new Date("2026-10-10T00:00:00.000Z")}
      />,
    );
    expect(html).toContain("Pay application #4 · October");
    expect(html).toContain("$150.00");
    expect(html).toContain("15% of contract");
    expect(html).toContain("$55.00");
    expect(html).toContain("$135.00");
    expect(html).toMatch(/bg-tag-amber[^"]*">Due Oct 17</);
    expect(html).toContain('href="/jobs/job-1/pay-applications/inv-4"');
  });

  const pill = (dueIso: string, asOfIso: string, status = "SUBMITTED") =>
    renderToStaticMarkup(
      <PayAppSummary
        jobId="job-1"
        gcName="Turner"
        nextNumber={3}
        payApp={{
          id: "inv-2",
          number: 2,
          month: "September",
          dueAt: new Date(`${dueIso}T00:00:00.000Z`),
          status,
          figures: { contractSum: 1000, billedBefore: 0, thisPeriod: 100, left: 900, retainageHeld: 10, youllBePaid: 90 },
        }}
        asOf={new Date(`${asOfIso}T00:00:00.000Z`)}
      />,
    );

  it("a due date in the past reads 'Overdue N days' in the danger tone, not a neutral 'Due Oct 2'", () => {
    const html = pill("2026-10-02", "2026-10-10");
    expect(html).toMatch(/bg-tag-rose text-tag-rose-ink">Overdue 8 days</);
    expect(html).not.toContain("Due Oct 2");
  });

  it("due today is due, all day — not overdue", () => {
    expect(pill("2026-10-10", "2026-10-10")).toMatch(/bg-tag-amber[^"]*">Due Oct 10</);
  });

  it("a paid pay app is never overdue", () => {
    const html = pill("2026-10-02", "2026-10-10", "PAID");
    expect(html).toContain(">Paid<");
    expect(html).not.toContain("Overdue");
  });

  // Guidelines review 2026-10-10: the yellow button said "Review & send to
  // Turner" on a pay app Turner had already paid or disputed.
  it("names the primary action for where the pay app is", () => {
    expect(pill("2026-10-17", "2026-10-10", "SUBMITTED")).toContain("Review &amp; send to Turner");
    for (const [status, text] of [
      ["APPROVED", "View pay app #2"],
      ["PARTIALLY_PAID", "View pay app #2"],
      ["PAID", "View paid pay app #2"],
      ["DISPUTED", "Review dispute"],
    ]) {
      const html = pill("2026-10-17", "2026-10-10", status);
      expect(html, status).toContain(text);
      expect(html, status).not.toContain("send to");
    }
  });

  it("'Start pay app' opens the form instead of only scrolling to it", () => {
    expect(pill("2026-10-17", "2026-10-10")).toContain('href="#new-pay-application"');
  });
});

describe("JobStageNav on a phone", () => {
  const html = renderToStaticMarkup(<JobStageNav stages={stages} />);
  it("shows each stage's status at every width — never only in a title", () => {
    expect(html).toMatch(/text-tag-amber-ink">Not signed</);
    expect(html).not.toMatch(/hidden truncate[^"]*sm:block/);
  });

  // "Pay app #2 overdue 8 d…" at 1555px (2026-10-11): a status is cut only
  // on a phone pill, and the stage in view says it in full under the row.
  // The equal heights and the wrap itself are layout — measured in Chromium.
  it("cuts a status short only on a phone, and says the open stage's in full", () => {
    const statuses = [...html.matchAll(/class="(mt-\[3px\][^"]*)"/g)].map((m) => m[1]!);
    expect(statuses).toHaveLength(5);
    for (const c of statuses) {
      expect(c).not.toMatch(/(^|\s)truncate/);
      expect(c).toContain("max-sm:truncate");
    }
    expect(html).toMatch(/data-stage-open-status[^>]*>.*?Billing:.*?>1 invoice</);
  });
});

describe("payAppMonth", () => {
  const asOf = new Date("2026-10-10T00:00:00.000Z");
  it("says the year only when it is not this year, in the reader's zone", () => {
    expect(payAppMonth(new Date("2026-10-05T15:00:00.000Z"), "America/Los_Angeles", asOf)).toBe("October");
    expect(payAppMonth(new Date("2025-10-05T15:00:00.000Z"), "America/Los_Angeles", asOf)).toBe("October 2025");
    // 03:00 UTC on Jan 1 is still Dec 31 in Los Angeles.
    expect(payAppMonth(new Date("2026-01-01T03:00:00.000Z"), "America/Los_Angeles", asOf)).toBe("December 2025");
  });
});
