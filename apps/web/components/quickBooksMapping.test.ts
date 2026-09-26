// @vitest-environment happy-dom

/**
 * DOES PICKING A QUICKBOOKS ACCOUNT STILL SAVE IT?
 *
 * THIS IS THE ONE NOBODY CAN CLICK. The form does not exist on screen until
 * `loadQuickBooksAccounts()` has come back with a real chart of accounts
 * from Intuit, so verifying it by hand needs a connected QuickBooks company
 * — which is why it arrived with no test of any kind. Before this file its
 * entire coverage was `formActionCensus.test.ts`, which reads the source for
 * a forbidden prop and executes nothing.
 *
 * That gap mattered on 2026-09-25, when issue #311 rewired it. It submitted
 * through `<form action={(formData) => save(purpose.value, formData)}>`, and
 * React 19 calls `requestFormReset` UNCONDITIONALLY before running a form's
 * `action`. So a refused save put the picker back to "— Choose an account —"
 * and printed the reason above a control that no longer held the choice it
 * was complaining about — and re-choosing means finding the right row again
 * in a list of every account a contractor's accountant has ever created.
 *
 * WHAT MAKES THIS FORM THE WORST CASE FOR THE REWRITE, beyond nobody being
 * able to click it: the account NAME is not typed and not a default. It is
 * written into a hidden input by the select's own `onChange`, so the value
 * the action needs exists only because a DOM handler put it there a moment
 * earlier. A `new FormData(event.currentTarget)` read at the wrong moment —
 * after an `await`, when `event.currentTarget` is null — loses both halves
 * of the mapping at once and the row silently stays unmapped. Nothing else
 * in this repo would notice.
 *
 * So: the action ran exactly once, it carried the purpose AND the id AND the
 * name the onChange wrote, a refusal leaves the chosen account still chosen,
 * and the native navigation was prevented.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({
  loadQuickBooksAccounts: vi.fn(),
  saveQuickBooksAccountMapping: vi.fn(),
  clearQuickBooksAccountMapping: vi.fn(),
}));

const actions = await import("@/lib/actions");
const { QuickBooksMapping } = await import("@/components/QuickBooksMapping");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** A chart of accounts shaped like the one Intuit returns. Two of them, so
 * "the id that was picked" is a real choice rather than the only option. */
