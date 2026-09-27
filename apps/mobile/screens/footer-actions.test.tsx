import { beforeEach, describe, expect, it } from "vitest";
import { Button } from "@/components/Button";
import { FooterActions } from "@/components/FooterActions";
import { mount } from "./render";

/**
 * The bottom bar puts the primary on its own row once there is more than one
 * secondary — the fix for "Log time" rendering 40pt wide with no label on a
 * real iPhone, 2026-09-26.
 *
 * WHAT THIS TEST CAN AND CANNOT PROVE, because the difference matters more
 * than the assertions. It CANNOT measure a width: happy-dom does no layout and
 * returns zeros from `getBoundingClientRect`, which is the entire reason the
 * defect reached a phone with every suite green. The 40pt was measured off the
 * device, and the fix was measured in real Chromium with that number as its
 * control — neither of those lives here.
 *
 * What it CAN prove is STRUCTURE, and structure is what the fix changed: at
 * two secondaries the primary stops being a sibling of them. That is a real
 * assertion about a real decision, and it goes red if somebody flattens the
 * component back into one row — which is the regression that matters, because
 * the flattened version looks correct in every test in this repo.
 *
 * `lib/footer-actions-census.test.ts` is the other half: this proves the
 * component is right, that one proves nothing has quietly stopped using it.
 */

/** The row a node sits in, identified by its parent chain — enough to answer
 * "are these two in the same row?" without asking for any geometry.
 *
 * `mount` appends a fresh container per call and never removes it, so without
 * the reset below this reads a node from a PREVIOUS test — which is the
 * vacuous-watcher shape CLAUDE.md describes, a needle already on the page. */
function parentOf(label: string): Element | null {
  const node = Array.from(document.querySelectorAll("*")).find((n) => n.textContent === label);
  return node?.parentElement?.parentElement ?? null;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the footer's primary action", () => {
  it("shares a row with a single secondary — the photos and reports case", async () => {
    // Confirmed fine on a real phone the same night, so this is the shape that
    // must NOT change: one secondary beside a primary is not the defect.
    await mount(
      <FooterActions secondary={[<Button key="a" variant="secondary">Library</Button>]}>
        <Button fullWidth>Take photo</Button>
      </FooterActions>,
    );
    expect(document.body.textContent).toContain("Library");
    expect(document.body.textContent).toContain("Take photo");
    expect(parentOf("Library"), "one secondary should stay beside the primary").toBe(parentOf("Take photo"));
  });

  it("takes a row of its own once there are two secondaries — the time case", async () => {
    // The exact three labels that shipped the bug.
    await mount(
      <FooterActions
        secondary={[
          <Button key="a" variant="secondary">Sign the day</Button>,
          <Button key="b" variant="secondary">Hand phone over</Button>,
        ]}
      >
        <Button fullWidth>Log time</Button>
      </FooterActions>,
    );
    expect(document.body.textContent).toContain("Log time");
    // The two secondaries still share their row with each other...
    expect(parentOf("Sign the day")).toBe(parentOf("Hand phone over"));
    // ...and the primary is no longer in it, which is the whole fix. Flatten
    // the component back to one row and this is the assertion that goes red.
    expect(
      parentOf("Log time"),
      "the primary is back in the secondaries' row, where two labels crush it to 40pt",
    ).not.toBe(parentOf("Sign the day"));
  });

  it("renders the primary alone when there is no secondary at all", async () => {
    await mount(
      <FooterActions>
        <Button fullWidth>Add order</Button>
      </FooterActions>,
    );
    expect(document.body.textContent).toContain("Add order");
  });
});
