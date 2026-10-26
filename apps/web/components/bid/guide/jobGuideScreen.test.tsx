// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUIDE_FIXTURES,
  GUIDE_NO_DRAWINGS,
  GUIDE_RECAP_READY,
  GUIDE_SENT,
  GUIDE_UNPRICED,
} from "@/lib/bid/guide/fixtures";
import { GUIDE_STEP_KEYS, type JobGuide } from "@/lib/bid/guide/types";
import { guideStepHref, guideStepLink } from "@/lib/bid/guide/stepHrefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const run = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/actions/bidGuide", () => ({ runGuideAction: (...args: unknown[]) => run(...args) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/bid/estimates/x/takeoff", useRouter: () => ({ refresh }) }));

import { JobGuideAsk } from "./JobGuideAsk";
import { JobGuideAskBox } from "./JobGuideAskBox";
import { JobGuideRail } from "./JobGuideRail";
import { JobGuideShell } from "./JobGuideShell";

/**
 * THE JOB SCREEN RENDERS ANY GUIDE THE ENGINE CAN HAND IT, AND NONE OF THEM
 * DRAWS A DOOR OUT OF BID OR TWO YELLOW BUTTONS.
 *
 * Run over every fixture (one per stage). What this CANNOT see is layout —
 * happy-dom does no layout — which is why the 375/1280 widths were measured in
 * a real Chromium (see the PR notes), not asserted here.
 */

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);

describe("fixtures", () => {
  it("covers every stage and is not empty", () => {
    expect(GUIDE_FIXTURES.length).toBe(6);
    expect(new Set(GUIDE_FIXTURES.map((g) => g.steps.find((s) => s.status === "current")?.key ?? "none")).size).toBeGreaterThanOrEqual(3);
  });
});

describe.each(GUIDE_FIXTURES.map((g) => [g.jobId, g] as const))("%s", (_id, guide: JobGuide) => {
  const rail = html(createElement(JobGuideRail, { guide }));
  const ask = html(createElement(JobGuideAsk, { guide }));

  it("rail draws all five steps in order with each status", () => {
    const rows = [...rail.matchAll(/data-step="(\w+)" data-status="(\w+)"/g)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual(guide.steps.map((s) => [s.key, s.status]));
    expect(rows.map((r) => r[0])).toEqual([...GUIDE_STEP_KEYS]);
    // one mark per step, and a status in WORDS for each
    expect([...rail.matchAll(/data-step-mark="(done|current|todo)"/g)].length).toBe(5);
    for (const s of guide.steps) expect(rail).toContain(s.label);
    expect([...rail.matchAll(/aria-current="step"/g)].length).toBe(guide.steps.filter((s) => s.status === "current").length);
  });

  it("only done and current steps are links, and todo ones are not", () => {
    for (const step of guide.steps) {
      const link = guideStepLink(guide.jobId, step);
      expect(link === null).toBe(step.status === "todo");
    }
  });

  it("every href on the rail and the ask starts with /bid", () => {
    for (const h of [...hrefs(rail), ...hrefs(ask)]) expect(h.startsWith("/bid")).toBe(true);
  });

  it("the ask has at most one primary button", () => {
    expect([...ask.matchAll(/data-primary="true"/g)].length).toBeLessThanOrEqual(1);
    if (guide.ask?.actions.some((a) => a.primary)) expect([...ask.matchAll(/data-primary="true"/g)].length).toBe(1);
  });

  it("href actions are links and actionId actions are buttons", () => {
    for (const a of guide.ask?.actions ?? []) {
      expect(ask).toContain(a.label);
      expect(a.href ? 1 : 0).toBe(a.actionId ? 0 : 1); // exactly one of the two
      if (a.href) expect(ask).toContain(`href="${a.href}"`);
    }
    if (!guide.ask) expect(ask).toBe("");
  });

  it("the shell carries headline, ask, tabs slot, children and the disabled box", () => {
    const out = html(
      <JobGuideShell guide={guide} tabs={<nav id="tabs-slot" />}>
        <div id="kid" />
      </JobGuideShell>,
    );
    expect(out).toContain(guide.headline);
    expect(out).toContain('id="tabs-slot"');
    expect(out).toContain('id="kid"');
    expect(out).toMatch(/<input[^>]*disabled/);
    expect(out).toContain(`Ask or tell me anything about ${guide.name}`);
    expect(out).toContain("coming soon");
    // every piece of chrome is hidden on paper; the working area is not
    const wrapper = /<div class="([^"]*)"><div id="kid">/.exec(out);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1]).not.toContain("print:hidden");
    for (const chrome of ['data-guide="rail"', 'data-guide="headline"', 'data-guide="ask-box"']) {
      expect(out.slice(Math.max(0, out.indexOf(chrome) - 200), out.indexOf(chrome) + 200)).toContain("print:hidden");
    }
  });
});

