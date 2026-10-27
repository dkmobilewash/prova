import { describe, expect, it } from "vitest";
import { ASK_NOT_CONFIGURED, bidAskAccess } from "./askAccess";
import { EMPTY_ASK_BOX, applyAskEvent, hasResult, startQuestion, type AskBoxEvent, type AskBoxState } from "./askBoxState";

describe("bidAskAccess: what the box says before anyone types", () => {
  it("no server key: says so, and nothing else matters", () => {
    expect(bidAskAccess({ configured: false, refusal: null, canChange: true })).toEqual({ available: false, reason: ASK_NOT_CONFIGURED });
  });
  it("the company's switch: its own sentence, word for word", () => {
    const refusal = "AI is switched off for your company. The account owner can turn it back on under Settings → Assistant.";
    expect(bidAskAccess({ configured: true, refusal, canChange: true })).toEqual({ available: false, reason: refusal });
  });
  it("otherwise live, carrying whether the person may change the estimate", () => {
    expect(bidAskAccess({ configured: true, refusal: null, canChange: true })).toEqual({ available: true, canChange: true });
    expect(bidAskAccess({ configured: true, refusal: null, canChange: false })).toEqual({ available: true, canChange: false });
  });
});

const run = (events: AskBoxEvent[], from: AskBoxState = startQuestion(EMPTY_ASK_BOX, "q")) => events.reduce(applyAskEvent, from);

/** The panel's rules (components/AskPanel.tsx `apply`), event by event. */
describe("applyAskEvent", () => {
  it("preamble is status, never answer; answering discards it; the answer streams after", () => {
    const mid = run([{ type: "text", delta: "Let me check the estimate…" }]);
    expect(mid.progress).toBe("Let me check the estimate…");
    expect(mid.answer).toBe("");
    const end = run([
      { type: "text", delta: "Let me check…" },
      { type: "tools", names: ["x"], label: "Reading…" },
      { type: "answering" },
      { type: "text", delta: "It is " },
      { type: "text", delta: "$58,120." },
      { type: "done", citations: [], links: [], toolsUsed: [] },
    ]);
    expect(end.answer).toBe("It is $58,120.");
    expect(end.progress).toBe("");
    expect(end.status).toBeNull();
  });

  it("an answer that never got `answering` (a refusal, a question back) is moved across at done", () => {
    const end = run([{ type: "text", delta: "Which job?" }, { type: "done", citations: [], links: [], toolsUsed: [] }]);
    expect(end.answer).toBe("Which job?");
    expect(end.progress).toBe("");
  });

  it("reset then error RETRACTS an answer (the provenance guard's shape)", () => {
    const end = run([
      { type: "answering" },
      { type: "text", delta: "It is $99,999." },
      { type: "reset" },
      { type: "error", error: "I couldn't check that figure." },
    ]);
    expect(end.answer).toBe("");
    expect(end.error).toBe("I couldn't check that figure.");
    expect(hasResult(end)).toBe(true);
  });

  it("a thread id is kept across questions; everything else starts over", () => {
    const first = run([{ type: "thread", threadId: "t1", title: "x" }, { type: "answering" }, { type: "text", delta: "a" }]);
    const next = startQuestion(first, "second");
    expect(next.threadId).toBe("t1");
    expect(next.answer).toBe("");
    expect(next.asked).toBe("second");
    expect(next.status).toBe("Thinking…");
  });

  it("nothing on screen until there is something", () => {
    expect(hasResult(startQuestion(EMPTY_ASK_BOX, "q"))).toBe(false);
  });
});
