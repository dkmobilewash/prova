### A photo the server refuses is kept, with a way to send it again (Diego)
`diego/photo-refusal-keeps-file`

Diego took a photo with the in-app camera and it vanished: "1 item wasn't
saved — Photo from 2026-09-19 — Upload failed (413)". The banner was right,
and deleting the file was not. A camera photo taken inside the app is not in
the camera roll, so that copy was the only one.

- **The file is kept** when the server refuses. The refused list is capped,
  so the disk this holds is bounded.
- **"Try again"** on the "wasn't saved" banner puts the refused writes back
  on the queue — for when the reason has been dealt with: a day reopened, or
  a build that no longer sends a photo too big for the server to take.
- **"Throw away"** (what "Dismiss" used to be) is now the explicit discard,
  and that is what deletes the kept photo.

The 413 itself is the platform's 4.5MB request cap, and #365's output-size
cap is what stops a stamped photo reaching it; this is about not losing the
picture when something does come back refused.
