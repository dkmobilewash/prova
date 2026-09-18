/**
 * Which job a daily field report lands on — the default, and the filter.
 *
 * The default is the one that cost something. `/field-reports` handed the
 * composer every job `orderBy: { name: "asc" }` and the composer took
 * `jobs[0]`, so the preselected job was the alphabetically first job the
 * company had ever had, estimates and closed-out jobs included. Work
 * performed is the only field a foreman types, so on any day the alphabet
 * disagreed with the schedule, the one thing he wrote was filed against the
 * wrong job and nothing on screen said so.
 *
 * Why no test caught it: there was nothing to catch it WITH. `jobs[0]?.id`
 * was an expression inside a component, not a function, so the only way to
 * assert anything about it was to render the component — which the suite can
 * now do (see fieldReportComposer.test.ts) but nobody had. The rule is
 * extracted here so the decision has a name and a test, and the component
 * test proves the component still calls it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_FIELD_JOB_STATUSES,
  activeFieldJobs,
  defaultFieldReportJobId,
  fieldReportJobWhere,
  fieldReportsFilterHref,
  isActiveFieldJob,
  resolveFieldReportJobFilter,
} from "@/lib/field-report-jobs";
import { JOB_STATUSES } from "@/lib/job-status-transitions";

const job = (id: string, status: string | null) => ({ id, status });

describe("which statuses count as active", () => {
  it("is exactly CONTRACTED and IN_PROGRESS", () => {
    expect([...ACTIVE_FIELD_JOB_STATUSES]).toEqual(["CONTRACTED", "IN_PROGRESS"]);
  });

  /* The set is derived from JOB_STATUSES rather than retyped, so a status
   * added to the schema later shows up here as a decision somebody has to
   * make rather than silently joining or missing the active set. */
  it("classifies every status the app has, and leaves ESTIMATE and COMPLETE out", () => {
    const verdicts = JOB_STATUSES.map((status) => [status, isActiveFieldJob(job("j", status))]);
    expect(verdicts).toEqual([
      ["ESTIMATE", false],
      ["CONTRACTED", true],
      ["IN_PROGRESS", true],
      ["COMPLETE", false],
    ]);
    expect(JOB_STATUSES.length).toBe(4);
  });

  it("treats a status it does not recognise as not active", () => {
    expect(isActiveFieldJob(job("j", "WARRANTY"))).toBe(false);
    expect(isActiveFieldJob(job("j", null))).toBe(false);
  });

  it("filters a mixed list down to the running jobs", () => {
    const jobs = [
      job("estimate", "ESTIMATE"),
      job("running", "IN_PROGRESS"),
      job("done", "COMPLETE"),
      job("signed", "CONTRACTED"),
    ];
    expect(activeFieldJobs(jobs).map((j) => j.id)).toEqual(["running", "signed"]);
  });
});

describe("the composer's default job", () => {
  it("does NOT take the alphabetically first job — the bug this replaces", () => {
    // Sorted by name, which is the order the page hands them over in.
    const jobs = [
      job("aspen-estimate", "ESTIMATE"),
      job("brackett-riverside", "IN_PROGRESS"),
      job("cedar-closed", "COMPLETE"),
    ];
    expect(defaultFieldReportJobId(jobs)).toBe("brackett-riverside");
    expect(defaultFieldReportJobId(jobs)).not.toBe(jobs[0].id);
  });

  it("defaults to the one active job when there is exactly one", () => {
    expect(defaultFieldReportJobId([job("a", "ESTIMATE"), job("b", "CONTRACTED")])).toBe("b");
  });

  it("refuses to guess between two active jobs", () => {
    const jobs = [job("a", "IN_PROGRESS"), job("b", "CONTRACTED"), job("c", "COMPLETE")];
    expect(defaultFieldReportJobId(jobs)).toBe("");
  });

  it("refuses to guess when nothing is active, rather than falling back to a closed job", () => {
    expect(defaultFieldReportJobId([job("a", "ESTIMATE"), job("b", "COMPLETE")])).toBe("");
    expect(defaultFieldReportJobId([])).toBe("");
  });

  it("honours an explicitly chosen job whatever its status", () => {
    const jobs = [job("running", "IN_PROGRESS"), job("closed", "COMPLETE")];
    // A late report against a job that just closed is a real errand, and the
    // person said which job by filtering the page to it.
    expect(defaultFieldReportJobId(jobs, "closed")).toBe("closed");
  });

  it("ignores a chosen job this company does not have", () => {
    const jobs = [job("running", "IN_PROGRESS")];
    expect(defaultFieldReportJobId(jobs, "someone-elses-job")).toBe("running");
    expect(defaultFieldReportJobId([job("a", "COMPLETE")], "someone-elses-job")).toBe("");
  });
});

describe("the ?job= filter", () => {
  const jobs = [{ id: "riverside" }, { id: "lakeshore" }];

  it("narrows the query to that job", () => {
    const active = resolveFieldReportJobFilter(jobs, "riverside");
    expect(active).toBe("riverside");
    expect(fieldReportJobWhere(active)).toEqual({ jobId: "riverside" });
  });

  it("is no filter at all when absent", () => {
    expect(resolveFieldReportJobFilter(jobs, undefined)).toBeNull();
    expect(fieldReportJobWhere(null)).toEqual({});
  });

  it("ignores an id this company does not have, rather than showing an empty log", () => {
    // An empty page reads as "nobody has filed anything", which is a much
    // worse answer than "here is everything".
    expect(resolveFieldReportJobFilter(jobs, "another-companys-job")).toBeNull();
    expect(resolveFieldReportJobFilter(jobs, "")).toBeNull();
  });

  it("builds hrefs that keep the page addressable", () => {
    expect(fieldReportsFilterHref("riverside")).toBe("/field-reports?job=riverside");
    expect(fieldReportsFilterHref(null)).toBe("/field-reports");
    expect(fieldReportsFilterHref("a b&c")).toBe("/field-reports?job=a+b%26c");
  });
});

/**
 * The half a pure test cannot see: whether the PAGE uses any of this.
 *
 * No test in this repo can render `/field-reports` — it is a server
 * component that queries Postgres — so the query's `where` is out of reach.
 * CLAUDE.md records three separate cases of code that was written,
 * documented and never called, every one of them green the whole time. This
 * is a source scan, and per the same file's rule it asserts the SIZE of what
 * it read against something that cannot drift with the thing being checked:
 * a pattern that matches nothing must fail loudly rather than pass silently.
 */
describe("the page actually uses the filter", () => {
  const pagePath = fileURLToPath(
    new URL("../app/(app)/field-reports/page.tsx", import.meta.url),
  );
  const source = readFileSync(pagePath, "utf8");

  it("read a page that is still the field reports page", () => {
    expect(source.length).toBeGreaterThan(2000);
    expect(source).toContain("export default async function FieldReportsPage");
    expect(source).toContain("prisma.dailyFieldReport.findMany");
  });

  it("spreads the job filter into the report query", () => {
    expect(source).toContain("...fieldReportJobWhere(activeJob)");
  });

  it("hands the composer the filtered job as its default", () => {
    expect(source).toContain("defaultJobId={activeJob ?? undefined}");
  });
});
