import { describe, expect, it } from "vitest";
import { POSTS, postedType, suggestion, typeSource } from "./postingGate";
import { propagatedTag, siblingTag } from "./planTextTags";
import type { WallGroup } from "./wallGroups";

const IW2 = { id: "iw2", code: "IW-2", name: "IW-2", hasParts: true, thicknessIn: 7.25 };
const group = (source: WallGroup["source"], inches = 7.25): WallGroup => ({ inches, runs: [], feet: 10, source, candidates: [IW2] }) as WallGroup;

describe("suggest, don't post: no source prices a wall without a person", () => {
  it("a printed tag naming a legend code is a suggestion, said to be one", () => {
    expect(typeSource(group({ kind: "TAG", tag: "IW-2" }))?.source).toBe("tag");
    expect(postedType(group({ kind: "TAG", tag: "IW-2" }))).toBeNull();
    expect(suggestion(group({ kind: "TAG", tag: "IW-2" }))).toEqual({ code: "IW-2", from: "printed tag" });
    expect(Object.values(POSTS).every((posts) => posts === false)).toBe(true);
  });

  it("a carried tag, a sibling sheet's tag and a variant tag are suggestions too, each with its source", () => {
    for (const [g, source] of [
      [group({ kind: "TAG", tag: propagatedTag("IW-2") }), "carried"],
      [group({ kind: "TAG", tag: siblingTag("IW-2") }), "sibling"],
      [{ ...group({ kind: "TAG", tag: "IW-2" }), candidates: [{ ...IW2, family: "IW" }] } as WallGroup, "tag-variant"],
    ] as const) {
      expect(typeSource(g)?.source).toBe(source);
      expect(POSTS[source]).toBe(false);
      expect(postedType(g)).toBeNull();
      expect(suggestion(g)?.code).toBe("IW-2");
      expect(suggestion(g)?.from).not.toBe("printed tag");
    }
  });

  it("suggests nothing where the drawing names nothing", () => {
    expect(suggestion({ ...group({ kind: "REMAINDER" }), candidates: [] } as WallGroup)).toBeNull();
  });
});
