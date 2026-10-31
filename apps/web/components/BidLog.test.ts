import { describe, expect, it, vi } from "vitest";

import type { SameJobMatch } from "@/lib/estimating/bid-invitation";

vi.mock("@prova/db", () => ({ prisma: {}, BidInvitationStatus: {}, TradeScope: {} }));
vi.mock("@/lib/actions", () => ({}));

const { withoutSameProject } = await import("./BidLog");

const match = (id: string): SameJobMatch => ({
  id,
  contactId: `gc-${id}`,
  contactName: `GC ${id}`,
  projectName: "Riverside Dental TI",
  reasons: ["same name"],
  sentence: `Same name as Riverside Dental TI from GC ${id}`,
});

describe("withoutSameProject", () => {
  it("drops the 'Same job from another GC?' hint between two bids already linked as one job", () => {
    const flags = new Map([
      ["a", [match("b")]],
      ["b", [match("a")]],
    ]);
    const kept = withoutSameProject(flags, new Map([["a", "p1"], ["b", "p1"]]));
    expect(kept.size).toBe(0);
  });

  it("keeps it when the two bids are on different projects, or either has none", () => {
    const flags = new Map([
      ["a", [match("b"), match("c")]],
      ["c", [match("a")]],
    ]);
    const kept = withoutSameProject(flags, new Map([["a", "p1"], ["b", "p2"], ["c", null]]));
    expect(kept.get("a")!.map((m) => m.id)).toEqual(["b", "c"]);
    expect(kept.get("c")!.map((m) => m.id)).toEqual(["a"]);
  });
});
