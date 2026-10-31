import { describe, expect, it, vi } from "vitest";
import { exclusionUndoEntry, type ExclusionRow } from "./exclusionUndo";
import { pushed, undoOnce, redoOnce } from "./undoStack";

const row: ExclusionRow = { id: "first", kind: "EXCLUDE_LIKE", xs: [0, 1], ys: [0, 0] };
const ok = (ids: string[]) => ({ ok: true as const, value: { ids } });

function entry() {
  const ports = {
    remove: vi.fn(async (_id: string) => ok([])),
    add: vi.fn(async (_row: ExclusionRow) => ok(["second"])),
    removed: vi.fn(async () => {}),
    added: vi.fn(async () => {}),
  };
  return { ports, state: pushed({ done: [], undone: [] }, exclusionUndoEntry(row, ports)) };
}

describe("the top bar's undo for an exclusion", () => {
  it("removes the row and tells the workspace not to reload over the screen", async () => {
    const { ports, state } = entry();
    const out = await undoOnce(state);
    expect(ports.remove).toHaveBeenCalledWith("first");
    expect(ports.removed).toHaveBeenCalledTimes(1);
    expect(out?.inPlace).toBe(true);
  });
  it("after a redo, the next undo removes the row the redo saved", async () => {
    const { ports, state } = entry();
    const undone = await undoOnce(state);
    const redone = await redoOnce(undone!.state);
    expect(ports.added).toHaveBeenCalledWith(ok(["second"]), { ...row, id: "second" });
    await undoOnce(redone!.state);
    expect(ports.remove).toHaveBeenLastCalledWith("second");
  });
  it("leaves the screen alone when the action refuses, and stays on the stack", async () => {
    const { ports, state } = entry();
    ports.remove.mockResolvedValueOnce({ ok: false, error: "No." } as never);
    const out = await undoOnce(state);
    expect(ports.removed).not.toHaveBeenCalled();
    expect(out?.state).toBe(state);
  });
});
