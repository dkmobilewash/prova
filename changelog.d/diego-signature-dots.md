### A signature's first stroke lands where it was drawn, and a tap shows as a dot (Diego)
`diego/signature-dots`

Found clicking #340 on the phone. Three small faults in the drawn-signature
pad, which the sign-the-day sheet and T&M tickets both use:

- **The first stroke started in the wrong place.** The "Sign here" text
  caught the first touch, so its position was measured from the text rather
  than the pad. The first mark of every signature landed near the top-left
  corner. The text no longer takes touches.
- **A tap drew nothing.** A single-point stroke, like the dot of an "i", was
  saved in the signature but never shown, so the signer couldn't see a mark
  that was going on the record. It now shows as a dot.
- **Clear was hidden** under the app's floating Tools button. It's on the
  left of the pad now.

**Also:** the phone's Time and T&M screens now reload when you come back
to them, and when the app returns from the background. Before, they loaded
once, so entries deleted on the web stayed on the phone until you left the
screen and came back.

No server change and no migration.
