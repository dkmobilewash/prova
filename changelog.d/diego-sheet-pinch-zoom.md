### A pin on an unzoomed sheet is accurate to about ten feet (Diego)
`diego/sheet-pinch-zoom`

No migration. A full-screen Modal, native zoom, and one definition of a tap.

**MEASURED BEFORE BUILDING ANYTHING, and the number is why this came before
capture-in-place rather than after it:**

| | |
| --- | --- |
| a D-size sheet | 42in wide |
| rendered inline | ~350pt |
| a gloved fingertip | ±8-10pt |
| on paper | ≈1.2in |
| **in the building at 1/8in = 1ft** | **≈10 feet** |
| at 1/4in = 1ft | ≈5 feet |

That locates a room, not a wall. A foreman handed a ten-foot circle twice stops
using the feature — so making it FASTER to drop a vague pin would have been
optimising the wrong thing. Zoom is what makes a pin worth placing at all.

**THE STATED REASON FOR NOT HAVING IT WAS STALE.** The screen said *"zoom needs
a gesture library this app does not carry"*. `react-native-gesture-handler@3.3.0`
and `react-native-reanimated@4.6.0` are both on disk as transitive deps — and
neither is used anyway: **iOS ScrollView zooms natively** through
`maximumZoomScale`. `components/PressableScale.tsx` made the same call for the
same reason ("no reanimated, no new dependency").

**WHY A MODAL AND NOT A ZOOMABLE VIEW IN PLACE.** The page is already a vertical
ScrollView, so a zoomable one inside it is same-axis nesting and the pan belongs
to whichever wins. A Modal has no parent scroll view, so there is nothing to
fight — and the drawing gets the whole display rather than the ~250pt strip it
had, which is most of the accuracy win before anybody pinches.

**ONE DEFINITION OF THE TAP.** Both surfaces call `place()`. Two copies is how
the inline sheet and the full-screen one start disagreeing about where a pin
goes, and a pin that lands somewhere else is worse than no pin — the census
asserts exactly one `locationX /` in the file and **caught a second copy during
this work**, left behind when an edit to the inline handler did not survive a
later line-insertion.

| mutation | result |
| --- | --- |
| control | green |
| zoom removed | **RED** |
| the tap maths copied back inline | **RED** |
| `y` divided by HEIGHT instead of width | **RED** |
| the whole full-screen view deleted | **RED** |

**WHAT NO TEST HERE CAN SAY.** Whether anything zooms, and whether a pin lands
under the finger once it does. happy-dom has no layout and no pinch. The
assumption the whole thing rests on is written at the call site: `locationX` is
expected to arrive in the content view's OWN coordinate space, unaffected by
the zoom transform, which is what makes `place()` correct at any zoom with no
maths. **If a pin lands elsewhere when zoomed, that is the line to change** —
divide by `width * zoomScale`. It needs a device.

The strings census also earned itself: it failed on a key I added and never
used, which is a sentence nobody wrote on purpose. Dropped rather than wired up.

44 files / 360 tests and 16 files / 78 tests, both mobile suites, `expo lint`
clean. **Unverified on a device, and build 15 is still not through Apple.**
