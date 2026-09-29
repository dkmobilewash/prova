import { describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { wayHomeOptions } from "@/components/wayHome";
import "./setup";
import { mount } from "./render";

/**
 * The decision behind the way out of a cold notification tap.
 *
 * **This test exists because the previous two attempts were untestable and
 * both shipped broken.** #548 and its follow-up put
 * `<Stack.Screen options={{ headerLeft }} />` inside the screen component.
 * The code was written, it ran, and React Navigation discarded it on a cold
 * launch — and nothing here could see that, because the only instrument was
 * a phone. Two releases went out claiming a fix that did nothing.
 *
 * Moving the decision into a PURE function is the whole point: what to
 * render is now answerable in node, and only the delivery (a layout option)
 * needs a device. The census in `lib/push-destination-exit.test.ts` covers
 * the delivery half structurally.
 */

describe("the way home, as an options fragment", () => {
  it("adds nothing when the stack can already go back", () => {
    // The control, and the half that stops the fix applying itself
    // everywhere: a WARM tap pushed this on top of real history and that
    // Back is the right way out. Two exits from one screen is its own
    // confusion. Without this, `headerLeft` unconditionally would pass.
    expect(wayHomeOptions({ canGoBack: () => true })).toEqual({});
  });

  it("offers a header button when there is nothing behind the screen", () => {
    const options = wayHomeOptions({ canGoBack: () => false });
    expect(
      "headerLeft" in options,
      "a cold notification tap leaves no back chevron and no tab bar — without headerLeft the screen is a dead end",
    ).toBe(true);
    expect(typeof (options as { headerLeft: unknown }).headerLeft).toBe("function");
  });

  it("renders a Home button that replaces rather than pushes", async () => {
    // `replace`, not `push`: leaving here is LEAVING, and a push would
    // stack Home on top of the screen the person was trying to escape.
    vi.mocked(router.replace).mockClear();
    vi.mocked(router.push).mockClear();

    const options = wayHomeOptions({ canGoBack: () => false }) as {
      headerLeft: () => React.ReactElement;
    };
    const screen = await mount(options.headerLeft());
    expect(screen.text()).toContain("Home");

    const node = document.querySelector('[role="button"][aria-label="Home"]');
    expect(node, "the way home rendered no pressable control").toBeTruthy();
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(vi.mocked(router.replace)).toHaveBeenCalledWith("/(tabs)");
    expect(
      vi.mocked(router.push),
      "pushed Home on top of the screen the person was trying to escape",
    ).not.toHaveBeenCalled();
    screen.unmount();
  });
});
