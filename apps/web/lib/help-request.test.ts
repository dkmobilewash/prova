import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readSupportAddress } from "./help-config";
import {
  MAX_HELP_MESSAGE_LENGTH,
  helpBody,
  helpChannel,
  helpMailtoHref,
  helpMessageProblem,
  helpSubject,
  jobIdFromPagePath,
  safePagePath,
} from "./help-request";

/**
 * The pure half of "ask a human for help".
 *
 * Everything here decides what the help panel OFFERS and what the email
 * SAYS, which is the whole of the feature that can be wrong without a
 * database, a provider or a browser. Two of these functions are the only
 * thing between a page path the browser handed us and an email subject, so
 * they get the treatment this repo gives anything that formats untrusted
 * text into a message.
 */

/* ------------------------------------------------------------------ *
 * 1. Which of the three channels is available
 * ------------------------------------------------------------------ */

describe("helpChannel", () => {
  /**
   * Two independent facts decide it: is there a support address to reach,
   * and can this install send mail on the contractor's behalf. So the case
   * list is a CROSS PRODUCT rather than a hand-written list — and its size
   * is asserted against a number that cannot drift with it.
   *
   * That assertion is the point. A derived case list has two failure modes
   * and only one of them looks like a failure: it can get an answer wrong,
   * or it can quietly shrink to nothing and pass every assertion below it
   * (see CLAUDE.md on the guard that parsed 180 of 181 foreign keys and
   * went green). If a third input ever decides this, the count changes and
   * this test says so instead of silently covering half the states.
   */
  const ADDRESSES = [null, "help@example.com"] as const;
  const EMAIL_PROBLEMS = [null, "Email sending is missing its API key."] as const;

  const cases = ADDRESSES.flatMap((supportAddress) =>
    EMAIL_PROBLEMS.map((emailProblem) => ({ supportAddress, emailProblem })),
  );

  it("covers every combination of the two facts that decide it", () => {
    expect(cases.length).toBe(ADDRESSES.length * EMAIL_PROBLEMS.length);
    expect(cases.length).toBe(4);
  });

  it("sends it for them when there is an address and sending works", () => {
    const channel = helpChannel({
      supportAddress: "help@example.com",
      emailProblem: null,
    });
    expect(channel).toEqual({ kind: "send", to: "help@example.com" });
  });

  it("falls back to the user's own mail app when sending is not set up", () => {
    const channel = helpChannel({
      supportAddress: "help@example.com",
      emailProblem: "Email sending is missing its API key.",
    });
    expect(channel.kind).toBe("mailto");
    // The address is what the panel builds a mailto: from, so it has to
    // survive into the fallback rather than being dropped with the error.
    expect(channel.kind === "mailto" && channel.to).toBe("help@example.com");
    // And it must say why, or the panel is offering a worse path for no
    // stated reason.
    expect(channel.kind !== "send" && channel.reason).toContain("sending");
  });

  it("is unavailable, and names the setting, when no support address exists", () => {
    for (const emailProblem of EMAIL_PROBLEMS) {
      const channel = helpChannel({ supportAddress: null, emailProblem });
      expect(channel.kind).toBe("unavailable");
      // Whoever set this install up is the only person who can fix it, so
      // the copy names the thing to set — the same way /messages names
      // RESEND_API_KEY rather than saying "not configured".
      expect(channel.kind !== "send" && channel.reason).toContain("SUPPORT_EMAIL");
    }
  });

  it("reaches exactly three distinct kinds across the four combinations", () => {
    const kinds = new Set(cases.map((input) => helpChannel(input).kind));
    expect([...kinds].sort()).toEqual(["mailto", "send", "unavailable"]);
  });
});

