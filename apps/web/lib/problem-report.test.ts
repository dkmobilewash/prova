import { describe, expect, it } from "vitest";
import {
  MAX_REPORT_LINE,
  MAX_REPORT_LINES,
  MAX_SCREENSHOT_BYTES,
  cleanLines,
  jobIdFromReportPath,
  redactLine,
  reportBody,
  reportSlackText,
  screenshotBytes,
} from "./problem-report";

const jpeg = (bytes: number) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes - 3)]).toString("base64")}`;

describe("what a problem report may carry", () => {
  it("removes query strings, tokens and keys from the browser's lines", () => {
    expect(redactLine("GET https://store.public.blob.vercel-storage.com/plans/a.pdf?token=abc&x=1 failed")).toBe("GET https://store.public.blob.vercel-storage.com/plans/a.pdf?… failed");
    expect(redactLine("session eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJl here")).toBe("session [token removed] here");
    expect(redactLine("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [removed]");
    expect(redactLine("key sk_test_abcdef123 and pk_live_XYZ987")).toBe("key [key removed] and [key removed]");
    expect(redactLine("vercel_blob_rw_store123_secretvalue leaked")).toBe("[key removed] leaked");
    expect(redactLine("x".repeat(MAX_REPORT_LINE + 50))).toHaveLength(MAX_REPORT_LINE);
  });

  it("keeps only strings, the newest twenty, each redacted", () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const kept = cleanLines([...many, 42, null, "  ", { a: 1 }]);
    expect(kept).toHaveLength(MAX_REPORT_LINES);
    expect(kept.at(-1)).toBe("line 29");
    expect(cleanLines("not a list")).toEqual([]);
  });

  it("takes only a real JPEG under the size cap as the screenshot", () => {
    expect(screenshotBytes(null)).toEqual({ ok: false, why: "no screenshot (this page has no plan view)" });
    expect(screenshotBytes("data:image/png;base64,AAAA")).toEqual({ ok: false, why: "the screenshot was not a JPEG, so it was left out" });
    expect(screenshotBytes(`data:image/jpeg;base64,${Buffer.from("<svg/>").toString("base64")}`)).toEqual({ ok: false, why: "the screenshot was not a JPEG, so it was left out" });
    expect(screenshotBytes(jpeg(MAX_SCREENSHOT_BYTES + 1))).toEqual({ ok: false, why: "the screenshot was too large, so it was left out" });
    const ok = screenshotBytes(jpeg(1000));
    expect(ok.ok && ok.bytes.length).toBe(1000);
  });

  it("names a candidate job only from a job or workspace path", () => {
    expect(jobIdFromReportPath("/takeoff/cjob123")).toBe("cjob123");
    expect(jobIdFromReportPath("/jobs/cjob123/estimate")).toBe("cjob123");
    expect(jobIdFromReportPath("/jobs/new")).toBeNull();
    expect(jobIdFromReportPath("/settings")).toBeNull();
  });

  it("the mail says what was typed, then the context, and nothing else", () => {
    expect(
      reportBody({
        message: " The walls didn't post ",
        companyName: "Acme Drywall",
        pagePath: "/takeoff/cjob1",
        jobName: "Baker EOC",
        sheet: "A101 (page 13)",
        reportedBy: { name: "Dana", email: "dana@acme.test" },
        consoleErrors: ["12:00:01 console.error boom"],
        actions: [],
        screenshot: "attached (plan-view.jpg)",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe(
      [
        "The walls didn't post",
        "",
        "---",
        "Company: Acme Drywall",
        "Page: /takeoff/cjob1",
        "Job: Baker EOC",
        "Sheet: A101 (page 13)",
        "Reported by: Dana <dana@acme.test>",
        "Screenshot: attached (plan-view.jpg)",
        "Browser: Mozilla/5.0",
        "",
        "Console errors (1, newest last):",
        "  12:00:01 console.error boom",
        "",
        "Recent actions (0, newest last):",
        "  none",
      ].join("\n"),
    );
  });

  it("the #prova-build line is one line naming who, where and what", () => {
    expect(reportSlackText({ companyName: "Acme", jobName: "Baker", sheet: "A101 (page 13)", pagePath: "/takeoff/c1", message: "", consoleErrors: 1 })).toBe(
      "🐞 Problem report from Acme — Baker · sheet A101 (page 13) · /takeoff/c1: “(nothing typed)” (1 console error; full report in the support inbox)",
    );
  });
});
