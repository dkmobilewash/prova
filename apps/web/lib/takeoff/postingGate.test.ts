import { describe, expect, it } from "vitest";
import { POSTS, postedType, suggestedCode, typeSource } from "./postingGate";
import { propagatedTag, siblingTag } from "./planTextTags";
import type { WallGroup } from "./wallGroups";

const IW2 = { id: "iw2", code: "IW-2", name: "IW-2", hasParts: true, thicknessIn: 7.25 };
const group = (source: WallGroup["source"], inches = 7.25): WallGroup => ({ inches, runs: [], feet: 10, source, candidates: [IW2] }) as WallGroup;

describe("precision first: a type posts only from a source right 95% of the time", () => {
  it("posts a printed tag naming a legend code, whatever its thickness says", () => {
    expect(typeSource(group({ kind: "TAG", tag: "IW-2" }))?.source).toBe("tag");
    expect(postedType(group({ kind: "TAG", tag: "IW-2" }))?.code).toBe("IW-2");
    expect(postedType(group({ kind: "TAG", tag: "IW-2" }, 4.875))?.code).toBe("IW-2");
  });

  it("holds a carried tag, a sibling sheet's tag and a variant tag for review, suggesting the type", () => {
    for (const [g, source] of [
      [group({ kind: "TAG", tag: propagatedTag("IW-2") }), "carried"],
      [group({ kind: "TAG", tag: siblingTag("IW-2") }), "sibling"],
      [{ ...group({ kind: "TAG", tag: "IW-2" }), candidates: [{ ...IW2, family: "IW" }] } as WallGroup, "tag-variant"],
    ] as const) {
      expect(typeSource(g)?.source).toBe(source);
      expect(POSTS[source]).toBe(false);
      expect(postedType(g)).toBeNull();
      expect(suggestedCode(g)).toBe("IW-2");
    }
  });

  it("suggests nothing where the drawing names nothing", () => {
    expect(suggestedCode({ ...group({ kind: "REMAINDER" }), candidates: [] } as WallGroup)).toBeNull();
  });
});
