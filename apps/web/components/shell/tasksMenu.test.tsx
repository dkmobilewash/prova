// @vitest-environment happy-dom

/**
 * The top bar's Tasks item (2026-10-11), mounted: what the button says, the
 * list it opens, how it closes, that it is drawn only when the layout hands
 * it a list (the MANAGE_ESTIMATING gate), and that it refreshes only while
 * there is a reason to. Positions and widths are measured in Chromium, not
 * here — happy-dom does no layout.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskList, TaskRow } from "@/lib/agents/tasks";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut: vi.fn(), openUserProfile: vi.fn() }) }));
vi.mock("@/components/AskLauncher", () => ({ AskLauncher: () => null }));
vi.mock("@/components/HelpButton", () => ({ HelpButton: () => null }));
// Its own file; it imports the run-now Server Action.
vi.mock("@/components/RunAgentButton", () => ({
  RunAgentButton: ({ agent, label }: { agent: string; label?: string }) => <button data-agent={agent}>{label}</button>,
}));

const { TopBar } = await import("@/components/shell/TopBar");
const { TASKS_REFRESH_MS } = await import("@/components/shell/TasksMenu");
const { RunningCard } = await import("@/components/home/HomeParts");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const NOW = new Date("2026-10-11T15:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();
const row = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id,
  agent: "The bid watcher",
  subject: null,
  detail: null,
  status: "DONE",
  startedAt: iso(60),
  finishedAt: iso(59),
  href: "/ai/activity",
  kind: "BID_WATCHER",
  bidInvitationId: null,
  ...over,
});

const BUSY: TaskList = {
  running: [
    row("r1", { agent: "Bid research", subject: "Northgate", detail: "Reading Turner's history", status: "RUNNING", startedAt: iso(2), finishedAt: null, href: "/ai/bids/b1" }),
    row("r2", { agent: "The estimate check", status: "RUNNING", startedAt: iso(5), finishedAt: null, href: "/ai/bids/b2" }),
  ],
  recent: [
    row("f1", { status: "FAILED", detail: "Model call timed out after 45 seconds", agent: "Recommendations" }),
    row("f2", { status: "PAUSED_CAP", detail: "Paused: October cap reached" }),
  ],
};
const QUIET: TaskList = { running: [], recent: [row("d1")] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(tasks: TaskList | null) {
  act(() =>
    root.render(
      <TopBar
        companyName="Acme"
        userName="Maria"
        userEmail={null}
        alertCount={0}
        principal={{ role: "OWNER", jobFunction: null }}
        helpChannel={{ kind: "none" } as never}
        stages={[]}
        tasks={tasks}
      />,
    ),
  );
}
const button = () => host.querySelector<HTMLButtonElement>("[data-tasks-button]");
const panel = () => host.querySelector("#tasks-panel");

describe("the Tasks item", () => {
  it("is not drawn when the layout hands it no list (no MANAGE_ESTIMATING)", () => {
    mount(null);
    expect(button()).toBeNull();
  });

  it("says how many are running, with a spinner, and a quiet 'AI tasks' otherwise — never a bare 'Tasks', which read as a to-do list", () => {
    mount(BUSY);
    expect(button()!.textContent).toBe("2 running");
    expect(button()!.getAttribute("aria-label")).toBe("AI tasks, 2 running");
    expect(button()!.querySelector("svg")).not.toBeNull();
    mount(QUIET);
    expect(button()!.textContent).toBe("AI tasks");
    expect(button()!.querySelector("svg")).toBeNull();
  });

  it("opens a list of running and finished runs, each linked, and the two ways out", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mount(BUSY);
    expect(panel()).toBeNull();
    act(() => button()!.click());
    expect(button()!.getAttribute("aria-expanded")).toBe("true");
    const text = panel()!.textContent!;
    expect(text).toContain("Bid research · Northgate");
    expect(text).toContain("Reading Turner's history");
    expect(text).toContain("Model call timed out after 45 seconds");
    expect(text).toContain("Paused: cap reached");
    const hrefs = [...panel()!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/ai/bids/b1", "/ai/bids/b2", "/ai/activity", "/ai/activity", "/ai/activity?tab=settings#cap", "/ai", "/ai/activity"]);
    // The failed run can be run again from right here (UX review F6).
    expect(panel()!.querySelector('[data-agent="BID_WATCHER"]')?.textContent).toBe("Run again");
    // Focus moves into the list, like the avatar menu.
    expect(panel()!.contains(document.activeElement)).toBe(true);
  });

  it("Esc closes it and gives focus back to the button", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mount(BUSY);
    act(() => button()!.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("closes the avatar menu when it opens, and the other way round", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mount(BUSY);
    const avatar = host.querySelector<HTMLButtonElement>('button[aria-controls="avatar-menu"]')!;
    act(() => avatar.click());
    expect(host.querySelector("#avatar-menu")).not.toBeNull();
    act(() => button()!.click());
    expect(host.querySelector("#avatar-menu")).toBeNull();
    expect(panel()).not.toBeNull();
    act(() => avatar.click());
    expect(panel()).toBeNull();
    expect(host.querySelector("#avatar-menu")).not.toBeNull();
  });

  it("refreshes every 30s while a run is going, not while the tab is hidden, and never when quiet and closed", async () => {
    vi.useFakeTimers();
    const fresh: TaskList = { running: [], recent: [row("done-now")] };
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; json: () => Promise<TaskList> }>>(async () => ({ ok: true, json: async () => fresh }));
    vi.stubGlobal("fetch", fetchMock);

    mount(QUIET);
    await act(async () => vi.advanceTimersByTime(TASKS_REFRESH_MS * 3));
    expect(fetchMock).not.toHaveBeenCalled();

    mount(BUSY);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => vi.advanceTimersByTime(TASKS_REFRESH_MS));
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await act(async () => vi.advanceTimersByTime(TASKS_REFRESH_MS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/agents/tasks");
    // The answer says nothing is running any more: the spinner stops, and so
    // does the polling.
    expect(button()!.textContent).toBe("AI tasks");
    await act(async () => vi.advanceTimersByTime(TASKS_REFRESH_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the home page's Running now card", () => {
  it("is not drawn before any agent has run", () => {
    expect(renderToStaticMarkup(<RunningCard tasks={{ running: [], recent: [] }} now={NOW} />)).toBe("");
  });

  it("shows what is running and the latest finished, with when and status never cut", () => {
    const html = renderToStaticMarkup(<RunningCard tasks={BUSY} now={NOW} />);
    expect(html).toContain("2 running");
    expect(html).toContain("started 2 minutes ago");
    expect(html).toContain('data-run-status="FAILED"');
    expect(html).toContain('href="/ai"');
  });

  it("shows the whole failure reason, never cut to one line, and a way out of it", () => {
    const html = renderToStaticMarkup(<RunningCard tasks={BUSY} now={NOW} />);
    expect(html).toContain("Model call timed out after 45 seconds");
    expect(html).not.toContain("truncate");
    expect(html).toContain(">Run again<");
    expect(html).toContain('href="/ai/activity?tab=settings#cap"');
  });
});
