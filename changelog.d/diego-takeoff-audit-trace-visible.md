### Tracing a wall is visible at every step

Reported from the workspace: "I press t, click the start of a wall, and there
is no visual change at all, so I can't tell where the wall will go or whether
trace mode is even on."

**Three causes, all real:**

The `t` shortcut lived in `AnswerKeyPanel`, and that panel is only rendered
once there are candidates — so before Find the walls had run, the key did
nothing whatever and nothing said why. It is handled in the viewer now, which
is mounted whenever answer-key mode is on. The panel keeps its button.

The pending wall was drawn inside the `overlaysOn` gate, so a reviewer who had
pressed `h` to clear the sheet and then started tracing saw nothing at all.
Tracing is an action, not an overlay of results, and is no longer gated.

And there was nothing to see before the first click: no banner, no cursor
change, no snap point.

**Now:** a banner over the plan says what to do next — "click the start", then
"click the end", then "Press Enter to add" — the cursor is a crosshair, a
circle shows where the next click will snap to, the line follows the pointer
from the start with its length in feet and inches beside it, and Enter confirms
with "Wall added, 89'-0"". Every size is in screen pixels, converted through
the rendered width, so a dot is a dot at any zoom.

**Proved by photographing it, and the photographs are why it is right.** The
first run was green with every assertion passing and was worthless: it had
traced a wall on G101, the cover sheet, because `?page=9` falls back to the
first sheet while that page has no calibration row — and the trace tool works
perfectly on a cover sheet. Looking at the image also showed the confirmation
and the next prompt drawn on top of each other, each "visible" to Playwright on
its own. The spec now asserts which sheet it is on before taking any shot.

`e2e/specs/takeoff-trace-shots.spec.ts` drives it in a real browser and writes
five images, one per step, outside the repository — the drawing is a client's,
read in place from `REAL_PLAN_DIR`, never copied in. It skips without that
folder rather than passing on nothing.

A fourth defect came from the design census rather than the screen: the
confirmation banner named `bg-tag-green-bg`, which this palette does not
define, so Tailwind emitted nothing and it rendered with no background at all.
