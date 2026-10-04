// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe as group, expect, it, vi } from "vitest";

/**
 * DOES A REAL CLICK OPEN THE SPEC SECTION FORM?
 *
 * ── WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL ──
 *
 * The browser click-through of the spec reader (#604) got three steps in and
 * reported this, honestly, rather than papering over it:
 *
 *   "my mouse clicks and typing didn't register anywhere on the page, and
 *    screenshots also failed. I opened the form and submitted it by triggering
 *    the buttons from script… I haven't confirmed that a real click on 'Log a
 *    spec section' opens the form, so please try one yourself."
 *
 * That tester was right to flag it and right about the likely cause — its own
 * input synthesis and its screenshots failed in the same breath, which points
 * at the harness. But it leaves the one question the click-list existed to
 * answer UNANSWERED: the data path was proved, and the first press was not.
 *
 * Calling `setAdding("spec")` from script proves nothing about a user. It skips
 * the whole chain a real press goes through — the element being a reachable
 * `<button type="button">`, React's listener being attached at the root,
 * the synthetic event dispatching, and the state landing in a render.
 *
 * ── SO THIS CLICKS THE WAY A PERSON DOES ──
 *
 * `element.click()`, which dispatches a real `MouseEvent` through React's own
 * delegated listener. No handler is reached for, no prop is called directly,
 * and nothing is asserted about internal state — only what a person would then
 * SEE on the page.
 *
 * ── WHAT IT CANNOT TELL YOU, said plainly ──
 *
 * happy-dom does no layout, so this says NOTHING about whether the button is
 * visible, on screen, large enough, or covered by something else — CLAUDE.md's
 * standing rule, and the reason the 1.35-point line height shipped. It also
 * cannot tell you a framework honours an option, which is the expo-router scar.
 * What it does prove is the thing the aborted run could not: press that button
 * and the form appears.
 */

// WITHOUT THIS, `act()` WARNS AND DOES NOT PROMISE TO FLUSH, so a passing
// assertion would be luck about React 19's scheduling rather than a result.
// `quoteReaderNote.test.tsx` sets the same flag for the same reason. The first
// run of this file printed "The current testing environment is not configured
// to support act(...)" on every test while passing all six — the shape this
// repo keeps paying for, so it was fixed before the greens were believed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saveBidSpecSection = vi.fn();
const deleteBidSpecSection = vi.fn();

// The barrel reaches Prisma and Clerk, neither of which belongs in a rendered
// test. Mocked as a whole, with every member the component imports present —
// a partial factory would die on an access the component makes but this file
// never thought about, which is the trap 29 other suites here already hit with
// `@prova/integrations`.
vi.mock("@/lib/actions", () => ({
  acknowledgeBidAddendum: vi.fn(),
  deleteBidAddendum: vi.fn(),
  deleteBidSpecSection,
  saveBidSpecSection,
  deleteBidRequirement: vi.fn(),
  satisfyBidRequirement: vi.fn(),
  saveBidAddendum: vi.fn(),
  saveBidRequirement: vi.fn(),
  // `SpecFindings` reaches for these two; unused by these tests but they must
  // exist, or the component dies on an access this file never made.
  attachSpecSectionDocument: vi.fn(),
  readSpecSection: vi.fn(),
}));

vi.mock("@/lib/document-upload-client", () => ({ uploadDocumentFile: vi.fn() }));

const { BidCompliance } = await import("./BidCompliance");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

/** The empty bid the browser run was looking at: no addenda, no requirements,
 *  no spec sections — the state where the three "log a…" buttons are the whole
 *  panel. */
function renderEmptyBid() {
  act(() => {
    root.render(
      createElement(BidCompliance, {
        bidInvitationId: "bid_1",
        companyId: "co_1",
        addenda: [],
        requirements: [],
        specSections: [],
        lines: [],
        today: "2026-10-04",
      }),
    );
  });
}

/** Every button on the page, by its visible text. */
function buttonNamed(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  expect(found, `no button reading "${text}" — the page has: ${buttonTexts().join(" | ")}`).toBeTruthy();
  return found as HTMLButtonElement;
}

const buttonTexts = () =>
  [...host.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());

