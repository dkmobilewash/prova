### Site photos: the camera, where it was taken, a stamp burned in, and they survive no signal (Diego)
`diego/photo-capture`

Gap 3 of the audit. The phone could only pick from the library, had no GPS,
and an upload with no signal simply said "Upload failed".

- **Take photo** opens the camera from the job's Photos screen. The shutter
  time comes from the camera's own EXIF when it is there, not from when the
  picker happened to return.
- **Where it was taken** is read at the shutter (expo-location) and stored
  as latitude, longitude and an accuracy radius — through the same parser
  the web capture path uses, so a phone and a browser cannot record a
  coordinate differently. Location refused or unavailable is not an error:
  the photo still saves and says plainly that it has no place on it.
- **The stamp is burned into the pixels** — job, date and time, coordinates
  and accuracy — so a photo texted to a GC still says when and where it was
  taken. It is drawn over the picture and captured with
  react-native-view-shot.
- **Photos queue like everything else.** The stamped file is copied into the
  app's document directory (the camera's own copy sits in the cache, which
  iOS clears), queued, and uploaded when there is signal. It shows
  immediately as "Syncing…", and a photo the server refuses for good is set
  aside with the reason rather than retried forever. The upload is
  idempotent on `clientOperationId`, checked before the blob is written, so
  a retry cannot leave a second copy in the store.
- **Tags and attachments at the shutter:** pick from the company's photo
  tags, attach to today's daily report, and attach to an open punch list
  item. The report row on the job page says how many photos are attached.

Migration `20260919120000_add_job_media_attachments`, additive: three
nullable columns on JobMedia (`dailyFieldReportId`, `punchListItemId`,
`clientOperationId`), two SET NULL foreign keys and one unique index.
Deleting a report or a punch item never deletes the photograph.

**This needs a new phone build.** expo-location, expo-file-system and
react-native-view-shot are native modules, so the installed dev client
cannot run them until it is rebuilt and reinstalled.
