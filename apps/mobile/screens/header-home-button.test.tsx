import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { HeaderHomeButton } from "@/components/HeaderHomeButton";
import "./setup";
import { mount } from "./render";

/**
 * The door out of `/alerts` when a cold notification tap left no back
 * chevron behind it.
 *
 * `replace` and not `push`, which is the only interesting assertion here:
 * leaving this screen is LEAVING it, and a `push` would stack Home on top
 * of an alert list the person already could not get out of — the same
 * reason `handover.tsx` replaces rather than pushes. `(tabs)` rather than
 * a bare path because that is what restores the tab bar, which is the
 * other half of what was missing: from Home, Jobs is one tap away.
 */

beforeEach(() => {
  vi.mocked(router.replace).mockClear();
  vi.mocked(router.push).mockClear();
  document.body.innerHTML = "";
});

/**
 * The BUTTON, not the first node whose text happens to be the label.
 *
 * Searching `querySelectorAll("*")` for `textContent === label` — which is
 * what the other screen tests do — returns `<html>` here, because on a tree
 * this small the whole document's text IS the label. Clicking that bubbles
 * upward and never reaches the button nested below it, so the press silently
 * does nothing while the helper looks like it worked. react-native-web gives
 * the control `role="button"` and an `aria-label`, so ask for that.
 */
function press(label: string): void {
  const node = document.querySelector(`[role="button"][aria-label="${label}"]`);
  expect(node, `no button labelled "${label}"`).toBeTruthy();
  node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the header's way home", () => {
  it("says Home, and goes there", async () => {
    const screen = await mount(<HeaderHomeButton />);
    expect(screen.text()).toContain("Home");

    press("Home");
    expect(vi.mocked(router.replace)).toHaveBeenCalledWith("/(tabs)");
  });

  it("replaces rather than pushes, so the dead end is not kept underneath", async () => {
    await mount(<HeaderHomeButton />);
    press("Home");
    expect(
      vi.mocked(router.push),
      "pushed Home on top of the screen the person was trying to escape",
    ).not.toHaveBeenCalled();
  });
});
