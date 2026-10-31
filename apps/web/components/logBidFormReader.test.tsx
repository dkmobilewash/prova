import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const readBidInvitationText = vi.fn();
vi.mock("@/lib/actions", () => ({
  createBidInvitation: vi.fn(),
  checkSameJobFromOtherGc: vi.fn(async () => ({ ok: true, value: [] })),
  readBidInvitationText,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/bid/bids" }));

const { LogBidForm } = await import("./LogBidForm");
const { INVITE_READ_NOT_CONFIGURED, inviteReaderAccess, inviteReadSwitchedOff } = await import("@/lib/bid/inviteReaderAccess");

/**
 * THE PASTE BOX SAYS UP FRONT WHEN IT CANNOT READ — contractor walk,
 * 2026-10-27. In CI, with no model key, the box looked live, took a whole
 * email, and only after "Fill the form from it" said the invitation "couldn't
 * be read" and that a failed question was recorded against the allowance. The
 * job screen's ask box on the same server said, before anything was typed,
 * "Asking isn't set up on this server yet." This holds the Log-a-bid box to
 * the same standard.
 */

const GCS = [{ id: "gc-1", name: "Bayline Builders" }];
const render = (reader: Parameters<typeof LogBidForm>[0]["reader"]) =>
  renderToStaticMarkup(createElement(LogBidForm, { gcs: GCS, startOpen: true, surface: "bid", reader }));

describe("inviteReaderAccess", () => {
  it("no model key on the server: the plain sentence, whatever the company's switch says", () => {
    expect(inviteReaderAccess({ configured: false, refusal: null })).toEqual({ available: false, reason: INVITE_READ_NOT_CONFIGURED });
    expect(inviteReaderAccess({ configured: false, refusal: "Off." })).toEqual({ available: false, reason: INVITE_READ_NOT_CONFIGURED });
  });

  it("the company's switch off: its own sentence, and that typing still works", () => {
    expect(inviteReaderAccess({ configured: true, refusal: "Bid research is switched off for your company." })).toEqual({
      available: false,
      reason: inviteReadSwitchedOff("Bid research is switched off for your company."),
    });
  });

  it("key and switch both fine: available", () => {
    expect(inviteReaderAccess({ configured: true, refusal: null })).toEqual({ available: true });
  });
});

describe("LogBidForm's paste box", () => {
  it("with no reader, says why in place of the box — no textarea, no button to press", () => {
    const html = render({ available: false, reason: INVITE_READ_NOT_CONFIGURED });
    expect(html).toContain('data-bids="paste-off"');
    expect(html).toContain("Reading invites needs the assistant, which isn&#x27;t set up on this server yet.");
    expect(html).not.toContain('name="invitationText"');
    expect(html).not.toContain("Fill the form from it");
    // The form to type into is still there.
    expect(html).toContain('name="projectName"');
  });

  it("with a reader, the box and its button are drawn and no refusal is", () => {
    const html = render({ available: true });
    expect(html).toContain('name="invitationText"');
    expect(html).toContain("Fill the form from it");
    expect(html).not.toContain('data-bids="paste-off"');
  });
});
