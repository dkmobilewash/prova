import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceStore } from "./setup";
import { mount } from "./render";

/**
 * The punch list with no signal, rendered.
 *
 * The report that started all of this, from a jobsite on 2026-09-20: in
 * Airplane Mode this screen said **"Nothing outstanding on this job."** —
 * its empty state — on a job with plenty outstanding. Three fixes later
 * it was still showing no note, because each fix was verified by reading
 * the code rather than by mounting the screen.
 *
 * ---
 *
 * AND, FROM #592/#593, THE ROW'S OWN CONTROLS — which is the half of this
 * file that has to answer a sharper question than "is the sentence on the
 * page".
 *
 * CLAUDE.md records three PRs (#548, #553, #554) that shipped GREEN while
 * rendering nothing: each asserted that a screen had RECORDED a header
 * option, in a mock, while expo-router threw the real one away. *A census
 * can tell you the code is THERE; it can never tell you a framework
 * HONOURS it.* So every assertion below reads the RENDERED DOM — the
 * actual `<button>` react-native-web put on the page, found inside the
 * actual row — and the mutation that decides whether this file is worth
 * anything is **"make it render nothing"**: with the delete block's
 * condition forced to `false`, five cases here go red.
 *
 * TWO THINGS IT CANNOT SEE, stated so nobody reads more into a green run
 * than is there:
 *
 *   - **Layout.** happy-dom does no layout and returns zeros from
 *     `getBoundingClientRect`, which is how a 1.35-POINT line height
 *     shipped on five screens. The armed pair's ordering is asserted as
 *     DOM ORDER, which is the order a flex column paints in but is NOT a
 *     measurement. That Cancel is full width and sits ABOVE the confirm in
 *     pixels is unproven here and needs a phone.
 *   - **Native.** The icon font is a mock; see below.
 */

const listPunchListItems = vi.fn();
const deletePunchListItem = vi.fn();
const setPunchListItemStatus = vi.fn();
const getMe = vi.fn();