group("the spec section form opens on a real press", () => {
  it("offers the button on an empty bid, and it is a real button", () => {
    renderEmptyBid();
    const button = buttonNamed("Log a spec section");
    // `type="button"` matters and is not cosmetic: inside a form a default
    // submit button would submit instead of toggling, and React 19 resets a
    // `<form action={fn}>` before the action resolves — which is why
    // `formActionCensus.test.ts` fails the build over it.
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
  });

  it("A REAL CLICK renders the form, with the fields a person has to fill", () => {
    renderEmptyBid();

    // Nothing resembling the form before the press, so the assertion after it
    // cannot pass on something that was already there — the vacuous-watcher
    // trap, which fired in this repo on a needle already on the page.
    expect(host.querySelector('input[name="sectionNumber"]')).toBeNull();

    act(() => {
      buttonNamed("Log a spec section").click();
    });

    const section = host.querySelector('input[name="sectionNumber"]') as HTMLInputElement | null;
    expect(section, "pressing 'Log a spec section' rendered no sectionNumber field").toBeTruthy();
    expect(section!.required).toBe(true);
    expect(section!.placeholder).toBe("09 21 16");

    expect(host.querySelector('input[name="title"]'), "no title field").toBeTruthy();
    expect(host.querySelector('input[name="notes"]'), "no notes field").toBeTruthy();
    expect(buttonTexts()).toContain("Log section");
    expect(buttonTexts()).toContain("Cancel");
  });

  it("does not call the action merely by opening the form", () => {
    // Opening a form must cost nothing. The row the browser run left on
    // production exists because a save happened; an accidental save on open
    // would be a far worse version of that.
    renderEmptyBid();
    act(() => {
      buttonNamed("Log a spec section").click();
    });
    expect(saveBidSpecSection).not.toHaveBeenCalled();
  });

  it("Cancel closes it again", () => {
    renderEmptyBid();
    act(() => {
      buttonNamed("Log a spec section").click();
    });
    expect(host.querySelector('input[name="sectionNumber"]')).toBeTruthy();

    act(() => {
      buttonNamed("Cancel").click();
    });
    expect(
      host.querySelector('input[name="sectionNumber"]'),
      "Cancel left the form on screen",
    ).toBeNull();
  });

  it("opens the SPEC form, not one of its two neighbours", () => {
    // The three buttons sit side by side and set one piece of state between
    // them. A copy-paste that pointed the spec button at "addendum" would
    // render a form that looks plausible and is the wrong one — and the browser
    // run could not have caught it, because it never saw the page.
    renderEmptyBid();
    act(() => {
      buttonNamed("Log a spec section").click();
    });
    expect(host.querySelector('input[name="sectionNumber"]')).toBeTruthy();
    // The addendum form's own field, which must NOT be what appeared.
    expect(host.querySelector('input[name="reference"]')).toBeNull();
  });
});

group("the row renders the section number apart from the title", () => {
  it("keeps a gap between the number and the title", () => {
    // RAISED BY THE BROWSER RUN, which read the row as "09 21 16ZZ-TEST…" and
    // said it could not tell whether that was the page or its own text
    // extraction. It was the extraction: the two are separate spans and the
    // second carries `ml-2`, so there is a real gap on screen and no
    // whitespace TEXT NODE between them for `textContent` to pick up.
    //
    // Asserted structurally rather than by measuring, because happy-dom does
    // no layout and `getBoundingClientRect` returns zeros here.
    act(() => {
      root.render(
        createElement(BidCompliance, {
          bidInvitationId: "bid_1",
          companyId: "co_1",
          addenda: [],
          requirements: [],
          specSections: [
            {
              id: "spec_1",
              sectionNumber: "09 21 16",
              title: "Gypsum Board Assemblies",
              notes: null,
              fileName: null,
              hasFile: false,
              reading: null,
              readCount: 0,
            },
          ],
          lines: [],
          today: "2026-10-04",
        }),
      );
    });

    const number = [...host.querySelectorAll("span")].find(
      (s) => (s.textContent ?? "").trim() === "09 21 16",
    );
    const title = [...host.querySelectorAll("span")].find(
      (s) => (s.textContent ?? "").trim() === "Gypsum Board Assemblies",
    );
    expect(number, "the section number is not its own element").toBeTruthy();
    expect(title, "the title is not its own element").toBeTruthy();
    expect(number).not.toBe(title);
    // The gap is a margin on the title, which is the same pattern the addendum
    // and bid-form rows in this file already use — so this is consistency,
    // not a fix applied to one row.
    expect(title!.className, "the title carries no left margin").toContain("ml-2");
  });
});

