// @vitest-environment happy-dom

/**
 * The bid workspace and the win/loss form, mounted in a real DOM: the four
 * step tabs, the empty states, cited sources, and the form's refusals —
 * which must stop a bad submit BEFORE the action is called.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/bidOutcomes", () => ({ recordBidOutcome: record }));
vi.mock("@/lib/actions/agents", () => ({ runAgentNow: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; scroll?: boolean }) => {
    delete rest.scroll;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { BidWorkspace, bidTabFrom, type BidTab } from "@/components/ai-bid/BidWorkspace";
import type { BidWorkspaceData, FindingRow } from "@/components/ai-bid/types";
import { BidOutcomeForm } from "@/components/BidOutcomeForm";
import { readOutcomeForm } from "@/components/ai-bid/outcome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  record.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const finding = (over: Partial<FindingRow>): FindingRow => ({
  id: "f",
  agent: "ESTIMATE_CHECK",
  kind: "missing_scope",
  severity: "flag",
  title: "Missing scope: firestopping at deck",
  body: "Addendum 2 puts the joint on the framing sub.",
  sources: [{ label: "Addendum 2", href: "/bids/a2" }],
  fixHref: "/estimating/e1",
  bidInvitationId: "bid1",
  bidProjectName: "Civic Center Garage",
  createdAt: new Date("2026-10-14T15:00:00Z"),
  dismissedAt: null,
  runId: "run",
  ...over,
});

const data = (over: Partial<BidWorkspaceData> = {}): BidWorkspaceData => ({
  bid: { id: "bid1", projectName: "Civic Center Garage", gcName: "Mortenson", contactId: "c1", dueDate: new Date("2026-10-20T00:00:00Z"), status: "SUBMITTED", bidAmount: 684000, tradeScope: "FIREPROOFING" },
  research: [],
  estimateCheck: [],
  addenda: [],
  decision: { recommendation: null, outcome: null },
  lastRuns: [],
  subject: { type: "BidInvitation", id: "bid1" },
  ...over,
});

function mount(node: ReactNode) {
  act(() => root.render(node));
}
const view = (d: BidWorkspaceData, tab: BidTab) => <BidWorkspace data={d} tab={tab} zone="America/Los_Angeles" ask={<div data-ask />} />;
const text = () => host.textContent ?? "";

describe("the step tabs", () => {
  it("are four links to ?tab=, with the open one marked current", () => {
    mount(view(data(), "addenda"));
    const tabs = [...host.querySelectorAll('nav[aria-label="Bid steps"] a')];
    expect(tabs.map((a) => a.getAttribute("href"))).toEqual(["?tab=research", "?tab=estimate", "?tab=addenda", "?tab=decision"]);
    expect(tabs.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "page", null]);
  });

  it("falls back to Research for a missing or unknown ?tab=", () => {
    expect(bidTabFrom(undefined)).toBe("research");
    expect(bidTabFrom("nonsense")).toBe("research");
    expect(bidTabFrom("decision")).toBe("decision");
  });

  it("counts estimate flags and UNREAD addenda only", () => {
    mount(
      view(
        data({
          estimateCheck: [finding({ id: "1" }), finding({ id: "2" })],
          addenda: [
            { id: "a1", reference: "Addendum 1", issuedOn: null, read: true, openDecisions: 0, href: "/a1" },
            { id: "a2", reference: "Addendum 2", issuedOn: null, read: false, openDecisions: 2, href: "/a2" },
          ],
        }),
        "addenda",
      ),
    );
    const tabs = [...host.querySelectorAll('nav[aria-label="Bid steps"] a')].map((a) => a.textContent);
    expect(tabs[1]).toContain("2");
    expect(tabs[2]).toBe("Addenda1");
    expect(text()).toContain("Not read");
    expect(text()).toContain("2 open decisions");
  });
});

describe("Dismiss and Not right on a finding", () => {
  it("both sit on each finding and call their own action with its id", async () => {
    const dismiss = vi.fn(async () => ({ ok: true as const }));
    const wrong = vi.fn(async () => ({ ok: true as const }));
    mount(
      <BidWorkspace
        data={data({ estimateCheck: [finding({ id: "f9" })] })}
        tab="estimate"
        zone="America/Los_Angeles"
        ask={null}
        findingActions={{ dismiss, wrong }}
      />,
    );
    const row = host.querySelector('[data-finding="f9"]')!;
    const button = (label: string) => [...row.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("Not right").click());
    expect(wrong).toHaveBeenCalledWith("f9");
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => button("Dismiss").click());
    expect(dismiss).toHaveBeenCalledWith("f9");
  });
});

describe("research", () => {
  it("says it has not run, with a way to run it", () => {
    mount(view(data(), "research"));
    expect(host.querySelector('[data-empty="research"]')?.textContent).toContain("Not researched yet");
    expect(host.querySelector('[data-agent="BID_RESEARCH"] button')?.textContent).toBe("Research this bid");
  });

  it("links every source — a record in the app, a web page in a new tab", () => {
    mount(
      view(
        data({
          research: [finding({ id: "r", agent: "BID_RESEARCH", sources: [{ label: "11 bids", href: "/bids" }, { label: "City notice", url: "https://example.com/n" }] })],
          lastRuns: [{ agent: "BID_RESEARCH", finishedAt: new Date("2026-10-14T15:01:00Z"), status: "DONE" }],
        }),
        "research",
      ),
    );
    const links = [...host.querySelectorAll('ul[aria-label="Sources"] a')];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/bids", "https://example.com/n"]);
    expect(links[1].getAttribute("target")).toBe("_blank");
    expect(text()).toContain("Last researched Oct 14, 8:01 AM");
    expect(host.querySelector('[data-agent="BID_RESEARCH"] button')?.textContent).toBe("Research again");
  });
});

describe("estimate check", () => {
  it("groups flags by kind and gives each a fix link", () => {
    mount(view(data({ estimateCheck: [finding({ id: "1" }), finding({ id: "2", kind: "price_vs_history", fixHref: "/estimating/e2" }), finding({ id: "3", kind: "price_vs_history" })] }), "estimate"));
    const groups = [...host.querySelectorAll("section[aria-label] h3.uppercase")].map((h) => h.textContent);
    expect(groups).toEqual(["Missing scope · 1", "Price vs history · 2"]);
    expect([...host.querySelectorAll("a")].filter((a) => a.textContent === "Fix this →")).toHaveLength(3);
  });

  it("is honest when it has never run", () => {
    mount(view(data(), "estimate"));
    expect(host.querySelector('[data-empty="estimate"]')?.textContent).toContain("Not checked yet");
  });
});

describe("decision", () => {
  it("labels the recommendation as advice and mounts the Ask slot", () => {
    mount(
      view(
        data({
          decision: {
            recommendation: { id: "x", kind: "bid_or_pass", subjectType: "BidInvitation", subjectId: "bid1", title: "Bid it", reason: "In line with history.", confidence: "medium", score: 60, href: null, sources: [{ label: "11 bids", href: "/bids" }], status: "open", updatedAt: new Date("2026-10-14T15:00:00Z") },
            outcome: null,
          },
        }),
        "decision",
      ),
    );
    expect(text()).toContain("Advice — you decide");
    expect(text()).toContain("Medium");
    expect(host.querySelector("[data-ask]")).not.toBeNull();
    expect(host.querySelector("[data-bid-outcome-form]")).not.toBeNull();
  });

  it("shows a recorded outcome instead of the form", () => {
    mount(view(data({ decision: { recommendation: null, outcome: { result: "LOST", reason: "PRICE", winningPrice: 650000, winnerName: "Acme", note: null, decidedOn: new Date("2026-10-20T00:00:00Z") } } }), "decision"));
    expect(host.querySelector("[data-bid-outcome-form]")).toBeNull();
    expect(host.querySelector("[data-outcome]")?.textContent).toContain("LostMain reasonPrice");
    expect(text()).toContain("$650,000");
  });
});

describe("the win/loss form", () => {
  const submit = () => act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const set = (name: string, value: string) => {
    const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
    el.value = value;
  };

  it("refuses an empty submit with a sentence per field, and never calls the action", () => {
    mount(<BidOutcomeForm bidInvitationId="bid1" />);
    submit();
    expect(text()).toContain("Pick won or lost.");
    expect(text()).toContain("Pick the main reason.");
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a price it cannot read", () => {
    mount(<BidOutcomeForm bidInvitationId="bid1" defaultResult="LOST" />);
    set("reason", "PRICE");
    set("winningPrice", "about 700k");
    submit();
    expect(host.querySelector('[data-field="winningPrice"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(record).not.toHaveBeenCalled();
  });

  it("sends a typed price with a comma as a number, blanks as absent", () => {
    const fd = new FormData();
    fd.set("bidInvitationId", "bid1");
    fd.set("result", "LOST");
    fd.set("reason", "PRICE");
    fd.set("winningPrice", "712,500");
    fd.set("winnerName", "  ");
    const read = readOutcomeForm(fd);
    expect(read).toEqual({ ok: true, input: { bidInvitationId: "bid1", result: "LOST", reason: "PRICE", winningPrice: 712500, winnerName: undefined, note: undefined, decidedOn: undefined } });
  });

  it("renders the action's refusal as a sentence", async () => {
    record.mockResolvedValue({ ok: false, error: "This bid already has an outcome." });
    mount(<BidOutcomeForm bidInvitationId="bid1" defaultResult="WON" />);
    set("reason", "RELATIONSHIP");
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ bidInvitationId: "bid1", result: "WON", reason: "RELATIONSHIP" }));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This bid already has an outcome.");
  });

  it("on the bids list, waits behind Record why and fills today once opened", () => {
    mount(<BidOutcomeForm bidInvitationId="bid1" defaultResult="LOST" collapsed />);
    expect(host.querySelector("form")).toBeNull();
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('[name="decidedOn"]')!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(host.querySelector<HTMLInputElement>('input[value="LOST"]')!.checked).toBe(true);
  });
});
