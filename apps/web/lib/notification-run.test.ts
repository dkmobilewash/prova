import { describe, expect, it } from "vitest";
import type { DispatchOutcome } from "./notification-dispatch";
import {
  configuredBaseUrl,
  orderRecipients,
  runDigests,
  type RunRecipient,
} from "./notification-run";

/**
 * The loop, not the letter.
 *
 * `notification-milestones.test.ts` proves what one person is told and
 * `notification-dispatch.dbtest.ts` proves the ledger holds under
 * concurrency. Neither can prove the thing that makes an UNATTENDED run
 * different from a button: that one person's failure does not silently end
 * everybody else's night, that nobody is mailed somebody else's list, and
 * that a run which cannot finish skips a different tail each time rather
 * than the same one forever.
 *
 * Every case here was watched fail against the wrong behaviour before it
 * was kept — the wrong behaviour is named in each test, because a test
 * nobody has seen red is a test of nothing.
 */

function person(id: string, over: Partial<RunRecipient> = {}): RunRecipient {
  return {
    id,
    companyId: `co_${id}`,
    email: `${id}@example.test`,
    name: id,
    role: "OWNER",
    jobFunction: null,
    ...over,
  };
}

const sent = (noticeCount = 1): DispatchOutcome => ({
  ok: true,
  sent: true,
  noticeCount,
  messageId: "msg",
  toAddress: "someone@example.test",
});
const nothingDue: DispatchOutcome = {
  ok: true,
  sent: false,
  reason: "nothing-due",
};
const alreadyClaimed: DispatchOutcome = {
  ok: true,
  sent: false,
  reason: "already-claimed",
};
const failed = (error: string): DispatchOutcome => ({
  ok: false,
  error,
  claimed: 0,
});
const unconfigured: DispatchOutcome = {
  ok: false,
  error: "Email sending isn't set up yet.",
  claimed: 0,
  unconfigured: true,
};

describe("runDigests — one person cannot end the run", () => {
  it("keeps going when a dispatch THROWS", async () => {
    // Wrong behaviour: no try/catch around dispatch. The rejection
    // propagates out of runDigests, the run dies at person b, and c and d
    // are never mailed — with nothing in any ledger to say so.
    const attempted: string[] = [];
    const report = await runDigests({
      recipients: [person("a"), person("b"), person("c"), person("d")],
      dispatch: async (recipient) => {
        attempted.push(recipient.id);
        if (recipient.id === "b") throw new Error("connection pool timed out");
        return sent();
      },
    });

    expect(attempted).toEqual(["a", "b", "c", "d"]);
    expect(report.attempted).toBe(4);
    expect(report.sent).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.notAttempted).toBe(0);
    expect(report.stopped).toBeNull();
    expect(report.outcomes[1]).toEqual({
      userId: "b",
      result: "failed",
      error: "connection pool timed out",
    });
  });

  it("keeps going when a dispatch RETURNS a failure", async () => {
    // Wrong behaviour: treating `ok: false` as fatal and breaking. One
    // address the provider refuses stops every send behind it.
    const report = await runDigests({
      recipients: [person("a"), person("b"), person("c")],
      dispatch: async (recipient) =>
        recipient.id === "a" ? failed("Recipient address rejected") : sent(),
    });

    expect(report.attempted).toBe(3);
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(2);
    expect(report.stopped).toBeNull();
  });

  it("records a non-throwing failure as that person's outcome only", async () => {
    const report = await runDigests({
      recipients: [person("a"), person("b")],
      dispatch: async (recipient) =>
        recipient.id === "a" ? failed("provider timeout") : nothingDue,
    });

    expect(report.outcomes).toEqual([
      { userId: "a", result: "failed", error: "provider timeout" },
      { userId: "b", result: "nothing-due" },
    ]);
  });
});

