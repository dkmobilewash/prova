### The doors and windows on a found wall are read off the drawing and proposed (Cyrus)
`feat/takeoff-accuracy`

Openings were typed by hand, width and height, while the drawing already
shows every one. Each found-walls group now says "2 doors and 1 window drawn
in these walls — add them": the width is measured jamb to jamb from the wall's
own faces, the height is left blank for the estimator (a plan does not carry
one, and nothing in the app has a default), and rows with a height go onto the
priced wall run through the same fields the typed rows use — so the shop's
opening-deduction answer applies unchanged. Geometry only, no model call, and
nothing is proposed without evidence: a swing hinged at the jamb, or glazing
between two jamb lines.

Measured against the bench model's own openings: 925 of 1,029 proposed with
zero false ones on the main set, 363 of 466 with one on the held-out plans.
Wall footage is byte-identical before and after. No wall-finder change shipped:
the missed exterior footage on real buildings is not reproducible on the bench
in this container, and NOTES.md says why rather than guessing a rule.
