import { describe, expect, it } from "vitest";
import { answeredTagTypes } from "./reviewQueue";

const run = (y: number) => ({ x1: 0.1, y1: y, x2: 0.6, y2: y });
const on = (y: number, code: string) => ({ xs: [0.1, 0.6], ys: [y, y], code });

describe("a printed tag's type, read back from what this job typed", () => {
  it("a tag whose runs sit on one type is answered; one on two types is not; an untyped tag is not", () => {
    const answers = answeredTagTypes(
      [{ tag: "2a", runs: [run(0.2)] }, { tag: "2A", runs: [run(0.3)] }, { tag: "3B", runs: [run(0.4), run(0.5)] }, { tag: "1A", runs: [run(0.7)] }],
      [on(0.2, "W2"), on(0.3, "W2"), on(0.4, "W1"), on(0.5, "W3")],
    );
    expect([...answers]).toEqual([["2A", "W2"]]);
  });
});
