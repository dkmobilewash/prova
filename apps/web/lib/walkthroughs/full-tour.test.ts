import { describe, expect, it } from "vitest";
import { canOpen } from "@/components/navItems";
import {
  FULL_TOUR,
  FULL_TOUR_KEY,
  FULL_TOUR_OFFER_KEY,
  dismissOffer,
  isOfferDismissed,
  readTourState,
  stopAfter,
  stopBefore,
  stopsFor,
  writeTourState,
  type TourStop,
} from "./full-tour";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const stop = (id: string): TourStop => ({ id, route: `/${id}`, title: id, steps: [] });
const all = ["a", "b", "c", "d"].map(stop);

describe("which stops a viewer gets", () => {
  it("an owner gets every stop, in order", () => {
    const owner = { role: "OWNER", jobFunction: null };
    expect(stopsFor((route) => canOpen(owner, route)).map((s) => s.id)).toEqual(FULL_TOUR.map((s) => s.id));
  });

  it("a field member loses the money, pipeline and owner-only stops, and keeps the field ones", () => {
    const foreman = { role: "MEMBER", jobFunction: "FIELD" };
    const ids = stopsFor((route) => canOpen(foreman, route)).map((s) => s.id);
    expect(ids).not.toContain("cash-flow");
    expect(ids).not.toContain("pipeline");
    expect(ids).not.toContain("integrations");
    expect(ids).toContain("field-reports");
    expect(ids).toContain("punch-lists");
    expect(ids[0]).toBe("today");
  });

  it("an executive who is not the owner does not get the owner-only integrations stop", () => {
    const exec = { role: "MEMBER", jobFunction: "EXECUTIVE" };
    const ids = stopsFor((route) => canOpen(exec, route)).map((s) => s.id);
    expect(ids).toContain("cash-flow");
    expect(ids).not.toContain("integrations");
  });
});

describe("moving between stops", () => {
  it("next and previous, with nothing past either end", () => {
    expect(stopAfter(all, "a", all)?.id).toBe("b");
    expect(stopAfter(all, "d", all)).toBeNull();
    expect(stopBefore(all, "b")?.id).toBe("a");
    expect(stopBefore(all, "a")).toBeNull();
  });

  it("from a stop the viewer no longer has, forward to the next one they do", () => {
    const reachable = [all[0], all[3]];
    expect(stopAfter(reachable, "b", all)?.id).toBe("d");
    expect(stopAfter(reachable, "d", all)).toBeNull();
  });
});

describe("remembering where the tour is", () => {
  it("round-trips a stop and clears it", () => {
    const storage = memoryStorage();
    writeTourState(storage, { stop: "contacts" });
    expect(readTourState(storage)).toEqual({ stop: "contacts" });
    writeTourState(storage, null);
    expect(storage.map.has(FULL_TOUR_KEY)).toBe(false);
    expect(readTourState(storage)).toBeNull();
  });

  it("a stop id that no longer exists, or junk, is no tour", () => {
    expect(readTourState(memoryStorage({ [FULL_TOUR_KEY]: JSON.stringify({ stop: "gone" }) }))).toBeNull();
    expect(readTourState(memoryStorage({ [FULL_TOUR_KEY]: "{not json" }))).toBeNull();
    expect(readTourState(memoryStorage({ [FULL_TOUR_KEY]: "null" }))).toBeNull();
  });

  it("blocked storage never throws", () => {
    expect(readTourState(throwing)).toBeNull();
    expect(() => writeTourState(throwing, { stop: "ask" })).not.toThrow();
    expect(() => dismissOffer(throwing)).not.toThrow();
  });
});

describe("the first-visit offer", () => {
  it("shows until dismissed, then stays dismissed", () => {
    const storage = memoryStorage();
    expect(isOfferDismissed(storage)).toBe(false);
    dismissOffer(storage);
    expect(storage.map.get(FULL_TOUR_OFFER_KEY)).toBe("1");
    expect(isOfferDismissed(storage)).toBe(true);
  });

  it("is not shown when storage cannot be read — it could never remember a no", () => {
    expect(isOfferDismissed(throwing)).toBe(true);
  });
});
