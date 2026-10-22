import { describe, expect, it } from "vitest";
import { CEILING_ITEM, isCheckFigureItem, ROOMS_ITEM } from "./roomItems";

describe("room items", () => {
  it("names Rooms as the check figure and nothing else", () => {
    expect(isCheckFigureItem(ROOMS_ITEM)).toBe(true);
    expect(isCheckFigureItem(" Rooms ")).toBe(true);
    for (const c of Object.values(CEILING_ITEM)) expect(isCheckFigureItem(c.name)).toBe(false);
    expect(isCheckFigureItem("Rooms 2")).toBe(false);
  });
  it("gives the two priced families a starter and the other two none", () => {
    expect(CEILING_ITEM.ACT.starter).toBe("ACT2");
    expect(CEILING_ITEM.GYP.starter).toBe("GYPC1");
    expect(CEILING_ITEM.OPEN.starter).toBeNull();
    expect(CEILING_ITEM.OTHER.starter).toBeNull();
  });
});