const ACCOUNTS = [
  { id: "77", name: "Construction Income", accountType: "Income" },
  { id: "84", name: "Job Materials", accountType: "Cost of Goods Sold" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(actions.loadQuickBooksAccounts).mockReset();
  vi.mocked(actions.saveQuickBooksAccountMapping).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

/**
 * Renders the component and presses **Load accounts from QuickBooks**,
 * because until that resolves there is no `<form>` in the document at all —
 * the row renders a plain "Not mapped" sentence instead. Getting to the form
 * is part of what this file has to prove.
 */
async function renderLoaded() {
  vi.mocked(actions.loadQuickBooksAccounts).mockResolvedValue({ ok: true, accounts: ACCOUNTS });
  act(() => {
    root.render(createElement(QuickBooksMapping, { mappings: [] }));
  });

  expect(container.querySelector("form"), "a form before the accounts loaded").toBeNull();

  const load = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Load accounts"),
  )!;
  await act(async () => {
    load.dispatchEvent(new Event("click", { bubbles: true }));
  });

  const forms = container.querySelectorAll("form");
  // One row per purpose Settings offers. Asserted so that a form list which
  // quietly shrank — or a render that produced none — fails here rather than
  // letting the assertions below pass over an empty page.
  expect(forms.length).toBe(5);
  return forms;
}

/** The first row is Invoice revenue (INCOME) — the money a GC is billed. */
function incomeRow(forms: NodeListOf<Element>) {
  const form = forms[0] as HTMLFormElement;
  return {
    form,
    purpose: form.querySelector<HTMLInputElement>('input[name="purpose"]')!,
    select: form.querySelector<HTMLSelectElement>('select[name="qboAccountId"]')!,
    accountName: form.querySelector<HTMLInputElement>('input[name="qboAccountName"]')!,
    save: form.querySelector<HTMLButtonElement>('button[type="submit"]')!,
  };
}

/** Choosing an account the way a person does — the select's own `onChange` is
 * what fills the hidden name field, so this cannot be shortcut by assigning
 * the hidden input directly. */
async function choose(select: HTMLSelectElement, id: string) {
  select.value = id;
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** A real submit event, kept so the test can read `defaultPrevented` off the
 * very event the handler was given. `cancelable` is what makes that readable
 * at all — on a non-cancelable event `preventDefault()` is a no-op and the
 * assertion would pass while the handler did nothing. */
async function fireSubmit(form: HTMLFormElement) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  act(() => {
    form.dispatchEvent(event);
  });
  await act(async () => {});
  return event;
}

describe("saving a QuickBooks account mapping", () => {
  it("calls the action once, with the purpose, the picked id and the name onChange wrote", async () => {
    vi.mocked(actions.saveQuickBooksAccountMapping).mockResolvedValue({ ok: true });
    const row = incomeRow(await renderLoaded());

    // Nothing mapped yet, so the picker starts on the empty option and the
    // hidden name is empty — the state the onChange has to fill in.
    expect(row.select.value).toBe("");
    expect(row.accountName.value).toBe("");

    await choose(row.select, "84");
    expect(row.accountName.value, "the select's onChange did not fill the hidden name").toBe(
      "Job Materials",
    );

    const event = await fireSubmit(row.form);

    // 4. A missed preventDefault() is a full page POST that looks like a save.
    expect(event.defaultPrevented).toBe(true);
    // 1. Once.
    expect(vi.mocked(actions.saveQuickBooksAccountMapping)).toHaveBeenCalledTimes(1);

    // 2. All three values, and the name is the one the DOM handler wrote
    // rather than a default — which is the half a FormData read after an
    // `await` loses silently.
    const [formData] = vi.mocked(actions.saveQuickBooksAccountMapping).mock.calls[0]!;
    expect(formData.get("purpose")).toBe("INCOME");
    expect(formData.get("qboAccountId")).toBe("84");
    expect(formData.get("qboAccountName")).toBe("Job Materials");
    expect([...formData.keys()].sort()).toEqual(["purpose", "qboAccountId", "qboAccountName"]);
  });

  it("posts each row's OWN purpose, not the first one's", async () => {
    // The purpose travels in a hidden field per row and the handler is a
    // closure over `purpose.value`. Submitting a later row proves the two
    // agree — a mapping filed under the wrong purpose is how "Settings shows
    // it mapped and the push path calls it missing" happened before.
    vi.mocked(actions.saveQuickBooksAccountMapping).mockResolvedValue({ ok: true });
    const forms = await renderLoaded();
    const material = forms[2] as HTMLFormElement;
    const select = material.querySelector<HTMLSelectElement>('select[name="qboAccountId"]')!;

    await choose(select, "84");
    await fireSubmit(material);

    const [formData] = vi.mocked(actions.saveQuickBooksAccountMapping).mock.calls[0]!;
    expect(formData.get("purpose")).toBe("MATERIAL");
    expect(formData.get("qboAccountId")).toBe("84");
  });

  it("keeps the chosen account chosen when the save is REFUSED, and renders the reason", async () => {
    // The exact shape of #311, on the form where it costs the most: under the
    // old `action` prop the picker was back to "— Choose an account —" by the
    // time this sentence appeared.
    vi.mocked(actions.saveQuickBooksAccountMapping).mockResolvedValue({
      ok: false,
      error: "Only the account owner can configure QuickBooks",
    });
    const row = incomeRow(await renderLoaded());

    await choose(row.select, "77");
    await fireSubmit(row.form);

    // 3a. The reason reached the screen.
    expect(container.textContent).toContain("Only the account owner can configure QuickBooks");
    // 3b. …and the choice it is about is STILL CHOSEN. This is the whole of
    // #311 on this form: under the old `action` prop the picker read
    // "— Choose an account —" by the time this sentence appeared.
    expect(row.select.value).toBe("77");
    expect(row.select.options[row.select.selectedIndex]!.textContent).toContain("Construction Income");
    // The hidden companion field is deliberately NOT asserted here — see
    // "what this environment cannot answer" at the bottom of this file.
  });

  it("leaves the choice in place on success too — the saved state IS the chosen account", async () => {
    vi.mocked(actions.saveQuickBooksAccountMapping).mockResolvedValue({ ok: true });
    const row = incomeRow(await renderLoaded());

    await choose(row.select, "77");
    await fireSubmit(row.form);

    expect(row.select.value).toBe("77");
    expect(container.textContent).not.toContain("Only the account owner");
  });

  it("disables Save while the save is in flight, and frees it after", async () => {
    // Every row's button reads the one shared `isPending`, so this also
    // proves the transition is still what wraps the call — outside it,
    // nothing here would ever report pending.
    let finish: (v: { ok: true }) => void = () => {};
    vi.mocked(actions.saveQuickBooksAccountMapping).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    const forms = await renderLoaded();
    const row = incomeRow(forms);

    await choose(row.select, "77");
    expect(row.save.disabled).toBe(false);

    act(() => {
      row.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(row.save.disabled).toBe(true);

    await act(async () => {
      finish({ ok: true });
    });
    expect(row.save.disabled).toBe(false);
  });
});

/**
 * WHAT THIS ENVIRONMENT CANNOT ANSWER, measured rather than assumed.
 *
 * The account NAME travels in a hidden input that the select's `onChange`
 * writes. Asserting that it SURVIVES a refused save would be testing
 * happy-dom rather than this app, because happy-dom does not implement the
 * HTML dirty-value flag: assigning `defaultValue` overwrites a live `value`
 * it should have left alone. React's uncontrolled-input update path assigns
 * `node.defaultValue` on every re-render, so in here the hidden field reads
 * empty after the refusal re-render, and in a real browser — where setting
 * `.value` marks the control dirty and `defaultValue` then cannot touch it —
 * it should still hold the name.
 *
 * "Should" is the honest word: nothing in this repo can run that check, so
 * it is on the click-list instead (pick an account, force a refusal, press
 * Save a second time — it must save rather than answer "Choose a QuickBooks
 * account").
 *
 * This is a TEST rather than a paragraph so the claim cannot rot quietly. If
 * happy-dom ever implements the dirty flag, this goes red, and whoever sees
 * it can promote the assertion above from the click-list into the suite.
 */
describe("the limit of this environment, asserted so the note above cannot go stale", () => {
  it("happy-dom lets defaultValue overwrite a live value, which a browser does not", () => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.defaultValue = "Construction Income";
    input.value = "Job Materials"; // per HTML, this sets the dirty-value flag
    input.defaultValue = "Construction Income"; // per HTML, value must stay

    // A browser answers "Job Materials" here. When this stops being
    // "Construction Income", the hidden-field assertions can come back.
    expect(input.value).toBe("Construction Income");
  });
});
