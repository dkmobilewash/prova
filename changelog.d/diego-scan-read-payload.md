### Read this sheet failed on the sheets it exists for, and said nothing

A browser tester reached the button — #802 made it reachable — pressed it, and
watched **"Reading the sheet…" for three minutes** with no message, no error
and no result. The network panel showed **one request pending for ~100 seconds
and then a 503**, and **two POSTs where there should have been nine**.

Three separate defects, each measured rather than reasoned about.

**ONE — a scanned tile does not fit in a Server Action.** The body is capped
at 1 MB unless `next.config.mjs` says otherwise, and nothing said otherwise.
Measured on the committed fixtures, biggest tile of each sheet, base64:

| sheet | PNG | JPEG q90 |
| --- | --- | --- |
| S18, clean | 0.08 MB | — |
| S20, light speckle | 0.77 MB | 0.46 MB |
| S19, speckled | **1.20 MB** | **0.54 MB** |

**Speckle is what breaks PNG, and speckle is what a scan is made of** — so
this worked on every clean sheet and failed on every real one, which is the
worst possible way round. Tiles are JPEG now, which halves the worst case, and
the limit is stated in the config rather than inherited.

**TWO — the action's own guard was above the ceiling.** It refused an image
over 7 MB, copied from the wall classifier, while the framework refused at 1.
A guard above the real limit is not a guard: its readable sentence was
unreachable, which is why the page had nothing to say.

**THREE — the route's budget was shorter than the model client's own
timeout.** `AI_CLIENT_OPTIONS` waits 120 seconds; the route ended the whole
invocation at 60. The deadline meant to expire FIRST and report why could
never run, and a killed invocation writes no log line at all. **This is the
same failure #793 fixed for wall detection, in the same file, and its own
comment describes the symptom exactly** — *"the browser got a 503 — the
platform ended the invocation"*. Raised to 300, which puts the ceiling above
the SDK's timeout; wall detection still stops itself well inside the old 60.

**And the button must never spin forever.** The action returns a readable
refusal for everything it can SEE, but a request the platform ends never
reaches it. The call is wrapped on the page now, and a long run reports
**"Reading the sheet — 3 of 9 parts…"**, because a button that only says
"Reading…" is indistinguishable from one that has died — which is precisely
how this was reported.

`tilePayload.test.ts` pins all of it without calling a model: the format, the
stated limit, the guard being BELOW it, the route budget exceeding the
client's timeout, the catch, and the progress line.

**JPEG costs nothing, and that was measured rather than hoped.** The obvious
worry about compressing a drawing is that it softens the lettering the model
has to read, so the eval was re-run sending exactly what the page now sends:

| | PNG | JPEG q90 |
| --- | --- | --- |
| printed strings read exactly | 101 of 101 | **101 of 101** |
| placed within the 30pt the pairing allows | 99 (98%) | **99 (98%)** |

Identical, per sheet as well as in total — S18 28/28/26 and S20 73/73/73 both
ways. So the payload halves for free.

The first attempt at this run stopped on *"Your credit balance is too low to
access the Anthropic API"*, which is worth recording for the next person
reading a red eval: that is an account state, not a defect in the thing being
measured, and the sentence says so plainly.
