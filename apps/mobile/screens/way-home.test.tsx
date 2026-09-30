import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { WayHome } from "@/components/wayHome";
import { setCanGoBack } from "./setup";
import { mount } from "./render";

/**
 * The way out of a screen a notification cold-started.
 *
 * **This is the first version of this test that can fail for the real
 * reason.** Three previous fixes put the control in the header, and every
 * test written for them asserted that a screen RECORDED a `headerLeft`
 * option — which it did, in a mock, while React Navigation discarded the
 * real one. Three releases shipped green.
 *
 * A view in the screen body is rendered by React, so "is there a control"
 * is a question this suite can actually answer: mount it and look for the
 * pressable. That is the whole reason the control moved.
 *
 * What this still cannot see is LAYOUT — happy-dom does no layout and
 * returns zeros from `getBoundingClientRect`, so the 56pt target is a token
 * (`hitTargetPrimary`) checked by `touch-targets.test.ts`, never measured
 * here.
 */

beforeEach(() => {
  vi.mocked(router.replace).mockClear();
  vi.mocked(router.push).mockClear();
  document.body.innerHTML = "";
});

describe("the way home", () => {
  it("renders a pressable Home control", async () => {
    setCanGoBack(false);
    const screen = await mount(<WayHome />);

    expect(screen.text()).toContain("Home");
    const node = document.querySelector('[role="button"][aria-label="Home"]');
    expect(
      node,
      "a cold notification tap leaves no back chevron and no tab bar — without this the screen is a dead end",
    ).toBeTruthy();
    screen.unmount();
  });

  it("renders nothing when the stack can already go back", async () => {
    // The control, and the half that keeps the fix from applying itself
    // everywhere: a WARM tap pushed this on top of real history and the
    // native chevron is the right way out. Two exits from one screen is its
    // own small confusion.
    //
    // This assertion is only safe because the one ABOVE exists. Together
    // they pin both directions, which is what makes a conditional control
    // defensible after three releases of one that rendered nothing —
    // "hides when it should not" now fails in node rather than on a phone.
    setCanGoBack(true);
    const screen = await mount(<WayHome />);

    expect(
      document.querySelector('[role="button"][aria-label="Home"]'),
      "offered a second way out on a screen that already had a back chevron",
    ).toBe(null);
    screen.unmount();
  });

  it("leaves rather than stacking, so the dead end is not kept underneath", async () => {
    setCanGoBack(false);
    const screen = await mount(<WayHome />);

    // The BUTTON, not the first node whose text happens to match. On a tree
    // this small the whole document's text IS the label, so a textContent
    // search returns <html>, and clicking that bubbles upward and never
    // reaches the control — a green test asserting on an event that never
    // fired. react-native-web gives the control role + aria-label.
    const node = document.querySelector('[role="button"][aria-label="Home"]');
    expect(node).toBeTruthy();
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(vi.mocked(router.replace)).toHaveBeenCalledWith("/(tabs)");
    expect(
      vi.mocked(router.push),
      "pushed Home on top of the screen the person was trying to escape",
    ).not.toHaveBeenCalled();
    screen.unmount();
  });
});
