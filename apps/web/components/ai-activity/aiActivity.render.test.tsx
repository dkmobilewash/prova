// @vitest-environment happy-dom

/**
 * /ai/activity's two halves, mounted: the timeline (merge, day grouping in
 * the reader's zone, filters, empty state) and the settings form (owner vs
 * not, and refusals that stop a bad save before the action is called).
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
const restore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/agentSettings", () => ({ saveAgentSettings: save }));
vi.mock("@/lib/actions/agentFindings", () => ({ restoreFinding: restore }));
vi.mock("@/lib/agents/core", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ActivityTimeline, agentFilterFrom } from "@/components/ai-activity/ActivityTimeline";
import { AgentSettingsForm } from "@/components/ai-activity/AgentSettingsForm";
import { readSettingsForm } from "@/components/ai-activity/settingsForm";
import { groupByDay, groupConsecutive, mergeActivity } from "@/components/ai-activity/activity";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  save.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const mount = (node: ReactNode) => act(() => root.render(node));
const text = () => host.textContent ?? "";

const ZONE = "America/Los_Angeles";

describe("the timeline", () => {
  const items = mergeActivity(
    [
      { id: "1", at: new Date("2026-10-14T15:31:00Z"), kind: "finding", agent: "ESTIMATE_CHECK", title: "Flagged 3 issues", detail: null, href: "/ai/bids/b1?tab=estimate", severity: "flag" },
      // 03:00 UTC on the 14th is still the 13th in Los Angeles.
      { id: "2", at: new Date("2026-10-14T03:00:00Z"), kind: "run", agent: "BID_WATCHER", title: "Checked 13 invitations", detail: "Nothing due.", href: null },
    ],
    [{ id: "9", at: new Date("2026-10-14T14:00:00Z"), kind: "outcome", title: "Westgate Library — lost", detail: null, href: "/ai/bids/b2?tab=decision" }],
  );

  it("merges both feeds newest first and groups by the READER'S day", () => {
    expect(items.map((i) => i.title)).toEqual(["Flagged 3 issues", "Westgate Library — lost", "Checked 13 invitations"]);
    expect(items[1].agent).toBe("RECOMMENDATIONS");
    const days = groupByDay(items, ZONE, "2026-10-14");
    expect(days.map((d) => [d.label, d.items.length])).toEqual([
      ["Today · Wed, Oct 14", 2],
      ["Yesterday · Tue, Oct 13", 1],
    ]);
  });

  it("renders times in the reader's zone and links what has a page", () => {
    mount(<ActivityTimeline days={groupByDay(items, ZONE, "2026-10-14")} agent={null} zone={ZONE} />);
    expect(text()).toContain("8:31 AM");
    expect(text()).toContain("8:00 PM");
    expect([...host.querySelectorAll("ol a")].map((a) => a.getAttribute("href"))).toEqual(["/ai/bids/b1?tab=estimate", "/ai/bids/b2?tab=decision"]);
  });

  it("offers Restore on a dismissed finding, and only there", async () => {
    restore.mockResolvedValue({ ok: true });
    const withDismissed = mergeActivity(
      [
        { id: "f1", at: new Date("2026-10-14T15:31:00Z"), kind: "finding", agent: "BID_WATCHER", title: "Due in 2 days", detail: null, href: null, severity: "warn" },
        { id: "f2", at: new Date("2026-10-14T15:30:00Z"), kind: "finding", agent: "BID_WATCHER", title: "Addendum not read", detail: null, href: null, severity: "warn" },
      ],
      [],
      new Set(["f1"]),
    );
    mount(<ActivityTimeline days={groupByDay(withDismissed, ZONE, "2026-10-14")} agent={null} zone={ZONE} />);
    const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Restore");
    expect(buttons).toHaveLength(1);
    expect(text()).toContain("Dismissed");
    await act(async () => buttons[0].click());
    expect(restore).toHaveBeenCalledWith("f1");
  });

  it("tells a Not right finding from a plain dismissal", () => {
    const rows = mergeActivity(
      [
        { id: "f1", at: new Date("2026-10-14T15:31:00Z"), kind: "finding", agent: "BID_RESEARCH", title: "What the web says", detail: null, href: null },
        { id: "f2", at: new Date("2026-10-14T15:30:00Z"), kind: "finding", agent: "BID_WATCHER", title: "Due in 2 days", detail: null, href: null },
      ],
      [],
      new Set(["f1", "f2"]),
      new Set(["f1"]),
    );
    mount(<ActivityTimeline days={groupByDay(rows, ZONE, "2026-10-14")} agent={null} zone={ZONE} />);
    const tags = [...host.querySelectorAll("ol > li")].map((li) => li.textContent ?? "");
    expect(tags[0]).toContain("Marked not right");
    expect(tags[1]).toContain("Dismissed");
    expect(tags[1]).not.toContain("not right");
  });

  it("filters by known agents only, and marks the open filter", () => {
    expect(agentFilterFrom("BID_WATCHER")).toBe("BID_WATCHER");
    expect(agentFilterFrom("DROP TABLE")).toBeNull();
    mount(<ActivityTimeline days={[]} agent="BID_WATCHER" zone={ZONE} />);
    expect(host.querySelector('a[aria-current="page"]')?.textContent).toBe("Bid watcher");
    expect(host.querySelector('[data-empty="activity"]')?.textContent).toContain("Nothing from bid watcher yet.");
  });

  it("says nothing has happened yet, with a way out", () => {
    mount(<ActivityTimeline days={[]} agent={null} zone={ZONE} />);
    expect(host.querySelector('[data-empty="activity"] a')?.getAttribute("href")).toBe("/bids");
  });
});

const settings = { watcherEnabled: true, researchOnNewBid: false, checkerBeforeSend: true, recommendationsEnabled: true, dueSoonDays: 5, monthlySpendCapUsd: 25, notifyUserIds: ["u2"] };
const people = [
  { id: "u1", name: "Maria Reyes", email: "m@x.co", role: "OWNER" },
  { id: "u2", name: "Jon Pike", email: "j@x.co", role: "ESTIMATOR" },
];
const form = (isOwner: boolean) => (
  <AgentSettingsForm settings={settings} spend={{ usd: 3.2, capUsd: 25, overCap: false }} people={people} schedule="Every morning at 7:00" isOwner={isOwner} />
);

describe("the settings form", () => {
  it("lets the owner change and save", () => {
    mount(form(true));
    expect(host.querySelector("fieldset")!.disabled).toBe(false);
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe("Save settings");
    expect(host.querySelector("[data-spend]")?.textContent).toBe("$3.20 of $25.00 this month");
    expect(text()).toContain("Every morning at 7:00");
    expect(host.querySelector<HTMLInputElement>('input[value="u2"]')!.checked).toBe(true);
  });

  it("shows everyone else the same values, read-only, and says who can change them", () => {
    mount(form(false));
    expect(host.querySelector("[data-read-only]")?.textContent).toBe("Only the account owner can change these.");
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[name="researchOnNewBid"]')!.checked).toBe(false);
  });

  it("refuses a due-soon window outside 1 to 30 days without calling the action", () => {
    mount(form(true));
    host.querySelector<HTMLInputElement>('[name="dueSoonDays"]')!.value = "31";
    act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.querySelector('[name="dueSoonDays"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(save).not.toHaveBeenCalled();
  });

  it("reads a blank cap as no cap and sends every field", () => {
    const fd = new FormData();
    fd.set("watcherEnabled", "on");
    fd.set("dueSoonDays", "7");
    fd.set("monthlySpendCapUsd", "");
    fd.append("notifyUserIds", "u1");
    expect(readSettingsForm(fd)).toEqual({
      ok: true,
      input: { watcherEnabled: true, researchOnNewBid: false, checkerBeforeSend: false, recommendationsEnabled: false, dueSoonDays: 7, monthlySpendCapUsd: null, notifyUserIds: ["u1"] },
    });
    fd.set("monthlySpendCapUsd", "1,500");
    expect(readSettingsForm(fd)).toMatchObject({ ok: true, input: { monthlySpendCapUsd: 1500 } });
  });

  it("renders the action's refusal", async () => {
    save.mockResolvedValue({ ok: false, error: "Only the account owner can change agent settings." });
    mount(form(true));
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(save).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Only the account owner can change agent settings.");
  });
});

describe("declutter (density audit #18)", () => {
  const inv = (id: string, min: number) => ({
    id, at: new Date(`2026-10-14T21:${String(min).padStart(2, "0")}:00Z`), kind: "finding", agent: "BID_WATCHER",
    title: `New invitation: Job ${id}`, detail: null, href: `/ai/bids/${id}`, severity: "info" as const,
  });

  it("folds consecutive same-kind lines into one row that opens to every line", () => {
    const rows = mergeActivity(
      [inv("a", 9), inv("b", 8), inv("c", 7), { id: "r", at: new Date("2026-10-14T21:06:00Z"), kind: "run", agent: "BID_WATCHER", title: "Checked 3 invitations", detail: null, href: null }],
      [],
    );
    expect(groupConsecutive(rows).map((e) => ("items" in e ? e.label : e.title))).toEqual(["New invitation × 3", "Checked 3 invitations"]);
    mount(<ActivityTimeline days={groupByDay(rows, ZONE, "2026-10-14")} agent={null} zone={ZONE} />);
    const group = host.querySelector("[data-activity-group] details");
    expect(group?.querySelector("summary")?.textContent).toContain("New invitation × 3");
    expect(group?.hasAttribute("open")).toBe(false);
    expect([...(group?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(["/ai/bids/a", "/ai/bids/b", "/ai/bids/c"]);
  });

  it("never folds a dismissed finding (it carries Restore)", () => {
    const rows = mergeActivity([inv("a", 9), inv("b", 8)], [], new Set(["a"]));
    expect(groupConsecutive(rows).every((e) => !("items" in e))).toBe(true);
  });

  it("puts settings on a ?tab=settings tab and caps the timeline at 50 with See all", () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/ai/activity/page.tsx"), "utf8");
    expect(page).toContain('{ href: "/ai/activity?tab=settings", label: "Settings" }');
    expect(page.indexOf("<AgentSettingsForm")).toBeLessThan(page.indexOf("<ActivityTimeline"));
    expect(page).toMatch(/onSettings \? \(/);
    expect(page).toContain("const TIMELINE_SHOWN = 50;");
    expect(page).toContain("groupByDay(filtered.slice(0, take)");
    expect(page).toContain("<SeeAll");
  });
});
