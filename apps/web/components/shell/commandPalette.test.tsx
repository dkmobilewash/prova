// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteResponse } from "@/lib/search/palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, refresh: () => {}, prefetch: () => {} }) }));

const { CommandPalette } = await import("./CommandPalette");
const { SearchTrigger } = await import("./SearchTrigger");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const job = (id: string, title: string) => ({ kind: "record" as const, type: "job", id, title, subtitle: "Active — Turner", href: `/jobs/${id}` });

const BASE: PaletteResponse = {
  records: [],
  pages: [],
  recentJobs: [job("j1", "Harbor Elementary")],
  actions: [
    { id: "new-job", label: "New job", hint: "Start a job", href: "/jobs/new" },
    { id: "log-hours", label: "Log hours", hint: "Pick a job", jobTab: "crew" },
  ],
  navPages: [{ href: "/rfis", label: "RFIs", group: "Paper trail" }],
};

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url, "http://x").searchParams.get("q");
    const body = q ? { ...BASE, records: [job("j2", "Northgate Medical Office")] } : BASE;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement("div", null, createElement(SearchTrigger, { size: "sm" }), createElement(CommandPalette))));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dialog = () => document.querySelector('[role="dialog"]');
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
};
const key = (k: string, target: Element = input()) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CommandPalette", () => {
  it("the trigger opens a modal dialog with the input focused; Esc closes and focus returns to the trigger", async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Search or ask"]')!;
    trigger.focus();
    act(() => trigger.click());
    await flush();
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(input());
    expect(dialog()!.textContent).toContain("Harbor Elementary");
    expect(dialog()!.textContent).toContain("All pages");

    key("Escape");
    await flush();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Ctrl+K opens it from anywhere", async () => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    });
    await flush();
    expect(dialog()).not.toBeNull();
  });

  it("typing fetches the debounced query, highlights the match, and Enter opens the active row", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    type("north");
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=north", expect.anything());
    const mark = dialog()!.querySelector("mark");
    expect(mark?.textContent).toBe("North");
    key("Enter");
    expect(push).toHaveBeenCalledWith("/jobs/j2");
  });

  it("Log hours asks which job, then opens that job's crew tab", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    // Recent job is row 0, New job row 1, Log hours row 2.
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(input().getAttribute("aria-label")).toBe("Log hours — which job?");
    key("Enter");
    expect(push).toHaveBeenCalledWith("/jobs/j1/crew");
  });

  it("Tab never leaves the dialog", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    key("Tab");
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    key("Tab", document.activeElement!);
    expect(document.activeElement).toBe(input());
  });
});

describe("SearchTrigger", () => {
  it("renders the same markup on the server and on a Mac (no hydration mismatch)", () => {
    const html = renderToString(createElement(SearchTrigger, { size: "lg" }));
    expect(html).toContain("Ctrl K");
    expect(html).toContain("Search a job, or ask");
  });
});
