### Arrows on a photo now point at the same thing on every screen, the GC's included (Diego)
`claude/prova-company-cam-feature-6170v6` — issue #256

Somebody drew an arrow at a crack on a photo, and on the gallery thumbnail
and on the GC's portal that arrow sat somewhere else on the picture. Only on
photos that are not 4:3 — which is almost every phone photo — and worse the
further from the centre of the frame and the larger the card. The one thing
this whole feature has to guarantee is that the client's screen agrees with
the screen the sub was looking at when they decided to show it, and on the
client-facing page it did not.

**#256 named the mechanism correctly and rested it on a false premise, and
that premise is in every comment in the codebase that described the
coordinate space — eight sentences across four files. Those comments are why
it shipped.** The issue opens "annotation coordinates are fractions of the
image (0..1)". They are not, and never have been: the editor's `surfaceRef`
is a hard-coded 4:3 `<div>`, so a pointer becomes a fraction of THAT. What
the issue then says is right — all four surfaces use the same 4:3 box and
all four passed `4 / 3` to the overlay, and what differed was the FIT. The
editor and the printed report letterbox the photograph inside that box
(`object-contain`); the gallery card and the portal cropped it to fill
(cover). Same box, same fractions, different part of the picture underneath
them. Re-verified here before building on it rather than inherited.

One more thing the issue understated, and it is the reason this is not
cosmetic: it says the mark "sits slightly off". Measured, it is up to 89px
on a 560px-wide card — about a fifth of the box's diagonal.

The editor's `aspect()` helper had a comment saying it returned "the photo's
own ratio" — it returned 4/3 for every photograph ever taken — and the
gallery's said "the editor measures the real photo instead". Those, the
editor's own file header, its `pointAt` doc, the card's type doc, the
overlay's own comment and the Prisma column comment all told the next reader
the geometry was already handled.
None of them was checked by anything, and they are all corrected here.

**What we did: brought the renderers to the coordinates, not the other way
round.** The marks are fractions of the presentation box, so every surface
letterboxes the photo into that box, and the `aspect` prop is gone — the
ratio is one exported constant the overlay owns, because four callers
restating a constant is four chances to disagree about it.

The alternative was to make the marks genuinely image-relative and teach the
overlay where a cropped photo actually sits. Rejected, and not on cost: **the
rows already in the database are box fractions, and nothing stores an
intrinsic size to convert them with.** Reinterpreting them would silently
move every mark anybody has ever drawn, on records this schema treats as
evidence — sent correspondence that closes and never deletes. It would also
need the photo's dimensions on three server components, two of which are the
portal and the printed report.

What it costs, said plainly because it is on every thumbnail: a non-4:3
photo now letterboxes in the gallery and the portal, bars on the slate-950
ground the box already had. The grid does not move, because the box is still
4:3. A gallery of evidence showing the whole frame beats a centre crop
anyway — the same call `/jobs/[id]/photo-report` already made for paper.

**Measured, not argued.** A target block is burned into a test photograph at
a known fraction of the image; a headless Chromium renders the real class
strings, read out of the source files rather than copied; a screenshot gives
the centroid of the target and the centroid of a mark placed where the
editor's own arithmetic would have stored it. Displacement between them, in
CSS pixels:

| photo | cell | before | after |
| --- | --- | --- | --- |
| 16:9 | 343px (phone) | 31.1px | 0.5px |
| 16:9 | 560px | 51.2px | 0.2px |
| 3:4 portrait | 343px (phone) | 54.6px | 0.6px |
| 3:4 portrait | 560px | 88.8px | 0.1px |
| 4:3 control | either | 0.0px | 0.0px |

Identical figures on the gallery and the portal, as they should be. The 4:3
control reading 0px before the fix is the whole reason this survived review:
on a photo shaped like the box there was nothing to see. The sub-pixel
residual after is the harness's own floor — the annotator, which is the
reference surface and was never wrong, reads the same 0.5px at 343px, where
the box is 343×257.25 and a screenshot has to round.

The guard is `components/jobMediaMarkSurfaces.test.ts`: every file rendering
the overlay uses a 4:3 box, letterboxes the photo, and passes no ratio.
A unit test cannot see any of this — happy-dom does no layout and returns
zeros from `getBoundingClientRect` — so it checks the two class-level facts
the measurement established instead, and says so. The set of surfaces it
checks is asserted against a literal list, so a fifth surface fails until
somebody measures it and a pattern matching nothing fails instead of passing
vacuously. Six mutations, six reds: crop the card, crop the portal, move the
editor's box to 16:9, hand a ratio back to the overlay, break the scan so it
finds nothing, add an unmeasured fifth surface.

**Not verified from here**: nobody has clicked this in a browser against
real data. The measurement is of the geometry, in real Chromium, against the
app's own class strings — it is not a click-through of `/photos`, a job
page, or a portal link, and the click-list in the PR is what covers that.
Video and voice notes need nothing: both were already letterboxed in the
same box, and only photos are offered the mark-up button.
