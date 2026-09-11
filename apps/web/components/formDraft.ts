/**
 * Draft persistence for forms — the pure half (issue #239, redline item 01).
 *
 * Half-fill a submittal, tap a job chip to check something, come back:
 * before this, the typing was gone, silently. These functions serialize a
 * form's field values to a plain record, encode/decode that record for
 * storage, and apply a stored record back onto the form's controls.
 *
 * sessionStorage, not localStorage, is the intended store (the hook in
 * `useFormDraft.tsx` supplies it): a draft should survive navigating
 * around the app in the same tab — which is exactly how the work gets
 * lost — but NOT resurface days later on a fresh visit, half-describing a
 * punch item that was long since fixed. A stale draft silently restored
 * into an evidence record's form is worse than a lost one, because the
 * lost one at least announces itself. AskPanel.tsx made the same call for
 * the same reason.
 *
 * Deliberately no DOM types here: everything works on a structural
 * `DraftControl` shape that real `<input>`/`<textarea>`/`<select>`
 * elements satisfy, so this module unit-tests in the node environment the
 * vitest config mandates (no browser, no happy-dom).
 *
 * Every storage touch goes through readDraft/writeDraft/clearDraft, each
 * wrapped in try/catch — storage can throw on read AND on write (private
 * windows, quota, browsers set to block site data), and a form must
 * render and submit exactly as before when it does.
 */

export type DraftFieldValue = string | boolean;
export type DraftValues = Record<string, DraftFieldValue>;

/** Bump when the stored shape changes; decodeDraft drops other versions. */
const DRAFT_VERSION = 1;

/** Namespaced so a draft key can never collide with AskPanel's key or
 * anything else the app keeps in the same storage. */
export function draftStorageKey(draftKey: string): string {
  return `prova:formDraft:${draftKey}`;
}

/** The slice of an input/textarea/select this module needs. Real DOM
 * elements satisfy it structurally; tests use plain objects. */
export type DraftControl = {
  name: string;
  /** DOM `type`: "text", "checkbox", "radio", "textarea", "select-one", … */
  type: string;
  disabled: boolean;
  value: string;
  checked?: boolean;
};

/** Field types never captured into a draft:
 * - file: not serializable, and a stale path is meaningless;
 * - password: never persist a secret to storage;
 * - hidden: server-set identity (ids, tokens), not user typing — restoring
 *   one could silently repoint an edit at the wrong row;
 * - buttons: not values;
 * - select-multiple: nothing in this app uses one; skipping is safer than
 *   half-restoring it. */
const SKIPPED_TYPES = new Set([
  "file",
  "password",
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "select-multiple",
]);

function isDraftable(control: DraftControl): boolean {
  return Boolean(control.name) && !control.disabled && !SKIPPED_TYPES.has(control.type);
}

/** Read the current user-editable values off a form's controls.
 *
 * Checkboxes record their checked state as a boolean (FormData would just
 * omit an unchecked box, which restore couldn't distinguish from "never
 * saved"). A radio group records only the checked member's value. */
export function collectDraftValues(controls: Iterable<DraftControl>): DraftValues {
  const values: DraftValues = {};
  for (const control of controls) {
    if (!isDraftable(control)) continue;
    if (control.type === "checkbox") {
      values[control.name] = control.checked === true;
    } else if (control.type === "radio") {
      if (control.checked === true) values[control.name] = control.value;
    } else {
      values[control.name] = control.value;
    }
  }
  return values;
}

/** Write a stored record back onto the controls. Returns how many controls
 * changed, so the caller knows whether anything was actually restored.
 *
 * Only names present in `values` are touched — a field added to the form
 * after the draft was saved keeps its server-rendered default. A
 * `select-one` whose stored value no longer matches any option is rolled
 * back to what it showed before (the DOM answers an unknown assignment
 * with value "", which would blank a required select). */
export function applyDraftValues(controls: Iterable<DraftControl>, values: DraftValues): number {
  let applied = 0;
  for (const control of controls) {
    if (!isDraftable(control)) continue;
    if (!(control.name in values)) continue;
    const stored = values[control.name];
    if (control.type === "checkbox") {
      if (typeof stored !== "boolean") continue;
      if (control.checked !== stored) {
        control.checked = stored;
        applied += 1;
      }
    } else if (control.type === "radio") {
      if (typeof stored !== "string") continue;
      const shouldCheck = control.value === stored;
      if (control.checked !== shouldCheck) {
        control.checked = shouldCheck;
        if (shouldCheck) applied += 1;
      }
    } else {
      if (typeof stored !== "string") continue;
      if (control.value === stored) continue;
      const previous = control.value;
      control.value = stored;
      if (control.type === "select-one" && control.value !== stored) {
        // The option is gone (e.g. the job list changed); keep the default.
        control.value = previous;
        continue;
      }
      applied += 1;
    }
  }
  return applied;
}

type StoredDraft = { v: number; savedAt: number; values: DraftValues };

export function encodeDraft(values: DraftValues, savedAt: number = Date.now()): string {
  const stored: StoredDraft = { v: DRAFT_VERSION, savedAt, values };
  return JSON.stringify(stored);
}

/** Strict on the way back in: wrong version, wrong shape, non-JSON, or an
 * empty record all decode to null, never to a half-usable object. */
export function decodeDraft(raw: string | null | undefined): DraftValues | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<StoredDraft>;
    if (candidate.v !== DRAFT_VERSION) return null;
    const values = candidate.values;
    if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
    const out: DraftValues = {};
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === "string" || typeof value === "boolean") out[name] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** What the storage functions need from sessionStorage. Narrow on purpose,
 * so tests hand in a Map-backed fake and the hook hands in the real one. */
export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readDraft(store: DraftStore | null, draftKey: string): DraftValues | null {
  if (!store) return null;
  try {
    return decodeDraft(store.getItem(draftStorageKey(draftKey)));
  } catch {
    return null;
  }
}

export function writeDraft(store: DraftStore | null, draftKey: string, values: DraftValues): void {
  if (!store) return;
  try {
    if (Object.keys(values).length === 0) {
      store.removeItem(draftStorageKey(draftKey));
      return;
    }
    store.setItem(draftStorageKey(draftKey), encodeDraft(values));
  } catch {
    // Quota or blocked storage: the form still works, it just won't draft.
  }
}

export function clearDraft(store: DraftStore | null, draftKey: string): void {
  if (!store) return;
  try {
    store.removeItem(draftStorageKey(draftKey));
  } catch {
    // Nothing useful to do; the draft will age out with the tab.
  }
}
