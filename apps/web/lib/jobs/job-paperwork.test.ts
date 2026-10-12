import { describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));

const { jobPaperworkLinks } = await import("./job-paperwork");

const COUNTS = { openRfis: 2, submittals: 3, openPunchItems: 4, drawingSets: 1, materialOrders: 5, lienWaivers: 0 };

describe("jobPaperworkLinks", () => {
  it("links every job-scoped list, pre-filtered to this job, with the count it will show", () => {
    const links = jobPaperworkLinks({ role: "OWNER", jobFunction: null }, "job-1", COUNTS);
    expect(links).toEqual([
      { href: "/rfis?job=job-1", label: "RFIs", detail: "2 open" },
      { href: "/submittals?job=job-1", label: "Submittals", detail: "3" },
      { href: "/punch-lists?job=job-1", label: "Punch list", detail: "4 open" },
      { href: "/drawings?job=job-1", label: "Drawings", detail: "1 set" },
      { href: "/material-orders?job=job-1", label: "Material orders", detail: "5" },
    ]);
  });

  it("says how many RFIs have waited a week+ with no due date", () => {
    const links = jobPaperworkLinks({ role: "OWNER", jobFunction: null }, "job-1", { ...COUNTS, waitingRfis: 1 });
    expect(links[0]).toEqual({ href: "/rfis?job=job-1", label: "RFIs", detail: "2 open · 1 waiting a week+" });
  });

  it("offers only the lists this viewer can open", () => {
    // ESTIMATOR holds MANAGE_JOBS (RFIs, submittals, drawings) but not
    // MANAGE_FIELD (punch list, material orders).
    const hrefs = jobPaperworkLinks({ role: "MEMBER", jobFunction: "ESTIMATOR" }, "job-1", COUNTS).map(
      (l) => l.href.split("?")[0],
    );
    expect(hrefs).toEqual(["/rfis", "/submittals", "/drawings"]);
  });
});
