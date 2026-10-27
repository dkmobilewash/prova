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
import type { BidAskAccess } from "@/lib/bid/guide/askAccess";
import { guideStepHref, guideStepLink } from "@/lib/bid/guide/stepHrefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const run = vi.fn();
const refresh = vi.fn();
const confirmAsk = vi.fn();
const cancelAsk = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions/bidGuide", () => ({ runGuideAction: (...args: unknown[]) => run(...args) }));
// The barrel the ask box imports its two Server Actions from. Mocked whole:
// the real one reaches the database client.
vi.mock("@/lib/actions", () => ({
  confirmAskProposal: (...args: unknown[]) => confirmAsk(...args),
  cancelAskProposal: (...args: unknown[]) => cancelAsk(...(args as [])),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/bid/estimates/x/takeoff", useRouter: () => ({ refresh }) }));

import { JobGuideAsk } from "./JobGuideAsk";
import { JobGuideAskBox } from "./JobGuideAskBox";
import { JobGuideRail } from "./JobGuideRail";
import { JobGuideShell } from "./JobGuideShell";

/**
 * THE JOB SCREEN RENDERS ANY GUIDE THE ENGINE CAN HAND IT, AND NONE OF THEM
 * DRAWS A DOOR OUT OF BID OR TWO YELLOW BUTTONS.
 *
 * The ask box at the bottom ASKS now (it was drawn disabled until it was wired
 * to Ask), so its half of this file drives it through a faked `/api/ask`
 * stream: what it sends, what it shows, and that a card's CRM links arrive on
 * screen as plain text.
 *
 * Run over every fixture (one per stage). What this CANNOT see is layout —
 * happy-dom does no layout — which is why the 375/1280 widths were measured in
 * a real Chromium (see the PR notes), not asserted here.
 */

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ON: BidAskAccess = { available: true, canChange: true };
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

  it("the shell carries headline, ask, tabs slot, children and a LIVE ask box", () => {
    const out = html(
      <JobGuideShell guide={guide} tabs={<nav id="tabs-slot" />} askAccess={ON}>
        <div id="kid" />
      </JobGuideShell>,
    );
    expect(out).toContain(guide.headline);
    expect(out).toContain('id="tabs-slot"');
    expect(out).toContain('id="kid"');
    expect(out).toMatch(/<input[^>]*id="guide-ask-box"/);
    expect(out).not.toMatch(/<input[^>]*disabled/);
    expect(out).toContain(`Ask or tell me anything about ${guide.name}`);
    expect(out).not.toContain("coming soon");
    // every href the shell draws, the box included, stays in Bid
    for (const h of hrefs(out)) expect(h.startsWith("/bid"), h).toBe(true);
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

describe("the ask box: what it draws before anyone types", () => {
  const box = (access: BidAskAccess) => html(createElement(JobGuideAskBox, { jobId: "job_r", jobName: "Riverside", access }));

  it("is a live input with a label, a placeholder, and a 44px Send", () => {
    const out = box(ON);
    expect(out).toContain('placeholder="Ask or tell me anything about Riverside"');
    expect(out).toMatch(/<label[^>]*for="guide-ask-box"[^>]*>Ask or tell me anything about Riverside/);
    expect(out).not.toMatch(/<input[^>]*disabled=""/);
    expect(out).toMatch(/<input[^>]*min-h-11/);
    const send = /<button type="submit"[^>]*class="([^"]*)"[^>]*>Send<\/button>/.exec(out);
    expect(send).not.toBeNull();
    // A yellow fill carries dark text (theme-contrast), and a thumb-sized target.
    expect(send![1]).toMatch(/(^|\s)bg-brand(\s|$)/);
    expect(send![1]).toContain("text-neutral-900");
    expect(send![1]).toContain("min-h-11");
    // ENTER SENDS because the input sits in a form whose only submit is Send.
    expect(out).toMatch(/<form[^>]*>[\s\S]*<input[^>]*id="guide-ask-box"[\s\S]*<button type="submit"[\s\S]*<\/form>/);
    expect(out).toContain("Nothing changes until you confirm it");
  });

  it("says why, instead of drawing a dead input, when AI is off for the company", () => {
    const out = box({ available: false, reason: "AI is switched off for your company. The account owner can turn it back on under Settings → Assistant." });
    expect(out).toContain("AI is switched off for your company");
    expect(out).not.toContain("<input");
    expect(out).not.toContain("<button");
    expect(out).toContain('data-guide="ask-off"');
  });

  it("tells someone who may ask but not change the estimate which half they have", () => {
    const out = box({ available: true, canChange: false });
    expect(out).toContain("<input");
    expect(out).toContain("Adding to the estimate needs cost access");
  });

  it("fits a phone: nothing in it has a fixed width, and the input may shrink", () => {
    const out = box(ON);
    expect(out).not.toMatch(/\bw-(?:\d{2,}|\[)/);
    expect(out).toMatch(/<input[^>]*min-w-0[^>]*flex-1|<input[^>]*flex-1[^>]*min-w-0/);
  });
});

describe("the ask box asks Ask about THIS job, and writes nothing on Send", () => {
  const JOB = "cmtx3b4x20007d0pe9ebyh1m4";
  let calls: { url: string; body: Record<string, unknown> }[] = [];
  /** Events for the next request, and a gate the test opens to let the stream finish. */
  let script: unknown[] = [];
  let release: () => void = () => {};

  beforeEach(() => {
    calls = [];
    refresh.mockReset();
    confirmAsk.mockReset();
    cancelAsk.mockClear();
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const lines = script.map((e) => `${JSON.stringify(e)}\n`);
      const gate = new Promise<void>((resolve) => (release = resolve));
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await gate;
          for (const line of lines) controller.enqueue(encoder.encode(line));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
  });

  async function mountBox(access: BidAskAccess = ON) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(JobGuideAskBox, { jobId: JOB, jobName: "Riverside", access })));
    return host;
  }

  async function type(host: HTMLElement, text: string) {
    const input = host.querySelector<HTMLInputElement>("#guide-ask-box")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit(host: HTMLElement) {
    const form = host.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  async function finish() {
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  it("sends the question with the Bid surface and THIS job's path, and shows the pending state until the answer is in", async () => {
    script = [
      { type: "thread", threadId: "t1", title: "x" },
      { type: "tools", names: ["job_overview"], label: "Reading the estimate…" },
      { type: "answering" },
      { type: "text", delta: "The bid so far is " },
      { type: "text", delta: "$58,120." },
      { type: "done", citations: [], links: [], toolsUsed: ["job_overview"] },
    ];
    const host = await mountBox();
    const send = () => [...host.querySelectorAll("button")].find((b) => b.getAttribute("type") === "submit")!;
    expect(send().disabled).toBe(true); // nothing typed
    await type(host, "what's the bid so far?");
    expect(send().disabled).toBe(false);
    await submit(host);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/ask");
    expect(calls[0]!.body).toMatchObject({
      question: "what's the bid so far?",
      surface: "bid",
      pagePath: `/bid/estimates/${JOB}`,
      subject: { type: "Job", id: JOB },
    });
    // In flight: the button says so, with a spinner, and cannot be pressed again.
    expect(send().disabled).toBe(true);
    expect(send().textContent).toContain("Asking…");
    expect(send().querySelector("svg")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("#guide-ask-box")!.value).toBe("");

    await finish();
    expect(host.querySelector('[data-ask="answer"]')?.textContent).toBe("The bid so far is $58,120.");
    expect(send().textContent).toBe("Send");
    expect(confirmAsk).not.toHaveBeenCalled();
  });

  it("a follow-up carries the thread, so the conversation keeps its context", async () => {
    script = [{ type: "thread", threadId: "t9", title: "x" }, { type: "done", citations: [], links: [], toolsUsed: [] }];
    const host = await mountBox();
    await type(host, "first");
    await submit(host);
    await finish();
    await type(host, "and the second?");
    await submit(host);
    await finish();
    expect(calls[1]!.body.threadId).toBe("t9");
  });

  it("an instruction ends in a CARD — nothing is written until Confirm, and its CRM link is plain text", async () => {
    script = [
      {
        type: "proposal",
        proposal: {
          proposalId: "p1",
          command: "add_catalog_line",
          title: "Add the line",
          button: "Add line",
          mode: "DIRECT",
          preview: [
            { label: "Job", value: "Riverside" },
            { label: "Item", value: "Cleanup labor" },
          ],
          warnings: [],
          alsoRequested: [],
          expiresAt: "2026-10-27T12:00:00.000Z",
        },
      },
    ];
    confirmAsk.mockResolvedValue({
      ok: true,
      value: { message: "Added 40 hr of Cleanup labor to Riverside.", created: { label: "Riverside", href: `/jobs/${JOB}` } },
    });
    const host = await mountBox();
    await type(host, "add a line for 40 hours of cleanup");
    await submit(host);
    await finish();

    const card = host.querySelector('[data-ask="proposal"]')!;
    expect(card.textContent).toContain("Add the line");
    expect(card.textContent).toContain("Cleanup labor");
    expect(confirmAsk).not.toHaveBeenCalled(); // Send wrote nothing
    const yes = [...card.querySelectorAll("button")].find((b) => b.textContent === "Add line")!;
    expect(yes.className).toContain("text-neutral-900");
    await act(async () => yes.click());
    await act(async () => new Promise((r) => setTimeout(r, 10)));

    expect(confirmAsk).toHaveBeenCalledWith("p1", []);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-ask="outcome"]')?.textContent).toContain("Added 40 hr of Cleanup labor to Riverside.");
    // The command's "created" link is /jobs/<id> — a CRM door. Not drawn.
    for (const a of host.querySelectorAll("a")) expect(a.getAttribute("href")?.startsWith("/bid"), a.getAttribute("href") ?? "").toBe(true);
  });

  it("Cancel withdraws the card on the server and writes nothing", async () => {
    script = [
      {
        type: "proposal",
        proposal: { proposalId: "p2", command: "add_catalog_line", title: "Add the line", button: "Add line", mode: "DIRECT", preview: [], warnings: [], alsoRequested: [], expiresAt: "2026-10-27T12:00:00.000Z" },
      },
    ];
    const host = await mountBox();
    await type(host, "add a line");
    await submit(host);
    await finish();
    const cancel = [...host.querySelectorAll('[data-ask="proposal"] button')].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
    await act(async () => cancel.click());
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(cancelAsk).toHaveBeenCalledWith("p2");
    expect(confirmAsk).not.toHaveBeenCalled();
    expect(host.querySelector('[data-ask="proposal"]')).toBeNull();
  });

  it("a chip answer goes back as a continuation, still on the Bid surface", async () => {
    script = [
      {
        type: "clarify",
        clarify: {
          command: "add_catalog_line",
          field: "catalogEntryId",
          question: "Which catalog item?",
          options: [
            { value: "c1", label: "Cleanup labor" },
            { value: "c2", label: "Final clean" },
          ],
          partialInput: { item: "cleanup", quantity: "40" },
        },
      },
    ];
    const host = await mountBox();
    await type(host, "add 40 of cleanup");
    await submit(host);
    await finish();
    const chip = [...host.querySelectorAll('[data-ask="clarify"] button')].find((b) => b.textContent?.includes("Final clean")) as HTMLButtonElement;
    await act(async () => chip.click());
    expect(calls[1]!.body).toMatchObject({
      question: "add 40 of cleanup",
      surface: "bid",
      pagePath: `/bid/estimates/${JOB}`,
      continuation: { command: "add_catalog_line", partialInput: { item: "cleanup", quantity: "40" }, answers: { catalogEntryId: "c2" } },
    });
    await finish();
  });

  it("citations that point into the CRM are plain text; a /bid one stays a link", async () => {
    script = [
      { type: "answering" },
      { type: "text", delta: "Two wall types are unpriced." },
      {
        type: "done",
        citations: [
          { label: "Riverside", href: `/jobs/${JOB}` },
          { label: "Estimate", href: `/bid/estimates/${JOB}/estimate` },
        ],
        links: [],
        toolsUsed: ["job_overview"],
      },
    ];
    const host = await mountBox();
    await type(host, "what's left?");
    await submit(host);
    await finish();
    const cited = host.querySelector('[data-ask="citations"]')!;
    expect(cited.textContent).toContain("Riverside");
    expect([...cited.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([`/bid/estimates/${JOB}/estimate`]);
  });

  it("a refusal from the server (the AI switch, a limit) is a sentence under the box", async () => {
    script = [{ type: "error", error: "You've asked a lot in the last hour. Try again in a few minutes." }];
    const host = await mountBox();
    await type(host, "what's the bid?");
    await submit(host);
    await finish();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("You've asked a lot in the last hour. Try again in a few minutes.");
  });

  it("when access is off, there is nothing to type into and nothing is sent", async () => {
    const host = await mountBox({ available: false, reason: "Asking isn't set up on this server yet." });
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Asking isn't set up on this server yet.");
    expect(calls).toHaveLength(0);
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
