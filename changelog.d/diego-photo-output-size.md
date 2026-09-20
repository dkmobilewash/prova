### A stamped site photo is about 1200px, not 3600 (Diego)
`diego/photo-output-size`

The capture size is asked for in POINTS and the screen's density multiplies
it: asking for 1200 on a 3x phone produced a 3600x4800, 3.6MB file, measured
on a photo taken on production. One photo was then most of the platform's
4.5MB request cap — which is how an earlier, uncapped capture came back
"Upload failed (413)".

The width is divided by the device pixel ratio before it is asked for, so
the file lands at about 1200px whatever the phone, and the quality is 0.85.
