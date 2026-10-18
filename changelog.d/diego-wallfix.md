### The drawing gets the screen back (Diego)
`diego/wallfix`

Pressing **Find the walls** put its results in a panel ABOVE the sheet, and the
sheet's frame reserved a fixed band of height for that panel whether it was
there or not. With six thickness groups showing, the panel took the top half of
the screen and the drawing was left a short strip.

That strip is the problem, and not for the reason it looks. **Fit** scales a
sheet to fit BOTH dimensions, so a frame that is wide and short shows a SMALL
drawing and leaves the width beside it empty. A real click-through landed at
11% zoom with a third of the screen black — the sheet was not too narrow, it
was too short, and the wasted width was the symptom rather than the cause.

That is backwards for a feature whose entire verification step is LOOKING at
the drawing. The found walls are a claim; the sheet is the only thing that can
check it. So on a wide screen they now sit side by side and the drawing takes
what is left, which is most of it. Narrow screens keep the stack, where a
column each would make both unusable.

Measured in real Chromium with the actual class strings, because no test in
this repo can see layout — the screen suite renders in happy-dom, which does no
layout and returns zeros from `getBoundingClientRect`:

| viewport | fit zoom before | after |
| --- | --- | --- |
| 1512px | 25% | **34%** |
| 1280px | 25% | **29%** |
| 1024px and below | 25% | unchanged, by design |

The frame goes from 1480x548 — an aspect of 2.7 against a sheet whose aspect is
1.4 — to 1100x724, so the drawing renders about a third larger and the dead
space is gone.

One class was written and then deleted. A flex child's default minimum width
would normally force `min-w-0` on the frame, and the measurement says otherwise:
identical boxes at every width with and without it, because `overflow-auto`
already establishes a scroll container and resets that floor. Unreachable code
shaped like a safeguard is worse than none.

The render test added with this cannot see any of the above and says so in its
own header. What it can prove is the structure those numbers depend on: the
panel and the plan port are siblings in one row. Un-nest them and the
measurement stops describing the app, silently, because nothing else here would
notice.
