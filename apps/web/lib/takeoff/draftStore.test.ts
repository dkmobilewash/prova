import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, loadDraft, otherDrafts, saveDraft } from "./draftStore";
import { draftFrom } from "./reviewDraft";
import type { Candidate, ReviewState } from "./answerKeyReview";

/**
 * ── THE BROWSER HALF ──
 *
 * `reviewDraft.test.ts` covers what a draft IS and when one may be restored.
 * This covers the part that talks to the browser, and the cases here are the
 * ones where the browser says no: a private window, blocked site data, a full
 * quota. A sheet with 49 traces is not small, and the whole point of the
 * feature is that a reviewer does not lose work — so a draft that cannot be
 * written must not take the review down with it.
 */
const candidate = (id: string, y: number): Candidate => ({
  id,
  x1: 0.1,
  y1: y,
  x2: 0.4,
  y2: y,
  lengthFeet: 30,
  thicknessIn: 6,
  from: "pair",
  note: "detected",
});

function reviewed(): ReviewState {
  const candidates = [candidate("w0", 0.2), candidate("w1", 0.3)];
  return {
    candidates,
    verdicts: { w0: "wall", w1: "not-a-wall" },
    duplicates: [],
    traced: [candidate("t0", 0.8)],
  };
}

const AT = { set: "CENTRAL-BANK.pdf", page: 25, finderVersion: "abc123abc123" };

/** A localStorage that behaves, replaced per test. */
class FakeStore implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new FakeStore());
});

describe("keeping a draft in the browser", () => {
  it("round-trips a review", () => {
    const draft = draftFrom({ state: reviewed(), ...AT })!;
    expect(saveDraft(draft)).toBe(true);
    const back = loadDraft(AT.set, AT.page, AT.finderVersion);
    expect(back?.verdicts).toEqual({ w0: "wall", w1: "not-a-wall" });
    expect(back?.traced).toHaveLength(1);
  });

  it("returns null for a sheet with no draft", () => {
    expect(loadDraft("OTHER.pdf", 1, AT.finderVersion)).toBeNull();
  });

  it("clears one", () => {
    saveDraft(draftFrom({ state: reviewed(), ...AT })!);
    clearDraft(AT.set, AT.page, AT.finderVersion);
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
  });

  it("DOES NOT THROW when storage refuses", () => {
    // A private window, blocked site data, or a full quota — and a sheet with
    // 49 traces is not small. Reported as false so the caller can say the
    // backup is not being kept, rather than implying it is.
    vi.stubGlobal("localStorage", {
      ...new FakeStore(),
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    });
    expect(() => saveDraft(draftFrom({ state: reviewed(), ...AT })!)).not.toThrow();
    expect(saveDraft(draftFrom({ state: reviewed(), ...AT })!)).toBe(false);
  });

  it("does not throw when reading throws", () => {
    vi.stubGlobal("localStorage", {
      ...new FakeStore(),
      getItem: () => {
        throw new DOMException("SecurityError");
      },
    });
    expect(() => loadDraft(AT.set, AT.page, AT.finderVersion)).not.toThrow();
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
  });

  it("does not throw where there is no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(saveDraft(draftFrom({ state: reviewed(), ...AT })!)).toBe(false);
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
    expect(() => clearDraft(AT.set, AT.page, AT.finderVersion)).not.toThrow();
  });

  it("refuses a stored value that is not a draft", () => {
    // The store is shared with every other thing this origin keeps.
    localStorage.setItem(
      `takeoff-review-draft:${AT.set}:${AT.page}:${AT.finderVersion}`,
      '{"format":"something-else"}',
    );
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
  });

  it("refuses a WELL-FORMED draft from another version of this screen", () => {
    // ── THE CASE THAT MAKES THE FORMAT CHECK LOAD-BEARING ──
    //
    // The case above is refused by the shape checks, not by the version — so
    // deleting the version check changed nothing and mutation said so. This
    // one has everything a draft should have and the wrong version stamp,
    // which is what a draft written by an older screen actually looks like.
    localStorage.setItem(
      `takeoff-review-draft:${AT.set}:${AT.page}:${AT.finderVersion}`,
      JSON.stringify({
        format: "takeoff-review-draft-v0",
        set: AT.set,
        page: AT.page,
        finderVersion: AT.finderVersion,
        fingerprint: "2:abc",
        savedAt: new Date().toISOString(),
        verdicts: { w0: "wall" },
        traced: [],
        counts: { decided: 1, traced: 0 },
      }),
    );
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
  });

  it("refuses a stored value that is not even JSON", () => {
    localStorage.setItem(
      `takeoff-review-draft:${AT.set}:${AT.page}:${AT.finderVersion}`,
      "half a doc",
    );
    expect(loadDraft(AT.set, AT.page, AT.finderVersion)).toBeNull();
  });
});

describe("drafts left by another build", () => {
  it("are found, so the reviewer can be told one exists", () => {
    // A rebuild makes a draft unrestorable — its ids no longer mean the same
    // walls — but an afternoon's work must not disappear in silence.
    saveDraft(draftFrom({ state: reviewed(), ...AT, finderVersion: "old111111111" })!);
    const found = otherDrafts(AT.set, AT.page, AT.finderVersion);
    expect(found).toHaveLength(1);
    expect(found[0].finderVersion).toBe("old111111111");
  });

  it("does not include this build's own draft", () => {
    saveDraft(draftFrom({ state: reviewed(), ...AT })!);
    expect(otherDrafts(AT.set, AT.page, AT.finderVersion)).toEqual([]);
  });

  it("does not include another SHEET's draft", () => {
    saveDraft(draftFrom({ state: reviewed(), ...AT, page: 99, finderVersion: "old1" })!);
    expect(otherDrafts(AT.set, AT.page, AT.finderVersion)).toEqual([]);
  });
});
