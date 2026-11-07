// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueGroupConfirm } from "./QueueGroupConfirm";

// "A" gives the picked type to every group on the sheet nothing names. With no
// height for the type it first asks for one, in the height box — and Enter there
// accepted only the group on screen (ELEVEN03 A3.2: "on all 15 groups", 1 taken).
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));
const box = () => host.querySelector("[data-takeoff=queue-height]") as HTMLInputElement;
const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const setValue = (value: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(box(), value);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
function paint() {
  const onAccept = vi.fn();
  const onAcceptRest = vi.fn();
  act(() =>
    root.render(
      createElement(QueueGroupConfirm, {
        label: "Walls · sheet A3.2",
        codes: ["1ME", "2WA"],
        suggested: null,
        heightOf: () => null,
        onAccept,
        onAcceptRest,
        rest: "15 groups nothing names on A3.2",
        onSkip: () => {},
      }),
    ),
  );
  return { onAccept, onAcceptRest };
}

describe("accepting the rest when the type has no height", () => {
  it("ENTER IN THE HEIGHT BOX, left empty, gives the type to ALL the groups, as A said", () => {
    const { onAccept, onAcceptRest } = paint();
    press("1");
    press("a");
    // Asked for a height first, in the box, and says the answer is for all of them.
    expect(document.activeElement).toBe(box());
    expect(host.querySelector("[data-takeoff=queue-ask-height]")?.textContent).toContain("on all 15 groups nothing names on A3.2");
    expect(onAcceptRest).not.toHaveBeenCalled();
    act(() => box().form!.requestSubmit());
    expect(onAcceptRest).toHaveBeenCalledWith("1ME", null);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("a height typed there goes to all of them too", () => {
    const { onAccept, onAcceptRest } = paint();
    press("1");
    press("a");
    setValue(`9'-6"`);
    act(() => box().form!.requestSubmit());
    expect(onAcceptRest).toHaveBeenCalledWith("1ME", 9.5);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("Enter on the group alone, asked for its height, still takes only that group", () => {
    const { onAccept, onAcceptRest } = paint();
    press("1");
    press("Enter");
    act(() => box().form!.requestSubmit());
    expect(onAccept).toHaveBeenCalledWith("1ME", null);
    expect(onAcceptRest).not.toHaveBeenCalled();
  });
});
