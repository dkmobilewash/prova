import { describe, expect, it } from "vitest";
import { pageContextSentence, parsePageContext } from "./page-context";

const ID = "cmtx3b4x20007d0pe9ebyh1m4";

describe("parsePageContext", () => {
  it("reads a job id off a job page", () => {
    expect(parsePageContext(`/jobs/${ID}`)).toEqual({ kind: "job", id: ID });
  });

  it("reads it off every child route, because they are all about that job", () => {
    // A pay application, the photo report and certified payroll are the
    // same job seen three ways. A hint that only worked on the job's own
    // page would go quiet exactly where the person is deepest in the work.
    for (const suffix of ["/certified-payroll", "/photo-report", "/pay-applications/abc", "/certified-payroll/wh-347"]) {
      expect(parsePageContext(`/jobs/${ID}${suffix}`), suffix).toEqual({ kind: "job", id: ID });
    }
  });

  it("ignores the query string, the fragment and a trailing slash", () => {
    for (const noise of ["?tab=costs", "#photos", "/", "/?a=b"]) {
      expect(parsePageContext(`/jobs/${ID}${noise}`), noise).toEqual({ kind: "job", id: ID });
    }
  });

  it("returns null for the jobs LIST — 'this job' on a list of five means nothing", () => {
    expect(parsePageContext("/jobs")).toBeNull();
    expect(parsePageContext("/jobs/")).toBeNull();
  });

  it("returns null for every other route, so the assistant behaves exactly as before", () => {
    for (const path of ["/", "/dashboard", "/cash-flow", "/rfis", "/settings/export", "/contacts/" + ID]) {
      expect(parsePageContext(path), path).toBeNull();
    }
  });

  it("returns null for nothing at all", () => {
    expect(parsePageContext(null)).toBeNull();
    expect(parsePageContext(undefined)).toBeNull();
    expect(parsePageContext("")).toBeNull();
  });

  /** The path arrives from a browser. These are the shapes a caller can
   * type, and none of them may become a lookup — a segment that is not an
   * id is rejected here rather than turning into a database round trip, or
   * worse, a free-text term downstream. */
  it("refuses a segment that is not an id, however it is dressed up", () => {
    for (const bad of [
      "/jobs/../../etc/passwd",
      "/jobs/' OR 1=1--",
      "/jobs/<script>",
      "/jobs/short",
      "/jobs/" + "a".repeat(64),
      "/jobs/ABC123DEF456GHI789JK",   // uppercase — cuids are lower case
      "/jobs/cmtx-3b4x-0007-d0pe",    // hyphens
    ]) {
      expect(parsePageContext(bad), bad).toBeNull();
    }
  });

  /** A WELL-FORMED id belonging to someone else is NOT rejected here, and
   * that is correct rather than an oversight: this module cannot know whose
   * it is, because it reads no rows. The company scope is what refuses it,
   * one layer up, and this test pins that division of labour so nobody
   * later "hardens" the parser into a false sense of security. */
  it("passes a well-formed id through — whose it is, is not this layer's question", () => {
    const someoneElses = "aaaaaaaaaaaaaaaaaaaa";
    expect(parsePageContext(`/jobs/${someoneElses}`)).toEqual({ kind: "job", id: someoneElses });
  });
});

describe("pageContextSentence", () => {
  it("says nothing when there is no job", () => {
    expect(pageContextSentence(null)).toBeNull();
  });

  it("names the job and keeps an explicitly named job winning", () => {
    const s = pageContextSentence({ name: "Riverside Medical Office Building" })!;
    expect(s).toContain("Riverside Medical Office Building");
    // The rule is scoped to "named none". Without that scoping a model
    // bends an explicit "on Cedar Park" towards the page it is on, which
    // is a wrong answer that looks confident.
    expect(s).toContain("name none");
    expect(s).toMatch(/name a different job, that one wins/i);
  });
});
