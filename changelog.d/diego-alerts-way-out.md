### The alerts screen was a room with the door bricked up (Diego)
`diego/alerts-way-out`

Reported from a phone on 2026-09-28, in the same minute the push chain was
first proved working end to end: *"once the alerts page opens that is the
only page that is available, there is no option to return to the home or
other jobs."* **No schema change, no migration.**

**Why this screen and no other.** `/alerts` is the one screen in the app
with no route into it except a notification tap — no tab, no link, no
button anywhere, which `push.ts` is the sole owner of. Every other pushed
screen has a back chevron because you reached it from inside the app.
This one is reached from OUTSIDE it, and a tap that launches the app COLD
leaves it as the only entry on the stack: nothing behind it to go back to,
and no tab bar either, because it lives outside `(tabs)`. You could read
your alerts and then nothing, until you force-quit.

**It could only have been found this way.** The screen had never been
opened by anybody before that tap — it is unreachable without a push, and
no push had ever arrived (see `diego-push-after-response`). So the first
person ever to see this screen was also the first person to be trapped on
it, about ten seconds later.

**The fix is conditional, and the condition is the point.** A WARM tap
pushes this on top of whatever the person was doing, and that Back is the
right way out; adding a second one would be two competing exits from one
screen. So the screen asks `router.canGoBack()` and only supplies a way
home when there genuinely is not one. `HeaderHomeButton` uses `replace`
rather than `push`, matching `handover.tsx` — leaving is leaving, and a
push would stack Home on top of the screen the person was trying to
escape. `(tabs)` restores the tab bar, which is the other half of the
complaint: from Home, Jobs is one tap away.

**Mutation-tested three ways, and each reds only what it should:**

| | change | red |
| --- | --- | --- |
| M-A | the fix removed — no way home ever | "offers a way home", control stays green |
| M-B | offered always, overriding a good Back | "leaves the ordinary Back alone" |
| M-C | `push` instead of `replace` | both header-button tests |

**Two traps found while writing the tests, both worth more than the fix.**

The screen suite's `expo-router` mock had no `canGoBack`, so four existing
alerts tests went red the moment the screen asked for it. It defaults to
TRUE — the ordinary in-app case — so a test wanting the stranded one asks,
and no other screen's header changes underneath it.

And the press helper every screen test copies is **unsound on a small
tree**. It takes the first element whose `textContent` equals the label,
which for a one-control screen is `<html>`: the whole document's text IS
the label. Clicking that bubbles upward and never reaches the button
nested below, so the press does nothing while the helper looks like it
worked — a green test asserting on an event that never fired. The other
screens get away with it only because their pages have more text on them.
`header-home-button.test.tsx` asks for `[role="button"][aria-label]`
instead and says why, because the next small screen will hit this too.

**Not claimed:** the fix has not been seen on a phone. It ships in the
next TestFlight build, and the check is one tap — open a notification cold
and confirm there is a way back to Home.
