import { describe, expect, it } from "vitest";
import type { PursuitRow } from "@/lib/bid-pursuits-query";
import { applyPursuitChanges, draftPursuit, heldOver, type HeldChange } from "./pursuitListChanges";

const row = (overrides: Partial<PursuitRow> & { id: string }): PursuitRow => ({
  projectName: overrides.id,
  owner: null,
  architect: null,
  expectedGcs: null,
  note: null,
  stage: "WATCHING",
  expectedBidDate: null,
  lastUpdated: "2026-09-10",
  estimatedValue: null,
  open: true,
  goneQuiet: false,
  bidDateComingUp: false,
  bidDatePassed: false,
  daysSinceUpdate: 0,
  invitation: null,
  ...overrides,
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("draftPursuit", () => {
  it("reads the row from the same fields the action reads", () => {
    const draft = draftPursuit(
      form({
        projectName: "  Harbor lofts ",
        owner: "",
        architect: "Gensler",
        expectedGcs: "Turner",
        stage: "CONTACTED",
        expectedBidDate: "2026-11-02",
        estimatedValue: "$1,250,000",
        note: "",
      }),
      "2026-09-18",
      { id: "saving-1", invitation: null },
    );
    expect(draft).toMatchObject({
      id: "saving-1",
      projectName: "Harbor lofts",
      owner: null,
      architect: "Gensler",
      expectedGcs: "Turner",
      stage: "CONTACTED",
      expectedBidDate: "2026-11-02",
      estimatedValue: 1_250_000,
      lastUpdated: "2026-09-18",
      open: true,
      saving: true,
    });
  });

  it("makes no claim the server has not made", () => {
    const draft = draftPursuit(form({ projectName: "X", expectedBidDate: "2020-01-01" }), "2026-09-18", {
      id: "saving-1",
      invitation: null,
    });
    // A bid date in the past: whether that is "passed" is the server's call.
    expect(draft.bidDatePassed).toBe(false);
    expect(draft.goneQuiet).toBe(false);
    expect(draft.bidDateComingUp).toBe(false);
  });

  it("shows a value the server would refuse as absent, never as a number", () => {
    const draft = draftPursuit(form({ projectName: "X", estimatedValue: "a lot", stage: "NONSENSE" }), "2026-09-18", {
      id: "saving-1",
      invitation: null,
    });
    expect(draft.estimatedValue).toBeNull();
    expect(draft.stage).toBe("WATCHING");
  });

  it("an Invited or Dropped stage is not open", () => {
    const draft = draftPursuit(form({ projectName: "X", stage: "DROPPED" }), "2026-09-18", {
      id: "p1",
      invitation: null,
    });
    expect(draft.open).toBe(false);
  });
});

describe("applyPursuitChanges", () => {
  const list = [row({ id: "a", expectedBidDate: "2026-10-01" }), row({ id: "b" })];

  it("returns the very same array when there is nothing to apply", () => {
    expect(applyPursuitChanges(list, [])).toBe(list);
  });

  it("puts a created row where the server's sort would", () => {
    const created = row({ id: "saving-1", expectedBidDate: "2026-09-20" });
    expect(applyPursuitChanges(list, [{ kind: "create", row: created }]).map((r) => r.id)).toEqual([
      "saving-1",
      "a",
      "b",
    ]);
  });

  it("replaces an edited row and drops a removed one, leaving the input alone", () => {
    const shown = applyPursuitChanges(list, [
      { kind: "edit", row: row({ id: "b", projectName: "renamed" }) },
      { kind: "remove", id: "a" },
    ]);
    expect(shown.map((r) => [r.id, r.projectName])).toEqual([["b", "renamed"]]);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("shows a created row once when the same create is both held and still in flight", () => {
    // Seen in the browser on #316: after a save succeeds the create is held
    // (so it survives until the refreshed list arrives) while useOptimistic
    // still applies the in-flight copy on top. Two rows with key "saving-1"
    // made React warn about duplicate keys and leave a "saving…" ghost next
    // to the real row after the refresh.
    const created = row({ id: "saving-1" });
    const held = applyPursuitChanges(list, [{ kind: "create", row: created }]);
    const shown = applyPursuitChanges(held, [{ kind: "create", row: created }]);
    expect(shown.map((r) => r.id)).toEqual(["a", "b", "saving-1"]);
  });
});

describe("heldOver", () => {
  it("keeps a held change only while the props it was made over are on screen", () => {
    const before = [row({ id: "a" })];
    const after = [row({ id: "a" }), row({ id: "new" })];
    const held: HeldChange[] = [{ kind: "remove", id: "a", basis: before }];
    expect(heldOver(held, before)).toHaveLength(1);
    // Same contents, new array: the server re-rendered, so it wins.
    expect(heldOver(held, [...before])).toHaveLength(0);
    expect(heldOver(held, after)).toHaveLength(0);
  });
});
