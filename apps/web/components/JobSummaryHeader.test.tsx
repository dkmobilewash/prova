import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { JobSummary } from "@/lib/jobs/job-summary";

const { JobSummaryHeader } = await import("./JobSummaryHeader");

const summary = (status: string): JobSummary =>
  ({
    id: "job-1",
    name: "Tower B",
    status,
    contactName: "Turner",
    startDate: null,
    endDate: null,
    crewSize: 0,
    contractValue: 380000,
    billedToDate: 0,
    retainageBalance: 0,
    lifecycle: { stage: "bidding", label: "Bidding", because: "", source: "status" },
  }) as unknown as JobSummary;

const markContracted = vi.fn(async () => ({ ok: true as const }));

/**
 * A won bid could not be moved to Contract: "Mark contracted" lived only at
 * the bottom of the estimate page and nothing on the five-step job page led
 * there. And the header called a bid's price "Contract" beside a "Left to
 * bill" for a job nobody had signed.
 */
describe("JobSummaryHeader on a bid", () => {
  it("labels the figure as the bid and drops the billing figures", () => {
    const html = renderToStaticMarkup(<JobSummaryHeader summary={summary("ESTIMATE")} showsJobMoney showsBilling />);
    expect(html).toContain(">Bid<");
    expect(html).not.toContain(">Contract<");
    expect(html).not.toContain("Left to bill");
    expect(html).not.toContain("Billed to date");
  });

  it("offers Mark contracted in the header once the contract is executed", () => {
    const html = renderToStaticMarkup(
      <JobSummaryHeader summary={summary("ESTIMATE")} showsJobMoney showsBilling contractSigned markContracted={markContracted} />,
    );
    expect(html).toContain("Won it?");
    expect(html).toContain("Mark as contracted");
  });

  it("sends an unsigned bid to Contract signature rather than a button that will refuse", () => {
    const html = renderToStaticMarkup(
      <JobSummaryHeader summary={summary("ESTIMATE")} showsJobMoney showsBilling markContracted={markContracted} />,
    );
    expect(html).toContain("Won it?");
    expect(html).toContain('href="/jobs/job-1#contract-signature"');
    expect(html).not.toContain("Mark as contracted");
  });
});

describe("JobSummaryHeader on a contracted job", () => {
  it("keeps Contract, Billed to date and Left to bill, and no Won it? box", () => {
    const html = renderToStaticMarkup(
      <JobSummaryHeader summary={summary("CONTRACTED")} showsJobMoney showsBilling contractSigned markContracted={markContracted} />,
    );
    expect(html).toContain(">Contract<");
    expect(html).toContain("Billed to date");
    expect(html).toContain("Left to bill");
    expect(html).not.toContain("Won it?");
  });
});