vi.mock("@/lib/api", () => ({
  listPunchListItems: (...args: unknown[]) => listPunchListItems(...args),
  // The queue calls these when `sync()` drains it, so they are the online
  // half of a write — and the OFFLINE half is them rejecting, which is
  // what a phone in a basement does.
  deletePunchListItem: (...args: unknown[]) => deletePunchListItem(...args),
  setPunchListItemStatus: (...args: unknown[]) => setPunchListItemStatus(...args),
  getMe: (...args: unknown[]) => getMe(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

/**
 * The icon font, rendering a MARKER instead of nothing.
 *
 * `screens/setup.tsx` mocks Ionicons to `() => null`, which is right for
 * every other screen test and useless for #593: with the chevron drawing
 * nothing, "the chevron is gone" is true of a row that still has one. A
 * test that cannot tell those apart is the vacuous-green shape this whole
 * directory exists to end, so this file overrides the mock for its own
 * module registry and every chevron assertion carries a POSITIVE CONTROL —
 * a glyph that must be found in the same row — so a marker mock that
 * stopped applying fails loudly instead of passing everything.
 */
vi.mock("@expo/vector-icons/Ionicons", () => ({
  default: ({ name }: { name: string }) => <span data-glyph={name} />,
}));

const ITEM = {
  id: "item_1",
  description: "Grid out of level at column C4",
  area: "L3",
  status: "OPEN" as const,
  createdAt: "2026-09-20T12:00:00.000Z",
  photoCount: 0,
};

const READY = { ...ITEM, status: "READY_FOR_REVIEW" as const };
const VERIFIED = { ...ITEM, status: "VERIFIED" as const };

const OFFLINE = () => Promise.reject(new TypeError("Network request failed"));

/** The owner, whom the DELETE route allows, and somebody else. */
const OWNER = {
  id: "u_1",
  name: "Cyrus",
  email: "owner@example.com",
  role: "OWNER",
  jobFunction: null,
  capabilities: ["MANAGE_FIELD"],
  restricted: false,
  company: { id: "c_1", name: "Prova" },
};
const CREW = { ...OWNER, id: "u_2", role: "MEMBER", jobFunction: "FIELD" };

/** What the queue wrote to this phone's disk, read back from the store
 * rather than from the module — the queue's own key, so a test cannot be
 * satisfied by a module instance nobody shares. */
function queued(): { type: string; jobId?: string; itemId?: string }[] {
  const raw = deviceStore.get("prova.field-queue");
  return raw ? (JSON.parse(raw) as { type: string }[]) : [];
}

beforeEach(() => {
  deviceStore.clear();
  /** EVERY ROW-SCOPED QUERY HERE IS `document.querySelector`, so a container
   * left behind by a test that failed before its `unmount()` makes every
   * later case answer about the wrong screen — and a tap lands on the wrong
   * one. One failure then reads as five. The Sheet's Modal also portals to
   * `document.body` and is not inside the mount container. */
  document.body.innerHTML = "";
  listPunchListItems.mockReset();
  deletePunchListItem.mockReset();
  setPunchListItemStatus.mockReset();
  getMe.mockReset();
  // Nobody loaded by default, the way the original three cases ran: `me`
  // stays null, which `mayRemove` treats as "draw it" for the reason
  // lib/capabilities.ts gives.
  getMe.mockImplementation(OFFLINE);
  deletePunchListItem.mockResolvedValue(undefined);
  setPunchListItemStatus.mockResolvedValue(READY);
  vi.resetModules();
});

async function open() {
  const { default: PunchListScreen } = await import("@/app/punch-list/[jobId]");
  return mount(<PunchListScreen />);
}

/** The row itself — the element `GroupedRow` renders, found by the
 * accessibility label it gives its toggle. Every row-scoped assertion goes
 * through this, because the screen draws a chevron OUTSIDE the list (the
 * job chip) and a document-wide query would answer about that one. */
function row(label: string): HTMLElement {
  const found = document.querySelector(`[aria-label="${label}"]`);
  expect(found, `no row labelled "${label}"`).toBeTruthy();
  return found as HTMLElement;
}

function glyphsIn(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll("[data-glyph]")).map(
    (node) => node.getAttribute("data-glyph") ?? "",
  );
}

/** The pressable controls inside an element, IN DOM ORDER, by their words. */
function buttonsIn(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll('[role="button"]')).map((node) => node.textContent ?? "");
}

/** A real tap, inside `act` so the state it sets is committed before the
 * next assertion reads the DOM. Without the wrapper React 19 warns and the
 * re-render arrives after the query — a Cancel that worked read as a Cancel
 * that did nothing. */
async function tap(node: Element | null | undefined, what: string): Promise<void> {
  expect(node, `nothing to tap for "${what}"`).toBeTruthy();
  await act(async () => {
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Taps the control whose words are exactly `label`. Exact rather than a
 * substring: "Remove" and "Remove it" are two different decisions. */
async function tapLabelled(label: string): Promise<void> {
  const node = Array.from(document.querySelectorAll('[role="button"]')).find(
    (candidate) => candidate.textContent === label,
  );
  await tap(node, label);
}

describe("the punch list on a phone with no signal", () => {
  it("shows the items this phone last loaded, and says they are last-loaded", async () => {
    listPunchListItems.mockResolvedValueOnce([ITEM]);
    const online = await open();
    expect(online.text()).toContain("Grid out of level at column C4");
    online.unmount();

    listPunchListItems.mockImplementation(OFFLINE);
    const offline = await open();

    expect(offline.text()).toContain("Grid out of level at column C4");
    expect(offline.text()).toMatch(/Showing what this phone last loaded.*no connection/);
    // THE SENTENCE THAT WAS THE BUG.
    expect(offline.text()).not.toContain("Nothing outstanding on this job");
    offline.unmount();
  });

  it("says it could not load rather than that the job is clear, with no cache", async () => {
    listPunchListItems.mockImplementation(OFFLINE);
    const screen = await open();
    expect(screen.text()).toMatch(/hasn't loaded it before/);
    expect(screen.text()).not.toContain("Nothing outstanding on this job");
    screen.unmount();
  });

  it("says nothing about connections when the server answered", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();
    expect(screen.text()).not.toMatch(/no connection/);
    screen.unmount();
  });
});

/**
 * #593 — the chevron that lied.
 *
 * `GroupedRow` defaults `chevron = true` and draws one whenever `onPress`
 * exists, `role="checkbox"` or not, so the gesture a person makes to
 * INSPECT an item was the gesture that changed its state.
 */
describe("the row no longer promises a destination", () => {
  it("draws no chevron inside the row, while still drawing its other icons", async () => {
    listPunchListItems.mockResolvedValue([READY]);
    const screen = await open();
    const glyphs = glyphsIn(row("Mark as still open"));

    // THE POSITIVE CONTROL. A ticked box draws `check`; if this is missing
    // the marker mock is not applying and the next assertion means nothing.
    expect(glyphs, "the icon marker mock is not reaching this row").toContain("checkmark");
    expect(glyphs, "the row still draws a chevron it cannot honour").not.toContain("chevron-forward");

    // And the control for the control: the screen DOES draw a chevron
    // elsewhere (the job chip), so a query that forgot to scope to the row
    // would have found one.
    expect(glyphsIn(document.body as HTMLElement)).toContain("chevron-forward");
    screen.unmount();
  });

  it("still toggles the status when the row itself is tapped", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();
    expect(screen.text()).toContain("Open · L3");

    await tap(row("Mark as ready for review"), "the row");
    await screen.settle();

    // The screen's own answer, not the queue's: the row says what the
    // person just did, and says it is on its way to the office.
    expect(screen.text()).toContain("Ready for review · Syncing…");
    // And it went to the office. NOT asserted as a queue entry: `sync()`
    // drains the queue straight away when the server is answering, so an
    // empty queue is what SUCCESS looks like here — a check that cannot
    // tell "sent" from "never queued" is the vacuous shape CLAUDE.md is
    // full of.
    expect(setPunchListItemStatus).toHaveBeenCalledWith("job_1", "item_1", "READY_FOR_REVIEW", "test_token");
    screen.unmount();
  });
});

/**
 * #592 — a way out that does not involve finding a computer.
 */
describe("removing an item from the phone", () => {
  it("renders a Remove control on the row", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();

    expect(buttonsIn(row("Mark as ready for review"))).toContain("Remove");
    // What is being removed is named in the description rather than in the
    // button, which is the third axis of the "Cancel inherits the delete
    // pixel" entry: a long label makes the armed pair too narrow to cover
    // the pixel it replaced.
    expect(
      document.querySelector('[aria-label="Remove “Grid out of level at column C4” from this punch list"]'),
      "the Remove control does not say what it removes",
    ).toBeTruthy();
    expect("Remove".length, "a delete label over 12 characters — see CLAUDE.md").toBeLessThanOrEqual(12);
    screen.unmount();
  });

  it("arms in two steps, with Cancel above the confirm", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();

    // STEP ONE does not delete anything.
    await tapLabelled("Remove");
    await screen.settle();
    expect(deletePunchListItem).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);

    const armed = buttonsIn(row("Mark as ready for review"));
    expect(armed).toContain("Cancel");
    expect(armed).toContain("Remove it");
    expect("Remove it".length).toBeLessThanOrEqual(12);

    // CANCEL INHERITS THE DELETE PIXEL, read vertically: it takes the slot
    // "Remove" was in, so a hurried second tap costs a tap rather than the
    // record. DOM order, which is the order a flex column paints — not a
    // measurement; no test here can see layout.
    expect(
      armed.indexOf("Cancel"),
      `the confirm is above Cancel: ${armed.join(" | ")}`,
    ).toBeLessThan(armed.indexOf("Remove it"));
    // Cancel is also the FIRST control in the row, so nothing was inserted
    // above it to push it off that slot.
    expect(armed[0]).toBe("Cancel");

    // Rule 1 of #152: every ordinary action is hidden while armed — the
    // photo prompt, and the row's own tap.
    expect(screen.text()).not.toContain("No photo of the fix");
    await tap(row("Mark as ready for review"), "the armed row");
    await screen.settle();
    expect(setPunchListItemStatus, "tapping an armed row still changed its status").not.toHaveBeenCalled();
    screen.unmount();
  });

  it("puts the row back as it was when Cancel is tapped", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();

    await tapLabelled("Remove");
    await screen.settle();
    await tapLabelled("Cancel");
    await screen.settle();

    expect(buttonsIn(row("Mark as ready for review"))).toEqual(["Remove"]);
    expect(deletePunchListItem).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
    screen.unmount();
  });

  it("deletes exactly once on the confirm, and only then", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    const screen = await open();

    await tapLabelled("Remove");
    await screen.settle();
    // From here the server no longer has it, which is what the screen reads
    // back after the queue drains. Set AFTER arming on purpose: the mount's
    // own load and `useSync`'s focus flush both read this list, so an empty
    // answer from the start would have taken the row away before the tap.
    listPunchListItems.mockResolvedValue([]);
    await tapLabelled("Remove it");
    await screen.settle();

    expect(deletePunchListItem).toHaveBeenCalledTimes(1);
    expect(deletePunchListItem).toHaveBeenCalledWith("job_1", "item_1", "test_token");
    // Sent, so nothing is left on the queue and the server's own list — now
    // without it — is what the screen draws.
    expect(queued()).toEqual([]);
    expect(screen.text()).not.toContain("Grid out of level at column C4");
    screen.unmount();
  });

  it("queues the delete and says so when there is no signal", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    deletePunchListItem.mockImplementation(OFFLINE);
    const screen = await open();

    await tapLabelled("Remove");
    await screen.settle();
    await tapLabelled("Remove it");
    await screen.settle();

    // THE QUEUED PATH: on disk, carrying the job and the item, with the row
    // still on screen saying it is on its way out rather than vanishing and
    // coming back when the cached list is read again.
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ type: "punch-list:delete", jobId: "job_1", itemId: "item_1" });
    expect(screen.text()).toContain("Grid out of level at column C4");
    expect(screen.text()).toContain("Removing…");
    // And nothing else is offered on a row that is already going.
    expect(buttonsIn(row("Mark as ready for review"))).toEqual([]);
    screen.unmount();
  });

  it("offers nothing on a verified item — that status is somebody else's sign-off", async () => {
    listPunchListItems.mockResolvedValue([VERIFIED]);
    const screen = await open();
    expect(buttonsIn(row("Mark as still open"))).not.toContain("Remove");
    expect(screen.text()).toContain("Verified");
    screen.unmount();
  });
});

/**
 * The server's DELETE is owner-only (`ownerRefusal`, in parity with the web
 * row), so a control offered to a crew member would be a button whose only
 * outcome is a 403 in "needs attention". Both arms are asserted: an
 * owner-only gate that has quietly become "nobody" is the same defect
 * wearing the opposite sign.
 */
describe("who is offered the way out", () => {
  it("offers it to the account owner", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    getMe.mockResolvedValue(OWNER);
    const screen = await open();
    expect(buttonsIn(row("Mark as ready for review"))).toContain("Remove");
    screen.unmount();
  });

  it("does not offer a button the server would refuse", async () => {
    listPunchListItems.mockResolvedValue([ITEM]);
    getMe.mockResolvedValue(CREW);
    const screen = await open();
    expect(buttonsIn(row("Mark as ready for review"))).not.toContain("Remove");
    // The rest of the row is untouched — this is a missing control, not a
    // missing screen.
    expect(screen.text()).toContain("Grid out of level at column C4");
    screen.unmount();
  });
});
