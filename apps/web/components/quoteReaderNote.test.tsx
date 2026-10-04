// @vitest-environment happy-dom
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteSuggestion } from "@/lib/actions/quoteRead";

/**
 * THE ALLOWANCE SENTENCE HAS TO SURVIVE THE REMOUNT THAT FILLS THE FIELDS IN.
 *
 * What shipped: reading a quote charged a page of the company's monthly
 * allowance and said nothing on screen. The sentence was computed by the action,
 * returned on the suggestion, and set into `QuoteReader`'s own `useState` one
 * line before `onRead` — which bumps `formKey` in `QuoteForm`, and that key sits
 * on the `ActionForm` CONTAINING `QuoteReader`. React therefore unmounted the
 * subtree and mounted a fresh copy with `note` back at `null`. The message was
 * destroyed by the same call that filled the form in.
 *
 * WHY THIS TEST MOUNTS `QuoteForm` AND NOT `QuoteReader`. The defect is not in
 * either component. `QuoteReader` set and rendered its own state correctly;
 * `QuoteForm` remounted correctly. It lived in the COMPOSITION — a `key` in one
 * file, state in another — so a unit test of either half passes while the
 * feature is broken. That is the whole reason `QuoteForm` is exported.
 *
 * WHY NOTHING ELSE COULD HAVE CAUGHT IT. It is a mount-lifecycle fact, invisible
 * to type checking, to the action's own tests (which return the right sentence),
 * and to any assertion about a single render — the first render is correct, and
 * so is the second; only the transition between them loses anything. It also
 * hides behind an asymmetry: a FAILED read never calls `onRead`, so no remount
 * happens and every error and refusal renders perfectly. Only success was
 * unreachable. It took a click-through on a preview deployment to find.
 */

/**
 * REQUIRED, AND NOT COSMETIC. Without it React prints "The current testing
 * environment is not configured to support act(...)" and does not treat `act` as
 * a real batching boundary — so state updates are not guaranteed flushed when
 * the assertions run. The first version of this file passed with that warning,
 * which means it passed without proving the thing it claims to prove: this whole
 * test is about what survives one specific re-render, so an unflushed tree makes
 * every assertion below meaningless.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE = "That read used 1 page. 1,496 of 1,500 pages left this month.";

const suggestion: QuoteSuggestion = {
  vendorName: "ZZ SYNTHETIC Ridgeline Drywall",
  packageLabel: "Drywall and Metal Framing",
  amount: 84_500,
  quotedOn: "2026-09-20",
  exclusions: "Painting",
  readingNotes: null,
  note: NOTE,
  pagesLeft: 1_496,
};

const readBidQuoteDocument = vi.fn();
const uploadDocumentFile = vi.fn();

// Only the exports these two components actually reach for. The barrel is
// mocked rather than imported because it pulls the whole server-action surface
// in, and CLAUDE.md's note about partially-mocked barrels is the reason each
// name below is listed explicitly instead of spread from the real module.
vi.mock("@/lib/actions", () => ({
  readBidQuoteDocument: (...args: unknown[]) => readBidQuoteDocument(...args),
  saveBidQuote: vi.fn(),
  deleteBidQuote: vi.fn(),
  recordBidQuoteDecline: vi.fn(),
}));

vi.mock("@/lib/document-upload-client", () => ({
  uploadDocumentFile: (...args: unknown[]) => uploadDocumentFile(...args),
}));

const { QuoteForm } = await import("@/components/BidLevelling");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  readBidQuoteDocument.mockReset();
  uploadDocumentFile.mockReset();
  uploadDocumentFile.mockResolvedValue({ ok: true, fileUrl: "https://store.example/q.pdf", fileName: "q.pdf" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  act(() => {
    root.render(
      createElement(QuoteForm, {
        bidInvitationId: "bid_1",
        companyId: "co_1",
        quote: null,
        vendors: [],
        usedLabels: [],
        mode: "quote" as const,
        onDone: () => {},
      }),
    );
  });
}

/** Drives the real file input, so the read runs through `QuoteReader`'s own
 *  handler and `onRead` rather than being called directly — the remount is the
 *  thing under test and only that path triggers it. */
async function upload() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("the quote reader's file input is not on the form");
  const file = new File([new Uint8Array([1, 2, 3])], "q.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("what a quote read cost is still on screen after the form refills", () => {
  it("shows the allowance sentence once the reading has filled the fields", async () => {
    readBidQuoteDocument.mockResolvedValue({ ok: true, value: suggestion });
    mount();

    // Nothing before a read: the panel must not speak until it has something to
    // say, which is the same rule `QuoteReadingNotes` follows.
    expect(container.querySelector('[data-quote-reader="note"]')).toBeNull();

    await upload();

    // THE ASSERTION THIS FILE EXISTS FOR. Before the fix this was null, while
    // the page had already been charged.
    const note = container.querySelector('[data-quote-reader="note"]');
    expect(note, "the allowance sentence should survive the remount that fills the fields").not.toBeNull();
    expect(note!.textContent).toBe(NOTE);

    // And the fields really did refill — otherwise this test could pass on a
    // build where the remount never happened, which would make the assertion
    // above vacuous. The remount IS the hazard, so it has to be proved present.
    const amount = container.querySelector<HTMLInputElement>('input[name="amount"]');
    expect(amount?.value, "the suggestion should have reached the amount box").toBe("84500");
  });

  it("says nothing about a charge when the read was refused", async () => {
    // The feature switch off. `aiGate` returns before the allowance is claimed,
    // so there is no charge to report — and a refusal does not remount, which is
    // why this path always worked and hid the defect above.
    readBidQuoteDocument.mockResolvedValue({
      ok: false,
      error: "Reading a sub's quote is switched off for your company.",
    });
    mount();
    await upload();

    expect(container.querySelector('[data-quote-reader="note"]')).toBeNull();
    expect(container.querySelector('[data-quote-reader="error"]')?.textContent).toContain("switched off");
  });

  it("drops a stale charge line when a later read fails", async () => {
    // One good read, then a failure. The old sentence describes a charge that
    // really happened, but standing it beside a fresh error reads as that error
    // having cost money.
    readBidQuoteDocument.mockResolvedValue({ ok: true, value: suggestion });
    mount();
    await upload();
    expect(container.querySelector('[data-quote-reader="note"]')).not.toBeNull();

    readBidQuoteDocument.mockResolvedValue({ ok: false, error: "That file could not be read." });
    await upload();

    expect(container.querySelector('[data-quote-reader="note"]')).toBeNull();
    expect(container.querySelector('[data-quote-reader="error"]')?.textContent).toContain("could not be read");
  });
});
