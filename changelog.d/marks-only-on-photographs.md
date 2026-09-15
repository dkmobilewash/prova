### The one guard on saving marks that was a courtesy rather than enforcement (Diego)
`claude/prova-company-cam-feature-6170v6`

`saveJobMediaAnnotations` verified that the caller owned the media row, held
`MANAGE_FIELD`, had not exceeded the mark cap, and that every mark's geometry
was in range. It did not verify that the file was a **photograph**. The only
thing standing between a voice note and a set of arrows was `JobMediaCard`
declining to render the mark-up button.

That action's own comment already said why that is not enough — *"a Server
Action is an endpoint any signed-in caller can post to directly, so the
editor's checks are a courtesy and these are the enforcement"* — written four
lines below the check that was missing. Which is the reason worth recording:
the gap was not an oversight about security in general, it was one guard out
of five that read as handled because the button genuinely is hidden. Nothing
in the file looked wrong.

Found while fixing #256, filed as #275 rather than folded in.

The refusal comes BEFORE the cap and the geometry, so a caller posting forty
marks at a video is told it is a video rather than told the count is too high
for a file that can hold none. It is written `!== "photo"` rather than as a
video/audio pair, so a `contentType` this build does not recognise —
`jobMediaKind` returns null — is refused as well, instead of falling through
the gap between two named kinds. The kind is derived from `contentType` on the
row the ownership check already loaded: no extra query, and no `kind` column,
which the schema deliberately does not have because a stored one could
disagree with the type the upload was signed for.

**The row count is the assertion, not the returned sentence.** An action can
return `{ ok: false }` and have written anyway, and a test that reads only the
message cannot see that. Each of the three refusal cases asserts zero
`JobMediaAnnotation` rows afterwards.

A fourth case exists purely so the other three cannot pass vacuously: a
photograph must still be accepted. Without it, a guard that refused
*everything* would look identical to a guard that refused the right things —
the shape this repo keeps finding.

Two mutations. Disabling the guard turns the three refusal cases red and
leaves the control green. Moving it to AFTER the cap turns exactly one red,
the ordering case, which is the evidence that case is doing work rather than
restating its neighbours. File restored byte-identical by `sha256sum` after
each.

One existing test was corrected rather than worked around. `saves what was
drawn, and hands it back to the gallery` read the gallery's FIRST card
positionally, and the video and voice-note fixtures added here sort newer, so
it began asserting about a file with no marks on it. It now finds its card by
id. The test was always ambiguous about which card it meant; adding fixtures
is what made the ambiguity visible.

Verified: 2682 unit tests, 392 db tests against a real Postgres 16 at 81
migrations, `JobMedia`/`Job`/`Company`/`JobMediaAnnotation` all 0 afterwards,
typecheck and lint clean. No migration, no schema change. Not clicked — a
hand-posted payload is not something a click-list can reach, which is why this
one rests on the database tests rather than on a browser.
