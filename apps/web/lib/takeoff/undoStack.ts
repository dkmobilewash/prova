import type { ActionResult } from "@/lib/actions/shared";

/**
 * ── UNDO FOR TAKEOFF ACTIONS ──
 *
 * A takeoff is a hundred small irreversible-looking edits, and the thing that
 * makes somebody slow with a mouse is not the drawing — it is the fear of the
 * click they cannot take back. So every takeoff action registers its own
 * inverse here and `⌘Z` runs it.
 *
 * ── WHY A COMMAND STACK AND NOT A SERVER JOURNAL ──
 *
 * The design doc left this open as "a Phase 1 decision with real cost either
 * way". Taken, with the reasons, so it is not re-litigated:
 *
 *   - A journal means a table, a migration, a write on every edit, and a
 *     policy for how long history lives. It buys undo that survives a reload
 *     and crosses tabs.
 *   - A command stack costs one file and no schema. It buys undo that is gone
 *     on reload and is per-tab.
 *
 * **Per-tab and gone on reload is what every drawing tool already does**, so it
 * is what an estimator expects — and the alternative's one real advantage
 * (crossing tabs) is actively WRONG here: two tabs on one takeoff already warn
 * about each other, and an undo in one silently rewriting the other is the
 * lost update that warning exists to prevent.
 *
 * The upgrade path is open: every entry already carries a label and an
 * inverse, so a journal can be added later by persisting what is pushed here,
 * without the call sites changing.
 *
 * ── NOTHING HERE TOUCHES THE DATABASE ──
 *
 * An entry holds two thunks, `undo` and `redo`, and this file calls them. They
 * are the ordinary server actions the UI already uses, so an undo is subject
 * to exactly the same permission checks, validation and company scoping as the
 * action it reverses. There is no privileged "undo" path, and there must never
 * be one: a user who may not delete a measurement may not un-create one.
 */

export type UndoEntry = {
  /** Shown in the toast and the shortcut cheat sheet: "Delete measurement". */
  label: string;
  /** Reverses the action. Returns the ordinary ActionResult of whatever it calls. */
  undo: () => Promise<ActionResult>;
  /** Does it again. */
  redo: () => Promise<ActionResult>;
  /** The entry updates the screen itself, so the workspace must not reload over it. */
  inPlace?: boolean;
};

/**
 * How many steps are kept.
 *
 * Bounded because the entries close over geometry — an area with two hundred
 * vertices is held alive by its own undo — and an estimator can trace for
 * hours. Fifty is roughly a morning's edits and about a megabyte at the worst
 * shape we have measured.
 */
export const DEPTH = 50;

export type UndoState = {
  /** Oldest first. Everything at `at` and below can be undone. */
  done: UndoEntry[];
  /** Newest first. Everything here can be redone. */
  undone: UndoEntry[];
};

export const EMPTY: UndoState = { done: [], undone: [] };

/**
 * Record an action that has ALREADY happened.
 *
 * **A new action clears the redo arm**, which is the standard behaviour and
 * the only safe one: once the drawing has diverged, a redo of what came after
 * would be applied to a sheet it was never computed against.
 */
export function pushed(state: UndoState, entry: UndoEntry): UndoState {
  const done = [...state.done, entry];
  return { done: done.length > DEPTH ? done.slice(done.length - DEPTH) : done, undone: [] };
}

export const canUndo = (state: UndoState): boolean => state.done.length > 0;
export const canRedo = (state: UndoState): boolean => state.undone.length > 0;

/** What `⌘Z` would reverse, for the button's title and the toast. */
export const nextUndoLabel = (state: UndoState): string | null =>
  state.done.length === 0 ? null : state.done[state.done.length - 1].label;

export const nextRedoLabel = (state: UndoState): string | null =>
  state.undone.length === 0 ? null : state.undone[0].label;

/**
 * Run the newest undo.
 *
 * **A FAILED UNDO DOES NOT MOVE THE STACK**, and this is the rule the whole
 * file turns on. If the server refuses — the row is gone, somebody else has
 * the job open, a permission changed — then popping the entry would leave the
 * user unable to retry AND leave the stack describing a history that did not
 * happen. The action is reported as failed and the stack is untouched, so the
 * next `⌘Z` tries the same thing again.
 *
 * The caller serialises: `busy` in the hook below means a second undo cannot
 * start while one is in flight, because two inverse actions racing on one row
 * is precisely the lost update this app warns about elsewhere.
 */
export async function undoOnce(
  state: UndoState,
): Promise<{ state: UndoState; result: ActionResult; label: string; inPlace?: boolean } | null> {
  const entry = state.done[state.done.length - 1];
  if (!entry) return null;
  const result = await entry.undo();
  if (!result.ok) return { state, result, label: entry.label };
  return {
    state: { done: state.done.slice(0, -1), undone: [entry, ...state.undone] },
    result,
    label: entry.label,
    inPlace: entry.inPlace,
  };
}

/** The mirror of `undoOnce`, with the same failure rule. */
export async function redoOnce(
  state: UndoState,
): Promise<{ state: UndoState; result: ActionResult; label: string; inPlace?: boolean } | null> {
  const entry = state.undone[0];
  if (!entry) return null;
  const result = await entry.redo();
  if (!result.ok) return { state, result, label: entry.label };
  return {
    state: { done: [...state.done, entry], undone: state.undone.slice(1) },
    result,
    label: entry.label,
    inPlace: entry.inPlace,
  };
}
