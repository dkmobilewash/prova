### A restored answer key is not undone by a draft of the finder's own marks; Discard discards

Reproduced in a real browser on :3010 (Hutto A102, page 62, main ae1fb6c5): the
saved file restores — "Restored 450 saved decisions", 239 walls and 211 rejected,
about 0.2–6 s after the ~70 s finder lands the candidates. What made it look like
nothing came back was the browser draft around it:

- When the candidates landed, the autosave wrote their 86 pre-rejections as an
  "unsaved review", before the saved file arrived, and never updated it. The next
  open offered "Restore unsaved review (86 decisions)" beside the 450, and
  pressing it put the 86 over them. A review nobody has touched (the same rule
  the saved-file restore uses, `restoreGate`) is no longer written as a draft,
  and after a saved file is restored, any draft of the sheet holding no more than
  the pre-marks is removed, under whichever build wrote it.
- Between the candidates landing and the file arriving the panel showed
  "86 of 450 reviewed" and nothing else — read as "restored 0". It says "Loading
  the saved review for this sheet…" while the file comes.
- Discard cleared only the current build's draft key, while the offer can come
  from an older build's draft; that one survived and was offered again. Discard
  removes the sheet's drafts under every build (`clearSheetDrafts`).
