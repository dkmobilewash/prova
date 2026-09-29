import { HeaderHomeButton } from "@/components/HeaderHomeButton";

/**
 * The way out of a screen a notification cold-started, as LAYOUT options.
 *
 * **Read this before moving it back into a screen.** #548 and its follow-up
 * both put `<Stack.Screen options={{ headerLeft }} />` inside the screen
 * component. Both shipped. Both did nothing on a real phone, and no test in
 * this repo could see it — the code was written, it ran, and React
 * Navigation discarded it.
 *
 * The mechanism, read out of the installed expo-router 57.0.21 rather than
 * guessed: `Stack.Screen` is TWO components wearing one name. In a layout
 * its props are read by the navigator. Inside a page it renders and
 * delegates to `views/Screen`, which calls `navigation.setOptions` from a
 * layout effect behind a guard —
 *
 *     const isFocused = navigation.isFocused();   // read at render, NOT subscribed
 *     if (!isPreloaded || (isPreloaded && isFocused)) navigation.setOptions(options)
 *
 * — and a cold deep-link launch is exactly where focus and preload state are
 * unsettled. `StackScreen.js` says the same thing twice more in its own
 * source: it warns that "function-form options are not supported inside page
 * components", and its docstring tells you to prefer `Stack.Title` /
 * `Stack.Header` for page-level header config.
 *
 * Meanwhile `title`, set from the layout, rendered correctly on the very
 * same screen. So the layout is the mechanism that demonstrably works here,
 * and this is the same lever `title` already pulls.
 *
 * Kept PURE and kept out of the layout file so the decision can be tested
 * without a navigator, a phone or a simulator — which is the whole reason
 * this defect survived two releases.
 */
export function wayHomeOptions(navigation: { canGoBack: () => boolean }) {
  // A WARM tap pushed this on top of real history, and that Back is the
  // right way out. Two competing exits from one screen is its own small
  // confusion, so this adds nothing when the stack can already answer.
  if (navigation.canGoBack()) return {};

  // Nothing behind it: no back chevron, and outside `(tabs)` there is no
  // tab bar either. Without this the screen is a room with the door
  // bricked up — which is exactly how it was reported from a phone.
  return { headerLeft: () => <HeaderHomeButton /> };
}
