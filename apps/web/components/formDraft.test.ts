import { describe, expect, it } from "vitest";
import {
  applyDraftValues,
  clearDraft,
  collectDraftValues,
  decodeDraft,
  draftStorageKey,
  encodeDraft,
  readDraft,
  writeDraft,
  type DraftControl,
  type DraftStore,
} from "./formDraft";

/** Draft persistence, pure half (#239). These run in the node environment —
 * no DOM — which is why every case works on plain `DraftControl` objects
 * and a Map-backed store. The DOM half (`useFormDraft.tsx`) is three
 * attributes of wiring over these functions plus React state; what can be
 * wrong is here: what gets captured, what gets skipped, what a hostile or
 * absent storage does, and what restore refuses to touch. */

function control(overrides: Partial<DraftControl>): DraftControl {
  return { name: "", type: "text", disabled: false, value: "", ...overrides };
}

function fakeStore(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Storage that throws on every touch — private windows and blocked site
 * data do exactly this, and the form must shrug it off. */
const throwingStore: DraftStore = {
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

describe("collectDraftValues", () => {
  it("captures text, textarea and select values by name", () => {
    const values = collectDraftValues([
      control({ name: "description", value: "grid out of level" }),
      control({ name: "notes", type: "textarea", value: "east corridor" }),
      control({ name: "jobId", type: "select-one", value: "job_2" }),
    ]);
    expect(values).toEqual({
      description: "grid out of level",
      notes: "east corridor",
      jobId: "job_2",
    });
  });

  it("records a checkbox as a boolean, checked or not", () => {
    expect(
      collectDraftValues([control({ name: "isDone", type: "checkbox", checked: true })]),
    ).toEqual({ isDone: true });
    expect(
      collectDraftValues([control({ name: "isDone", type: "checkbox", checked: false })]),
    ).toEqual({ isDone: false });
  });

  it("records only the checked member of a radio group", () => {
    const values = collectDraftValues([
      control({ name: "severity", type: "radio", value: "low", checked: false }),
      control({ name: "severity", type: "radio", value: "high", checked: true }),
    ]);
    expect(values).toEqual({ severity: "high" });
  });

  it("records nothing for a radio group with no selection", () => {
    const values = collectDraftValues([
      control({ name: "severity", type: "radio", value: "low", checked: false }),
    ]);
    expect(values).toEqual({});
  });

  it("skips file, password, hidden, buttons, disabled and unnamed controls", () => {
    const values = collectDraftValues([
      control({ name: "photo", type: "file", value: "C:\\fake\\p.jpg" }),
      control({ name: "secret", type: "password", value: "hunter2" }),
      control({ name: "rowId", type: "hidden", value: "row_9" }),
      control({ name: "go", type: "submit", value: "Save" }),
      control({ name: "stop", type: "button", value: "Cancel" }),
      control({ name: "frozen", value: "text", disabled: true }),
      control({ name: "", value: "nameless" }),
      control({ name: "kept", value: "yes" }),
    ]);
    expect(values).toEqual({ kept: "yes" });
  });
});

describe("applyDraftValues", () => {
  it("writes stored strings back onto matching controls and counts them", () => {
    const description = control({ name: "description", value: "" });
    const untouched = control({ name: "other", value: "server default" });
    const applied = applyDraftValues([description, untouched], { description: "restored text" });
    expect(description.value).toBe("restored text");
    expect(untouched.value).toBe("server default");
    expect(applied).toBe(1);
  });

  it("restores checkbox state from a boolean", () => {
    const box = control({ name: "isDone", type: "checkbox", checked: false });
    const applied = applyDraftValues([box], { isDone: true });
    expect(box.checked).toBe(true);
    expect(applied).toBe(1);
  });

  it("checks the matching radio and unchecks the rest", () => {
    const low = control({ name: "severity", type: "radio", value: "low", checked: true });
    const high = control({ name: "severity", type: "radio", value: "high", checked: false });
    applyDraftValues([low, high], { severity: "high" });
    expect(low.checked).toBe(false);
    expect(high.checked).toBe(true);
  });

  it("counts an already-identical value as not applied", () => {
    const same = control({ name: "description", value: "unchanged" });
    expect(applyDraftValues([same], { description: "unchanged" })).toBe(0);
  });

  it("never touches hidden or password controls, even when the draft names them", () => {
    const rowId = control({ name: "rowId", type: "hidden", value: "row_real" });
    const secret = control({ name: "secret", type: "password", value: "" });
    const applied = applyDraftValues([rowId, secret], { rowId: "row_forged", secret: "x" });
    expect(rowId.value).toBe("row_real");
    expect(secret.value).toBe("");
    expect(applied).toBe(0);
  });

  it("rejects a type-mismatched value rather than coercing it", () => {
    const box = control({ name: "isDone", type: "checkbox", checked: false });
    const text = control({ name: "description", value: "default" });
    const applied = applyDraftValues([box, text], {
      isDone: "true" as never,
      description: true as never,
    });
    expect(box.checked).toBe(false);
    expect(text.value).toBe("default");
    expect(applied).toBe(0);
  });

  it("rolls a select back when the stored option no longer exists", () => {
    // A real <select> answers an unknown assignment with value "" — model
    // that with a setter that only accepts known options.
    let current = "job_default";
    const select: DraftControl = {
      name: "jobId",
      type: "select-one",
      disabled: false,
      checked: undefined,
      get value() {
        return current;
      },
      set value(next: string) {
        current = ["job_default", "job_2"].includes(next) ? next : "";
      },
    };
    const applied = applyDraftValues([select], { jobId: "job_deleted" });
    expect(select.value).toBe("job_default");
    expect(applied).toBe(0);
    // …and a still-valid option restores normally.
    expect(applyDraftValues([select], { jobId: "job_2" })).toBe(1);
    expect(select.value).toBe("job_2");
  });
});

describe("encodeDraft / decodeDraft", () => {
  it("round-trips values", () => {
    const values = { description: "text", isDone: true, jobId: "job_1" };
    expect(decodeDraft(encodeDraft(values, 123))).toEqual(values);
  });

  it("returns null for null, empty, non-JSON and malformed JSON input", () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft("")).toBeNull();
    expect(decodeDraft("not json {")).toBeNull();
    expect(decodeDraft('"a bare string"')).toBeNull();
    expect(decodeDraft("[1,2,3]")).toBeNull();
    expect(decodeDraft("{}")).toBeNull();
  });

  it("returns null for a wrong version or a missing/invalid values object", () => {
    expect(decodeDraft(JSON.stringify({ v: 999, savedAt: 1, values: { a: "b" } }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ v: 1, savedAt: 1 }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ v: 1, savedAt: 1, values: [1] }))).toBeNull();
  });

  it("drops non-string, non-boolean entries and nulls out an empty record", () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: 1,
      values: { keep: "yes", also: false, dropped: 42, gone: { nested: true } },
    });
    expect(decodeDraft(raw)).toEqual({ keep: "yes", also: false });
    expect(decodeDraft(JSON.stringify({ v: 1, savedAt: 1, values: { only: 42 } }))).toBeNull();
  });
});

