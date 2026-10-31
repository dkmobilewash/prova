// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The home's big box, driven the way a person drives it: paste, Start, check
 * the proposed fields, log. The two server actions are the EXISTING ones
 * ("Log a bid"'s reader and creator), mocked at the barrel; what is asserted is
 * that nothing is created before the person confirms, that the confirmed form is
 * what reaches `createBidInvitation`, and that a refused read says so and offers
 * the by-hand route.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const readBidInvitationText = vi.fn();
const createBidInvitation = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/actions", () => ({ readBidInvitationText, createBidInvitation }));

const { BidHomeAsk } = await import("./BidHomeAsk");

const SUGGESTION = {
  contactId: "gc-1",
  projectName: "Riverside Medical, L2",
  tradeScope: "METAL_FRAMING_DRYWALL",
  dueDate: "2026-11-05",
  dueMinute: 840,
  notes: "Site: 1200 Main St",
  checks: ["The due time was not printed."],
  dropped: [],
  note: "Read with one assistant question — 49 left this month. Check every field before you log it.",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  readBidInvitationText.mockReset();
  createBidInvitation.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function paste(text: string) {
  const area = container.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const start = () => container.querySelector('[data-bid="home-start"]') as HTMLButtonElement;

describe("BidHomeAsk", () => {
  it("Start is off until something is pasted, and reading creates nothing", async () => {
    readBidInvitationText.mockResolvedValue({ ok: true, value: SUGGESTION });
    act(() => root.render(<BidHomeAsk gcs={[{ id: "gc-1", name: "Hartwell" }]} />));
    expect(start().disabled).toBe(true);
    paste("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    expect(start().disabled).toBe(false);
    act(() => start().click());
    await flush();
    expect(readBidInvitationText).toHaveBeenCalledWith("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    // The fields are proposed, filled in, to be checked — and nothing has been saved.
    expect(createBidInvitation).not.toHaveBeenCalled();
    const confirm = container.querySelector('[data-bid="home-confirm"]')!;
    expect(confirm.textContent).toContain("49 left this month");
    expect(confirm.textContent).toContain("The due time was not printed.");
    expect((confirm.querySelector('[name="projectName"]') as HTMLInputElement).value).toBe("Riverside Medical, L2");
    expect((confirm.querySelector('[name="contactId"]') as HTMLSelectElement).value).toBe("gc-1");
    expect((confirm.querySelector('[name="dueDate"]') as HTMLInputElement).value).toBe("2026-11-05");
  });

  it("Log this bid sends the confirmed form to createBidInvitation with the GC, then says it is logged", async () => {
    readBidInvitationText.mockResolvedValue({ ok: true, value: SUGGESTION });
    act(() => root.render(<BidHomeAsk gcs={[{ id: "gc-1", name: "Hartwell" }]} />));
    paste("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    act(() => start().click());
    await flush();
    const form = container.querySelector('[data-bid="home-confirm"] form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    await flush();
    expect(createBidInvitation).toHaveBeenCalledTimes(1);
    const [contactId, formData] = createBidInvitation.mock.calls[0] as unknown as [string, FormData];
    expect(contactId).toBe("gc-1");
    expect(formData.get("projectName")).toBe("Riverside Medical, L2");
    const logged = container.querySelector('[data-bid="home-logged"]')!;
    expect(logged.textContent).toContain("Logged: Riverside Medical, L2");
    expect(logged.querySelector("a")?.getAttribute("href")).toBe("/bid/bids?view=all");
  });

  it("a refused read shows the reason and a by-hand route, and opens no form", async () => {
    readBidInvitationText.mockResolvedValue({ ok: false, error: "AI is off. You can still type the invitation in yourself." });
    act(() => root.render(<BidHomeAsk gcs={[{ id: "gc-1", name: "Hartwell" }]} />));
    paste("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    act(() => start().click());
    await flush();
    const error = container.querySelector('[data-bid="home-read-error"]')!;
    expect(error.textContent).toContain("AI is off");
    expect(error.querySelector("a")?.getAttribute("href")).toBe("/bid/bids?new=1");
    expect(container.querySelector('[data-bid="home-confirm"]')).toBeNull();
    expect(createBidInvitation).not.toHaveBeenCalled();
  });

  it("'Not right — start over' drops the proposal and keeps what was pasted", async () => {
    readBidInvitationText.mockResolvedValue({ ok: true, value: SUGGESTION });
    act(() => root.render(<BidHomeAsk gcs={[{ id: "gc-1", name: "Hartwell" }]} />));
    paste("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    act(() => start().click());
    await flush();
    const startOver = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("start over"))!;
    act(() => startOver.click());
    expect(container.querySelector('[data-bid="home-confirm"]')).toBeNull();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toContain("Riverside Medical");
  });

  it("with no GC on file it cannot read, and says where to add one", () => {
    act(() => root.render(<BidHomeAsk gcs={[]} />));
    paste("Hartwell invites you to bid Riverside Medical, L2, due 11/5.");
    expect(start().disabled).toBe(true);
    expect(container.querySelector('[data-bid="home-no-gcs"] a')?.getAttribute("href")).toBe("/bid/settings#gcs");
  });
});
