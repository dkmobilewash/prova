import { describe, expect, it } from "vitest";
import { defaultLayerName, isLayerKey, layerKeyOf } from "./layerKey";

const group = (inches: number, tag?: string, itemId?: string) =>
  ({ inches, source: tag ? { kind: "TAG" as const, tag } : { kind: "THICKNESS" as const }, itemId }) as never;

describe("a wall group's layer key", () => {
  it("is the same group across a re-find: thickness to the eighth and the tag", () => {
    expect(layerKeyOf(group(4.88, "A1"))).toBe(layerKeyOf(group(4.87, "A1")));
    expect(layerKeyOf(group(4.88, "A1"))).not.toBe(layerKeyOf(group(4.88, "A2")));
    expect(layerKeyOf(group(4.88))).not.toBe(layerKeyOf(group(6.5)));
  });

  it("is a key the rename action accepts, and the action refuses anything else", () => {
    expect(isLayerKey(layerKeyOf(group(4.875, "A1")))).toBe(true);
    expect(isLayerKey(layerKeyOf(group(6.5)))).toBe(true);
    expect(isLayerKey("rooms")).toBe(true);
    expect(isLayerKey("doors")).toBe(true);
    for (const bad of ["", "wall:", "wall:abc:A1", "walls", "room", "wall:4.875:" + "x".repeat(81)]) {
      expect(isLayerKey(bad), bad).toBe(false);
    }
  });

  it("defaults to the item, the tag and the thickness, in that order", () => {
    expect(defaultLayerName(group(4.875, "A1", "i1"), new Map([["i1", "Partition"]]))).toBe("Partition · A1 · 4-7/8\"");
    expect(defaultLayerName(group(6.5), new Map())).toBe("6-1/2\"");
  });
});
