import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { projectPanelView, type ProjectRow } from "@/lib/bid-project-view";

/**
 * What an invitation's row says about the job it is for. The data
 * (`projectPanelView`) and the words (`BidProjectPanel`) are checked together,
 * because the claim worth guarding is a sentence a person reads: that a GC the
 * prime went elsewhere on reads "Didn't get the job" and not "lost", and that
 * two GCs on one job read as one job.
 */

vi.mock("@/lib/actions", () => {
  const action = async () => ({ ok: true });
  return {
    mergeIntoProject: action,
    recordPrimeAward: action,
    saveBidProject: action,
    splitFromProject: action,
    startEstimateFromProject: action,
  };
});

const { BidProjectPanel } = await import("./BidProjectPanel");

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const dec = (n: number) => ({ toString: () => String(n) });

function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    name: "Westside Medical Office",
    siteAddress: null,
    siteCity: null,
    owner: null,
    architect: null,
    bidDueDate: null,
    primeAwardedContactId: null,
    primeAwardedName: null,
    primeAwardedOn: null,
    primeAwardedContact: null,
    estimateJob: null,
    invitations: [
      { id: "i1", contactId: "acme", status: "SUBMITTED", bidAmount: dec(412300), contact: { name: "Acme GC" } },
      { id: "i2", contactId: "buildco", status: "INVITED", bidAmount: null, contact: { name: "BuildCo" } },
    ],
    ...over,
  };
}

const acme = { id: "i1", contactId: "acme", bidAmount: dec(412300), contact: { name: "Acme GC" } };
const render = (row: ProjectRow, view = projectPanelView(row, acme, money)) =>
  renderToStaticMarkup(
    createElement(BidProjectPanel, {
      view,
      projectChoices: [{ id: "p2", label: "Harbor Lofts — Turner" }],
      gcs: [{ id: "acme", name: "Acme GC" }],
    }),
  );

describe("the project line on an invitation", () => {
  it("says two GCs are one job, each with its own status", () => {
    const html = render(project());
    expect(html).toContain("Same job, 2 GCs:");
    expect(html).toContain("Acme GC");
    expect(html).toContain("(submitted)");
    expect(html).toContain("(invited)");
    // Offers the way to start the one estimate, and the way back out.
    expect(html).toContain("Start the estimate");
    expect(html).toContain("Not the same job as the others");
  });

  it("says nothing about other GCs for a job with only one", () => {
    const html = render(project({ invitations: [project().invitations[0]] }));
    expect(html).not.toContain("Same job,");
    expect(html).not.toContain("Not the same job as the others");
  });

  it("reads 'Didn't get the job' only for a GC the prime went elsewhere from", () => {
    const awarded = project({ primeAwardedContactId: "buildco", primeAwardedContact: { name: "BuildCo" } });
    expect(render(awarded)).toContain("Didn&#x27;t get the job");
    // For the winner's own row it is just the award.
    const winnerView = projectPanelView(awarded, { id: "i2", contactId: "buildco", bidAmount: null, contact: { name: "BuildCo" } }, money);
    const winnerHtml = render(awarded, winnerView);
    expect(winnerHtml).toContain("awarded to BuildCo");
    expect(winnerHtml).not.toContain("get the job");
    // Nothing entered, nothing said: unknown is not a loss.
    expect(render(project())).not.toContain("get the job");
  });

  it("links the one estimate and compares the price sent with its total, in words", () => {
    const html = render(
      project({
        estimateJob: {
          id: "job-1",
          name: "Westside Medical Office",
          lineItems: [
            { quantity: dec(100), unitPrice: dec(4) },
            { quantity: dec(1), unitPrice: dec(436600) },
            { quantity: dec(5), unitPrice: null },
          ],
        },
      }),
    );
    expect(html).toContain('href="/jobs/job-1"');
    expect(html).toContain("one estimate prices to every GC above");
    expect(html).toContain("$412,300 sent to Acme GC; the estimate totals $437,000.");
    // And the start button is gone: there is one estimate and it exists.
    expect(html).not.toContain("Start the estimate");
  });
});
