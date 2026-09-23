### A stamped site photo really is about 1200px now (Diego)
`diego/photo-output-size-2`

#371 tried to stop the phone storing a 3600px, 3.6MB photo and did not
work, because it fixed the wrong thing. `ViewShot`'s `width`/`height`
options do not resize the capture: what decides the output is the
rendered view's size in POINTS multiplied by the screen's density, so
asking for 1200 while laying the view out at 1200 points still produced
1200 x 3 = 3600 pixels on a 3x phone. Most of Vercel's 4.5MB request cap
went on one photo, and a camera photo at full density was refused with a
413.

So the layout itself is now the small one: the stamp view is laid out at
`STAMP_WIDTH / density` points and its padding and type are scaled by the
same ratio, which lands the capture at 1200 pixels on any phone with the
stamp the same size relative to the picture.

Measured on production against ZZQB-TEST rather than argued, because the
last fix looked right and was not: the photo saved before this change is
3600x4800 and 3,712 KB, the one saved after it is **1200x1599 and 552 KB**,
with the stamp — job, shutter time, coordinates and accuracy — still
burned in and readable. The caption went up with it.

Worth recording how #371 came to look ineffective, since it cost an hour:
the phone had silently lost its connection to Metro. Touching a source
file produced no rebundle and a reload broadcast did nothing, so the app
kept running the bundle it launched with. A dev build that "doesn't pick
up the change" is that until proven otherwise — check the packager log
for a bundle line before concluding anything about the code.
