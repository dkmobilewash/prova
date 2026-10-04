### A pin on a drawing, in the coordinate system that was already here (Diego)
`diego/plan-pins`

One additive migration (`20261004210000_add_sheet_pins`, 13 statements, no
drops). Flagged in `#prova-build` before a line was written, per rule 4.

**What it does.** Open a drawing revision, tap the sheet, and drop a PHOTO,
PUNCH or NOTE pin at that spot. The pins list under the drawing; removing one
is two steps.

**THE COORDINATE SYSTEM WAS NOT INVENTED, IT WAS EXTRACTED.** `takeoff-plan.ts`
already defined the page-width box — `x` 0..1 and `y` 0..H/W, **both divided by
the width** — and a second definition of that is exactly the "is there a second
list" failure this repo keeps paying for. It now lives in
`lib/sheet-geometry.ts`, imported by both; `takeoff-plan.ts` re-exports it so
its four importers resolve unchanged, and its 35 tests pass untouched.

The header of that file now also says the thing nobody had written down:
**there are TWO conventions here and both are right.** A `JobMediaAnnotation`
normalises each axis by its own extent, which is fine for a point on one photo
where nothing is ever measured between two marks. A SHEET carries lengths, so
distance must be computable from the stored numbers alone. Do not unify them —
that is the drift, not the fix.

**Why a pin is not a `TakeoffMeasurement`**, which was the obvious reuse and is
wrong: `calibrationId` is REQUIRED there, because a measurement with no scale
is meaningless. A pin needs no scale — you pin a photo to a wall without
telling the app how big the wall is. Reusing that table meant making
calibration optional, i.e. weakening the measurement model to serve a different
feature.

**The y-axis is the whole bug surface, so the fixture is 42x30.** On a D-size
sheet `y` tops out at 0.714, and `y = 0.9` is a perfectly good fraction that is
off the bottom of the page. A SQUARE fixture passes every test here while that
bug sails through, so there isn't one.

| mutation | result |
| --- | --- |
| control | green |
| **`y` treated as 0..1 of the height** | **RED** |
| only the first vertex of a shape checked | RED |
| a self-crossing ring accepted | RED |
| a pin whose target was deleted renders as normal | RED |

**SetNull, not Cascade, from a pin to what it points at.** Deleting the photo
does not delete the pin: somebody stood on that spot and flagged it, and that
outlives the attachment. It renders as "Photo (removed)" — honest — rather than
vanishing and taking the knowledge that anything was flagged there with it.

**Page geometry is read by the BROWSER, deliberately.** pdf.js is already open
to display the drawing, so the page count and each page's size at `scale: 1`
are free there. The server would need `@napi-rs/canvas` to get them, which this
app does not carry. Nothing trusts those numbers for money —
`@@unique([revisionId, pageNumber])` with `skipDuplicates` means the first
reader's numbers win — and a wrong one misplaces pins for the person who sent
it and nobody else.

**SEVEN CENSUSES CAUGHT THIS BRANCH AND EVERY ONE WAS RIGHT**, which is worth
recording because it is what they are for: the export completeness census (3
models in no bucket), the numeric-input census (a bare `Number()` on a Server
Action, which answers whoever posts to it), Ask's command coverage, the
reachability census ("written, documented and never called"), the
capability-guard walk, `rowActionsCensus` (a hand-rolled armed delete instead
of `ConfirmDeleteButton`, which owns the measured phone-column geometry),
`pageWidthCensus`, the spinner census and the inbound-link census.

**One census has a blind spot worth knowing about.**
`action-capability-guards.test.ts` reported `ensureSheetPages` as having NO
capability guard when it has the same one as its three neighbours. The
difference was that its signature spanned four lines. Flattening it turned 17
failures into 529 passes with no change to the guard. It fails SAFE — a
multi-line unguarded action is still flagged — so this is a false positive and
a time cost, not a hole. Filed rather than fixed inline: the census is a
security check and ships with its own work.

**Markup (arrows, clouds, text) is NOT in this PR.** It was built, and its
actions had no caller because the UI is a second thing — the reachability
census said so. Rather than half-build both, the model and actions came back
out and pins ship whole. That is rule 1 working as written rather than being
argued around.

568 files / 8846 tests, typecheck, lint and a full production build clean.

---

### The sheets a phone can actually draw on (Diego)

Second commit on this branch. The field half starts here: `apps/mobile` has no
PDF renderer and no WebView — `react-native-svg` is its only graphics
dependency — so a sheet is only usable on site once the server has turned it
into a picture.

