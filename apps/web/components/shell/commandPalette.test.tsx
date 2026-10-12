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
    { id: "log-hours", label: "Log hours", hint: "Pick a job", jobTab: "crew#log-time" },
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
    expect(push).toHaveBeenCalledWith("/jobs/j1/crew#log-time");
  });

  // Guidelines review 2026-10-10: results were <div onClick> + router.push,
  // so Cmd/Ctrl-click, middle-click and long-press could not open a new tab.
  it("a result with a destination is a real link, still an option, and still keyboard-driven", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    const first = document.getElementById("palette-opt-0")!;
    expect(first.tagName).toBe("A");
    expect(first.getAttribute("href")).toBe("/jobs/j1");
    expect(first.getAttribute("role")).toBe("option");
    expect(first.getAttribute("tabindex")).toBe("-1");
    expect(input().getAttribute("aria-activedescendant")).toBe("palette-opt-0");
    // "Log hours" goes nowhere until a job is picked: not a link.
    expect(document.getElementById("palette-opt-2")!.tagName).toBe("DIV");
    // A Cmd-click leaves the palette open for the next one.
    act(() => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true, cancelable: true }));
    });
    expect(dialog()).not.toBeNull();
  });

  it("names each group by a real id, and announces counts and misses on every width", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    for (const group of Array.from(dialog()!.querySelectorAll('[role="group"]'))) {
      const id = group.getAttribute("aria-labelledby")!;
      expect(id).not.toMatch(/\s/);
      expect(document.getElementById(id)).not.toBeNull();
    }
    const status = () => dialog()!.querySelector('[role="status"][aria-live="polite"]')!;
    // Not inside the footer that phones hide.
    expect(status().closest(".hidden")).toBeNull();
    type("north");
    await flush();
    expect(status().textContent).toMatch(/^\d+ results?$/);
    fetchMock.mockImplementation(async (url: string) => {
      const q = new URL(url, "http://x").searchParams.get("q");
      return { ok: true, status: 200, json: async () => (q ? { ...BASE, records: [], recentJobs: [], actions: [], navPages: [] } : BASE) };
    });
    type("zzzz");
    await flush();
    expect(status().textContent).toContain("Nothing found");
  });

  it("the close control is a 44px target that says Close on a phone", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    const close = dialog()!.querySelector('button[aria-label="Close search"]')!;
    expect(close.className).toMatch(/\bmin-h-11\b/);
    expect(close.className).toMatch(/\bmin-w-11\b/);
    expect(close.querySelector(".sm\\:hidden")?.textContent).toBe("Close");
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
  // Changed 2026-10-10: the server used to say "Ctrl K" and a Mac swapped it
  // for "⌘K" a frame later — a visible flicker. The server now names no key,
  // so there is nothing to swap; the hint only ever APPEARS.
  it("server markup names no shortcut, so nothing can swap on hydration", () => {
    const html = renderToString(createElement(SearchTrigger, { size: "lg" }));
    expect(html).not.toMatch(/Ctrl\sK/); // \s covers the non-breaking space
    expect(html).not.toContain("⌘K");
    expect(html).toContain("Search a job, or ask");
  });

  it("after mount, names the platform's key — and only one", async () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => r.render(createElement(SearchTrigger, { size: "sm" })));
    expect(host.textContent).toContain("⌘K");
    expect(host.textContent).not.toMatch(/Ctrl\sK/);
    act(() => r.unmount());
    host.remove();
    platform.mockRestore();
  });

  it("off a Mac, the hint is Ctrl and K held together by a non-breaking space", async () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => r.render(createElement(SearchTrigger, { size: "sm" })));
    expect(host.textContent).toContain("Ctrl K");
    act(() => r.unmount());
    host.remove();
    platform.mockRestore();
  });
});

describe("resultCount", () => {
  it("says 1 result, not 1 results", async () => {
    const { resultCount } = await import("./CommandPalette");
    expect(resultCount(1)).toBe("1 result");
    expect(resultCount(0)).toBe("0 results");
    expect(resultCount(7)).toBe("7 results");
  });

  // UX test 2026-10-11 (#23): "Riverside" spun "Searching…" for 60s+.
  it("a search that never answers stops spinning and says so", async () => {
    act(() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } })));
    await flush();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    type("riverside");
    await flush();
    expect(document.querySelector("[data-palette-status]")!.textContent).toBe("Searching…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(document.querySelector("[data-palette-status]")!.textContent).toBe("Search took too long — try again.");
    expect(dialog()!.textContent).not.toContain("Searching…");
  });
});
