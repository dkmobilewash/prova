import type { ActionResultWith } from "@/lib/actions/shared";
import type { UndoEntry } from "./undoStack";

export type ExclusionRow = { id: string; kind: "EXCLUDE_LIKE" | "WORK_AREA" | "ROOM_SPLIT"; xs: number[]; ys: number[] };
type Saved = ActionResultWith<{ ids: string[] }>;

/**
 * The top bar's undo for one exclusion. A redo saves a NEW row, so the id is
 * carried here: the undo after a redo has to remove that row, not the first.
 */
export function exclusionUndoEntry(
  row: ExclusionRow,
  ports: {
    remove: (id: string) => Promise<Saved>;
    add: (row: ExclusionRow) => Promise<Saved>;
    /** Puts the screen right after a change that saved. */
    removed: (result: Saved, id: string) => Promise<void>;
    added: (result: Saved, row: ExclusionRow) => Promise<void>;
  },
): UndoEntry {
  let id = row.id;
  return {
    label: row.kind === "WORK_AREA" ? "Draw work area" : row.kind === "ROOM_SPLIT" ? "Split area" : "Exclude walls",
    inPlace: true,
    undo: async () => {
      const result = await ports.remove(id);
      if (result.ok) await ports.removed(result, id);
      return result;
    },
    redo: async () => {
      const result = await ports.add(row);
      if (!result.ok) return result;
      id = result.value.ids[0];
      await ports.added(result, { ...row, id });
      return result;
    },
  };
}