**CLAUDE.md SAYS SERVER-SIDE `page.render()` FAILS. IT DOES NOT, AND THE CAUSE
OF THE ORIGINAL REPORT WAS A MISSING OPTIONAL DEPENDENCY.** pdfjs declares
`@napi-rs/canvas` as optional; nothing had installed it, so the call threw
`Cannot read properties of null (reading 'canvas')` — the exact error
`lib/plan-ingest/planPdf.ts` records. With the package present a page renders.
That file is still right about its OWN job: plan ingest reads text, and
"rasterising throws away the thing we came for" stands. This one wants the
opposite thing from the same library.

**PNG, not JPEG, measured rather than assumed:** 27KB against 43KB at the same
width on line-work — the reverse of the photo case, because a drawing is flat
colour with hard edges, which is what PNG is best at and JPEG is worst at.

**TWO MUTATIONS SURVIVED THE FIRST RUN AND THE REASON WAS THE FIXTURE.**

| mutation | against `plan-sheet.pdf` | against the new fixture |
| --- | --- | --- |
| raster squared, aspect destroyed | **green** | **RED** |
| paper not painted white | **green** | still green — see below |
| out-of-range page accepted | RED | RED |

`plan-sheet.pdf` is **200x200 — square** — so "aspect preserved" compared 1 to
1 and passed however the canvas was sized. That is the same trap this branch's
own pin tests were built to avoid three hours earlier, walked into from the
other side. `e2e/fixtures/wide-sheet.pdf` is 505 bytes of hand-written PDF at
420x300 (the 42:30 of a D-size sheet, so `y` tops out at 0.714) drawing
line-work on nothing — small enough to read in the diff rather than take on
trust.

**AND THE SECOND SURVIVOR WAS DEAD CODE, SO IT WAS DELETED.** `rasterisePage`
painted the canvas white first, with a comment saying a PDF page is transparent
where nothing is drawn. No mutation could make that go red, which is the signal
— and a probe said why: **pdf.js paints the canvas white itself**, so the corner
pixel is 255,255,255,255 either way. The fill was redundant and its comment was
wrong. The test stayed, repurposed: it no longer guards our code, it guards that
ASSUMPTION, and goes red the day a pdfjs upgrade stops doing it and the phone
starts showing black-on-black line-work.

**A THIRD FAILURE WAS THE INSTRUMENT, NOT THE CODE.** The white-paper probe
first read `[0,0,0,0]` — transparent — because it used `new Image(); img.src =
png` and never awaited the decode, so `drawImage` drew nothing. Checked against
the canvas directly (white before AND after the render) before touching
`rasterisePage`. A control that fails is the instruction to fix the harness.

**THE BUILD CAUGHT WHAT 8,855 TESTS COULD NOT.** `@napi-rs/canvas` ships a
native `.node` binary, and importing it reached the actions barrel through
`lib/actions/sheetPins.ts`; webpack tried to PARSE the binary and the build
died. Typecheck and the full suite were green throughout, because neither
bundles anything — this repo's "a green build is necessary and nowhere near
sufficient" rule arriving from the other direction. Making the import dynamic
did NOT fix it: webpack follows an `import()` too.

The fix is `serverExternalPackages: ["@napi-rs/canvas"]`, and `next.config.mjs`
now carries the reason it is not the mistake `planPdf.ts` warns about: that
warning is about **pdfjs**, which is pure JavaScript and bundles fine. A
compiled Skia cannot be bundled at all. One name on that list, not two.

One sheet per call, skipping any that already has an image, so a thirty-sheet
set walks forwards and is safe to retry rather than being one function timeout.

569 files / 8855 tests, typecheck, lint and a full production build clean.

---

### `/api/v1/sheets` — what the phone asks for and what it may write (Diego)

Third commit on this branch. `GET` returns every sheet of a job's drawings with
its pins; `POST` places one. `MANAGE_JOBS`, matching both the web route and the
phone's existing drawings endpoint — the same records, so the same gate. FIELD
holds it, which is the point: a foreman is exactly who pins a photo to a wall.

**THE SCHEMA GREW TWO COLUMNS BEFORE THE ROUTE WAS WRITTEN, AND THE REASON IS A
SCAR THAT IS NOT MINE.** The punch-list route states it in its own source:

> *THE READ IS NOT THE GUARANTEE — the unique index is. Two requests carrying
> the same key can both pass this check before either inserts, and production
> did exactly that on 2026-09-20… a 500 for a request whose whole purpose was
> to be safely repeatable.*