describe("readDraft / writeDraft / clearDraft", () => {
  it("stores under the namespaced key and reads back what it wrote", () => {
    const store = fakeStore();
    writeDraft(store, "punch-list:create", { description: "drywall gap" });
    expect(store.map.has(draftStorageKey("punch-list:create"))).toBe(true);
    expect(readDraft(store, "punch-list:create")).toEqual({ description: "drywall gap" });
  });

  it("keeps two draft keys apart — two rows' edit forms never share", () => {
    const store = fakeStore();
    writeDraft(store, "equipment:edit:eq_1", { name: "Lift A" });
    writeDraft(store, "equipment:edit:eq_2", { name: "Lift B" });
    expect(readDraft(store, "equipment:edit:eq_1")).toEqual({ name: "Lift A" });
    expect(readDraft(store, "equipment:edit:eq_2")).toEqual({ name: "Lift B" });
  });

  it("clearDraft removes the draft so the next read finds nothing", () => {
    const store = fakeStore();
    writeDraft(store, "rfi:create", { subject: "beam conflict" });
    clearDraft(store, "rfi:create");
    expect(readDraft(store, "rfi:create")).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("writing an empty record clears instead of storing an empty draft", () => {
    const store = fakeStore();
    writeDraft(store, "vendor:create", { name: "Acme" });
    writeDraft(store, "vendor:create", {});
    expect(readDraft(store, "vendor:create")).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("survives a storage that throws on every call", () => {
    expect(() => writeDraft(throwingStore, "k", { a: "b" })).not.toThrow();
    expect(() => clearDraft(throwingStore, "k")).not.toThrow();
    expect(readDraft(throwingStore, "k")).toBeNull();
  });

  it("treats an absent storage as no draft", () => {
    expect(readDraft(null, "k")).toBeNull();
    expect(() => writeDraft(null, "k", { a: "b" })).not.toThrow();
    expect(() => clearDraft(null, "k")).not.toThrow();
  });

  it("reads garbage someone else left under our key as no draft", () => {
    const store = fakeStore();
    store.map.set(draftStorageKey("rfi:create"), "%%% not json");
    expect(readDraft(store, "rfi:create")).toBeNull();
  });
});
