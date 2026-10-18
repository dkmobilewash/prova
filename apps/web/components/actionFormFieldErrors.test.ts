// @vitest-environment happy-dom

/**
 * `ActionForm`'s two usability halves: a refusal lands NEXT TO the field it
 * is about (not only as one sentence at the bottom), and typing is not lost
 * — leaving asks first, and `draftKey` brings a draft back.
 *
 * Plus the server half that feeds it: an `InputError` raised with a field
 * name comes out of `runAction` as `fieldErrors`.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prova/db", () => ({ prisma: {} }));

const { ActionForm } = await import("@/components/ActionForm");
const { InputError, runAction, actionFail } = await import("@/lib/actions/shared");
const { numberFromForm } = await import("@/lib/actions/shared");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type Result = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.restoreAllMocks();
});

function render(action: (fd: FormData) => Promise<Result | void>, extra: { draftKey?: string } = {}) {
  act(() => {
    root.render(
      createElement(
        ActionForm,
        { action, ...extra },
        createElement("label", { key: "t" }, "Title", createElement("input", { name: "title", defaultValue: "" })),
        createElement(
          "label",
          { key: "d" },
          "Due back",
          createElement("input", { name: "dueBack", defaultValue: "", "aria-describedby": "hint" }),
        ),
        createElement("input", { key: "p", name: "secret", type: "password", defaultValue: "" }),
        createElement("button", { key: "b", type: "submit" }, "Save"),
      ),
    );
  });
}

const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const form = () => container.querySelector("form")!;

/** Type the way a person does — through the native setter, so React's value
 * tracker sees a change and fires the form's onChange. */
function type(name: string, value: string) {
  const input = field(name);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  act(() => {
    form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

function beforeUnloadBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("field errors", () => {
  it("puts each message under its own input, marks it invalid, and focuses the first one in form order", async () => {
    // Deliberately listed out of form order: focus follows the FORM.
    render(async () => ({
      ok: false,
      error: "Two things need fixing",
      fieldErrors: { dueBack: "Can't be before it was sent", title: "Title is required" },
    }));
    await submit();

    const title = field("title");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    const note = document.getElementById(title.getAttribute("aria-describedby")!)!;
    expect(note.textContent).toBe("Title is required");
    // Inside the field's own label, so it sits under that box.
    expect(note.parentElement).toBe(title.closest("label"));

    // An existing describedby (a hint) is kept, not replaced.
    const ids = field("dueBack").getAttribute("aria-describedby")!.split(" ");
    expect(ids[0]).toBe("hint");
    expect(document.getElementById(ids[1]!)!.textContent).toBe("Can't be before it was sent");

    expect(document.activeElement).toBe(title);
    // The sentence at the bottom stays, as an alert.
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Two things need fixing");
  });

  it("clears a field's message as soon as that field is edited, and all of them on the next submit", async () => {
    let result: Result = { ok: false, error: "x", fieldErrors: { title: "Title is required", dueBack: "Bad date" } };
    render(async () => result);
    await submit();

    type("title", "Shop drawings");
    expect(field("title").hasAttribute("aria-invalid")).toBe(false);
    expect(field("title").hasAttribute("aria-describedby")).toBe(false);
    expect(container.textContent).not.toContain("Title is required");
    expect(container.textContent).toContain("Bad date");

    result = { ok: true };
    await submit();
    expect(container.querySelectorAll("[data-field-error]")).toHaveLength(0);
    expect(field("dueBack").getAttribute("aria-describedby")).toBe("hint");
  });

  it("a plain { ok: false, error } still renders exactly as before", async () => {
    render(async () => ({ ok: false, error: "Job not found" }));
    await submit();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Job not found");
    expect(container.querySelectorAll("[aria-invalid]")).toHaveLength(0);
  });
});

describe("not losing work", () => {
  it("asks before leaving once something is typed, and stops asking after a successful save", async () => {
    render(async () => ({ ok: true }));
    expect(beforeUnloadBlocked()).toBe(false);

    type("title", "Half typed");
    expect(beforeUnloadBlocked()).toBe(true);

    await submit();
    expect(beforeUnloadBlocked()).toBe(false);
  });

  it("stops an in-app link when the person chooses to stay, and lets it go when they choose to leave", () => {
    render(async () => ({ ok: true }));
    type("title", "Half typed");
    const link = document.createElement("a");
    link.href = "/jobs";
    document.body.appendChild(link);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const stay = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(stay);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(stay.defaultPrevented).toBe(true);

    confirm.mockReturnValue(true);
    const leave = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    // They chose to go — the tab-close prompt must not ask a second time.
    expect(beforeUnloadBlocked()).toBe(false);
    link.remove();
  });

  it("with a draftKey: saves what was typed, brings it back on the next mount, never stores a password, and forgets it on success", async () => {
    render(async () => ({ ok: true }), { draftKey: "test:draft" });
    type("title", "Fire caulk at level 3");
    type("secret", "hunter2");
    expect(JSON.stringify(window.sessionStorage)).toContain("Fire caulk at level 3");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("hunter2");

    // Navigate away and back: the form unmounts and mounts again.
    act(() => root.unmount());
    root = createRoot(container);
    render(async () => ({ ok: true }), { draftKey: "test:draft" });
    expect(field("title").value).toBe("Fire caulk at level 3");
    expect(container.textContent).toContain("it was never saved");

    await submit();
    expect(JSON.stringify(window.sessionStorage)).not.toContain("Fire caulk");
  });

  it("without a draftKey stores nothing at all", () => {
    render(async () => ({ ok: true }));
    type("title", "Not kept");
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("the server half", () => {
  it("runAction turns an InputError with a field into fieldErrors", async () => {
    await expect(
      runAction(async () => {
        throw new InputError("Title is required", "title");
      }),
    ).resolves.toEqual({ ok: false, error: "Title is required", fieldErrors: { title: "Title is required" } });
  });

  it("the shared number parser names its field without the caller doing anything", async () => {
    const fd = new FormData();
    fd.set("quantity", "twelve");
    const result = await runAction(async () => {
      numberFromForm(fd, "quantity");
      return { ok: true };
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && Object.keys(result.fieldErrors ?? {})).toEqual(["quantity"]);
  });

  it("time-entry figures name the box that was wrong", async () => {
    const { parseTimeEntryFigures } = await import("@/lib/time-entry-correction");
    const fd = new FormData();
    fd.set("hours", "8");
    fd.set("perDiemAmount", "fifty");
    const parsed = parseTimeEntryFigures(fd);
    expect(parsed.ok === false && parsed.field).toBe("perDiemAmount");
    fd.set("hours", "eight");
    expect(parseTimeEntryFigures(fd)).toMatchObject({ ok: false, field: "hours" });
  });

  it("a fieldless refusal keeps its old shape exactly", () => {
    expect(actionFail("Job not found")).toStrictEqual({ ok: false, error: "Job not found" });
  });
});