describe("runDigests — the one failure that IS the whole deployment", () => {
  it("stops the run when the email provider is unconfigured", async () => {
    // Wrong behaviour: `continue`ing like any other failure. Two hundred
    // identical "email isn't set up" lines, and the one fact worth reading
    // buried in them. Safe to stop precisely because this failure is
    // checked BEFORE anything is claimed, so tomorrow's run says
    // everything today's would have.
    const attempted: string[] = [];
    const report = await runDigests({
      recipients: [person("a"), person("b"), person("c")],
      dispatch: async (recipient) => {
        attempted.push(recipient.id);
        return unconfigured;
      },
    });

    expect(attempted).toEqual(["a"]);
    expect(report.stopped).toBe("email-not-configured");
    expect(report.attempted).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.notAttempted).toBe(2);
  });

  it("does NOT stop on an ordinary failure that merely looks similar", async () => {
    const report = await runDigests({
      recipients: [person("a"), person("b")],
      dispatch: async () => failed("Email sending isn't set up yet."),
    });

    // Same words, no `unconfigured` flag. The flag is the signal, not the
    // sentence: matching on the message would make a provider's own error
    // text able to end the run.
    expect(report.stopped).toBeNull();
    expect(report.attempted).toBe(2);
  });
});

describe("runDigests — one person at a time, once each", () => {
  it("never has two dispatches in flight", async () => {
    // Wrong behaviour: Promise.all over the recipients. It works and it is
    // faster, and it makes the time budget meaningless, blows the pooled
    // connection limit, and — the reason it is forbidden — makes a run
    // that dispatches the SAME person twice concurrently indistinguishable
    // from one that does not.
    let inFlight = 0;
    let maxInFlight = 0;
    await runDigests({
      recipients: [person("a"), person("b"), person("c")],
      dispatch: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return sent();
      },
    });

    expect(maxInFlight).toBe(1);
  });

  it("hands each dispatch that person's OWN identity", async () => {
    // Wrong behaviour: closing over the first recipient, or resolving the
    // principal once per company. Alerts are capability-filtered per user,
    // so mailing b using a's identity is a permission hole with a stamp on
    // it — and it would look, from every count in the report, like a
    // perfectly normal run.
    const seen: RunRecipient[] = [];
    const a = person("a", { role: "OWNER", companyId: "co_1" });
    const b = person("b", {
      role: "MEMBER",
      jobFunction: "FIELD",
      companyId: "co_1",
    });

    await runDigests({
      recipients: [a, b],
      dispatch: async (recipient) => {
        seen.push(recipient);
        return sent();
      },
    });

    expect(seen).toEqual([a, b]);
    expect(seen[1].role).toBe("MEMBER");
    expect(seen[1].jobFunction).toBe("FIELD");
    expect(new Set(seen.map((r) => r.id)).size).toBe(2);
  });
});

describe("runDigests — the time budget", () => {
  it("stops between people, and says how many it never reached", async () => {
    // Wrong behaviour: no budget at all. The platform kills the function
    // instead, and a kill lands wherever it lands — including between
    // claiming a notice and sending it, which is the one state the ledger
    // cannot undo: milestone spent, no email.
    let clock = 0;
    const attempted: string[] = [];
    const report = await runDigests({
      recipients: [person("a"), person("b"), person("c"), person("d")],
      now: () => clock,
      budgetMs: 100,
      dispatch: async (recipient) => {
        attempted.push(recipient.id);
        clock += 60;
        return sent();
      },
    });

    expect(attempted).toEqual(["a", "b"]);
    expect(report.stopped).toBe("time-budget");
    expect(report.attempted).toBe(2);
    expect(report.notAttempted).toBe(2);
    expect(report.considered).toBe(4);
  });

  it("does not stop a run that fits", async () => {
    let clock = 0;
    const report = await runDigests({
      recipients: [person("a"), person("b")],
      now: () => clock,
      budgetMs: 1000,
      dispatch: async () => {
        clock += 10;
        return nothingDue;
      },
    });

    expect(report.stopped).toBeNull();
    expect(report.notAttempted).toBe(0);
  });
});

