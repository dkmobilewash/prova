import { describe, expect, it } from "vitest";
import { labelFile, reviewerKindOf } from "./labelRows";

/**
 * ── AN AI SESSION'S MINUTES ARE NOT A PERSON'S MINUTES ──
 *
 * The panel's clock sums the gaps BETWEEN decisions and discards any over six
 * minutes as idle. That is right for somebody working through a sheet and
 * wrong for a model, which reads the whole drawing and then presses keys in
 * bursts: the reading is thrown away as idle and the bursts are counted as
 * instants. On E Street 421 it reported 3m26s for a session that took far
 * longer, and a cost estimate built on that number would be wrong by an order
 * of magnitude.
 */
describe("recording who did the labelling", () => {
  it("calls the Chrome labeller AI", () => {
    expect(reviewerKindOf("AI-Claude-Chrome")).toBe("ai");
  });

  it("calls a person human", () => {
    for (const name of ["Diego", "Cyrus", "D. Ramirez", "estimator 2"]) {
      expect(reviewerKindOf(name), name).toBe("human");
    }
  });

  it("recognises the other names a model arrives under", () => {
    for (const name of ["claude", "GPT-5 labeller", "an LLM", "bot", "automated pass", "agent 3"]) {
      expect(reviewerKindOf(name), name).toBe("ai");
    }
  });

  it("matches whole words, so an ordinary name is not mistaken for a model", () => {
    // The pattern is word-bounded, which this case exists to pin: "Roboto" is
    // a person and reads as one, while "Robot" is caught. Asserted the other
    // way round first, on the theory that erring towards AI is the safe
    // direction — it is, for a name that IS a model's, and a rule loose
    // enough to catch "Roboto" would also catch "Bobbie" through "bot".
    expect(reviewerKindOf("Roboto")).toBe("human");
    expect(reviewerKindOf("Robot")).toBe("ai");
    expect(reviewerKindOf("Abbot")).toBe("human");
  });

  it("writes the kind into the label file beside the time", () => {
    const file = labelFile({
      set: "E_Street_421-Set.pdf",
      sheet: "A2.1",
      page: 28,
      reviewedBy: "AI-Claude-Chrome",
      secondsSpent: 206,
      feetPerUnit: 144,
      reviewComplete: true,
      candidates: [],
      verdicts: [],
      unreviewed: 0,
    });
    expect(file.reviewerKind).toBe("ai");
    expect(file.secondsSpent).toBe(206);
  });

  it("writes human for a person, so the two can be told apart later", () => {
    const file = labelFile({
      set: "E_Street_421-Set.pdf",
      sheet: "A2.1",
      page: 28,
      reviewedBy: "Diego",
      secondsSpent: 1500,
      feetPerUnit: 144,
      reviewComplete: true,
      candidates: [],
      verdicts: [],
      unreviewed: 0,
    });
    expect(file.reviewerKind).toBe("human");
  });
});