describe("step routes", () => {
  it("maps steps to the takeoff, estimate and proposal routes", () => {
    expect(guideStepHref("j", "walls")).toBe("/bid/estimates/j/takeoff");
    expect(guideStepHref("j", "price")).toBe("/bid/estimates/j/estimate");
    expect(guideStepHref("j", "proposal")).toBe("/bid/estimates/j/proposal");
  });
});

describe("bid so far", () => {
  it("shows the figure when there is one and nothing when there is not", () => {
    expect(html(createElement(JobGuideRail, { guide: GUIDE_UNPRICED }))).toContain("$58,120");
    expect(html(createElement(JobGuideRail, { guide: GUIDE_NO_DRAWINGS }))).not.toContain("Bid so far");
  });
});

describe("the disabled box", () => {
  it("is disabled with a placeholder and a note", () => {
    const out = html(createElement(JobGuideAskBox, { jobName: "Riverside" }));
    expect(out).toContain('placeholder="Ask or tell me anything about Riverside"');
    expect(out).toMatch(/<input[^>]*disabled/);
    expect(out).toMatch(/<button[^>]*disabled/);
  });
});

describe("an action button WRITES, so it is two steps", () => {
  beforeEach(() => {
    run.mockReset();
    refresh.mockReset();
  });

  async function mount(guide: JobGuide) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(JobGuideAsk, { guide })));
    return host;
  }
  const buttons = (host: HTMLElement) => [...host.querySelectorAll("button")];
  const byText = (host: HTMLElement, text: string) => buttons(host).find((b) => b.textContent?.includes(text));

  it("the first press arms and calls nothing; Cancel comes first and clears it", async () => {
    const host = await mount(GUIDE_RECAP_READY);
    await act(async () => byText(host, "Put the bid on the lines")!.click());
    expect(run).not.toHaveBeenCalled();
    // the ordinary actions are gone, Cancel is first, the confirm is the only primary
    expect(host.querySelector('[data-guide="actions"]')).toBeNull();
    const armed = buttons(host);
    expect(armed.map((b) => b.textContent)).toEqual(["Cancel", "Yes, do it"]);
    expect(host.querySelectorAll('[data-primary="true"]').length).toBe(1);
    await act(async () => armed[0]!.click());
    expect(host.querySelector('[data-guide="actions"]')).not.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("the second press runs the action with the job, id and arg, then refreshes", async () => {
    run.mockResolvedValue({ ok: true });
    const host = await mount(GUIDE_RECAP_READY);
    await act(async () => byText(host, "Put the bid on the lines")!.click());
    await act(async () => byText(host, "Yes, do it")!.click());
    expect(run).toHaveBeenCalledWith("job_recap", "applyRecap", undefined);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a refusal is shown as a sentence and nothing refreshes", async () => {
    run.mockResolvedValue({ ok: false, error: "Not available yet" });
    const host = await mount(GUIDE_UNPRICED);
    await act(async () => byText(host, "Use the Civic Center price")!.click());
    await act(async () => byText(host, "Yes, do it")!.click());
    expect(run).toHaveBeenCalledWith("job_price", "usePastPrice", "wt_w2");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Not available yet");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a guide with no ask renders nothing", async () => {
    const host = await mount(GUIDE_SENT);
    expect(host.innerHTML).toBe("");
  });
});
