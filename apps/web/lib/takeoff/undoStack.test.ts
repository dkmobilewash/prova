import { describe, expect, it, vi } from "vitest";

import {
  DEPTH,
  EMPTY,
  type UndoEntry,
  type UndoState,
  canRedo,
  canUndo,
  nextRedoLabel,
  nextUndoLabel,
  pushed,
  redoOnce,
  undoOnce,
} from "./undoStack";

const ok = { ok: true } as const;
const fail = { ok: false, error: "Gone." } as const;

function entry(label: string, over: Partial<UndoEntry> = {}): UndoEntry {
  return {
    label,
    undo: vi.fn().mockResolvedValue(ok),
    redo: vi.fn().mockResolvedValue(ok),
    ...over,
  };
}

describe("pushed", () => {
  it("records the action and says what undo would reverse", () => {
    const state = pushed(EMPTY, entry("Delete measurement"));
    expect(canUndo(state)).toBe(true);
    expect(nextUndoLabel(state)).toBe("Delete measurement");
    expect(canRedo(state)).toBe(false);
    expect(nextUndoLabel(EMPTY)).toBeNull();
  });

  it("CLEARS THE REDO ARM, because the drawing has diverged", async () => {
    // Redoing what came after a new edit would apply it to a sheet it was
    // never computed against. The standard behaviour, and the only safe one.
    let state = pushed(EMPTY, entry("A"));
    const undone = await undoOnce(state);
    state = undone!.state;
    expect(canRedo(state)).toBe(true);

    state = pushed(state, entry("B"));
    expect(canRedo(state)).toBe(false);
    expect(nextUndoLabel(state)).toBe("B");
  });

  it("keeps the newest DEPTH entries and drops the oldest", () => {
    // Bounded because entries close over geometry: an area with two hundred
    // vertices is held alive by its own undo.
    let state: UndoState = EMPTY;
    for (let i = 0; i < DEPTH + 10; i += 1) state = pushed(state, entry(`edit ${i}`));
    expect(state.done).toHaveLength(DEPTH);
    expect(state.done[0].label).toBe("edit 10");
    expect(nextUndoLabel(state)).toBe(`edit ${DEPTH + 9}`);
  });
});

describe("undoOnce", () => {
  it("runs the newest inverse and moves it to the redo arm", async () => {
    const one = entry("Draw line");
    const moved = await undoOnce(pushed(EMPTY, one));
    expect(one.undo).toHaveBeenCalledOnce();
    expect(moved?.result.ok).toBe(true);
    expect(canUndo(moved!.state)).toBe(false);
    expect(nextRedoLabel(moved!.state)).toBe("Draw line");
  });

  it("runs them newest-first", async () => {
    const state = pushed(pushed(EMPTY, entry("first")), entry("second"));
    const moved = await undoOnce(state);
    expect(moved?.label).toBe("second");
    expect(nextUndoLabel(moved!.state)).toBe("first");
  });

  it("DOES NOT MOVE THE STACK WHEN THE SERVER REFUSES", async () => {
    // THE RULE THE WHOLE FILE TURNS ON. Popping a failed undo would leave the
    // user unable to retry AND leave the stack describing a history that did
    // not happen. The next ⌘Z must try the same thing again.
    const stubborn = entry("Delete measurement", { undo: vi.fn().mockResolvedValue(fail) });
    const state = pushed(EMPTY, stubborn);
    const attempted = await undoOnce(state);

    expect(attempted?.result).toEqual(fail);
    expect(attempted?.state).toBe(state);
    expect(canUndo(attempted!.state)).toBe(true);
    expect(canRedo(attempted!.state)).toBe(false);
    expect(nextUndoLabel(attempted!.state)).toBe("Delete measurement");
  });

  it("is null on an empty stack rather than throwing", async () => {
    expect(await undoOnce(EMPTY)).toBeNull();
    expect(await redoOnce(EMPTY)).toBeNull();
  });
});

describe("redoOnce", () => {
  it("puts the entry back where undo found it", async () => {
    const one = entry("Draw area");
    const undone = await undoOnce(pushed(EMPTY, one));
    const redone = await redoOnce(undone!.state);

    expect(one.redo).toHaveBeenCalledOnce();
    expect(canUndo(redone!.state)).toBe(true);
    expect(canRedo(redone!.state)).toBe(false);
    expect(nextUndoLabel(redone!.state)).toBe("Draw area");
  });

  it("holds the stack still when the redo is refused", async () => {
    const one = entry("Draw area", { redo: vi.fn().mockResolvedValue(fail) });
    const undone = await undoOnce(pushed(EMPTY, one));
    const attempted = await redoOnce(undone!.state);

    expect(attempted?.result).toEqual(fail);
    expect(attempted?.state).toBe(undone!.state);
    expect(canRedo(attempted!.state)).toBe(true);
  });

  it("survives a full round trip without duplicating the entry", async () => {
    let state = pushed(pushed(EMPTY, entry("a")), entry("b"));
    state = (await undoOnce(state))!.state;
    state = (await undoOnce(state))!.state;
    expect(state.done).toHaveLength(0);
    expect(state.undone.map((e) => e.label)).toEqual(["a", "b"]);

    state = (await redoOnce(state))!.state;
    state = (await redoOnce(state))!.state;
    expect(state.done.map((e) => e.label)).toEqual(["a", "b"]);
    expect(state.undone).toHaveLength(0);
  });
});
