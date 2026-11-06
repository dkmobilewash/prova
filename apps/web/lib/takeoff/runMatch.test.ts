import { describe, expect, it } from "vitest";
import { sameRunAs } from "./runMatch";

describe("sameRunAs", () => {
  const run = { x1: 0.1, y1: 0.3, x2: 0.5, y2: 0.3 };
  it("the same run, exactly, either way round", () => {
    expect(sameRunAs(run, [0.1, 0.5], [0.3, 0.3])).toBe(true);
    expect(sameRunAs(run, [0.5, 0.1], [0.3, 0.3])).toBe(true);
  });
  it("a re-run a hair off is the same wall", () => {
    expect(sameRunAs(run, [0.1003, 0.4998], [0.3004, 0.2997])).toBe(true);
  });
  it("the next wall over, or a run sharing one end, is not", () => {
    expect(sameRunAs(run, [0.1, 0.5], [0.305, 0.305])).toBe(false);
    expect(sameRunAs(run, [0.1, 0.3], [0.3, 0.3])).toBe(false);
    expect(sameRunAs(run, [0.1], [0.3])).toBe(false);
  });
});
