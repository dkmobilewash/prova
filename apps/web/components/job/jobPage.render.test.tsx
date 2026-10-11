import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/job-1/retainage" }));

const { JobStageNav } = await import("@/components/job/JobStageNav");
const { PayAppSummary } = await import("@/components/job/PayAppSummary");
const { jobStages } = await import("@/components/job/jobStages");

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
    expect(html).toContain('href="#pay-applications"');
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
});