The phone queues pins without signal and flushes them later, so every POST here
is one a retry may repeat. `SheetPin` therefore carries `clientOperationId`
under `@@unique([companyId, clientOperationId])` — which is why it also carries
a denormalised `companyId`, since a unique key has to live on one table. Every
read still scopes through the join; that column never decides who may see a pin.

The test that matters is not "a replay returns the same row". It is **"a replay
that LOSES THE RACE still returns the same row"** — the case a read-based check
passes and only the index catches.

| mutation | result |
| --- | --- |
| control | green |
| **the catch removed, so a lost race 500s** (the 2026-09-20 bug) | **RED** |
| `y` bounded as if the page were square | **RED** |
| POST's capability guard removed | **RED** |
| another company's photo accepted as a pin target | **RED** |

**A TEST THAT ASSERTED NOTHING, CAUGHT BY ITS OWN FAILURE.** The permission
case used `jobFunction: "ESTIMATING"` — which this app does not have. The real
one is `ESTIMATOR`, and it HOLDS `MANAGE_JOBS`, so the assertion was about a
role that falls through to whatever the default is. `ACCOUNTING` is the job
function that genuinely lacks it, and the test says so in a comment rather than
just using the right string: a made-up role passes a permission test quietly.

**Two things the payload does on purpose.** A sheet with a null `imageUrl` is
SENT, not hidden — it means "nobody has prepared this one yet", and hiding it
would make a drawing that exists look like one that does not. And a pin carries
`punchItemDescription` flattened onto it, so a pin whose punch item was later
deleted still renders with no second request for words that are gone.

570 files / 8869 tests, typecheck, lint and a full production build clean.

---

### The sheet on the phone: an image, an SVG overlay, and a tap (Diego)

Fourth commit on this branch. `app/sheets/[jobId].tsx` — the field surface.
Reached from the Drawings screen rather than a tenth tile on the job hub,
because a sheet belongs to a drawing and that is how somebody looks for it.

**`app/drawings/[jobId].tsx` SAYS IN ITS OWN HEADER THAT "THERE ARE NO SHEETS
IN THIS PRODUCT".** That was true when it was written and is what this changes:
a revision's PDF is rendered at the office into one image per page, which is
what a phone can draw a pin on. The link added to that screen carries the
correction in a comment beside it, because the header above it still reads the
old way to anyone who scrolls past.

**An `<Image>` and `react-native-svg`, and no new native module.** The tap
stores `x = locationX / width` and `y = locationY / width` — BOTH over the
width, the page-width box `apps/web/lib/sheet-geometry.ts` defines. A pin
dropped on a ladder lands in the same place on the web, which is the entire
point of not inventing a second coordinate system.

**TWO LIMITS WRITTEN INTO THE FILE RATHER THAN DISCOVERED ON A LADDER.** There
is no pinch-zoom: a D-size sheet at phone width is enough to place a pin
against a visible feature and NOT enough to read a dimension string, and zoom
needs a gesture library this app does not carry. And only a NOTE pin can be
PLACED here — a photo or punch pin needs a picker for what it points at, which
is its own screen. Pins of every kind are SHOWN.

**Four censuses caught it and each was right**, which is the fourth time on
this branch they have paid for themselves: `cache-parity` (a key screens read
and the prefetch never fills), `offline-notes` (I had dropped `emptyFor` to
silence a type error, which is exactly how a screen loses the ability to tell
"no sheets" from "could not load"), `strings-census` twice — once for an
unclassified screen and once for a key nothing asked for.

**That second strings failure caught a half-applied edit.** The link's STYLES
landed and the button itself did not, because the anchor text did not match.
The result was a screen with an orphan style, an unused translation, and no way
to reach the new screen — and typecheck was green, because none of that is a
type error. The census found it in seconds.

| mutation | result |
| --- | --- |
| control | green |
| **the screen renders nothing** | **RED** |
| a not-ready sheet hidden instead of said | **RED** |
| pins reduced to dots with no words | **RED** |

The first is the decisive one from CLAUDE.md's `expo-router` entry: if "make it
render nothing" leaves a suite green, the suite is measuring a mock.

**WHAT THESE TESTS CANNOT SEE, and it is most of what matters on a phone.**
They render in happy-dom, which does no layout and returns zeros from
`getBoundingClientRect` — so nothing here checks that a pin lands where somebody
tapped, that the image fills the width, or that a 56pt button is 56pt. That
needs a device. The simulator route now exists (DeviceHub, since #620 made the
app launch at all) but the local build carries no
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, so it stops at the sign-in gate before
reaching this screen. **This screen has not been seen running.**

Mobile 40 files / 334 tests, screens 16 / 78, typecheck and lint clean.
