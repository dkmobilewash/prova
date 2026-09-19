### A queued photo actually uploads, and the queue drains when you open a screen (Diego)
`diego/photo-upload-fix`

Two faults found clicking #354 on the phone, with the photo sitting in the
queue saying "Syncing…" and never going anywhere.

- **Every photo upload failed** with "Unsupported FormDataPart
  implementation". The queue built a `FormData` with React Native's
  `{ uri, name, type }` file part, and the runtime's newer WinterCG `fetch`
  refuses that shape. The upload now uses the file system's own native
  multipart task, which streams the file from disk instead of pulling it
  through JavaScript. Several tags travel comma-separated, because a native
  multipart field holds one value; the route accepts both that and the web's
  repeated fields.
- **The queue only drained when you saved something else.** `flushQueue` ran
  from `sync()`, which only a create called — so a write queued with no
  signal stayed queued through any number of visits to the screen. `useSync`
  now also flushes when a screen is shown and when the app returns from the
  background, which is exactly when a phone comes back into range. That
  makes #342's separate reload hook redundant, so it is folded in rather
  than left as a second mechanism doing half the job.
- **The stamped photo is capped at its intended width.** Without an explicit
  output size, the capture came out at the screen's pixel density: 3600px
  and 2.7MB, measured on production.

No schema change, no migration.
