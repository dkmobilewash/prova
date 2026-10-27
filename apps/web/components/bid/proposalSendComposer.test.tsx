// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "SEND THE PROPOSAL TO <GC>" IS ON THE SCREEN, SENDS NOTHING ON ITS OWN, AND
 * NEEDS TWO PRESSES.
 *
 * The action's guards are proven in `lib/actions/bidProposalSend.test.ts`; this
 * proves a person can reach them and that the first press only arms. happy-dom
 * does no layout, so WHERE Cancel sits is asserted as DOM order (first), not as
 * pixels — the click-list covers the pixels.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const sendBidProposal = vi.fn();
vi.mock("@/lib/actions", () => ({ sendBidProposal: (...a: unknown[]) => sendBidProposal(...a) }));

const { ProposalSendComposer } = await import("./ProposalSendComposer");

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sendBidProposal.mockReset();
  sendBidProposal.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const PROPS = {
  jobId: "job_1",
  invitationId: "inv_1",
  mode: "lump",
  priceCents: 360_000,
  totalLabel: "$3,600.00",
  gcName: "Turner Construction",
  recipients: [
    { address: "dana@turner.com", name: "Dana Reyes" },
    { address: "bids@turner.com", name: "Turner Construction" },
  ],
  subject: "Proposal — Riverside — Cyrus Drywall",
  coverNote: "Hello Turner Construction,",
  documentText: "PROPOSAL — Riverside\nLump sum for the work described in this proposal: $3,600.00",
  documentFingerprint: "f".repeat(64),
  blocker: null as string | null,
  history: [] as { id: string; when: string; toAddress: string; reached: boolean; detail: string | null }[],
};

function paint(over: Partial<typeof PROPS> = {}) {
  act(() => root.render(createElement(ProposalSendComposer, { ...PROPS, ...over })));
}

const q = <T extends Element>(selector: string) => host.querySelector<T>(selector);

async function click(element: Element | null) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

describe("the composer", () => {
  it("is prefilled from the rows and says plainly what is sent", () => {
    paint();
    expect(host.textContent).toContain("Send the proposal to Turner Construction");
    expect(host.textContent).toContain("No PDF is attached");
    const to = q<HTMLSelectElement>('select[name="toAddress"]')!;
    expect([...to.options].map((option) => option.value)).toEqual(["dana@turner.com", "bids@turner.com"]);
    expect(q<HTMLInputElement>('input[name="subject"]')!.value).toBe(PROPS.subject);
    expect(q<HTMLTextAreaElement>('textarea[name="body"]')!.value).toBe(PROPS.coverNote);
    expect(q('[data-proposal="send-document"]')!.textContent).toBe(PROPS.documentText);
    expect(q<HTMLInputElement>('input[name="priceCents"]')!.value).toBe("360000");
  });

  it("the first press only arms: nothing is sent and the confirm names the address and the price", async () => {
    paint();
    expect(q('input[name="confirmSend"]')).toBeNull();
    await click(q('[data-proposal="send-arm"]'));
    expect(sendBidProposal).not.toHaveBeenCalled();
    expect(q('[data-proposal="send-arm"]')).toBeNull();
    expect(q('[data-proposal="send-confirm"]')!.textContent).toContain("Dana Reyes at dana@turner.com now, at $3,600.00");
    expect(q<HTMLInputElement>('input[name="confirmSend"]')!.value).toBe("yes");
    // Cancel FIRST, where the arming button stood.
    const buttons = [...q('[data-proposal="send-confirm"]')!.querySelectorAll("button")].map((b) => b.dataset.proposal);
    expect(buttons).toEqual(["send-cancel", "send-yes"]);
  });

  it("Cancel disarms without sending", async () => {
    paint();
    await click(q('[data-proposal="send-arm"]'));
    await click(q('[data-proposal="send-cancel"]'));
    expect(q('[data-proposal="send-arm"]')).not.toBeNull();
    expect(q('input[name="confirmSend"]')).toBeNull();
    expect(sendBidProposal).not.toHaveBeenCalled();
  });

  it("the second press sends with the confirm, then says it went", async () => {
    paint();
    await click(q('[data-proposal="send-arm"]'));
    await act(async () => {
      q<HTMLFormElement>("form")!.requestSubmit();
    });
    expect(sendBidProposal).toHaveBeenCalledTimes(1);
    const [jobId, invitationId, form] = sendBidProposal.mock.calls[0]! as [string, string, FormData];
    expect([jobId, invitationId]).toEqual(["job_1", "inv_1"]);
    expect(form.get("confirmSend")).toBe("yes");
    expect(form.get("toAddress")).toBe("dana@turner.com");
    expect(form.get("mode")).toBe("lump");
    expect(form.get("documentFingerprint")).toBe("f".repeat(64));
    expect(q('[data-proposal="send-done"]')!.textContent).toContain("Sent to Dana Reyes at dana@turner.com");
  });

  it("a send that went with a follow-up failure says SENT first, and offers no second press", async () => {
    sendBidProposal.mockResolvedValue({ ok: true, note: "Sent. The bid log couldn't be updated — mark it Submitted by hand." });
    paint();
    await click(q('[data-proposal="send-arm"]'));
    await act(async () => {
      q<HTMLFormElement>("form")!.requestSubmit();
    });
    const done = q('[data-proposal="send-done"]')!.textContent!;
    expect(done.startsWith("Sent to Dana Reyes at dana@turner.com.")).toBe(true);
    expect(done).toContain("mark it Submitted by hand");
    expect(q("form")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the action's refusal and keeps the form", async () => {
    sendBidProposal.mockResolvedValue({ ok: false, error: "The price on this proposal changed." });
    paint();
    await click(q('[data-proposal="send-arm"]'));
    await act(async () => {
      q<HTMLFormElement>("form")!.requestSubmit();
    });
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("The price on this proposal changed.");
    expect(q("form")).not.toBeNull();
  });

  it("is disabled with a sentence, and offers no send at all, when blocked", () => {
    paint({ blocker: "Proposals are only emailed from the live app. This is a preview, so nothing is sent from here." });
    expect(q('[data-proposal="send-blocked"]')!.textContent).toContain("This is a preview");
    expect(q("form")).toBeNull();
    expect(q('[data-proposal="send-arm"]')).toBeNull();
  });

  it("lists earlier sends, and warns that another is a second copy", () => {
    paint({
      history: [
        { id: "m2", when: "Oct 26, 2026", toAddress: "dana@turner.com", reached: true, detail: null },
        { id: "m1", when: "Oct 25, 2026", toAddress: "dana@turner.com", reached: false, detail: "Domain not verified" },
      ],
    });
    const items = [...host.querySelectorAll('[data-proposal="send-history"] li')].map((li) => li.textContent);
    expect(items).toEqual(["Sent Oct 26, 2026 to dana@turner.com", "Didn't send Oct 25, 2026 to dana@turner.com — Domain not verified"]);
    expect(host.textContent).toContain("Sending again puts a second copy in their inbox.");
  });
});
