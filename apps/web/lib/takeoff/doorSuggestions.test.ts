import { describe, expect, it } from "vitest";
import { doorsToStore, storedDoorsOf } from "./doorSuggestions";

const door = (x: number) => ({ hinge: { x, y: 0.5 }, strike: { x: x + 0.25, y: 0.5 } });

describe("found doors with no printed mark, to confirm", () => {
  it("keeps only the unmarked ones (a marked door posts itself), on its leaf; none at all is null", () => {
    expect(doorsToStore([door(0), door(0.5), door(1)], ["101", null, null])).toEqual({ doors: [{ x1: 0.5, y1: 0.5, x2: 0.75, y2: 0.5 }, { x1: 1, y1: 0.5, x2: 1.25, y2: 0.5 }] });
    expect(doorsToStore([door(0.1)], ["101"])).toBeNull();
  });
  it("reads a stored value back, dropping anything that is not a door", () => {
    expect(storedDoorsOf({ doors: [{ x1: 0, y1: 0, x2: 1, y2: 1 }, { x1: "a" }], decided: true })).toEqual({ doors: [{ x1: 0, y1: 0, x2: 1, y2: 1 }], decided: true });
    expect(storedDoorsOf(null)).toBeNull();
  });
});