group("every finding says how sure it is", () => {
  /** One reading carrying all three confidence values. */
  const threeFindings = [
    {
      ordinal: 1,
      kind: "FIRE_RATING" as const,
      label: "UL U465 2-hour",
      requirement: "Rated partitions shall comply with UL U465.",
      whyItCosts: "Listed detailing and firestopping at every penetration.",
      confidence: "HIGH" as const,
      quote: "Rated partitions shall comply with UL U465, 2-hour rating.",
      sourcePageLabel: "Page 3",
    },
    {
      ordinal: 2,
      kind: "ATTIC_STOCK" as const,
      label: "2% attic stock",
      requirement: "Deliver 2 percent of each panel type.",
      whyItCosts: "Extra board bought, delivered and stored.",
      confidence: "MEDIUM" as const,
      quote: "Deliver to Owner 2 percent of each type of gypsum panel installed.",
      sourcePageLabel: "Page 1",
    },
    {
      ordinal: 3,
      kind: "GENERAL" as const,
      label: "Installer experience",
      requirement: "Five years of experience with work of this scope.",
      whyItCosts: "Limits who may perform the work.",
      confidence: "LOW" as const,
      quote: "Installer shall have five years experience with work of this scope.",
      sourcePageLabel: "Page 2",
    },
  ];

  function renderWithReading() {
    act(() => {
      root.render(
        createElement(BidCompliance, {
          bidInvitationId: "bid_1",
          companyId: "co_1",
          addenda: [],
          requirements: [],
          specSections: [
            {
              id: "spec_1",
              sectionNumber: "09 21 16",
              title: "Gypsum Board Assemblies",
              notes: null,
              fileName: "section.pdf",
              hasFile: true,
              reading: {
                id: "read_1",
                readOn: "2026-10-04",
                pagesCharged: 3,
                readingReason: "Read the full three-page section.",
                findings: threeFindings,
              },
              readCount: 1,
            },
          ],
          lines: [],
          today: "2026-10-04",
        }),
      );
    });
    const details = host.querySelector("details") as HTMLDetailsElement;
    act(() => {
      details.open = true;
    });
  }

  it("shows a CONFIDENCE WORD for all three levels, not just LOW", () => {
    // THE DEFECT THE CLICK-THROUGH FOUND, AND THAT NO TEST HERE COULD SEE.
    //
    // Only LOW used to render a badge. The #604 run came back with nine
    // findings, every one MEDIUM or HIGH, so the screen showed no confidence
    // anywhere — and the tester reported step 4b as UNVERIFIABLE, because there
    // was nothing on the page to order.
    //
    // The eval cannot catch this: it reads the `confidence` FIELD, which was
    // correct the whole time. This asserts the word reaches the DOM, which is
    // the only place the defect ever lived.
    renderWithReading();
    const text = host.textContent ?? "";
    expect(text, "no word for HIGH").toContain("clear in the section");
    expect(text, "no word for MEDIUM").toContain("worth checking");
    expect(text, "no word for LOW").toContain("least sure");
  });

  it("orders lowest confidence FIRST, and that is now checkable on screen", () => {
    // Step 4b, finally answerable. `sortFindingsForReview` has its own unit
    // test; this is the order a person actually sees.
    renderWithReading();
    const text = host.textContent ?? "";
    expect(text.indexOf("least sure")).toBeLessThan(text.indexOf("worth checking"));
    expect(text.indexOf("worth checking")).toBeLessThan(text.indexOf("clear in the section"));
  });

  it("says the pages were CHARGED, matching the promise made before the press", () => {
    renderWithReading();
    expect(host.textContent ?? "").toContain("3 pages charged");
  });
});
