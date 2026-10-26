import { describe, expect, it } from "vitest";
import { surfaceHrefs } from "./surfaceHrefs";

/**
 * THE CRM HALF OF `surfaceHrefs` IS TODAY'S HREFS, BYTE FOR BYTE.
 *
 * C Stream Bid's links are decided by `bidLinkCensus.test.ts` (it classifies
 * every Bid value). This file guards the other direction: the shared components
 * default to — and the CRM pages pass — the CRM values, and "every CRM page
 * behaves exactly as before" is only true while these strings are the ones the
 * components used to hard-code. Each line below is a literal that was in a
 * component or page before the surface existed; a change here changes the CRM.
 */
describe("surfaceHrefs(\"crm\", id) is what the components used to hard-code", () => {
  const crm = surfaceHrefs("crm", "job_1");

  it("pins every value", () => {
    expect(crm).toEqual({
      home: "/dashboard",
      homeLabel: "Back to jobs",
      wallTypes: "/wall-types",
      bids: "/bids",
      estimate: "/jobs/job_1/estimate",
      takeoff: "/jobs/job_1/takeoff",
      workspace: "/takeoff/job_1",
      legend: "/jobs/job_1/takeoff/legend",
      recap: "/jobs/job_1/estimate",
      proposal: "/jobs/job_1/proposal",
      clauseLibrary: "/proposals",
      estimatingSettings: "/settings?tab=estimating",
      messageLog: "/messages",
    });
  });

  it("the shared components' own defaults agree with it", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
    expect(read("components/WallSchedule.tsx")).toContain(`wallTypesHref = "${crm.wallTypes}"`);
    expect(read("components/TakeoffAssemblyPanel.tsx")).toContain(`wallTypesHref = "${crm.wallTypes}"`);
    expect(read("components/TakeoffWorkspace.tsx")).toContain(`wallTypesHref = "${crm.wallTypes}"`);
    expect(read("components/TakeoffCurrencyBanner.tsx")).toContain(`bidsHref = "${crm.bids}"`);
    expect(read("components/ProposalClauses.tsx")).toContain(`libraryHref = "${crm.clauseLibrary}"`);
    expect(read("components/BidPackageBuilder.tsx")).toContain(`messageLogHref = "${crm.messageLog}"`);
    expect(read("components/NoAccess.tsx")).toContain(`homeHref = "${crm.home}"`);
    // TakeoffWorkspace's back link defaults to the estimate of ITS job id.
    expect(read("components/TakeoffWorkspace.tsx")).toContain("backHref = `/jobs/${jobId}/estimate`");
  });
});

describe("surfaceHrefs(\"bid\", id)", () => {
  const bid = surfaceHrefs("bid", "job_1");

  it("keys every job-scoped link on the job's own Bid estimate", () => {
    expect(bid.estimate).toBe("/bid/estimates/job_1/estimate");
    expect(bid.takeoff).toBe("/bid/estimates/job_1/takeoff");
    expect(bid.recap).toBe("/bid/estimates/job_1/recap");
    expect(bid.proposal).toBe("/bid/estimates/job_1/proposal");
    expect(bid.legend).toBe("/bid/estimates/job_1/takeoff/legend");
    expect(bid.workspace).toBe("/bid/workspace/job_1");
  });

  it("has no message log (Bid draws no link rather than a dead one)", () => {
    expect(bid.messageLog).toBeNull();
  });
});
