/**
 * The haptics seam. Deliberately a no-op stub: expo-haptics is not
 * installed, and installing it needs Diego's terminal (the sandbox cannot
 * reach the registry) plus a dev-client rebuild. The call sites exist so
 * the wire-up later is one function body, not a sweep of every screen.
 *
 * When expo-haptics lands: fill these with
 * `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` and
 * `Haptics.selectionAsync()`, and add `vi.mock("expo-haptics", …)` to
 * screens/setup.tsx.
 */

/** A tap that changed something — punch toggle, sign-off, capture open. */
export function impact(): void {
  // no-op until expo-haptics lands
}

/** A selection that moved — chip pick, segment switch. */
export function selection(): void {
  // no-op until expo-haptics lands
}
