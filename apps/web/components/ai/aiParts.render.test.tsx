// @vitest-environment happy-dom

/**
 * The /ai page's parts, mounted in a real DOM with fixture rows: every run
 * status draws its own pill (PAUSED_CAP says why nothing ran), each section
 * has an honest empty state with a way out, sources link where they point,
 * and a row's Dismiss calls the action it was handed with that row's id.
 *
 * happy-dom does no layout; widths and the phone strip were checked by
 * screenshot in Chromium, not here.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// core.ts pulls in prisma; only the label map is read here.
vi.mock("@/lib/agents/core", () => ({
  agentLabel: (agent: string) =>
    ({ BID_WATCHER: "The bid watcher", BID_RESEARCH: "Bid research", ESTIMATE_CHECK: "The estimate check", RECOMMENDATIONS: "Recommendations" })[agent],
}));
// Its own file; it imports the run-now Server Action.
vi.mock("@/components/RunAgentButton", () => ({
  RunAgentButton: ({ agent, label }: { agent: string; label?: string }) => <button data-agent={agent}>{label}</button>,
}));

const { AiHome, RunningNow, RunStatusPill } = await import("./AiParts");
type Props = Parameters<typeof AiHome>[0];

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const NOW = new Date("2026-10-11T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const ok = async () => ({ ok: true as const });
const actions = () => ({
  dismissRecommendation: vi.fn(ok),
  markRecommendationDone: vi.fn(ok),
  dismissFinding: vi.fn(ok),
});

function fullProps(overrides: Partial<Props> = {}): Props {
  return {
    chat: <div data-chat="">chat</div>,
    recent: <ul data-recent="" />,
    threadOpen: false,
    runs: [
      { id: "r1", agent: "BID_RESEARCH", status: "RUNNING", startedAt: minutesAgo(3), finishedAt: null, summary: null, note: null, bidProjectName: "Civic Center Garage" },
      { id: "r2", agent: "BID_WATCHER", status: "DONE", startedAt: minutesAgo(130), finishedAt: minutesAgo(128), summary: "Checked 14 invitations, 1 new addendum", note: null, bidProjectName: null },
      { id: "r3", agent: "ESTIMATE_CHECK", status: "PAUSED_CAP", startedAt: minutesAgo(300), finishedAt: minutesAgo(300), summary: null, note: "This month's AI spend reached the $150 cap.", bidProjectName: "Oak Park Fire Station 9" },
    ],
    recommendations: [
      {
        id: "rec1",
        title: "Bid Oak Park Fire Station 9",
        reason: "You won 8 of 13 bids with Sundt on fireproofing.",
        confidence: "high",
        href: "/ai/bids/b2",
        sources: [{ label: "Win/loss history", href: "/bids" }, { label: "Sundt prequal page", url: "https://example.com/sundt" }],
      },
    ],
    watching: {
      openBids: 2,
      dueThisWeek: [
        { id: "b1", projectName: "Civic Center Garage", dueDate: new Date("2026-10-13T00:00:00Z"), gcName: "Mortenson" },
        { id: "b2", projectName: "Oak Park Fire Station 9", dueDate: new Date("2026-10-17T00:00:00Z"), gcName: "Sundt" },
      ],
      unreadAddenda: 1,
      lastRunAt: minutesAgo(480),
      nextRunLabel: "Daily at 12:23 UTC",
    },
    findings: [
      {
        id: "f1",
        severity: "flag",
        title: "Addendum 2 changes SFRM thickness",
        body: "13/16 inch on L2-L4 beams; estimate v3 carries 1/2 inch.",
        sources: [{ label: "Addendum 2 · p.4", href: "/bids/b1" }],
        fixHref: "/jobs/j1/estimate",
        bidProjectName: "Civic Center Garage",
      },
    ],
    findingCount: 3,
    actions: actions(),
    now: NOW,
    ...overrides,
  };
}

const EMPTY = { openBids: 0, dueThisWeek: [], unreadAddenda: 0, lastRunAt: null, nextRunLabel: null };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const render = (node: ReactNode) => act(() => root.render(node));
const text = () => container.textContent ?? "";

describe("run status pills", () => {
  it("names every status, and says why a capped run did not run", () => {
    const labels = (["RUNNING", "DONE", "FAILED", "PAUSED_CAP", "SKIPPED"] as const).map((status) => {
      render(<RunStatusPill status={status} />);
      return container.querySelector(`[data-run-status="${status}"]`)?.textContent;
    });
    expect(labels).toEqual(["Running", "Done", "Failed", "Paused: cap reached", "Skipped"]);
  });

  it("spins only while running", () => {
    render(<RunStatusPill status="RUNNING" />);
    expect(container.querySelector("svg")).not.toBeNull();
    render(<RunStatusPill status="PAUSED_CAP" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("Running now", () => {
  it("lists each run with its agent, bid, line and time", () => {
    render(<RunningNow runs={fullProps().runs} now={NOW} />);
    expect(text()).toContain("Bid research · Civic Center Garage");
    expect(text()).toContain("Started 3 minutes ago");
    expect(text()).toContain("Checked 14 invitations, 1 new addendum");
    expect(text()).toContain("Finished 2 hours ago");
    expect(text()).toContain("This month's AI spend reached the $150 cap.");
    expect(container.querySelector('a[href="/ai/activity"]')).not.toBeNull();
  });

  // UX test 2026-10-11 (#33): "Bid research · Pell Riverfront Tower" was plain text.
  it("a run about one bid links the bid's name to its page", () => {
    const [first] = fullProps().runs;
    render(<RunningNow runs={[{ ...first, bidInvitationId: "b9" }]} now={NOW} />);
    expect(container.querySelector('a[href="/ai/bids/b9"]')?.textContent).toBe("Civic Center Garage");
  });

  it("empty: says when agents run and offers Run now for the watcher and recommendations", () => {
    render(<RunningNow runs={[]} now={NOW} />);
    expect(text()).toContain("Nothing running. Agents run on their schedule, when a bid is logged, or when you press Run now.");
    const agents = Array.from(container.querySelectorAll("[data-agent]")).map((b) => b.getAttribute("data-agent"));
    expect(agents).toEqual(["BID_WATCHER", "RECOMMENDATIONS"]);
  });

  // UX review F6: a stopped run is never a dead end.
  it("offers Run again on a failed run, and links a capped or switched-off run to its setting", () => {
    const base = { startedAt: minutesAgo(30), finishedAt: minutesAgo(29), summary: null, bidProjectName: null };
    render(
      <RunningNow
        now={NOW}
        runs={[
          { ...base, id: "f", agent: "BID_RESEARCH", status: "FAILED", note: "Model call timed out after 45 seconds", bidInvitationId: "b9" },
          { ...base, id: "p", agent: "BID_WATCHER", status: "PAUSED_CAP", note: "Paused: cap reached" },
          { ...base, id: "s", agent: "RECOMMENDATIONS", status: "SKIPPED", note: "Recommendations is switched off for this company." },
          { ...base, id: "a", agent: "BID_WATCHER", status: "SKIPPED", note: "AI is switched off for your company. The account owner can turn it back on under Settings → Assistant." },
          { ...base, id: "d", agent: "BID_WATCHER", status: "DONE", note: null },
        ]}
      />,
    );
    const again = Array.from(container.querySelectorAll("[data-agent]"));
    expect(again.map((b) => [b.getAttribute("data-agent"), b.textContent])).toEqual([["BID_RESEARCH", "Run again"]]);
    expect(container.querySelector('a[href="/ai/activity#cap"]')?.textContent).toContain("See the spend cap");
    expect(container.querySelector('a[href="/ai/activity#agent-switches"]')).not.toBeNull();
    expect(container.querySelector('a[href="/settings/assistant#ai-switch"]')).not.toBeNull();
  });
});

describe("the whole page", () => {
  it("mounts the chat and the recent list it was handed", () => {
    render(<AiHome {...fullProps()} />);
    expect(container.querySelector("[data-chat]")).not.toBeNull();
    expect(container.querySelector("[data-recent]")).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("AI");
    expect(container.querySelector('a[href="/ai"]')?.textContent).toContain("New chat");
  });

  it("a fresh page lists recent conversations under the chat; an open one moves them behind Recent", () => {
    render(<AiHome {...fullProps()} />);
    expect(container.querySelector("[data-ai-recent] [data-recent]")).not.toBeNull();
    expect(container.querySelector("details")).toBeNull();
    render(<AiHome {...fullProps({ threadOpen: true })} />);
    expect(container.querySelector("[data-ai-recent]")).toBeNull();
    expect(container.querySelector("details [data-recent]")).not.toBeNull();
  });

  it("puts Watching above Recommendations, so what is due shows without a scroll", () => {
    render(<AiHome {...fullProps()} />);
    const order = Array.from(container.querySelectorAll("[data-tour]")).map((el) => el.getAttribute("data-tour"));
    expect(order.indexOf("ai-watching")).toBeLessThan(order.indexOf("ai-recommendations"));
  });

  it("draws recommendations with confidence, sources, Open, Done and Dismiss", () => {
    render(<AiHome {...fullProps()} />);
    const section = container.querySelector('[aria-labelledby="ai-recommendations"]')!;
    expect(section.textContent).toContain("Bid Oak Park Fire Station 9");
    expect(section.textContent).toContain("High confidence");
    expect(section.querySelector('a[href="/bids"]')?.textContent).toBe("Win/loss history");
    const web = section.querySelector('a[href="https://example.com/sundt"]')!;
    expect(web.getAttribute("target")).toBe("_blank");
    expect(web.getAttribute("rel")).toContain("noopener");
    expect(section.querySelector('a[href="/ai/bids/b2"]')?.textContent).toContain("Open");
  });

  it("Done and Dismiss call the action they were handed, with the row's id, in one tap", async () => {
    const props = fullProps();
    render(<AiHome {...props} />);
    const section = container.querySelector('[aria-labelledby="ai-recommendations"]')!;
    const button = (label: string) => Array.from(section.querySelectorAll("button")).find((b) => b.textContent === label)!;
    await act(async () => button("Done").click());
    expect(props.actions.markRecommendationDone).toHaveBeenCalledWith("rec1");
    await act(async () => button("Dismiss").click());
    expect(props.actions.dismissRecommendation).toHaveBeenCalledWith("rec1");
    expect(props.actions.dismissFinding).not.toHaveBeenCalled();
  });

  it("shows a refusal instead of swallowing it", async () => {
    const props = fullProps();
    props.actions.dismissFinding = vi.fn(async () => ({ ok: false as const, error: "That finding is already gone." }));
    render(<AiHome {...props} />);
    const watching = container.querySelector('[aria-labelledby="ai-watching"]')!;
    const dismiss = Array.from(watching.querySelectorAll("button")).find((b) => b.textContent === "Dismiss")!;
    await act(async () => dismiss.click());
    expect(props.actions.dismissFinding).toHaveBeenCalledWith("f1");
    expect(watching.querySelector('[role="status"]')?.textContent).toBe("That finding is already gone.");
  });

  it("Watching links each due bid to its AI workspace and counts open findings", () => {
    render(<AiHome {...fullProps()} />);
    const watching = container.querySelector('[aria-labelledby="ai-watching"]')!;
    expect(watching.textContent).toContain("2 open bids");
    const due = watching.querySelector('a[href="/ai/bids/b1"]')!;
    expect(due.textContent).toContain("Civic Center Garage · Mortenson");
    // Due in two days is amber; five days out is not.
    expect(due.textContent).toContain("Due Oct 13");
    expect(due.querySelector(".bg-tag-amber")).not.toBeNull();
    expect(watching.querySelector('a[href="/ai/bids/b2"] .bg-tag-amber')).toBeNull();
    expect(watching.textContent).toContain("1 unread addendum");
    expect(watching.textContent).toContain("Last checked 8 hours ago · runs daily at 12:23 UTC");
    expect(watching.textContent).toContain("Flag");
    expect(watching.querySelector('a[href="/jobs/j1/estimate"]')?.textContent).toContain("Fix it");
    expect(watching.textContent).toContain("Findings3");
    expect(watching.querySelector('a[href="/ai/activity"]')?.textContent).toContain("See all activity");
  });

  it("every section's empty state says what fills it, with a way out", () => {
    render(<AiHome {...fullProps({ runs: [], recommendations: [], watching: EMPTY, findings: [], findingCount: 0 })} />);
    expect(container.querySelector('[data-empty="runs"]')).not.toBeNull();
    expect(container.querySelector('[data-empty="recommendations"]')?.textContent).toContain("No recommendations yet.");
    const watching = container.querySelector('[data-empty="watching"]')!;
    expect(watching.textContent).toContain("No open bids to watch.");
    expect(watching.querySelector('a[href="/bids"]')).not.toBeNull();
    expect(container.querySelector('[data-empty="findings"]')?.textContent).toContain("Nothing flagged.");
    // No count badge on zero findings.
    expect(text()).not.toContain("Findings0");
  });

  it("the phone strip counts what is running and recommended, and opens the column", () => {
    render(<AiHome {...fullProps()} />);
    const strip = container.querySelector("button[aria-expanded]")!;
    expect(strip.textContent).toContain("1 running");
    expect(strip.textContent).toContain("1 recommendation");
    const panel = container.querySelector(`#${CSS.escape(strip.getAttribute("aria-controls")!)}`)!;
    expect(panel.className).toContain("hidden lg:block");
    act(() => (strip as HTMLButtonElement).click());
    expect(strip.getAttribute("aria-expanded")).toBe("true");
    expect(panel.className).not.toContain("hidden");
  });
});
