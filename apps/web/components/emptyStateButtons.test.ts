// @vitest-environment happy-dom
/**
 * The empty state's three hand-off buttons, clicked.
 *
 * Each one reaches for something the page or the chrome already owns — the
 * page's own collapsed add button, the Topbar's assistant, the Help panel's
 * tour — so the only honest test is to put that thing on the page and watch
 * it get pressed. A source scan would pass on a selector that matches
 * nothing.
 */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => ({ push }),
}));

const { OpenFormButton, AskItButton, WalkthroughButton } = await import("@/components/EmptyStateButtons");
const { ASK_PREFILL_EVENT, WALKTHROUGH_EVENT, takePendingAsk, setPendingAsk } = await import(
  "@/lib/empty-state-events"
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // happy-dom implements neither; the buttons only need them to not throw.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  setPendingAsk(null);
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

function click(el: Element | null) {
  expect(el, "nothing to click").not.toBeNull();
  act(() => (el as HTMLElement).click());
}

describe("OpenFormButton", () => {
  it("presses the page's own collapsed add button, inside the anchored wrapper", () => {
    const pressed = vi.fn();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-tour", "contacts-add");
    const add = document.createElement("button");
    add.addEventListener("click", pressed);
    wrapper.appendChild(add);
    document.body.appendChild(wrapper);

    render(createElement(OpenFormButton, { target: "contacts-add", label: "Add a contact", primary: true }));
    click(container.querySelector("button"));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("presses the anchor itself when the anchor IS the button (MessageComposer)", () => {
    const pressed = vi.fn();
    const add = document.createElement("button");
    add.setAttribute("data-tour", "messages-compose");
    add.addEventListener("click", pressed);
    document.body.appendChild(add);

    render(createElement(OpenFormButton, { target: "messages-compose", label: "Send an email", primary: true }));
    click(container.querySelector("button"));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("focuses the first field instead when the form is already open, pressing nothing", () => {
    const pressed = vi.fn();
    const wrapper = document.createElement("section");
    wrapper.setAttribute("data-tour", "punch-add");
    const field = document.createElement("input");
    const submit = document.createElement("button");
    submit.addEventListener("click", pressed);
    wrapper.append(field, submit);
    document.body.appendChild(wrapper);

    render(createElement(OpenFormButton, { target: "punch-add", label: "Add an item", primary: true }));
    click(container.querySelector("button"));
    expect(document.activeElement).toBe(field);
    expect(pressed).not.toHaveBeenCalled();
  });
});

describe("AskItButton", () => {
  it("opens the Topbar assistant with the sentence waiting, and sends nothing", () => {
    const opened = vi.fn();
    const launcher = document.createElement("button");
    launcher.setAttribute("data-ask-launcher", "");
    launcher.setAttribute("aria-expanded", "false");
    launcher.addEventListener("click", opened);
    document.body.appendChild(launcher);

    render(createElement(AskItButton, { example: "Add Jane Smith as a contact" }));
    click(container.querySelector("button"));
    expect(opened).toHaveBeenCalledTimes(1);
    // No panel was mounted to take it, so it waits for the one that mounts.
    expect(takePendingAsk()).toBe("Add Jane Smith as a contact");
    expect(takePendingAsk(), "a waiting sentence is handed over once").toBeNull();
  });

  it("hands the sentence to a panel that is already open, without closing it", () => {
    const opened = vi.fn();
    const launcher = document.createElement("button");
    launcher.setAttribute("data-ask-launcher", "");
    launcher.setAttribute("aria-expanded", "true");
    launcher.addEventListener("click", opened);
    document.body.appendChild(launcher);
    const heard: unknown[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent).detail);
    window.addEventListener(ASK_PREFILL_EVENT, listener);

    try {
      render(createElement(AskItButton, { example: "Email Jane" }));
      click(container.querySelector("button"));
    } finally {
      window.removeEventListener(ASK_PREFILL_EVENT, listener);
    }
    expect(heard).toEqual(["Email Jane"]);
    expect(opened).not.toHaveBeenCalled();
  });

  it("goes to /ask when there is no launcher on the page", () => {
    render(createElement(AskItButton, { example: "Add Jane" }));
    click(container.querySelector("button"));
    expect(push).toHaveBeenCalledWith("/ask");
  });
});

describe("WalkthroughButton", () => {
  it("asks the Help panel for this page's tour", () => {
    const heard = vi.fn();
    window.addEventListener(WALKTHROUGH_EVENT, heard);
    try {
      render(createElement(WalkthroughButton));
      click(container.querySelector("button"));
    } finally {
      window.removeEventListener(WALKTHROUGH_EVENT, heard);
    }
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