describe("readSupportAddress", () => {
  it("reads and trims the address", () => {
    expect(readSupportAddress({ SUPPORT_EMAIL: "  help@example.com  " })).toBe(
      "help@example.com",
    );
  });

  it("treats absent, empty and whitespace as no address at all", () => {
    expect(readSupportAddress({})).toBeNull();
    expect(readSupportAddress({ SUPPORT_EMAIL: "" })).toBeNull();
    expect(readSupportAddress({ SUPPORT_EMAIL: "   " })).toBeNull();
  });

  it("refuses a value that is not an address rather than mailing it", () => {
    // An unset variable and a typo'd one must not look the same: a panel
    // offering "mailto:localhost" is a dead end that LOOKS like a working
    // one, which is the worse of the two failures.
    expect(readSupportAddress({ SUPPORT_EMAIL: "not-an-address" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. The page path, which arrives from the browser
 * ------------------------------------------------------------------ */

describe("safePagePath", () => {
  it("keeps a real in-app path", () => {
    expect(safePagePath("/jobs/clx123abc/certified-payroll")).toBe(
      "/jobs/clx123abc/certified-payroll",
    );
    expect(safePagePath("/")).toBe("/");
    expect(safePagePath("  /settings  ")).toBe("/settings");
  });

  it("drops a query string and a fragment", () => {
    // usePathname never supplies one; if anything ever does, the extra is
    // not context worth mailing and may carry ids nobody chose to send.
    expect(safePagePath("/messages?show=problems")).toBe("/messages");
    expect(safePagePath("/jobs/abc#photos")).toBe("/jobs/abc");
  });

  it("refuses anything that is not a path on this app", () => {
    for (const raw of [
      "",
      "jobs/abc",
      "https://evil.example.com/jobs",
      "//evil.example.com/jobs",
      "javascript:alert(1)",
      "/jobs/a b",
    ]) {
      expect(safePagePath(raw), `expected ${JSON.stringify(raw)} to be refused`).toBeNull();
    }
  });

  it("refuses a newline, because this string goes into an email subject", () => {
    expect(safePagePath("/jobs/abc\nBcc: someone@example.com")).toBeNull();
    expect(safePagePath("/jobs/abc\r\nSubject: something else")).toBeNull();
  });

  it("refuses an absurdly long path rather than mailing it", () => {
    expect(safePagePath(`/jobs/${"a".repeat(500)}`)).toBeNull();
  });
});

describe("jobIdFromPagePath", () => {
  it("finds the job a job page belongs to", () => {
    expect(jobIdFromPagePath("/jobs/clx123abc")).toBe("clx123abc");
    expect(jobIdFromPagePath("/jobs/clx123abc/certified-payroll/wh-347")).toBe("clx123abc");
  });

  it("finds no job where there is none", () => {
    // `/jobs/new` is a route, not a job — looking it up would return
    // nothing, but saying so here keeps the lookup off the database.
    expect(jobIdFromPagePath("/jobs/new")).toBeNull();
    expect(jobIdFromPagePath("/jobs")).toBeNull();
    expect(jobIdFromPagePath("/settings")).toBeNull();
    expect(jobIdFromPagePath("/")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 3. What the email says
 * ------------------------------------------------------------------ */

describe("helpSubject", () => {
  it("names the company and the page", () => {
    expect(helpSubject({ companyName: "Cyrus Drywall", pagePath: "/jobs/clx1" })).toBe(
      "Help — Cyrus Drywall — /jobs/clx1",
    );
  });

  it("leaves no dangling separator when the page is unknown", () => {
    expect(helpSubject({ companyName: "Cyrus Drywall", pagePath: null })).toBe(
      "Help — Cyrus Drywall",
    );
  });
});

describe("helpBody", () => {
  it("is exactly the question plus the four things the panel discloses", () => {
    // Asserted whole rather than by substring, deliberately. The promise
    // this feature makes is that it sends NOTHING the panel did not show
    // the user, and a pile of `toContain` calls can only prove that what
    // is listed is present — never that nothing else is.
    expect(
      helpBody({
        message: "Certified payroll is due Friday and week 3 shows no fringe. What do I file?",
        companyName: "Cyrus Drywall",
        pagePath: "/jobs/clx1/certified-payroll",
        jobName: "Riverside Tower — Level 3",
        askedBy: { name: "Cyrus Obi", email: "cyrus@cyrusdrywall.example" },
      }),
    ).toBe(
      [
        "Certified payroll is due Friday and week 3 shows no fringe. What do I file?",
        "",
        "---",
        "Company: Cyrus Drywall",
        "Page: /jobs/clx1/certified-payroll",
        "Job: Riverside Tower — Level 3",
        "Asked by: Cyrus Obi <cyrus@cyrusdrywall.example>",
      ].join("\n"),
    );
  });

  it("omits the job line entirely when the page is not a job page", () => {
    const body = helpBody({
      message: "How do I add a second licence?",
      companyName: "Cyrus Drywall",
      pagePath: "/settings",
      jobName: null,
      askedBy: { name: null, email: "cyrus@cyrusdrywall.example" },
    });
    expect(body).not.toContain("Job:");
    // No name on the account is common; the address alone still has to
    // read as a person we can reply to, not as an empty pair of brackets.
    expect(body).toContain("Asked by: cyrus@cyrusdrywall.example");
    expect(body).not.toContain("<");
  });

  it("says the page is unknown rather than leaving a blank line", () => {
    const body = helpBody({
      message: "Anything.",
      companyName: "Cyrus Drywall",
      pagePath: null,
      jobName: null,
      askedBy: { name: "Cyrus Obi", email: "cyrus@cyrusdrywall.example" },
    });
    expect(body).toContain("Page: not recorded");
  });

  it("trims the question but keeps the shape of what they typed", () => {
    const body = helpBody({
      message: "  First line.\n\nSecond line.  ",
      companyName: "C",
      pagePath: "/",
      jobName: null,
      askedBy: { name: null, email: "a@b.co" },
    });
    expect(body.startsWith("First line.\n\nSecond line.\n")).toBe(true);
  });
});

describe("helpMailtoHref", () => {
  const href = helpMailtoHref("help@example.com", "Help — Cyrus Drywall — /jobs/clx1");

  it("opens their own mail app at the support address with the subject filled in", () => {
    expect(href).toBe(
      "mailto:help@example.com?subject=Help%20%E2%80%94%20Cyrus%20Drywall%20%E2%80%94%20%2Fjobs%2Fclx1",
    );
  });

  it("carries a subject and nothing else", () => {
    // The subject naming the page and the company is what the assignment
    // permits in a URL. A body is not: it would put whatever the person
    // typed — the thing most likely to be sensitive — into a URL, which is
    // the one place this repo will not put user content.
    expect(href).not.toContain("body=");
    expect(href).not.toContain("cc=");
  });

  it("leaves no raw space or newline for a mail client to mis-parse", () => {
    expect(/[\s]/.test(href)).toBe(false);
  });
});

describe("helpMessageProblem", () => {
  it("accepts a question", () => {
    expect(helpMessageProblem("What do I file?")).toBeNull();
  });

  it("refuses an empty question in words that say what to do", () => {
    const problem = helpMessageProblem("   \n  ");
    expect(problem).not.toBeNull();
    expect(problem).toContain("question");
  });

  it("refuses one past the limit and accepts one exactly at it", () => {
    // Boundary both ways: a check that only tests "far too long" cannot
    // tell an off-by-one from a working limit.
    expect(helpMessageProblem("a".repeat(MAX_HELP_MESSAGE_LENGTH))).toBeNull();
    const problem = helpMessageProblem("a".repeat(MAX_HELP_MESSAGE_LENGTH + 1));
    expect(problem).not.toBeNull();
    expect(problem).toContain(String(MAX_HELP_MESSAGE_LENGTH));
  });

  it("measures the trimmed question, not the whitespace around it", () => {
    expect(helpMessageProblem(`  ${"a".repeat(MAX_HELP_MESSAGE_LENGTH)}  `)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 4. It is in the shell, not on a page
 * ------------------------------------------------------------------ */

/**
 * "Reachable from any page" is the requirement, and the only structural
 * way to hold it is to mount the control in the app shell rather than on a
 * page. Nothing else in the toolchain can see that claim: the reachability
 * guard is satisfied by ONE caller anywhere, so a help button wired to a
 * single page would pass it while the feature was missing from the other
 * forty screens.
 */
describe("the help control is mounted in the app shell", () => {
  const WEB = resolve(__dirname, "..");

  function source(relative: string): string {
    const text = readFileSync(resolve(WEB, relative), "utf8");
    // Guards the guard: readFileSync throws on a moved file, but an empty
    // read would let every assertion below pass on nothing.
    expect(text.length).toBeGreaterThan(200);
    return text;
  }

  it("renders HelpButton from the topbar", () => {
    expect(source("components/Topbar.tsx")).toContain("<HelpButton");
  });

  it("and the topbar is in the (app) layout, so every page has it", () => {
    expect(source("app/(app)/layout.tsx")).toContain("<Topbar");
  });
});