describe("runDigests — the report", () => {
  it("counts every outcome kind separately", async () => {
    const outcomes: Record<string, DispatchOutcome> = {
      a: sent(3),
      b: nothingDue,
      c: alreadyClaimed,
      d: failed("nope"),
    };
    const report = await runDigests({
      recipients: [person("a"), person("b"), person("c"), person("d")],
      dispatch: async (recipient) => outcomes[recipient.id],
    });

    expect(report).toMatchObject({
      considered: 4,
      attempted: 4,
      sent: 1,
      nothingDue: 1,
      alreadyClaimed: 1,
      failed: 1,
      notAttempted: 0,
      stopped: null,
    });
  });

  it("carries no email addresses", async () => {
    const report = await runDigests({
      recipients: [person("a")],
      dispatch: async () => sent(),
    });

    expect(JSON.stringify(report)).not.toContain("@example.test");
  });

  it("reports an empty recipient list without pretending it ran", async () => {
    const report = await runDigests({ recipients: [], dispatch: async () => sent() });
    expect(report).toMatchObject({ considered: 0, attempted: 0, stopped: null });
  });
});

describe("orderRecipients — longest unnotified first", () => {
  it("puts people who have never been mailed at the front", async () => {
    // Wrong behaviour: ordering by id (or by whatever Prisma returns). A
    // budget-truncated run then starves the SAME tail every night, and the
    // milestone ledger makes it permanent — a rung nobody was there to
    // fire still passes.
    const ordered = orderRecipients(
      [person("zeta"), person("alpha"), person("mid")],
      new Map([
        ["alpha", new Date("2026-09-01T00:00:00.000Z")],
        ["mid", new Date("2026-08-01T00:00:00.000Z")],
      ]),
    );

    expect(ordered.map((r) => r.id)).toEqual(["zeta", "mid", "alpha"]);
  });

  it("breaks ties by id so two runs cut the list in the same place", async () => {
    const same = new Date("2026-09-01T00:00:00.000Z");
    const ordered = orderRecipients(
      [person("c"), person("a"), person("b")],
      new Map([
        ["a", same],
        ["b", same],
        ["c", same],
      ]),
    );

    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("reads an explicit null and a missing key as the same 'never'", async () => {
    // `groupBy` returns no row at all for a user who has never been
    // dispatched to, so both shapes reach this function and both mean the
    // same thing. Ordered by id between themselves, ahead of anyone dated.
    const ordered = orderRecipients(
      [person("dated"), person("null-entry"), person("absent")],
      new Map([
        ["dated", new Date("2020-01-01T00:00:00.000Z")],
        ["null-entry", null],
      ]),
    );

    expect(ordered.map((r) => r.id)).toEqual(["absent", "null-entry", "dated"]);
  });

  it("does not mutate the list it was given", async () => {
    const input = [person("c"), person("a")];
    orderRecipients(input, new Map());
    expect(input.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

describe("configuredBaseUrl — links come from configuration, never a request", () => {
  it("refuses an unset or blank value rather than guessing", () => {
    // Wrong behaviour: falling back to a hard-coded host. A working-looking
    // email whose every link goes to the wrong deployment is worse than no
    // email, and the caller can only fail closed if this says nothing.
    expect(configuredBaseUrl(undefined)).toBeNull();
    expect(configuredBaseUrl("")).toBeNull();
    expect(configuredBaseUrl("   ")).toBeNull();
  });

  it("refuses a value that is not an http(s) origin", () => {
    expect(configuredBaseUrl("app.cstream.ai")).toBeNull();
    expect(configuredBaseUrl("javascript:alert(1)")).toBeNull();
    expect(configuredBaseUrl("ftp://app.cstream.ai")).toBeNull();
  });

  it("keeps the origin and drops anything pasted after it", () => {
    expect(configuredBaseUrl("https://app.cstream.ai")).toBe("https://app.cstream.ai");
    expect(configuredBaseUrl("  https://app.cstream.ai/alerts?x=1  ")).toBe(
      "https://app.cstream.ai",
    );
    expect(configuredBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });
});
